// Cell attachments are independent content copies; media files remain shared references.
// Row and column identities survive document snapshots without relying on cell text.
function tableAxisIds(n){
 for(const [key,length] of [['rowIds',n.rows.length],['columnIds',n.columns.length]]){
  if(!Array.isArray(n[key]))n[key]=[];
  n[key].length=length;const seen=new Set();
  for(let i=0;i<length;i++){
   const id=n[key][i];
   if(typeof id!=='string'||!id||id.length>100||seen.has(id))n[key][i]=uid();
   seen.add(n[key][i]);
  }
 }
 return n;
}
function cellItemGrid(n){tableAxisIds(n);n.cellItems??=[];while(n.cellItems.length<n.rows.length)n.cellItems.push([]);n.cellItems.length=n.rows.length;for(const row of n.cellItems){while(row.length<n.columns.length)row.push([]);row.length=n.columns.length}return n.cellItems}
// A detached copy keeps an existing origin, or inherits the enclosing resource
// and its stable root. The current card ID is not used as a guessed origin.
function cellItemOrigin(item,parent){
 if(item.libraryOrigin)return item.libraryOrigin;
 const origin=parent?.libraryOrigin;if(!origin?.id||!origin.nodeId||typeof item.id!=='string')return null;
 const candidate={...clone(origin),nodeId:item.id,rootNodeId:origin.rootNodeId||origin.nodeId};
 // Being inside a reused table does not prove that a newly written card
 // existed in the resource. Preserve a pointer only to an ID actually there.
 return typeof wfOriginNode==='function'&&wfOriginNode({libraryOrigin:candidate},assetById(origin.id),true)?candidate:null;
}
function cellItemCopy(item,parent){const copy=clone(item),origin=cellItemOrigin(item,parent);if(origin)copy.libraryOrigin=clone(origin);return copy}
function cellContentMarkup(n,r,c){return '<div class="cell-contents">'+(n.cellItems?.[r]?.[c]||[]).map((item,i)=>{const a=assetById(item.mediaId||item.assetId),media=a?.mime?.startsWith('audio/')?'<audio class="inline-ui" controls preload="metadata" src="'+mediaURL(a.id)+'"></audio>':a?.mime?.startsWith('video/')?'<video class="inline-ui" controls preload="metadata" src="'+mediaURL(a.id)+'"></video>':'';const preview=isTextAsset(a)&&!documentKind(a)?'<div class="file-text-preview" data-text-preview="'+esc(a.id)+'"><small>正在读取原文件…</small></div>':'';const field=(key,label)=>'<textarea data-cell-note-field="'+key+'" aria-label="'+label+'">'+esc(item[key]||'')+'</textarea>';const paper=/^#[\da-f]{6}$/i.test(item.color||'')?item.color:colors[0],surface=typeof contentSurfaceClass==='function'?contentSurfaceClass(item):'';return '<section class="cell-content inline-ui'+(a?' cell-file':'')+(surface?' '+surface:'')+'" style="'+(typeof contentSurfaceStyle==='function'?contentSurfaceStyle(item):'')+'--cell-paper:'+paper+'" data-cell-item="'+i+'" data-cell-r="'+r+'" data-cell-c="'+c+'"><button type="button" data-cell-move class="cell-move-handle inline-ui" aria-label="移动内容" title="移动内容">⋮⋮</button>'+field('title','单元格内容标题')+media+preview+imageGallery(item.images||[])+(item.image?imageGallery([{data:item.image}]):'')+(item.type==='table'?'<p>内含表格 · '+(item.rows?.length||0)+' 行；取出到白板后编辑</p>':field('body','单元格内容正文'))+(item.userText?field('userText','单元格内容补充'):'')+(item.annotation?field('annotation','单元格内容备注'):'')+(a&&!media&&!a.mime?.startsWith('image/')?'<a class="inline-ui" href="'+mediaURL(a.id)+'" target="_blank" rel="noopener">打开文件</a>':'')+'</section>'}).join('')+'</div>'}
(()=>{
function tableAt(target){const n=board?.nodes.find(n=>n.id===target.nodeId);return n?.type==='table'&&Number.isInteger(target.r)&&Number.isInteger(target.c)&&n.rows[target.r]?.[target.c]!==undefined?n:null}
function appendItems(nodes,target){const n=tableAt(target);if(!n)return;const items=nodes.filter(x=>x&&x.type!=='frame').map(x=>({...clone(x),id:uid()}));if(!items.length)return toast('请选中便签、表格或文件内容');undoPoint();cellItemGrid(n)[target.r][target.c].push(...items);openEditor(n.id);change();toast('已放入单元格，原内容保留')}
// Object clipboard ownership follows the cell copy, never the enclosing table selection.
function clipboardCell(target){
 const live=target?.closest?.('.live-layout'),host=live?.closest('#nodes>.node[data-id],#immersiveSurface[data-id]');
 if(!host||target.closest('.note-source-card')||$('dialog').open&&!host.closest('#dialog.immersive-dialog'))return null;
 const n=board?.nodes.find(n=>n.id===host.dataset.id&&n.type==='table');
 if(!n||editorId!==n.id||!selected.has(n.id))return null;
 const owner=board,id=boardId,valid=()=>board===owner&&boardId===id&&board.nodes.includes(n)&&host.isConnected&&host.contains(live)&&editorId===n.id&&!loading&&!blocked&&!window.whiteboardHosted?.paused&&window.whiteboardHosted?.role!=='viewer';
 return {n,live,valid};
}
function captureCell(target){
 const context=clipboardCell(target);if(!context)return null;
 const section=target.closest('[data-cell-item]')||context.live.querySelector('.cell-target');
 if(!section||!context.live.contains(section))return null;
 const r=+section.dataset.cellR,c=+section.dataset.cellC,index=+section.dataset.cellItem,items=context.n.cellItems?.[r]?.[c],item=items?.[index];if(!item)return null;
 return {bundle:{nodes:[cellItemCopy(item,context.n)],edges:[]},valid:()=>context.valid()&&context.n.cellItems?.[r]?.[c]===items&&items[index]===item,remove(){if(!this.valid())return false;undoPoint();items.splice(index,1);openEditor(context.n.id);change();return true},duplicate(){if(!this.valid())return false;undoPoint();items.splice(index+1,0,{...cellItemCopy(item,context.n),id:uid()});openEditor(context.n.id);change();return true}};
}
function pasteCell(target){
 const context=clipboardCell(target),cell=target?.closest?.('td[data-cell]');if(!context||!cell||!context.live.contains(cell))return null;
 const [r,c]=cell.dataset.cell.split(',').map(Number),row=context.n.rowIds?.[r],column=context.n.columnIds?.[c];
 return {apply(text){if(!context.valid()||context.n.rowIds?.[r]!==row||context.n.columnIds?.[c]!==column)return false;let value;try{value=JSON.parse(text)}catch{return false}if(value?.format!=='creative-board-fragment'||!Array.isArray(value.nodes)||!Array.isArray(value.edges))return false;appendItems(value.nodes,{nodeId:context.n.id,r,c});return true}};
}
window.whiteboardCellClipboard={capture:captureCell,pasteTarget:pasteCell};
window.addEventListener('keydown',event=>{if(event.isComposing||!event.target.closest?.('[data-cell-move]'))return;const cell=captureCell(event.target);if(!cell)return;const duplicate=(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d',remove=!event.ctrlKey&&!event.metaKey&&!event.altKey&&['Delete','Backspace'].includes(event.key);if(!duplicate&&!remove)return;event.preventDefault();event.stopImmediatePropagation();if(duplicate)cell.duplicate();else cell.remove()},true);
const priorAssets=attachAssets;attachAssets=function(ids,target){if(!tableAt(target))return priorAssets(ids,target);const nodes=[];for(const a of ids.map(assetById).filter(Boolean)){if(a.bundle?.nodes)nodes.push(...a.bundle.nodes.map(n=>({...clone(n),libraryOrigin:{id:a.id,nodeId:n.id,name:a.title,source:clone(a.source||{})}})));else nodes.push({id:uid(),type:'note',title:a.title,body:a.notes||'',assetId:a.id,mediaId:/^(audio|video)\//.test(a.mime)?a.id:undefined,images:a.mime?.startsWith('image/')?[{assetId:a.id,name:a.title}]:[],tags:a.tags||[],url:a.path,x:0,y:0,w:340,h:240})}appendItems(nodes,target)};
const priorFiles=attachFiles;attachFiles=async function(files,target){if(!tableAt(target))return priorFiles(files,target);try{const added=await uploadFiles([...files]);attachAssets(added.map(a=>a.id),target)}catch(e){toast(e.message)}};
const priorChoose=chooseImages;chooseImages=function(target){$('imageFiles').accept=tableAt(target)?'':'image/png,image/jpeg,image/webp,image/gif';priorChoose(target)};
const priorDrop=attachDrop;attachDrop=async function(e,target){if(!tableAt(target))return priorDrop(e,target);const raw=e.dataTransfer.getData('text/plain');try{const value=JSON.parse(raw);if(value.format==='creative-board-fragment'&&Array.isArray(value.nodes))return appendItems(value.nodes,target)}catch{}if(raw&&!e.dataTransfer.files.length&&!e.dataTransfer.getData('application/x-creative-assets')){const n=tableAt(target);undoPoint();n.rows[target.r][target.c]+=(n.rows[target.r][target.c]?'\n':'')+raw;openEditor(n.id);change();return}return priorDrop(e,target)};
const priorMount=mountTableEditor;
mountTableEditor=function(n){
 priorMount(n);
 const root=$('inlineTable'),live=root.closest('.live-layout');
 const tools=document.createElement('div');tools.className='cell-tools';tools.hidden=true;
 tools.setAttribute('role','group');tools.setAttribute('aria-label','单元格内容操作');
 tools.innerHTML='<small data-cell-caption></small><button data-cell-extract title="取出副本到白板" aria-label="取出副本到白板">取出副本到白板</button><button data-cell-remove title="移除单元格里的内容" aria-label="移除单元格里的内容">移除这份内容</button>';
 const options=root.querySelector('.table-options');options.querySelector(':scope>div').append(tools);
 let target=null;
 const clear=()=>{target?.classList.remove('cell-target');target=null;tools.hidden=true};
 const labelTarget=()=>{
  const title=target.querySelector('[data-cell-note-field=title]')?.value.trim()||'未命名内容';
  tools.querySelector('[data-cell-caption]').textContent='内容：'+title;
  for(const b of tools.querySelectorAll('button')){const label=b.hasAttribute('data-cell-extract')?'取出副本到白板':'移除单元格里的内容';b.title=label+'：'+title;b.setAttribute('aria-label',b.title)}
 };
 const choose=el=>{if(target===el)return;clear();target=el;target.classList.add('cell-target');tools.hidden=false;labelTarget()};
 live.addEventListener('pointerdown',e=>{const el=e.target.closest('[data-cell-item]');if(el&&root.contains(el))choose(el);else if(!e.target.closest('.cell-tools,.table-options'))clear()});
 // Keep the chosen copy while tabbing back to its toolbar actions.
 live.addEventListener('focusin',e=>{const el=e.target.closest('[data-cell-item]');if(el&&root.contains(el))choose(el)});
 live.addEventListener('keydown',e=>{const handle=e.target.closest('[data-cell-move]');if(!handle||!(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'))return;e.preventDefault();e.stopImmediatePropagation();choose(handle.closest('[data-cell-item]'));options.open=true;tools.querySelector('button')?.focus({preventScroll:true})});
 for(const handle of root.querySelectorAll('[data-cell-move]'))handle.setAttribute('aria-keyshortcuts','Shift+F10');
 root.querySelectorAll('[data-cell-note-field]').forEach(field=>{
  const el=field.closest('[data-cell-item]'),item=n.cellItems[+el.dataset.cellR][+el.dataset.cellC][+el.dataset.cellItem];
  bindContentInput(field,()=>item[field.dataset.cellNoteField]||'',value=>{item[field.dataset.cellNoteField]=value;if(target===el&&field.dataset.cellNoteField==='title')labelTarget();change()});
 });
 tools.querySelectorAll('button').forEach(button=>{button.onclick=()=>{
  if(!target?.isConnected||editorId!==n.id||board.nodes.find(x=>x.id===n.id)!==n)return;
  const items=n.cellItems[+target.dataset.cellR]?.[+target.dataset.cellC],index=+target.dataset.cellItem,item=items?.[index];
  if(!item)return;
  options.open=false;
  if(button.hasAttribute('data-cell-remove')){undoPoint();items.splice(index,1);openEditor(n.id);change()}
  else{insertBundle({nodes:[cellItemCopy(item,n)],edges:[]},{x:n.x+n.w+40,y:n.y});toast('已将副本放到表格右侧')}
 }});
 root.querySelectorAll('[data-cell]').forEach(td=>{td.addEventListener('paste',e=>{
  if(e.target.closest('[data-cell-item]'))return;let data;
  try{data=JSON.parse(e.clipboardData.getData('text/plain'))}catch{return}
  if(data.format!=='creative-board-fragment'||!Array.isArray(data.nodes))return;
  e.preventDefault();e.stopImmediatePropagation();const [r,c]=td.dataset.cell.split(',').map(Number);appendItems(data.nodes,{nodeId:n.id,r,c});
 },true)});
};
const priorMarkdown=tableMarkdown;tableMarkdown=function(n){let result=priorMarkdown(n);for(let r=0;r<n.rows.length;r++)for(let c=0;c<n.columns.length;c++)for(const item of n.cellItems?.[r]?.[c]||[]){const a=assetById(item.mediaId||item.assetId);result+='\n\n第 '+(r+1)+' 行 · '+n.columns[c]+'\n\n'+[item.title,item.body,item.userText,item.annotation].filter(Boolean).join('\n\n')+(a?'\n\n文件：'+a.path:'');}return result};
const css=document.createElement('style');css.textContent='.cell-content{position:relative;margin:8px 0;padding:10px;border:1px solid #dddccf;border-radius:6px;background:#fff8cf;min-width:0}.node .cell-content textarea{background:transparent;border:0;padding:2px 0;min-height:24px!important;width:100%}.cell-content [data-cell-note-field=title]{font-weight:600}.cell-content audio{width:100%;min-width:0}.cell-content p{font-size:12px}.cell-content a{font-size:12px}.read-layout .cell-content audio,.read-layout .cell-content video,.read-layout .cell-content a{pointer-events:auto}.node .edit-scroll,.node .table-scroll{overflow-anchor:none}';document.head.append(css);

// Growing textareas need their outer scroller to follow the caret, not the whole page.
const measure=document.createElement('div');measure.setAttribute('aria-hidden','true');Object.assign(measure.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',whiteSpace:'pre-wrap',overflowWrap:'break-word',pointerEvents:'none'});document.body.append(measure);
function caretBox(field){const style=getComputedStyle(field);for(const key of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','textAlign','direction','textIndent','textTransform','paddingTop','paddingBottom','paddingLeft','paddingRight','borderTopWidth','borderBottomWidth','borderLeftWidth','borderRightWidth','boxSizing','wordBreak','tabSize'])measure.style[key]=style[key];measure.style.width=field.offsetWidth+'px';measure.style.whiteSpace=field.tagName==='TEXTAREA'&&field.wrap!=='off'?'pre-wrap':'pre';measure.textContent=field.value.slice(0,(field.selectionDirection==='backward'?field.selectionStart:field.selectionEnd)??field.value.length);const mark=document.createElement('span');mark.textContent='\u200b';measure.append(mark);const mr=measure.getBoundingClientRect(),cr=mark.getBoundingClientRect(),fr=field.getBoundingClientRect(),sx=fr.width/Math.max(1,field.offsetWidth),sy=fr.height/Math.max(1,field.offsetHeight);return {left:fr.left+(cr.left-mr.left-field.scrollLeft)*sx,top:fr.top+(cr.top-mr.top-field.scrollTop)*sy,height:(parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.5)*sy}}
let followFrame;function followCaret(field,revealCanvas=true){if(!field?.isConnected||field.readOnly||document.activeElement!==field)return;for(let parent=field.parentElement;parent&&parent!==canvas;parent=parent.parentElement){if(!parent.matches('.table-scroll,.edit-scroll,#inlineMeta'))continue;if(parent.scrollHeight<=parent.clientHeight+1&&parent.scrollWidth<=parent.clientWidth+1)continue;const caret=caretBox(field),box=parent.getBoundingClientRect(),scale=box.height/Math.max(1,parent.offsetHeight),margin=8*scale;if(caret.top+caret.height>box.bottom-margin)parent.scrollTop+=(caret.top+caret.height-box.bottom+margin)/scale;else if(caret.top<box.top+margin)parent.scrollTop-=(box.top+margin-caret.top)/scale;if(caret.left>box.right-12)parent.scrollLeft+=(caret.left-box.right+12)/scale;else if(caret.left<box.left+8)parent.scrollLeft-=(box.left+8-caret.left)/scale}if(revealCanvas)window.whiteboardNavigation?.revealCaret?.(field,false)}
window.whiteboardCaret={box:caretBox,follow:followCaret};
function queueFollow(e){const field=e.target;if(!field.matches?.('.live-layout textarea'))return;cancelAnimationFrame(followFrame);followFrame=requestAnimationFrame(()=>followCaret(field))}
for(const name of ['input','keyup','click','compositionend'])document.addEventListener(name,queueFollow);document.addEventListener('selectionchange',()=>{const field=document.activeElement;if(field?.matches('.live-layout textarea'))queueFollow({target:field})});
})();

// Move the original cell item, rather than creating another copy of it.
(() => {
 'use strict';
 let drag=null,menu=null;
 const writable=()=>board&&!loading&&!blocked&&!window.whiteboardHosted?.paused&&window.whiteboardHosted?.role!=='viewer';
 const tableFor=el=>{const root=el.closest('.node[data-id],#immersiveSurface[data-id]');if(!root||!root.matches('#nodes>.node')&&root.id!=='immersiveSurface')return null;return board?.nodes.find(n=>n.id===root.dataset.id&&n.type==='table')};
 const signature=n=>JSON.stringify([n.columns,n.rows,n.rowIds,n.columnIds,n.cellItems]);
 function sourceFor(handle){const section=handle.closest('[data-cell-item]'),table=tableFor(handle);if(!section||!table||handle.closest('.note-source-card'))return null;const r=+section.dataset.cellR,c=+section.dataset.cellC,index=+section.dataset.cellItem,item=table.cellItems?.[r]?.[c]?.[index];return item?{board,table,r,c,index,item,signature:signature(table)}:null}
 function valid(source){return writable()&&source.board===board&&board.nodes.includes(source.table)&&signature(source.table)===source.signature&&source.table.cellItems?.[source.r]?.[source.c]?.[source.index]===source.item}
 function closeMenu(){menu?.remove();menu=null}
 function move(source,target){
  if(!valid(source)||!board.nodes.includes(target.table)||target.table.rows?.[target.r]?.[target.c]===undefined)return false;
  const from=source.table.cellItems[source.r][source.c],same=source.table===target.table&&source.r===target.r&&source.c===target.c,to=target.table.cellItems?.[target.r]?.[target.c]||[],index=Math.max(0,Math.min(target.index,to.length))-(same&&source.index<target.index?1:0);if(same&&index===source.index)return false;
  const sections=new Map();if(source.table===target.table)for(const root of document.querySelectorAll('#nodes>.node[data-id],#immersiveSurface[data-id]'))if(root.dataset.id===source.table.id)for(const section of root.querySelectorAll('[data-cell-item]')){const item=source.table.cellItems?.[+section.dataset.cellR]?.[+section.dataset.cellC]?.[+section.dataset.cellItem];if(item)sections.set(item.id,section)}
  undoPoint();if(source.table!==target.table&&!source.item.libraryOrigin){const origin=cellItemOrigin(source.item,source.table);if(origin)source.item.libraryOrigin=clone(origin)}from.splice(source.index,1);cellItemGrid(target.table)[target.r][target.c].splice(index,0,source.item);closeMenu();
  if(source.table===target.table&&sections.size){
   for(const root of document.querySelectorAll('#nodes>.node[data-id],#immersiveSurface[data-id]'))if(root.dataset.id===source.table.id){for(const cell of root.querySelectorAll('td[data-cell]')){const [r,c]=cell.dataset.cell.split(',').map(Number),contents=cell.querySelector(':scope>.cell-contents');if(!contents)continue;const children=(source.table.cellItems[r]?.[c]||[]).map((item,i)=>{const el=sections.get(item.id);if(el){el.dataset.cellR=r;el.dataset.cellC=c;el.dataset.cellItem=i}return el});if(children.every(Boolean))contents.replaceChildren(...children)}if(root.parentElement===$('nodes')){const n=source.table,a=assetById(n.assetId);root.dataset.documentSignature=JSON.stringify({...n,x:0,y:0,w:0,h:0,documentZoom:0,editing:editorId===n.id&&selected.has(n.id),file:a?.path,fileUpdated:fileViewVersion(a)})}}
  }
  drawNodes();renderOutline();change();
  const root=[...document.querySelectorAll('#immersiveSurface[data-id],#nodes>.node[data-id]')].find(el=>el.dataset.id===target.table.id&&el.querySelector('[data-cell-item]'));
  const focusOwner={board,id:boardId,editor:editorId,active:document.activeElement,signature:signature(target.table)};
  requestAnimationFrame(()=>{
   if(board!==focusOwner.board||boardId!==focusOwner.id||editorId!==focusOwner.editor||!writable()||!document.hasFocus()||document.hidden||document.activeElement!==focusOwner.active||!board.nodes.includes(target.table)||signature(target.table)!==focusOwner.signature||!root?.isConnected||!root.getClientRects().length||root.closest('[inert],[hidden],[aria-hidden="true"]')||frameElement&&(frameElement.hidden||!frameElement.getClientRects().length))return;
   const section=[...root.querySelectorAll('[data-cell-item]')].find(el=>target.table.cellItems?.[+el.dataset.cellR]?.[+el.dataset.cellC]?.[+el.dataset.cellItem]?.id===source.item.id);section?.querySelector('[data-cell-move]')?.focus({preventScroll:true})
  });return true;
 }
 function showMenu(handle,source){
  if(!valid(source))return;closeMenu();menu=document.createElement('section');menu.className='cell-move-menu inline-ui';menu.setAttribute('popover','manual');menu.setAttribute('aria-label','移动内容');
  menu.innerHTML='<strong>移到</strong><label>行<select data-move-row></select></label><label>列<select data-move-column></select></label><label>位置<select data-move-order><option value="end">最后</option><option value="start">最前</option></select></label><div><button data-move-cancel>取消</button><button data-move-confirm>移动</button></div>';
  const rows=menu.querySelector('[data-move-row]'),cols=menu.querySelector('[data-move-column]');source.table.rows.forEach((_,i)=>rows.add(new Option('第 '+(i+1)+' 行',String(i))));source.table.columns.forEach((name,i)=>cols.add(new Option(name||'第 '+(i+1)+' 列',String(i))));rows.value=source.r;cols.value=source.c;
  menu.querySelector('[data-move-cancel]').onclick=()=>{closeMenu();handle.focus({preventScroll:true})};menu.querySelector('[data-move-confirm]').onclick=()=>{const target={table:source.table,r:+rows.value,c:+cols.value,index:menu.querySelector('[data-move-order]').value==='start'?0:(source.table.cellItems?.[+rows.value]?.[+cols.value]?.length||0)};if(!move(source,target)){closeMenu();handle.focus({preventScroll:true})}};
  (handle.closest('dialog')||document.body).append(menu);menu.showPopover();const rect=handle.getBoundingClientRect(),w=Math.min(280,innerWidth-24);Object.assign(menu.style,{width:w+'px',left:Math.max(12,Math.min(innerWidth-w-12,rect.left))+'px',top:Math.max(12,Math.min(innerHeight-menu.offsetHeight-12,rect.bottom+6))+'px'});rows.focus();
 }
 function clearDrag(){const session=drag;if(!session)return;drag=null;cancelAnimationFrame(session.frame);session.ghost?.remove();document.querySelectorAll('.cell-drop-target,.cell-drop-before,.cell-drop-after').forEach(el=>el.classList.remove('cell-drop-target','cell-drop-before','cell-drop-after'));document.documentElement.classList.remove('moving-cell-item');try{session.handle.releasePointerCapture(session.pointer)}catch{}}
 function destination(session){
  document.querySelectorAll('.cell-drop-target,.cell-drop-before,.cell-drop-after').forEach(el=>el.classList.remove('cell-drop-target','cell-drop-before','cell-drop-after'));
  const hit=document.elementFromPoint(session.x,session.y),cell=hit?.closest('td[data-cell]'),table=cell&&tableFor(cell);session.target=null;if(!cell||!table||hit.closest('.note-source-card'))return;
  const [r,c]=cell.dataset.cell.split(',').map(Number);if(table.rows?.[r]?.[c]===undefined)return;const items=table.cellItems?.[r]?.[c]||[],card=hit.closest('[data-cell-item]');let index=items.length;if(card&&cell.contains(card)){const rect=card.getBoundingClientRect(),after=session.y>=rect.top+rect.height/2;index=+card.dataset.cellItem+(after?1:0);card.classList.add(after?'cell-drop-after':'cell-drop-before')}cell.classList.add('cell-drop-target');session.target={table,r,c,index};
  const scroll=cell.closest('.table-scroll');if(scroll){const rect=scroll.getBoundingClientRect();scroll.scrollLeft+=session.x<rect.left+28?-10:session.x>rect.right-28?10:0;scroll.scrollTop+=session.y<rect.top+28?-10:session.y>rect.bottom-28?10:0}
 }
 function dragFrame(){const session=drag;if(!session?.moving)return;destination(session);session.frame=requestAnimationFrame(dragFrame)}
 document.addEventListener('pointerdown',event=>{
  if(menu&&!menu.contains(event.target)&&!event.target.closest?.('[data-cell-move]'))closeMenu();
  const handle=event.target.closest?.('[data-cell-move]');if(!handle||event.button!==0||drag)return;const source=sourceFor(handle);if(!source||!valid(source))return;event.preventDefault();event.stopImmediatePropagation();closeMenu();drag={source,handle,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,moving:false};handle.setPointerCapture(event.pointerId);
 },true);
 document.addEventListener('pointermove',event=>{const session=drag;if(!session||event.pointerId!==session.pointer)return;session.x=event.clientX;session.y=event.clientY;if(!session.moving&&Math.hypot(session.x-session.startX,session.y-session.startY)<6)return;event.preventDefault();event.stopImmediatePropagation();if(!session.moving){session.moving=true;session.ghost=document.createElement('div');session.ghost.className='cell-drag-ghost';session.ghost.textContent=String(session.source.item.title||'移动内容');document.body.append(session.ghost);document.documentElement.classList.add('moving-cell-item');dragFrame()}Object.assign(session.ghost.style,{left:Math.max(4,Math.min(innerWidth-180,session.x+12))+'px',top:Math.max(4,Math.min(innerHeight-44,session.y+12))+'px'})},true);
 document.addEventListener('pointerup',event=>{const session=drag;if(!session||event.pointerId!==session.pointer)return;event.preventDefault();event.stopImmediatePropagation();if(session.moving)destination(session);const target=session.target,moving=session.moving;clearDrag();if(moving){if(target)move(session.source,target)}else showMenu(session.handle,session.source)},true);
 document.addEventListener('pointercancel',event=>{if(drag?.pointer===event.pointerId)clearDrag()},true);document.addEventListener('lostpointercapture',event=>{if(drag?.pointer===event.pointerId)clearDrag()},true);
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(drag||menu)){event.preventDefault();event.stopImmediatePropagation();clearDrag();closeMenu();return}const handle=event.target.closest?.('[data-cell-move]');if(!handle)return;const source=sourceFor(handle);if(!source||!valid(source))return;if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();showMenu(handle,source);return}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopImmediatePropagation();const target={table:source.table,r:source.r,c:source.c,index:0};if((event.ctrlKey||event.metaKey)&&['ArrowUp','ArrowDown'].includes(event.key))target.index=source.index+(event.key==='ArrowUp'?-1:2);else{target.r+=event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0;target.c+=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0;target.index=source.table.cellItems?.[target.r]?.[target.c]?.length||0}move(source,target)},true);
 const oldDraw=drawNodes;drawNodes=function(){oldDraw();if(!board||window.whiteboardHosted?.paused||window.whiteboardHosted?.role==='viewer')return;for(const handle of document.querySelectorAll('#nodes>.node [data-cell-move],#immersiveSurface[data-id] [data-cell-move]'))if(!handle.closest('.note-source-card')){handle.disabled=false;handle.tabIndex=0;handle.setAttribute('aria-label','移动内容：'+(sourceFor(handle)?.item.title||'未命名内容'));handle.title='拖动移动；回车选择位置'}};
 window.whiteboardCellMovement={active:()=>!!drag||!!menu};$('dialog').addEventListener('close',()=>{clearDrag();closeMenu()});
 window.addEventListener('creative-board-loading',()=>{clearDrag();closeMenu()});window.addEventListener('blur',clearDrag);
})();

// Create original notes and files in the selected cell from one table Add menu.
(() => {
 const previous=mountTableEditor,places=new WeakMap();let menu=null,opener=null;
 const style=document.createElement('style');style.textContent='.node.table .cell-shared-original-add{display:none!important}.node.table .cell-insert-target{outline:2px solid var(--ui-accent,#9a8760);outline-offset:-2px}.cell-add-menu{position:fixed;inset:auto;margin:0;padding:6px;min-width:170px;max-width:calc(100vw - 24px);border:1px solid var(--ui-line);border-radius:6px;background:var(--ui-panel);color:var(--ui-text);box-shadow:0 8px 24px #0003}.cell-add-menu button{display:block;width:100%;min-height:44px;text-align:left;border:0;background:transparent;color:inherit}.cell-add-menu button:disabled{opacity:.5}.cell-add-menu hr{border:0;border-top:1px solid var(--ui-line);margin:4px 0}';document.head.append(style);
 function close(restore=false){const old=opener;menu?.remove();menu=null;opener=null;if(restore&&old?.isConnected)old.focus({preventScroll:true})}
 document.addEventListener('pointerdown',event=>{if(menu&&!menu.contains(event.target)&&event.target!==opener)close()},true);
 window.addEventListener('keydown',event=>{if(!menu)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true)}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();const all=[...menu.querySelectorAll('button:not(:disabled)')],i=all.indexOf(document.activeElement);all[event.key==='Home'?0:event.key==='End'?all.length-1:(i+(event.key==='ArrowUp'?-1:1)+all.length)%all.length]?.focus()}},true);
 window.addEventListener('creative-board-loading',()=>close());window.addEventListener('blur',()=>close());document.addEventListener('visibilitychange',()=>{if(document.hidden)close()});window.whiteboardCellCreation={dismiss:()=>{if(!menu)return false;close(true);return true}};
 mountTableEditor=function(n){
  previous(n);if(n.documentMode)return;const root=$('inlineTable'),owner=board,ownerId=boardId,actions=root.querySelector('.table-actions'),addRow=root.querySelector('#tableAddRow'),addColumn=root.querySelector('#tableAddColumn');
  const editable=()=>document.hasFocus()&&board===owner&&boardId===ownerId&&board.nodes.includes(n)&&editorId===n.id&&root.isConnected&&!root.closest('[inert],[hidden],[aria-hidden="true"]')&&!(frameElement&&(frameElement.hidden||!frameElement.getClientRects().length))&&!loading&&!blocked&&!window.whiteboardHosted?.paused&&window.whiteboardHosted?.role!=='viewer';
  let place=places.get(n)||{row:n.rowIds[0],column:n.columnIds[0]};places.set(n,place);
  const shared=document.createElement('button');shared.type='button';shared.dataset.cellAdd='';shared.textContent='添加';shared.setAttribute('aria-haspopup','menu');addRow.classList.add('cell-shared-original-add');addColumn.classList.add('cell-shared-original-add');actions.prepend(shared);
  const position=()=>{const r=n.rowIds.indexOf(place.row),c=n.columnIds.indexOf(place.column);return r>=0&&c>=0&&n.rows[r]?.[c]!==undefined?{r,c}:null};
  const paint=()=>{for(const cell of root.querySelectorAll('.cell-insert-target'))cell.classList.remove('cell-insert-target');const at=position();if(at)root.querySelector('[data-cell="'+at.r+','+at.c+'"]')?.classList.add('cell-insert-target');const label=at?'向第'+(at.r+1)+'行第'+(at.c+1)+'列添加内容，或添加行列':'添加行列';shared.setAttribute('aria-label',label);shared.title=label};
  const choose=event=>{const cell=event.target.closest?.('td[data-cell]');if(!cell||!root.contains(cell))return;const [r,c]=cell.dataset.cell.split(',').map(Number);place={row:n.rowIds[r],column:n.columnIds[c]};places.set(n,place);paint()};root.addEventListener('pointerdown',choose);root.addEventListener('focusin',choose);paint();
  shared.onclick=event=>{
   if(!editable())return;close();opener=shared;const row=place.row,column=place.column,target=()=>{if(!editable()||place.row!==row||place.column!==column)return null;return position()};menu=document.createElement('div');menu.className='cell-add-menu inline-ui';menu.setAttribute('popover','manual');menu.setAttribute('role','menu');menu.setAttribute('aria-label','添加到单元格');
   const ownMenu=menu,item=(label,action,disabled=false)=>{const option=document.createElement('button');option.type='button';option.setAttribute('role','menuitem');option.textContent=label;option.disabled=disabled;option.onclick=()=>{if(menu!==ownMenu||!ownMenu.isConnected)return;close();action()};ownMenu.append(option)};
   item('便签',()=>{const at=target();if(!at)return;const value={id:uid(),type:'note',sizeMode:'auto',x:0,y:0,w:300,h:120,title:'',body:'',userText:'',annotation:'',tags:[],color:colors[0]};undoPoint();cellItemGrid(n)[at.r][at.c].push(value);drawNodes();change();if(board!==owner||boardId!==ownerId||!board.nodes.includes(n)||editorId!==n.id||loading||blocked||window.whiteboardHosted?.paused||window.whiteboardHosted?.role==='viewer')return;const host=document.querySelector('#immersiveSurface[data-id="'+CSS.escape(n.id)+'"]')||document.querySelector('#nodes>.node[data-id="'+CSS.escape(n.id)+'"]');if(!host?.isConnected||host.closest('[inert],[hidden],[aria-hidden="true"]')||!document.hasFocus())return;const section=[...(host?.querySelectorAll('[data-cell-item]')||[])].find(e=>n.cellItems?.[+e.dataset.cellR]?.[+e.dataset.cellC]?.[+e.dataset.cellItem]?.id===value.id),field=section?.querySelector('[data-cell-note-field="title"]');field?.focus({preventScroll:true});field?.scrollIntoView({block:'nearest'})},!target());
   item('文件',()=>{const at=target();if(!at)return;const original=root.querySelector('[data-add-images="'+at.r+','+at.c+'"]');original?.onclick?.call(original,event)},!target());menu.append(document.createElement('hr'));
   item('行',()=>{if(editable())addRow.onclick?.()});item('列',()=>{if(editable())addColumn.onclick?.()});
   (shared.closest('dialog[open]')||document.body).append(menu);menu.showPopover();const bounds=shared.getBoundingClientRect();menu.style.left=Math.max(12,Math.min(bounds.left,innerWidth-menu.offsetWidth-12))+'px';menu.style.top=Math.max(12,Math.min(bounds.bottom,innerHeight-menu.offsetHeight-12))+'px';menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});event.preventDefault();event.stopPropagation();
  };
 };
})();
