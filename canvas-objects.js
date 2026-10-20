// Direct manipulation of original board objects. Original image bytes are never edited.
(() => {
 'use strict';
 const kinds=new Set(['image','rect','ellipse','arrow','line','freehand','text']);
 const object=n=>n?.canvasObject&&kinds.has(n.canvasObject.kind)?n.canvasObject:null;
 const imageOf=n=>n.images?.[0]||(n.image?{data:n.image,name:n.title}:null);
 const colour=(value,fallback='#364152')=>/^#[\da-f]{6}$/i.test(value||'')?value:fallback;
 const font=value=>String(value||'').replace(/["'<>;{}\\]/g,'').slice(0,100)||'sans-serif';
 const scaleOf=n=>Number.isFinite(n?.contentScale)?Math.max(.2,Math.min(5,n.contentScale)):1;
 const ready=()=>board&&!loading&&!blocked&&!document.querySelector('dialog[open]');
 const same=s=>s&&board===s.board&&boardId===s.boardId&&board.nodes.find(n=>n.id===s.node.id)===s.node&&!loading&&!blocked;
 const hostOf=id=>$('nodes').querySelector(':scope>.node[data-id="'+CSS.escape(id)+'"]');
 const stop=e=>{e.preventDefault();e.stopImmediatePropagation()};
 const point=e=>worldPoint(e.clientX,e.clientY);
 const source=n=>{const im=imageOf(n);return im?imageURL(im):''};
 const label=text=>window.whiteboardNoteEditor?.renderPlain?.(text)??esc(text||'');
 const cropOf=value=>{const number=(v,f)=>typeof v==='number'&&Number.isFinite(v)?v:f,x=Math.max(0,Math.min(99,number(value?.x,0))),y=Math.max(0,Math.min(99,number(value?.y,0)));return{x,y,w:Math.max(1,Math.min(100-x,number(value?.w,100))),h:Math.max(1,Math.min(100-y,number(value?.h,100)))}};
 let activeDraft=null;
 const draftFields=['objectText','objectAutomaticStroke','objectStroke','objectFill','objectTransparent','objectRough','objectWeight','objectFont','objectFontSize','imageMarkText','imageMarkColour'];
 function draftField(){const el=document.activeElement;if(!el||!draftFields.includes(el.id)||!$('dialog').contains(el))return null;return{id:el.id,start:el.selectionStart,end:el.selectionEnd,direction:el.selectionDirection,top:el.scrollTop,left:el.scrollLeft}}
 function restoreDraftField(place){const el=place&&draftFields.includes(place.id)&&$(place.id);if(!el||!$('dialog').contains(el)||el.disabled)return;el.focus({preventScroll:true});if(Number.isInteger(place.start)&&Number.isInteger(place.end)&&typeof el.setSelectionRange==='function')el.setSelectionRange(place.start,place.end,place.direction);el.scrollTop=place.top;el.scrollLeft=place.left}
 function keepDraft(session,capture){
  const entry={session,capture,field:draftField()},events=new AbortController();activeDraft=entry;
  document.addEventListener('focusin',e=>{if($('dialog').contains(e.target)&&e.target!==$('dialog'))entry.field=draftField()},{signal:events.signal});
  for(const type of ['input','selectionchange'])document.addEventListener(type,()=>{const place=draftField();if(place)entry.field=place},{signal:events.signal});
  onDialogDismiss(()=>{events.abort();if(activeDraft===entry)activeDraft=null});
 }
 function focusDraft(){const entry=activeDraft;if(!entry?.field||!same(entry.session)||!$('dialog').open)return false;restoreDraftField(entry.field);return true}
 function captureDraft(){const entry=activeDraft;if(!entry||!same(entry.session)||!$('dialog').open)return null;const field=draftField()||entry.field;return{nodeId:entry.session.node.id,original:JSON.stringify(entry.session.node),...entry.capture(),field}}
 // This is an unapplied, short-lived view. The pane checks account/workspace
 // and ETag first; the exact original object must also still match.
 function restoreDraft(place){const n=board?.nodes.find(n=>n.id===place?.nodeId);if(!ready()||!object(n)||JSON.stringify(n)!==place.original||object(n).kind!==place.kind)return false;editObject(n.id,place);return true}
 function marksSVG(marks,geometry=null){
  return (Array.isArray(marks)?marks.slice(0,500):[]).map(m=>{
   if(!m||typeof m!=='object')return '';
   const stroke=colour(m.stroke,'currentColor'),fill=m.fill==='none'?'none':colour(m.fill,'#ffffff'),weight=Math.max(.2,Math.min(8,m.weight||.7));
   const points=(Array.isArray(m.points)?m.points.slice(0,5000):[]).filter(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<=100)).map(p=>geometry?[p[0]*geometry.w/100,p[1]*geometry.h/100]:p);if(!points.length)return '';
   const [a,b=a]=points,x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]),w=Math.abs(a[0]-b[0]),h=Math.abs(a[1]-b[1]);
   const attrs=' stroke="'+stroke+'" stroke-width="'+weight+'" stroke-linecap="round" stroke-linejoin="round" fill="'+fill+'"';
   if(m.kind==='text')return '<text x="'+a[0]+'" y="'+a[1]+'" fill="'+stroke+'" font-size="'+Math.max(2,Math.min(30,m.fontSize||7))+'" font-family="'+esc(font(m.fontFamily))+'">'+esc(m.text||'')+'</text>';
   if(m.rough&&m.kind==='rect')return '<path d="M'+(x+.5)+','+(y+.5)+' Q'+(x+w*.48)+','+(y-.5)+' '+(x+w-.4)+','+(y+.3)+' Q'+(x+w+.6)+','+(y+h*.52)+' '+(x+w-.3)+','+(y+h-.4)+' Q'+(x+w*.48)+','+(y+h+.6)+' '+(x+.4)+','+(y+h-.2)+' Q'+(x-.5)+','+(y+h*.5)+' '+(x+.5)+','+(y+.5)+' Z"'+attrs+'/>';
   if(m.rough&&m.kind==='ellipse')return '<path d="M'+(x+w*.5)+','+y+' C'+(x+w*1.18)+','+(y-.6)+' '+(x+w*1.15)+','+(y+h*1.02)+' '+(x+w*.48)+','+(y+h)+' C'+(x-w*.16)+','+(y+h*1.02)+' '+(x-w*.17)+','+(y-.4)+' '+(x+w*.5)+','+y+' Z"'+attrs+'/>';
   if(m.kind==='rect')return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx=".6"'+attrs+'/>';
   if(m.kind==='ellipse')return '<ellipse cx="'+(x+w/2)+'" cy="'+(y+h/2)+'" rx="'+w/2+'" ry="'+h/2+'"'+attrs+'/>';
   let d=points.map((p,i)=>(i?'L':'M')+p.join(',')).join(' ');if(geometry&&m.kind==='freehand'&&points.length>2){d='M'+points[0].join(',');for(let i=1;i<points.length-1;i++)d+=' Q'+points[i].join(',')+' '+[(points[i][0]+points[i+1][0])/2,(points[i][1]+points[i+1][1])/2].join(',');d+=' L'+points.at(-1).join(',')}
   if(m.kind==='arrow'){const angle=Math.atan2(b[1]-a[1],b[0]-a[0]),length=Math.min(7,Math.hypot(w,h)*.3);d+=' M'+[b[0]-length*Math.cos(angle-.5),b[1]-length*Math.sin(angle-.5)].join(',')+' L'+b.join(',')+' L'+[b[0]-length*Math.cos(angle+.5),b[1]-length*Math.sin(angle+.5)].join(',')}
   return '<path d="'+d+'"'+attrs+'/>';
  }).join('');
 }
 function artwork(n){
  const o=object(n);if(!o)return '';
  if(o.kind==='image'){
   const crop=cropOf(o.crop);
   return '<div class="object-art image-art" style="--crop-x:'+crop.x+';--crop-y:'+crop.y+';--crop-w:'+crop.w+';--crop-h:'+crop.h+'"><div class="object-original"><img draggable="false" src="'+esc(source(n))+'" alt="'+esc(n.title||'图片')+'"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+marksSVG(o.marks)+'</svg></div></div>';
  }
  if(o.kind==='text')return '<div class="object-art object-text" style="color:'+colour(o.stroke,'var(--ui-text,#364152)')+';font-family:'+esc(font(o.fontFamily))+';font-size:'+Math.max(8,Math.min(200,n.fontSize||24))+'px">'+label(n.body)+'</div>';
  const mark={...o,points:o.points||[[3,3],[97,97]],weight:o.weight||1,fill:o.fill||'none'};
  // Newly drawn strokes use board units; earlier drawings keep their original rendering.
  const geometry=o.strokeMode==='uniform'?{w:n.w,h:n.h}:null;return '<svg class="object-art object-drawing" viewBox="0 0 '+(geometry?n.w+' '+n.h:'100 100')+'" preserveAspectRatio="none" aria-label="'+esc(n.title||'图形')+'">'+marksSVG([mark],geometry)+'</svg>'+(n.body?'<div class="object-label" style="color:'+colour(o.stroke,'var(--ui-text,#364152)')+';font-family:'+esc(font(o.fontFamily))+'">'+label(n.body)+'</div>':'');
 }
 const baseMarkup=noteMarkup;
 noteMarkup=function(n,readOnly=false){
  if(!object(n))return baseMarkup(n,readOnly);
  // Reuse the original node ports/geometry, not an embedded second canvas.
  const html=baseMarkup(n,readOnly),start=html.indexOf('<div class="inner'),end=html.indexOf('<span class="port');
  return html.slice(0,start).replace('class="node ','class="node canvas-object object-'+object(n).kind+' ')+'<div class="inner object-surface">'+artwork(n)+'</div>'+html.slice(end);
 };
 const cells=cellContentMarkup;cellContentMarkup=function(n,r,c){return cells(n,r,c).replace(/(<section\b[^>]*\bdata-cell-item="(\d+)"[^>]*>)/g,(markup,indexTag,index)=>{const item=n.cellItems?.[r]?.[c]?.[+index],o=object(item);return !o||o.kind==='text'?markup:markup+'<div class="cell-object-art">'+artwork({...item,body:''})+'</div>'})};
 function mount(){
  if(!board)return;
  const elements=new Map([...$('nodes').children].map(el=>[el.dataset.id,el]));
  for(const n of board.nodes){
   const o=object(n);if(!o&&n.type!=='table')continue;
   const el=elements.get(n.id);if(!el)continue;const s=scaleOf(n),inner=el.querySelector(':scope>.inner');
   if(n.type==='table'&&inner){el.style.setProperty('--object-scale',s);inner.style.zoom=String(s);inner.style.width='100%';inner.style.height='100%'}
   el.classList.add('object-resizable');
   for(const dir of (o?.kind==='image'?['nw','ne','sw','se']:['nw','ne','sw','se','n','s','w','e'])){
    let h=el.querySelector(':scope>[data-resize-direction="'+dir+'"]');
    if(!h){h=document.createElement('span');h.className='resize object-handle handle-'+dir;h.dataset.resizeDirection=dir;el.append(h)}
    h.classList.add('object-handle','handle-'+dir);h.title=n.type==='table'?(dir.length===2?'等比缩放表格和内容':'调整表格'+(dir==='n'||dir==='s'?'高度':'宽度')+'，字号不变'):(dir.length===2?'等比调整大小':'调整'+(dir==='n'||dir==='s'?'高度':'宽度'));h.setAttribute('aria-label',h.title);h.tabIndex=0;h.setAttribute('role','button');
   }
   if(o){
    const actions=el.querySelector('.block-actions');
    if(actions){const edit=actions.querySelector('.object-edit,.block-read')||document.createElement('button');edit.classList.add('object-edit');edit.textContent=o.kind==='image'?'裁剪 / 标注':'样式 / 文字';edit.title=edit.textContent;edit.setAttribute('aria-label',edit.textContent);edit.onclick=e=>{e.stopPropagation();editObject(n.id)};if(!edit.parentElement)actions.prepend(edit)}
   }
  }
 }
 const draw=drawNodes;drawNodes=function(){draw();mount();if(resize?.pending&&same(resize))paintResize(resize)};
 const refresh=refreshSelectionUI;refreshSelectionUI=function(){refresh();mount()};
 // Keep image insertion atomic with the existing scoped library operation.
 const bundle=itemBundle;itemBundle=function(a){const result=bundle(a);if(a.mime?.startsWith('image/')&&a.mime!==bundleMime&&!a.notes?.trim()){const n=result.nodes[0];n.canvasObject={kind:'image'};n.sizeMode='manual'}return result};
 let resize=null;
 // Layout edges use the same logical units as column editing. Corners only scale the whole table.
 function fitTableColumns(n,width,scale){
  if(!Array.isArray(n.columnWidths)||n.columnWidths.length!==n.columns.length||!n.columnWidths.every(v=>Number.isFinite(v)&&v>0))return null;
  const weights=n.columnWidths.map(v=>Math.max(100,Math.min(900,v))),total=Math.max(100*weights.length,Math.min(900*weights.length,(width-2)/scale-38)),result=Array(weights.length),free=new Set(weights.map((_,i)=>i));let remaining=total;
  while(free.size){const sum=[...free].reduce((value,i)=>value+weights[i],0),fixed=[...free].filter(i=>remaining*weights[i]/sum<100||remaining*weights[i]/sum>900);if(!fixed.length){for(const i of free)result[i]=remaining*weights[i]/sum;break}for(const i of fixed){result[i]=Math.max(100,Math.min(900,remaining*weights[i]/sum));remaining-=result[i];free.delete(i)}}return result;
 }
 function paintColumns(s,values){
  const table=hostOf(s.node.id)?.querySelector('.edit-table');if(!table)return;
  const cols=[...table.querySelectorAll(':scope>colgroup>col')];if(!s.columnStyles)s.columnStyles={table,width:table.style.width,min:table.style.minWidth,columns:cols.map(col=>col.style.width)};
  if(values){cols.slice(1).forEach((col,i)=>col.style.width=values[i]+'px');table.style.width=table.style.minWidth=(38+values.reduce((a,b)=>a+b,0))+'px'}
  else if(s.columnStyles.table===table){table.style.width=s.columnStyles.width;table.style.minWidth=s.columnStyles.min;cols.forEach((col,i)=>col.style.width=s.columnStyles.columns[i])}
  growContentFields(table);
 }
 function paintResize(s){
  const el=hostOf(s.node.id),p=s.pending;if(!el||!p)return;Object.assign(el.style,{left:p.x+'px',top:p.y+'px',width:p.w+'px',height:p.h+'px'});
  if(s.node.type==='table'){const inner=el.querySelector(':scope>.inner'),scale=p.contentScale??s.scale;el.style.setProperty('--object-scale',scale);if(inner){inner.style.zoom=String(scale);inner.style.width='100%';inner.style.height='100%'}}
  if(p.columnWidths||s.columnStyles)paintColumns(s,p.columnWidths);if(p.fontSize)el.querySelector('.object-text')?.style.setProperty('font-size',p.fontSize+'px');if(object(s.node)?.strokeMode==='uniform')el.querySelector(':scope>.object-surface').innerHTML=artwork({...s.node,...p});
  drawEdges(new Set([s.node.id]));window.whiteboardReading?.placeActions?.();
 }
 function finishResize(commit){
  const s=resize;if(!s)return;resize=null;
  document.body.classList.remove('canvas-gesture');
  if(!same(s)){try{canvas.releasePointerCapture(s.pointer)}catch{}return}
  const changed=s.pending&&(['x','y','w','h','fontSize'].some(key=>s.pending[key]!==undefined&&Math.abs(s.pending[key]-(s.node[key]??24))>1e-9)||s.pending.contentScale!==undefined&&Math.abs(s.pending.contentScale-s.scale)>1e-9);
  if(commit&&s.changed&&changed){undoPoint();Object.assign(s.node,s.pending);s.node.sizeMode='manual';change();render()}
  else if(s.changed){if(s.columnStyles)paintColumns(s,null);drawNodes();}
  document.body.classList.remove('canvas-gesture');try{if(canvas.hasPointerCapture(s.pointer))canvas.releasePointerCapture(s.pointer)}catch{}
 }
 function sizeAt(s,dx,dy){
  const dir=s.dir,o=s.original;let w=/[ew]/.test(dir)?Math.max(24,o.w+(dir.includes('w')?-dx:dx)):o.w,h=/[ns]/.test(dir)?Math.max(24,o.h+(dir.includes('n')?-dy:dy)):o.h;
  if(dir.length===2){const ax=dir.includes('w')?-dx:dx,ay=dir.includes('n')?-dy:dy,f=(o.w*(o.w+ax)+o.h*(o.h+ay))/(o.w*o.w+o.h*o.h),factor=Math.max(Math.max(24/o.w,24/o.h,.2/s.scale),Math.min(5/s.scale,f));w=o.w*factor;h=o.h*factor}
  const x=dir.includes('w')?o.x+o.w-w:o.x,y=dir.includes('n')?o.y+o.h-h:o.y;
  const columns=s.node.type==='table'&&dir.length===1&&/[ew]/.test(dir)&&Math.abs(w-o.w)>1e-9?fitTableColumns(s.node,w,s.scale):null;
  return {x,y,w,h,...(columns?{columnWidths:columns}:{}),...(s.node.type==='table'&&dir.length===2?{contentScale:s.scale*w/o.w}:{}),...(object(s.node)?.kind==='text'&&dir.length===2?{fontSize:Math.max(8,Math.min(200,(o.fontSize||24)*w/o.w))}:{})};
 }
 canvas.addEventListener('pointerdown',e=>{
  const handle=e.target.closest('.object-handle'),el=handle?.closest('.node'),n=board?.nodes.find(n=>n.id===el?.dataset.id);
  if(!n||!ready()||e.button!==0)return;stop(e);finishResize(false);if(gesture)endGesture(e,true);editorId=null;selected=new Set([n.id]);
  resize={board,boardId,node:n,pointer:e.pointerId,dir:handle.dataset.resizeDirection,start:point(e),view:clone(view()),scale:scaleOf(n),original:{x:n.x,y:n.y,w:n.w,h:n.h,contentScale:n.contentScale,sizeMode:n.sizeMode,fontSize:n.fontSize},changed:false};
  canvas.setPointerCapture(e.pointerId);document.body.classList.add('canvas-gesture');refreshSelectionUI();
 },true);
 window.addEventListener('pointermove',e=>{
  const s=resize;if(!s||e.pointerId!==s.pointer)return;stop(e);if(!same(s)||['x','y','z'].some(key=>view()[key]!==s.view[key])){finishResize(false);return}
  const p=point(e),dx=p.x-s.start.x,dy=p.y-s.start.y;if(!s.changed&&Math.hypot(dx,dy)<3)return;
  s.changed=true;s.pending=sizeAt(s,dx,dy);paintResize(s);
 },true);
 window.addEventListener('pointerup',e=>{if(resize&&e.pointerId===resize.pointer){stop(e);finishResize(true)}},true);
 window.addEventListener('pointercancel',e=>{if(resize&&e.pointerId===resize.pointer){stop(e);finishResize(false)}},true);
 window.addEventListener('lostpointercapture',e=>{if(resize&&e.pointerId===resize.pointer)finishResize(false)},true);
 const cancel=cancelCanvasGesture;cancelCanvasGesture=function(...args){if(resize){finishResize(false);return true}return cancel(...args)};
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&resize){stop(e);finishResize(false)}},true);
 window.addEventListener('blur',()=>finishResize(false));
 canvas.addEventListener('keydown',e=>{
  const h=e.target.closest('.object-handle'),n=board?.nodes.find(n=>n.id===h?.closest('.node')?.dataset.id);if(!n||!ready()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
  stop(e);const unit=e.shiftKey?10:1,s={node:n,dir:h.dataset.resizeDirection,original:clone(n),scale:scaleOf(n)},dx=e.key==='ArrowLeft'?-unit:e.key==='ArrowRight'?unit:0,dy=e.key==='ArrowUp'?-unit:e.key==='ArrowDown'?unit:0;
  undoPoint();Object.assign(n,sizeAt(s,dx,dy));n.sizeMode='manual';drawNodes();change();hostOf(n.id)?.querySelector('[data-resize-direction="'+s.dir+'"]')?.focus({preventScroll:true});
 });
 canvas.addEventListener('dblclick',e=>{if(drawingTool){stop(e);return}const el=e.target.closest('.canvas-object'),n=board?.nodes.find(n=>n.id===el?.dataset.id);if(n&&!e.target.closest('.inline-ui,.resize,.port')){stop(e);editObject(n.id)}},true);
 const open=openEditor;openEditor=function(id){const n=board?.nodes.find(n=>n.id===id);if(object(n))return editObject(id);return open(id)};
 function commitObject(session,next){if(!same(session))return false;undoPoint();session.node.canvasObject=clone(next);change();drawNodes();return true}
 function editObject(id,resume=null){
  const n=board?.nodes.find(n=>n.id===id);if(!object(n)||!ready())return;
  setTool('select');cancelCanvasGesture();selected=new Set([id]);editorId=null;refreshSelectionUI();
  if(object(n).kind==='image')return editImage(n,resume);
  const session={board,boardId,node:n},o=clone(object(n));let draftText=resume?.rawText??n.body??'';
  showDialog('<h2>图形与文字</h2><label>文字<textarea id="objectText" rows="4">'+esc(n.body||'')+'</textarea></label><div class="object-style-fields"><label><input id="objectAutomaticStroke" type="checkbox" '+(!o.stroke?'checked':'')+'>自动颜色</label><label>颜色<input id="objectStroke" type="color" value="'+colour(o.stroke)+'"></label><label>填色<input id="objectFill" type="color" value="'+colour(o.fill,'#fff0b4')+'"></label><label><input id="objectTransparent" type="checkbox" '+(!o.fill||o.fill==='none'?'checked':'')+'>不填色</label><label><input id="objectRough" type="checkbox" '+(o.rough?'checked':'')+'>手绘线条</label><label>线宽<input id="objectWeight" type="number" min="0.2" max="8" step="0.2" value="'+(o.weight||1)+'"></label><label>字体<input id="objectFont" maxlength="100" placeholder="设备上已安装的字体名称" value="'+esc(o.fontFamily||'')+'"></label><label>字号<input id="objectFontSize" type="number" min="8" max="200" value="'+(n.fontSize||24)+'"></label></div>',[['取消',()=>$('dialog').close()],['应用',()=>{if(!same(session))return $('dialog').close();if($('objectAutomaticStroke').checked)delete o.stroke;else o.stroke=$('objectStroke').value;o.fill=$('objectTransparent').checked?'none':$('objectFill').value;o.weight=Math.max(.2,Math.min(8,Number($('objectWeight').value)||1));o.rough=$('objectRough').checked;o.fontFamily=font($('objectFont').value);const body=draftText,fontSize=Math.max(8,Math.min(200,Number($('objectFontSize').value)||24));if(body!==n.body||fontSize!==n.fontSize||JSON.stringify(o)!==JSON.stringify(object(n))){undoPoint();n.body=body;n.fontSize=fontSize;n.canvasObject=o;change();drawNodes()}$('dialog').close()}]]);
  $('objectStroke').oninput=()=>{$('objectAutomaticStroke').checked=false};
  if(window.whiteboardNoteEditor?.bindDraftReference)whiteboardNoteEditor.bindDraftReference($('objectText'),()=>draftText,value=>draftText=value);else{$('objectText').value=draftText;$('objectText').oninput=()=>draftText=$('objectText').value}
  if(resume){for(const [id,value]of Object.entries(resume.values||{})){const el=id!=='objectText'&&draftFields.includes(id)&&$(id);if(el)el.type==='checkbox'?el.checked=value:el.value=value}restoreDraftField(resume.field)}
  keepDraft(session,()=>({kind:object(n).kind,rawText:draftText,values:Object.fromEntries(draftFields.filter(id=>id.startsWith('object')&&id!=='objectText'&&$(id)).map(id=>{const el=$(id);return[id,el.type==='checkbox'?el.checked:el.value]}))}));
 }
 function editImage(n,resume=null){
  const session={board,boardId,node:n},draft=clone(object(n));let edits=[],redo=[],selectedMark=-1,drawing=null,cropStart=null,moving=null,redoBefore=null,fieldGroup=null,newText='',newColour='#c94444';
  draft.crop=cropOf(draft.crop);if(!Array.isArray(draft.marks))draft.marks=[];
  const initial=clone(draft);let tool=draft.marks.length?'select':'crop';
  if(resume){Object.assign(draft,clone(resume.object));edits=resume.edits.slice();redo=resume.redo.slice();selectedMark=resume.selectedMark;tool=resume.tool;newText=resume.newText;newColour=resume.newColour}
  showDialog('<div class="image-edit-heading"><h2>编辑图片</h2><button id="imageEditCancel" type="button">取消</button><button id="imageEditApply" type="button">应用</button></div><div class="image-edit-tools" role="toolbar" aria-label="图片编辑"><div class="image-edit-modes" role="group" aria-label="选择与绘图"><button data-image-tool="select">选择</button><button data-image-tool="pan">移动</button><button data-image-tool="crop">裁剪</button><button data-image-tool="freehand">画笔</button><button data-image-tool="rect">方框</button><button data-image-tool="ellipse">圆圈</button><button data-image-tool="arrow">箭头</button><button data-image-tool="text">文字</button></div><div class="image-edit-properties" role="group" aria-label="标注内容"><input id="imageMarkColour" type="color" value="#c94444" aria-label="标注颜色"><input id="imageMarkText" placeholder="标注文字" maxlength="1000" aria-label="标注文字"><button id="imageMarkDelete" aria-label="删除选中标注">删除</button></div></div><div id="imageEditStage"><div id="imageEditPaper" tabindex="0" aria-label="图片标注"><img id="imageEditOriginal" draggable="false" alt="原图"><svg id="imageEditMarks" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg><div id="imageCropBox"><span class="image-crop-handle" data-crop-handle="nw" title="调整裁剪范围"></span><span class="image-crop-handle" data-crop-handle="ne" title="调整裁剪范围"></span><span class="image-crop-handle" data-crop-handle="sw" title="调整裁剪范围"></span><span class="image-crop-handle" data-crop-handle="se" title="调整裁剪范围"></span></div><div id="imageMarkSelection" hidden></div></div></div><div class="image-edit-footer"><div class="image-edit-history" role="group" aria-label="修改记录"><button id="imageEditUndo">撤销</button><button id="imageEditRedo">重做</button><button id="imageEditRestore">恢复原图</button></div><p class="image-edit-status" id="imageEditStatus"></p><div class="image-edit-zoom" role="group" aria-label="图片视图"><button id="imageZoomOut" aria-label="缩小图片">−</button><output id="imageZoomValue" aria-label="图片缩放比例"></output><button id="imageZoomIn" aria-label="放大图片">＋</button><button id="imageZoomFit">适合窗口</button></div></div>',[]);
  $('dialog').classList.add('image-edit-dialog');$('imageEditOriginal').src=source(n);
  const paper=$('imageEditPaper'),svg=$('imageEditMarks'),cropBox=$('imageCropBox'),selectionBox=$('imageMarkSelection'),textField=$('imageMarkText'),colourField=$('imageMarkColour'),events=new AbortController();
  // Existing marks are replaced, never mutated; history can share their unchanged points.
  const busy=()=>!!(drawing||cropStart||moving),snapshot=()=>({object:{...draft,crop:{...draft.crop},marks:[...draft.marks]},selectedMark}),restore=value=>{Object.keys(draft).forEach(key=>delete draft[key]);Object.assign(draft,clone(value.object));selectedMark=value.selectedMark>=0&&value.selectedMark<draft.marks.length?value.selectedMark:-1};
  const trim=()=>{if(edits.length>100)edits.shift()},save=()=>{edits.push(snapshot());redo=[]};
  const finishField=()=>{if(fieldGroup?.saved&&JSON.stringify(draft)===JSON.stringify(fieldGroup.before.object)&&edits.at(-1)===fieldGroup.before){edits.pop();redo=fieldGroup.redo}else if(fieldGroup?.saved)trim();fieldGroup=null};
  const markBounds=index=>{try{const box=svg.querySelector('[data-image-mark="'+index+'"]')?.getBBox();return box&&box.width+box.height>0?{x:box.x,y:box.y,w:box.width,h:box.height}:null}catch{return null}};
  function paint(){
   const c=draft.crop,m=draft.marks[selectedMark],held=busy();Object.assign(cropBox.style,{left:c.x+'%',top:c.y+'%',width:c.w+'%',height:c.h+'%'});
   svg.innerHTML=draft.marks.slice(0,500).map((mark,i)=>'<g data-image-mark="'+i+'">'+marksSVG([mark])+'</g>').join('');
   const box=tool==='select'&&m?markBounds(selectedMark):null;selectionBox.hidden=!box;if(box)Object.assign(selectionBox.style,{left:box.x+'%',top:box.y+'%',width:box.w+'%',height:box.h+'%'});
   $('imageEditUndo').disabled=held||!edits.length;$('imageEditRedo').disabled=held||!redo.length;$('imageEditApply').disabled=held;$('imageEditRestore').disabled=held;$('imageMarkDelete').disabled=held||tool!=='select'||!m;
   textField.disabled=held||!(tool==='text'||tool==='select'&&m?.kind==='text');colourField.disabled=held||tool==='crop'||tool==='pan'||tool==='select'&&!m;
   textField.style.visibility=tool==='text'||tool==='select'&&m?.kind==='text'?'visible':'hidden';colourField.style.visibility=tool==='crop'||tool==='pan'||tool==='select'&&!m?'hidden':'visible';$('imageMarkDelete').style.visibility=tool==='select'&&m?'visible':'hidden';
   document.querySelectorAll('[data-image-tool]').forEach(b=>{const active=b.dataset.imageTool===tool;b.disabled=held;b.classList.toggle('chosen',active);b.setAttribute('aria-pressed',String(active))});paper.dataset.tool=tool;paper.classList.toggle('moving-mark',!!moving?.changed);$('imageEditStage').dataset.pan=String(tool==='pan');
   $('imageEditStatus').textContent=tool==='pan'?'拖动图片，滚轮或双指缩放。':tool==='select'?(m?.kind==='text'?'拖动位置，或修改上方文字。':m?'拖动调整位置。':'点选标注，再拖动位置。'):tool==='crop'?'拖出保留范围。原图始终保留。':tool==='text'?'先输入文字，再点图片放置。':'在图片上拖动画出标注。';
  }
  function syncFields(){const m=tool==='select'?draft.marks[selectedMark]:null;textField.value=m?.kind==='text'?m.text||'':newText;colourField.value=m?colour(m.stroke):newColour}
  const local=e=>{const r=paper.getBoundingClientRect();return [Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100)),Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100))]};
  function hitMark(p){
   const r=paper.getBoundingClientRect();
   // A real hit wins before a nearby mark's touch margin can cover it.
   for(const padding of [0,8]){const tolerance={x:padding/r.width*100,y:padding/r.height*100};
   for(let i=draft.marks.length-1;i>=0;i--){const m=draft.marks[i],box=markBounds(i);if(!box||p[0]<box.x-tolerance.x||p[0]>box.x+box.w+tolerance.x||p[1]<box.y-tolerance.y||p[1]>box.y+box.h+tolerance.y)continue;
    if(['text','rect','ellipse'].includes(m.kind))return i;
    const shape=svg.querySelector('[data-image-mark="'+i+'"]>path');if(shape?.isPointInStroke?.(new DOMPoint(...p)))return i;
    const points=m.points||[];for(let j=1;j<points.length;j++){const a=points[j-1],b=points[j],ax=a[0]*r.width/100,ay=a[1]*r.height/100,dx=(b[0]-a[0])*r.width/100,dy=(b[1]-a[1])*r.height/100,px=p[0]*r.width/100-ax,py=p[1]*r.height/100-ay,t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy||1)));if(Math.hypot(px-t*dx,py-t*dy)<=padding+(m.weight||.8)*Math.max(r.width,r.height)/200)return i}
   }}return -1;
  }
  function shifted(mark,box,dx,dy){
   const points=mark.points||[];if(!points.length)return mark;const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
   const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));dx=clamp(dx,-(box?.w<=100?box.x:Math.min(...xs)),100-(box?.w<=100?box.x+box.w:Math.max(...xs)));dy=clamp(dy,-(box?.h<=100?box.y:Math.min(...ys)),100-(box?.h<=100?box.y+box.h:Math.max(...ys)));
   return {...mark,points:points.map(p=>[Math.max(0,Math.min(100,p[0]+dx)),Math.max(0,Math.min(100,p[1]+dy))])};
  }
  function end(e,cancelled=false){
   const active=moving||cropStart||drawing;if(!active||e.pointerId!==active.pointer)return;stop(e);
   if(moving){if(cancelled&&moving.changed){restore(moving.before);edits.pop();redo=moving.redo}moving=null}
   else{if(cancelled||cropStart&&(draft.crop.w<2||draft.crop.h<2)){const old=edits.pop();if(old)restore(old);redo=redoBefore||[]}redoBefore=null;cropStart=drawing=null}
   if(!cancelled)trim();try{if(paper.hasPointerCapture(e.pointerId))paper.releasePointerCapture(e.pointerId)}catch{}syncFields();paint();
  }
  const cancelPreview=()=>{const active=moving||cropStart||drawing;if(active)end({pointerId:active.pointer,preventDefault(){},stopImmediatePropagation(){}},true)};
  // This viewport belongs only to the unapplied editor. Original image coordinates
  // and the whiteboard camera/history never contain zoom or pan state.
  const stage=$('imageEditStage'),view={zoom:1,x:0,y:0,...resume?.imageView},touches=new Map();let fitScale=1,pan=null,pinch=null;
  function fitPaper(){
   const im=$('imageEditOriginal');if(!im?.naturalWidth||!stage.isConnected)return;
   const next=Math.min(Math.max(1,stage.clientWidth-32)/im.naturalWidth,Math.max(1,stage.clientHeight-32)/im.naturalHeight);
   if(busy()&&Math.abs(fitScale-next)>.00001)cancelPreview();fitScale=next;
   const w=im.naturalWidth*fitScale*view.zoom,h=im.naturalHeight*fitScale*view.zoom;
   view.x=Math.max(-w/2-stage.clientWidth/2+24,Math.min(w/2+stage.clientWidth/2-24,view.x));view.y=Math.max(-h/2-stage.clientHeight/2+24,Math.min(h/2+stage.clientHeight/2-24,view.y));
   Object.assign(paper.style,{width:w+'px',height:h+'px',left:((stage.clientWidth-w)/2+view.x)+'px',top:((stage.clientHeight-h)/2+view.y)+'px'});
   $('imageZoomValue').value=Math.round(fitScale*view.zoom*100)+'%';$('imageZoomOut').disabled=view.zoom<=.2;$('imageZoomIn').disabled=view.zoom>=8;
  }
  function zoomAt(zoom,x=stage.clientWidth/2,y=stage.clientHeight/2){
   if(busy()||!same(session))return;const next=Math.max(.2,Math.min(8,zoom)),k=next/view.zoom,px=x-stage.clientWidth/2,py=y-stage.clientHeight/2;view.x=px-(px-view.x)*k;view.y=py-(py-view.y)*k;view.zoom=next;fitPaper();
  }
  const bounds=new ResizeObserver(fitPaper);bounds.observe(stage);$('imageEditOriginal').onload=fitPaper;
  $('imageZoomIn').onclick=()=>zoomAt(view.zoom*1.25);$('imageZoomOut').onclick=()=>zoomAt(view.zoom/1.25);$('imageZoomFit').onclick=()=>{if(busy())return;Object.assign(view,{zoom:1,x:0,y:0});fitPaper()};
  stage.addEventListener('wheel',e=>{stop(e);const r=stage.getBoundingClientRect();zoomAt(view.zoom*Math.exp(-e.deltaY*.002),e.clientX-r.left,e.clientY-r.top)},{passive:false,signal:events.signal});
  const touchPair=()=>{const [a,b]=[...touches.values()];return a&&b?{x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)}:null};
  stage.addEventListener('pointerdown',e=>{
   if(!same(session))return;if(e.pointerType==='touch')touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(touches.size>=2){cancelPreview();pan=null;const pair=touchPair(),r=stage.getBoundingClientRect();pinch={...pair,zoom:view.zoom,x0:view.x,y0:view.y,cx:pair.x-r.left-stage.clientWidth/2,cy:pair.y-r.top-stage.clientHeight/2};for(const id of touches.keys())try{stage.setPointerCapture(id)}catch{}stop(e);return}
   if(tool!=='pan'&&e.button!==1)return;if(busy())return;finishField();pan={id:e.pointerId,x:e.clientX,y:e.clientY,fromX:view.x,fromY:view.y};stage.setPointerCapture(e.pointerId);stage.classList.add('panning');stop(e);
  },{capture:true,signal:events.signal});
  stage.addEventListener('pointermove',e=>{
   if(touches.has(e.pointerId))touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(pinch){if(!same(session))return;const pair=touchPair();if(!pair)return;const next=Math.max(.2,Math.min(8,pinch.zoom*pair.d/Math.max(1,pinch.d))),k=next/pinch.zoom;view.x=pinch.cx-(pinch.cx-pinch.x0)*k+pair.x-pinch.x;view.y=pinch.cy-(pinch.cy-pinch.y0)*k+pair.y-pinch.y;view.zoom=next;fitPaper();stop(e)}
   else if(pan&&pan.id===e.pointerId){if(!same(session))return;view.x=pan.fromX+e.clientX-pan.x;view.y=pan.fromY+e.clientY-pan.y;fitPaper();stop(e)}
  },{capture:true,signal:events.signal});
  const endView=e=>{touches.delete(e.pointerId);if(pinch||pan?.id===e.pointerId){pinch=null;pan=null;stage.classList.remove('panning');try{if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId)}catch{}stop(e)}};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(type,endView,{capture:true,signal:events.signal});
  document.querySelectorAll('[data-image-tool]').forEach(b=>b.onclick=()=>{if(busy())return;finishField();tool=b.dataset.imageTool;selectedMark=-1;syncFields();paint()});
  paper.onpointerdown=e=>{
   if(busy()){if(e.pointerId!==(moving||cropStart||drawing).pointer)cancelPreview();return}if(e.button!==0||e.isPrimary===false||!same(session))return;stop(e);finishField();const p=local(e);paper.focus({preventScroll:true});
   if(tool==='select'){selectedMark=hitMark(p);syncFields();paint();if(selectedMark<0)return;moving={pointer:e.pointerId,start:p,mark:clone(draft.marks[selectedMark]),box:markBounds(selectedMark),before:snapshot(),redo:[...redo],changed:false};paper.setPointerCapture(e.pointerId);return}
   const corner=tool==='crop'&&e.target.closest?.('[data-crop-handle]');if(corner){selectedMark=-1;redoBefore=[...redo];save();cropStart={pointer:e.pointerId,point:p,handle:corner.dataset.cropHandle,original:{...draft.crop}};paper.setPointerCapture(e.pointerId);paint();return}
   if(tool==='text'&&!textField.value.trim()){textField.focus();return}if(tool!=='crop'&&(draft.marks.length>=500||draft.marks.reduce((sum,m)=>sum+(m.points?.length||0),0)>=20000))return toast('这张图的标注已满，可以撤销或清除部分标注后继续。');
   selectedMark=-1;redoBefore=[...redo];save();if(tool==='crop')cropStart={pointer:e.pointerId,point:p};else{drawing={pointer:e.pointerId,limit:Math.min(5000,20000-draft.marks.reduce((sum,m)=>sum+(m.points?.length||0),0)),mark:{kind:tool,points:[p],stroke:colourField.value,fill:'none',weight:.8,...(tool==='text'?{text:textField.value,fontSize:7}:{})}};draft.marks.push(drawing.mark)}paper.setPointerCapture(e.pointerId);paint();
  };
  paper.onpointermove=e=>{
   const active=moving||cropStart||drawing;if(!active||e.pointerId!==active.pointer)return;stop(e);if(!same(session)){cancelPreview();return}const p=local(e);
   if(moving){const r=paper.getBoundingClientRect(),dx=p[0]-moving.start[0],dy=p[1]-moving.start[1];if(!moving.changed&&Math.hypot(dx*r.width/100,dy*r.height/100)<3)return;const next=shifted(moving.mark,moving.box,dx,dy);if(!moving.changed&&JSON.stringify(next)===JSON.stringify(moving.mark))return;if(!moving.changed){save();moving.changed=true}draft.marks[selectedMark]=next}
   if(cropStart){const c=cropStart.original,a=cropStart.handle?[cropStart.handle.includes('w')?c.x+c.w:c.x,cropStart.handle.includes('n')?c.y+c.h:c.y]:cropStart.point;draft.crop={x:Math.min(a[0],p[0]),y:Math.min(a[1],p[1]),w:Math.max(1,Math.abs(a[0]-p[0])),h:Math.max(1,Math.abs(a[1]-p[1]))};draft.crop.w=Math.min(draft.crop.w,100-draft.crop.x);draft.crop.h=Math.min(draft.crop.h,100-draft.crop.y)}
   if(drawing&&tool!=='text'){if(tool==='freehand'){if(drawing.mark.points.length<drawing.limit)drawing.mark.points.push(p)}else if(drawing.limit>=2)drawing.mark.points[1]=p}paint();
  };
  paper.onpointerup=e=>end(e);paper.onpointercancel=e=>end(e,true);paper.onlostpointercapture=e=>end(e,true);
  const fieldInput=(element,key)=>{if(busy())return;const mark=tool==='select'?draft.marks[selectedMark]:null;if(!mark){if(key==='text')newText=element.value;else newColour=element.value;return}if(key==='text'&&mark.kind!=='text'||mark[key]===element.value)return;if(!fieldGroup)fieldGroup={before:snapshot(),redo:[...redo],saved:false};if(!fieldGroup.saved){edits.push(fieldGroup.before);redo=[];fieldGroup.saved=true}draft.marks[selectedMark]={...mark,[key]:element.value};paint()};
  textField.oninput=()=>fieldInput(textField,'text');colourField.oninput=()=>fieldInput(colourField,'stroke');textField.onblur=colourField.onblur=finishField;
  $('imageEditUndo').onclick=()=>{if(busy())return;finishField();if(!edits.length)return;redo.push(snapshot());restore(edits.pop());syncFields();paint()};$('imageEditRedo').onclick=()=>{if(busy())return;finishField();if(!redo.length)return;edits.push(snapshot());restore(redo.pop());syncFields();paint()};
  $('imageMarkDelete').onclick=()=>{if(busy()||tool!=='select'||selectedMark<0)return;finishField();save();draft.marks.splice(selectedMark,1);trim();selectedMark=-1;syncFields();paint()};
  $('imageEditRestore').onclick=()=>{if(busy())return;finishField();save();draft.crop={x:0,y:0,w:100,h:100};draft.marks=[];trim();selectedMark=-1;syncFields();paint()};
  $('dialog').addEventListener('keydown',e=>{if(isTyping(e)||e.isComposing)return;const mod=e.ctrlKey||e.metaKey;if(mod&&!e.altKey&&['z','y'].includes(e.key.toLowerCase())){stop(e);(e.key.toLowerCase()==='y'||e.shiftKey?$('imageEditRedo'):$('imageEditUndo')).click()}else if(tool==='select'&&selectedMark>=0&&['Delete','Backspace'].includes(e.key)){stop(e);$('imageMarkDelete').click()}else if(tool==='select'&&selectedMark>=0&&!mod&&!e.altKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&!busy()){stop(e);finishField();const r=paper.getBoundingClientRect(),step=e.shiftKey?10:1,mark=draft.marks[selectedMark],dx=(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0)*100/r.width,dy=(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0)*100/r.height,next=shifted(mark,markBounds(selectedMark),dx,dy);if(JSON.stringify(next)!==JSON.stringify(mark)){save();draft.marks[selectedMark]=next;trim();paint()}}},{signal:events.signal});
  document.addEventListener('pointerdown',e=>{const active=moving||cropStart||drawing;if(e.pointerType==='touch'&&active&&active.pointer!==e.pointerId)cancelPreview()},{capture:true,signal:events.signal});window.addEventListener('blur',cancelPreview,{signal:events.signal});
  $('imageEditCancel').onclick=()=>$('dialog').close();$('imageEditApply').onclick=()=>{if(busy())return;finishField();if(same(session)&&JSON.stringify(draft)!==JSON.stringify(initial)){undoPoint();const old=object(n).crop||{w:100,h:100};n.h=Math.round(n.h*(draft.crop.h/draft.crop.w)/(old.h/old.w)*1e6)/1e6;n.canvasObject=clone(draft);change();drawNodes()}$('dialog').close()};
  // Immutable draft snapshots share unchanged point arrays; no DOM or writer
  // survives a closed iframe, and an unfinished gesture is never restored.
  keepDraft(session,()=>{cancelPreview();finishField();return{kind:'image',object:clone(draft),edits:edits.slice(),redo:redo.slice(),selectedMark,tool,newText,newColour,imageView:{...view}}});
  onDialogDismiss(()=>{events.abort();bounds.disconnect();$('dialog').classList.remove('image-edit-dialog')});syncFields();paint();fitPaper();if(resume)restoreDraftField(resume.field);
 }
 function add(kind,position=center(),extra={}){
  if(!ready())return;cancelCanvasGesture();undoPoint();const n={id:uid(),type:'note',sizeMode:'manual',x:position.x-120,y:position.y-80,w:240,h:160,title:kind==='text'?'文字':kind==='ellipse'?'椭圆':kind==='arrow'?'箭头':kind==='line'?'线条':kind==='freehand'?'画笔':'矩形',body:'',tags:[],canvasObject:{kind,fill:'none',weight:1},...extra};
  board.nodes.push(n);editorId=null;selected=new Set([n.id]);render();change();if(kind==='text')editObject(n.id);return n;
 }
 // One discoverable addition to the existing creation area, with labelled tools.
 const entry=document.createElement('details');entry.id='drawingTools';entry.className='inline-ui';entry.innerHTML='<summary>形状 / 画笔</summary><div>'+[['rect','方框'],['ellipse','圆圈'],['arrow','箭头'],['line','线条'],['freehand','画笔'],['text','文字']].map(([kind,label])=>'<button data-draw-kind="'+kind+'">'+label+'</button>').join('')+'</div>';($('creationDock')||canvas).append(entry);
 const startDrawing=document.createElement('button');startDrawing.id='emptyDrawing';startDrawing.textContent='画图';startDrawing.onclick=()=>showTools();$('empty')?.querySelector('.empty-actions')?.append(startDrawing);
 let drawingTool=null,stroke=null,paintFrame=0,drawColour='',drawWeight=3;
 const preview=document.createElementNS('http://www.w3.org/2000/svg','svg');preview.classList.add('canvas-stroke-preview');preview.setAttribute('hidden','');canvas.append(preview);
 const mode=document.createElement('section');mode.id='canvasDrawMode';mode.className='inline-ui';mode.hidden=true;mode.setAttribute('aria-label','绘图工具');mode.innerHTML='<button type="button" data-canvas-tool="select">选择</button><div class="canvas-mode-tools" role="toolbar" aria-label="绘图">'+[['rect','方框'],['ellipse','圆圈'],['arrow','箭头'],['line','线条'],['freehand','画笔'],['text','文字']].map(([kind,name])=>'<button type="button" data-canvas-tool="'+kind+'" aria-pressed="false">'+name+'</button>').join('')+'</div><div class="canvas-mode-style"><input type="color" aria-label="绘图颜色" value="#364152"><select aria-label="绘图线宽"><option value="1">细</option><option value="3" selected>中</option><option value="6">粗</option></select><label><input type="checkbox" id="canvasDrawLock">连续画</label></div>';canvas.append(mode);
 mode.querySelector('input[type=color]').oninput=e=>drawColour=e.target.value;mode.querySelector('select').onchange=e=>drawWeight=Number(e.target.value);
 function cancelStroke(){const s=stroke;stroke=null;if(paintFrame){cancelAnimationFrame(paintFrame);paintFrame=0}preview.setAttribute('hidden','');preview.replaceChildren();if(s)try{if(canvas.hasPointerCapture(s.pointer))canvas.releasePointerCapture(s.pointer)}catch{}}
 function setTool(kind){cancelStroke();window.whiteboardNavigation?.useSelection?.();drawingTool=kind==='select'?null:kind;mode.hidden=!drawingTool;canvas.classList.toggle('drawing-mode',!!drawingTool);mode.querySelectorAll('[data-canvas-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.canvasTool===drawingTool)));if(!drawingTool)canvas.focus({preventScroll:true})}
 function chooseTool(kind){if(!ready())return;entry.open=false;if(kind==='select'){setTool(kind);return}cancelCanvasGesture();editorId=null;selected.clear();refreshSelectionUI();setTool(kind);if(!drawColour){const rgb=getComputedStyle(canvas).color.match(/\d+/g);if(rgb?.length>=3)mode.querySelector('input[type=color]').value='#'+rgb.slice(0,3).map(v=>Number(v).toString(16).padStart(2,'0')).join('')}}
 function showTools(){if(!ready())return;chooseTool('freehand')}
 mode.querySelectorAll('[data-canvas-tool]').forEach(b=>b.onclick=()=>chooseTool(b.dataset.canvasTool));entry.querySelectorAll('[data-draw-kind]').forEach(b=>b.onclick=()=>chooseTool(b.dataset.drawKind));
 function drawingGeometry(s){const points=s.points,first=points[0],last=points.at(-1),pad=s.weight/2+1;let xs,ys;if(s.kind==='freehand'){xs=points.map(p=>p.x);ys=points.map(p=>p.y)}else{xs=[first.x,last.x];ys=[first.y,last.y]}const left=Math.min(...xs),top=Math.min(...ys),x=left-pad,y=top-pad,w=Math.max(1,Math.max(...xs)-left)+pad*2,h=Math.max(1,Math.max(...ys)-top)+pad*2;return{x,y,w,h,canvasObject:{kind:s.kind,fill:'none',weight:s.weight,strokeMode:'uniform',...(s.colour?{stroke:s.colour}:{}),points:(s.kind==='freehand'?points:[first,last]).map(p=>[(p.x-x)/w*100,(p.y-y)/h*100])}}}
 const ownsStroke=s=>board===s.board&&boardId===s.boardId&&ready()&&['x','y','z'].every(key=>view()[key]===s.view[key]);
 function paintStroke(){paintFrame=0;const s=stroke;if(!s)return;if(!ownsStroke(s))return cancelStroke();const n=drawingGeometry(s),r=canvas.getBoundingClientRect(),v=view();preview.setAttribute('viewBox','0 0 '+r.width+' '+r.height);preview.removeAttribute('hidden');preview.innerHTML='<g transform="translate('+(v.x+n.x*v.z)+','+(v.y+n.y*v.z)+') scale('+v.z+')">'+marksSVG([n.canvasObject],{w:n.w,h:n.h})+'</g>'}
 function queueStroke(){if(!paintFrame)paintFrame=requestAnimationFrame(paintStroke)}
 canvas.addEventListener('pointerdown',e=>{if(!drawingTool||!ready()||e.button!==0||e.isPrimary===false||space||e.target.closest('.inline-ui,#canvasTools,#creationDock'))return;stop(e);cancelStroke();canvas.focus({preventScroll:true});if(drawingTool==='text'){const kind=drawingTool,p=point(e);setTool('select');add(kind,{x:p.x+120,y:p.y+80});return}stroke={board,boardId,pointer:e.pointerId,kind:drawingTool,points:[point(e)],view:clone(view()),weight:drawWeight,colour:drawColour};canvas.setPointerCapture(e.pointerId);queueStroke()},true);
 window.addEventListener('pointermove',e=>{const s=stroke;if(!s||e.pointerId!==s.pointer)return;stop(e);if(!ownsStroke(s))return cancelStroke();const events=s.kind==='freehand'&&e.getCoalescedEvents?e.getCoalescedEvents():[e];for(const event of events.length?events:[e]){let p=point(event);if(!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;if(s.kind!=='freehand'){if(e.shiftKey){const a=s.points[0],dx=p.x-a.x,dy=p.y-a.y;if(['rect','ellipse'].includes(s.kind)){const size=Math.max(Math.abs(dx),Math.abs(dy));p={x:a.x+Math.sign(dx||1)*size,y:a.y+Math.sign(dy||1)*size}}else{const distance=Math.hypot(dx,dy),angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4;p={x:a.x+Math.cos(angle)*distance,y:a.y+Math.sin(angle)*distance}}}s.points[1]=p}else if(s.points.length<5000){const last=s.points.at(-1);if(Math.hypot(p.x-last.x,p.y-last.y)*s.view.z>=.5)s.points.push(p)}}queueStroke()},true);
 function endStroke(e,cancelled=false){const s=stroke;if(!s||e.pointerId!==s.pointer)return;stop(e);const valid=!cancelled&&ownsStroke(s)&&s.points.length>1&&(s.kind==='freehand'||Math.hypot(s.points[1].x-s.points[0].x,s.points[1].y-s.points[0].y)*s.view.z>=4),n=valid?drawingGeometry(s):null;cancelStroke();if(n){add(s.kind,center(),n);if(s.kind!=='freehand'&&!mode.querySelector('#canvasDrawLock').checked)setTool('select')}}
 window.addEventListener('pointerup',e=>endStroke(e),true);window.addEventListener('pointercancel',e=>endStroke(e,true),true);window.addEventListener('lostpointercapture',e=>{if(stroke&&e.pointerId===stroke.pointer)cancelStroke()},true);
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawingTool){stop(e);setTool('select');return}if(isTyping(e)||isKeyboardControl(e)||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||!ready())return;if(e.key.toLowerCase()==='h'&&drawingTool){setTool('select');return}const kind={v:'select',r:'rect',o:'ellipse',a:'arrow',l:'line',p:'freehand'}[e.key.toLowerCase()];if(kind){stop(e);chooseTool(kind)}},true);
 const cancelObjects=cancelCanvasGesture;cancelCanvasGesture=function(...args){cancelStroke();return cancelObjects(...args)};
 document.addEventListener('creative-canvas-gesture-cancel',()=>{finishResize(false);cancelStroke()});window.addEventListener('blur',cancelStroke);
 window.addEventListener('creative-board-loading',()=>{finishResize(false);setTool('select')});
 for(const field of ['canvasObject','contentScale'])if(!wfContentFields.includes(field))wfContentFields.push(field);
 Object.assign(wfLabels,{canvasObject:'图形与图片编辑',contentScale:'整体大小'});
 const menuItems=(event,items)=>{const n=board?.nodes.find(n=>n.id===event.target.closest?.('.node[data-id]')?.dataset.id),o=object(n);if(!o)return items;return [[o.kind==='image'?'裁剪与标注':'图形与文字',()=>editObject(n.id)],...(o.kind==='image'?[['查看原图',()=>openImageView(source(n),n.title||'图片')]]:[]),...items.filter(([label])=>!['编辑','展开编辑','便签颜色与纸面','按内容调整大小','自动适应内容','固定当前尺寸','查看原图 / 放大','打开查看  Enter'].includes(label))]};
 const reading=whiteboardReading.open;whiteboardReading.open=function(id){const n=board?.nodes.find(n=>n.id===id);return object(n)?editObject(id):reading(id)};
 window.whiteboardCanvasObjects={add,edit:editObject,isObject:n=>!!object(n),scaleOf,marksSVG,showTools,menuItems,captureDraft,restoreDraft,focusDraft};
 if(board)mount();
})();
