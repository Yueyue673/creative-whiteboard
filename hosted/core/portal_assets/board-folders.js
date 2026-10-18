import {folderEntries,planFolder} from './folder-plan.js';
const $=id=>document.getElementById(id),exact=value=>JSON.stringify(value);
const element=(tag,text)=>{const item=document.createElement(tag);item.textContent=text;return item;};
const initial=()=>({kind:'create',target:'',name:''});

// Each review is one operation on a captured catalog. A conflict is reviewed
// against a new tree, never an old whole catalog blindly retried with a new tag.
export class BoardFolders {
  #api;#scope;#saved;#draft=null;#review=null;#candidate=null;#busy=false;#reopenRead=false;#phase='ready';#read=false;#edit=false;#generation=0;
  constructor(api,scope,saved){
    this.#api=api;this.#scope=Object.freeze({...scope});this.#saved=saved;
    $('manageFolders').onclick=()=>this.open();$('resumeFolders').onclick=()=>this.open();
    $('closeFolders').onclick=()=>$('foldersDialog').close();
    $('foldersDialog').addEventListener('close',()=>{this.#generation++;this.#candidate=null;this.#reopenRead=false;this.controls();});
    $('folderForm').onsubmit=e=>{e.preventDefault();this.prepare();};
    $('folderKind').onchange=()=>this.change('kind',$('folderKind').value);
    $('folderTarget').onchange=()=>this.change('target',$('folderTarget').value);
    $('folderName').oninput=()=>this.change('name',$('folderName').value);
    $('saveFolders').onclick=()=>this.save();$('inspectFolders').onclick=()=>this.inspect();
    $('useFolderVersion').onclick=()=>this.useVersion();$('exportFolders').onclick=()=>this.export();
    $('discardFolders').onclick=()=>{
      if(!$('foldersDialog').open||this.#busy||!this.#draft||!confirm('放弃这页未完成的目录操作？已保存目录和素材不会改变。'))return;
      this.#draft=null;this.#review=null;this.#candidate=null;this.#phase='ready';$('foldersDialog').close();this.controls();
    };
  }
  get dirty(){return !!this.#draft&&exact(this.#draft.input)!==exact(this.#draft.acknowledged);}
  get pending(){return this.#busy||this.dirty||!!this.#draft&&['conflict','uncertain'].includes(this.#phase);}
  canType(){return $('foldersDialog').open&&!!this.#draft&&this.#read&&this.#edit&&this.#phase!=='paused';}
  message(value){$('folderState').textContent=value;$('folderLoading').textContent=value;}
  sync(read,edit){
    if((this.#read&&!read)||(this.#edit&&!edit&&this.#draft)){
      this.#generation++;this.#phase='paused';this.#review=null;this.#candidate=null;
      this.message('原账号或编辑权限已暂停；你的目录操作仍在这页，可以复制或导出。');
    }
    this.#read=read;this.#edit=edit;
    if(!read){
      $('folderTree').replaceChildren();$('folderCurrentTree').replaceChildren();
      const own=this.#draft?.input.target||'';$('folderTarget').replaceChildren(new Option(own?'原操作目录（访问已暂停）':'资料库根目录',own));
    }
    this.controls();
  }
  controls(){
    const type=this.canType();$('manageFolders').disabled=!this.#read;
    $('manageFolders').textContent=this.#edit?'管理目录':'查看目录';$('resumeFolders').hidden=!this.pending;
    $('folderForm').hidden=!this.#draft;$('folderKind').disabled=$('folderTarget').disabled=!type||this.#busy;
    $('folderLoading').hidden=!!this.#draft;
    $('folderName').readOnly=!type;$('folderNameLabel').hidden=this.#draft?.input.kind==='remove';
    $('folderTargetLabelText').textContent=this.#draft?.input.kind==='create'?'放在哪个目录下':'选择要操作的目录';
    $('prepareFolders').disabled=!type||this.#busy||this.#phase!=='ready'||!this.dirty;
    $('saveFolders').disabled=!type||this.#busy||!this.#review||this.#phase!=='ready';
    $('folderReview').hidden=!this.#review;$('folderComparison').hidden=!this.#candidate;
    $('inspectFolders').disabled=!this.#draft||!this.#read||this.#busy;
    $('useFolderVersion').disabled=!this.#candidate||!this.#read||!this.#edit||this.#busy;
    $('exportFolders').disabled=!this.#draft;$('discardFolders').disabled=!this.#draft||this.#busy;
  }
  change(key,value){
    if(!this.canType())return;this.#draft.input[key]=value;this.#review=null;
    if(this.#phase==='ready'&&!this.#busy)this.message('操作尚未保存 · 先核对范围，再确认。');this.controls();
  }
  tree(catalog,root){
    root.replaceChildren();const entries=folderEntries(catalog);
    if(!entries.length){root.append(element('p','目前只有资料库根目录。'));return;}
    for(const folder of entries){const row=element('div',folder.name);row.className='folder-tree-row';row.style.setProperty('--depth',String(Math.min(folder.name.split('/').length-1,5)));root.append(row);}
  }
  targets(){
    const input=this.#draft.input;
    if(!this.#read){$('folderTarget').replaceChildren(new Option(input.target?'原操作目录（访问已暂停）':'资料库根目录',input.target));$('folderTarget').value=input.target;return;}
    const entries=folderEntries(this.#draft.catalog.value);
    $('folderTarget').replaceChildren(new Option('资料库根目录',''));
    for(const row of entries)$('folderTarget').append(new Option(row.name,row.id));
    if(input.target&&!entries.some(row=>row.id===input.target)){
      const missing=new Option('原目录已不存在（请明确另选）',input.target);missing.disabled=true;$('folderTarget').append(missing);
    }
    $('folderTarget').value=input.target;
  }
  render(){
    $('folderKind').value=this.#draft.input.kind;$('folderName').value=this.#draft.input.name;
    this.targets();if(this.#read)this.tree(this.#draft.catalog.value,$('folderTree'));this.controls();
  }
  async open(){
    if(this.#busy){
      if(!this.#read&&!this.#draft)return;
      const reopening=!$('foldersDialog').open;if(reopening)$('foldersDialog').showModal();
      if(this.#draft)this.render();else if(reopening)this.#reopenRead=true;
      this.controls();return;
    }
    // Render the retained operation, not values left in a hidden DOM field.
    if(this.#draft&&this.pending){if(!$('foldersDialog').open)$('foldersDialog').showModal();this.render();return;}
    if(!this.#read)return;this.#draft=null;this.#review=null;this.#candidate=null;this.#phase='ready';this.#busy=true;
    $('folderTree').replaceChildren();$('foldersDialog').showModal();const generation=++this.#generation;this.message('正在核对原工作区的目录…');this.controls();
    try{
      await this.#api.access();const catalog=await this.#api.catalog();await this.#api.access();
      if(generation!==this.#generation||!this.#read||!$('foldersDialog').open)return;
      this.#draft={catalog,input:initial(),acknowledged:initial()};this.render();
      this.message(this.#edit?'按自己的方式命名；每次只处理一项，并核对影响范围。':'当前只有阅读权限，可以查看目录。');
    }catch(error){if(generation===this.#generation)this.message(error.message);}
    finally{
      const reopen=this.#reopenRead&&this.#read&&$('foldersDialog').open&&!this.#draft;
      this.#reopenRead=false;this.#busy=false;this.controls();
      // Closing invalidates that read. A user's explicit reopen waits for it,
      // then reads the original scope again instead of accepting its late tree.
      if(reopen)await this.open();
    }
  }
  prepare(){
    if(!this.canType()||this.#busy||this.#phase!=='ready'||!this.dirty)return;
    try{
      const plan=planFolder(this.#draft.catalog.value,this.#draft.input,crypto.randomUUID());
      this.#review={...plan,expected:this.#draft.catalog.etag};$('folderChanges').replaceChildren();
      for(const change of plan.changes){
        const row=element('li',change.before===null?'新增：'+change.after:change.after===null?'移除：'+change.before:change.before+' → '+change.after);$('folderChanges').append(row);
      }
      $('folderReviewNote').textContent=plan.input.kind==='remove'?'将移除以上整个目录范围；其中仍有素材时，服务器会拒绝。原文件不会删除或自动搬到根目录。':plan.input.kind==='rename'?'子目录会一起改名；素材的位置编号保持不变。':'创建空目录；现有目录和素材保持原样。';
      this.message('请核对下面的完整影响范围，尚未保存。');this.controls();$('folderReview').scrollIntoView({block:'nearest'});
    }catch(error){this.#review=null;this.message(error.message);this.controls();}
  }
  async save(){
    if(!this.canType()||this.#busy||this.#phase!=='ready'||!this.#review)return;
    const draft=this.#draft,review=this.#review;
    if(exact(review.input)!==exact(draft.input)){this.#review=null;this.message('输入已变化，请重新核对范围。');this.controls();return;}
    this.#busy=true;this.message('正在保存刚刚核对的目录操作…');this.controls();
    try{
      await this.#api.access(true);const catalog=await this.#api.updateCatalog(review.value,review.expected);await this.#api.access(true);
      if(!this.#read||!this.#edit||this.#phase==='paused')throw Error('访问已暂停，请保留输入并检查服务器目录。');
      draft.catalog=catalog;draft.acknowledged=structuredClone(review.input);this.#review=null;this.#candidate=null;this.#phase='ready';
      this.targets();this.tree(catalog.value,$('folderTree'));this.#saved(catalog.value);
      this.message(this.dirty?'已保存刚才核对的操作 · 后来填写的名称仍未保存，请重新核对。':'目录已保存 · 素材原文件保持原样');
    }catch(error){
      this.#review=null;this.#candidate=null;
      this.#phase=!this.#read||!this.#edit||[401,403,404].includes(error.status)||error.code==='account_changed'?'paused':error.status===409?'conflict':'uncertain';
      this.message(error.message+' 这页操作仍保留；先查看服务器目录，再决定下一步。');
    }finally{this.#busy=false;this.controls();}
  }
  async inspect(){
    if(!$('foldersDialog').open||!this.#draft||!this.#read||this.#busy)return;const generation=++this.#generation;this.#busy=true;this.#candidate=null;
    this.message('只读取服务器目录，不改变你填写的操作…');this.controls();
    try{
      await this.#api.access();const catalog=await this.#api.catalog();await this.#api.access();
      if(generation!==this.#generation||!this.#read||!$('foldersDialog').open)return;
      this.#candidate=catalog;this.tree(catalog.value,$('folderCurrentTree'));
      this.message('服务器目录已显示；你填写的操作和旧保存依据保持原样。');this.controls();$('folderComparison').scrollIntoView({block:'nearest'});
    }catch(error){if(generation===this.#generation)this.message(error.message+' 你的操作仍保留。');}
    finally{
      this.#busy=false;
      if(generation!==this.#generation&&this.#read&&$('foldersDialog').open&&this.#phase!=='paused')this.message('上一次检查已结束，原操作仍保留；可重新查看服务器目录。');
      this.controls();
    }
  }
  async useVersion(){
    if(!$('foldersDialog').open||!this.#candidate||!this.#draft||!this.#read||!this.#edit||this.#busy)return;
    if(!confirm('以刚刚查看的服务器目录重新核对这项操作？会保留你的输入和服务器其他目录；不会直接保存。'))return;
    const candidate=this.#candidate,generation=this.#generation;this.#busy=true;this.controls();
    try{
      await this.#api.access(true);if(generation!==this.#generation||!this.#read||!this.#edit||!$('foldersDialog').open)return;
      this.#draft.catalog=candidate;this.#candidate=null;this.#review=null;this.#phase='ready';this.targets();this.tree(candidate.value,$('folderTree'));
      this.message('已更新核对依据；请重新核对这项操作的范围，再确认保存。');
    }catch(error){this.message(error.message+' 核对依据未改变。');}
    finally{this.#busy=false;this.controls();}
  }
  export(){
    if(!$('foldersDialog').open||!this.#draft)return;
    const target=folderEntries(this.#draft.catalog.value).find(row=>row.id===this.#draft.input.target)?.name||'';
    const raw=JSON.stringify({format:'creative-folder-input',version:1,account:this.#scope.account,workspace:this.#scope.workspace,
      expected:this.#draft.catalog.etag,targetName:target,input:this.#draft.input,review:this.#review?.changes||null},null,2);
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download='folder-input-'+this.#scope.workspace+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
}
