// Reading, placement and table sizing use the same rules in every document.
(() => {
 'use strict';
 // A control can open a menu over its own point before a fast second tap arrives.
 // Keep that double-click with its original controls instead of the canvas below.
 window.addEventListener('dblclick',e=>{const path=e.composedPath();if(path.includes(canvas)&&path.some(el=>el instanceof Element&&el.matches('#creationDock,#canvasTools,.block-actions,.inline-toolbar')))e.stopPropagation()},true);
 interfaceSettings=()=>whiteboardAppearance.open();
 canvas.addEventListener('click',e=>{const action=e.target.closest('.table-options button');if(action)action.closest('details').open=false});
 let immersion=null,widthGesture=null,widthKey=null;const widthBindings=new WeakMap();
 const priorKeyboardControl=isKeyboardControl;isKeyboardControl=e=>priorKeyboardControl(e)||Boolean(e.target.closest?.('.table-column-resize[role="separator"]'));
 function canvasBlock(id){return [...$('nodes').children].find(el=>el.dataset.id===id)}
 // Author positions belong to these exact board/node objects, never to saved content.
 const positions=new WeakMap(),authorFields=new Set(['title','body','userText','annotation','url','tags']);let restoringPosition=false,watchedField=null,watchedScope=null,watchedWidth=0;
 function ownsPosition(state){return state&&board===state.board&&boardId===state.boardId&&board.nodes.find(n=>n.id===state.node.id)===state.node}
 function rememberPosition(field,scope){
  if(restoringPosition||!field?.isConnected||!authorFields.has(field.id)||!field.matches('textarea,input'))return;
  const n=board?.nodes.find(n=>n.id===editorId),root=field.closest('.inner');if(!n||!root||root.closest('.node')?.dataset.id!==n.id||scope&&!ownsPosition(scope))return;
  const previous=positions.get(n),mode=field.closest('.immersive-surface')?'expanded':'canvas',area=root.querySelector('.edit-scroll'),details=root.querySelector('#inlineMeta'),extras=root.querySelector('#sourceExtras');
  const state={board,boardId,node:n,field:field.id,value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,detailsOpen:!!details?.open,extrasOpen:!!extras?.open,scrolls:previous?.field===field.id?{...previous.scrolls}:{}};
  state.scrolls[mode]={width:field.clientWidth,area:area?.scrollTop||0,details:details?.scrollTop||0,top:field.scrollTop,left:field.scrollLeft};positions.set(n,state);return state;
 }
 function activePosition(){const active=rememberPosition(document.activeElement),root=immersion?.surface||$('nodes').querySelector(':scope>.node>.inner.live-layout')?.parentElement,n=board?.nodes.find(n=>n.id===root?.dataset.id),state=n&&positions.get(n),details=root?.querySelector('#inlineMeta'),extras=root?.querySelector('#sourceExtras');if(ownsPosition(state)&&details?.isConnected){state.detailsOpen=details.open;state.extrasOpen=!!extras?.open}return active}
 function caretLine(field,offset){
  if(field.tagName!=='TEXTAREA')return {top:0,height:field.clientHeight};
  const s=getComputedStyle(field),mirror=document.createElement('div'),marker=document.createElement('span');
  Object.assign(mirror.style,{position:'fixed',left:'0',top:'0',visibility:'hidden',pointerEvents:'none',width:field.clientWidth+'px',boxSizing:'border-box',whiteSpace:'pre-wrap',overflowWrap:'break-word'});
  for(const key of ['fontFamily','fontSize','fontStyle','fontWeight','lineHeight','letterSpacing','wordSpacing','textTransform','textIndent','textAlign','direction','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','wordBreak'])mirror.style[key]=s[key];
  mirror.textContent=field.value.slice(0,offset);marker.textContent='\u200b';mirror.append(marker);document.body.append(mirror);
  try{return {top:marker.offsetTop,height:parseFloat(s.lineHeight)||parseFloat(s.fontSize)*1.5}}finally{mirror.remove()}
 }
 function revealPosition(field){
  const line=caretLine(field,field.selectionDirection==='backward'?field.selectionStart:field.selectionEnd),r=field.getBoundingClientRect(),scale=r.height/(field.offsetHeight||r.height||1),area=field.closest('#inlineMeta')||field.closest('.edit-scroll');if(!area||!scale)return;
  const a=area.getBoundingClientRect(),top=r.top+(field.clientTop+line.top-field.scrollTop)*scale,bottom=top+line.height*scale,margin=Math.min(24*scale,a.height/4);
  if(top<a.top+margin)area.scrollTop-=(a.top+margin-top)/scale;else if(bottom>a.bottom-margin)area.scrollTop+=(bottom-a.bottom+margin)/scale;
 }
 const writingResize=new ResizeObserver(()=>{
  const field=watchedField,scope=watchedScope;if(!field?.isConnected||document.activeElement!==field||!ownsPosition(scope)){writingResize.disconnect();watchedField=watchedScope=null;return}
  if(Math.abs(field.clientWidth-watchedWidth)<1)return;watchedWidth=field.clientWidth;growContentFields(field.closest('.node'));revealPosition(field);rememberPosition(field,scope);
 });
 function watchPosition(field,scope){writingResize.disconnect();watchedField=field;watchedScope=scope;watchedWidth=field.clientWidth;writingResize.observe(field)}
 function restorePosition(state){
  if(!ownsPosition(state)||editorId!==state.node.id)return;
  const root=immersion?.node===state.node?immersion.surface:canvasBlock(state.node.id);if(!root||$('dialog').open&&!root.closest('#dialog'))return;
  const field=root.querySelector('#'+state.field);if(!field||field.value!==state.value)return;
  const area=root.querySelector('.edit-scroll'),details=root.querySelector('#inlineMeta'),extras=root.querySelector('#sourceExtras'),mode=root.closest('.immersive-surface')?'expanded':'canvas',scroll=state.scrolls[mode];
  if(details?.contains(field)&&!state.detailsOpen)return;
  restoringPosition=true;
  try{
   if(details)details.open=state.detailsOpen;if(extras)extras.open=state.extrasOpen;growContentFields(root);
   if(extras?.contains(field)&&!state.extrasOpen){extras.querySelector('summary')?.focus({preventScroll:true});return}
   if(scroll&&Math.abs(scroll.width-field.clientWidth)<1){if(area)area.scrollTop=scroll.area;if(details)details.scrollTop=scroll.details;field.scrollTop=scroll.top;field.scrollLeft=scroll.left}
   field.focus({preventScroll:true});field.setSelectionRange(state.start,state.end,state.direction);revealPosition(field);
  }finally{restoringPosition=false}
 }
 const bindBeforePosition=bindInline;
 bindInline=function(){bindBeforePosition();const n=board?.nodes.find(n=>n.id===editorId),scope={board,boardId,node:n};if(!n)return;const root=canvasBlock(n.id)?.querySelector('.inner');if(!root)return;
  for(const field of root.querySelectorAll('textarea,input'))if(authorFields.has(field.id))for(const name of ['focusin','focusout','select','input','keyup','pointerup'])field.addEventListener(name,()=>{rememberPosition(field,scope);if(name==='focusin')watchPosition(field,scope);else if(name==='focusout'&&watchedField===field){writingResize.disconnect();watchedField=watchedScope=null}});
  for(const area of root.querySelectorAll('.edit-scroll,#inlineMeta'))area.addEventListener('scroll',()=>{const current=positions.get(n);if(!current)return;const field=root.querySelector('#'+current.field);if(field)rememberPosition(field,scope)});
  const details=root.querySelector('#inlineMeta');details?.addEventListener('toggle',()=>{if(!details.isConnected||!ownsPosition(scope))return;const state=positions.get(n);if(state)state.detailsOpen=details.open});
  const extras=root.querySelector('#sourceExtras');extras?.addEventListener('toggle',()=>{if(!extras.isConnected||!ownsPosition(scope))return;const state=positions.get(n);if(state)state.extrasOpen=extras.open;if(!extras.open&&extras.contains(document.activeElement)&&document.activeElement!==extras.querySelector('summary'))extras.querySelector('summary')?.focus({preventScroll:true});growContentFields(root);positionActions()});
  // Size the source panel in the initiating action, before its next pointer target appears.
  for(const id of ['inlineDetails','inlineMetaClose'])root.querySelector('#'+id)?.addEventListener('click',positionActions);
 };
 const openBeforePosition=openEditor;
 openEditor=function(id){cancelWidth();activePosition();openBeforePosition(id);const n=board?.nodes.find(n=>n.id===id);if(n?.type==='frame'){const field=canvasBlock(id)?.querySelector('[data-group-name]');field?.focus({preventScroll:true});field?.select()}else if(n)restorePosition(positions.get(n))};
 function restoreEditor(){if(!immersion||!ownsPosition(immersion))return;const inner=immersion.surface.querySelector('.inner');if(inner)canvasBlock(immersion.id)?.prepend(inner)}
 function bindImmersiveDetails(){
  const session=immersion,details=session?.surface.querySelector('#inlineMeta'),trigger=$('immersiveDetails');if(!details||!trigger)return;
  trigger.setAttribute('aria-expanded',String(details.open));
  details.ontoggle=()=>{if(immersion!==session)return;trigger.setAttribute('aria-expanded',String(details.open));growContentFields(session.surface);if(!details.open&&details.contains(document.activeElement))trigger.focus({preventScroll:true})};
 }
 function finishImmersion(session=immersion){if(!session||immersion!==session)return;activePosition();restoreEditor();immersion=null;$('dialog').classList.remove('reading-dialog','immersive-dialog');if(!ownsPosition(session))return;editorId=null;drawNodes();renderOutline();const area=canvasBlock(session.id)?.querySelector('.edit-scroll');if(area)area.scrollTop=session.originalScroll;canvas.focus({preventScroll:true})}
 const previousDialog=showDialog;showDialog=function(...args){if(immersion){finishImmersion();$('dialog').close()}return previousDialog(...args)};
 function expandEditor(){if(!immersion||!ownsPosition(immersion))return;const el=canvasBlock(immersion.id),inner=el?.querySelector('.inner');if(!inner)return;immersion.surface.className=el.className.replace(/\bactive\b/g,'')+' reading-sheet immersive-surface';immersion.surface.style.background=el.style.background;for(const key of ['--paper-ink','--paper-caption'])immersion.surface.style.setProperty(key,el.style.getPropertyValue(key));immersion.surface.style.setProperty('--body-size',(board.nodes.find(n=>n.id===immersion.id)?.fontSize||16)+'px');immersion.surface.style.setProperty('--title-size',(board.nodes.find(n=>n.id===immersion.id)?.titleFontSize||24)+'px');const toolbar=inner.querySelector(':scope>.inline-toolbar');if(toolbar){for(const key of ['transform','right','bottom','top','transform-origin'])toolbar.style.removeProperty(key);delete toolbar.dataset.position}const details=inner.querySelector(':scope>#inlineMeta');if(details)for(const key of ['left','top','width','max-height'])details.style.removeProperty(key);immersion.surface.replaceChildren(inner);if($('inlineDone'))$('inlineDone').onclick=()=>$('dialog').close();growContentFields(immersion.surface);bindImmersiveDetails();window.whiteboardNoteEditor?.mountRelations?.(immersion.node,immersion.surface)}
 function readNote(id){
  const n=board?.nodes.find(n=>n.id===id);if(!n)return;if(blocked)return toast('请先处理保存冲突');if(n.type==='frame')return openEditor(id);if(immersion){finishImmersion();$('dialog').close()}
  const originalScroll=canvasBlock(id)?.querySelector('.edit-scroll')?.scrollTop||0;
  openEditor(id);
  showDialog('<div class="immersive-heading"><span>展开编辑</span><div><button id="immersiveDetails" aria-controls="inlineMeta" aria-expanded="false">来源与备注</button><button id="immersiveReturn">返回白板 <small>Esc</small></button></div></div><article class="reading-sheet node immersive-surface" id="immersiveSurface"></article>',[]);
  const dialog=$('dialog');dialog.classList.add('reading-dialog','immersive-dialog');immersion={id,board,boardId,node:n,surface:$('immersiveSurface'),originalScroll};immersion.surface.dataset.id=id;const session=immersion;
  $('immersiveReturn').onclick=()=>dialog.close();$('immersiveDetails').onclick=()=>{$('inlineMeta').open=!$('inlineMeta').open;growContentFields()};expandEditor();
  restorePosition(positions.get(n));onDialogDismiss(()=>finishImmersion(session));
 }
 const originalFit=whiteboardExperience.fitBlock;
 whiteboardExperience.fitBlock=function(id){const el=canvasBlock(id),n=board.nodes.find(n=>n.id===id),area=el?.querySelector('.edit-scroll'),gallery=area?.querySelector(':scope>.single-image'),img=gallery?.querySelector('img');if(!n||!img?.naturalWidth)return originalFit(id);const style=getComputedStyle(area),width=area.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),other=[...area.children].filter(c=>c!==gallery&&getComputedStyle(c).display!=='none').reduce((sum,c)=>{const s=getComputedStyle(c);return sum+c.offsetHeight+parseFloat(s.marginTop||0)+parseFloat(s.marginBottom||0)},0);undoPoint();n.h=Math.ceil(Math.max(120,Math.min(5000,width*img.naturalHeight/img.naturalWidth+other+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+10)));drawNodes();change()};
 const previousMenu=fileMenu;fileMenu=function(e,items){const el=e.target.closest?.('.node[data-id]');if(el&&!e.target.closest('[data-edge]')){const source=board,sourceId=boardId,n=board.nodes.find(n=>n.id===el.dataset.id),record=n&&n.type!=='frame'&&selected.size===1&&selected.has(n.id)&&canvas.classList.contains('record-in-menu')&&window.whiteboardNoteEditor?.writeFrom;items=[['展开编辑',()=>readNote(el.dataset.id)],...(record?[['写记录',()=>{if(board===source&&boardId===sourceId&&board.nodes.includes(n))whiteboardNoteEditor.writeFrom(n.id)}]]:[]),...items.map(([label,fn])=>[label,label==='按内容调整大小'?()=>whiteboardExperience.fitBlock(el.dataset.id):fn])]}return previousMenu(e,items)};
 // Keep the existing actions and fields; narrow panes only change how they are reached.
 const dock=$('creationDock'),textTools=$('textSizeTools'),more=document.createElement('button');
 more.id='creationMore';more.textContent='⋯';more.title='创作工具';more.setAttribute('aria-label','创作工具');more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-controls','fileContext');more.setAttribute('aria-expanded','false');dock.append(more);
 more.onclick=e=>{
  const r=more.getBoundingClientRect(),items=[];
  if(canvas.classList.contains('tiny-tools'))items.push(['新建便签  N',()=>$('add').click()],['新建表格  T',()=>$('addTable').click()]);
  items.push(...whiteboardExperience.importOptions());
  if(!$('undo').disabled)items.push(['撤销  Ctrl+Z',()=>$('undo').click()]);
  if(!$('redo').disabled)items.push(['重做  Ctrl+Shift+Z',()=>$('redo').click()]);
  if(!$('collectToLibrary').hidden&&!canvas.classList.contains('multi-actions')&&!canvas.classList.contains('local-collect'))items.push(['保存到库  Ctrl+Shift+L',()=>$('collectToLibrary').click()]);
  if(!textTools.hidden)items.push(['调整字号…',()=>{textTools.open=true;positionActions();$('noteTitleSize').focus({preventScroll:true})}]);
  fileMenu({target:more,clientX:r.left,clientY:r.top,preventDefault:()=>e.preventDefault(),stopPropagation:()=>e.stopPropagation()},items);
 };
 textTools.addEventListener('toggle',positionActions);
 textTools.addEventListener('keydown',e=>{if(e.key==='Escape'&&e.defaultPrevented&&canvas.classList.contains('compact-tools'))more.focus({preventScroll:true})});
 // Batch actions belong to the selection; each paper keeps its own Edit/View.
 const selectionTools=document.createElement('div');selectionTools.id='selectionTools';selectionTools.className='block-actions selection-tools inline-ui';selectionTools.hidden=true;selectionTools.setAttribute('role','group');selectionTools.setAttribute('aria-label','选中内容的操作');
 selectionTools.innerHTML='<button type="button" class="selection-count" aria-label="查看选中内容" aria-expanded="false" aria-controls="selectionContents"></button><button type="button" data-selection-collect>保存到库</button><button type="button" data-selection-align>对齐</button><button type="button" data-selection-group>分组</button><button type="button" class="selection-transfer" draggable="true" aria-label="拖出所选内容副本" title="按住拖动，把选中内容的副本放到表格、内容库或另一张白板"><span aria-hidden="true">⠿</span><span class="transfer-caption">拖出副本</span></button><button type="button" id="selectionMore" aria-label="选中内容的更多操作" aria-haspopup="menu" aria-controls="fileContext" aria-expanded="false">⋯</button>';canvas.append(selectionTools);
 let selectionScope=null;
 function selectionExists(scope){if(!scope||board!==scope.board||boardId!==scope.id||loading||selected.size!==scope.nodes.length)return false;const current=new Set(board.nodes);return scope.nodes.every(n=>selected.has(n.id)&&current.has(n));}
 function ownsSelection(scope=selectionScope){return !blocked&&selectionExists(scope)}
 const selectionCount=selectionTools.querySelector('.selection-count'),contents=document.createElement('div');contents.id='selectionContents';contents.className='selection-contents inline-ui';contents.hidden=true;contents.setAttribute('role','group');contents.setAttribute('aria-label','选中内容，选择后展开编辑');canvas.append(contents);
 let contentsScope=null,selectionVisit=null,contentsPage=0,contentsInDialog=false;
 const contentsPageSize=8,contentsTitle=n=>String(n.title||'').trim()||String(n.body||'').split('\n').find(line=>line.trim())?.trim().slice(0,60)||'未命名';
 const visiblePane=()=>!frameElement||!frameElement.hidden&&!!frameElement.getClientRects().length;
 const parentModal=()=>{try{return parent!==window&&!!parent.document.querySelector('dialog[open]');}catch{return true;}};
 function closeContents(restoreFocus=false){const modal=contentsInDialog;contentsScope=null;contentsInDialog=false;contents.hidden=true;contents.replaceChildren();selectionCount.setAttribute('aria-expanded','false');if(modal&&$('dialog').open&&contents.closest('dialog'))$('dialog').close();if(restoreFocus&&visiblePane()&&selectionCount.getClientRects().length)selectionCount.focus({preventScroll:true});}
 function chooseContent(scope,n,button){
  if(contentsScope!==scope||!button.isConnected||!contents.contains(button)||contents.hidden||!visiblePane()||!document.hasFocus()||parentModal()||!ownsSelection(scope)||saveError||$('dialog').open&&!contents.closest('dialog'))return;
  closeContents();const r=canvas.getBoundingClientRect(),z=Math.max(.15,Math.min(1.1,view().z,Math.max(1,r.width-48)/n.w,Math.max(1,r.height-100)/n.h));whiteboardCanvasViews.navigate({cx:n.x+n.w/2,cy:n.y+n.h/2,z});selected=new Set([n.id]);refreshSelectionUI();if(n.assetId)wfSafe(()=>previewAsset(n.assetId));else whiteboardReading.open(n.id);
 }
 function renderContents(){
  const scope=contentsScope;if(!ownsSelection(scope))return closeContents();contents.replaceChildren();const list=document.createElement('div');list.className='selection-contents-list';contents.append(list);
  for(const [i,n]of scope.nodes.slice(contentsPage*contentsPageSize,(contentsPage+1)*contentsPageSize).entries()){
   const button=document.createElement('button'),number=document.createElement('small'),title=document.createElement('span'),verb=document.createElement('small');button.type='button';number.textContent=String(contentsPage*contentsPageSize+i+1).padStart(2,'0');title.textContent=contentsTitle(n);verb.textContent=n.assetId?'查看':'编辑';button.title=title.textContent;button.setAttribute('aria-label',verb.textContent+'选中内容：'+title.textContent);button.append(number,title,verb);button.onclick=()=>chooseContent(scope,n,button);list.append(button);
  }
  if(scope.nodes.length>contentsPageSize){const nav=document.createElement('nav');nav.className='selection-contents-pages';nav.setAttribute('aria-label','选中内容分页');for(const [label,delta]of [['上一页',-1],['下一页',1]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=contentsPage+delta<0||(contentsPage+delta)*contentsPageSize>=scope.nodes.length;button.onclick=()=>{if(!button.isConnected||!contents.contains(button)||contentsScope!==scope||!ownsSelection(scope)||!visiblePane()||!document.hasFocus()||parentModal())return;contentsPage+=delta;renderContents();positionContents();contents.querySelector('.selection-contents-list button')?.focus({preventScroll:true});};nav.append(button);}const count=document.createElement('small');count.textContent=(contentsPage*contentsPageSize+1)+'–'+Math.min((contentsPage+1)*contentsPageSize,scope.nodes.length)+' / '+scope.nodes.length;nav.insertBefore(count,nav.lastChild);contents.append(nav);}
 }
 function contentsDialog(){
  const scope=contentsScope;if(!ownsSelection(scope))return;showDialog('<h2 class="selection-contents-heading">选中内容 · '+scope.nodes.length+' 项</h2>',[['返回白板',()=>$('dialog').close()]]);$('dialogBody').append(contents);contents.classList.add('in-dialog');contentsInDialog=true;onDialogDismiss(()=>{canvas.append(contents);contents.classList.remove('in-dialog');closeContents();});contents.querySelector('.selection-contents-list button')?.focus({preventScroll:true});
 }
 function positionContents(explicit=false){
  if(!contentsScope)return;if(!ownsSelection(contentsScope)||!visiblePane()||!canvas.clientWidth||!canvas.clientHeight)return closeContents();if(contentsInDialog)return;if($('dialog').open)return closeContents();
  const r=canvas.getBoundingClientRect(),a=selectionTools.getBoundingClientRect(),tools=$('canvasTools').getBoundingClientRect(),d=dock.getClientRects().length?dock.getBoundingClientRect():null,above=a.top-Math.max(r.top+6,tools.bottom+8)-8,below=Math.min(r.bottom-6,d?d.top-8:r.bottom-6)-a.bottom-8,room=Math.max(above,below),useAbove=above>=below;
  if(room<100||r.width<160){if(explicit)return contentsDialog();return closeContents();}
  contents.style.maxHeight=Math.min(300,room)+'px';contents.style.width=Math.min(360,r.width-12)+'px';const size=contents.getBoundingClientRect();contents.style.left=(Math.max(r.left+6,Math.min(a.left,r.right-size.width-6))-r.left)+'px';contents.style.top=(useAbove?a.top-size.height-8-r.top:a.bottom+8-r.top)+'px';
 }
 function openContents(explicit=true){
  if(!ownsSelection()||saveError||!visiblePane()||parentModal()||explicit&&!document.hasFocus()||$('dialog').open)return false;closeContents();selectionVisit=selectionScope;selectionTools.classList.add('selection-browsing');positionActions();contentsScope=selectionScope;contentsPage=0;contents.hidden=false;selectionCount.setAttribute('aria-expanded','true');renderContents();positionContents(explicit);if(explicit&&!contents.hidden)contents.querySelector('.selection-contents-list button')?.focus({preventScroll:true});return true;
 }
 selectionCount.onclick=()=>{if(!document.hasFocus()||parentModal())return;if(contentsScope)closeContents(true);else openContents();};
 contents.addEventListener('pointerdown',e=>e.stopPropagation());contents.addEventListener('dblclick',e=>e.stopPropagation());
 document.addEventListener('pointerdown',e=>{if(contentsScope&&!contentsInDialog&&!contents.contains(e.target)&&e.target!==selectionCount)closeContents();},true);
 document.addEventListener('keydown',e=>{if(!contentsScope)return;if(e.key==='Escape'&&!$('dialog').open){e.preventDefault();e.stopImmediatePropagation();closeContents(true);}else if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase()))closeContents();},true);
 new ResizeObserver(()=>{if(!visiblePane())closeContents();else positionContents();}).observe(canvas);
 window.addEventListener('creative-board-loading',()=>{selectionVisit=null;closeContents();});
 window.whiteboardSelectionContents={reveal(ids){if(!ownsSelection()||!visiblePane()||ids.length!==selectionScope.nodes.length||new Set(ids).size!==ids.length)return false;const chosen=new Set(ids);if(!selectionScope.nodes.every(n=>chosen.has(n.id)))return false;const r=canvas.getBoundingClientRect(),v=view();if(!r.width||!r.height||selectionScope.nodes.every(n=>n.x*v.z+v.x>=16&&n.y*v.z+v.y>=16&&(n.x+n.w)*v.z+v.x<=r.width-16&&(n.y+n.h)*v.z+v.y<=r.height-16))return false;return openContents(false);}};
 function syncSelectionTools(){
  const nodes=board?.nodes.filter(n=>selected.has(n.id))||[],active=nodes.length>1&&!editorId;
  canvas.classList.toggle('multi-actions',active);selectionTools.hidden=!active;selectionScope=active?{board,id:boardId,nodes}:null;
  if(!selectionExists(selectionVisit))selectionVisit=null;selectionTools.classList.toggle('selection-browsing',!!selectionVisit);if(contentsScope&&!ownsSelection(contentsScope))closeContents();
  if(!active){closeContents();if(selectionTools.contains(document.activeElement))canvas.focus({preventScroll:true});return}
  const count=nodes.length+' 项',label=selectionCount;if(label.textContent!==count)label.textContent=count;label.setAttribute('aria-label','查看选中的 '+nodes.length+' 项内容');selectionTools.setAttribute('aria-label','所选'+nodes.length+'项的操作');
  selectionTools.querySelector('[data-selection-group]').hidden=nodes.some(n=>n.type==='frame');
  selectionTools.querySelector('.selection-transfer').hidden=!nodes.some(n=>canvasBlock(n.id)?.querySelector('.block-transfer'));
  for(const b of selectionTools.querySelectorAll('button'))b.disabled=blocked;
  selectionCount.disabled=blocked||!!saveError;
 }
 selectionTools.querySelector('[data-selection-collect]').onclick=()=>{if(ownsSelection())askCollectSelection()};
 selectionTools.querySelector('[data-selection-align]').onclick=()=>{if(ownsSelection())whiteboardNavigation.openArrangement()};
 selectionTools.querySelector('[data-selection-group]').onclick=()=>{if(ownsSelection())groupSelection()};
 const transfer=selectionTools.querySelector('.selection-transfer');
 transfer.ondragstart=e=>{if(!ownsSelection()){e.preventDefault();return}for(const n of selectionScope.nodes){const drag=canvasBlock(n.id)?.querySelector('.block-transfer');if(drag?.ondragstart){drag.ondragstart(e);return}}e.preventDefault()};
 transfer.ondragend=()=>document.body.classList.remove('content-transfer');
 $('selectionMore').onclick=e=>{
  const scope=selectionScope;if(!ownsSelection(scope))return;const r=e.currentTarget.getBoundingClientRect(),guard=fn=>()=>{if(ownsSelection(scope))return fn()};
  fileMenu({target:e.currentTarget,clientX:r.left,clientY:r.bottom+4,preventDefault:()=>e.preventDefault(),stopPropagation:()=>e.stopPropagation()},[
   ...(!selectionCount.getClientRects().length?[['查看所选内容',guard(()=>openContents())]]:[]),
   ...(!selectionTools.querySelector('[data-selection-align]').getClientRects().length?[['对齐与间距…',guard(()=>whiteboardNavigation.openArrangement())]]:[]),
   ...(!selectionTools.querySelector('[data-selection-group]').hidden&&!selectionTools.querySelector('[data-selection-group]').getClientRects().length?[['组成一组',guard(groupSelection)]]:[]),
   ...(canvas.classList.contains('short-selection')&&!$('undo').disabled?[['撤销  Ctrl+Z',guard(()=>$('undo').click())]]:[]),
   ...(canvas.classList.contains('short-selection')&&!$('redo').disabled?[['重做  Ctrl+Shift+Z',guard(()=>$('redo').click())]]:[]),
   ['复制内容  Ctrl+C',guard(copyBlocks)],['创建副本  Ctrl+D',guard(duplicate)],...(!selectionTools.querySelector('[data-selection-collect]').getClientRects().length?[['保存到库  Ctrl+Shift+L',guard(askCollectSelection)]]:[]),['删除  Delete',guard(removeSelected)],
   ['取消选择',guard(()=>{selected.clear();refreshSelectionUI();canvas.focus({preventScroll:true})})]
  ]);
 };
 function placeSelectionTools(bounds,obstacles){
  if(!selectionScope||editorId)return null;const v=view(),boxes=selectionScope.nodes.map(n=>({left:bounds.left+n.x*v.z+v.x,right:bounds.left+(n.x+n.w)*v.z+v.x,top:bounds.top+n.y*v.z+v.y,bottom:bounds.top+(n.y+n.h)*v.z+v.y}));
  const visible=boxes.some(r=>r.right>bounds.left&&r.left<bounds.right&&r.bottom>bounds.top&&r.top<bounds.bottom),retained=selectionExists(selectionVisit);selectionTools.hidden=!visible&&!retained;if(selectionTools.hidden)return null;
  selectionTools.style.maxWidth=Math.max(1,bounds.width-12)+'px';const size=selectionTools.getBoundingClientRect(),width=size.width,height=size.height,left=Math.min(...boxes.map(b=>b.left)),right=Math.max(...boxes.map(b=>b.right)),top=Math.min(...boxes.map(b=>b.top)),bottom=Math.max(...boxes.map(b=>b.bottom));
  const clamp=p=>({x:Math.max(bounds.left+6,Math.min(p.x,bounds.right-width-6)),y:Math.max(bounds.top+6,Math.min(p.y,bounds.bottom-height-6))}),x=(left+right-width)/2,overlap=(p,b)=>p.x<b.right+6&&p.x+width>b.left-6&&p.y<b.bottom+6&&p.y+height>b.top-6;
  const choices=visible?[clamp({x,y:bottom+12}),clamp({x,y:top-height-50})]:[clamp({x:bounds.left+(bounds.width-width)/2,y:(dock.getClientRects().length?dock.getBoundingClientRect().top:bounds.bottom)-height-12})];for(const b of obstacles)choices.push(clamp({x,y:b.top-height-8}),clamp({x,y:b.bottom+8}),clamp({x:b.left-width-8,y:bottom+12}),clamp({x:b.right+8,y:bottom+12}));
  const p=choices.find(p=>!obstacles.some(b=>overlap(p,b)))||choices[0];selectionTools.style.left=(p.x-bounds.left)+'px';selectionTools.style.top=(p.y-bounds.top)+'px';return {left:p.x,right:p.x+width,top:p.y,bottom:p.y+height};
 }
 function positionActions(){
  if(!board)return;const bounds=canvas.getBoundingClientRect();if(bounds.width<1||bounds.height<1)return;const z=view().z,scale=String(1/z);
  // Keep the primary verb readable; shorten the drag action before stacking.
  canvas.classList.toggle('compact-actions',bounds.width<280||bounds.height<180);canvas.classList.toggle('stacked-actions',bounds.width<132);
  canvas.classList.toggle('record-in-menu',bounds.width<420);
  canvas.classList.toggle('collect-in-menu',bounds.width<220||bounds.height<180);
  canvas.classList.toggle('short-selection',!!selectionScope&&bounds.height<300);
  canvas.classList.toggle('compact-tools',bounds.width<420);canvas.classList.toggle('tight-tools',bounds.width<220||(bounds.width<280&&bounds.height<180));canvas.classList.toggle('tiny-tools',bounds.width<180);
  if($('nodes').style.getPropertyValue('--canvas-control-scale')!==scale)$('nodes').style.setProperty('--canvas-control-scale',scale);
  const elements=[...$('nodes').querySelectorAll(':scope>.node.active')],focused=document.activeElement?.closest('.block-actions,.inline-toolbar')?.closest('.node');
  if(focused?.parentElement===$('nodes')&&!focused.classList.contains('active'))elements.push(focused);
  const localCollect=selected.size===1&&!editorId&&!canvas.classList.contains('collect-in-menu')&&elements.some(el=>{const r=el.getBoundingClientRect();return selected.has(el.dataset.id)&&el.querySelector(':scope>.block-actions .block-collect')&&r.right>bounds.left&&r.left<bounds.right&&r.bottom>bounds.top&&r.top<bounds.bottom});
  canvas.classList.toggle('local-collect',localCollect);
  // Measure before writing positions so selecting many cards does not force a layout per card.
  const obstacles=[$('canvasTools'),dock,textTools.open?textTools.querySelector('.text-size-popup'):null].map(el=>el?.getBoundingClientRect()).filter(r=>r?.width&&r.height);
  const shared=placeSelectionTools(bounds,obstacles);if(shared)obstacles.push(shared);
  const editedTable=$('nodes').querySelector(':scope>.node.table>.inner.live-layout')?.parentElement;
  const neighbours=editedTable?[...$('nodes').children].filter(el=>el!==editedTable&&!el.classList.contains('frame')).map(el=>el.getBoundingClientRect()).filter(r=>r.right>bounds.left&&r.left<bounds.right&&r.bottom>bounds.top&&r.top<bounds.bottom):[];
  for(const el of elements){const group=el.querySelector('.group-actions');if(group)group.style.maxWidth=Math.max(1,bounds.width-12)+'px'}
  // A card's actions must leave its connections and their other end readable.
  const connectionObstacles=new Map(),peerBounds=new Map(),actionIds=new Set(elements.filter(el=>!el.querySelector(':scope>.inner.live-layout')&&el.querySelector(':scope>.block-actions:not(.group-actions)')).map(el=>el.dataset.id));
  if(actionIds.size)for(const edge of board.edges){
   if(!actionIds.has(edge.from)&&!actionIds.has(edge.to))continue;
   const path=$('edgePaths').querySelector('[data-edge="'+CSS.escape(edge.id)+'"] .connector-line');if(!path)continue;
   const r=path.getBoundingClientRect();if(r.right<bounds.left||r.left>bounds.right||r.bottom<bounds.top||r.top>bounds.bottom)continue;
   const area={left:r.left-3,right:r.right+3,top:r.top-3,bottom:r.bottom+3};
   for(const id of new Set([edge.from,edge.to]))if(actionIds.has(id)){
    if(!connectionObstacles.has(id))connectionObstacles.set(id,[]);const areas=connectionObstacles.get(id);areas.push(area);
    const peerId=id===edge.from?edge.to:edge.from;
    if(!peerBounds.has(peerId)){const peer=$('nodes').querySelector(':scope>[data-id="'+CSS.escape(peerId)+'"]');peerBounds.set(peerId,peer&&!peer.classList.contains('frame')?peer.getBoundingClientRect():null)}
    const peer=peerBounds.get(peerId);if(peer)areas.push(peer);
   }
  }
  const placedActions=[];
  const placements=elements.map(el=>{const actions=el.querySelector(':scope>.inner.live-layout>.inline-toolbar')||el.querySelector('.block-actions');if(!actions)return null;const r=el.getBoundingClientRect(),group=el.classList.contains('frame'),below=!group&&r.top-bounds.top<42,style=getComputedStyle(actions),width=parseFloat(style.width)||actions.offsetWidth,height=parseFloat(style.height)||actions.offsetHeight;
   const originLeft=r.right-z-width,left=group&&actions.classList.contains('group-naming')?r.left:originLeft,top=below?r.bottom+7-z:r.top-height-7+z,visible=r.right>bounds.left&&r.left<bounds.right&&r.bottom>bounds.top&&r.top<bounds.bottom;
   let x=left,y=top;
   if(visible){const mx=Math.min(6,Math.max(0,(bounds.width-width)/2)),my=Math.min(6,Math.max(0,(bounds.height-height)/2)),clamp=p=>({x:Math.max(bounds.left+mx,Math.min(p.x,bounds.right-width-mx)),y:Math.max(bounds.top+my,Math.min(p.y,bounds.bottom-height-my))}),overlap=(p,b,gap=0)=>p.x<b.right+gap&&p.x+width>b.left-gap&&p.y<b.bottom+gap&&p.y+height>b.top-gap;
    const links=connectionObstacles.get(el.dataset.id)||[],baseAvoid=[...obstacles,...links,...(el===editedTable?neighbours:[])],start=clamp({x,y}),preferred=group?[start]:[start,clamp({x:left,y:below?r.top-height-7+z:r.bottom+7-z})];
    // Generate alternatives near the preferred positions; still validate every reserved action.
    const nearby=placedActions.filter(b=>preferred.some(p=>overlap(p,b,5.8))),freePositions=avoid=>{
     const choices=[...preferred];for(const b of avoid)choices.push(...[{x:b.left-width-6,y:start.y},{x:b.right+6,y:start.y},{x:start.x,y:b.top-height-6},{x:start.x,y:b.bottom+6}].map(clamp));
     const free=choices.filter(p=>!avoid.some(b=>overlap(p,b,5.8))&&!placedActions.some(b=>overlap(p,b,5.8)));free.sort((a,b)=>Number(!group&&overlap(a,r))-Number(!group&&overlap(b,r))||(a.x-left)**2+(a.y-top)**2-(b.x-left)**2-(b.y-top)**2);return free;
    };
    const free=freePositions([...baseAvoid,...nearby]);
    ({x,y}=free[0]||start);
   }
   if(visible&&width&&height)placedActions.push({left:x,right:x+width,top:y,bottom:y+height});
   return {actions,below,dx:x-originLeft,dy:y-top};
  });
  for(const p of placements){if(!p)continue;const {actions,below,dx,dy}=p,key=[z,below,dx,dy].join('|');if(actions.dataset.position===key)continue;actions.dataset.position=key;actions.style.transform='scale('+1/z+')';actions.style.right=(-dx/z)+'px';actions.style.bottom=below?'auto':'calc(100% + '+(7-dy)/z+'px)';actions.style.top=below?'calc(100% + '+(7+dy)/z+'px)':'auto';actions.style.transformOrigin=below?'top right':'bottom right'}
  const panel=$('nodes').querySelector(':scope>.node>.inner.live-layout>#inlineMeta[open]');
  if(panel!==sourceDetails){if(sourceDetails)canvasBounds.unobserve(sourceDetails);sourceDetails=panel;if(panel)canvasBounds.observe(panel)}
  if(panel){
   const anchor=panel.parentElement.querySelector(':scope>.inline-toolbar #inlineDetails').getBoundingClientRect(),origin=panel.parentElement.getBoundingClientRect(),width=Math.min(360,Math.max(1,bounds.width-12));
   const x=Math.max(bounds.left+6,Math.min(anchor.left,bounds.right-width-6));let top=bounds.top+6,bottom=bounds.bottom-6;
   for(const obstacle of [$('canvasTools'),dock]){const r=obstacle.getBoundingClientRect();if(r.width&&r.height&&x<r.right+6&&x+width>r.left-6){if((r.top+r.bottom)/2<(bounds.top+bounds.bottom)/2)top=Math.max(top,r.bottom+6);else bottom=Math.min(bottom,r.top-6)}}
   const styles={width:width+'px',maxHeight:Math.max(1,bottom-top)+'px'};for(const [key,value]of Object.entries(styles))if(panel.style[key]!==value)panel.style[key]=value;
   const height=panel.getBoundingClientRect().height;let y=anchor.bottom+5;if(y+height>bottom)y=anchor.top-height-5;y=Math.max(top,Math.min(y,bottom-height));
   const left=(x-origin.left)/z+'px',offset=(y-origin.top)/z+'px';if(panel.style.left!==left)panel.style.left=left;if(panel.style.top!==offset)panel.style.top=offset;
  }
  // A table menu follows its screen-sized toolbar, including narrow split panes.
  for(const details of $('nodes').querySelectorAll(':scope>.node.table>.inner.live-layout>.inline-toolbar .table-options[open]')){
   const menu=details.querySelector(':scope>div'),anchor=details.getBoundingClientRect(),r=menu.getBoundingClientRect(),mx=Math.min(6,Math.max(0,(bounds.width-r.width)/2)),my=Math.min(6,Math.max(0,(bounds.height-r.height)/2));
   const x=Math.max(bounds.left+mx,Math.min(anchor.left,bounds.right-r.width-mx));let y=anchor.bottom+5;
   if(y+r.height>bounds.bottom-my)y=anchor.top-r.height-5;y=Math.max(bounds.top+my,Math.min(y,bounds.bottom-r.height-my));
   const left=(x-anchor.left)+'px',top=(y-anchor.top)+'px';if(menu.style.left!==left)menu.style.left=left;if(menu.style.top!==top)menu.style.top=top;
  }
 }
 const actionsBeforeContents=positionActions;positionActions=function(){actionsBeforeContents();positionContents();};
 let tableToolbar=null,sourceDetails=null;const canvasBounds=new ResizeObserver(positionActions);for(const el of [canvas,$('canvasTools'),$('creationDock'),$('textSizeTools')])if(el)canvasBounds.observe(el);
 $('nodes').addEventListener('focusin',e=>{if(e.target.closest('.block-actions,.inline-toolbar'))positionActions()});
 $('nodes').addEventListener('toggle',e=>{if(e.target.matches('.node.table>.inner.live-layout>.inline-toolbar .table-options,.node>.inner.live-layout>#inlineMeta'))positionActions()},true);
 function mountGroupActions(el,n){
  let actions=el.querySelector('.group-actions');if(!actions){actions=document.createElement('div');actions.className='block-actions group-actions inline-ui';el.append(actions)}
  const editing=editorId===n.id&&selected.has(n.id),source=board,sourceId=boardId,owns=()=>actions.isConnected&&board===source&&boardId===sourceId&&!loading&&board.nodes.includes(n);
  el.classList.toggle('naming-group',editing);
  const mode=editing?'name':'read';if(actions.dataset.groupMode===mode&&actions._groupNode===n&&actions._groupBoard===source)return;actions.dataset.groupMode=mode;actions._groupNode=n;actions._groupBoard=source;actions.classList.toggle('group-naming',editing);
  if(!editing){const rename=document.createElement('button');rename.type='button';rename.textContent='改名';rename.setAttribute('aria-label','分组改名');rename.onclick=e=>{e.stopPropagation();if(owns()&&!blocked)openEditor(n.id)};actions.replaceChildren(rename);return}
  const field=document.createElement('input');field.id='title';field.dataset.groupName='';field.setAttribute('aria-label','分组名称');field.placeholder='分组名称';field.value=n.title||'';
  const done=document.createElement('button');done.type='button';done.textContent='完成';done.setAttribute('aria-label','完成分组命名');
  const finish=()=>{if(!owns())return;editorId=null;drawNodes();canvas.focus({preventScroll:true})};done.onclick=e=>{e.stopPropagation();finish()};
  bindContentInput(field,()=>n.title||'',value=>{n.title=value;const heading=el.querySelector(':scope>.inner>h3');if(heading)heading.textContent=value||'未命名';renderOutline();change()});
  const input=field.oninput;field.oninput=()=>{if(owns()&&!blocked)input();else field.value=n.title||''};
  field.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();e.stopPropagation();finish()}};
  actions.replaceChildren(field,done);
 }
 function groupPosition(){const field=document.activeElement,n=board?.nodes.find(n=>n.id===editorId);return field?.matches('[data-group-name]')&&n?.type==='frame'?{source:board,node:n,value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,left:field.scrollLeft}:null}
 function restoreGroupPosition(position){if(!position||position.source!==board||!board.nodes.includes(position.node)||editorId!==position.node.id||!selected.has(position.node.id)||$('dialog').open)return;const field=canvasBlock(position.node.id)?.querySelector('[data-group-name]');if(field&&field.value===position.value){field.focus({preventScroll:true});field.setSelectionRange(position.start,position.end,position.direction);field.scrollLeft=position.left}}
 function mountCollectAction(actions,n){
  if(!actions||n.type==='frame'&&editorId===n.id)return;
  let button=actions.querySelector('.block-collect');if(!button){button=document.createElement('button');button.type='button';button.className='block-collect';button.textContent='保存到库';button.title='将这块内容保存到内容库，下次继续使用';const primary=actions.querySelector('.block-read,.block-write-record');if(primary)primary.after(button);else actions.append(button)}
  const source=board,sourceId=boardId;button.disabled=blocked;
  button.onclick=e=>{e.stopPropagation();if(!button.isConnected||!actions.contains(button)||board!==source||boardId!==sourceId||loading||blocked||editorId||$('dialog').open||parentModal()||!visiblePane()||selected.size!==1||!selected.has(n.id)||!board.nodes.includes(n))return;askCollectSelection()};
 }
 function mountPrimaryAction(actions,n){
  if(!actions||n.type==='frame')return;
  let button=actions.querySelector('.block-read');if(!button){button=document.createElement('button');button.type='button';button.className='block-read';actions.prepend(button)}
  const mode=n.assetId?'view':'edit';
  if(button.dataset.primaryMode!==mode){
   button.dataset.primaryMode=mode;button.title=mode==='view'?'打开查看':'展开编辑';button.setAttribute('aria-label',button.title);
   button.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"/></svg><span>'+(mode==='view'?'查看':'编辑')+'</span>';
  }
  let record=actions.querySelector('.block-write-record');if(window.whiteboardNoteEditor?.writeFrom&&!record){record=document.createElement('button');record.type='button';record.className='block-write-record';record.textContent='写记录';button.after(record)}
  const source=board,sourceId=boardId;
  if(record)record.onclick=e=>{e.stopPropagation();if(record.isConnected&&board===source&&boardId===sourceId&&!loading&&!blocked&&board.nodes.includes(n))whiteboardNoteEditor.writeFrom(n.id)};
  button.onclick=e=>{e.stopPropagation();if(!button.isConnected||board!==source||boardId!==sourceId||loading||!board.nodes.includes(n))return;if(n.assetId)wfSafe(()=>previewAsset(n.assetId));else readNote(n.id)};
 }
 function mount(){const byId=new Map(board?.nodes.map(n=>[n.id,n])||[]);for(const el of $('nodes').children){const n=byId.get(el.dataset.id);if(!n)continue;if(n.type==='frame')mountGroupActions(el,n);const limit=String(Math.min(Number(n.w)||300,Number(n.h)||120)/40);if(el.style.getPropertyValue('--handle-limit')!==limit)el.style.setProperty('--handle-limit',limit);const actions=el.querySelector('.block-actions');mountPrimaryAction(actions,n);mountCollectAction(actions,n);const drag=actions?.querySelector('.block-transfer');if(drag&&!drag.dataset.refined){drag.dataset.refined='true';drag.title='按住拖动，把副本放到表格、内容库或另一张白板';drag.setAttribute('aria-label','拖出副本');drag.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="5" r="1.5"/><circle cx="16" cy="5" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="19" r="1.5"/><circle cx="16" cy="19" r="1.5"/></svg><span>拖出副本</span>'}
  for(const handle of el.querySelectorAll('.table-column-resize'))bindWidth(handle,n);
 }syncSelectionTools();const toolbar=$('nodes').querySelector(':scope>.node.table>.inner.live-layout>.inline-toolbar');if(toolbar!==tableToolbar){if(tableToolbar)canvasBounds.unobserve(tableToolbar);tableToolbar=toolbar;if(tableToolbar)canvasBounds.observe(tableToolbar)}positionActions()}
 const draw=drawNodes;drawNodes=function(){cancelWidth();const position=activePosition(),group=groupPosition();draw();mount();expandEditor();if(position)restorePosition(position);restoreGroupPosition(group)};const select=refreshSelectionUI;refreshSelectionUI=function(){select();mount()};
 const previousMove=moveView;moveView=function(){previousMove();positionActions()};
 const layout=tableLayout;tableLayout=function(n){const widths=n.columns.map((_,i)=>Math.max(100,Math.min(900,n.columnWidths?.[i]||160))),width=38+widths.reduce((a,b)=>a+b,0);const explicit=n.columnWidths?.length===n.columns.length;return layout(n).replace(/style="min-width:[^"]+"/,'style="min-width:'+(explicit?width:38+n.columns.length*140)+'px;width:'+(explicit?width+'px':'100%')+'"').replace('<thead>','<colgroup><col style="width:38px">'+widths.map(w=>explicit?'<col style="width:'+w+'px">':'<col>').join('')+'</colgroup><thead>').replace(/(<th data-col-target="(\d+)"[^>]*>)/g,'$1<span class="table-column-resize inline-ui" data-width-column="$2" aria-label="调整列宽"></span>')};
 function cancelWidth(){if(!widthGesture)return false;widthGesture.cancel();return true}
 const previousCancel=cancelCanvasGesture;cancelCanvasGesture=function(...args){const resized=cancelWidth(),result=previousCancel(...args);return resized?true:result};
 const previousLoad=loadBoard;loadBoard=function(...args){cancelWidth();widthKey=null;return previousLoad(...args)};
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&widthGesture){e.preventDefault();e.stopImmediatePropagation();cancelWidth()}} ,true);
 window.addEventListener('keyup',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key))widthKey=null});
 window.addEventListener('blur',()=>{widthKey=null;cancelWidth()});
 $('dialog').addEventListener('close',cancelWidth);
 $('nodes').addEventListener('toggle',e=>{if(e.target.id==='inlineMeta'&&!e.target.open)cancelWidth()},true);
 function bindWidth(handle,n){
  const table=handle.closest('table'),column=Number(handle.dataset.widthColumn),prior=widthBindings.get(handle);if(n.type!=='table'||table.parentElement.closest('table'))return;
  if(prior?.node===n&&prior.board===board&&prior.boardId===boardId&&prior.column===column&&prior.table===table){prior.sync();return}
  if(widthGesture?.handle===handle)cancelWidth();handle.dataset.bound='true';let start=null;
  const bounded=v=>Math.max(100,Math.min(900,v)),hasWidth=()=>Object.prototype.hasOwnProperty.call(n,'columnWidths'),signature=()=>JSON.stringify([n.columns,n.columnIds,hasWidth(),n.columnWidths]),displaySignature=()=>JSON.stringify([n.columns.length,n.columnIds,hasWidth(),n.columnWidths]);
  const supported=()=>!hasWidth()||Array.isArray(n.columnWidths)&&(n.columnWidths.length===0||n.columnWidths.length===n.columns.length)&&n.columnWidths.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0);
  const live=()=>!loading&&!blocked&&supported()&&(selected.has(n.id)||editorId===n.id)&&board?.nodes.find(v=>v.id===n.id)===n&&handle.isConnected;
  const scale=()=>handle.closest('.immersive-surface')?1:view().z;
  const widths=()=>{const heads=[...table.querySelectorAll(':scope>thead>tr>th[data-col-target]')];return n.columns.map((_,i)=>{const v=n.columnWidths?.[i];return bounded(typeof v==='number'&&Number.isFinite(v)&&v>0?v:heads[i]?.offsetWidth||160)})};
  const applied=(preview,value)=>{const values=Array.isArray(n.columnWidths)&&n.columnWidths.length===n.columns.length?[...n.columnWidths]:[...preview];values[column]=value;return values};
  const value=v=>{handle.setAttribute('aria-valuenow',String(v));const text=(Math.round(v*10)/10)+' px';handle.setAttribute('aria-valuetext',text);handle.dataset.widthText=text};
  handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-valuemin','100');handle.setAttribute('aria-valuemax','900');handle.setAttribute('aria-label','第'+(column+1)+'列宽度');handle.title='拖动调整列宽；左右键微调，Shift加速，Home最窄、End最宽，双击恢复160 px';value(widths()[column]);
  handle.onfocus=()=>{if(!start)value(widths()[column])};
  const sameOwner=s=>board===s.board&&boardId===s.boardId&&board?.nodes.find(v=>v.id===n.id)===n&&table.isConnected&&handle.isConnected;
  const valid=s=>live()&&sameOwner(s)&&signature()===s.signature&&scale()===s.scale&&(!s.details||s.details.isConnected&&s.details.open===s.detailsOpen);
  const paint=values=>{const cols=table.querySelectorAll(':scope>colgroup>col');if(cols.length!==values.length+1)return;for(let i=0;i<values.length;i++)cols[i+1].style.width=values[i]+'px';table.style.width=table.style.minWidth=(38+values.reduce((a,b)=>a+b,0))+'px';growContentFields(table);value(values[column])};
  const finish=commit=>{
   const s=start;if(!s)return;start=null;s.dismissal?.disconnect();if(widthGesture===s)widthGesture=null;handle.classList.remove('resizing');
   if(commit&&valid(s)&&s.pending[column]!==s.original[column]){undoPoint();n.columnWidths=applied(s.pending,s.pending[column]);value(s.pending[column]);change()}
   else if(sameOwner(s)&&displaySignature()===s.displaySignature){table.style.width=s.style.width;table.style.minWidth=s.style.minWidth;[...table.querySelectorAll(':scope>colgroup>col')].forEach((col,i)=>col.style.width=s.style.columns[i]);growContentFields(table);value(s.original[column])}
   try{if(handle.hasPointerCapture(s.pointer))handle.releasePointerCapture(s.pointer)}catch{}
  };
  handle.onpointerdown=e=>{
   if(e.button!==0||e.isPrimary===false)return;e.preventDefault();e.stopPropagation();closeFileContext();if(!live()){if(!supported())toast('已有列宽无法核对，原表格保持。');return}cancelWidth();widthKey=null;
   const original=widths(),details=table.closest('.inner')?.querySelector(':scope>#inlineMeta');start={board,boardId,node:n,handle,table,details,detailsOpen:details?.open,pointer:e.pointerId,x:e.clientX,scale:scale(),original,pending:[...original],signature:signature(),displaySignature:displaySignature(),style:{width:table.style.width,minWidth:table.style.minWidth,columns:[...table.querySelectorAll(':scope>colgroup>col')].map(c=>c.style.width)},cancel:()=>finish(false)};widthGesture=start;
   if(details){const session=start;start.dismissal=new MutationObserver(()=>{if(start===session&&!valid(session))finish(false)});start.dismissal.observe(details,{attributes:true,attributeFilter:['open']})}
   handle.focus({preventScroll:true});try{handle.setPointerCapture(e.pointerId);handle.classList.add('resizing')}catch{finish(false)}
  };
  handle.onpointermove=e=>{const s=start;if(!s||e.pointerId!==s.pointer)return;e.preventDefault();if(!valid(s)){finish(false);return}s.pending[column]=bounded(s.original[column]+(e.clientX-s.x)/s.scale);paint(s.pending)};
  handle.onpointerup=e=>{if(start&&e.pointerId===start.pointer)finish(true)};
  for(const key of ['onpointercancel','onlostpointercapture'])handle[key]=e=>{if(start&&e.pointerId===start.pointer)finish(false)};
  const resize=(next,e)=>{
   cancelWidth();if(!live()){if(!supported())toast('已有列宽无法核对，原表格保持。');return}const values=widths();if(next===values[column])return;
   const key=n.columnIds?.[column]??JSON.stringify(n.columns),repeat=e?.repeat&&widthKey?.board===board&&widthKey?.boardId===boardId&&widthKey?.node===n&&widthKey?.column===column&&widthKey?.source===key&&widthKey?.key===e.key&&widthKey?.shift===e.shiftKey;
   if(!repeat)undoPoint();widthKey=e?{board,boardId,node:n,column,source:n.columnIds?.[column]??JSON.stringify(n.columns),key:e.key,shift:e.shiftKey}:null;n.columnWidths=applied(values,next);drawNodes();change();
   const root=immersion?.node===n?immersion.surface:canvasBlock(n.id);root?.querySelector('.table-column-resize[data-width-column="'+column+'"]')?.focus({preventScroll:true});
  };
  handle.onkeydown=e=>{if(e.isComposing)return;if(['Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopPropagation();return}if(e.ctrlKey||e.metaKey||e.altKey||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();const current=widths()[column],next=e.key==='Home'?100:e.key==='End'?900:bounded(current+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?10:1));resize(next,e)};
  handle.ondblclick=e=>{e.preventDefault();e.stopPropagation();resize(160)};
  widthBindings.set(handle,{node:n,board,boardId,column,table,sync:()=>{if(start&&!valid(start))finish(false);value(start?start.pending[column]:widths()[column])}});
 }
 const move=moveTable;moveTable=function(n,axis,from,to){const widths=clone(n.columnWidths||[]);move(n,axis,from,to);if(axis==='column'&&widths.length===n.columns.length&&from!==to){widths.splice(to,0,widths.splice(from,1)[0]);n.columnWidths=widths;drawNodes();change()}};
 for(const field of ['columnWidths'])if(!wfContentFields.includes(field))wfContentFields.push(field);
 wfLabels.columnWidths='表格列宽';
 const preview=document.createElement('div');preview.className='board-drop-preview';preview.hidden=true;preview.innerHTML='<span>复制到这里</span>';canvas.append(preview);
 canvas.addEventListener('dragover',e=>{if(![...e.dataTransfer.types].some(t=>['application/x-creative-board-content','application/x-creative-assets'].includes(t))||e.target.closest('[data-cell]')){preview.hidden=true;return}const r=canvas.getBoundingClientRect();preview.hidden=false;preview.style.left=(e.clientX-r.left)+'px';preview.style.top=(e.clientY-r.top)+'px';e.dataTransfer.dropEffect='copy'},true);
 for(const name of ['drop','dragend','dragleave'])canvas.addEventListener(name,e=>{if(name!=='dragleave'||!canvas.contains(e.relatedTarget))preview.hidden=true},true);
 window.addEventListener('dragend',()=>preview.hidden=true);
 window.whiteboardReading={open:readNote,isEditing:()=>!!immersion,placeActions:positionActions};
 if(board)mount();
})();
