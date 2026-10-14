import {bytesLabel,mediaElement,stopMedia,canPreviewHTML,htmlPreviewFrame} from './board-media.js';
import {BoardMetadata} from './board-metadata.js';
import {BoardFolders} from './board-folders.js';

const $=id=>document.getElementById(id);
const text=(tag,value,className)=>{const item=document.createElement(tag);item.textContent=value;if(className)item.className=className;return item;};

export class BoardLibrary {
  #query=''; #matches=new Map();
  #api; #insert; #metadata; #folders; #read=false; #edit=false; #epoch=0; #previewEpoch=0; #refreshing=false; #referencesEpoch=0; #checkingReferences=false; #scope; #selected=null; #file=null; #uploading=false; #uncertain=false; #next=null; #items=new Map(); #singleLimit=Infinity;
  constructor(api,insert,scope){
    this.#api=api;this.#insert=insert;this.#scope=Object.freeze({...scope});
    this.#folders=new BoardFolders(api,scope,catalog=>this.catalogSaved(catalog));
    this.#metadata=new BoardMetadata(api,scope,asset=>{
      this.#items.set(asset.id,asset);
      this.#matches.delete(asset.id);
      const button=[...$('mediaItems').children].find(row=>row.dataset.asset===asset.id);
      if(button){button.querySelector('strong').textContent=asset.title||asset.filename;button.querySelector('.media-item-caption').textContent=bytesLabel(asset.size)+' · '+(asset.folder||'根目录');button.querySelector('.media-search-match')?.remove();}
      if(this.#query)$('mediaMessage').textContent='素材说明已改变，请刷新核对查找结果。';
      if(this.#selected?.id===asset.id){this.#selected=asset;this.caption(asset);}
    });
    $('editMetadata').onclick=()=>{if(this.#selected)this.#metadata.open(this.#selected.id);};
    $('showMedia').onclick=()=>this.open();$('closeMedia').onclick=()=>this.close();
    $('mediaDialog').addEventListener('cancel',event=>{event.preventDefault();this.close();});
    $('mediaDialog').addEventListener('close',()=>{if(!$('mediaDialog').open)this.clearMedia();});
    $('findMediaReferences').onclick=()=>this.references();
    $('hideMediaReferences').onclick=()=>{this.clearReferences();$('findMediaReferences').focus({preventScroll:true});};
    $('refreshMedia').onclick=()=>this.refresh();$('moreMedia').onclick=()=>this.refresh(true);
    $('mediaSearchForm').onsubmit=event=>{event.preventDefault();this.find();};
    $('clearMediaSearch').onclick=()=>this.clearSearch();
    $('mediaSearch').addEventListener('focus',()=>{if($('mediaDialog').open)$('mediaSearch').scrollIntoView({block:'nearest'});});
    $('mediaSearch').addEventListener('search',()=>{if(!$('mediaSearch').value)this.clearSearch();});
    $('mediaSearch').addEventListener('keydown',event=>{if(event.key==='Escape'&&($('mediaSearch').value||this.#query)){event.preventDefault();event.stopPropagation();this.clearSearch();}});
    $('mediaFile').onchange=()=>this.choose($('mediaFile').files[0]);
    $('uploadMedia').onclick=()=>this.upload();$('cancelUpload').onclick=()=>this.#api.cancel();
    $('insertMedia').onclick=()=>this.insert();
    const drop=$('mediaDrop');drop.ondragover=event=>{event.preventDefault();if(this.#edit&&!this.#uploading)drop.dataset.over='true';};
    drop.ondragleave=()=>{delete drop.dataset.over;};
    drop.ondrop=event=>{event.preventDefault();delete drop.dataset.over;if(this.#edit&&!this.#uploading){
      if(event.dataTransfer.files.length!==1){$('uploadState').textContent='每次选择一个文件，确认后再继续。';return;}
      this.choose(event.dataTransfer.files[0]);
    }};
  }
  sync(read,edit){
    const stopped=this.#read&&!read,withdrawn=this.#edit&&!edit;
    this.#read=read;this.#edit=edit;
    this.#metadata.sync(read,edit);
    this.#folders.sync(read,edit);
    if(stopped){
      this.#epoch++;this.#previewEpoch++;this.#refreshing=false;this.clearReferences();this.#items.clear();this.#matches.clear();this.#selected=null;
      stopMedia($('mediaDialog'));$('mediaPreview').replaceChildren();$('mediaItems').replaceChildren();
      $('mediaDetails').hidden=true;$('mediaMessage').textContent='素材访问已暂停，请在新页面核对登录与权限。';
    }
    if(stopped||withdrawn){this.#api.cancel();if(this.#uploading)this.#uncertain=true;}
    this.controls();
  }
  clearMedia(){this.#epoch++;this.#previewEpoch++;this.#refreshing=false;this.clearReferences();stopMedia($('mediaPreview'));$('mediaPreview').replaceChildren();}
  close(){this.clearMedia();$('mediaDialog').close();}
  controls(){
    $('mediaSearch').disabled=$('searchMedia').disabled=$('clearMediaSearch').disabled=!this.#read;
    $('showMedia').disabled=!this.#read;$('refreshMedia').disabled=!this.#read||this.#refreshing;$('moreMedia').disabled=!this.#read||this.#refreshing;
    $('mediaItems').setAttribute('aria-busy',String(this.#refreshing));
    for(const button of $('mediaItems').children)button.disabled=!this.#read||this.#refreshing;
    $('mediaFile').disabled=$('uploadFolder').disabled=!this.#edit||this.#uploading||this.#refreshing;
    $('uploadMedia').disabled=!this.#edit||!this.#file||this.#uploading||this.#refreshing;
    $('cancelUpload').hidden=!this.#uploading;
    $('insertMedia').disabled=!this.#edit||!this.#selected||this.#refreshing;
    $('findMediaReferences').disabled=!this.#read||!this.#selected||this.#checkingReferences||this.#refreshing;
    $('moreMedia').hidden=!this.#next;
    $('mediaReadOnly').hidden=this.#edit;
  }
  choose(file){
    if(!file||!this.#edit||this.#uploading||this.#refreshing)return;
    this.#file=file;this.#uncertain=false;
    $('chosenMedia').textContent=file.name+' · '+bytesLabel(file.size);
    $('uploadState').textContent='文件仍在你的设备；确认上传后才会进入这个工作区。';$('uploadProgress').hidden=true;this.controls();
  }
  catalogSaved(catalog){
    const oldFolder=$('uploadFolder').value,entries=Object.entries(catalog.folderIds),names=new Map(entries.map(([name,id])=>[id,name]));
    $('uploadFolder').replaceChildren(new Option('资料库根目录',''));
    for(const [name,id] of entries)$('uploadFolder').append(new Option(name,id));
    if(oldFolder&&!names.has(oldFolder)){const option=new Option('原位置已不存在（请重新选择）',oldFolder);option.disabled=true;$('uploadFolder').append(option);}
    $('uploadFolder').value=oldFolder;
    for(const [id,old] of this.#items){
      const asset=this.#api.asset({...old,folder:old.folderId?(names.get(old.folderId)||old.folder):''});this.#items.set(id,asset);
      const button=[...$('mediaItems').children].find(row=>row.dataset.asset===id);
      if(button)button.querySelector('.media-item-caption').textContent=bytesLabel(asset.size)+' · '+(asset.folder||'根目录');
      if(this.#selected?.id===id){this.#selected=asset;this.caption(asset);}
    }
    // Update captions in place; a directory rename does not interrupt playback.
  }
  async open(){
    if(!this.#read)return;
    $('mediaDialog').showModal();await this.refresh();
  }
  find(){
    if(!this.#read)return;
    if(document.activeElement===$('mediaSearch'))$('mediaSearch').scrollIntoView({block:'nearest'});
    const query=$('mediaSearch').value.trim();
    if(query&&([...query].length>120||/[\p{Cc}\p{Cs}]/u.test(query))){$('mediaMessage').textContent='查找词须为1至120个字符，不含换行或控制字符。';return;}
    if(this.#refreshing&&query===this.#query)return;
    // A new submitted query supersedes the earlier read, including its errors.
    this.#epoch++;this.#refreshing=false;this.#query=query;this.refresh();
  }
  clearSearch(){
    if(!this.#read)return;
    $('mediaSearch').value='';$('mediaSearch').focus({preventScroll:true});
    this.#epoch++;this.#refreshing=false;this.#query='';this.refresh();
  }
  async refresh(more=false){
    if(!this.#read||this.#refreshing)return;const epoch=++this.#epoch;
    const query=this.#query,oldSelection=this.#selected;if(more&&query)return;
    $('mediaItems').dataset.search=String(Boolean(query));
    const oldFolder=$('uploadFolder').value,cursor=more?this.#next:null;
    if(more&&!cursor)return;
    this.#refreshing=true;this.clearReferences();this.controls();
    $('mediaMessage').textContent=query?'正在查找“'+query+'”…':'正在读取这个工作区的素材…';
    if(!more){this.#next=null;this.#matches.clear();this.#items.clear();$('mediaItems').replaceChildren();stopMedia($('mediaPreview'));$('mediaPreview').replaceChildren();this.#selected=null;$('mediaDetails').hidden=true;this.controls();}
    try{
      await this.#api.access();
      const [reply,folders,quota]=await Promise.all([query?this.#api.search(query):this.#api.list(cursor),this.#api.folders(),this.#api.quota()]);
      const list=query?{items:reply.items.map(row=>row.asset),next:null}:reply;
      await this.#api.access();if(epoch!==this.#epoch||!this.#read)return;
      if(!more){this.#items.clear();$('mediaItems').replaceChildren();}
      if(query)for(const row of reply.items)this.#matches.set(row.asset.id,row);
      for(const asset of list.items)this.#items.set(asset.id,asset);
      this.#next=list.next;this.drawList();
      this.#singleLimit=quota.singleUploadLimitBytes;
      $('uploadFolder').replaceChildren(new Option('资料库根目录',''));
      for(const folder of folders)$('uploadFolder').append(new Option(folder.name,folder.id));
      // A disappeared stable folder stays selected as missing, never becomes root.
      if(oldFolder&&![...$('uploadFolder').options].some(option=>option.value===oldFolder)){
        const option=new Option('原位置已不存在（请重新选择）',oldFolder);option.disabled=true;$('uploadFolder').append(option);
      }
      $('uploadFolder').value=oldFolder;
      $('mediaQuota').textContent=`此工作区 ${bytesLabel(quota.workspaceBytes)} / ${bytesLabel(quota.workspaceLimitBytes)}`+
        (quota.workspacePendingBytes?` · 另有 ${bytesLabel(quota.workspacePendingBytes)} 待确认`:'')+` · 单文件上限 ${bytesLabel(quota.singleUploadLimitBytes)}`;
      $('mediaMessage').textContent=query?'“'+query+'” · '+this.#items.size+' 个结果'+(reply.coverage==='limited'?' · 本次只检查了部分素材；没有结果也不代表不存在。清除查找后仍可继续翻看列表。':this.#items.size?' · 点击查看原素材':' · 可以换个线索，或清除查找'):
        this.#items.size?this.#items.size+' 个素材已显示'+(this.#next?' · 可继续加载':''):'这里还没有素材，放入自己的文件即可开始。';
      if(!more)this.#selected=oldSelection;
      if(this.#selected){
        const asset=this.#items.get(this.#selected.id);
        if(asset)this.select(asset,false);else{stopMedia($('mediaPreview'));$('mediaPreview').replaceChildren();this.#selected=null;$('mediaDetails').hidden=true;}
      }
      this.controls();
    }catch(error){if(epoch===this.#epoch)$('mediaMessage').textContent=error.message;}
    finally{if(epoch===this.#epoch){this.#refreshing=false;this.controls();}}
  }
  drawList(){
    $('mediaItems').replaceChildren();
    for(const asset of this.#items.values()){
      const button=text('button','', 'media-item');button.dataset.asset=asset.id;
      button.setAttribute('aria-pressed',String(this.#selected?.id===asset.id));
      button.append(text('span',({image:'▧',audio:'♫',video:'▷',attachment:'↧'})[asset.kind],'media-symbol'),
        text('strong',asset.title||asset.filename),text('span',bytesLabel(asset.size)+' · '+(asset.folder||'根目录'),'media-item-caption'));
      const match=this.#matches.get(asset.id);if(match)button.append(text('span',match.context+' · '+match.excerpt,'media-search-match'));
      button.disabled=!this.#read||this.#refreshing;button.onclick=()=>{if(!this.#refreshing)this.select(asset);};$('mediaItems').append(button);
    }
  }
  select(asset,reveal=true){
    this.#previewEpoch++;
    this.clearReferences();
    this.#selected=asset;stopMedia($('mediaPreview'));$('mediaPreview').replaceChildren();$('mediaPreview').dataset.kind=asset.kind;$('mediaDetails').hidden=false;
    this.caption(asset);
    const html=canPreviewHTML(asset),preview=text('button',html?'查看HTML静态排版':asset.kind==='attachment'?'此文件只提供下载':'打开'+({image:'图片',audio:'音频',video:'视频'})[asset.kind]);
    preview.disabled=asset.kind==='attachment'&&!html;preview.onclick=()=>this.preview(asset);$('mediaPreview').append(preview);
    $('downloadMedia').href=asset.mediaURL;$('downloadMedia').download=asset.filename;
    $('downloadMedia').onclick=async event=>{
      event.preventDefault();const epoch=this.#epoch;
      try{await this.#api.access();await this.#api.read(asset.id);if(epoch!==this.#epoch||!this.#read)return;
        const link=document.createElement('a');link.href=this.#api.url(asset.id);link.download=asset.filename;document.body.append(link);link.click();link.remove();
      }catch(error){$('mediaMessage').textContent=error.message;}
    };
    for(const button of $('mediaItems').children)button.setAttribute('aria-pressed',String(button.dataset.asset===asset.id));
    this.controls();if(reveal)$('mediaDetails').scrollIntoView({block:'nearest'});
  }
  caption(asset){
    $('mediaTitle').textContent=asset.title||asset.filename;$('mediaInfo').textContent=asset.mime+' · '+bytesLabel(asset.size);
    $('mediaNotes').textContent=asset.notes||'';$('mediaTags').replaceChildren(...asset.tags.map(tag=>text('span',tag,'tag')));
  }
  clearReferences(){
    this.#referencesEpoch++;this.#checkingReferences=false;$('mediaReferences').hidden=true;
    $('findMediaReferences').setAttribute('aria-expanded','false');$('findMediaReferences').textContent='查找关联';
    $('mediaReferenceRows').replaceChildren();$('mediaReferenceCounts').replaceChildren();$('mediaReferenceState').textContent='';this.controls();
  }
  async references(){
    if(!this.#read||!this.#selected||this.#checkingReferences)return;
    const asset=this.#selected,epoch=++this.#referencesEpoch;
    this.#checkingReferences=true;$('mediaReferences').hidden=false;$('mediaReferenceTarget').textContent=asset.title||asset.filename;
    $('findMediaReferences').setAttribute('aria-expanded','true');$('findMediaReferences').textContent='重新检查关联';
    $('mediaReferenceRows').replaceChildren();$('mediaReferenceCounts').replaceChildren();
    $('mediaReferenceState').textContent='正在检查原工作区中可查看的保存记录…';this.controls();
    try{
      const result=await this.#api.references(asset.id);
      if(epoch!==this.#referencesEpoch||!this.#read||this.#selected?.id!==asset.id||!$('mediaDialog').open)return;
      const labels={board:'现有白板',trash:'回收站',catalog:'现有目录',history:'白板历史',catalogHistory:'目录历史',draft:'我的待恢复稿'};
      for(const [key,name] of Object.entries(labels))if(result.counts[key]){
        const count=text('div','','media-reference-count');count.append(text('strong',String(result.counts[key])),text('span',name));$('mediaReferenceCounts').append(count);
      }
      const total=Object.values(result.counts).reduce((a,b)=>a+b,0);
      $('mediaReferenceState').textContent=(total?`找到 ${total} 条关联记录；同一记录出现多次只算一次。`:'这次检查的保存记录中没有找到素材编号。')+
        (result.coverage==='limited'?' 内容较多，本次只检查了一部分。':'')+(result.hiddenResults?` 还有 ${result.hiddenResults} 条关联没有展开。`:'')+
        ` 已检查 ${result.scannedRecords} 份记录 · ${new Date(result.checkedAt*1000).toLocaleTimeString('zh-CN')}。`;
      for(const row of result.items){
        const item=text('li','','media-reference-row'),info=text('div','','media-reference-info');
        info.append(text('strong',row.name||({folders:'白板目录',library:'资料库目录'})[row.kind]||row.key),
          text('span',labels[row.category]+(row.revision?' · 版本 '+row.revision:'')+' · '+new Date(row.savedAt*1000).toLocaleString('zh-CN')),
          text('span',row.match==='direct'?'明确的素材引用':'内容中出现编号 · 可能只是文字记录','media-reference-match'));
        item.append(info);
        if(row.category==='board'){
          const link=text('a','新页打开白板 ↗');link.href=`/w/${this.#scope.workspace}/b/${row.key}/`;link.target='_blank';link.rel='noopener noreferrer';
          link.addEventListener('click',async event=>{event.preventDefault();const target=link.href;
            // Opening a blank tab synchronously avoids popup blocking; it gets
            // no workspace data until original-account access is rechecked.
            const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;
            try{await this.#api.access();await this.#api.read(asset.id);
              if(epoch!==this.#referencesEpoch||!this.#read||this.#selected?.id!==asset.id){tab?.close();return;}
              if(tab)tab.location.replace(target);else $('mediaReferenceState').textContent='浏览器未打开新页；请允许弹出窗口后再试，当前输入仍保留。';
            }catch(error){tab?.close();if(epoch===this.#referencesEpoch)$('mediaReferenceState').textContent=error.message;}
          });item.append(link);
        }
        $('mediaReferenceRows').append(item);
      }
      $('mediaReferences').scrollIntoView({block:'start'});
    }catch(error){if(epoch===this.#referencesEpoch)$('mediaReferenceState').textContent=error.message;}
    finally{if(epoch===this.#referencesEpoch){this.#checkingReferences=false;this.controls();}}
  }
  async preview(asset){
    const epoch=this.#epoch,token=++this.#previewEpoch;
    const valid=()=>epoch===this.#epoch&&token===this.#previewEpoch&&this.#read&&this.#selected?.id===asset.id&&$('mediaDialog').open;
    stopMedia($('mediaPreview'));$('mediaPreview').textContent='正在核对素材…';
    try{
      await this.#api.access();const current=await this.#api.read(asset.id);
      if(!valid())return;
      if(canPreviewHTML(current)){
        const plan=await this.#api.htmlPreview(current);if(!valid())return;
        const frame=htmlPreviewFrame(plan,current.title||current.filename,()=>{if(valid())this.close();}),hint=text('p','静态排版预览。'+(plan.omittedMarkup?'部分内容已略过，':'')+'交互、链接与外部资源不会运行；原文件保留，可下载完整查看。','static-html-caption');
        frame.onload=async()=>{if(!valid())return;try{await this.#api.access();const fresh=await this.#api.read(current.id);
          if(!valid())return;if(fresh.contentHash!==plan.contentHash)throw Error('原文件已改变，请重新核对预览。');
        }catch(error){if(valid()){this.#previewEpoch++;stopMedia($('mediaPreview'));$('mediaPreview').textContent=error.message;}}};
        frame.onerror=()=>{if(valid()){this.#previewEpoch++;stopMedia($('mediaPreview'));$('mediaPreview').textContent='静态排版暂时无法显示，仍可下载原文件。';}};
        $('mediaPreview').dataset.kind='html';$('mediaPreview').replaceChildren(hint,frame);frame.src=plan.url;
        hint.scrollIntoView({block:'start'});frame.focus({preventScroll:true});return;
      }
      const item=mediaElement(current);$('mediaPreview').replaceChildren();if(item){item.onerror=()=>$('mediaMessage').textContent='浏览器无法显示这个媒体，仍可下载原文件。';$('mediaPreview').append(item);item.focus({preventScroll:true});}
    }catch(error){if(valid())$('mediaPreview').textContent=error.message;}
  }
  async upload(){
    if(!this.#edit||!this.#file||this.#uploading||this.#refreshing)return;
    if(this.#file.size>this.#singleLimit){$('uploadState').textContent='这个文件超过单文件上限 '+bytesLabel(this.#singleLimit)+'，尚未发送；原文件仍在页面。';return;}
    if(this.#uncertain&&!confirm('上次上传未确认，请先刷新列表检查。仍要把这份文件再上传一次吗？可能出现重复素材。'))return;
    const file=this.#file,folder=$('uploadFolder').value;
    if($('uploadFolder').selectedOptions[0]?.disabled){$('uploadState').textContent='原位置已不存在，请明确选择新的存放位置。';return;}
    this.#uploading=true;$('uploadProgress').hidden=false;$('uploadProgress').value=0;
    $('uploadState').textContent='正在核对原账号和上传位置…';this.controls();
    try{
      const asset=await this.#api.upload(file,folder,fraction=>{
        if(!this.#read)return;
        if(fraction!==null){$('uploadProgress').value=fraction*100;$('uploadState').textContent=fraction>=1?'文件已发送，正在等待服务器确认…':'正在发送 '+Math.floor(fraction*100)+'%';}
      });
      if(!this.#read||!this.#edit){this.#uncertain=true;$('uploadState').textContent='原文件仍保留，请在原账号工作区的新页面检查上传结果。';return;}
      this.#uncertain=false;$('uploadState').textContent='上传已确认 · '+asset.filename+'；选择“放到白板”后才会添加内容。';
      await this.refresh();if(this.#read)this.select(asset);
    }catch(error){this.#uncertain=error.code==='upload_uncertain'||error.code==='account_changed';$('uploadState').textContent=error.message;}
    finally{this.#uploading=false;this.controls();}
  }
  async insert(){
    if(!this.#edit||!this.#selected||this.#refreshing)return;const asset=this.#selected,epoch=this.#epoch;
    $('insertMedia').disabled=true;
    try{await this.#api.access(true);const current=await this.#api.read(asset.id);
      if(epoch!==this.#epoch||!this.#edit)return;this.#insert(current);this.close();
    }catch(error){$('mediaMessage').textContent=error.message;}
    finally{this.controls();}
  }
  get pending(){return this.#uploading||this.#metadata.pending||this.#folders.pending;}
}
