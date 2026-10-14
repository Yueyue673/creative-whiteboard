import {BoardTransport, BoardError, validETag} from './board-transport.js';
import {checkRaw} from './board-drafts.js';

const KEY=/^[A-Za-z0-9_-]{1,100}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail=message=>{throw new BoardError(message,0,'protocol');};
const key=value=>{if(typeof value!=='string'||!KEY.test(value))fail('记录的白板编号无效。');return value;};
const kind=value=>{if(!['board','folders','library'].includes(value))fail('保存内容类型无效。');return value;};
const documentTarget=(value,identity)=>{kind(value);key(identity);if(value!=='board'&&identity!=='catalog')fail('目录记录与原编号不一致。');return identity;};
const uuid=value=>{if(typeof value!=='string'||!UUID.test(value))fail('记录编号无效。');return value;};
const stamp=value=>{if(!Number.isFinite(value)||value<0)fail('记录时间无效。');return value;};
const rows=value=>{if(!Array.isArray(value)||value.length>10000)fail('记录列表超过读取范围或格式不一致。');return value;};
function raw(value,kind='board'){
  const text=JSON.stringify(value,null,2);
  if(typeof text!=='string'||new TextEncoder().encode(text).length>8*1024*1024)fail('记录过大，未显示或应用。');
  if(kind==='board')checkRaw(text);
  else if(!value||typeof value!=='object'||Array.isArray(value))fail('目录副本格式不一致。');
  return text;
}
function numbers(value,names){
  if(!value||typeof value!=='object')fail('容量数据无效。');
  for(const name of names)if(!Number.isSafeInteger(value[name])||value[name]<0)fail('容量数据无效，未显示推测的剩余空间。');
  return Object.freeze({...value});
}

export function checkedCleanupPlan(value,etag,target){
  const targetKind=kind(target.kind??'board');documentTarget(targetKind,target.key);
  if(target.action==='discard_board'&&targetKind!=='board')fail('目录不能作为回收站白板移除。');
  if(!value||!validETag(etag)||value.workspace!==target.workspace||value.kind!==targetKind||value.key!==target.key||value.action!==target.action||
    !['discard_history','discard_board'].includes(target.action)||typeof value.name!=='string'||typeof value.warning!=='string'||
    !validETag(value.documentETag)||value.irreversible!==true||value.privateInputsPreserved!==true)fail('清理范围与原工作区或白板不一致，未启用确认。');
  const count=numbers(value,['removeRevisions','keepRevisions','reclaimPayloadBytes','retentionLimit']);
  if(count.retentionLimit<1||count.retentionLimit>10000)fail('保留范围无效。');
  const usage=numbers(value.usage,['currentBytes','historyBytes','draftBytes','assetMetadataBytes','totalBytes','limitBytes']);
  if(usage.currentBytes+usage.historyBytes+usage.draftBytes+usage.assetMetadataBytes!==usage.totalBytes||value.reclaimPayloadBytes>usage.totalBytes)fail('清理容量无法核对。');
  const seen=new Set();function versions(list){
    let prior=Infinity;
    return Object.freeze(rows(list).map(row=>{
      uuid(row.id);stamp(row.savedAt);numbers(row,['revision','payloadBytes']);
      if(row.revision<1||row.revision>=prior||seen.has(row.id)||typeof row.name!=='string'||typeof row.deleted!=='boolean')fail('具体清理版本不一致。');
      prior=row.revision;seen.add(row.id);return Object.freeze({id:row.id,revision:row.revision,savedAt:row.savedAt,name:row.name,deleted:row.deleted,payloadBytes:row.payloadBytes});
    }));
  }
  const retained=versions(value.retainVersions),removed=versions(value.removeVersions);
  if(retained.length!==value.keepRevisions||removed.length!==value.removeRevisions||seen.size<1||seen.size>value.retentionLimit)fail('清理版本数量无法核对。');
  if(target.action==='discard_history'){
    if(!Number.isSafeInteger(value.keep)||value.keep!==target.keep||value.keep<1||value.keep>value.retentionLimit||retained.length<1||
      (removed.length&&retained.at(-1).revision<=removed[0].revision)||removed.reduce((n,r)=>n+r.payloadBytes,0)!==value.reclaimPayloadBytes)fail('保留版本选择与清理范围不一致。');
  }else if(retained.length||value.keep!==undefined||!removed[0].deleted||removed.reduce((n,r)=>n+r.payloadBytes,0)>value.reclaimPayloadBytes)fail('回收站的永久移除范围无效。');
  return Object.freeze({workspace:value.workspace,key:value.key,kind:targetKind,action:value.action,name:value.name,documentETag:value.documentETag,
    removeRevisions:value.removeRevisions,keepRevisions:value.keepRevisions,reclaimPayloadBytes:value.reclaimPayloadBytes,retentionLimit:value.retentionLimit,
    irreversible:true,privateInputsPreserved:true,warning:value.warning,keep:value.keep,removeVersions:removed,retainVersions:retained,usage,etag});
}
const cleanupSame=(a,b)=>['workspace','key','kind','action','name','documentETag','removeRevisions','keepRevisions','reclaimPayloadBytes','retentionLimit','keep','etag'].every(k=>a[k]===b[k])&&
  JSON.stringify(a.removeVersions)===JSON.stringify(b.removeVersions)&&JSON.stringify(a.retainVersions)===JSON.stringify(b.retainVersions);

