(()=>{
 let enabled=false,drag=null;
 const send=(phase,e)=>parent.postMessage({type:'creative-document-pan',phase,x:e?.screenX??0,y:e?.screenY??0,finalPosition:e?.type==='pointerup'},'*');
 function finish(e){if(!drag)return;const id=drag.id;drag=null;try{document.documentElement.releasePointerCapture(id)}catch{}send('end',e)}
 addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='creative-document-pan-enabled'){enabled=!!e.data.enabled;if(!enabled)finish()}});
 const activate=()=>{if(enabled)parent.postMessage({type:'creative-document-active'},'*')};
 addEventListener('pointerdown',activate,true);addEventListener('focusin',activate,true);
 // Only navigation leaves an embedded document; typing remains in the page.
 addEventListener('keydown',e=>{
  if(!enabled||e.isComposing||e.key==='Process')return;
  const mod=e.ctrlKey||e.metaKey,typing=e.target.matches?.('input,textarea,select')||e.target.isContentEditable;let action;
  if(mod&&!e.altKey){if(['+','=','Add'].includes(e.key))action='zoom-in';else if(['-','Subtract'].includes(e.key))action='zoom-out';else if(e.key==='0')action='zoom-reset';else if(e.key==='Tab')action=e.shiftKey?'previous-tab':'next-tab'}
  else if(!mod&&!e.altKey&&!typing){if(e.code==='Space')action='temporary-hand';else if(e.key.toLowerCase()==='h')action='hand';else if(e.key.toLowerCase()==='v')action='select';else if(e.shiftKey&&e.code==='Digit1')action='fit-all';else if(e.shiftKey&&e.code==='Digit2')action='fit-selection'}
  if(!action)return;e.preventDefault();e.stopImmediatePropagation();parent.postMessage({type:'creative-document-navigation',action},'*');
 },true);
 addEventListener('pointerdown',e=>{if(!enabled||![1,2].includes(e.button))return;e.preventDefault();e.stopImmediatePropagation();drag={id:e.pointerId,button:e.button};try{document.documentElement.setPointerCapture(e.pointerId)}catch{}send('start',e)},true);
 addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();if(!(e.buttons&(drag.button===2?2:4))){finish(e);return}send('move',e)},true);
 for(const event of ['pointerup','pointercancel','lostpointercapture'])addEventListener(event,e=>{if(drag&&drag.id===e.pointerId){e.preventDefault();e.stopImmediatePropagation();finish(e)}},true);
 addEventListener('blur',()=>finish());addEventListener('beforeunload',()=>finish());
 addEventListener('contextmenu',e=>{if(enabled){e.preventDefault();e.stopImmediatePropagation()}},true);
 addEventListener('auxclick',e=>{if(enabled&&[1,2].includes(e.button)){e.preventDefault();e.stopImmediatePropagation()}},true);
})();// Restore reading position, never autoplay or replay user actions.
(()=>{let restored=false,timer=null;function snapshot(){if(!restored)return;const elements=[...document.querySelectorAll('*')].filter(e=>e.scrollTop||e.scrollLeft).slice(0,30).map(e=>({id:e.id,index:[...document.querySelectorAll('*')].indexOf(e),x:e.scrollLeft,y:e.scrollTop}));parent.postMessage({type:'creative-reading-position',state:{path:location.pathname+location.search+location.hash,x:scrollX,y:scrollY,elements}},'*')}
addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='creative-reading-restore'||restored)return;const saved=e.data.state||{};const apply=()=>{if(saved.path&&(location.pathname+location.search+location.hash)!==saved.path){restored=true;snapshot();return}scrollTo(saved.x||0,saved.y||0);for(const item of saved.elements||[]){const el=item.id?document.getElementById(item.id):document.querySelectorAll('*')[item.index];if(el){el.scrollLeft=item.x||0;el.scrollTop=item.y||0}}};const finishRestore=()=>{apply();setTimeout(()=>{apply();restored=true;snapshot()},30)};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',finishRestore,{once:true});else finishRestore()});addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(snapshot,120)},true);addEventListener('pagehide',snapshot);addEventListener('beforeunload',snapshot);document.addEventListener('visibilitychange',()=>{if(document.hidden)snapshot()});parent.postMessage({type:'creative-reading-ready'},'*');})();

(()=>{let last=0;addEventListener('pointermove',e=>{if(performance.now()-last<40)return;last=performance.now();parent.postMessage({type:'creative-pointer-position',x:e.clientX,y:e.clientY,width:innerWidth,height:innerHeight},'*')},{passive:true})})();
