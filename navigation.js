// Familiar canvas navigation, with workspace preferences separate from content.
(() => {
 'use strict';
 const key='creative-navigation-v1',defaults={snap:true,zoomSpeed:1,nudge:1,bigNudge:10,gap:32};let hand=false;
 function read(){let p={};try{p=JSON.parse(localStorage.getItem(key)||'{}')}catch{}return{snap:p.snap!==false,zoomSpeed:Math.max(.3,Math.min(2,Number(p.zoomSpeed)||1)),nudge:Math.max(.1,Math.min(100,Number(p.nudge)||1)),bigNudge:Math.max(1,Math.min(500,Number(p.bigNudge)||10)),gap:Math.max(0,Math.min(500,Number.isFinite(Number(p.gap))?Number(p.gap):32))}}
 function write(p){localStorage.setItem(key,JSON.stringify({...defaults,...p}))}
 // Native Tab navigation can scroll the hidden canvas container. Keep that
 // visible movement in the board view so pointer coordinates and reopening agree.
 let preservingFocusView=false;
 function focusPreservingView(field){preservingFocusView=true;try{field?.focus({preventScroll:true})}finally{preservingFocusView=false}}
 canvas.addEventListener('focusin',e=>{
  if(preservingFocusView)return;
  const node=e.target.closest?.('#nodes > .node');if(!board||loading||!node)return;
  const dx=canvas.scrollLeft,dy=canvas.scrollTop;let moved=!!(dx||dy);
  if(moved){board.view={...view(),x:view().x-dx,y:view().y-dy};canvas.scrollLeft=canvas.scrollTop=0;moveView()}
  // Browsers cannot scroll to negative world coordinates. Reveal a hidden
  // focus target there without changing the selected content or its geometry.
  if(writingField(e.target)&&window.whiteboardCaret){revealCaret(e.target);if(moved)change(true);return}
  const c=canvas.getBoundingClientRect(),r=e.target.getBoundingClientRect();
  const hiddenX=r.width<=c.width?r.left<c.left||r.right>c.right:r.right<=c.left||r.left>=c.right;
  const hiddenY=r.height<=c.height?r.top<c.top||r.bottom>c.bottom:r.bottom<=c.top||r.top>=c.bottom;
  if(hiddenX||hiddenY){
   const n=node.getBoundingClientRect(),box={left:Math.min(n.left,r.left),right:Math.max(n.right,r.right),top:Math.min(n.top,r.top),bottom:Math.max(n.bottom,r.bottom)};
   const fit=box.right-box.left<=c.width-32&&box.bottom-box.top<=c.height-32,area=fit?box:r;
   const x=area.left<c.left?c.left+16-area.left:area.right>c.right?c.right-16-area.right:0;
   const y=area.top<c.top?c.top+16-area.top:area.bottom>c.bottom?c.bottom-16-area.bottom:0;
   if(x||y){board.view={...view(),x:view().x+x,y:view().y+y};moveView();moved=true}
  }
  if(moved)change(true);
 });
 function writingField(field){return !!(field?.isConnected&&field.matches('textarea,input[type=text],input:not([type])')&&!field.readOnly&&!field.disabled&&!field.closest('[hidden]')&&field.closest('#nodes>.node .live-layout')&&field.getClientRects().length)}
 // Author fields follow their insertion point, not an offscreen textarea's full height.
 function revealCaret(field,scroll=true){
  if(!board||loading||gesture||$('dialog').open||document.activeElement!==field||!writingField(field)||!window.whiteboardCaret)return false;
  if(frameElement&&(frameElement.closest('[inert]')||frameElement.hidden||getComputedStyle(frameElement).visibility==='hidden'||!frameElement.getClientRects().length))return false;
  if(scroll)whiteboardCaret.follow(field,false);
  const c=canvas.getBoundingClientRect(),r=field.getBoundingClientRect(),area=field.closest('#inlineMeta,.edit-scroll,.table-scroll')||field,a=area.getBoundingClientRect(),margin=Math.min(16,c.width/8,c.height/8);
  if(c.width<1||c.height<1)return false;
  if(r.left>=c.left+margin&&r.right<=c.right-margin&&a.top>=c.top+margin&&a.bottom<=c.bottom-margin)return false;
  const caret=whiteboardCaret.box(field),inset=Math.max(0,Math.min(margin,(c.width-r.width)/2)),fits=r.width<=c.width,x=fits?(r.left<c.left+inset?c.left+inset-r.left:r.right>c.right-inset?c.right-inset-r.right:0):(caret.left<c.left+margin?c.left+margin-caret.left:caret.left>c.right-margin?c.right-margin-caret.left:0);
  let top=c.top+margin,bottom=c.bottom-margin;const tools=$('canvasTools'),dock=$('creationDock');if(tools?.getClientRects().length)top=Math.max(top,tools.getBoundingClientRect().bottom+8);if(dock?.getClientRects().length)bottom=Math.min(bottom,dock.getBoundingClientRect().top-8);if(bottom-top<caret.height+16){top=c.top+margin;bottom=c.bottom-margin}
  let y=caret.top<top?top-caret.top:caret.top+caret.height>bottom?bottom-caret.top-caret.height:0;
  if(y&&a.height<=bottom-top)y=a.top<top?top-a.top:a.bottom>bottom?bottom-a.bottom:y;
  if(!Number.isFinite(x)||!Number.isFinite(y)||!x&&!y)return false;
  board.view={...view(),x:view().x+x,y:view().y+y};moveView();change(true);return true;
 }
 function effectiveSelection(){const ids=new Set(selected);for(const f of board.nodes.filter(n=>selected.has(n.id)&&n.type==='frame'))for(const n of board.nodes)if(groupOf(n)?.id===f.id)ids.add(n.id);return board.nodes.filter(n=>ids.has(n.id))}
 function fitSelection(){const ns=effectiveSelection();if(!ns.length)return;const x=Math.min(...ns.map(n=>n.x)),y=Math.min(...ns.map(n=>n.y)),w=Math.max(...ns.map(n=>n.x+n.w))-x,h=Math.max(...ns.map(n=>n.y+n.h))-y,r=canvas.getBoundingClientRect(),z=Math.max(.15,Math.min(4,(r.width-100)/w,(r.height-100)/h));board.view={x:(r.width-w*z)/2-x*z,y:(r.height-h*z)/2-y*z,z};moveView();change(true)}
 function arrangementMoves(axis,mode,gap){
  if(!board||!['x','y'].includes(axis)||!['start','center','end','spacing'].includes(mode)||!Number.isFinite(gap)||gap<0||gap>500)return [];
  const ns=board.nodes.filter(n=>selected.has(n.id));if(ns.length<2)return [];const size=axis==='x'?'w':'h',moves=[];
  // Keep each group's original contents throughout this one arrangement.
  // An intermediate overlap must not make a later group lose its contents.
  const members=new Map(ns.filter(n=>n.type==='frame').map(n=>[n.id,[]]));
  if(members.size)for(const item of board.nodes){if(selected.has(item.id))continue;const owner=groupOf(item)?.id;if(members.has(owner))members.get(owner).push(item)}
  const place=(n,value)=>{moves.push({node:n,axis,value});for(const item of members.get(n.id)||[])moves.push({node:item,axis,value:item[axis]+value-n[axis]})};
  if(mode==='spacing'){ns.sort((a,b)=>a[axis]-b[axis]);let position=ns[0][axis];for(const n of ns){place(n,position);position+=n[size]+gap}}
  else{const low=Math.min(...ns.map(n=>n[axis])),high=Math.max(...ns.map(n=>n[axis]+n[size]));for(const n of ns)place(n,mode==='start'?low:mode==='end'?high-n[size]:(low+high-n[size])/2)}
  return moves;
 }
 function arrange(axis,mode,gap=read().gap){
  if(blocked)return toast('请先处理保存冲突');const moves=arrangementMoves(axis,mode,gap);if(!moves.some(m=>m.value!==m.node[m.axis]))return false;
  undoPoint();for(const m of moves)m.node[m.axis]=m.value;drawNodes();renderOutline();change();return true;
 }
 function arrangement(){
  const icons={
   'x,start':'<path d="M4 3v18"/><rect x="7" y="5" width="13" height="5"/><rect x="7" y="14" width="8" height="5"/>',
   'x,center':'<path d="M12 3v18"/><rect x="5" y="5" width="14" height="5"/><rect x="8" y="14" width="8" height="5"/>',
   'x,end':'<path d="M20 3v18"/><rect x="4" y="5" width="13" height="5"/><rect x="9" y="14" width="8" height="5"/>',
   'y,start':'<path d="M3 4h18"/><rect x="5" y="7" width="5" height="13"/><rect x="14" y="7" width="5" height="8"/>',
   'y,center':'<path d="M3 12h18"/><rect x="5" y="5" width="5" height="14"/><rect x="14" y="8" width="5" height="8"/>',
   'y,end':'<path d="M3 20h18"/><rect x="5" y="4" width="5" height="13"/><rect x="14" y="9" width="5" height="8"/>',
   'x,spacing':'<rect x="2" y="7" width="4" height="10"/><rect x="10" y="7" width="4" height="10"/><rect x="18" y="7" width="4" height="10"/>',
   'y,spacing':'<rect x="7" y="2" width="10" height="4"/><rect x="7" y="10" width="10" height="4"/><rect x="7" y="18" width="10" height="4"/>'
  },button=(key,name,caption)=>'<button data-align="'+key+'" aria-label="'+name+'" title="'+name+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">'+icons[key]+'</svg><span>'+caption+'</span></button>';
  const source=board,sourceId=boardId,nodes=board.nodes.filter(n=>selected.has(n.id)),ids=new Set(nodes.map(n=>n.id));if(nodes.length<2)return;
  showDialog('<h2>对齐与间距</h2><div class="arrange-options"><div class="arrange-axis"><span>水平</span>'+button('x,start','左边对齐','左对齐')+button('x,center','水平居中对齐','居中')+button('x,end','右边对齐','右对齐')+'</div><div class="arrange-axis"><span>垂直</span>'+button('y,start','顶部对齐','顶部')+button('y,center','垂直居中对齐','居中')+button('y,end','底部对齐','底部')+'</div><label for="arrangeGap">间距<input id="arrangeGap" type="number" min="0" max="500" step="any" value="'+read().gap+'"></label><div class="arrange-presets" aria-label="常用间距"><button type="button" data-gap="16">紧凑 · 16</button><button type="button" data-gap="32">常规 · 32</button><button type="button" data-gap="64">舒展 · 64</button></div><div class="arrange-spacing">'+button('x,spacing','横向等距排列','横向等距')+button('y,spacing','纵向等距排列','纵向等距')+'</div><figure class="arrange-preview"><svg viewBox="0 0 320 140" role="img" aria-label="选中内容的布局预览"></svg><figcaption id="arrangePreviewCaption">指向或按 Tab 预览，点击操作才应用。</figcaption></figure></div>',[['返回白板',()=>$('dialog').close()]]);
  const options=$('dialogBody').querySelector('.arrange-options'),field=options.querySelector('#arrangeGap'),svg=options.querySelector('.arrange-preview svg'),caption=options.querySelector('figcaption'),buttons=[...options.querySelectorAll('[data-align]')];let previewMode=null,previewIds=ids,invalid=false;
  const owns=()=>options.isConnected&&$('dialog').open&&$('dialogBody').querySelector('.arrange-options')===options;
  const active=()=>!invalid&&owns()&&board===source&&boardId===sourceId&&!loading&&!blocked&&nodes.every(n=>board.nodes.includes(n))&&selected.size===ids.size&&[...selected].every(id=>ids.has(id));
  const gap=()=>field.value.trim()!==''&&Number.isFinite(field.valueAsNumber)&&field.valueAsNumber>=0&&field.valueAsNumber<=500?field.valueAsNumber:null;
  function ready(){if(active())return true;if(owns()){invalid=true;svg.replaceChildren();caption.textContent='原白板或选择已改变，请处理保存状态后重新打开排列工具。';for(const el of options.querySelectorAll('button,input'))el.disabled=true}return false}
  function paint(mode=null){
   if(!ready())return;previewMode=mode;const value=gap();for(const b of options.querySelectorAll('[data-gap]'))b.setAttribute('aria-pressed',String(value===Number(b.dataset.gap)));
   for(const b of buttons){b.disabled=b.dataset.align.endsWith(',spacing')&&value===null;b.classList.toggle('previewing',b.dataset.align===mode)}
   const command=buttons.find(b=>b.dataset.align===mode),spacing=mode?.endsWith(',spacing'),moves=mode&&(!spacing||value!==null)?arrangementMoves(...mode.split(','),value??read().gap):[];
   const positions=new Map(nodes.map(n=>[n,{node:n,x:n.x,y:n.y}]));for(const m of moves){const item=positions.get(m.node)||{node:m.node,x:m.node.x,y:m.node.y};item[m.axis]=m.value;positions.set(m.node,item)}
   const all=[...positions.values()],left=Math.min(...all.map(p=>p.x)),top=Math.min(...all.map(p=>p.y)),width=Math.max(...all.map(p=>p.x+p.node.w))-left,height=Math.max(...all.map(p=>p.y+p.node.h))-top,boxWidth=Math.max(80,svg.clientWidth),boxHeight=Math.max(60,svg.clientHeight),scale=Math.min((boxWidth-24)/Math.max(1,width),(boxHeight-24)/Math.max(1,height)),ox=(boxWidth-width*scale)/2,oy=(boxHeight-height*scale)/2;
   svg.setAttribute('viewBox','0 0 '+boxWidth+' '+boxHeight);
   previewIds=new Set(all.map(p=>p.node.id));
   svg.replaceChildren();const element=(tag,attrs,text)=>{const el=document.createElementNS(svg.namespaceURI,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;return el};
   for(const p of all.slice(0,120)){const n=p.node,x=ox+(p.x-left)*scale,y=oy+(p.y-top)*scale,w=n.w*scale,h=n.h*scale,g=element('g',{'class':n.type==='frame'?'preview-frame':ids.has(n.id)?'preview-selected':'preview-member'});g.append(element('title',{},n.title||'未命名'),element('rect',{x,y,width:w,height:h,rx:n.type==='frame'?2:3}));if(w>=38&&h>=19){const label=Array.from(n.title||'未命名').slice(0,Math.min(18,Math.floor((w-8)/12))).join('');if(label)g.append(element('text',{x:x+5,y:y+Math.min(h/2+4,17)},label))}svg.append(g)}
   caption.textContent=(spacing&&value===null?'间距请填 0 到 500 之间的数值，当前内容保持原位。':command?command.getAttribute('aria-label')+' · 点击应用':'指向或按 Tab 预览，点击操作才应用。')+(all.length>120?' · 共 '+all.length+' 块，仅预览前 120 块':'');
  }
  field.oninput=()=>paint(previewMode||'x,spacing');
  for(const b of options.querySelectorAll('[data-gap]'))b.onclick=()=>{if(!ready())return;field.value=b.dataset.gap;paint(previewMode?.endsWith(',spacing')?previewMode:'x,spacing')};
  for(const b of buttons){b.onpointerenter=b.onfocus=()=>paint(b.dataset.align);b.onclick=()=>{if(!ready())return;const value=gap(),[axis,mode]=b.dataset.align.split(',');if(mode==='spacing'&&value===null)return paint(b.dataset.align);if(value!==null)write({...read(),gap:value});const changed=arrange(axis,mode,value??read().gap);paint();caption.textContent=(changed?'已应用：':'位置已是：')+b.getAttribute('aria-label')}}
  options.onpointerleave=()=>paint(buttons.includes(document.activeElement)?document.activeElement.dataset.align:null);
  const resized=()=>{const message=caption.textContent;paint(previewMode);if(active()&&!previewMode&&/^(已应用：|位置已是：)/.test(message))caption.textContent=message};
  const host=$('nodes'),observer=new MutationObserver(records=>{if(records.some(r=>r.target===host||r.target.parentElement===host&&previewIds.has(r.target.dataset.id)&&r.oldValue!==r.target.getAttribute('style')))resized()});
  observer.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:['style'],attributeOldValue:true});
  window.addEventListener('resize',resized);onDialogDismiss(()=>{window.removeEventListener('resize',resized);observer.disconnect()});
  paint();
 }
 const guide=document.createElementNS('http://www.w3.org/2000/svg','svg');guide.id='alignmentGuides';guide.setAttribute('aria-hidden','true');canvas.append(guide);
 function clearGuides(){guide.replaceChildren()}
 function paintGuides(lines){clearGuides();const v=view();for(const line of lines){const el=document.createElementNS(guide.namespaceURI,'line');for(const[k,val]of Object.entries(line.axis==='x'?{x1:line.value*v.z+v.x,x2:line.value*v.z+v.x,y1:line.start*v.z+v.y,y2:line.end*v.z+v.y}:{y1:line.value*v.z+v.y,y2:line.value*v.z+v.y,x1:line.start*v.z+v.x,x2:line.end*v.z+v.x}))el.setAttribute(k,val);guide.append(el)}}
 const down=canvas.onpointerdown;canvas.onpointerdown=function(e){down(e);if(gesture?.type==='move'&&e.altKey)gesture.duplicateOnDrag=true};
 const move=canvas.onpointermove;canvas.onpointermove=function(e){
  const g=gesture;if(!g||g.type!=='move')return move(e);let p=worldPoint(e.clientX,e.clientY),dx=p.x-g.start.x,dy=p.y-g.start.y;if(!g.changed&&Math.abs(dx)+Math.abs(dy)<3)return;
  if(g.duplicateOnDrag){g.duplicateOnDrag=false;checkpointGesture(g);const ids=new Map(g.points.map(o=>[o.id,uid()])),originals=board.nodes.filter(n=>ids.has(n.id));const copies=originals.map(n=>({...clone(n),id:ids.get(n.id)}));board.nodes.push(...copies);board.edges.push(...board.edges.filter(edge=>ids.has(edge.from)&&ids.has(edge.to)).map(edge=>({...clone(edge),id:uid(),from:ids.get(edge.from),to:ids.get(edge.to)})));selected=new Set(copies.map(n=>n.id));g.points=g.points.map(o=>({...o,id:ids.get(o.id)}))}
  if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0}
  if(!g.snapBounds){const lookup=new Map(board.nodes.map(n=>[n.id,n])),ids=new Set(g.points.map(o=>o.id)),ns=g.points.map(o=>({...o,w:lookup.get(o.id)?.w||0,h:lookup.get(o.id)?.h||0})),x=Math.min(...ns.map(n=>n.x)),y=Math.min(...ns.map(n=>n.y));g.snapBounds={x,y,w:Math.max(...ns.map(n=>n.x+n.w))-x,h:Math.max(...ns.map(n=>n.y+n.h))-y};g.snapTargets=board.nodes.filter(n=>!ids.has(n.id)&&n.type!=='frame').map(n=>({x:n.x,y:n.y,w:n.w,h:n.h}))}
  const bounds=g.snapBounds,lines=[];
  if(read().snap&&!e.ctrlKey&&!e.metaKey)for(const axis of ['x','y']){if(e.shiftKey&&(axis==='x'&&dx===0||axis==='y'&&dy===0))continue;const size=axis==='x'?'w':'h',cross=axis==='x'?'y':'x',crossSize=axis==='x'?'h':'w',offset=axis==='x'?dx:dy;let best=null;for(const target of g.snapTargets)for(const a of [0,.5,1])for(const b of [0,.5,1]){const value=target[axis]+target[size]*b,d=value-(bounds[axis]+offset+bounds[size]*a);if(Math.abs(d)<=6/view().z&&(!best||Math.abs(d)<Math.abs(best.d)))best={d,value,target}}if(best){if(axis==='x')dx+=best.d;else dy+=best.d;lines.push({axis,value:best.value,start:Math.min(bounds[cross]+(cross==='x'?dx:dy),best.target[cross])-12/view().z,end:Math.max(bounds[cross]+(cross==='x'?dx:dy)+bounds[crossSize],best.target[cross]+best.target[crossSize])+12/view().z})}}
  const r=canvas.getBoundingClientRect();move({clientX:r.left+view().x+(g.start.x+dx)*view().z,clientY:r.top+view().y+(g.start.y+dy)*view().z});paintGuides(lines);
 };
 const end=endGesture;endGesture=function(...args){clearGuides();return end(...args)};
 canvas.addEventListener('pointerdown',e=>{if(e.button!==0||(!space&&!hand)||!board||e.target.closest('#canvasTools,#creationDock,#textSizeTools')||$('dialog').open)return;e.stopImmediatePropagation();beginControlPan(e,{x:e.clientX,y:e.clientY})},true);
 canvas.addEventListener('dblclick',e=>{if(hand||space){e.preventDefault();e.stopImmediatePropagation()}},true);
 window.addEventListener('keydown',e=>{if(e.code==='Space'&&!isTyping(e)&&!isKeyboardControl(e)&&!document.querySelector('dialog[open]'))canvas.classList.add('space-panning')},true);
 window.addEventListener('keyup',e=>{if(e.code==='Space')canvas.classList.remove('space-panning')},true);
 window.addEventListener('blur',()=>canvas.classList.remove('space-panning'));
 let keyMove=null;
 window.addEventListener('keyup',e=>{if(e.key===keyMove?.key)keyMove=null},true);
 window.addEventListener('pointerdown',()=>keyMove=null,true);
 window.addEventListener('blur',()=>keyMove=null);
 function repeatedMoveSelection(e){
  // A held arrow is one movement. Crossing another group must not change
  // its original contents halfway through, or create a new undo per repeat.
  if(!e.repeat||keyMove?.board!==board||keyMove.key!==e.key||keyMove.selection.size!==selected.size||[...selected].some(id=>!keyMove.selection.has(id))){
   const ns=effectiveSelection();undoPoint();keyMove={board,key:e.key,selection:new Set(selected),ids:new Set(ns.map(n=>n.id))};return ns;
  }
  return board.nodes.filter(n=>keyMove.ids.has(n.id));
 }
 document.addEventListener('keydown',e=>{
  if(!board||isTyping(e)||isKeyboardControl(e)||$('dialog').open||document.querySelector('dialog[open]')||e.target.closest('#workspaceSidebar,header,#fileContext,#mediaPopover')){keyMove=null;return}
  if(e.ctrlKey||e.metaKey||e.altKey){keyMove=null;return}
  if(!e.key.startsWith('Arrow')&&e.key!=='Shift')keyMove=null;
  if(!selected.size)keyMove=null;
  if(e.shiftKey&&e.code==='Digit2'){e.preventDefault();e.stopImmediatePropagation();cancelCanvasGesture();fitSelection();return}
  if(['h','v'].includes(e.key.toLowerCase())){e.preventDefault();e.stopImmediatePropagation();cancelCanvasGesture();hand=e.key.toLowerCase()==='h';canvas.classList.toggle('hand-tool',hand);return}
  if(e.key.startsWith('Arrow')&&selected.size){e.preventDefault();e.stopImmediatePropagation();if(blocked){keyMove=null;return}cancelCanvasGesture();const step=e.shiftKey?read().bigNudge:read().nudge,delta={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];if(!delta)return;const ns=repeatedMoveSelection(e);for(const n of ns){n.x+=delta[0];n.y+=delta[1]}drawNodes();renderOutline();change()}
 },true);
 // Use the same key handlers after a protected HTML preview receives focus.
 const documentKeys=new Map([
  ['hand',{key:'h',code:'KeyH'}],['select',{key:'v',code:'KeyV'}],['temporary-hand',{key:' ',code:'Space'}],
  ['fit-all',{key:'!',code:'Digit1',shiftKey:true}],['fit-selection',{key:'@',code:'Digit2',shiftKey:true}],
  ['zoom-in',{key:'=',code:'Equal',ctrlKey:true}],['zoom-out',{key:'-',code:'Minus',ctrlKey:true}],['zoom-reset',{key:'0',code:'Digit0',ctrlKey:true}],
  ['next-tab',{key:'Tab',code:'Tab',ctrlKey:true}],['previous-tab',{key:'Tab',code:'Tab',ctrlKey:true,shiftKey:true}]
 ]);
 window.addEventListener('message',e=>{
  if(e.data?.type!=='creative-document-navigation'||!board||loading||$('dialog').open||document.querySelector('dialog[open]'))return;
  const keys=documentKeys.get(e.data.action);if(!keys)return;
  const frame=[...document.querySelectorAll('.inline-document iframe')].find(f=>f.contentWindow===e.source);
  if(!frame||document.activeElement!==frame||!frame._navigationCover?.hidden||!frame.getBoundingClientRect().width)return;
  document.dispatchEvent(new Event('creative-document-active'));finishDocumentPan();frame.blur();canvas.tabIndex=-1;canvas.focus({preventScroll:true});canvas.dispatchEvent(new KeyboardEvent('keydown',{...keys,bubbles:true,cancelable:true}));
 });
 const menu=fileMenu;fileMenu=function(e,items){if(selected.size>1&&e.target.closest?.('.node'))items=[...items,['对齐与间距…',arrangement]];return menu(e,items)};
 $('zoomValue').title='缩放与视图';$('zoomValue').setAttribute('aria-label','缩放与视图');$('zoomValue').setAttribute('aria-haspopup','menu');$('zoomValue').setAttribute('aria-controls','fileContext');$('zoomValue').setAttribute('aria-expanded','false');
 $('zoomValue').onclick=e=>{
  const r=e.currentTarget.getBoundingClientRect(),items=[];
  if(canvas.classList.contains('tight-tools'))items.push(['放大  Ctrl++',()=>$('plus').click()],['缩小  Ctrl+−',()=>$('minus').click()]);
  items.push(['缩放到选中内容  Shift+2',fitSelection],['查看全部  Shift+1',fit],['100%',()=>zoom(1/view().z)],['设置缩放比例…',()=>{showDialog('<h2>白板缩放</h2><label>比例（%）<input id="boardZoomInput" type="number" min="15" max="3200" value="'+Math.round(view().z*100)+'"></label>',[['取消',()=>$('dialog').close()],['应用',()=>{const z=Number($('boardZoomInput').value);if(z>=15&&z<=3200){zoom(z/100/view().z);$('dialog').close()}}]])}],['操作设置…',()=>whiteboardAppearance.open()]);
  fileMenu({target:e.currentTarget,clientX:r.left,clientY:r.bottom,preventDefault:()=>e.preventDefault(),stopPropagation:()=>e.stopPropagation()},items);
 };
 // Shared appearance settings own operation preferences in both the workspace and standalone pages.
 // Browsers may issue contextmenu on right-button down or up. Defer an early
 // menu until release, retaining its original target despite pointer capture.
 let rightClick=null,replayingContext=false;
 const clearRightClick=()=>{rightClick=null;contextDown=null};
 const cancelRightClick=()=>{if(rightClick&&!rightClick.ended){rightClick.cancelled=true;contextDown=null}else clearRightClick()};
 const cancelBeforeRightMenu=cancelCanvasGesture;
 cancelCanvasGesture=function(){cancelRightClick();return cancelBeforeRightMenu()};
 const endBeforeRightMenu=endGesture;
 endGesture=function(e,cancel=false){if(cancel&&gesture)cancelRightClick();return endBeforeRightMenu(e,cancel)};
 window.addEventListener('pointerdown',e=>{
  clearRightClick();
  if(e.button!==2||!board||$('dialog').open||!e.target.closest?.('#canvas')||e.target.closest('#canvasTools,#creationDock,#textSizeTools'))return;
  rightClick={id:e.pointerId,x:e.clientX,y:e.clientY,target:e.target,moved:false,ended:false,early:null};
 },true);
 window.addEventListener('pointermove',e=>{const state=rightClick;if(state&&!state.ended&&e.pointerId===state.id)state.moved||=Math.hypot(e.clientX-state.x,e.clientY-state.y)>5},true);
 window.addEventListener('contextmenu',e=>{
  const state=rightClick;if(replayingContext||!state||!e.target.closest?.('#canvas'))return;
  if(state.cancelled){e.preventDefault();e.stopImmediatePropagation();if(state.ended)clearRightClick();return}
  if(!state.ended){
   e.preventDefault();e.stopImmediatePropagation();
   state.early={bubbles:true,cancelable:true,button:2,buttons:0,clientX:e.clientX,clientY:e.clientY,ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,altKey:e.altKey,metaKey:e.metaKey};return;
  }
  if(state.moved||state.early){e.preventDefault();e.stopImmediatePropagation()}
  clearRightClick();
 },true);
 window.addEventListener('pointerup',e=>{
  const state=rightClick;if(!state||e.pointerId!==state.id||e.button!==2)return;
  state.moved||=Math.hypot(e.clientX-state.x,e.clientY-state.y)>5;state.ended=true;
  if(!state.early||state.moved||state.cancelled)return;
  queueMicrotask(()=>{
   if(rightClick!==state)return;
   const target=state.target.isConnected?state.target:document.elementFromPoint(state.x,state.y);
   if(!target?.closest?.('#canvas'))return;
   replayingContext=true;
   try{target.dispatchEvent(new MouseEvent('contextmenu',state.early))}finally{replayingContext=false;contextDown=null}
  });
 },true);
 window.addEventListener('pointercancel',cancelRightClick,true);
 window.addEventListener('keydown',e=>{if(e.key==='Escape')cancelRightClick();else if(!rightClick||rightClick.ended)clearRightClick()},true);
 window.addEventListener('blur',cancelRightClick);
 // Overview includes the relationships that explain the papers, not only their rectangles.
 const paperOnlyFit=fit;
 fit=function(){
  if(!board?.nodes.length||!board.edges.length)return paperOnlyFit();
  cancelCanvasGesture();drawEdges();
  let left=Math.min(...board.nodes.map(n=>n.x)),top=Math.min(...board.nodes.map(n=>n.y));
  let right=Math.max(...board.nodes.map(n=>n.x+n.w)),bottom=Math.max(...board.nodes.map(n=>n.y+n.h));
  const original={left,top,right,bottom};
  for(const connector of $('edgePaths').children){
   if(!connector.dataset.edge)continue;
   const r=connector.getBBox();if(![r.x,r.y,r.width,r.height].every(Number.isFinite))continue;
   left=Math.min(left,r.x);top=Math.min(top,r.y);right=Math.max(right,r.x+r.width);bottom=Math.max(bottom,r.y+r.height);
  }
  if(left===original.left&&top===original.top&&right===original.right&&bottom===original.bottom)return paperOnlyFit();
  const r=canvas.getBoundingClientRect(),w=right-left,h=bottom-top;
  const z=Math.max(.15,Math.min(1.1,(r.width-100)/w,(r.height-100)/h));
  board.view={x:(r.width-w*z)/2-left*z,y:(r.height-h*z)/2-top*z,z};moveView();change(true);
 };
 $('fit').onclick=fit;
 window.whiteboardNavigation={read,write,fitSelection,arrange,openArrangement:arrangement,revealCaret,focusPreservingView};
})();