export function checkedApplicationPlan(value,etag,target){
  if(!value||!validETag(etag)||value.action!=='apply_retained_version'||value.workspace!==target.workspace||value.key!==key(target.key)||value.sourceId!==uuid(target.id)||
    !validETag(value.currentETag)||typeof value.sourceName!=='string'||typeof value.currentName!=='string'||typeof value.blockedReason!=='string'||
    typeof value.changed!=='boolean'||typeof value.canApply!=='boolean'||value.retainedVersionsPreserved!==true||value.privateInputsPreserved!==true||value.originalFilesPreserved!==true)
    fail('取回范围与原工作区或所选版本不一致，未启用确认。');
  numbers(value,['sourceRevision','currentRevision','sourcePayloadBytes','retainedVersions','historyLimit']);stamp(value.sourceSavedAt);
  if(value.sourceRevision<1||value.currentRevision<value.sourceRevision||value.retainedVersions<1||value.retainedVersions>10000||value.historyLimit<1||value.historyLimit>10000||
    value.canApply===Boolean(value.blockedReason)||value.canApply&&value.changed&&value.retainedVersions>=value.historyLimit)fail('保留版本范围或状态无法核对。');
  return Object.freeze({...value,etag});
}
const applicationSame=(a,b)=>['workspace','key','sourceId','sourceRevision','sourceName','sourceSavedAt','sourcePayloadBytes','currentName','currentRevision','currentETag','retainedVersions','historyLimit','changed','canApply','blockedReason','etag','currentRaw'].every(key=>a[key]===b[key]);

/* All destinations are constructed from the original scope and checked IDs.
   No arbitrary URL, active workspace, file path or newer cookie sets a target. */
