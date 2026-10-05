// Familiar canvas navigation, with workspace preferences separate from content.
(() => {
 'use strict';
 const key='creative-navigation-v1',defaults={snap:true,zoomSpeed:1,nudge:1,bigNudge:10,gap:32};let hand=false;
 function read(){let p={};try{p=JSON.parse(localStorage.getItem(key)||'{}')}catch{}return{snap:p.snap!==false,zoomSpeed:Math.max(.3,Math.min(2,Number(p.zoomSpeed)||1)),nudge:Math.max(.1,Math.min(100,Number(p.nudge)||1)),bigNudge:Math.max(1,Math.min(500,Number(p.bigNudge)||10)),gap:Math.max(0,Math.min(500,Number.isFinite(Number(p.gap))?Number(p.gap):32))}}
 function write(p){localStorage.setItem(key,JSON.stringify({...defaults,...p}))}
 function effectiveSelection(){const ids=new Set(selected);for(const f of board.nodes.filter(n=>selected.has(n.id)&&n.type==='frame'))for(const n of board.nodes)if(groupOf(n)?.id===f.id)ids.add(n.id);return board.nodes.filter(n=>ids.has(n.id))}
 function fitSelection(){const ns=effectiveSelection();if(!ns.length)return;const x=Math.min(...ns.map(n=>n.x)),y=Math.min(...ns.map(n=>n.y)),w=Math.max(...ns.map(n=>n.x+n.w))-x,h=Math.max(...ns.map(n=>n.y+n.h))-y,r=canvas.getBoundingClientRect(),z=Math.max(.15,Math.min(4,(r.width-100)/w,(r.height-100)/h));board.view={x:(r.width-w*z)/2-x*z,y:(r.height-h*z)/2-y*z,z};moveView();change(true)}
 function arrange(axis,mode,gap=read().gap){
  if(blocked)return toast('请先处理保存冲突');const ns=board.nodes.filter(n=>selected.has(n.id));if(ns.length<2)return;undoPoint();const size=axis==='x'?'w':'h';
  // Keep each group's original contents throughout this one arrangement.
  // An intermediate overlap must not make a later group lose its contents.
  const members=new Map(ns.filter(n=>n.type==='frame').map(n=>[n.id,board.nodes.filter(item=>!selected.has(item.id)&&groupOf(item)?.id===n.id)]));
  if(mode==='spacing'){ns.sort((a,b)=>a[axis]-b[axis]);let position=ns[0][axis];for(const n of ns){const delta=position-n[axis];moveGroup(n,axis,delta,members.get(n.id)||[]);position+=n[size]+gap}}
  else{const low=Math.min(...ns.map(n=>n[axis])),high=Math.max(...ns.map(n=>n[axis]+n[size]));for(const n of ns){const value=mode==='start'?low:mode==='end'?high-n[size]:(low+high-n[size])/2;moveGroup(n,axis,value-n[axis],members.get(n.id)||[])}}
  drawNodes();renderOutline();change();
 }
 function moveGroup(n,axis,delta,children){n[axis]+=delta;for(const item of children)item[axis]+=delta}
 function arrangement(){
  showDialog('<h2>对齐与间距</h2><div class="arrange-options"><div><span>水平</span><button data-align="x,start">左边对齐</button><button data-align="x,center">居中对齐</button><button data-align="x,end">右边对齐</button></div><div><span>垂直</span><button data-align="y,start">顶部对齐</button><button data-align="y,center">居中对齐</button><button data-align="y,end">底部对齐</button></div><label>内容之间的间距<input id="arrangeGap" type="number" min="0" max="500" value="'+read().gap+'"></label><div><button data-align="x,spacing">排成一行</button><button data-align="y,spacing">排成一列</button></div></div>',[['返回白板',()=>$('dialog').close()]]);
  $('dialogBody').querySelectorAll('[data-align]').forEach(b=>b.onclick=()=>{const [axis,mode]=b.dataset.align.split(','),gap=Math.max(0,Math.min(500,Number($('arrangeGap').value)||0));write({...read(),gap});arrange(axis,mode,gap)});
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
 window.addEventListener('keydown',e=>{if(e.code==='Space'&&!isTyping(e)&&!document.querySelector('dialog[open]'))canvas.classList.add('space-panning')},true);
 window.addEventListener('keyup',e=>{if(e.code==='Space')canvas.classList.remove('space-panning')},true);
 window.addEventListener('blur',()=>canvas.classList.remove('space-panning'));
 document.addEventListener('keydown',e=>{
  if(!board||isTyping(e)||$('dialog').open||document.querySelector('dialog[open]')||e.target.closest('#workspaceSidebar,header,#fileContext,#mediaPopover'))return;
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.shiftKey&&e.code==='Digit2'){e.preventDefault();e.stopImmediatePropagation();cancelCanvasGesture();fitSelection();return}
  if(['h','v'].includes(e.key.toLowerCase())){e.preventDefault();e.stopImmediatePropagation();cancelCanvasGesture();hand=e.key.toLowerCase()==='h';canvas.classList.toggle('hand-tool',hand);return}
  if(e.key.startsWith('Arrow')&&selected.size){e.preventDefault();e.stopImmediatePropagation();if(blocked)return;cancelCanvasGesture();const ns=effectiveSelection(),step=e.shiftKey?read().bigNudge:read().nudge,delta={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];if(!delta)return;if(!e.repeat)undoPoint();for(const n of ns){n.x+=delta[0];n.y+=delta[1]}drawNodes();renderOutline();change()}
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
 $('zoomValue').title='缩放与视图';$('zoomValue').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();fileMenu({target:e.currentTarget,clientX:r.left,clientY:r.bottom,preventDefault:()=>e.preventDefault(),stopPropagation:()=>e.stopPropagation()},[['缩放到选中内容  Shift+2',fitSelection],['查看全部  Shift+1',fit],['100%',()=>zoom(1/view().z)],['设置缩放比例…',()=>{showDialog('<h2>白板缩放</h2><label>比例（%）<input id="boardZoomInput" type="number" min="15" max="3200" value="'+Math.round(view().z*100)+'"></label>',[['取消',()=>$('dialog').close()],['应用',()=>{const z=Number($('boardZoomInput').value);if(z>=15&&z<=3200){zoom(z/100/view().z);$('dialog').close()}}]])}],['操作设置…',()=>whiteboardAppearance.open()]])};
 const settings=whiteboardAppearance.open;whiteboardAppearance.open=function(){settings();const d=$('appearanceDialog'),section=document.createElement('section');section.className='navigation-settings';section.innerHTML='<h3>白板操作</h3><label class="navigation-check"><input id="navSnap" type="checkbox">拖动时显示对齐参考线并吸附</label><label>缩放速度<input id="navZoom" type="range" min="30" max="200" step="10"><output></output></label><div><label>方向键移动<input id="navNudge" type="number" min="0.1" max="100" step="0.1"></label><label>Shift＋方向键<input id="navBigNudge" type="number" min="1" max="500"></label></div><p>右键或空格＋拖动移动画布；Ctrl＋滚轮缩放；H 切到手形工具，V 切回选择。Shift＋拖动限制方向，Alt＋拖动创建副本。拖动时按 Ctrl 可临时关闭吸附。</p>';d.querySelector('footer').before(section);const p=read();section.querySelector('#navSnap').checked=p.snap;section.querySelector('#navZoom').value=p.zoomSpeed*100;section.querySelector('#navZoom').nextElementSibling.textContent=p.zoomSpeed+'×';section.querySelector('#navNudge').value=p.nudge;section.querySelector('#navBigNudge').value=p.bigNudge;section.addEventListener('input',()=>{const value={...read(),snap:section.querySelector('#navSnap').checked,zoomSpeed:Number(section.querySelector('#navZoom').value)/100,nudge:Number(section.querySelector('#navNudge').value)||1,bigNudge:Number(section.querySelector('#navBigNudge').value)||10};write(value);section.querySelector('#navZoom').nextElementSibling.textContent=value.zoomSpeed+'×'});const reset=d.querySelector('#appearanceReset').onclick;d.querySelector('#appearanceReset').onclick=()=>{reset();write(defaults);section.querySelector('#navSnap').checked=true;section.querySelector('#navZoom').value=100;section.querySelector('#navZoom').nextElementSibling.textContent='1×';section.querySelector('#navNudge').value=1;section.querySelector('#navBigNudge').value=10}};
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
 window.whiteboardNavigation={read,write,fitSelection,arrange};
})();
