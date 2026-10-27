/* Optional spatial context in the existing reusable-group preview. */
(()=>{
 let serial=0;
 const originalPreview=previewAsset;
 function layoutFor(asset){
  const bundle=asset?.bundle;
  if(asset?.mime!==bundleMime||!Array.isArray(bundle?.nodes)||!Array.isArray(bundle.edges)||bundle.nodes.length<2||bundle.nodes.length>60||bundle.edges.length>240)return null;
  const ids=new Set(),nodes=[];
  for(const node of bundle.nodes){
   if(!node||typeof node.id!=='string'||!node.id||ids.has(node.id)||!['note','table'].includes(node.type)||node.canvasObject)return null;
   if(!['x','y','w','h'].every(key=>typeof node[key]==='number'&&Number.isFinite(node[key])&&Math.abs(node[key])<=1e7)||node.w<=0||node.h<=0)return null;
   ids.add(node.id);nodes.push({id:node.id,title:node.title||'未命名',x:node.x,y:node.y,w:node.w,h:node.h,color:node.color});
  }
  if(bundle.edges.some(edge=>!edge||!ids.has(edge.from)||!ids.has(edge.to)||edge.from===edge.to))return null;
  const x=Math.min(...nodes.map(node=>node.x)),y=Math.min(...nodes.map(node=>node.y));
  const w=Math.max(...nodes.map(node=>node.x+node.w))-x,h=Math.max(...nodes.map(node=>node.y+node.h))-y;
  return {nodes,edges:bundle.edges.map(edge=>({from:edge.from,to:edge.to})),x,y,w,h};
 }
 function mount(asset,preview){
  const layout=layoutFor(asset);if(!layout)return;
  const dialog=$('dialog'),details=document.createElement('details'),summary=document.createElement('summary'),map=document.createElement('div'),description=document.createElement('p');
  details.className='library-spatial';summary.textContent='看原组合布局';map.className='library-spatial-map';map.setAttribute('aria-label','原组合布局中的内容');
  map.style.aspectRatio=layout.w+' / '+layout.h;
  // A very tall composition stays scrollable inside the original reading area.
  map.style.maxWidth=Math.min(375,220*layout.w/layout.h)+'px';
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',[layout.x,layout.y,layout.w,layout.h].join(' '));svg.setAttribute('aria-hidden','true');
  const byId=new Map(layout.nodes.map(node=>[node.id,node]));
  for(const edge of layout.edges){
   const a=byId.get(edge.from),b=byId.get(edge.to),line=document.createElementNS(ns,'line');
   for(const [key,value] of Object.entries({x1:a.x+a.w/2,y1:a.y+a.h/2,x2:b.x+b.w/2,y2:b.y+b.h/2}))line.setAttribute(key,String(value));
   svg.append(line);
  }
  map.append(svg);
  const buttons=[];
  layout.nodes.forEach((node,index)=>{
   const button=document.createElement('button');button.type='button';button.dataset.libraryLayoutPiece=node.id;
   button.textContent=(index+1)+'. '+node.title;button.setAttribute('aria-label','选择第'+(index+1)+'块：'+node.title);button.title=button.textContent;
   Object.assign(button.style,{left:100*(node.x-layout.x)/layout.w+'%',top:100*(node.y-layout.y)/layout.h+'%',width:100*node.w/layout.w+'%',height:100*node.h/layout.h+'%'});
   const hex=typeof node.color==='string'&&/^#[0-9a-f]{6}$/i.test(node.color)?node.color:null;
   if(hex){button.style.background=hex;const [r,g,b]=[1,3,5].map(at=>parseInt(hex.slice(at,at+2),16));button.style.color=(.299*r+.587*g+.114*b)>145?'#202020':'#f8f8f8'}
   const cx=node.x+node.w/2,cy=node.y+node.h/2;
   const covered=layout.nodes.slice(index+1).some(other=>cx>other.x&&cx<other.x+other.w&&cy>other.y&&cy<other.y+other.h);
   button.onclick=()=>{if(!valid()||!details.open||!map.getClientRects().length)return;const input=inputs().get(node.id);if(input&&!button.disabled){input.click();sync()}};
   buttons.push({button,node,covered});map.append(button);
  });
  details.append(summary,map,description);
  let alive=true,observer,resize;
  const valid=()=>alive&&dialog.open&&preview.isConnected&&$('pieceList')===preview;
  const inputs=()=>new Map([...preview.querySelectorAll('input[data-piece]')].map(input=>[input.dataset.piece,input]));
  function sync(){
   if(!valid())return;
   if(details.parentElement!==preview){observer.disconnect();preview.prepend(details);observer.observe(preview,{childList:true})}
   const current=inputs(),width=map.clientWidth,height=map.clientHeight;let needsList=false;
   for(const {button,node,covered} of buttons){
    const input=current.get(node.id),small=details.open&&(width*node.w/layout.w<32||height*node.h/layout.h<28);
    button.disabled=!input||covered||small;button.setAttribute('aria-pressed',String(!!input?.checked));
    if(input&&(covered||small))needsList=true;
   }
   description.textContent=layout.nodes.length+' 块 · '+layout.edges.length+' 条连线。布局示意，点块对应下方勾选。'+(needsList?'较小或重叠的块请在下方选择。':'');
  }
  observer=new MutationObserver(sync);observer.observe(preview,{childList:true});
  resize=new ResizeObserver(sync);resize.observe(map);preview.addEventListener('change',sync);details.addEventListener('toggle',sync);
  onDialogDismiss(()=>{alive=false;observer.disconnect();resize.disconnect();preview.removeEventListener('change',sync);details.removeEventListener('toggle',sync);details.remove()});
  sync();
 }
 previewAsset=async function(id){
  const request=++serial;await originalPreview.call(this,id);
  if(request!==serial||!$('dialog').open)return;
  const preview=$('pieceList'),asset=assetById(id);
  if(preview?.querySelector('input[data-piece]')&&!preview.querySelector('.library-spatial'))mount(asset,preview);
 };
})();
