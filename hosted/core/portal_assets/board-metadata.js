const $=id=>document.getElementById(id);
const fields=asset=>({title:asset.title,notes:asset.notes,tags:[...asset.tags],folderId:asset.folderId});
const exact=value=>JSON.stringify(value);

// One retained form has its own asset, original version and author input.
// Library selection, refresh, late replies and new cookies cannot retarget it.
export class BoardMetadata {
  #api; #scope; #saved; #draft=null; #read=false; #edit=false; #busy=false; #phase='ready'; #generation=0; #candidate=null;
  constructor(api,scope,saved){
    this.#api=api;this.#scope=Object.freeze({...scope});this.#saved=saved;
    $('closeMetadata').onclick=()=>$('metadataDialog').close();
    $('metadataDialog').addEventListener('close',()=>{this.#generation++;this.controls();});
    $('metadataDialog').addEventListener('keydown',event=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){
        event.preventDefault();event.stopPropagation();if(!event.isComposing&&$('metadataDialog').open)this.save();
      }
    });
    $('resumeMetadata').onclick=()=>this.open();
    $('metadataForm').onsubmit=event=>{event.preventDefault();this.save();};
    for(const [id,key] of [['metadataTitle','title'],['metadataNotes','notes']])$(id).oninput=()=>{
      if(!this.canType())return;this.#draft.data[key]=$(id).value;this.changed();
    };
    $('metadataFolder').onchange=()=>{if(this.canType()){this.#draft.data.folderId=$('metadataFolder').value;this.changed();}};
    $('addMetadataTag').onclick=()=>{if(this.canType()&&this.#draft.data.tags.length<50){this.#draft.data.tags.push('');this.tags();this.changed();$('metadataTags').lastElementChild.querySelector('textarea').focus();}};
    $('checkMetadataVersion').onclick=()=>this.inspect();
    $('useMetadataVersion').onclick=()=>this.useVersion();
    $('exportMetadata').onclick=()=>this.export();
    $('discardMetadata').onclick=()=>{
      if(!this.#draft||this.#busy||!confirm('放弃这页尚未保存的素材说明？服务器原文件和已保存说明不变。'))return;
      this.#draft=null;this.#candidate=null;$('metadataDialog').close();this.controls();
    };
  }
  get dirty(){return !!this.#draft&&exact(this.#draft.data)!==exact(this.#draft.base);}
  get pending(){return this.#busy||this.dirty||['uncertain','conflict'].includes(this.#phase)&&!!this.#draft;}
  canType(){return $('metadataDialog').open&&!!this.#draft&&this.#read&&this.#edit&&this.#phase!=='paused';}
  sync(read,edit){
    if(this.#read&&!read){this.#generation++;this.#candidate=null;this.#phase='paused';this.message('原账号或素材访问已暂停，你的说明仍在这页，可复制或导出。');}
    if(this.#edit&&!edit&&this.#draft){this.#candidate=null;this.#phase='paused';this.message('编辑权限已暂停，你的说明仍保留；核对权限后再继续。');}
    this.#read=read;this.#edit=edit;this.controls();
  }
  message(value){$('metadataState').textContent=value;}
  controls(){
    const draft=!!this.#draft,type=this.canType();
    $('metadataForm').hidden=!draft;
    $('resumeMetadata').hidden=!this.pending;
    $('editMetadata').disabled=!this.#read;
    $('editMetadata').textContent=this.#edit?'编辑说明与位置':'查看说明与位置';
    for(const id of ['metadataTitle','metadataNotes'])$(id).readOnly=!type;
    $('metadataFolder').disabled=!type;
    for(const tag of $('metadataTags').querySelectorAll('textarea'))tag.readOnly=!type;
    for(const button of $('metadataTags').querySelectorAll('button'))button.disabled=!type;
    $('addMetadataTag').disabled=!type||this.#draft?.data.tags.length>=50;
    $('saveMetadata').disabled=!type||this.#busy||this.#phase!=='ready'||!this.dirty;
    $('checkMetadataVersion').disabled=!draft||!this.#read||this.#busy;
    $('exportMetadata').disabled=!draft;
    $('discardMetadata').disabled=!draft||this.#busy;
    $('metadataComparison').hidden=!this.#candidate;
    $('useMetadataVersion').disabled=!this.#candidate||!this.#read||!this.#edit||this.#busy;
  }
  changed(){
    if(this.#phase==='ready'&&!this.#busy)this.message(this.dirty?'尚未保存 · 只在当前页面保留':'与已确认版本相同');
    this.controls();
  }
  folders(folders){
    const id=this.#draft.data.folderId;$('metadataFolder').replaceChildren(new Option('资料库根目录',''));
    for(const folder of folders)$('metadataFolder').append(new Option(folder.name,folder.id));
    if(id&&![...$('metadataFolder').options].some(option=>option.value===id)){
      const option=new Option('原位置已不存在（请明确另选）',id);option.disabled=true;$('metadataFolder').append(option);
    }
    $('metadataFolder').value=id;
  }
  tags(){
    const draft=this.#draft;
    $('metadataTags').replaceChildren();
    this.#draft.data.tags.forEach((tag,index)=>{
      const row=document.createElement('div');row.className='metadata-tag-row';
      const input=document.createElement('textarea');input.rows=Math.min(4,Math.max(1,tag.split(/\r\n|\r|\n/).length));input.maxLength=100;input.value=tag;input.setAttribute('aria-label','标签 '+(index+1));
      // Read existing values from the draft until an actual edit; never normalize
      // embedded line breaks, empty labels or duplicates simply by opening.
      const current=()=>this.canType()&&this.#draft===draft&&row.parentElement===$('metadataTags')&&input.parentElement===row;
      input.oninput=()=>{if(current()){draft.data.tags[index]=input.value;input.rows=Math.min(4,Math.max(1,input.value.split(/\r\n|\r|\n/).length));this.changed();}};
      const remove=document.createElement('button');remove.type='button';remove.textContent='移除';remove.setAttribute('aria-label','移除标签 '+(index+1));
      remove.onclick=()=>{if(current()){
        draft.data.tags.splice(index,1);this.tags();this.changed();
        const inputs=$('metadataTags').querySelectorAll('textarea');(inputs[Math.min(index,inputs.length-1)]||$('addMetadataTag')).focus();
      }};
      row.append(input,remove);$('metadataTags').append(row);
    });this.controls();
  }
  render(){
    const draft=this.#draft;
    $('metadataTarget').textContent='原文件：'+draft.original.filename+' · 素材 '+draft.original.id;
    $('metadataTitle').value=draft.data.title;$('metadataNotes').value=draft.data.notes;$('metadataFolder').value=draft.data.folderId;this.tags();
  }
  async open(id){
    if(this.#draft&&(this.pending||id===undefined||id===this.#draft.original.id)){
      if(!$('metadataDialog').open){this.render();$('metadataDialog').showModal();}
      if(id&&id!==this.#draft.original.id)this.message('先处理这份未完成的说明；它仍属于上方标明的原素材。');
      this.controls();return;
    }
    if(!id||!this.#read||this.#busy)return;
    this.#draft=null;this.#candidate=null;this.#busy=true;this.#phase='ready';
    $('metadataTarget').textContent='正在核对所选素材…';this.message('正在读取原账号工作区的素材说明…');
    $('metadataDialog').showModal();const generation=++this.#generation;this.controls();
    try{
      await this.#api.access();const [asset,folders]=await Promise.all([this.#api.read(id),this.#api.folders()]);await this.#api.access();
      if(generation!==this.#generation||!this.#read||!$('metadataDialog').open)return;
      this.#draft={original:asset,base:fields(asset),data:fields(asset)};this.render();this.folders(folders);
      this.message(this.#edit?'填写后确认保存，原文件不会改变。':'当前只有阅读权限，可查看或导出说明。');
    }catch(error){if(generation===this.#generation)this.message(error.message);}
    finally{this.#busy=false;this.controls();}
  }
  async save(){
    if(!this.canType()||this.#busy||this.#phase!=='ready'||!this.dirty)return;
    if(!$('metadataTitle').value.trim()){this.message('请填写素材名称；其余输入仍保留。');return;}
    if($('metadataFolder').selectedOptions[0]?.disabled){this.message('原位置已不存在，请明确选择新的位置。');return;}
    const draft=this.#draft,submitted=structuredClone(draft.data),expected=draft.original.etag;
    this.#busy=true;this.message('正在保存这份素材说明…');this.controls();
    try{
      await this.#api.access(true);const asset=await this.#api.update(draft.original.id,submitted,expected);
      await this.#api.access(true);
      if(!this.#read||!this.#edit||this.#phase==='paused')throw Error('访问已暂停，请保留输入并核对服务器版本。');
      if(asset.filename!==draft.original.filename||asset.contentHash!==draft.original.contentHash||asset.size!==draft.original.size||exact(fields(asset))!==exact(submitted))throw Error('保存内容无法逐项核对，请保留输入并检查服务器版本。');
      draft.original=asset;draft.base=fields(asset);this.#candidate=null;this.#phase='ready';this.#saved(asset);
      this.message(this.dirty?'已保存刚才提交的说明 · 后来继续写的内容尚未保存':'说明已保存 · 原文件保持原样');
    }catch(error){
      this.#candidate=null;
      this.#phase=!this.#read||!this.#edit||[401,403,404].includes(error.status)||error.code==='account_changed'?'paused':error.status===409?'conflict':'uncertain';
      this.message(error.message+' 你的输入仍在这页；核对服务器版本后再决定是否保存。');
    }finally{this.#busy=false;this.controls();}
  }
  async inspect(){
    if(!this.#draft||!this.#read||this.#busy)return;
    const draft=this.#draft,generation=++this.#generation;this.#busy=true;this.message('只读取服务器版本，不改变你的输入…');this.controls();
    try{
      await this.#api.access();const [asset,folders]=await Promise.all([this.#api.read(draft.original.id),this.#api.folders()]);await this.#api.access();
      if(generation!==this.#generation||!this.#read||!$('metadataDialog').open)return;
      this.#candidate=asset;this.folders(folders);
      $('metadataCurrent').value='名称：\n'+asset.title+'\n\n说明：\n'+asset.notes+'\n\n标签：\n'+
        (asset.tags.length?asset.tags.map((tag,index)=>(index+1)+'. '+(tag||'（空标签）')).join('\n'):'（没有标签）')+'\n\n位置：\n'+(asset.folder||'根目录');
      this.message('服务器版本已显示，你的整份输入保持原样。核对后再选择保存依据。');
      $('metadataComparison').hidden=false;$('metadataComparison').scrollIntoView({block:'nearest'});
    }catch(error){if(generation===this.#generation){this.#candidate=null;this.message(error.message+' 你的输入仍保留。');}}
    finally{this.#busy=false;this.controls();}
  }
  async useVersion(){
    if(!this.#draft||!this.#candidate||!this.#read||!this.#edit||this.#busy)return;
    if(!confirm('保留自己的整份名称、说明、标签和位置，以刚刚查看的服务器版本作为保存依据？之后确认保存会替换这四项，不会自动合并。'))return;
    const draft=this.#draft,candidate=this.#candidate,generation=this.#generation;this.#busy=true;this.controls();
    try{
      await this.#api.access(true);
      if(generation!==this.#generation||!this.#read||!this.#edit||!$('metadataDialog').open)return;
      draft.original=candidate;draft.base=fields(candidate);this.#candidate=null;this.#phase='ready';
      this.message('保存依据已更新，你的输入未变；确认保存时仍会检查版本。');
    }catch(error){this.message(error.message+' 保存依据未改变，输入仍保留。');}
    finally{this.#busy=false;this.controls();}
  }
  export(){
    if(!this.#draft)return;
    const raw=JSON.stringify({format:'creative-asset-input',version:1,account:this.#scope.account,workspace:this.#scope.workspace,
      assetId:this.#draft.original.id,expected:this.#draft.original.etag,input:this.#draft.data},null,2);
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download='asset-input-'+this.#draft.original.id+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
}
