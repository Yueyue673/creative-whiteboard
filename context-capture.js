// Optional visual context is created only when the user prepares an AI task.
(() => {
 'use strict';
 let renderer=null;
 function loadRenderer(){if(window.html2canvas)return Promise.resolve(window.html2canvas);if(!renderer)renderer=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/vendor/html2canvas.min.js';script.onload=()=>resolve(window.html2canvas);script.onerror=()=>{renderer=null;reject(Error('画面采集工具没有加载，请检查本地程序'))};document.head.append(script)});return renderer}
 function timeout(p,ms){return Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('图像加载超时')),ms))])}
 function thumbnail(source){return timeout(new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{try{const z=Math.min(1,1024/im.naturalWidth,1024/im.naturalHeight),c=document.createElement('canvas');c.width=Math.max(1,Math.round(im.naturalWidth*z));c.height=Math.max(1,Math.round(im.naturalHeight*z));c.getContext('2d').drawImage(im,0,0,c.width,c.height);resolve(c.toDataURL('image/png'))}catch(err){reject(err)}};im.onerror=()=>reject(Error('图片无法读取'));im.src=source}),5000)}
 function imageSources(pack){
  const all=[],seen=new Map();
  function add(source,nodeId,ownerId,path){if(!source)return;const position={nodeId,ownerId,path},existing=seen.get(source);if(existing){if(!existing.nodeIds.includes(nodeId))existing.nodeIds.push(nodeId);existing.locations.push(position);return}const item={source,nodeIds:[nodeId],ownerId,path,locations:[position]};seen.set(source,item);all.push(item)}
  function visit(value,nodeId,path='',parentId=nodeId){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach((v,i)=>visit(v,nodeId,path+'['+i+']',parentId));return}const ownerId=value.id||parentId;
   if(value.image)add(value.image,nodeId,ownerId,path+'.image');
   if(typeof value.data==='string'&&value.data.startsWith('data:image/'))add(value.data,nodeId,ownerId,path+'.data');
   const a=assetById(value.assetId||value.mediaId);if(a?.mime?.startsWith('image/'))add(mediaURL(a.id),nodeId,ownerId,path+'.assetId');
   for(const [key,v]of Object.entries(value))if(v&&typeof v==='object')visit(v,nodeId,path+'.'+key,ownerId);
  }
  for(const n of pack.data.nodes||[])visit(n,n.id);
  for(const a of pack.data.assets||[]){if(a.mime?.startsWith('image/'))add(mediaURL(a.id),a.id,a.id,'asset');if(a.bundle)visit(a.bundle,a.id,'bundle')}
  return all;
 }
 async function canvasSnapshot(pack,kind){
  const render=await loadRenderer(),ids=new Set(pack.data.nodes.map(n=>n.id)),edges=new Set(pack.data.edges.map(e=>e.id)),r=canvas.getBoundingClientRect(),ns=pack.data.nodes;
  const x=Math.min(...ns.map(n=>n.x)),y=Math.min(...ns.map(n=>n.y)),w=Math.max(...ns.map(n=>n.x+n.w))-x,h=Math.max(...ns.map(n=>n.y+n.h))-y,z=Math.min((r.width-48)/Math.max(1,w),(r.height-48)/Math.max(1,h),1.2);
  const image=await render(canvas,{logging:false,allowTaint:false,useCORS:false,scale:Math.min(1.5,1600/r.width,1000/r.height),backgroundColor:getComputedStyle(canvas).backgroundColor,width:r.width,height:r.height,
   onclone:doc=>{
    const area=doc.getElementById('canvas'),world=doc.getElementById('world');
    for(const node of doc.querySelectorAll('#nodes>.node'))if(!ids.has(node.dataset.id))node.remove();
    for(const edge of doc.querySelectorAll('#edgePaths>[data-edge]'))if(!edges.has(edge.dataset.edge))edge.remove();
    for(const ui of area.querySelectorAll('.block-actions,.port,.resize,#canvasTools,#creationDock,#textSizeTools,#selection,#hint,#alignmentGuides'))ui.remove();
    for(const node of area.querySelectorAll('.node'))node.classList.remove('active');
    // DOM renderers cannot paint native range controls reliably. Capture their actual state.
    for(const range of area.querySelectorAll('.media-seek')){const track=doc.createElement('div'),fill=doc.createElement('div'),thumb=doc.createElement('i'),played=100*(Number(range.value)-Number(range.min||0))/Math.max(.001,Number(range.max)-Number(range.min||0));track.style.cssText='height:3px;align-self:center;grid-column:1/-1;background:#7778;position:relative;margin:10px 0;width:100%';fill.style.cssText='height:100%;background:#c8c9cb;width:'+Math.max(0,Math.min(100,played))+'%';thumb.style.cssText='position:absolute;left:'+Math.max(0,Math.min(100,played))+'%;top:-3px;width:9px;height:9px;border-radius:50%;background:#c8c9cb;transform:translateX(-50%)';track.append(fill,thumb);range.replaceWith(track)}
    for(const frame of area.querySelectorAll('iframe')){const label=doc.createElement('div');label.className='capture-unavailable';label.textContent='HTML 网页画面未采集；请结合文件正文读取。';label.style.cssText='height:100%;padding:24px;font-size:14px;line-height:1.7';frame.replaceWith(label)}
    if(kind==='overview')world.style.transform='translate('+((r.width-w*z)/2-x*z)+'px,'+((r.height-h*z)/2-y*z)+'px) scale('+z+')';
   }});
  return {kind,nodeIds:[...ids],data:image.toDataURL('image/png'),coverage:kind==='overview'?'所选内容的整体布局预览；长内容仍按卡片视窗显示。':'当前白板视窗的 DOM 渲染图；已排除所选范围之外的内容。'};
 }
 async function capture(pack,{check=()=>{}}={}){
  check();
  pack.visualInput=[];pack.visualCoverage=[];
  if($('aiVisuals')?.checked===false){pack.visualCoverage.push('未附图像；只提供文字、文件引用和结构化位置关系。');return}
  if(pack.resource==='board')for(const kind of ['viewport','overview']){check();try{pack.visualInput.push(await canvasSnapshot(pack,kind))}catch(err){pack.visualCoverage.push(kind+' 画面未采集：'+err.message)}check()}
  const sources=imageSources(pack);if(sources.length>64)pack.visualCoverage.push('图片较多，本次提供前 64 张预览，其余保留原文件引用。');
  for(let i=0;i<Math.min(sources.length,64);i+=4){check();await Promise.all(sources.slice(i,i+4).map(async item=>{try{const source=item.source;if(!source.startsWith('data:image/')&&!new URL(source,location.href).href.startsWith(location.origin+'/'))throw Error('外部图片只提供地址');const data=await thumbnail(source);pack.visualInput.push({kind:'image',nodeIds:item.nodeIds,ownerId:item.ownerId,locations:item.locations,source:source.startsWith('data:')?item.path:source,data,coverage:'真实图片预览，最长边不超过 1024 像素；需要辨认小字时请读取原图。'})}catch(err){pack.visualCoverage.push('图片 '+item.ownerId+' 未采集：'+err.message)}}));check()}
  if(pack.resource==='board')for(const video of document.querySelectorAll('#nodes video')){const nodeId=video.closest('.node')?.dataset.id;if(!pack.selectedIds.includes(nodeId)||pack.visualInput.length>=66)continue;try{if(video.readyState<2||!video.videoWidth)throw Error('当前帧尚未加载');const c=document.createElement('canvas'),z=Math.min(1,1024/video.videoWidth,1024/video.videoHeight);c.width=Math.round(video.videoWidth*z);c.height=Math.round(video.videoHeight*z);c.getContext('2d').drawImage(video,0,0,c.width,c.height);pack.visualInput.push({kind:'video-frame',nodeIds:[nodeId],source:video.getAttribute('src'),time:video.currentTime,data:c.toDataURL('image/png'),coverage:'当前已加载的视频静帧，不能代表整段视频。'})}catch(err){pack.visualCoverage.push('视频 '+nodeId+'：'+err.message)}}
  if(pack.resource==='board'&&document.querySelector('#nodes iframe'))pack.visualCoverage.push('嵌入 HTML 的实时画面未采集；提供本地路径与可读取的正文摘录。');
  pack.visualCoverage.push('布局图由页面元素渲染，部分 CSS 或动态内容可能与实际画面有差异；声音未自动转写。');
  let bytes=0;pack.visualInput=pack.visualInput.filter(item=>{const size=Math.floor(item.data.split(',')[1].length*3/4);if(size>3*1024*1024||bytes+size>12*1024*1024){pack.visualCoverage.push('图像 '+(item.ownerId||item.kind)+' 超过附件容量，本次保留文字与原文件引用。');return false}bytes+=size;return true});
 }
 function show(pack){const images=pack.visuals?.images||[],host=$('aiContextPreview');if(!host)return;host.replaceChildren();const title=document.createElement('p');title.textContent='已准备 '+(pack.data.nodes?.length||pack.data.assets?.length||0)+' 块内容、'+images.length+' 张图像附件。位置、分组、表格和时间标记备注也包含在任务里。';host.append(title);for(const im of images){const figure=document.createElement('figure'),img=document.createElement('img'),label=document.createElement('figcaption');img.src=im.url;img.alt=im.kind==='overview'?'整体布局':im.kind==='viewport'?'当前画面':'内容图片';label.textContent=im.kind==='overview'?'整体布局':im.kind==='viewport'?'当前画面':im.kind==='video-frame'?'视频静帧 · '+im.time.toFixed(2)+' 秒':'图片 · '+(im.ownerId||im.nodeIds.join('、'));figure.append(img,label);host.append(figure)}const note=document.createElement('p');note.textContent='本地助手可以读取任务中的图片路径；在线 AI 需要同时上传图片。只粘贴 JSON，它还看不到图片。';host.append(note);for(const text of pack.visuals?.coverage||[]){const p=document.createElement('small');p.textContent=text;host.append(p)}}
 function downloadPack(pack){const a=document.createElement('a');a.href='/api/ai/tasks/'+pack.requestId+'/bundle';a.download='AI整理材料_'+pack.requestId+'.zip';a.click()}
 window.whiteboardContext={capture,show,download:downloadPack,imageSources};
})();
