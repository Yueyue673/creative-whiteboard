import {bytesLabel,mediaElement,stopMedia,canPreviewHTML,htmlPreviewFrame} from './board-media.js';
import {BoardMetadata} from './board-metadata.js';
import {BoardFolders} from './board-folders.js';

const $=id=>document.getElementById(id);
const text=(tag,value,className)=>{const item=document.createElement(tag);item.textContent=value;if(className)item.className=className;return item;};

export class BoardLibrary {
  #query=''; #matches=new Map(); #selectionReady=false; #listReady=false; #archived=false; #changingShelf=false; #shelfUncertain=null;
  #api; #insert; #metadata; #folders; #read=false; #edit=false; #epoch=0; #previewEpoch=0; #refreshing=false; #referencesEpoch=0; #checkingReferences=false; #scope; #selected=null; #file=null; #uploaded=null; #uploading=false; #uncertain=false; #next=null; #items=new Map(); #singleLimit=Infinity;
  #navigation; #place=null; #active=false;
  constructor(api,insert,scope,navigation={}){
    this.#navigation=navigation;
    this.#api=api;this.#insert=insert;this.#scope=Object.freeze({...scope});
    this.#folders=new BoardFolders(api,scope,catalog=>this.catalogSaved(catalog));
    this.#metadata=new BoardMetadata(api,scope,asset=>{
      if(Boolean(asset.archived)!==this.#archived)this.#items.delete(asset.id);
      else if(this.#items.has(asset.id))this.#items.set(asset.id,asset);
      this.#matches.delete(asset.id);
      const button=[...$('mediaItems').children].find(row=>row.dataset.asset===asset.id);
      if(button){
        if(Boolean(asset.archived)!==this.#archived)button.remove();
        else{button.querySelector('strong').textContent=asset.title||asset.filename;button.querySelector('.media-item-caption').textContent=bytesLabel(asset.size)+' · '+(asset.folder||'根目录');button.querySelector('.media-search-match')?.remove();}
      }
      if(this.#query)$('mediaMessage').textContent='素材说明已改变，请刷新核对查找结果。';
      if(this.#selected?.id===asset.id){this.#selected=asset;this.caption(asset);}this.controls();
    });
    $('editMetadata').onclick=()=>{if(this.#read&&this.#selectionReady&&!this.#refreshing&&!this.#changingShelf&&$('mediaDialog').open&&this.#selected)this.#metadata.open(this.#selected.id);};
    $('showMedia').onclick=()=>this.open();$('closeMedia').onclick=()=>this.close();
    $('mediaDialog').addEventListener('cancel',event=>{event.preventDefault();this.close();});
    $('mediaDialog').addEventListener('close',()=>{if(!$('mediaDialog').open&&this.#active)this.finishClose();});
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
    $('clearChosenMedia').onclick=()=>this.clearFile();
    $('insertMedia').onclick=()=>this.insert();
    $('activeMedia').onclick=()=>this.shelf(false);$('archivedMedia').onclick=()=>this.shelf(true);
    $('archiveMedia').onclick=()=>this.changeShelf();
    $('backToMediaList').onclick=()=>this.backToList();
    $('metadataDialog').addEventListener('close',()=>this.controls());
    const drop=$('mediaDrop');drop.ondragover=event=>{event.preventDefault();if(this.#edit&&!this.#uploading)drop.dataset.over='true';};
    drop.ondragleave=()=>{delete drop.dataset.over;};
    drop.ondrop=event=>{event.preventDefault();delete drop.dataset.over;if(this.#edit&&!this.#uploading){
      if(event.dataTransfer.files.length!==1){$('uploadState').textContent='每次选择一个文件，确认后再继续。';return;}
      this.choose(event.dataTransfer.files[0],event.dataTransfer.files);
    }};
    // A file dropped on the closed importer or preview must never navigate
    // away from the author's page. Choosing a file still does not upload it.
    $('mediaDialog').ondragover=event=>{if([...event.dataTransfer?.types||[]].includes('Files'))event.preventDefault();};
    $('mediaDialog').ondrop=event=>{
      if(![...event.dataTransfer?.types||[]].includes('Files')||event.defaultPrevented)return;
      event.preventDefault();
      if(!this.#edit||this.#uploading){$('mediaMessage').textContent=this.#uploading?'正在等待本次上传确认，所选文件保持不变。':'当前只有阅读权限，文件没有上传。';return;}
      if(!$('mediaDialog').open)return;
      $('mediaImport').open=true;
      if(event.dataTransfer.files.length!==1)$('uploadState').textContent='每次选择一个文件，确认后再继续。';
      else this.choose(event.dataTransfer.files[0],event.dataTransfer.files);
      $('mediaImport').scrollIntoView({block:'nearest'});
    };
  }
  sync(read,edit){
    const stopped=this.#read&&!read,withdrawn=this.#edit&&!edit;
    this.#read=read;this.#edit=edit;
    this.#metadata.sync(read,edit);
    this.#folders.sync(read,edit);
    if(stopped){
      this.#epoch++;this.#previewEpoch++;this.#refreshing=false;this.#selectionReady=false;this.#listReady=false;this.clearReferences();this.#items.clear();this.#matches.clear();this.#selected=null;
      stopMedia($('mediaDialog'));$('mediaPreview').replaceChildren();$('mediaItems').replaceChildren();
      $('mediaDetails').hidden=true;$('mediaMessage').textContent='素材访问已暂停，请在新页面核对登录与权限。';
    }
    if(stopped||withdrawn){this.#api.cancel();if(this.#uploading)this.#uncertain=true;}
    this.controls();
  }
  clearMedia(){this.#epoch++;this.#previewEpoch++;this.#refreshing=false;this.#selectionReady=false;this.clearReferences();stopMedia($('mediaPreview'));$('mediaPreview').replaceChildren();}
  finishClose(){
    if(!this.#active)return;this.#active=false;this.clearMedia();
    const place=this.#place;this.#place=null;if(place)this.#navigation.restore?.(place);this.#navigation.afterClose?.();
  }
  close(){if(!$('mediaDialog').open)return;$('mediaDialog').close();this.finishClose();}
  controls(){
    $('mediaImport').hidden=!this.#edit;
    $('mediaImportLabel').title=this.#file?.name||'';
    $('mediaImportLabel').textContent=this.#file?(this.#uploaded===this.#file?'已上传 · ':'已选文件 · ')+this.#file.name:'放入自己的文件';
    for(const [id,archived] of [['activeMedia',false],['archivedMedia',true]]){
      $(id).disabled=!this.#read||this.#changingShelf;$(id).setAttribute('aria-pressed',String(this.#archived===archived));
    }
    $('mediaSearch').disabled=$('searchMedia').disabled=$('clearMediaSearch').disabled=!this.#read;
    $('showMedia').disabled=!this.#read;$('refreshMedia').disabled=!this.#read||this.#refreshing;$('moreMedia').disabled=!this.#read||this.#refreshing;
    $('mediaItems').setAttribute('aria-busy',String(this.#refreshing));
    for(const button of $('mediaItems').children)button.disabled=!this.#read||this.#refreshing||this.#changingShelf||!this.#listReady;
    $('mediaFile').disabled=$('uploadFolder').disabled=!this.#edit||this.#uploading||this.#refreshing;
    $('uploadMedia').disabled=!this.#edit||!this.#file||this.#uploaded===this.#file||this.#uploading||this.#refreshing;
    $('uploadMedia').textContent=this.#file&&this.#uploaded===this.#file?'已上传':'确认上传';
    $('clearChosenMedia').hidden=!this.#file;$('clearChosenMedia').disabled=this.#uploading;
    $('cancelUpload').hidden=!this.#uploading;
    const unavailable=!this.#read||!this.#selected||!this.#selectionReady||this.#refreshing;
    $('insertMedia').disabled=!this.#edit||unavailable||this.#selected?.archived===true||this.#changingShelf||this.#shelfUncertain===this.#selected?.id;
    $('archiveMedia').disabled=!this.#edit||unavailable||this.#changingShelf||this.#shelfUncertain===this.#selected?.id||this.#metadata.pending;
    $('archiveMedia').textContent=this.#changingShelf?'正在确认…':this.#selected?.archived?'恢复到素材库':'收起这份素材';
    $('mediaShelfState').textContent=this.#shelfUncertain===this.#selected?.id?'上次操作尚未核对；请刷新后查看结果，不会自动重试。':this.#metadata.pending?'还有未完成的素材说明，请先保存或放弃这页修改，再收起或恢复。':this.#selected?.archived?'已收起，原文件、原位置和已有白板引用仍保留；恢复后可以再次放到白板。':'收起只整理素材列表，原文件与已有白板引用仍保留，也仍计入用量。';
    $('editMetadata').disabled=unavailable||this.#changingShelf;
    $('downloadMedia').setAttribute('aria-disabled',String(unavailable));
    for(const button of $('mediaPreview').querySelectorAll('button'))button.disabled=unavailable||button.dataset.unavailable==='true';
    $('findMediaReferences').disabled=unavailable||this.#checkingReferences;
    $('moreMedia').hidden=!this.#next;
    $('mediaReadOnly').hidden=this.#edit;
  }
  choose(file,files=null){
    if(!file||!this.#edit||this.#uploading||!$('mediaDialog').open)return;
    this.#file=file;this.#uploaded=null;this.#uncertain=false;
    if(files){try{$('mediaFile').files=files;}catch{$('mediaFile').value='';}}
    $('chosenMedia').textContent=file.name+' · '+bytesLabel(file.size);
    $('uploadState').textContent='文件仍在你的设备；确认上传后才会进入这个工作区。';$('uploadProgress').hidden=true;this.controls();
  }
  clearFile(){
    if(this.#uploading||!this.#file||!$('mediaDialog').open)return;
    const uncertain=this.#uncertain;
    this.#file=null;this.#uploaded=null;this.#uncertain=false;
    $('mediaFile').value='';$('chosenMedia').textContent='';$('uploadProgress').hidden=true;
    $('uploadState').textContent=uncertain?'已清除本页文件选择；上次上传结果仍未确认，请刷新列表核对。设备原件和已上传素材均未删除。':'已清除本页文件选择；设备原件和已上传素材均未删除。';
    this.controls();$('mediaFile').focus({preventScroll:true});
  }
  backToList(){
    if(!this.#read||!$('mediaDialog').open)return;
    const item=[...$('mediaItems').children].find(row=>row.dataset.asset===this.#selected?.id&&!row.disabled);
    $('mediaSearch').closest('.media-browser')?.scrollIntoView({block:'start'});
    const target=item||$('mediaSearch');target.scrollIntoView({block:'nearest'});target.focus({preventScroll:true});
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
    if(!this.#read||$('mediaDialog').open)return;
    this.#place=this.#navigation.capture?.()??null;this.#active=true;
    $('mediaDialog').showModal();await this.refresh();
  }
  shelf(archived){
    if(!this.#read||this.#changingShelf||!$('mediaDialog').open||archived===this.#archived)return;
    this.#archived=archived;this.#epoch++;this.#refreshing=false;this.#listReady=false;this.#next=null;
    this.refresh();
  }
  async changeShelf(){
    if(!this.#read||!this.#edit||!this.#selectionReady||!this.#selected||this.#refreshing||this.#changingShelf||this.#metadata.pending||!$('mediaDialog').open||this.#shelfUncertain===this.#selected.id)return;
    const original=this.#selected,epoch=this.#epoch,archived=!original.archived;
    this.#changingShelf=true;this.#shelfUncertain=original.id;this.controls();
    try{
      await this.#api.access(true);
      const current=await this.#api.update(original.id,{archived},original.etag);
      if(current.archived!==archived)throw Error('素材状态无法核对，请刷新查看结果。');
      this.#shelfUncertain=null;
      if(epoch!==this.#epoch||!this.#read||this.#selected?.id!==original.id||!$('mediaDialog').open)return;
      this.#selected=current;await this.refresh();
    }catch(error){
      if(epoch===this.#epoch&&this.#read&&$('mediaDialog').open){$('mediaMessage').textContent=error.message;this.controls();}
    }finally{this.#changingShelf=false;this.controls();}
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
    if(oldSelection)$('mediaSelectionState').textContent='正在核对当前预览…';
    $('mediaMessage').textContent=query?'正在查找“'+query+'”…':'正在读取这个工作区的素材…';
    try{
      await this.#api.access();
      // A filtered page is not an absence check. Recheck the selected original
      // separately, in the same fixed account/workspace, before enabling actions.
      const [reply,folders,quota,current]=await Promise.all([query?this.#api.search(query,this.#archived):this.#api.list(cursor,this.#archived),this.#api.folders(),this.#api.quota(),
        oldSelection?this.#api.read(oldSelection.id).catch(error=>{if(error.status===404)return null;throw error;}):null]);
      const list=query?{items:reply.items.map(row=>row.asset),next:null}:reply;
      await this.#api.access();if(epoch!==this.#epoch||!this.#read)return;
      if(!more){this.#items.clear();this.#matches.clear();}
      if(query)for(const row of reply.items)this.#matches.set(row.asset.id,row);
      for(const asset of list.items)this.#items.set(asset.id,asset);
      if(current&&this.#items.has(current.id)){
        if(Boolean(current.archived)===this.#archived)this.#items.set(current.id,current);
        else{this.#items.delete(current.id);this.#matches.delete(current.id);}
      }
      if(current?.id===this.#shelfUncertain)this.#shelfUncertain=null;
      if(oldSelection&&!current){this.#items.delete(oldSelection.id);this.#matches.delete(oldSelection.id);}
      this.#listReady=true;this.#next=list.next;this.drawList();
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
        this.#items.size?this.#items.size+' 个'+(this.#archived?'已收起的':'')+'素材已显示'+(this.#next?' · 可继续加载':''):this.#archived?'还没有收起的素材。收起后可在这里查看并恢复。':'这里还没有素材，放入自己的文件即可开始。';
      this.#refreshing=false;
      if(current)this.select(current,false);
      else if(oldSelection){
        this.#previewEpoch++;stopMedia($('mediaPreview'));$('mediaPreview').replaceChildren();this.#selected=null;this.#selectionReady=false;$('mediaDetails').hidden=true;
        $('mediaMessage').textContent+=' · 原预览素材已无法读取，请重新选择。';
      }
      this.controls();
    }catch(error){if(epoch===this.#epoch){
      if([401,403].includes(error.status)||error.code==='account_changed')this.sync(false,false);
      else{
        this.#selectionReady=false;this.#listReady=false;this.#previewEpoch++;
        // Keep the user's place and prior result list, but do not continue an
        // unconfirmed player or fetch from an unconfirmed preview control.
        for(const player of $('mediaPreview').querySelectorAll('audio,video'))player.pause();
        if(oldSelection)$('mediaSelectionState').textContent='当前预览未确认；播放已暂停，请刷新核对后继续。';
      }
      $('mediaMessage').textContent=error.message;
    }}
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
      button.disabled=!this.#read||this.#refreshing||this.#changingShelf||!this.#listReady;button.onclick=()=>{if(button.parentElement===$('mediaItems')&&this.#listReady&&!this.#refreshing&&!this.#changingShelf)this.select(asset);};$('mediaItems').append(button);
    }
  }
  select(asset,reveal=true){
    if(!this.#read||!this.#listReady||this.#refreshing||!$('mediaDialog').open)return;
    const old=this.#selected,same=old&&['id','contentHash','size','mime','mediaURL'].every(key=>old[key]===asset[key])&&$('mediaPreview').children.length>0;
    this.clearReferences();
    this.#selected=asset;this.#selectionReady=true;$('mediaDetails').hidden=false;
    this.caption(asset);
    if(!same){
      $('mediaDetails').scrollTop=0;
      this.#previewEpoch++;stopMedia($('mediaPreview'));$('mediaPreview').replaceChildren();$('mediaPreview').dataset.kind=asset.kind;
      const html=canPreviewHTML(asset),preview=text('button',html?'查看HTML静态排版':asset.kind==='attachment'?'此文件只提供下载':'打开'+({image:'图片',audio:'音频',video:'视频'})[asset.kind]);
      preview.dataset.unavailable=String(asset.kind==='attachment'&&!html);preview.onclick=()=>this.preview(this.#selected);$('mediaPreview').append(preview);
    }
    $('downloadMedia').href=asset.mediaURL;$('downloadMedia').download=asset.filename;
    $('downloadMedia').onclick=async event=>{
      event.preventDefault();const epoch=this.#epoch;
      if(!this.#read||!this.#selectionReady||this.#refreshing||!$('mediaDialog').open)return;
      try{await this.#api.access();await this.#api.read(asset.id);if(epoch!==this.#epoch||!this.#read)return;
        const link=document.createElement('a');link.href=this.#api.url(asset.id);link.download=asset.filename;document.body.append(link);link.click();link.remove();
      }catch(error){$('mediaMessage').textContent=error.message;}
    };
    for(const button of $('mediaItems').children)button.setAttribute('aria-pressed',String(button.dataset.asset===asset.id));
    this.controls();if(reveal&&!globalThis.matchMedia?.('(min-width:901px) and (min-height:700px)').matches)$('mediaDetails').scrollIntoView({block:'nearest'});
  }
  caption(asset){
    $('mediaSelectionState').textContent=asset.archived?'当前预览 · 已收起；已有白板引用仍可查看。':this.#items.has(asset.id)?'当前预览':'当前预览 · 不在这页结果中；仍可继续查看和使用。';
    $('mediaTitle').textContent=asset.title||asset.filename;$('mediaInfo').textContent=asset.mime+' · '+bytesLabel(asset.size);
    $('mediaNotes').textContent=asset.notes||'';$('mediaTags').replaceChildren(...asset.tags.map(tag=>text('span',tag,'tag')));
  }
  clearReferences(){
    this.#referencesEpoch++;this.#checkingReferences=false;$('mediaReferences').hidden=true;
    $('findMediaReferences').setAttribute('aria-expanded','false');$('findMediaReferences').textContent='查找关联';
    $('mediaReferenceRows').replaceChildren();$('mediaReferenceCounts').replaceChildren();$('mediaReferenceState').textContent='';this.controls();
  }
  async references(){
    if(!this.#read||!this.#selectionReady||!this.#selected||this.#checkingReferences||this.#refreshing||!$('mediaDialog').open)return;
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
  async preview(asset,resume=null){
    if(!asset||!this.#read||!this.#selectionReady||this.#refreshing||this.#selected?.id!==asset.id||!$('mediaDialog').open)return;
    const token=++this.#previewEpoch;
    const valid=()=>token===this.#previewEpoch&&this.#read&&this.#selectionReady&&this.#selected?.id===asset.id&&$('mediaDialog').open;
    const failed=(message,current=asset,position=null)=>{
      if(!valid())return;
      const root=$('mediaPreview'),restoreFocus=root.contains?.(document.activeElement);this.#previewEpoch++;
      stopMedia(root);root.dataset.kind='error';
      const panel=text('div','','media-preview-failure'),status=text('p',message),retry=text('button','重新核对预览');
      status.setAttribute('role','status');status.setAttribute('aria-live','polite');retry.type='button';
      retry.onclick=()=>{
        // A failed list read may invalidate media callbacks while retaining
        // this exact panel. Fresh selection verification can re-enable it;
        // detached/replaced panels still cannot request another original.
        if(panel.parentElement!==root||!this.#read||!this.#selectionReady||this.#refreshing||this.#selected?.id!==current.id||!$('mediaDialog').open)return;
        this.preview(current,{asset:current,position});
      };
      panel.append(status,retry);root.replaceChildren(panel);this.controls();
      if(restoreFocus)retry.focus({preventScroll:true});
    };
    stopMedia($('mediaPreview'));$('mediaPreview').textContent='正在核对素材…';
    try{
      await this.#api.access();const current=await this.#api.read(asset.id);
      if(!valid())return;
      if(canPreviewHTML(current)){
        const plan=await this.#api.htmlPreview(current);if(!valid())return;
        const frame=htmlPreviewFrame(plan,current.title||current.filename,()=>this.close()),hint=text('p','静态排版预览。'+(plan.omittedMarkup?'部分内容已略过，':'')+'交互、链接与外部资源不会运行；原文件保留，可下载完整查看。','static-html-caption');
        frame.onload=async()=>{if(!valid())return;try{await this.#api.access();const fresh=await this.#api.read(current.id);
          if(!valid())return;if(fresh.contentHash!==plan.contentHash)throw Error('原文件已改变，请重新核对预览。');
        }catch(error){failed(error.message,current);}};
        frame.onerror=()=>failed('静态排版暂时无法显示；可以重新核对，也可下载原文件。',current);
        $('mediaPreview').dataset.kind='html';$('mediaPreview').replaceChildren(hint,frame);frame.src=plan.url;
        hint.scrollIntoView({block:'start'});frame.focus({preventScroll:true});return;
      }
      const item=mediaElement(current);$('mediaPreview').replaceChildren();if(item){
        item.onerror=()=>{if(item.parentElement===$('mediaPreview'))failed('这份媒体暂时无法加载。请检查连接后重新核对；也可下载原文件。',current,Number.isFinite(item.currentTime)?item.currentTime:null);};
        // Restore a listening position only after a fresh read confirms the
        // same original bytes and account-bound source. Playback stays paused.
        if(resume&&Number.isFinite(resume.position)&&resume.position>0&&['id','contentHash','size','mime','mediaURL'].every(key=>resume.asset?.[key]===current[key])){
          item.addEventListener('loadedmetadata',()=>{
            if(valid()&&item.parentElement===$('mediaPreview')&&Number.isFinite(item.duration)&&item.duration>0){try{item.currentTime=Math.min(resume.position,item.duration);}catch{}}
          },{once:true});
        }
        $('mediaPreview').dataset.kind=current.kind;$('mediaPreview').append(item);item.focus({preventScroll:true});
      }
    }catch(error){failed(error.message,resume?.asset||asset,resume?.position??null);}
  }
  async upload(){
    if(!this.#edit||!this.#file||this.#uploaded===this.#file||this.#uploading||this.#refreshing||!$('mediaDialog').open)return;
    if(this.#file.size>this.#singleLimit){$('uploadState').textContent='这个文件超过单文件上限 '+bytesLabel(this.#singleLimit)+'，尚未发送；原文件仍在页面。';return;}
    if(this.#uncertain&&!confirm('上次上传未确认，请先刷新列表检查。仍要把这份文件再上传一次吗？可能出现重复素材。'))return;
    const file=this.#file,folder=$('uploadFolder').value,epoch=this.#epoch,selection=this.#selected;
    if($('uploadFolder').selectedOptions[0]?.disabled){$('uploadState').textContent='原位置已不存在，请明确选择新的存放位置。';return;}
    this.#uploading=true;$('uploadProgress').hidden=false;$('uploadProgress').value=0;
    $('uploadState').textContent='正在核对原账号和上传位置…';this.controls();
    try{
      const asset=await this.#api.upload(file,folder,fraction=>{
        if(!this.#read)return;
        if(fraction!==null){$('uploadProgress').value=fraction*100;$('uploadState').textContent=fraction>=1?'文件已发送，正在等待服务器确认…':'正在发送 '+Math.floor(fraction*100)+'%';}
      });
      if(!this.#read||!this.#edit){this.#uncertain=true;$('uploadState').textContent='原文件仍保留，请在原账号工作区的新页面检查上传结果。';return;}
      this.#uploaded=file;this.#uncertain=false;$('uploadState').textContent='上传已确认 · '+asset.filename+'；选择“放到白板”后才会添加内容。再次上传须重新选择文件。';
      // A confirmed upload belongs to the original action. Closing, searching
      // or choosing another preview must not let its late acknowledgement
      // replace the author's newer place in the library.
      if(epoch!==this.#epoch||this.#selected!==selection||!$('mediaDialog').open)return;
      await this.refresh();if(this.#read&&epoch+1===this.#epoch&&$('mediaDialog').open)this.select(asset);
    }catch(error){this.#uncertain=error.code==='upload_uncertain'||error.code==='account_changed';$('uploadState').textContent=error.message;}
    finally{this.#uploading=false;this.controls();}
  }
  async insert(){
    if(!this.#edit||!this.#selectionReady||!this.#selected||this.#selected.archived||this.#changingShelf||this.#shelfUncertain===this.#selected.id||this.#refreshing||!$('mediaDialog').open)return;const asset=this.#selected,epoch=this.#epoch;
    $('insertMedia').disabled=true;
    try{await this.#api.access(true);const current=await this.#api.read(asset.id);
      if(epoch!==this.#epoch||!this.#edit)return;
      if(current.archived){this.#selected=current;this.controls();$('mediaMessage').textContent='这份素材已收起，请先刷新核对并恢复，再放到白板。';return;}
      this.#insert(current);this.close();
    }catch(error){$('mediaMessage').textContent=error.message;}
    finally{this.controls();}
  }
  get pending(){return Boolean(this.#file&&this.#uploaded!==this.#file)||this.#uploading||this.#changingShelf||this.#metadata.pending||this.#folders.pending;}
}
