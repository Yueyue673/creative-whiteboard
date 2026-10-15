"""Immutable, scoped research material for the original workbench. No AI calls."""
import base64
import copy
import hashlib
import io
import json
import re
import struct
import uuid
import zipfile
from html.parser import HTMLParser
from pathlib import PurePath
from urllib.parse import urlparse

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse, JsonResponse

from ai_context import AI_POLICY, REFERENCE_RULES, context_folders, context_ids, spatial_context
from .document_views import data_endpoint
from .documents import check_quota, check_tree, document_etag, find_document, require_current_editor, valid_key
from .json_data import document_bytes
from .media import open_media
from .media_search import current_reader
from .models import MediaAsset, ResearchRecord
from .native_views import snapshot as library_snapshot
from .services import APIError, locked_workspace

IMAGE_NAME = r'[0-9]{2}_(?:viewport|overview|image|video-frame)\.png'
MAX_RECORDS = 1000


def payload(request):
    if request.content_type != 'application/json':
        raise APIError('请使用 JSON 请求', 415)
    length = request.META.get('CONTENT_LENGTH', '')
    if length and (not length.isdigit() or int(length) > settings.HOSTED_MAX_RESEARCH_BYTES):
        raise APIError('研究材料过大，请缩小选择范围', 413)
    if len(request.body) > settings.HOSTED_MAX_RESEARCH_BYTES:
        raise APIError('研究材料过大，请缩小选择范围', 413)
    try:
        value = json.loads(request.body, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        check_tree(value)
        document_bytes(value)
    except (ValueError, UnicodeError, RecursionError):
        raise APIError('研究材料不是有效的 JSON') from None
    if not isinstance(value, dict):
        raise APIError('研究材料必须是 JSON 对象')
    return value


def digest(value):
    if 'assets' in value:
        value=copy.deepcopy(value)
        for asset in value['assets']:
            if 'contentHash' in asset and 'filename' in asset:
                for field in ('path','mediaURL'):asset.pop(field,None)
    def normalize(item):
        if isinstance(item, dict):return {key: normalize(child) for key, child in item.items()}
        if isinstance(item, list):return [normalize(child) for child in item]
        if isinstance(item, float) and item.is_integer():return int(item)
        return item
    return hashlib.sha256(json.dumps(normalize({k:v for k,v in value.items() if k != 'view'}), sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def record(scope, kind, key):
    row = ResearchRecord.objects.filter(workspace=scope.workspace, kind=kind, key=valid_key(key)).first()
    if row is None:raise APIError('这份资料记录不存在或不属于原工作区', 404)
    return row


def etag(row):
    return '"' + hashlib.sha256(document_bytes([str(row.workspace_id), row.kind, row.key, row.value])).hexdigest() + '"'


def store(scope, account, kind, key, value, summary, expected):
    if expected != 'new':raise APIError('研究材料按独立记录保存，请使用新的编号', 428)
    if ResearchRecord.objects.filter(workspace=scope.workspace, kind=kind, key=key).exists():
        raise APIError('这份记录已经保存，未覆盖原材料，请查看已有材料', 409)
    if ResearchRecord.objects.filter(workspace=scope.workspace).count() >= MAX_RECORDS:
        raise APIError('工作区资料记录已达到数量限制，原记录保留', 413)
    size = len(document_bytes({'value':value, 'summary':summary}))
    if size > settings.HOSTED_MAX_RESEARCH_BYTES:raise APIError('研究材料过大，请缩小选择范围', 413)
    row = ResearchRecord.objects.create(workspace=scope.workspace, kind=kind, key=key, value=value, summary=summary, byte_size=size, created_by=account)
    check_quota(scope.workspace.pk)
    return row


class PlainText(HTMLParser):
    def __init__(self):super().__init__();self.parts=[];self.skip=0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style'):self.skip+=1
    def handle_endtag(self, tag):
        if tag in ('script','style'):self.skip=max(0,self.skip-1)
    def handle_data(self, value):
        if not self.skip:self.parts.append(value)


def context_files(scope, data, resource):
    ids = set()
    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ('assetId','mediaId') and isinstance(child,str):ids.add(child)
                elif isinstance(child,(dict,list)):visit(child)
                elif isinstance(child,str):
                    # Literal recognized media IDs only, never a URL/path read.
                    match=re.search(r'/api/media/([a-fA-F0-9-]{32,36})(?:[?&#/]|$)',child)
                    if match:ids.add(match[1])
        elif isinstance(value,list):
            for child in value:visit(child)
    visit(data)
    if resource=='library':ids.update(item['id'] for item in data['assets'])
    valid=[]
    for identity in ids:
        try:valid.append(uuid.UUID(identity))
        except (ValueError,TypeError,AttributeError):pass
    result=[]
    for asset in MediaAsset.objects.filter(workspace=scope.workspace,pk__in=valid).order_by('pk')[:32]:
        item={'id':str(asset.pk),'title':asset.title,'filename':asset.filename,'mime':asset.mime,'notes':asset.notes,'tags':asset.tags,'size':asset.size,'coverage':'仅工作区中已登记的原文件引用；画面和声音未自动分析'}
        if PurePath(asset.filename).suffix.lower() in ('.txt','.md','.csv','.tsv','.json','.html','.htm','.yaml','.yml'):
            try:
                with open_media(scope,asset) as stream:raw=stream.read(262144)
                text=raw.decode('utf-8',errors='replace')
                if PurePath(asset.filename).suffix.lower() in ('.html','.htm'):
                    parser=PlainText();parser.feed(text);text=' '.join(parser.parts)
                item.update(text=text[:12000],truncated=len(text)>12000 or asset.size>262144,coverage='原文件的文字摘录，最多12000字符；不执行文件中的代码')
            except APIError:item['coverage']='这个工作区的原文件暂时无法读取，未读取其他路径'
        result.append(item)
    return result


def visuals(data, entries, coverage):
    if not isinstance(entries,list) or len(entries)>66 or not isinstance(coverage,list) or len(coverage)>500 or any(not isinstance(v,str) or len(v)>2000 for v in coverage):
        raise APIError('图像附件或覆盖说明格式无效')
    allowed=context_ids(data);images=[];files={};total=0
    for index,item in enumerate(entries):
        if not isinstance(item,dict) or item.get('kind') not in ('viewport','overview','image','video-frame'):
            raise APIError('图像附件类型无效')
        ids=item.get('nodeIds')
        if not isinstance(ids,list) or not ids or any(not isinstance(v,str) for v in ids) or not set(ids)<=allowed or item.get('ownerId') is not None and (not isinstance(item['ownerId'],str) or item['ownerId'] not in allowed):
            raise APIError('图像附件超出所选范围')
        encoded=item.get('data','')
        if not isinstance(encoded,str) or not encoded.startswith('data:image/png;base64,'):raise APIError('图像附件必须为 PNG')
        try:raw=base64.b64decode(encoded.split(',',1)[1],validate=True)
        except (ValueError,TypeError):raise APIError('图像附件无法读取') from None
        if len(raw)<24 or raw[:8]!=b'\x89PNG\r\n\x1a\n':raise APIError('图像附件格式无效')
        width,height=struct.unpack('>II',raw[16:24]);total+=len(raw)
        if not 0<width<=4096 or not 0<height<=4096 or len(raw)>3*1024*1024 or total>12*1024*1024:
            raise APIError('图像附件过大，请缩小选择范围',413)
        locations=item.get('locations',[])
        if not isinstance(locations,list) or len(locations)>5000 or any(not isinstance(p,dict) or not isinstance(p.get('nodeId'),str) or p['nodeId'] not in allowed or not isinstance(p.get('ownerId'),str) or p['ownerId'] not in allowed or not isinstance(p.get('path'),str) or len(p['path'])>2000 for p in locations):
            raise APIError('图像关联位置超出所选范围')
        name=f'{index:02d}_{item["kind"]}.png';metadata={k:copy.deepcopy(item[k]) for k in ('kind','nodeIds','ownerId','locations','time') if k in item}
        for field in ('source','coverage'):
            if field in item:
                if not isinstance(item[field],str) or len(item[field])>2000:raise APIError('图像说明过长')
                metadata[field]=item[field]
        metadata.update(name=name,archivePath='images/'+name,width=width,height=height,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
        images.append(metadata);files[name]=base64.b64encode(raw).decode('ascii')
    return {'images':images,'coverage':coverage,'note':'图片与文字保存在原工作区；只有主动下载或复制后才会提供给外部 AI。只复制 JSON 不等于 AI 已看到图片，声音未转写，静帧不代表完整视频。'},files


def prepare(scope, account, key, value, expected):
    valid_key(key)
    req=value.get('request')
    if value.get('format')!='creative-board-context' or type(value.get('version')) is not int or value['version']!=1 or value.get('requestId')!=key or not isinstance(req,dict) or req.get('id')!=key:
        raise APIError('研究任务格式或编号不正确')
    if not isinstance(req.get('task'),str) or not req['task'].strip() or len(req['task'])>4000:raise APIError('请填写不超过4000字的研究问题')
    if any(type(req.get(flag)) is not bool for flag in ('keepWords','keepNotes','allowAdd','allowDelete')):raise APIError('研究任务规则无效')
    resource=value.get('resource');target=value.get('targetId')
    if resource not in ('board','library') or any(req.get(k)!=value.get(k) for k in ('resource','targetId','baseETag')):
        raise APIError('任务与原选择范围不一致')
    with transaction.atomic():
        workspace=locked_workspace(scope.workspace.pk);require_current_editor(workspace,account)
        if resource=='board':
            original=find_document(workspace.pk,'board',valid_key(target))
            if original is None:raise APIError('原白板不存在或已被删除，任务没有转到别处',409)
            source=copy.deepcopy(original.value);tag=document_etag(original)
        else:
            if target!='catalog':raise APIError('内容库目标无效')
            source,tag,_,_=library_snapshot(scope,account)
        if tag!=value.get('baseETag'):raise APIError('原内容刚刚有变化，请重新准备材料',409)
        field='nodes' if resource=='board' else 'assets';selected=value.get('data',{}).get(field) if isinstance(value.get('data'),dict) else None
        if not isinstance(selected,list) or not selected or any(not isinstance(n,dict) or not isinstance(n.get('id'),str) for n in selected):raise APIError('请选择要提供背景的内容')
        ids=[n['id'] for n in selected];lookup={n['id']:n for n in source[field]}
        if len(set(ids))!=len(ids) or any(n['id'] not in lookup or lookup[n['id']]!=n for n in selected):raise APIError('选择内容已变化或不属于原范围',409)
        edges=[e for e in source.get('edges',[]) if e['from'] in ids and e['to'] in ids] if resource=='board' else []
        if any(not isinstance(edge.get('id'),str) for edge in edges) or len(set(ids+[edge['id'] for edge in edges]))!=len(ids)+len(edges):
            raise APIError('原连线的编号无法完整核对，请先检查连线后再准备材料',409)
        if req.get('nodeIds')!=(ids if resource=='board' else []):raise APIError('所选内容与任务规则不一致')
        permitted=ids+[e['id'] for e in edges]
        for collection in (req.get('ids'),value.get('selectedIds')):
            if not isinstance(collection,list) or any(not isinstance(v,str) for v in collection) or len(set(collection))!=len(collection) or set(collection)!=set(permitted):raise APIError('授权范围与选择内容不一致')
        data={**source,'nodes':copy.deepcopy(selected),'edges':edges} if resource=='board' else {'assets':copy.deepcopy(selected),'folders':context_folders(selected)}
        image_info,files=visuals(data,value.get('visualInput',[]),value.get('visualCoverage',[]))
        request={k:copy.deepcopy(req[k]) for k in ('id','resource','targetId','baseETag','ids','nodeIds','task')}
        request.update(keepWords=True,keepNotes=True,allowAdd=False,allowDelete=False,mode=AI_POLICY['mode'])
        pack={'format':'creative-board-context','version':1,'resource':resource,'targetId':target,'baseETag':tag,'requestId':key,'selectedIds':permitted,'request':request,'data':data,'aiPolicy':copy.deepcopy(AI_POLICY),'referenceRules':copy.deepcopy(REFERENCE_RULES),'contentETag':digest(source),'files':context_files(scope,data,resource),'spatial':spatial_context(data),'visuals':image_info}
        return store(scope,account,'task',key,{'pack':pack,'images':files},{'task':request['task'],'resource':resource,'targetId':target,'count':len(permitted)},expected)


def material(row, account):
    pack=copy.deepcopy(row.value['pack']);pack['createdAt']=row.created_at.timestamp()
    for image in pack['visuals']['images']:
        image['url']=f'/w/{row.workspace_id}/api/ai/tasks/{row.key}/files/{image["name"]}?account={account.pk}'
    return pack


def reference(scope, account, key, value, expected):
    if set(value)-{'format','version','requestId','sources'} or value.get('format')!='creative-board-references' or type(value.get('version')) is not int or value['version']!=1:
        raise APIError('这里只接收带来源的资料，不能包含创作内容或修改提案')
    sources=value.get('sources')
    if not isinstance(sources,list) or not 1<=len(sources)<=200:raise APIError('请提供1至200个来源')
    ids=set()
    for item in sources:
        if not isinstance(item,dict) or set(item)-{'id','title','url','author','published','finding','limitations'}:raise APIError('来源包含不支持的字段')
        for field,limit in [('id',100),('title',500),('url',3000),('finding',12000),('author',500),('published',100),('limitations',12000)]:
            if field in item or field in ('id','title','url','finding'):
                if not isinstance(item.get(field),str) or len(item[field])>limit or field in ('id','title','url','finding') and not item[field].strip():raise APIError('来源字段无效：'+field)
        if item['id'] in ids:raise APIError('来源编号重复')
        ids.add(item['id'])
        try:url=urlparse(item['url']);valid=url.scheme in ('http','https') and bool(url.hostname) and not url.username and not url.password
        except ValueError:valid=False
        if not valid:raise APIError('请提供可核对的 http(s) 原文链接')
    with transaction.atomic():
        workspace=locked_workspace(scope.workspace.pk);require_current_editor(workspace,account)
        task=record(scope,'task',value.get('requestId'))
        saved={**copy.deepcopy(value),'task':task.summary['task'],'verification':'外部助手提供的来源，尚未自动核对原文；与创作分开保存'}
        return store(scope,account,'reference',valid_key(key),saved,{'task':saved['task'],'count':len(sources)},expected)


@data_endpoint(('GET','HEAD'))
def listing(request, workspace_id, kind):
    rows=[{'id':row['key'],**row['summary'],'createdAt':row['created_at'].timestamp()} for row in ResearchRecord.objects.filter(workspace_id=workspace_id,kind=kind).order_by('-created_at').values('key','summary','created_at')]
    current_reader(request.workspace_scope,request.user)
    return JsonResponse(rows,safe=False)


@data_endpoint(('GET','HEAD','PUT'))
def item(request, workspace_id, kind, key):
    if request.method=='PUT':
        if not settings.HOSTED_NATIVE_RESEARCH:raise APIError('准备新研究材料暂时停用，已有材料仍保留并可以读取',503)
        value=payload(request)
        row=(prepare if kind=='task' else reference)(request.workspace_scope,request.user,key,value,request.headers.get('If-Match'))
    else:row=record(request.workspace_scope,kind,key)
    value=material(row,request.user) if kind=='task' else {**row.value,'createdAt':row.created_at.timestamp()}
    current_reader(request.workspace_scope,request.user)
    response=JsonResponse(value);response['ETag']=etag(row);return response


@data_endpoint(('GET','HEAD'))
def current(request, workspace_id, key):
    task=record(request.workspace_scope,'task',key);pack=task.value['pack']
    if pack['resource']=='board':
        source=find_document(workspace_id,'board',pack['targetId'])
        if source is None:raise APIError('原白板不存在或已被删除，已保存的任务仍保留',404)
        value,tag=source.value,document_etag(source)
    else:value,tag,_,_=library_snapshot(request.workspace_scope,request.user)
    current_reader(request.workspace_scope,request.user)
    return JsonResponse({'baseETag':tag,'contentUnchanged':digest(value)==pack['contentETag']})


@data_endpoint(('GET','HEAD'),media=True)
def attachment(request, workspace_id, key, name):
    row=record(request.workspace_scope,'task',key)
    if name not in row.value['images']:raise APIError('这张研究附件不存在',404)
    raw=base64.b64decode(row.value['images'][name],validate=True)
    metadata=next(image for image in row.value['pack']['visuals']['images'] if image['name']==name)
    if len(raw)!=metadata['bytes'] or hashlib.sha256(raw).hexdigest()!=metadata['sha256']:raise APIError('研究附件内容已改变，原任务保留，请重新准备',409)
    current_reader(request.workspace_scope,request.user)
    response=HttpResponse(raw,content_type='image/png');response['X-Content-Type-Options']='nosniff';return response


@data_endpoint(('GET','HEAD'))
def bundle(request, workspace_id, key):
    row=record(request.workspace_scope,'task',key);pack=material(row,request.user);out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('task.json',json.dumps(pack,ensure_ascii=False,indent=2))
        archive.writestr('说明.txt','把 task.json 和 images 文件夹内的图片一并提供给支持看图的 AI。\n只查有来源的资料及介绍已有体系；不创作、不改写、不修改原文或设计。\n按 referenceRules 返回 creative-board-references，资料单独保存。\n位置关系不是因果，声音未转写，静帧不代表完整视频。\n')
        for image in pack['visuals']['images']:
            raw=base64.b64decode(row.value['images'][image['name']],validate=True)
            if len(raw)!=image['bytes'] or hashlib.sha256(raw).hexdigest()!=image['sha256']:raise APIError('研究附件已改变，未提供不完整材料包',409)
            archive.writestr(image['archivePath'],raw)
    current_reader(request.workspace_scope,request.user)
    response=HttpResponse(out.getvalue(),content_type='application/zip');response['Content-Disposition']='attachment; filename="research-'+key+'.zip"';return response


@data_endpoint(('GET','HEAD','PUT'))
def proposals(request, workspace_id, key=None, status=False):
    if request.method=='PUT':raise APIError('AI只提供研究资料与参考，修改创作的旧提案接口已关闭')
    if key is None:return listing(request,workspace_id,'legacy')
    row=record(request.workspace_scope,'legacy',key);current_reader(request.workspace_scope,request.user);response=JsonResponse(row.value);response['ETag']=etag(row);return response