export class ArchiveTransport{
  #transport;
  constructor(scope){this.#transport=new BoardTransport({...scope,key:'_archive'});}
  get scope(){return this.#transport.scope;}
  get base(){return this.#transport.base;}
  async access(){await this.#transport.assertIdentity();return this.#transport.workspace();}
  async #request(path,method='GET',expected,body={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    const headers={'Accept':'application/json','X-Creative-Account':String(this.scope.account)};
    if(method!=='GET'){
      const cookie=document.cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith('__Host-creative_csrf='));
      try{headers['X-CSRFToken']=cookie?decodeURIComponent(cookie.slice(cookie.indexOf('=')+1)):'';}catch{headers['X-CSRFToken']='';}
      headers['Content-Type']='application/json';if(expected)headers['If-Match']=expected;
    }
    try{
      let response;try{response=await fetch(path,{method,headers,body:method==='GET'?undefined:JSON.stringify(body),credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});}
      catch{throw new BoardError('连接中断或等待超时，操作没有确认；请刷新核对后再处理。',0,'offline');}
      let text;try{text=await response.text();}catch{throw new BoardError('回复未能完整读取，操作结果尚未确认；请先刷新核对，勿直接重复提交。',0,'offline');}
      if(new TextEncoder().encode(text).length>16*1024*1024)fail('服务器返回内容超过读取范围。');
      let value;try{value=JSON.parse(text);}catch{fail('服务器没有返回可核对的记录。');}
      if(!response.ok)throw new BoardError(value?.error||'记录读取或操作未完成。',response.status,value?.code||'request_failed',value);
      return {value,etag:response.headers.get('ETag')};
    }finally{clearTimeout(timer);}
  }
  async #read(path){await this.access();const result=await this.#request(path);const space=await this.access();return {...result,role:space.role};}
  async boards(){
    const result=await this.#read(this.base+'boards');
    return rows(result.value).map(row=>{key(row.id);if(typeof row.name!=='string')fail('白板名称格式不一致。');return Object.freeze({id:row.id,name:row.name});});
  }
  async history(boardKey,documentKind='board'){
    documentTarget(documentKind,boardKey);let result;
    try{result=await this.#read(this.base+'history/'+documentKind+'/'+boardKey);}
    catch(error){if(documentKind==='board'||error.status!==404)throw error;await this.access();return [];}
    return rows(result.value).map(row=>{uuid(row.id);stamp(row.savedAt);if(!Number.isSafeInteger(row.revision)||row.revision<1||typeof row.name!=='string'||typeof row.deleted!=='boolean')fail('版本记录格式不一致。');return Object.freeze({...row,key:boardKey,kind:documentKind});});
  }
  async revision(boardKey,id,documentKind='board'){
    documentTarget(documentKind,boardKey);
    const result=await this.#read(this.base+'history/'+documentKind+'/'+boardKey+'/'+uuid(id)),value=result.value;
    if(value?.id!==id||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.deleted!=='boolean')fail('返回的版本与所选记录不一致。');
    stamp(value.savedAt);const text=raw(value.value,documentKind);
    return Object.freeze({source:'history',key:boardKey,kind:documentKind,id,name:documentKind==='board'?value.value.name:documentKind==='folders'?'分类目录':'资料库目录',revision:value.revision,savedAt:value.savedAt,deleted:value.deleted,raw:text,role:result.role});
  }
  async trash(){
    const result=await this.#read(this.base+'trash');
    return rows(result.value).map(row=>{key(row.id);stamp(row.savedAt);if(typeof row.name!=='string'||!validETag(row.etag))fail('回收站记录格式不一致。');return Object.freeze({...row});});
  }
  async inspectTrash(reviewed){
    key(reviewed.id);if(!validETag(reviewed.etag))fail('回收站核对版本无效。');
    const versions=await this.history(reviewed.id);if(!versions.length)fail('没有可核对的保留版本。');
    const latest=versions.reduce((a,b)=>a.revision>b.revision?a:b),selected=await this.revision(reviewed.id,latest.id),current=(await this.trash()).find(row=>row.id===reviewed.id);
    if(!current||current.etag!==reviewed.etag||!selected.deleted)throw new BoardError('这张白板的状态已改变，请刷新后重新核对；没有执行恢复。',409,'changed');
    return Object.freeze({...selected,source:'trash',expected:current.etag});
  }
  async conflicts(){
    const result=await this.#read(this.base+'conflicts');
    return rows(result.value).map(row=>{uuid(row.id);key(row.key);stamp(row.createdAt);if(!['board','folders','library'].includes(row.kind)||!validETag(row.baseETag,true)||!validETag(row.currentETag,true))fail('输入副本格式不一致。');return Object.freeze({...row});});
  }
  async conflict(id){
    const result=await this.#read(this.base+'conflicts/'+uuid(id)),value=result.value;
    if(value?.id!==id||!['board','folders','library'].includes(value.kind))fail('返回的输入与所选记录不一致。');
    key(value.key);stamp(value.createdAt);if(!validETag(value.baseETag,true)||!validETag(value.currentETag,true))fail('输入副本依据无效。');
    return Object.freeze({source:'conflict',id,kind:value.kind,key:value.key,name:typeof value.value?.name==='string'?value.value.name:'自己的目录输入',savedAt:value.createdAt,raw:raw(value.value,value.kind),role:result.role});
  }
  async removeConflict(reviewed,isCurrent){
    if(reviewed?.source!=='conflict')fail('请先查看自己的这份服务器提交。');
    uuid(reviewed.id);key(reviewed.key);const space=await this.access();
    if(space.role==='viewer')throw new BoardError('当前只有阅读权限，未移除服务器记录。',403,'readonly');
    const fresh=await this.conflict(reviewed.id);
    if(!['id','kind','key','name','savedAt','raw'].every(name=>fresh[name]===reviewed[name]))
      throw new BoardError('这份提交与刚才查看的内容不一致，未执行移除；请刷新重新核对。',409,'changed');
    if(typeof isCurrent!=='function'||!isCurrent())throw new BoardError('核对页面已关闭，未发送移除请求。',0,'cancelled');
    const result=await this.#request(this.base+'conflicts/'+reviewed.id,'DELETE');
    if(result.value?.removed!==true||result.value.id!==reviewed.id)
      throw new BoardError('移除请求已发送，但回复无法核对；请刷新检查，勿直接重复提交。',0,'protocol');
    try{
      const records=await this.conflicts();
      if(records.some(record=>record.id===reviewed.id))throw new BoardError('记录仍在列表，移除结果未能核对。',0,'protocol');
      return {removed:true,id:reviewed.id,records};
    }catch(error){throw new BoardError('服务器已接受移除，但后续列表尚未核对；请刷新检查，未重复提交。',error.status,error.code,{accepted:true});}
  }
  async prepareApplication(selected){
    if(selected?.source!=='history'||selected.deleted||(selected.kind??'board')!=='board')fail('请选择原白板的正常保留版本。');
    const space=await this.access();if(space.role==='viewer')throw new BoardError('当前只有阅读权限，可以导出，不能取回版本。',403,'readonly');
    const fresh=await this.revision(selected.key,selected.id);
    if(!['key','id','revision','name','savedAt','deleted','raw'].every(name=>fresh[name]===selected[name]))throw new BoardError('所选版本与刚才查看的原文不一致，请重新检查。',409,'changed');
    const result=await this.#read(this.base+'history/board/'+key(selected.key)+'/'+uuid(selected.id)+'/apply');
    const plan=checkedApplicationPlan(result.value,result.etag,{workspace:this.scope.workspace,key:selected.key,id:selected.id});
    if(plan.sourceName!==selected.name||plan.sourceRevision!==selected.revision||plan.sourceSavedAt!==selected.savedAt)fail('取回范围与已查看的版本不一致。');
    const current=await this.#read(this.base+'boards/'+selected.key);
    if(current.etag!==plan.currentETag)throw new BoardError('当前白板已经改变，请重新检查取回范围。',409,'changed');
    return Object.freeze({...plan,currentRaw:raw(current.value)});
  }
  async applyVersion(selected,plan,isCurrent){
    checkedApplicationPlan(plan,plan?.etag,{workspace:this.scope.workspace,key:selected?.key,id:selected?.id});
    const fresh=await this.prepareApplication(selected);
    if(!applicationSame(fresh,plan))throw new BoardError('当前内容或取回范围在核对后有变化，未发送取回操作；请重新检查。',409,'changed');
    if(!plan.canApply||!plan.changed)throw new BoardError(plan.blockedReason||'这个版本与当前内容相同，无需取回。',409,'unchanged');
    if(typeof isCurrent!=='function'||!isCurrent())throw new BoardError('取回核对已关闭，未发送保存请求。',0,'cancelled');
    let result;
    try{result=await this.#request(this.base+'history/board/'+selected.key+'/'+selected.id+'/apply','POST',plan.etag,{confirm:'apply_retained_version'});}
    catch(error){if(error.status)throw error;throw new BoardError('取回操作的结果尚未确认，请刷新检查；未自动重试。 '+error.message,0,error.code);}
    const value=result.value;
    if(value?.applied!==true||value.unchanged!==false||value.sourceId!==selected.id||value.workspace!==this.scope.workspace||value.key!==selected.key||
      value.revision!==plan.currentRevision+1||!validETag(result.etag)||result.etag===plan.currentETag||value.retainedVersionsPreserved!==true||value.privateInputsPreserved!==true||value.originalFilesPreserved!==true)
      throw new BoardError('取回请求已发送，但回复与确认范围不一致；请刷新检查，勿直接重复提交。',0,'protocol');
    try{
      const current=await this.#read(this.base+'boards/'+selected.key);
      return {applied:true,verified:current.etag===result.etag&&raw(current.value)===selected.raw,key:selected.key,revision:value.revision};
    }catch(error){throw new BoardError('服务器已接受取回，但之后未能核对当前内容；请在新页面检查，未重复提交。',error.status,error.code,{accepted:true});}
  }
  async quota(){
    const doc=await this.#read(this.base+'quota'),media=await this.#read(this.base+'media-quota');
    const document=numbers(doc.value,['currentBytes','historyBytes','draftBytes','assetMetadataBytes','totalBytes','limitBytes']);
    if(document.currentBytes+document.historyBytes+document.draftBytes+document.assetMetadataBytes!==document.totalBytes)fail('文档容量合计不一致。');
    const files=numbers(media.value,['workspaceBytes','workspacePendingBytes','workspaceLimitBytes','accountUploadedBytes','accountPendingBytes','accountLimitBytes','singleUploadLimitBytes']);
    return Object.freeze({document,files});
  }
  #cleanupPath(target){const documentKind=kind(target.kind??'board');documentTarget(documentKind,target.key);if(target.action==='discard_board'&&documentKind!=='board')fail('目录不能作为回收站白板移除。');return target.action==='discard_board'?this.base+'boards/'+target.key+'/purge':this.base+'history/'+documentKind+'/'+target.key+'/cleanup';}
  async #owner(){const space=await this.access();if(space.role!=='owner')throw new BoardError('只有原工作区所有者可以永久移除版本或回收站内容。',403,'readonly');return space;}
  async #cleanupRead(target){
    await this.#owner();const result=await this.#request(this.#cleanupPath(target)+(target.action==='discard_history'?'?keep='+target.keep:''));
    const plan=checkedCleanupPlan(result.value,result.etag,{...target,workspace:this.scope.workspace});await this.#owner();return plan;
  }
  async prepareCleanup(selected,keep){
    if(!['history','trash'].includes(selected?.source))fail('请先查看原白板的具体内容。');
    const target={key:key(selected.key),kind:kind(selected.kind??'board'),action:selected.source==='trash'?'discard_board':'discard_history',keep:selected.source==='history'?keep:undefined};
    if(target.action==='discard_history'&&(!Number.isSafeInteger(keep)||keep<1||keep>10000))fail('请选择要保留的最新版本数。');
    if(selected.source==='history'&&target.kind!=='board'){
      const fresh=await this.revision(selected.key,selected.id,target.kind);
      if(!['key','kind','id','revision','name','savedAt','deleted','raw'].every(name=>fresh[name]===selected[name]))throw new BoardError('所选目录版本与已查看的内容不一致，未启用清理；请重新核对。',409,'changed');
    }
    const plan=await this.#cleanupRead(target);
    if(selected.source==='trash'&&plan.documentETag!==selected.expected||selected.source==='history'&&![...plan.removeVersions,...plan.retainVersions].some(row=>row.id===selected.id))
      throw new BoardError('所查看的记录已经变化，未启用清理；请刷新重新核对。',409,'changed');
    return plan;
  }
  async cleanup(plan,isCurrent){
    const target={workspace:this.scope.workspace,key:plan?.key,kind:plan?.kind,action:plan?.action,keep:plan?.keep};
    checkedCleanupPlan(plan,plan?.etag,target);
    const fresh=await this.#cleanupRead(target);
    if(!cleanupSame(fresh,plan))throw new BoardError('内容或历史在预览后有变化，未执行清理；请重新检查范围。',409,'changed');
    if(typeof isCurrent!=='function'||!isCurrent())throw new BoardError('清理预览已关闭，未发送永久移除请求。',0,'cancelled');
    const result=await this.#request(this.#cleanupPath(target),'POST',plan.etag,{confirm:plan.action,...(plan.action==='discard_history'?{keep:plan.keep}:{})});
    // A write may already be committed. Never retry after an incomplete reply.
    try{
      if(result.value?.cleaned!==true)fail('清理结果无法核对。');
      // Usage is the post-commit snapshot, so reclaimed bytes can exceed its total.
      const checked=checkedCleanupPlan({...result.value,usage:plan.usage},plan.etag,target);
      numbers(result.value.usage,['currentBytes','historyBytes','draftBytes','assetMetadataBytes','totalBytes','limitBytes']);
      if(!cleanupSame(checked,plan))fail('清理回复与已确认范围不一致。');
    }catch{throw new BoardError('永久移除请求已发送，但回复无法核对；请刷新检查结果，勿直接重复提交。',0,'protocol');}
    return {cleaned:true,removeRevisions:plan.removeRevisions,reclaimPayloadBytes:plan.reclaimPayloadBytes};
  }
  async restore(selected){
    if(selected?.source!=='trash'||!validETag(selected.expected))fail('请先重新查看回收站中的具体白板。');
    const boardKey=key(selected.key),space=await this.access();if(space.role==='viewer')throw new BoardError('当前只有阅读权限，未执行恢复。',403,'readonly');
    const current=(await this.trash()).find(row=>row.id===boardKey);
    if(!current||current.etag!==selected.expected)throw new BoardError('回收站版本已经改变，未执行恢复；请重新核对。',409,'changed');
    const result=await this.#request(this.base+'boards/'+boardKey+'/restore','POST',selected.expected);
    if(result.value?.restored!==true||result.value.id!==boardKey||!validETag(result.etag)||result.etag===selected.expected)
      throw new BoardError('恢复请求已发送，但回复无法核对；请先刷新检查，勿直接重试。',0,'protocol',{mayHaveRestored:true});
    try{
      await this.access();const active=await this.#read(this.base+'boards/'+boardKey);
      const verified=active.etag===result.etag&&raw(active.value)===selected.raw;
      return {restored:true,verified,key:boardKey};
    }catch(error){throw new BoardError('服务器已接受恢复，但之后未能核对原账号的白板状态；请在新页面检查。',error.status,error.code,{mayHaveRestored:true,accepted:true});}
  }
}
