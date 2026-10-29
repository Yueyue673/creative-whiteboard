// Library forms preserve authored drafts and compare against the latest stored fields.
(() => {
 'use strict';
 let escapeGuard=null;
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

 const tableKeys=['columns','rows','rowIds','columnIds','cellItems','cellImages'];
 const ordinaryTable=node=>node?.type==='table'&&node.documentMode!==true&&Array.isArray(node.columns)&&Array.isArray(node.rows)&&node.rows.every(Array.isArray);
 function tableScope(){
  let outer=null;try{if(parent!==window)outer=parent.whiteboardHosted||null}catch{return null}
  const inner=window.whiteboardHosted||null;
  return {inner,outer,key:JSON.stringify([inner,outer].map(host=>host?[host.account?.id,host.workspace,host.base]:null))};
 }
 function tableScopeProblem(state){
  if(!state.tableContext)return '';
  const before=state.tableContext,now=tableScope();
  if(!now||now.inner!==before.inner||now.outer!==before.outer||now.key!==before.key||[now.inner,now.outer].some(host=>host&&(host.paused||host.role==='viewer'||host.account?.id==null||host.workspace==null||host.base==null)))return '所属账号、工作区或编辑权限已有变化。你的表格输入仍保留，请回到原位置再保存。';
  return '';
 }
 const tableContent=node=>node?Object.fromEntries(tableKeys.filter(key=>Object.hasOwn(node,key)).map(key=>[key,copy(node[key])])):undefined;
 function tableChanges(original,node,add){
  if(!ordinaryTable(original)||!ordinaryTable(node))return;
  // Text and its row/column material correspondence are one reviewed version.
  add('node:'+node.id+':tableContent',(node.title||'未命名表格')+' · 表格文字与格内资料',tableContent(original),tableContent(node),a=>tableContent(a.bundle?.nodes.find(n=>n.id===node.id)),(a,value)=>{const target=a.bundle.nodes.find(n=>n.id===node.id);for(const key of tableKeys)if(Object.hasOwn(value,key))target[key]=copy(value[key]);else delete target[key]},node.id,false,true);
 }
 function fields(state,draft){
  const values=[];
  const add=(key,label,base,mine,get,set,nodeId=null,documentContent=false,tableContent=false)=>{if(!equal(base,mine))values.push({key,label,base,mine,get,set,nodeId,documentContent,tableContent})};
  for(const key of state.mode==='file'?['title','notes','tags']:['title'])add(key,({title:'内容名称',notes:'备注',tags:'标签'})[key],state.base[key],draft[key],a=>a[key],(a,v)=>a[key]=clone(v));
  if(state.mode==='content'){
   for(const n of draft.bundle.nodes){
    const original=state.base.bundle.nodes.find(node=>node.id===n.id);
    if(!original){
     if(state.addedNoteIds?.has(n.id))add('node:'+n.id+':added','新增 '+pieceLabel(n,draft.bundle.nodes.indexOf(n)),undefined,copy(n),a=>a.bundle?.nodes.find(node=>node.id===n.id),(a,value)=>{
      const found=a.bundle.nodes.filter(node=>node.id===n.id);
      if(!found.length)a.bundle.nodes.push(copy(value));
      else if(found.length!==1||!equal(found[0],value))throw Error('新增便签的编号已有另一版内容。请保留输入并另存，原件保持现状。');
     });
     continue;
    }
    for(const key of ['title','body','userText','annotation'])add('node:'+n.id+':'+key,(n.title||'未命名内容')+' · '+({title:'标题',body:'正文',userText:'自己的补充',annotation:'备注'})[key],original[key]||'',n[key]||'',a=>a.bundle?.nodes.find(node=>node.id===n.id)?.[key]||'',(a,v)=>a.bundle.nodes.find(node=>node.id===n.id)[key]=clone(v),n.id);
    documentChanges(state,original,n,add);
    tableChanges(original,n,add);
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
 function tableComparison(value,label){
  const box=element('div','library-document-conflict-value library-document-edit-table'),table=element('table'),head=element('thead'),titles=element('tr'),body=element('tbody');
  box.setAttribute('role','region');box.setAttribute('aria-label',label+'表格');box.tabIndex=0;table.style.minWidth=Math.max(320,(value.columns?.length||0)*160)+'px';
  box.append(element('p','library-edit-explain','表格文字与格内资料摘要'),table);table.append(head,body);head.append(titles);
  for(const title of value.columns||[])titles.append(element('th','',String(title??'')));
  for(const [r,row]of (value.rows||[]).entries()){
   const line=element('tr');body.append(line);
   for(let c=0;c<(value.columns?.length||0);c++){
    const cell=element('td');line.append(cell);cell.append(element('pre','',Object.hasOwn(row,c)?String(row[c]??''):''));
    const items=value.cellItems?.[r]?.[c]||[],images=value.cellImages?.[r]?.[c]||[];
    if(!items.length&&!images.length)continue;
    const details=element('details'),summary=element('summary','','格内资料 · '+(items.length+images.length)+' 项');details.open=true;details.append(summary);cell.append(details);
    for(const item of items){
     const part=element('section'),name=item?.title||(item?.type==='table'?'表格':'便签');part.append(element('strong','',name));
     for(const key of ['body','userText','annotation'])if(item?.[key])part.append(element('pre','',item[key]));
     const asset=assetById(item?.assetId||item?.mediaId);if(asset)part.append(element('small','',asset.title||'附带文件'));
     if(item?.type==='table')part.append(element('small','',(item.rows?.length||0)+' 行表格 · 摘要，整项资料随版本保留'));
     details.append(part);
    }
    for(const image of images)details.append(element('p','',image?.name||assetById(image?.assetId)?.title||'格内图片'));
   }
  }
  return box;
 }
 function showConflicts(state,changes,current){
  state.conflict.replaceChildren();state.conflict.hidden=false;
  state.conflict.append(element('h3','', '这项内容有新版本'),element('p','library-edit-explain','你的输入仍在上方。双方改了同一处，请选择要保留的版本，再点保存。'));
  for(const change of changes){
   const group=element('fieldset','library-edit-conflict'),legend=element('legend','',change.label),pair=element('div','library-edit-pair');
   group.append(legend,pair);
   let contentChange=null;if(change.documentContent||change.tableContent){contentChange={before:change.get(current),after:change.mine};const differences=change.documentContent?wfDocumentContentChanges(contentChange.before,contentChange.after):null;if(differences)contentChange.contentPreview={changes:differences,beforeLabel:'库中版本',afterLabel:'我的编辑'};group.insertBefore(element('p','library-edit-explain',change.tableContent?'选择会保留这一版的整张表格文字、行列对应和格内资料。':'选择会保留这一版的整项正文与文中材料。'),pair)}
   for(const [value,label,content] of [['current','库中版本',change.get(current)],['mine','我的编辑',change.mine]]){
    const option=element('label','library-edit-option'),heading=element('span','library-edit-choice');
    const radio=document.createElement('input');radio.type='radio';radio.name='library-choice-'+change.key;radio.value=value;radio.dataset.libraryChoice=change.key;
    radio.checked=choice(state,change,current)===value;
    radio.addEventListener('change',()=>state.choices.set(change.key,{value,current:copy(change.get(current)),mine:copy(change.mine)}));
    heading.append(radio,document.createTextNode(label));option.append(heading);if(change.tableContent)option.append(tableComparison(content,label));else if(contentChange){const display=element('div','library-document-conflict-value');display.innerHTML=wfDiffValue(contentChange,value==='current'?'before':'after');option.append(display);for(const pre of display.querySelectorAll('pre'))pre.tabIndex=0}else option.append(element('pre','',text(content)));pair.append(option);
   }
   const baseline=element('details','library-edit-baseline');baseline.append(element('summary','','编辑前的版本'),change.tableContent?tableComparison(change.base,'编辑前的版本'):element('pre','',change.documentContent?wfText(change.base):text(change.base)));group.append(baseline);state.conflict.append(group);
  }
  state.conflict.append(state.copyButton);state.conflict.querySelector('input:not(:checked)')?.focus({preventScroll:true});
  state.conflict.scrollIntoView({block:'nearest'});
 }
 function unavailable(state,current,draft){
  if(!current||current.archived)return '原件已从内容库移除。你的输入仍保留，可以另存一份继续使用。';
  if(state.mode==='content'){
   if(current.mime!==bundleMime||!current.bundle)return '原件的内容类型已改变。可以把你的编辑另存，原件保持现状。';
   for(const node of draft.bundle.nodes)if(state.addedNoteIds?.has(node.id)&&!state.base.bundle.nodes.some(old=>old.id===node.id)){
    const found=current.bundle.nodes.filter(old=>old.id===node.id);
    if(found.length&&(found.length!==1||!equal(found[0],node)))return '新增便签的编号已有另一版内容。你的输入仍保留，可以另存一份；原件保持现状。';
   }
   const changed=fields(state,draft).filter(change=>change.nodeId!==null);
   if(changed.some(change=>!current.bundle.nodes.some(node=>node.id===change.nodeId)))return '你正在修改的内容块已从原件移除。可以另存你的编辑，原件保持现状。';
   if(changed.some(change=>change.documentContent&&current.bundle.nodes.some(node=>node.id===change.nodeId&&(node.type!=='table'||node.documentMode!==true))))return '原件的长文结构已改变。可以另存你的编辑，原件保持现状。';
    if(changed.some(change=>change.tableContent&&(current.bundle.nodes.filter(node=>node.id===change.nodeId).length!==1||!ordinaryTable(current.bundle.nodes.find(node=>node.id===change.nodeId)))))return '原件的表格结构已改变。可以另存你的编辑，原件保持现状。';
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
  state.refreshTableTextControls?.();
  state.refreshTableRowControls?.();state.refreshTableColumnControls?.();state.refreshNoteControls?.();
 }
 function newNoteName(node){
  for(const value of [node.title,node.body,node.userText,node.annotation]){
   const line=String(value||'').split(/\r?\n/).find(value=>value.trim());if(!line)continue;
   let name='',length=0;for(const character of line.trim()){if(length++===1000)break;name+=character}return name;
  }
  return '';
 }
 function newContentName(node){
  if(!ordinaryTable(node))return newNoteName(node);
  const words=[node.title,...node.rows.flat(),...node.columns.filter((value,c)=>value!=='列 '+(c+1)),node.body,node.userText,node.annotation];
  for(const value of words){const name=newNoteName({body:value});if(name)return name}
  return '';
 }
 function missingName(state){
  if(state.mode==='content'&&!state.base&&ordinaryTable(state.draft.bundle.nodes[0])){notice(state,'先为表格写点内容，或填写标题。');state.form.querySelector('[data-library-table-field="3"]')?.focus();return}
  notice(state,state.mode==='content'&&!state.base?'先写点内容。':'请填写名称。');
  $(state.mode==='file'?'assetTitle':state.base?'libraryName':'library-body')?.focus();
 }
 function continuationValue(value){
  const result=clone(value);delete result.updated;
  if(result.bundle?.nodes)for(const node of result.bundle.nodes)for(const key of ['title','body','userText','annotation'])node[key]=String(node[key]||'');
  return result;
 }
 function continueEditing(state,result){
  // Keep the actual controls and table arrays: native undo and append ownership live there.
  state.base=clone(result);state.draft.folder=result.folder;
  state.initialDestination={...state.destination};state.choices.clear();state.conflict.replaceChildren();state.conflict.hidden=true;
  state.refreshSavedPieceLabel?.();
  state.resetEscapeBaseline?.();notice(state,'已保存，可继续编辑。');state.savedInPlace=true;
  const field=state.lastField,range=field&&[field.selectionStart,field.selectionEnd,field.selectionDirection],scroll=field&&[field.scrollTop,field.scrollLeft];
  queueMicrotask(()=>{
   if(!active(state)||state.busy||!field?.isConnected)return;
   field.focus({preventScroll:true});
   if(Number.isInteger(range[0])&&Number.isInteger(range[1]))field.setSelectionRange(...range);
   field.scrollTop=scroll[0];field.scrollLeft=scroll[1];field.scrollIntoView({block:'nearest'});
  });
 }
 function previewReturnProblem(state){return state.previewReturn&&!state.previewReturn.current()?'所属账号、工作区或编辑位置已有变化。你的输入仍保留，请回到原位置再保存。':''}
 const copyValue=value=>{const result=clone(value);delete result.updated;return result};
 function copyScopeProblem(state){
  const before=state.copyContext,now=tableScope();
  return !before||!now||now.inner!==before.inner||now.outer!==before.outer||now.key!==before.key||[now.inner,now.outer].some(host=>host&&(host.paused||host.role==='viewer'||host.account?.id==null||host.workspace==null||host.base==null))?'所属账号、工作区或编辑权限已有变化。你的输入仍保留，请回到原位置再另存。':'';
 }
 function prepareSeparateCopy(state,draft,target){
  const make=id=>{const result=clone(draft);result.id=id;result.folder=target;delete result.archived;delete result.archiveBatch;if(state.mode==='content'&&state.base)result.libraryReference={id:state.base.id,name:state.base.title};return result};
  const pending=state.copyAttempt;
  if(pending){
   const result=make(pending.id),found=assetIndex.assets.filter(item=>item.id===pending.id);
   if(found.length||state.copyReview){
    const stored=found.length===1?found[0]:null;
    if(stored&&!stored.archived&&equal(copyValue(stored),pending.value)&&equal(copyValue(result),pending.value))return {confirmed:stored};
    const review=state.copyReview;
    if(!review||!equal(review.stored,found)||!equal(review.draft,result)){
     state.copyReview={stored:clone(found),draft:clone(result)};state.copyButton.textContent='另存后续编辑';
     showUnavailable(state,'上一次另存的副本已有保存记录，或随后发生变化。你的输入仍在；点“另存后续编辑”会再留一份，已有副本保持现状。');return {};
    }
   }else return {result};
  }
  let id;do{id=uid()}while(assetIndex.assets.some(item=>item.id===id));
  state.copyAttempt={id,value:null};state.copyReview=null;state.copyButton.textContent='另存我的编辑';return {result:make(id)};
 }
 function finishSave(state,result,asCopy,confirmed=false,keepOpen=false){
  if(!active(state))return;
  if(previewReturnProblem(state)||tableScopeProblem(state)||(asCopy&&copyScopeProblem(state))){$('dialog').close();toast('已保存到原内容库。所属位置随后发生变化，已停下后续定位。');return}
  if(state.mode==='content'||asCopy){enterAssetFolder(result.folder);assetSelected=new Set([result.id]);renderAssets()}
  if(keepOpen&&state.base&&!asCopy){continueEditing(state,result);return}
  if(asCopy||!state.previewReturn?.open(state.form))$('dialog').close();toast(confirmed?'这次内容已保存到内容库':asCopy?'已另存你的编辑，原件保留':state.base?'已保存到内容库，白板副本保留原来的内容':'已保存');
 }
 async function save(state,asCopy=false,keepOpen=false){
  if(state.busy||!active(state))return;
  if(asCopy&&copyScopeProblem(state)){notice(state,copyScopeProblem(state));return}
  if(previewReturnProblem(state)){notice(state,previewReturnProblem(state));return}
  if(tableScopeProblem(state)){notice(state,tableScopeProblem(state));return}
  let tableTextIssue=state.tableTextSaveProblem?.();if(tableTextIssue){notice(state,tableTextIssue);return}
  let draft=capture(state);if(!draft.title.trim()){missingName(state);return}
  busy(state,true);notice(state,'');
  try{
   await loadAssets();if(!active(state))return;
   if(asCopy&&copyScopeProblem(state)){notice(state,copyScopeProblem(state));return}
   if(previewReturnProblem(state)){notice(state,previewReturnProblem(state));return}
   if(tableScopeProblem(state)){notice(state,tableScopeProblem(state));return}
   tableTextIssue=state.tableTextSaveProblem?.();if(tableTextIssue){notice(state,tableTextIssue);return}
   // Allow typing during the fresh read; the final snapshot includes those later words.
   draft=capture(state);if(!draft.title.trim()){missingName(state);return}
   const current=state.base?assetById(state.base.id):null;
   if(state.base&&!asCopy){const missing=unavailable(state,current,draft);if(missing){showUnavailable(state,missing);return}}
   const target=destination(state.destination);
   if(target===null&&(!state.base||asCopy||destinationEdited(state))){notice(state,'存放的文件夹已删除。请重新选择位置，你写的内容仍在这里。');return}
   if(!state.base&&!asCopy){
    const existing=assetById(draft.id);
    if(existing){
     const stored=clone(existing),wanted=clone(draft);wanted.folder=target;delete stored.updated;delete wanted.updated;
     if(!existing.archived&&equal(stored,wanted)){finishSave(state,existing,false,true);return}
     showUnavailable(state,'这次内容已经保存，随后又被修改或移走。你的输入仍保留，可以另存一份；库中的后来版本保持现状。');return;
    }
   }
   let result;
   if(!state.base||asCopy){
    if(asCopy){
     const prepared=prepareSeparateCopy(state,draft,target);
     if(prepared.confirmed){finishSave(state,prepared.confirmed,true,true);return}
     if(!prepared.result)return;result=prepared.result;
    }else{result=clone(draft);result.folder=target}
   }else{
    const changes=fields(state,draft),overlap=conflicts(state,changes,current);
    if(overlap.some(change=>!choice(state,change,current))){showConflicts(state,overlap,current);return}
    result=clone(current);
    for(const change of changes)if(!overlap.includes(change)||choice(state,change,current)==='mine')change.set(result,change.mine);
   }
   if(keepOpen&&state.base&&!asCopy){
    const visible=clone(draft);if(destinationEdited(state))visible.folder=target;
    if(!equal(continuationValue(result),continuationValue(visible))){notice(state,'库中另有更新。请用原保存按钮核对并合并后重新打开；你的输入仍保留。');return}
   }
   const next=clone(assetIndex),at=next.assets.findIndex(a=>a.id===result.id);
   if(at<0)next.assets.push(result);else next.assets[at]=result;
   if(!state.base||asCopy||!equal(current,result)){
    if(asCopy)state.copyAttempt.value=copyValue(result);
    result.updated=Date.now();busy(state,true,true);
    if(!await saveAssets(next)){notice(state,'没有保存成功，你的输入仍保留。再点保存会重新核对最新版本。');return}
   }
   finishSave(state,result,asCopy,false,keepOpen);
  }catch(error){notice(state,error.message||'暂时不能保存，你的输入仍保留。')}
  finally{busy(state,false)}
 }
 function setup(state){
  state.form=$('dialogBody').querySelector('.library-edit-form');state.copyContext=tableScope();
  if(state.mode==='content'&&state.draft.bundle.nodes.some(ordinaryTable))state.tableContext=tableScope()||{unavailable:true};
  state.message=element('p','library-edit-message');state.message.hidden=true;state.message.setAttribute('role','status');
  state.conflict=element('section','library-edit-conflicts');state.conflict.hidden=true;state.conflict.setAttribute('aria-label','库中版本与我的编辑');
  state.copyButton=element('button','','另存我的编辑');state.copyButton.type='button';state.copyButton.addEventListener('click',()=>save(state,true));
  if(state.base&&state.mode==='content')$('dialogActions').insertBefore(state.copyButton,$('dialogActions').lastElementChild);
  if(state.base){
   const button=element('button','','保存并继续编辑');button.type='button';button.dataset.librarySaveContinue='';button.title='保存后继续编辑（Ctrl+S / ⌘S）';button.setAttribute('aria-keyshortcuts','Control+S Meta+S');button.addEventListener('click',()=>save(state,false,true));$('dialogActions').insertBefore(button,$('dialogActions').lastElementChild);
   state.form.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.altKey||event.shiftKey||event.ctrlKey===event.metaKey||event.key.toLowerCase()!=='s'||!active(state))return;
    event.preventDefault();event.stopPropagation();if(!event.repeat)save(state,false,true);
   });
  }
  state.form.addEventListener('focusin',event=>{if(event.target.matches('input,textarea,select')&&!event.target.closest('.library-edit-conflicts'))state.lastField=event.target});
  state.form.addEventListener('input',()=>{if(state.savedInPlace){notice(state,'');state.savedInPlace=false}});
  state.form.append(state.message,state.conflict);state.choices=new Map();state.buttons=[...$('dialogActions').querySelectorAll('button')].filter(button=>button.textContent!=='取消');state.frozen=[];
  state.initialDestination=libraryFolderTarget(state.base?.folder??state.draft.folder);state.destination={...state.initialDestination};watchDestination(state);
 }
 function keepWritingOnEscape(state){
  const snapshot=()=>{
   const draft=capture(state);
   if(state.mode==='content')for(const node of draft.bundle.nodes)for(const key of ['title','body','userText','annotation'])node[key]=String(node[key]||'');
   if(!destinationEdited(state))draft.folder=null;
   return draft;
  };
  const text=()=>state.form.querySelector('[data-library-table-text]')?.value??'',name=state.form.querySelector('#libraryName');let before=snapshot(),initialText=text(),initialName=name?.value;
  const message=element('p','library-edit-explain library-escape-message','Esc 未关闭编辑，输入仍在。要退出，请点“取消”；未保存的输入会放弃。');message.hidden=true;message.setAttribute('role','status');state.form.append(message);
  const guard=event=>{
   if(event.key!=='Escape'||event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||!active(state))return false;
   if(equal(before,snapshot())&&text()===initialText&&name?.value===initialName){if(!state.busy&&state.previewReturn?.open(state.form))return true;return false}
   message.hidden=false;return true;
  };
  state.resetEscapeBaseline=()=>{before=snapshot();initialText=text();initialName=name?.value;message.hidden=true};
  escapeGuard=guard;onDialogDismiss(()=>{if(escapeGuard===guard)escapeGuard=null});
 }
 function editFile(id){
  const item=assetById(id);if(!item)return;const state={mode:'file',base:clone(item),draft:clone(item),busy:false};
  showDialog('<section class="library-edit-form"><h2>文件说明</h2><label>显示名称<input id="assetTitle" value="'+esc(item.title)+'"></label><label>存放位置<select id="libraryDestination">'+libraryFolderOptions(item.folder)+'</select></label><label>备注<textarea id="assetNotes">'+esc(item.notes||'')+'</textarea></label><label>标签，用逗号分开<input id="assetTags" value="'+esc((item.tags||[]).join('，'))+'"></label><p class="library-edit-explain">修改名称与说明不会重命名原文件。</p></section>',[['取消',()=>$('dialog').close()],['保存',()=>save(state)]]);
  state.capture=()=>{state.draft.title=$('assetTitle').value;state.draft.notes=$('assetNotes').value;state.draft.tags=$('assetTags').value.split(/[,，]/).map(value=>value.trim()).filter(Boolean)};
  setup(state);
  fillTextarea(state.form.querySelector('#assetNotes'),item.notes);
  mountLibraryDestination('libraryDestination');
  keepWritingOnEscape(state);
 }
 function pieceLabel(node,index){
  const kind=node.type==='table'?(node.documentMode===true?'长文':'表格'):({note:'便签',image:'图片',media:'媒体',frame:'分组'}[node.type]||'内容'),values=[node.title,node.body,node.userText,node.annotation];
  if(node.type==='table'){
   if(node.documentMode===true){const items=node.cellItems?.[0]?.[0];if(Array.isArray(items))for(const item of items.slice(0,4))if(item)values.push(item.title,item.body)}
   else{for(const row of (Array.isArray(node.rows)?node.rows:[]).slice(0,3))if(Array.isArray(row))values.push(...row.slice(0,4));if(Array.isArray(node.columns))values.push(...node.columns.slice(0,4))}
  }
  const value=values.find(value=>typeof value==='string'&&value.trim()),prefix=(index+1)+'. '+kind+' · ';let hint='',space=false,count=0;
  for(const letter of value?value.trim():'未命名内容'){
   if(/\s/u.test(letter)){space=!!hint;continue}
   if(space){if(count===36)return prefix+hint+'…';hint+=' ';count++}
   if(count===36)return prefix+hint+'…';hint+=letter;count++;space=false;
  }
  return prefix+hint;
 }
 function blankLibraryNote(){return {id:uid(),type:'note',sizeMode:'auto',x:0,y:0,w:340,h:120,title:'',body:'',userText:'',annotation:'',tags:[],color:colors[0]}}
 function editContent(id=null,kind='note',returnToPreview=null){
  const original=id?assetById(id):null;if(original&&original.mime!==bundleMime)return editFile(id);
  if(id&&!original)return toast('这项内容已移走，请重新选择。');
  if(original&&!original.bundle?.nodes.length)return toast('这份组合没有内容块，可以先把内容收进库，再继续编辑。');
  const freshNode=()=>kind==='table'?{id:uid(),type:'table',sizeMode:'manual',x:0,y:0,w:620,h:360,title:'',body:'',userText:'',annotation:'',tags:[],color:'#ffffff',...tableData(Array.from({length:3},()=>['','','']),false),rowIds:Array.from({length:3},()=>uid()),columnIds:Array.from({length:3},()=>uid())}:blankLibraryNote();
  const state={mode:'content',base:original?clone(original):null,draft:original?clone(original):{id:uid(),title:'',path:'',folder:assetFolder,mime:bundleMime,size:0,notes:'',tags:[],bundle:{nodes:[freshNode()],edges:[]}},busy:false,addedNoteIds:new Set(),previewReturn:original?returnToPreview:null};let index=0;
  const supplement=original?'<div id="librarySupplement"></div>':'<details class="library-note-details"><summary><span class="library-note-caret" aria-hidden="true">›</span>补充和备注</summary><div id="librarySupplement"></div></details>';
  showDialog('<section class="library-edit-form library-content-form'+(original?'':' library-note-create')+'"><div class="library-content-heading"><h2>'+(original?'编辑内容':kind==='table'?'写表格':'写便签')+'</h2>'+(original?'<p class="library-edit-explain">“保存到内容库”更新原件；“另存我的编辑”新建资源。白板副本保持原样。</p>':kind==='table'?'<p class="library-edit-explain">可直接填写三行三列，或从表格文本开始。记录增多时可在末尾加行，保存后继续复用。</p>':'')+'</div><div class="library-content-layout"><div class="library-content-writing">'+(state.draft.bundle.nodes.length>1?'<label>选择要编辑的内容<select id="libraryPiece">'+state.draft.bundle.nodes.map((n,i)=>'<option value="'+i+'">'+esc(pieceLabel(n,i))+'</option>').join('')+'</select></label>':'')+'<div id="libraryFields"></div>'+(original?'':supplement)+'</div><aside class="library-content-details" aria-label="内容信息">'+(original?'<label>库中的名称<input id="libraryName" value="'+esc(state.draft.title)+'" placeholder="方便自己找到的名称"></label>':'')+'<label>存放位置<select id="libraryDestination">'+libraryFolderOptions(state.draft.folder)+'</select></label>'+(original?supplement:'')+'</aside></div></section>',[['取消',()=>{if(!active(state))return;if(!state.busy&&state.previewReturn?.open(state.form))return;$('dialog').close()}],['保存到内容库',()=>save(state)]]);
  const capturePiece=()=>{for(const key of ['title','body','userText','annotation'])state.draft.bundle.nodes[index][key]=state.form.querySelector('#library-'+key).value;for(const {field,path,initial,initialValue,root}of state.documentFields||[]){let target=root||state.draft.bundle.nodes[index].cellItems[0][0];for(const key of path.slice(0,-1))target=target[key];const key=path.at(-1);if(field.value!==initial)target[key]=field.value;else if(initialValue===undefined)delete target[key];else target[key]=copy(initialValue)}};
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

  const appendedRows=new WeakMap(),appendedColumns=new WeakMap();
  const tableFieldOffset=()=>1+Math.max(-1,...(state.documentFields||[]).map(({field})=>Number(field.dataset.libraryTableField)).filter(Number.isFinite));
  function mountTableRowActions(node){
   state.form.querySelector('.library-table-row-actions')?.remove();state.refreshTableRowControls=null;
   if(!ordinaryTable(node))return;
   const grid=state.form.querySelector('#libraryFields .library-document-edit-table');if(!grid)return;
   const box=element('section','library-table-row-actions'),actions=element('div','library-table-text-actions'),add=element('button','','加一行'),undo=element('button','','撤回新增空行'),status=element('p','library-edit-explain');
   add.type=undo.type='button';add.dataset.libraryTableAddRow='';undo.dataset.libraryTableUndoRow='';status.dataset.libraryTableRowState='';status.setAttribute('role','status');
   actions.append(add,undo);box.append(actions,element('p','library-edit-explain','可在末尾继续记录，支持100行、12列；只有这次新增且仍为空的末行可以撤回。'),status);grid.after(box);
   const stack=appendedRows.get(node)||[];appendedRows.set(node,stack);
   const owns=()=>active(state)&&box.isConnected&&grid.isConnected&&state.form.contains(box)&&state.form.contains(grid)&&state.draft.bundle.nodes[index]===node;
   const message=value=>{if(owns())status.textContent=value};
   const refresh=()=>{if(!owns())return;const unavailable=state.busy||!!tableScopeProblem(state);add.disabled=unavailable||node.rows.length>=100||!node.columns.length||node.columns.length>12;undo.hidden=!stack.length;undo.disabled=unavailable||!stack.length};
   const canChange=()=>{if(!owns()||state.busy)return false;const scope=tableScopeProblem(state);if(scope){message(scope);return false}const pending=state.tableTextSaveProblem?.();if(pending){message(pending);return false}return true};
   const hasMaterials=row=>row!==undefined&&row!==null&&(!Array.isArray(row)||row.some(cell=>Array.isArray(cell)?cell.length>0:cell!==undefined&&cell!==null));
   add.onclick=()=>{
    if(!canChange())return;if(node.rows.length>=100||!node.columns.length||node.columns.length>12){message('这里支持最多100行、12列，当前内容保留；更大的表格可放到白板继续。');return}
    const ids=node.rowIds;if(ids!==undefined&&(!Array.isArray(ids)||ids.length!==node.rows.length||ids.some(id=>typeof id!=='string'||!id||id.length>100)||new Set(ids).size!==ids.length)){message('现有行编号暂时不能准确对应，未加行。可放到白板核对后继续，当前内容保留。');return}
    if(['cellItems','cellImages'].some(key=>node[key]!==undefined&&(!Array.isArray(node[key])||node[key].slice(node.rows.length).some(hasMaterials)))){message('现有末行之外还有格内资料，未加行。可放到白板核对后继续，当前内容保留。');return}
    capturePiece();const r=node.rows.length,row=node.columns.map(()=>''),line=element('tr'),offset=tableFieldOffset();let id;
    if(Array.isArray(ids)){do{id=uid()}while(ids.includes(id));ids.push(id)}node.rows.push(row);
    const fields=node.columns.map((_,c)=>{const cell=element('td'),label=element('label','','第 '+(r+1)+' 行，第 '+(c+1)+' 列'),field=element('textarea');field.rows=3;field.dataset.libraryTableField=String(offset+c);label.append(field);cell.append(label);line.append(cell);return {field,path:['rows',r,c],root:node,initial:'',initialValue:''}});
    grid.querySelector('tbody').append(line);state.documentFields.push(...fields);stack.push({row,id});refresh();state.refreshTableColumnControls?.();state.refreshTableTextControls?.();message('已加第 '+(r+1)+' 行。填写后点“保存到内容库”留存。');fields[0]?.field.focus({preventScroll:true});fields[0]?.field.scrollIntoView({block:'nearest'});
   };
   undo.onclick=()=>{
    if(!canChange()||!stack.length)return;capturePiece();const last=stack.at(-1),r=node.rows.length-1;
    if(node.rows[r]!==last.row||(last.id!==undefined&&node.rowIds?.[r]!==last.id)||last.row.some(value=>value!=='')||['cellItems','cellImages'].some(key=>hasMaterials(node[key]?.[r]))){message('新增末行已有内容或对应发生变化，未撤回；所有输入仍保留。');return}
    const line=grid.querySelector('tbody')?.lastElementChild;if(!line||grid.querySelector('tbody').children.length!==node.rows.length)return;
    node.rows.pop();if(last.id!==undefined)node.rowIds.pop();state.documentFields=state.documentFields.filter(control=>!(control.root===node&&control.path[0]==='rows'&&control.path[1]===r));line.remove();stack.pop();refresh();state.refreshTableColumnControls?.();state.refreshTableTextControls?.();message('已撤回新增空行，其他格子和输入保留。');add.focus({preventScroll:true});
   };
   state.refreshTableRowControls=refresh;refresh();
  }
  function mountTableColumnActions(node){
   state.form.querySelector('.library-table-column-actions')?.remove();state.refreshTableColumnControls=null;
   if(!ordinaryTable(node))return;
   const grid=state.form.querySelector('#libraryFields .library-document-edit-table');if(!grid)return;
   const box=element('section','library-table-column-actions'),actions=element('div','library-table-text-actions'),add=element('button','','加一列'),undo=element('button','','撤回新增空列'),status=element('p','library-edit-explain');
   add.type=undo.type='button';add.dataset.libraryTableAddColumn='';undo.dataset.libraryTableUndoColumn='';status.dataset.libraryTableColumnState='';status.setAttribute('role','status');actions.append(add,undo);box.append(actions,element('p','library-edit-explain','可在末尾新增一个字段；只有这次新增且列名、格子仍为空的末列可以撤回。'),status);(state.form.querySelector('.library-table-row-actions')||grid).after(box);
   const stack=appendedColumns.get(node)||[];appendedColumns.set(node,stack);
   const owns=()=>active(state)&&box.isConnected&&grid.isConnected&&state.form.contains(box)&&state.form.contains(grid)&&state.draft.bundle.nodes[index]===node;
   const message=value=>{if(owns())status.textContent=value};
   const refresh=()=>{if(!owns())return;const unavailable=state.busy||!!tableScopeProblem(state);add.disabled=unavailable||node.rows.length>100||!node.columns.length||node.columns.length>=12;undo.hidden=!stack.length;undo.disabled=unavailable||!stack.length};
   const canChange=()=>{if(!owns()||state.busy)return false;const scope=tableScopeProblem(state);if(scope){message(scope);return false}const pending=state.tableTextSaveProblem?.();if(pending){message(pending);return false}return true};
   const nonempty=value=>value!==undefined&&value!==null&&(!Array.isArray(value)||value.length>0);
   const materialBeyond=c=>['cellItems','cellImages'].some(key=>node[key]!==undefined&&(!Array.isArray(node[key])||node[key].some(row=>row!==undefined&&row!==null&&(!Array.isArray(row)||row.slice(c).some(nonempty)))));
   const setWidth=()=>{grid.querySelector('table').style.minWidth=Math.max(320,node.columns.length*160)+'px'};
   add.onclick=()=>{
    if(!canChange())return;const c=node.columns.length;
    if(node.rows.length>100||!c||c>=12){message('这里支持最多100行、12列，当前内容保留；更大的表格可放到白板继续。');return}
    if(node.rows.some(row=>row.length!==c||Array.from({length:c},(_,i)=>i).some(i=>!Object.hasOwn(row,i)))){message('现有行列暂时不能完整对应，未加列。可放到白板核对后继续，当前内容保留。');return}
    const ids=node.columnIds;if(ids!==undefined&&(!Array.isArray(ids)||ids.length!==c||ids.some(id=>typeof id!=='string'||!id||id.length>100)||new Set(ids).size!==ids.length)){message('现有列编号暂时不能准确对应，未加列。可放到白板核对后继续，当前内容保留。');return}
    if(materialBeyond(c)){message('现有末列之外还有格内资料，未加列。可放到白板核对后继续，当前内容保留。');return}
    const head=grid.querySelector('thead tr'),lines=[...grid.querySelectorAll('tbody tr')];if(!head||head.children.length!==c||lines.length!==node.rows.length||lines.some(line=>line.children.length!==c))return;
    capturePiece();let id;if(Array.isArray(ids)){do{id=uid()}while(ids.includes(id));ids.push(id)}node.columns.push('');for(const row of node.rows)row.push('');
    const fields=[],offset=tableFieldOffset(),append=(line,path,labelText,rows,kind)=>{const cell=element(kind),label=element('label','',labelText),field=element('textarea');field.rows=rows;field.dataset.libraryTableField=String(offset+fields.length);label.append(field);cell.append(label);line.append(cell);fields.push({field,path,root:node,initial:'',initialValue:''})};
    append(head,['columns',c],'列 '+(c+1),1,'th');lines.forEach((line,r)=>append(line,['rows',r,c],'第 '+(r+1)+' 行，第 '+(c+1)+' 列',3,'td'));state.documentFields.push(...fields);stack.push({c,id,columns:node.columns,ids:node.columnIds});setWidth();refresh();state.refreshTableRowControls?.();state.refreshTableTextControls?.();message('已加第 '+(c+1)+' 列。填写列名和格子后点“保存到内容库”留存。');fields[0].field.focus({preventScroll:true});fields[0].field.scrollIntoView({block:'nearest'});
   };
   undo.onclick=()=>{
    if(!canChange()||!stack.length)return;capturePiece();const last=stack.at(-1),c=node.columns.length-1;
    if(c!==last.c||node.columns!==last.columns||node.columnIds!==last.ids||(last.id!==undefined&&node.columnIds?.[c]!==last.id)||node.columns[c]!==''||node.rows.some(row=>row.length!==c+1||row[c]!=='')||materialBeyond(c)){message('新增末列已有内容或对应发生变化，未撤回；所有输入仍保留。');return}
    const head=grid.querySelector('thead tr'),lines=[...grid.querySelectorAll('tbody tr')];if(!head||head.children.length!==c+1||lines.length!==node.rows.length||lines.some(line=>line.children.length!==c+1))return;
    node.columns.pop();for(const row of node.rows)row.pop();if(last.id!==undefined)node.columnIds.pop();head.lastElementChild.remove();for(const line of lines)line.lastElementChild.remove();state.documentFields=state.documentFields.filter(control=>!(control.root===node&&((control.path[0]==='columns'&&control.path[1]===c)||(control.path[0]==='rows'&&control.path[2]===c))));stack.pop();setWidth();refresh();state.refreshTableRowControls?.();state.refreshTableTextControls?.();message('已撤回新增空列，其他格子和输入保留。');add.focus({preventScroll:true});
   };
   state.refreshTableColumnControls=refresh;refresh();
  }
  function ordinaryTableFields(node){
   const controls=[],field=(path,label,value,rows)=>{const i=controls.length;controls.push({path,value,root:node});return '<label>'+esc(label)+'<textarea data-library-table-field="'+i+'" rows="'+rows+'"></textarea></label>'};
   const html='<div class="library-document-edit-table" tabindex="0" role="region" aria-label="表格文字"><table style="min-width:'+Math.max(320,node.columns.length*160)+'px"><thead><tr>'+node.columns.map((value,c)=>'<th>'+field(['columns',c],'列 '+(c+1),value,1)+'</th>').join('')+'</tr></thead><tbody>'+node.rows.map((row,r)=>'<tr>'+node.columns.map((_,c)=>'<td>'+(Object.hasOwn(row,c)?field(['rows',r,c],'第 '+(r+1)+' 行，第 '+(c+1)+' 列',row[c],3):'')+((node.cellItems?.[r]?.[c]?.length||node.cellImages?.[r]?.[c]?.length)?'<small>格内资料原样保留</small>':'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
   return {html,controls};
  }
  const draw=()=>{
   if(!active(state))return;
   const node=state.draft.bundle.nodes[index],documentContent=node.type==='table'&&node.documentMode===true?documentFields(node):null,tableText=ordinaryTable(node)?ordinaryTableFields(node):null,content=documentContent||tableText;state.documentFields=[];
   state.form.querySelector('#libraryFields').innerHTML=field('title',original?'标题':'标题（可不填）',1)+(content?content.html+'<details class="library-document-description" '+(node.body?'open':'')+'><summary>说明</summary>'+field('body','说明',2)+'</details>':field('body','正文',7));
   if(content)state.documentFields=content.controls.map((control,i)=>{const field=state.form.querySelector('[data-library-'+(tableText?'table':'document')+'-field="'+i+'"]');fillTextarea(field,String(control.value??''));return {field,path:control.path,root:control.root,initial:field.value,initialValue:copy(control.value)}});
   state.form.querySelector('#librarySupplement').innerHTML=field('userText','自己的补充',3)+field('annotation','备注',2)+(node.type==='table'?'<p class="library-edit-explain">'+(node.documentMode===true?'内容结构与附件保持。增删或移动文中内容时，可放到白板编辑后再收录。':'可直接修改列名和格子文字，也可在末尾加行、加列，格内资料原样保留。删除或移动已有行列时，可放到白板编辑后再收录。')+'</p>':'');
   for(const key of ['title','body','userText','annotation'])fillTextarea(state.form.querySelector('#library-'+key),state.draft.bundle.nodes[index][key]);
   mountTableRowActions(node);mountTableColumnActions(node);
  };
  function mountTextIntake(){
   const node=state.draft.bundle.nodes[0],initial=tableContent(node),panel=element('details','library-table-text-intake'),summary=element('summary','','从表格文本开始'),explain=element('p','library-edit-explain','贴入已有表格文字，先预览，再建成行列。支持100行、12列的小表格；调整后点“保存到内容库”留存。'),textLabel=element('label','','表格文本'),input=element('textarea'),formatLabel=element('label','','分隔方式'),format=element('select'),headerLabel=element('label'),header=element('input'),status=element('p','library-edit-explain'),preview=element('div','library-table-text-preview'),actions=element('div','library-table-text-actions'),apply=element('button','','建成表格'),undo=element('button','','撤回这次建表');
   input.rows=6;input.dataset.libraryTableText='';format.dataset.libraryTableTextFormat='';
   for(const [value,label]of[['tsv','制表符（表格复制）'],['csv','逗号（CSV）']]){const option=element('option','',label);option.value=value;format.append(option)}
   headerLabel.className='library-table-text-header';header.type='checkbox';header.dataset.libraryTableTextHeader='';headerLabel.append(header,document.createTextNode('首行作为列名'));status.setAttribute('role','status');status.dataset.libraryTableTextState='';preview.dataset.libraryTableTextPreview='';apply.type=undo.type='button';apply.dataset.libraryTableTextApply='';undo.dataset.libraryTableTextUndo='';textLabel.append(input);formatLabel.append(format);actions.append(apply,undo);panel.append(summary,explain,textLabel,formatLabel,headerLabel,status,preview,actions);state.form.querySelector('#libraryFields').before(panel);
   let parsed=null,parsedKey='',parseError='',applied=null,caption='',lastField=null,readingFile=null,updateFileControls=()=>{};
   const textKey=()=>JSON.stringify([input.value,format.value,header.checked]);
   const owns=()=>active(state)&&state.draft.bundle.nodes.length===1&&state.draft.bundle.nodes[0]===node&&ordinaryTable(node);
   const untouched=()=>state.documentFields.every(({field,initial})=>field.value===initial)&&equal(tableContent(node),initial);
   const message=value=>{if(owns())status.textContent=value};
   function controls(){
    if(!owns())return;
    const scope=tableScopeProblem(state);input.readOnly=!!applied;format.disabled=header.disabled=!!applied||state.busy;apply.hidden=!!applied;undo.hidden=!applied;apply.disabled=!!scope||state.busy||!parsed||!untouched();undo.disabled=!!scope||state.busy;
    if(scope)message(scope);else if(state.busy)message('正在核对保存，文本与预览仍保留。');else if(applied&&applied.sourceKey!==textKey())message('文本预览已有变化，当前格子仍保留上次建表结果。要改用这份文本，可先撤回这次建表；后续格子输入会保留。');else if(!applied&&parsed)message(untouched()?caption:'这张新表已有格子输入，建表不会替换它；待建表文本仍在上方。');
    if(readingFile)apply.disabled=true;updateFileControls();
   }
   const canChange=()=>{if(!owns())return false;const scope=tableScopeProblem(state);if(scope){message(scope);return false}if(state.busy){message('正在核对保存，请稍后操作；文本仍保留。');return false}return true};
   function inspect(){
    if(!owns())return;parsed=null;parsedKey='';parseError='';preview.replaceChildren();
    if(!input.value.trim()){message('贴入文本后会显示行列预览。');controls();return}
    try{
     if(input.value.length>262144)throw Error('这段文本较长，请拆成更小的表格；输入仍保留。');
     const matrix=parseDelimited(input.value,format.value==='csv'?',':'\t'),height=matrix.length-(header.checked?1:0);
     if(height>100||matrix.some(row=>row.length>12))throw Error('这里支持最多100行、12列；输入仍保留，可用原白板导入更大的表格。');
     if(!matrix.some(row=>row.some(value=>value.trim())))throw Error('没有找到表格文字，请检查输入。');
     parsed=tableData(matrix,header.checked);parsedKey=textKey();caption=parsed.rows.length+' 行 · '+parsed.columns.length+' 列。预览前5行、6列及每格前160字，建表会保留完整文字。';
     const table=element('table'),head=element('thead'),titles=element('tr'),body=element('tbody'),short=value=>{const letters=Array.from(String(value??''));return letters.slice(0,160).join('')+(letters.length>160?'…':'')};
     table.style.minWidth=Math.max(320,Math.min(parsed.columns.length,6)*140)+'px';head.append(titles);table.append(head,body);preview.append(table);
     for(const value of parsed.columns.slice(0,6))titles.append(element('th','',short(value)));
     for(const values of parsed.rows.slice(0,5)){const row=element('tr');for(const value of values.slice(0,6)){const cell=element('td');cell.append(element('pre','',short(value)));row.append(cell)}body.append(row)}message(caption);
    }catch(error){parseError=error.message||'暂时不能解析，输入仍保留。';message(parseError)}
    controls();
   }
   const write=value=>{for(const key of tableKeys)if(Object.hasOwn(value,key))node[key]=copy(value[key]);else delete node[key]};
   apply.onclick=()=>{
    if(!canChange()||!parsed||applied)return;if(parsedKey!==textKey()){inspect();message('文本或设定已有变化，请核对预览后再建表。');return}capturePiece();if(!untouched()){controls();return}
    const grid=state.form.querySelector('#libraryFields .library-document-edit-table');if(!grid||!state.form.contains(grid))return;
    const priorFields=state.documentFields,origin=lastField&&grid.contains(lastField)?lastField:priorFields.find(({path})=>path[0]==='rows')?.field||priorFields[0]?.field;
    const focus=origin?{field:origin,start:origin.selectionStart,end:origin.selectionEnd,direction:origin.selectionDirection,top:origin.scrollTop,left:origin.scrollLeft}:null;
    const data={columns:copy(parsed.columns),rows:copy(parsed.rows),columnIds:parsed.columns.map(()=>uid()),rowIds:parsed.rows.map(()=>uid())};write(data);
    const content=ordinaryTableFields(node),box=element('div');box.innerHTML=content.html;const next=box.firstElementChild;
    const fields=content.controls.map((control,i)=>{const field=next.querySelector('[data-library-table-field="'+i+'"]');fillTextarea(field,String(control.value??''));return {field,path:control.path,root:node,initial:field.value,initialValue:copy(control.value)}});
    grid.replaceWith(next);state.documentFields=fields;applied={before:copy(initial),grid,next,fields:priorFields,after:tableContent(node),focus,sourceKey:parsedKey};mountTableRowActions(node);mountTableColumnActions(node);controls();message('已建成 '+node.rows.length+' 行、'+node.columns.length+' 列。可继续改格子，再保存到内容库。');const target=fields.find(({path})=>path[0]==='rows')?.field||fields[0]?.field;target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});
   };
   undo.onclick=()=>{
    if(!canChange()||!applied)return;capturePiece();if(!equal(tableContent(node),applied.after)){message('表格已有后续输入，未撤回。当前格子与文本仍保留，可另建一张表。');return}
    if(!applied.next.isConnected||!state.form.contains(applied.next))return;const before=applied;write(before.before);before.next.replaceWith(before.grid);state.documentFields=before.fields;applied=null;mountTableRowActions(node);mountTableColumnActions(node);controls();message('已回到建表前的格子，文本输入仍保留。');if(before.focus?.field.isConnected){const f=before.focus;f.field.focus({preventScroll:true});f.field.setSelectionRange(f.start,f.end,f.direction);f.field.scrollTop=f.top;f.field.scrollLeft=f.left}
   };
   for(const field of[input,format,header])field.addEventListener('input',inspect);
   state.form.addEventListener('focusin',event=>{if(event.target.matches('[data-library-table-field]'))lastField=event.target});
   state.form.addEventListener('input',event=>{if(owns()&&event.target.matches('[data-library-table-field]')){if(!applied)capturePiece();controls()}});
   state.tableTextSaveProblem=()=>{
    if(!owns())return '';
    const issue=readingFile?'正在读取已选文件，请等读取结束，或取消读取后再保存。':applied?(applied.sourceKey!==textKey()?'文本或设定已有变化，请保留当前输入并重新核对建表结果。':''):input.value.trim()?(parseError||'文本尚未建成格子，请先“建成表格”，或明确清空这段文本后保存当前格子。'):'';
    if(issue){panel.open=true;message(issue);input.focus({preventScroll:true});input.scrollIntoView({block:'nearest'})}return issue;
   };
   function mountSelectedFile(){
    const file=assetSelected.size===1?assetById([...assetSelected][0]):null;
    const kind=file&&!file.archived&&file.mime!==bundleMime?(/\.tsv$/i.test(file.path||'')||file.mime==='text/tab-separated-values'?'tsv':/\.csv$/i.test(file.path||'')||file.mime==='text/csv'?'csv':null):null;
    if(!kind)return;
    const originalFile=copy(file),section=element('section','library-table-file-source'),label=element('p','library-edit-explain','库中已选：'+(file.folder?file.folder+' / ':'')+file.title),help=element('p','library-edit-explain','可读取这份CSV/TSV的完整UTF-8文字（文件最多1MB），无需下载转抄。原文件保留，新表格独立保存。'),fileActions=element('div','library-table-text-actions'),read=element('button','','读取已选文件'),cancel=element('button','','取消读取');
    read.type=cancel.type='button';read.dataset.libraryTableFileRead='';cancel.dataset.libraryTableFileCancel='';section.dataset.libraryTableFileSource='';fileActions.append(read,cancel);section.append(label,help,fileActions);textLabel.before(section);
    const sameFile=()=>assetSelected.size===1&&assetSelected.has(file.id)&&equal(assetById(file.id),originalFile);
    updateFileControls=()=>{if(!owns())return;read.disabled=!!applied||state.busy||!!readingFile||!!tableScopeProblem(state)||!untouched()||input.value!==''||!sameFile();cancel.hidden=!readingFile;cancel.disabled=!readingFile};
    const stop=show=>{const request=readingFile;if(!request)return;readingFile=null;request.controller.abort();if(show&&owns())message('已停止读取，当前文字与格子保留。');controls()};
    cancel.onclick=()=>stop(true);
    for(const field of[input,format,header])field.addEventListener('input',()=>stop(false));
    onDialogDismiss(()=>stop(false));
    read.onclick=async()=>{
     if(!canChange()||readingFile||applied||input.value!==''||!untouched()||!sameFile())return;
     if(Number(file.size)>1048576){message('这份文件较大，请用原白板导入；原文件与当前表格保留。');return}
     const request={controller:new AbortController(),key:textKey(),timedOut:false};readingFile=request;controls();message('正在读取已选文件，当前表格保留。');const timer=setTimeout(()=>{request.timedOut=true;request.controller.abort()},15000);
     try{
      const response=await fetch(mediaURL(file.id),{signal:request.controller.signal,cache:'no-store'});
      if(!response.ok)throw Error('文件暂时无法读取（'+response.status+'），原文件与当前表格保留。');
      if(response.status!==200)throw Error('这次只读到了部分文件，未用于建表；请重新读取。');
      if(Number(response.headers.get('Content-Length'))>1048576)throw Error('这份文件较大，请用原白板导入；原文件与当前表格保留。');
      const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true}),decode=(value,options)=>{try{return decoder.decode(value,options)}catch{throw Error('这份文件暂时无法按UTF-8文字读取，请检查文件编码；原文件与表格保留。')}};let bytes=0,value='';
      try{
       while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>1048576)throw Error('这份文件较大，请用原白板导入；原文件与当前表格保留。');value+=decode(chunk.value,{stream:true});if(value.length>262144)throw Error('这份文件文字较长，请用原白板导入；当前表格保留。')}
       value+=decode();if(value.length>262144)throw Error('这份文件文字较长，请用原白板导入；当前表格保留。');
      }catch(error){try{await reader.cancel()}catch{}throw error}finally{reader.releaseLock()}
      if(readingFile!==request||!owns())return;
      if(!canChange()||!sameFile()||textKey()!==request.key||!untouched()){message('已有后续输入或文件信息变化，未替换文字；当前表格保留。');return}
      input.value=value;format.value=kind;inspect();if(document.hasFocus()&&document.activeElement===read){input.focus({preventScroll:true});input.scrollIntoView({block:'nearest'})}
     }catch(error){
      if(readingFile!==request||!owns())return;
      message(request.timedOut?'读取超时，当前表格保留。可以重新读取。':error.name==='AbortError'?'已停止读取，当前表格保留。':error instanceof TypeError?'文件读取暂时中断，请重试；原文件与当前表格保留。':error.message||'文件暂时无法读取，当前表格保留。');
     }finally{request.controller.abort();clearTimeout(timer);if(readingFile===request){readingFile=null;controls()}}
    };
   }
   mountSelectedFile();state.refreshTableTextControls=controls;inspect();
  }
  state.capture=()=>{capturePiece();state.draft.title=original?$('libraryName').value.trim():newContentName(state.draft.bundle.nodes[0]);state.draft.folder=$('libraryDestination').value};
  setup(state);
  let piece=state.form.querySelector('#libraryPiece'),ownedPieceLabel=null;
  const noteKeys=['title','body','userText','annotation'];
  const ownedLastNote=()=>{
   const node=state.draft.bundle.nodes.at(-1);
   return node?.type==='note'&&state.addedNoteIds.has(node.id)&&!state.base?.bundle.nodes.some(old=>old.id===node.id)?node:null;
  };
  const emptyAddedNote=node=>noteKeys.every(key=>(node[key]||'')==='')&&!node.assetId&&!node.mediaId&&!node.url&&!node.images?.length&&!node.tags?.length;
  function refreshNoteControls(){
   if(!state.noteAdd)return;
   state.noteAdd.disabled=state.busy||!active(state);
   const node=ownedLastNote(),here=node&&state.draft.bundle.nodes[index]===node;
   const visible=here?{...node,...Object.fromEntries(noteKeys.map(key=>[key,state.form.querySelector('#library-'+key)?.value??node[key]]))}:node;
   state.noteUndo.hidden=!node;state.noteUndo.disabled=state.busy||!active(state)||!here||!emptyAddedNote(visible);
  }
  function selectPiece(event){
   if(!active(state)||event.currentTarget!==piece||!piece.isConnected)return;
   capturePiece();if(piece.options[index])piece.options[index].textContent=pieceLabel(state.draft.bundle.nodes[index],index);
   const next=Number(piece.value);if(!Number.isInteger(next)||next<0||next>=state.draft.bundle.nodes.length)return;
   index=next;draw();refreshNoteControls();
  }
  function rebuildPieces(){
   if(state.draft.bundle.nodes.length===1&&ownedPieceLabel){ownedPieceLabel.remove();ownedPieceLabel=null;piece=null;return}
   if(!piece){
    ownedPieceLabel=element('label','','选择要编辑的内容');piece=document.createElement('select');piece.id='libraryPiece';ownedPieceLabel.append(piece);state.form.querySelector('.library-content-writing').prepend(ownedPieceLabel);
   }
   piece.replaceChildren(...state.draft.bundle.nodes.map((node,i)=>new Option(pieceLabel(node,i),String(i))));piece.value=String(index);piece.onchange=selectPiece;
  }
  if(original){
   const actions=element('div','library-table-text-actions library-note-actions'),add=element('button','','添加便签'),undo=element('button','','撤回新增空白便签');
   add.type=undo.type='button';add.dataset.libraryAddNote='';undo.dataset.libraryUndoNote='';undo.title='只可撤回这次新增、尚未保存且仍为空的末尾便签';
   actions.append(add,undo);state.form.querySelector('#libraryFields').before(actions);state.noteAdd=add;state.noteUndo=undo;state.refreshNoteControls=refreshNoteControls;
   add.onclick=()=>{
    if(!active(state)||state.busy||!add.isConnected)return;
    capturePiece();const node=blankLibraryNote();if(state.draft.bundle.nodes.some(old=>old.id===node.id))return notice(state,'暂时未能添加，请重试。原内容保留。');
    let x=Infinity,bottom=-Infinity;
    for(const old of state.draft.bundle.nodes){const left=Number.isFinite(old.x)?old.x:0,top=Number.isFinite(old.y)?old.y:0,height=Number.isFinite(old.h)&&old.h>0?old.h:120;x=Math.min(x,left);bottom=Math.max(bottom,top+height)}
    const y=bottom+40;if(!Number.isFinite(x)||!Number.isFinite(y)||y<=bottom)return notice(state,'这份资源的范围过大，请先在白板调整后再添加。原内容保留。');
    node.x=x;node.y=y;state.draft.bundle.nodes.push(node);state.addedNoteIds.add(node.id);index=state.draft.bundle.nodes.length-1;state.savedInPlace=false;notice(state,'');
    rebuildPieces();draw();refreshNoteControls();state.form.querySelector('#library-body')?.focus({preventScroll:true});
   };
   undo.onclick=()=>{
    if(!active(state)||state.busy||!undo.isConnected)return;
    capturePiece();const node=ownedLastNote();if(!node||state.draft.bundle.nodes[index]!==node||!emptyAddedNote(node))return;
    state.draft.bundle.nodes.pop();state.addedNoteIds.delete(node.id);index=Math.max(0,state.draft.bundle.nodes.length-1);state.savedInPlace=false;notice(state,'已撤回这次新增的空白便签');
    rebuildPieces();draw();refreshNoteControls();(piece||state.form.querySelector('#libraryName'))?.focus({preventScroll:true});
   };
   state.form.addEventListener('input',refreshNoteControls);
  }
  state.refreshSavedPieceLabel=()=>{if(piece?.options[index])piece.options[index].textContent=pieceLabel(state.draft.bundle.nodes[index],index);refreshNoteControls()};
  if(piece)piece.onchange=selectPiece;
  draw();if(!original&&kind==='table')mountTextIntake();const documentField=state.form.querySelector('[data-library-document-field]'),newTableField=!original&&kind==='table'?state.form.querySelector('[data-library-table-field="3"]'):null;if(documentField||newTableField)(documentField||newTableField).focus({preventScroll:true});else $(original?'libraryName':'library-body').focus();
  refreshNoteControls();
  keepWritingOnEscape(state);
 }
 window.whiteboardLibraryEditing={editFile,editContent,keepOnEscape:event=>escapeGuard?.(event)||false};
})();
