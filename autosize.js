// New notes grow with their content. Existing/manual cards keep their dimensions.
(() => {
 'use strict';
 let scheduled=0;
 const automatic=n=>n?.type==='note'&&n.sizeMode==='auto';
 function measure(n,el){
  const area=el?.querySelector('.edit-scroll');if(!area||el.closest('#immersiveSurface'))return null;
  const style=getComputedStyle(area),width=area.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
  let height=parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)+2;
  for(const child of area.children){
   const s=getComputedStyle(child);if(s.display==='none'||child.matches('#inlineMeta,.inline-toolbar'))continue;
   if(child.matches('textarea,input')&&!child.value.trim())continue;
   let h=child.offsetHeight;
   if(child.matches('.single-image')){const image=child.querySelector('img');if(image?.naturalWidth)h=width*image.naturalHeight/image.naturalWidth;else h=160}
   if(child.matches('video'))h=child.videoWidth?width*child.videoHeight/child.videoWidth:190;
   if(child.matches('.inline-document'))h=400;
   height+=h+parseFloat(s.marginTop||0)+parseFloat(s.marginBottom||0);
  }
  return Math.ceil(Math.max(120,Math.min(1200,height)));
 }
 function update(){
  scheduled=0;if(!board||gesture?.type==='resize'||loading)return;
  const elements=new Map([...$('nodes').children].map(el=>[el.dataset.id,el])),updates=[];
  for(const n of board.nodes){if(!automatic(n))continue;const el=elements.get(n.id),height=measure(n,el);if(height!=null&&Math.abs(n.h-height)>=2)updates.push({n,el,height})}
  for(const {n,el,height} of updates){n.h=height;el.style.height=height+'px'}
  if(updates.length){drawEdges();change()}
 }
 function schedule(){if(!scheduled)scheduled=requestAnimationFrame(update)}
 const oldAdd=addNote;addNote=function(p=center(),data={}){oldAdd(p,{sizeMode:data.type&&data.type!=='note'?'manual':'auto',...data});schedule()};
 const oldDraw=drawNodes;drawNodes=function(){oldDraw();schedule()};
 const oldSelect=refreshSelectionUI;refreshSelectionUI=function(){oldSelect();schedule()};
 const oldFit=fitContentLayouts;fitContentLayouts=function(){oldFit();schedule()};
 // Set the mode after the existing resize code creates its undo checkpoint.
 const oldMove=canvas.onpointermove;canvas.onpointermove=function(e){const g=gesture;oldMove(e);if(g?.type==='resize'&&g.changed){const n=board.nodes.find(n=>n.id===g.id);if(n)n.sizeMode='manual'}};
 function setMode(id,mode){const n=board.nodes.find(n=>n.id===id);if(!n||n.type!=='note')return;undoPoint();n.sizeMode=mode;change();if(mode==='auto')schedule()}
 const oldMenu=fileMenu;fileMenu=function(e,items){const id=e.target.closest?.('.node[data-id]')?.dataset.id,n=board?.nodes.find(n=>n.id===id);if(n?.type==='note')items=[...items.filter(([label])=>label!=='按内容调整大小'),[automatic(n)?'固定当前尺寸':'自动适应内容',()=>setMode(id,automatic(n)?'manual':'auto')]];return oldMenu(e,items)};
 document.addEventListener('input',e=>{if(e.target.closest('.node'))schedule()});
 document.addEventListener('load',e=>{if(e.target.matches?.('.node img'))schedule()},true);
 document.addEventListener('loadedmetadata',e=>{if(e.target.matches?.('.node video'))schedule()},true);
 $('dialog').addEventListener('close',schedule);
 window.whiteboardSizing={automatic,measure,schedule,setMode};if(board)schedule();
})();