// Two fingers navigate the canvas; a remaining finger never turns into a card drag.
(() => {
 'use strict';
 const contacts=new Map(),finished=new Set(),navigationClicks=new Set();let first=null,pinch=null,draining=false;
 const surface=target=>{
  if(!target?.closest?.('#canvas'))return false;
  if(target.closest('.read-layout [data-preview-id=title][readonly]'))return true;
  return !target.closest('input,textarea,select,button,a,[contenteditable=true],.inline-ui,audio,video,iframe,#canvasTools,#creationDock,#textSizeTools');
 };
 const ready=()=>board&&!loading&&!blocked&&!document.querySelector('dialog[open]');
 const owns=state=>state&&state.source===board&&state.id===boardId&&!loading;
 const point=event=>({x:event.clientX,y:event.clientY,surface:!!surface(event.target)});
 const stop=event=>{event.preventDefault();event.stopImmediatePropagation()};
 const forget=id=>{finished.delete(id);finished.add(id);while(finished.size>32)finished.delete(finished.values().next().value)};
 const changed=(a,b)=>['x','y','z'].some(key=>Math.abs(a[key]-b[key])>1e-7);
 function release(){for(const id of contacts.keys())if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id)}
 function clear(){for(const [id,p] of contacts)if(p.surface)forget(id);contacts.clear();first=pinch=null;draining=false;document.body.classList.remove('touch-navigation')}
 function cancel(){
  const state=pinch;if(owns(state)){const moved=changed(view(),state.view);board.view=clone(state.view);moveView();if(moved)change(true)}
  // Mark IDs before releasing capture, so late events cannot affect another gesture.
  for(const [id,p] of contacts)if(p.surface)forget(id);release();clear();
 }
 function begin(){
  if(!owns(first)||!ready())return false;
  const old=first,priorView=clone(old.view),priorSelection=new Set(old.selected);
  document.dispatchEvent(new Event('creative-canvas-gesture-cancel'));
  cancelBeforeTouch();
  // Ordinary drag cancellation may restore a cloned board. Adopt that same destination.
  if(boardId!==old.id||loading)return false;
  board.view=priorView;selected=priorSelection;refreshSelectionUI();moveView();first={...old,source:board};
  const pair=[...contacts.entries()].slice(0,2);draining=true;
  for(const [id,p] of contacts)if(p.surface)navigationClicks.add(id);while(navigationClicks.size>32)navigationClicks.delete(navigationClicks.values().next().value);
  if(pair.every(([,p])=>p.surface)){
   const [a,b]=pair.map(([,p])=>p),x=(a.x+b.x)/2,y=(a.y+b.y)/2;
   pinch={source:board,id:boardId,ids:pair.map(([id])=>id),view:clone(view()),distance:Math.max(4,Math.hypot(a.x-b.x,a.y-b.y)),anchor:worldPoint(x,y)};
   for(const id of pinch.ids)try{canvas.setPointerCapture(id)}catch{}
   document.body.classList.add('touch-navigation');
  }
  return true;
 }
 window.addEventListener('pointerdown',event=>{
  if(event.pointerType!=='touch')return;finished.delete(event.pointerId);navigationClicks.delete(event.pointerId);contacts.set(event.pointerId,point(event));
  if(contacts.size===1){first=surface(event.target)&&ready()?{source:board,id:boardId,view:clone(view()),selected:new Set(selected)}:null;return}
  if(!pinch&&!draining){if(!begin())draining=true}
  if(surface(event.target))navigationClicks.add(event.pointerId);while(navigationClicks.size>32)navigationClicks.delete(navigationClicks.values().next().value);
  if(pinch||surface(event.target))stop(event);
 },true);
 window.addEventListener('pointermove',event=>{
  if(event.pointerType!=='touch')return;
  if(finished.has(event.pointerId)){stop(event);return}
  const previous=contacts.get(event.pointerId);if(!previous)return;contacts.set(event.pointerId,{...previous,x:event.clientX,y:event.clientY});
  if(pinch){
   if(!owns(pinch)||!ready()){cancel();stop(event);return}
   const [a,b]=pinch.ids.map(id=>contacts.get(id));if(!a||!b){stop(event);return}
   const bounds=canvas.getBoundingClientRect(),z=Math.max(.15,Math.min(32,pinch.view.z*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance));
   board.view={...pinch.view,x:(a.x+b.x)/2-bounds.left-pinch.anchor.x*z,y:(a.y+b.y)/2-bounds.top-pinch.anchor.y*z,z};moveView();stop(event);
  }else if(draining&&previous.surface)stop(event);
 },true);
 function end(event){
  if(event.pointerType!=='touch')return;
  if(finished.has(event.pointerId)){stop(event);return}
  const p=contacts.get(event.pointerId);if(!p)return;
  const navigating=!!pinch||draining;
  if(pinch&&event.type==='pointercancel'){cancel();stop(event);return}
  if(pinch&&pinch.ids.includes(event.pointerId)){
   if(owns(pinch)&&changed(view(),pinch.view))change(true);pinch=null;draining=true;document.body.classList.remove('touch-navigation');
  }
  if(p.surface)forget(event.pointerId);contacts.delete(event.pointerId);
  if(!contacts.size){first=null;draining=false}
  if(navigating&&p.surface)stop(event);
 }
 for(const name of ['pointerup','pointercancel'])window.addEventListener(name,end,true);
 window.addEventListener('click',event=>{if(event.pointerType==='touch'&&navigationClicks.has(event.pointerId))stop(event)},true);
 window.addEventListener('lostpointercapture',event=>{if(event.pointerType==='touch'&&(pinch||draining||finished.has(event.pointerId)))stop(event)},true);
 const cancelBeforeTouch=cancelCanvasGesture;cancelCanvasGesture=function(){
  const navigating=!!pinch||draining;if(navigating){cancel();return true}
  const result=cancelBeforeTouch();if(contacts.size)clear();return result;
 };
 window.addEventListener('keydown',event=>{if(event.key==='Escape'&&(pinch||draining)){stop(event);cancel()}},true);
 window.addEventListener('blur',()=>{if(pinch||draining)cancel();else clear()});
 window.addEventListener('creative-board-loading',()=>{if(pinch||draining)cancel();else clear()});
})();
