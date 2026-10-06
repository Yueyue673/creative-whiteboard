// Reading, placement and table sizing use the same rules in every document.
(() => {
 'use strict';
 interfaceSettings=()=>whiteboardAppearance.open();
 canvas.addEventListener('click',e=>{const action=e.target.closest('.table-options button');if(action)action.closest('details').open=false});
 let immersion=null;
 function canvasBlock(id){return [...$('nodes').children].find(el=>el.dataset.id===id)}
 function restoreEditor(){if(!immersion)return;const inner=immersion.surface.querySelector('.inner');if(inner)canvasBlock(immersion.id)?.prepend(inner)}
 function finishImmersion(session=immersion){if(!session||immersion!==session)return;restoreEditor();immersion=null;$('dialog').classList.remove('reading-dialog','immersive-dialog');editorId=null;drawNodes();renderOutline();const area=canvasBlock(session.id)?.querySelector('.edit-scroll');if(area)area.scrollTop=session.originalScroll;canvas.focus({preventScroll:true})}
 const previousDialog=showDialog;showDialog=function(...args){if(immersion){finishImmersion();$('dialog').close()}return previousDialog(...args)};
 function expandEditor(){if(!immersion)return;const el=canvasBlock(immersion.id),inner=el?.querySelector('.inner');if(!inner)return;immersion.surface.className=el.className.replace(/\bactive\b/g,'')+' reading-sheet immersive-surface';immersion.surface.style.background=el.style.background;immersion.surface.style.setProperty('--body-size',(board.nodes.find(n=>n.id===immersion.id)?.fontSize||16)+'px');immersion.surface.style.setProperty('--title-size',(board.nodes.find(n=>n.id===immersion.id)?.titleFontSize||24)+'px');immersion.surface.replaceChildren(inner);if($('inlineDone'))$('inlineDone').onclick=()=>$('dialog').close();growContentFields(immersion.surface)}
 function readNote(id){
  const n=board?.nodes.find(n=>n.id===id);if(!n||n.type==='frame')return;if(blocked)return toast('请先处理保存冲突');if(immersion){finishImmersion();$('dialog').close()}
  const originalScroll=canvasBlock(id)?.querySelector('.edit-scroll')?.scrollTop||0;
  openEditor(id);
  showDialog('<div class="immersive-heading"><span>展开编辑</span><div><button id="immersiveDetails">补充与来源</button><button id="immersiveReturn">返回白板 <small>Esc</small></button></div></div><article class="reading-sheet node immersive-surface" id="immersiveSurface"></article>',[]);
  const dialog=$('dialog');dialog.classList.add('reading-dialog','immersive-dialog');immersion={id,surface:$('immersiveSurface'),originalScroll};immersion.surface.dataset.id=id;const session=immersion;
  $('immersiveReturn').onclick=()=>dialog.close();$('immersiveDetails').onclick=()=>{$('inlineMeta').open=!$('inlineMeta').open;growContentFields()};expandEditor();
  onDialogDismiss(()=>finishImmersion(session));
 }
 const originalFit=whiteboardExperience.fitBlock;
 whiteboardExperience.fitBlock=function(id){const el=canvasBlock(id),n=board.nodes.find(n=>n.id===id),area=el?.querySelector('.edit-scroll'),gallery=area?.querySelector(':scope>.single-image'),img=gallery?.querySelector('img');if(!n||!img?.naturalWidth)return originalFit(id);const style=getComputedStyle(area),width=area.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),other=[...area.children].filter(c=>c!==gallery&&getComputedStyle(c).display!=='none').reduce((sum,c)=>{const s=getComputedStyle(c);return sum+c.offsetHeight+parseFloat(s.marginTop||0)+parseFloat(s.marginBottom||0)},0);undoPoint();n.h=Math.ceil(Math.max(120,Math.min(5000,width*img.naturalHeight/img.naturalWidth+other+parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+10)));drawNodes();change()};
 const previousMenu=fileMenu;fileMenu=function(e,items){const el=e.target.closest?.('.node[data-id]');if(el&&!e.target.closest('[data-edge]'))items=[['展开编辑',()=>readNote(el.dataset.id)],...items.map(([label,fn])=>[label,label==='按内容调整大小'?()=>whiteboardExperience.fitBlock(el.dataset.id):fn])];return previousMenu(e,items)};
 function positionActions(){
  if(!board)return;const bounds=canvas.getBoundingClientRect(),z=view().z,scale=String(1/z);
  // Keep the same click targets: hide the drag caption, then stack only when three icons cannot fit.
  canvas.classList.toggle('compact-actions',bounds.width<156);canvas.classList.toggle('stacked-actions',bounds.width<99);
  if($('nodes').style.getPropertyValue('--canvas-control-scale')!==scale)$('nodes').style.setProperty('--canvas-control-scale',scale);
  const elements=[...$('nodes').querySelectorAll(':scope>.node.active')],focused=document.activeElement?.closest('.block-actions')?.closest('.node');
  if(focused?.parentElement===$('nodes')&&!focused.classList.contains('active'))elements.push(focused);
  // Measure before writing positions so selecting many cards does not force a layout per card.
  const obstacles=['canvasTools','creationDock','textSizeTools'].map(id=>$(id)?.getBoundingClientRect()).filter(r=>r?.width&&r.height);
  const placements=elements.map(el=>{const actions=el.querySelector('.block-actions');if(!actions)return null;const r=el.getBoundingClientRect(),below=r.top-bounds.top<42,width=actions.offsetWidth,height=actions.offsetHeight;
   const left=r.right-z-width,top=below?r.bottom+7-z:r.top-height-7+z,visible=r.right>bounds.left&&r.left<bounds.right&&r.bottom>bounds.top&&r.top<bounds.bottom;
   let x=left,y=top;
   if(visible){const mx=Math.min(6,Math.max(0,(bounds.width-width)/2)),my=Math.min(6,Math.max(0,(bounds.height-height)/2)),clamp=p=>({x:Math.max(bounds.left+mx,Math.min(p.x,bounds.right-width-mx)),y:Math.max(bounds.top+my,Math.min(p.y,bounds.bottom-height-my))}),overlap=(p,b,gap=0)=>p.x<b.right+gap&&p.x+width>b.left-gap&&p.y<b.bottom+gap&&p.y+height>b.top-gap;
    const start=clamp({x,y}),choices=[start,clamp({x:left,y:below?r.top-height-7+z:r.bottom+7-z})];
    for(const b of obstacles)choices.push(...[{x:b.left-width-6,y:start.y},{x:b.right+6,y:start.y},{x:start.x,y:b.top-height-6},{x:start.x,y:b.bottom+6}].map(clamp));
    const free=choices.filter(p=>!obstacles.some(b=>overlap(p,b,5.8)));free.sort((a,b)=>Number(overlap(a,r))-Number(overlap(b,r))||(a.x-left)**2+(a.y-top)**2-(b.x-left)**2-(b.y-top)**2);
    ({x,y}=free[0]||start);
   }
   return {actions,below,dx:x-left,dy:y-top};
  });
  for(const p of placements){if(!p)continue;const {actions,below,dx,dy}=p,key=[z,below,dx,dy].join('|');if(actions.dataset.position===key)continue;actions.dataset.position=key;actions.style.transform='scale('+1/z+')';actions.style.right=(-dx/z)+'px';actions.style.bottom=below?'auto':'calc(100% + '+(7-dy)/z+'px)';actions.style.top=below?'calc(100% + '+(7+dy)/z+'px)':'auto';actions.style.transformOrigin=below?'top right':'bottom right'}
 }
 const canvasBounds=new ResizeObserver(positionActions);for(const el of [canvas,$('canvasTools'),$('creationDock'),$('textSizeTools')])if(el)canvasBounds.observe(el);
 $('nodes').addEventListener('focusin',e=>{if(e.target.closest('.block-actions'))positionActions()});
 function mount(){const byId=new Map(board?.nodes.map(n=>[n.id,n])||[]);for(const el of $('nodes').children){const n=byId.get(el.dataset.id);if(!n)continue;const limit=String(Math.min(Number(n.w)||300,Number(n.h)||120)/40);if(el.style.getPropertyValue('--handle-limit')!==limit)el.style.setProperty('--handle-limit',limit);const actions=el.querySelector('.block-actions');if(actions&&!actions.querySelector('.block-read')&&n.type!=='frame'){const b=document.createElement('button');b.className='block-read';b.title='展开编辑';b.setAttribute('aria-label','展开编辑');b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"/></svg>';b.onclick=e=>{e.stopPropagation();readNote(n.id)};actions.prepend(b)}const drag=actions?.querySelector('.block-transfer');if(drag&&!drag.dataset.refined){drag.dataset.refined='true';drag.title='按住拖动，把副本放到表格、内容库或另一张白板';drag.setAttribute('aria-label','拖出副本');drag.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="5" r="1.5"/><circle cx="16" cy="5" r="1.5"/><circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/><circle cx="8" cy="19" r="1.5"/><circle cx="16" cy="19" r="1.5"/></svg><span>拖出副本</span>'}
  for(const handle of el.querySelectorAll('.table-column-resize'))bindWidth(handle,n);
 }positionActions()}
 const draw=drawNodes;drawNodes=function(){restoreEditor();draw();mount();expandEditor()};const select=refreshSelectionUI;refreshSelectionUI=function(){select();mount()};
 const previousMove=moveView;moveView=function(){previousMove();positionActions()};
 const layout=tableLayout;tableLayout=function(n){const widths=n.columns.map((_,i)=>Math.max(100,Math.min(900,n.columnWidths?.[i]||160))),width=38+widths.reduce((a,b)=>a+b,0);const explicit=n.columnWidths?.length===n.columns.length;return layout(n).replace(/style="min-width:[^"]+"/,'style="min-width:'+(explicit?width:38+n.columns.length*140)+'px;width:'+(explicit?width+'px':'100%')+'"').replace('<thead>','<colgroup><col style="width:38px">'+widths.map(w=>explicit?'<col style="width:'+w+'px">':'<col>').join('')+'</colgroup><thead>').replace(/(<th data-col-target="(\d+)"[^>]*>)/g,'$1<span class="table-column-resize inline-ui" data-width-column="$2" aria-label="调整列宽"></span>')};
 function bindWidth(handle,n){if(handle.dataset.bound)return;handle.dataset.bound='true';let start=null;handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();undoPoint();const heads=[...handle.closest('table').querySelectorAll('thead th[data-col-target]')];n.columnWidths=n.columns.map((_,i)=>n.columnWidths?.[i]||heads[i].offsetWidth);start={x:e.clientX,width:n.columnWidths[+handle.dataset.widthColumn],z:handle.closest('.immersive-surface')?1:view().z};handle.setPointerCapture(e.pointerId);handle.classList.add('resizing')};handle.onpointermove=e=>{if(!start)return;e.preventDefault();const i=+handle.dataset.widthColumn;n.columnWidths[i]=Math.max(100,Math.min(900,start.width+(e.clientX-start.x)/start.z));const table=handle.closest('table'),width=38+n.columnWidths.reduce((a,b)=>a+b,0);table.querySelectorAll('col')[i+1].style.width=n.columnWidths[i]+'px';table.style.width=table.style.minWidth=width+'px';growContentFields(table)};const end=()=>{if(!start)return;start=null;handle.classList.remove('resizing');change()};handle.onpointerup=end;handle.onpointercancel=end;handle.onlostpointercapture=end;handle.ondblclick=e=>{e.stopPropagation();undoPoint();n.columnWidths=n.columns.map((_,i)=>i===+handle.dataset.widthColumn?160:n.columnWidths?.[i]||160);drawNodes();change()}}
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
