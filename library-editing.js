// Library forms preserve authored drafts and compare against the latest stored fields.
(() => {
 'use strict';
 const copy=value=>value===undefined?undefined:clone(value);
 const text=value=>value===undefined?'（已移除）':Array.isArray(value)?value.join('，'):String(value??'');
 const equal=(a,b)=>wfEqual(a,b);
 const active=state=>$('dialog').open&&state.form.isConnected&&$('dialogBody').contains(state.form);
 function fillTextarea(field,value){
  // Parsing textarea markup consumes an initial LF. Assign the author's value directly.
  field.value=value||'';
  // Keep a short multiline heading or annotation visible on opening; long text can scroll.
  field.rows=Math.max(field.rows,Math.min(12,field.value.split('\n').length));
 }
 function element(tag,className,content){const el=document.createElement(tag);if(className)el.className=className;if(content!==undefined)el.textContent=content;return el}
 function notice(state,message){if(!active(state))return;state.message.textContent=message;state.message.hidden=!message}
 function destination(target){
  if(!target.path&&!target.id)return '';
  if(target.id)return Object.entries(assetIndex.folderIds||{}).find(([,id])=>id===target.id)?.[0]??null;
  return allAssetFolders().includes(target.path)?target.path:null;
 }
 function destinationEdited(state){return state.destination.id!==state.initialDestination.id||(!state.destination.id&&state.destination.path!==state.initialDestination.path)}
 function watchDestination(state){
  const select=$('libraryDestination');if(!select)return;
  select.addEventListener('change',()=>state.destination=libraryFolderTarget(select.value));
 }
 function capture(state){
  state.capture();
  if($('libraryDestination')){
   const path=$('libraryDestination').value;
   if(path!==state.destination.path)state.destination=libraryFolderTarget(path);
  }
  return clone(state.draft);
 }

 function documentChanges(state,original,node,add){
  if(original.type!=='table'||original.documentMode!==true||node.type!=='table'||node.documentMode!==true)return;
  add('node:'+node.id+':cellItems',(node.title||'未命名长文')+' · 正文与文中材料',original.cellItems,node.cellItems,a=>a.bundle?.nodes.find(n=>n.id===node.id)?.cellItems,(a,v)=>a.bundle.nodes.find(n=>n.id===node.id).cellItems=clone(v),node.id,true);
 }

 function fields(state,draft){
  const values=[];
  const add=(key,label,base,mine,get,set,nodeId=null,documentContent=false)=>{if(!equal(base,mine))values.push({key,label,base,mine,get,set,nodeId,documentContent})};
  for(const key of state.mode==='file'?['title','notes','tags']:['title'])add(key,({title:'内容名称',notes:'备注',tags:'标签'})[key],state.base[key],draft[key],a=>a[key],(a,v)=>a[key]=clone(v));
  if(state.mode==='content'){
   for(const n of draft.bundle.nodes){
    const original=state.base.bundle.nodes.find(node=>node.id===n.id);if(!original)continue;
    for(const key of ['title','body','userText','annotation'])add('node:'+n.id+':'+key,(n.title||'未命名内容')+' · '+({title:'标题',body:'正文',userText:'自己的补充',annotation:'备注'})[key],original[key]||'',n[key]||'',a=>a.bundle?.nodes.find(node=>node.id===n.id)?.[key]||'',(a,v)=>a.bundle.nodes.find(node=>node.id===n.id)[key]=clone(v),n.id);
    documentChanges(state,original,n,add);
   }
  }
  const folder=destination(state.destination),before=destination(state.initialDestination);
  // A renamed directory is the same destination; an untouched placement follows the current item.
  if(destinationEdited(state))add('folder','存放位置',before??state.base.folder,folder,a=>a.folder,(a,v)=>a.folder=v);
  return values;
 }
 function conflicts(state,changes,current){
  return changes.filter(change=>!equal(change.get(current),change.base)&&!equal(change.get(current),change.mine));
 }
 function choice(state,change,current){
  const picked=state.choices.get(change.key),latest=change.get(current);
  return picked&&equal(picked.current,latest)&&equal(picked.mine,change.mine)?picked.value:null;
 }
 function showConflicts(state,changes,current){
  state.conflict.replaceChildren();state.conflict.hidden=false;
  state.conflict.append(element('h3','', '这项内容有新版本'),element('p','library-edit-explain','你的输入仍在上方。双方改了同一处，请选择要保留的版本，再点保存。'));
  for(const change of changes){
   const group=element('fieldset','library-edit-conflict'),legend=element('legend','',change.label),pair=element('div','library-edit-pair');
   group.append(legend,pair);
   let contentChange=null;if(change.documentContent){contentChange={before:change.get(current),after:change.mine};const differences=wfDocumentContentChanges(contentChange.before,contentChange.after);if(differences)contentChange.contentPreview={changes:differences,beforeLabel:'库中版本',afterLabel:'我的编辑'};group.insertBefore(element('p','library-edit-explain','选择会保留这一版的整项正文与文中材料。'),pair)}
   for(const [value,label,content] of [['current','库中版本',change.get(current)],['mine','我的编辑',change.mine]]){
    const option=element('label','library-edit-option'),heading=element('span','library-edit-choice');
    const radio=document.createElement('input');radio.type='radio';radio.name='library-choice-'+change.key;radio.value=value;radio.dataset.libraryChoice=change.key;
    radio.checked=choice(state,change,current)===value;
    radio.addEventListener('change',()=>state.choices.set(change.key,{value,current:copy(change.get(current)),mine:copy(change.mine)}));
    heading.append(radio,document.createTextNode(label));option.append(heading);if(contentChange){const display=element('div','library-document-conflict-value');display.innerHTML=wfDiffValue(contentChange,value==='current'?'before':'after');option.append(display);for(const pre of display.querySelectorAll('pre'))pre.tabIndex=0}else option.append(element('pre','',text(content)));pair.append(option);
   }
   const baseline=element('details','library-edit-baseline');baseline.append(element('summary','','编辑前的版本'),element('pre','',change.documentContent?wfText(change.base):text(change.base)));group.append(baseline);state.conflict.append(group);
  }
  state.conflict.append(state.copyButton);state.conflict.querySelector('input:not(:checked)')?.focus({preventScroll:true});
  state.conflict.scrollIntoView({block:'nearest'});
 }
 function unavailable(state,current,draft){
  if(!current||current.archived)return '原件已从内容库移除。你的输入仍保留，可以另存一份继续使用。';
  if(state.mode==='content'){
   if(current.mime!==bundleMime||!current.bundle)return '原件的内容类型已改变。可以把你的编辑另存，原件保持现状。';
   const changed=fields(state,draft).filter(change=>change.nodeId!==null);
   if(changed.some(change=>!current.bundle.nodes.some(node=>node.id===change.nodeId)))return '你正在修改的内容块已从原件移除。可以另存你的编辑，原件保持现状。';
   if(changed.some(change=>change.documentContent&&current.bundle.nodes.some(node=>node.id===change.nodeId&&(node.type!=='table'||node.documentMode!==true))))return '原件的长文结构已改变。可以另存你的编辑，原件保持现状。';
  }
  return '';
 }
 function showUnavailable(state,message){state.conflict.replaceChildren(element('p','library-edit-explain',message),state.copyButton);state.conflict.hidden=false}
 function busy(state,value,freeze=false){
  state.busy=value;
  for(const button of state.buttons)if(button.isConnected)button.disabled=value;
  state.copyButton.disabled=value;
  if(freeze){state.frozen=[...state.form.querySelectorAll('input,textarea,select,button')].filter(el=>!el.disabled);for(const el of state.frozen)el.disabled=true}
  else if(!value){for(const el of state.frozen||[])if(el.isConnected)el.disabled=false;state.frozen=[]}
 }
 function newNoteName(node){
  for(const value of [node.title,node.body,node.userText,node.annotation]){
   const line=String(value||'').split(/\r?\n/).find(value=>value.trim());if(!line)continue;
   let name='',length=0;for(const character of line.trim()){if(length++===1000)break;name+=character}return name;
  }
  return '';
 }
 function missingName(state){
  notice(state,state.mode==='content'&&!state.base?'先写点内容。':'请填写名称。');
  $(state.mode==='file'?'assetTitle':state.base?'libraryName':'library-body')?.focus();
 }
 async function save(state,asCopy=false){
  if(state.busy||!active(state))return;
  let draft=capture(state);if(!draft.title.trim()){missingName(state);return}
  busy(state,true);notice(state,'');
  try{
   await loadAssets();if(!active(state))return;
   // Allow typing during the fresh read; the final snapshot includes those later words.
   draft=capture(state);if(!draft.title.trim()){missingName(state);return}
   const current=state.base?assetById(state.base.id):null;
   if(state.base&&!asCopy){const missing=unavailable(state,current,draft);if(missing){showUnavailable(state,missing);return}}
   const target=destination(state.destination);
   if(target===null&&(!state.base||asCopy||destinationEdited(state))){notice(state,'存放的文件夹已删除。请重新选择位置，你写的内容仍在这里。');return}
   let result;
   if(!state.base||asCopy){
    result=clone(draft);if(asCopy){result.id=uid();delete result.archived;delete result.archiveBatch}
    result.folder=target;
   }else{
    const changes=fields(state,draft),overlap=conflicts(state,changes,current);
    if(overlap.some(change=>!choice(state,change,current))){showConflicts(state,overlap,current);return}
    result=clone(current);
    for(const change of changes)if(!overlap.includes(change)||choice(state,change,current)==='mine')change.set(result,change.mine);
   }
   const next=clone(assetIndex),at=next.assets.findIndex(a=>a.id===result.id);
   if(at<0)next.assets.push(result);else next.assets[at]=result;
   if(!state.base||asCopy||!equal(current,result)){
    result.updated=Date.now();busy(state,true,true);
    if(!await saveAssets(next)){notice(state,'没有保存成功，你的输入仍保留。再点保存会重新核对最新版本。');return}
   }
   if(!active(state))return;
   if(state.mode==='content'||asCopy){enterAssetFolder(result.folder);assetSelected=new Set([result.id]);renderAssets()}
   $('dialog').close();toast(asCopy?'已另存你的编辑，原件保留':state.base?'已保存到内容库，白板副本保留原来的内容':'已保存');
  }catch(error){notice(state,error.message||'暂时不能保存，你的输入仍保留。')}
  finally{busy(state,false)}
 }
 function setup(state){
  state.form=$('dialogBody').querySelector('.library-edit-form');
  state.message=element('p','library-edit-message');state.message.hidden=true;state.message.setAttribute('role','status');
  state.conflict=element('section','library-edit-conflicts');state.conflict.hidden=true;state.conflict.setAttribute('aria-label','库中版本与我的编辑');
  state.copyButton=element('button','','另存我的编辑');state.copyButton.type='button';state.copyButton.addEventListener('click',()=>save(state,true));
  state.form.append(state.message,state.conflict);state.choices=new Map();state.buttons=[...$('dialogActions').querySelectorAll('button')].filter(button=>button.textContent!=='取消');state.frozen=[];
  state.initialDestination=libraryFolderTarget(state.base?.folder??state.draft.folder);state.destination={...state.initialDestination};watchDestination(state);
 }
 function editFile(id){
  const item=assetById(id);if(!item)return;const state={mode:'file',base:clone(item),draft:clone(item),busy:false};
  showDialog('<section class="library-edit-form"><h2>文件说明</h2><label>显示名称<input id="assetTitle" value="'+esc(item.title)+'"></label><label>存放位置<select id="libraryDestination">'+libraryFolderOptions(item.folder)+'</select></label><label>备注<textarea id="assetNotes">'+esc(item.notes||'')+'</textarea></label><label>标签，用逗号分开<input id="assetTags" value="'+esc((item.tags||[]).join('，'))+'"></label><p class="library-edit-explain">修改名称与说明不会重命名原文件。</p></section>',[['取消',()=>$('dialog').close()],['保存',()=>save(state)]]);
  state.capture=()=>{state.draft.title=$('assetTitle').value;state.draft.notes=$('assetNotes').value;state.draft.tags=$('assetTags').value.split(/[,，]/).map(value=>value.trim()).filter(Boolean)};
  setup(state);
  fillTextarea(state.form.querySelector('#assetNotes'),item.notes);
  mountLibraryDestination('libraryDestination');
 }
 function editContent(id=null){
  const original=id?assetById(id):null;if(original&&original.mime!==bundleMime)return editFile(id);
  if(id&&!original)return toast('这项内容已移走，请重新选择。');
  if(original&&!original.bundle?.nodes.length)return toast('这份组合没有内容块，可以先把内容收进库，再继续编辑。');
  const state={mode:'content',base:original?clone(original):null,draft:original?clone(original):{id:uid(),title:'',path:'',folder:assetFolder,mime:bundleMime,size:0,notes:'',tags:[],bundle:{nodes:[{id:uid(),type:'note',sizeMode:'auto',x:0,y:0,w:340,h:120,title:'',body:'',userText:'',annotation:'',tags:[],color:'#fff0aa'}],edges:[]}},busy:false};let index=0;
  const supplement=original?'<div id="librarySupplement"></div>':'<details class="library-note-details"><summary><span class="library-note-caret" aria-hidden="true">›</span>补充和备注</summary><div id="librarySupplement"></div></details>';
  showDialog('<section class="library-edit-form library-content-form'+(original?'':' library-note-create')+'"><div class="library-content-heading"><h2>'+(original?'编辑内容':'写便签')+'</h2>'+(original?'<p class="library-edit-explain">已放到白板上的副本保持原样。</p>':'')+'</div><div class="library-content-layout"><div class="library-content-writing">'+(state.draft.bundle.nodes.length>1?'<label>选择要编辑的内容<select id="libraryPiece">'+state.draft.bundle.nodes.map((n,i)=>'<option value="'+i+'">'+esc(n.title||'未命名内容')+'</option>').join('')+'</select></label>':'')+'<div id="libraryFields"></div>'+(original?'':supplement)+'</div><aside class="library-content-details" aria-label="内容信息">'+(original?'<label>库中的名称<input id="libraryName" value="'+esc(state.draft.title)+'" placeholder="方便自己找到的名称"></label>':'')+'<label>存放位置<select id="libraryDestination">'+libraryFolderOptions(state.draft.folder)+'</select></label>'+(original?supplement:'')+'</aside></div></section>',[['取消',()=>$('dialog').close()],['保存到内容库',()=>save(state)]]);
  const capturePiece=()=>{for(const key of ['title','body','userText','annotation'])state.draft.bundle.nodes[index][key]=state.form.querySelector('#library-'+key).value;for(const {field,path,initial,initialValue}of state.documentFields||[]){let target=state.draft.bundle.nodes[index].cellItems[0][0];for(const key of path.slice(0,-1))target=target[key];const key=path.at(-1);if(field.value!==initial)target[key]=field.value;else if(initialValue===undefined)delete target[key];else target[key]=copy(initialValue)}};
  const field=(key,label,rows)=>'<label>'+label+'<textarea id="library-'+key+'" rows="'+rows+'"></textarea></label>';

  function documentFields(node){
   const controls=[],field=(path,label,value,rows=3)=>{
    const index=controls.length;controls.push({path,value});return '<label>'+esc(label)+'<textarea data-library-document-field="'+index+'" rows="'+rows+'"></textarea></label>';
   };
   const sections=(node.cellItems?.[0]?.[0]||[]).map((item,index)=>{
    if(!item||typeof item!=='object')return '<p>这类内容可放到白板编辑，原件保持。</p>';
    let html='';
    if(item.type==='note'){
     if(!item.documentParagraph)html+=field([index,'title'],'文中便签标题',item.title,1);
     html+=field([index,'body'],item.documentParagraph?'正文段落 '+(index+1):'文中便签正文',item.body,item.documentParagraph?7:4);
    }else if(item.type==='table'){
     html+=field([index,'title'],'文中表格标题',item.title,1);
     const columns=Array.isArray(item.columns)?item.columns:[],rows=Array.isArray(item.rows)?item.rows:[];
     html+='<div class="library-document-edit-table" tabindex="0" role="region" aria-label="'+esc(item.title||'文中表格')+'"><table><thead><tr>'+columns.map((value,c)=>'<th>'+field([index,'columns',c],'列 '+(c+1),value,1)+'</th>').join('')+'</tr></thead><tbody>'+rows.map((row,r)=>'<tr>'+columns.map((_,c)=>'<td>'+(Object.hasOwn(row,c)?field([index,'rows',r,c],'第 '+(r+1)+' 行，第 '+(c+1)+' 列',row[c],3):'')+((item.cellItems?.[r]?.[c]?.length||item.cellImages?.[r]?.[c]?.length)?'<small>格内资料原样保留</small>':'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
    }else return '<section><p>'+esc(item.title||'文中内容')+'</p><small>这类内容可放到白板编辑，原件保持。</small></section>';
    for(const [key,label]of[['userText','补充'],['annotation','备注']])if(item[key])html+=field([index,key],label,item[key]);
    if(item.images?.length||item.mediaId||item.assetId)html+='<small>附带文件原样保留</small>';
    return '<section>'+html+'</section>';
   }).join('');
   return {html:'<div class="library-document-fields">'+sections+'</div>',controls};
  }

  const draw=()=>{
   if(!active(state))return;
   const node=state.draft.bundle.nodes[index],documentContent=node.type==='table'&&node.documentMode===true?documentFields(node):null;state.documentFields=[];
   state.form.querySelector('#libraryFields').innerHTML=field('title',original?'标题':'标题（可不填）',1)+(documentContent?documentContent.html+'<details class="library-document-description" '+(node.body?'open':'')+'><summary>说明</summary>'+field('body','说明',2)+'</details>':field('body','正文',7));
   if(documentContent)state.documentFields=documentContent.controls.map((control,i)=>{const field=state.form.querySelector('[data-library-document-field="'+i+'"]');fillTextarea(field,String(control.value??''));return {field,path:control.path,initial:field.value,initialValue:copy(control.value)}});
   state.form.querySelector('#librarySupplement').innerHTML=field('userText','自己的补充',3)+field('annotation','备注',2)+(node.type==='table'?'<p class="library-edit-explain">'+(node.documentMode===true?'内容结构与附件保持。增删或移动文中内容时，可放到白板编辑后再收录。':'表格单元格与附件会保留。调整表格结构时，可放到白板编辑后再收录。')+'</p>':'');
   for(const key of ['title','body','userText','annotation'])fillTextarea(state.form.querySelector('#library-'+key),state.draft.bundle.nodes[index][key]);
  };
  state.capture=()=>{capturePiece();state.draft.title=original?$('libraryName').value.trim():newNoteName(state.draft.bundle.nodes[0]);state.draft.folder=$('libraryDestination').value};
  setup(state);
  const piece=state.form.querySelector('#libraryPiece');
  if(piece)piece.onchange=()=>{if(!active(state))return;capturePiece();index=Number(piece.value);draw()};
  draw();const documentField=state.form.querySelector('[data-library-document-field]');if(documentField)documentField.focus({preventScroll:true});else $(original?'libraryName':'library-body').focus();
 }
 window.whiteboardLibraryEditing={editFile,editContent};
})();
