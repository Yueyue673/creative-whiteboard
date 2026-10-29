// Find independent bundle copies by their stored origin, never by author text.
(() => {
 'use strict';
 let sequence=0;
 const nodeId=value=>typeof value==='string'&&value.length>0&&value.length<=1000&&!value.includes('\0');
 const label=value=>typeof value==='string'?(value.length<=500?value:value.slice(0,500)+'…'):'';
 function scan(value,identity,maximum=40){
  const items=[],deadline=performance.now()+50;let parts=0,limited=false;
  const full={},abort={};
  const tick=()=>{if(++parts>100000||performance.now()>deadline)throw abort};
  if(!value||!Array.isArray(value.nodes))return{items:[],limited:true};
  try{
   const roots=new Map;for(const n of value.nodes){tick();if(n&&typeof n.id==='string')roots.set(n.id,(roots.get(n.id)||0)+1)}
   const walk=(n,root,context,depth)=>{
    tick();if(depth>16)throw abort;
    if(!n||typeof n!=='object'||Array.isArray(n)){limited=true;return}
    if(n.libraryOrigin&&typeof n.libraryOrigin==='object'&&n.libraryOrigin.id===identity){
     if(!nodeId(n.id))limited=true;
     else{if(items.length>=maximum)throw full;items.push({rootId:root.id,nodeId:n.id,title:label(n.title),context:context.slice(0,180)})}
    }
    if(n.type!=='table')return;
    const grid=n.cellItems??[];if(!Array.isArray(grid)){limited=true;return}
    for(const [r,row]of grid.entries()){tick();if(!Array.isArray(row)){limited=true;continue}for(const [c,cell]of row.entries()){tick();if(!Array.isArray(cell)){limited=true;continue}for(const [i,child]of cell.entries())walk(child,root,context+' · 第'+(r+1)+'行第'+(c+1)+'列第'+(i+1)+'项',depth+1)}}
   };
   for(const [i,n]of value.nodes.entries()){tick();if(!nodeId(n?.id)||roots.get(n.id)!==1){limited=true;continue}walk(n,n,'第'+(i+1)+'块',0)}
  }catch(error){if(error===full)return{items,limited:true};if(error===abort)return{items:[],limited:true,interrupted:true};throw error}
  return{items,limited};
 }
 const liveSnapshot=target=>{
  try{if(parent!==window&&parent.whiteboardWorkspace?.librarySnapshot)return parent.whiteboardWorkspace.librarySnapshot(window,target)}
  catch{return null}
  return board&&!loading&&(!target||target===boardId)?{boardId,board:clone(board)}:null;
 };
 function sourceContext(){
  try{const inner=window.whiteboardHosted||null,outer=parent.whiteboardHosted||null;return {inner,outer,key:JSON.stringify([inner?.account?.id,inner?.workspace,inner?.base,outer?.account?.id,outer?.workspace,outer?.base])}}catch{return null}
 }
 function mountSourceReturn(asset,body){
  const referenceOnly=!asset.source&&!!asset.sourceReference,source=asset.source||asset.sourceReference,menu=body.querySelector('.reuse-source-actions'),preview=$('pieceList');
  if(!menu||!preview||typeof source?.boardId!=='string'||!(/^[A-Za-z0-9_-]{1,100}$/).test(source.boardId)||!Array.isArray(source.nodeIds)||!source.nodeIds.length)return;
  const initial=sourceContext(),sourceVersion=JSON.stringify([asset.source,asset.sourceReference]),button=document.createElement('button'),status=document.createElement('p');
  button.type='button';button.textContent=referenceOnly?'查看原组合收录时的白板':'查看收录时的白板';button.title=referenceOnly?'仅作为原组合的来源参考；这份独立资源不会用原白板整体替换':'查看整张来源白板，再返回当前原稿';
  status.className='wf-explain library-source-status';status.setAttribute('role','status');status.hidden=true;menu.append(button,status);
  let navigating=false;
  const scopeValid=()=>{
   const now=sourceContext();if(!initial||!now||now.inner!==initial.inner||now.outer!==initial.outer||now.key!==initial.key)return false;
   return [now.inner,now.outer].every(host=>!host||!host.paused&&host.account?.id!=null&&host.workspace!=null&&host.base!=null);
  };
  const ownsPreview=()=>$('dialog').open&&preview.isConnected&&$('pieceList')===preview&&button.isConnected;
  const owns=()=>ownsPreview()&&JSON.stringify([assetById(asset.id)?.source,assetById(asset.id)?.sourceReference])===sourceVersion;
  const explain=message=>{if(ownsPreview()){status.textContent=message;status.hidden=false}};
  button.onclick=async()=>{
   if(navigating||!ownsPreview())return;if(!owns())return explain('来源记录已有变化，请重新打开预览后核对。');if(!scopeValid())return explain('所属账号或工作区尚未确认，请保留当前输入，回到原位置后重试。');
   navigating=true;button.disabled=true;explain('正在核对来源白板…');
   let interrupted=false;const controller=new AbortController(),cleanups=[],cancel=()=>{interrupted=true;controller.abort();for(const cleanup of cleanups.splice(0))cleanup()};
   const docs=new Set([document]);try{docs.add(parent.document);for(const frame of parent.document.querySelectorAll('iframe'))if(frame.contentDocument)docs.add(frame.contentDocument)}catch{cancel()}
   for(const doc of docs)for(const type of ['pointerdown','keydown','input','change','wheel','touchmove']){const stop=e=>{if(e.isTrusted)cancel()};doc.addEventListener(type,stop,true);cleanups.push(()=>doc.removeEventListener(type,stop,true))}
   onDialogDismiss(cancel);const active=()=>!interrupted&&owns()&&scopeValid();
   try{
    // The recorded board is the destination. A group never chooses one child
    // as a substitute for the whole source board.
    const live=liveSnapshot(source.boardId);
    if(!live)await(await api('/api/boards/'+encodeURIComponent(source.boardId),{signal:controller.signal})).json();
    if(!active()){if(!interrupted&&ownsPreview())explain('来源或所属位置已有变化，未打开其他白板。当前原稿保留。');return}
    for(const cleanup of cleanups.splice(0))cleanup();
    const opened=await parent.whiteboardWorkspace.openLibraryCopy(window,{board:source.boardId,id:null,returnName:label(liveSnapshot()?.board?.name)||'原稿'},active,scopeValid);
    if(opened===false&&owns())explain('暂未打开来源白板，当前原稿保留。请处理提示后再试。');
   }catch(error){if(!interrupted&&owns()&&error.name!=='AbortError')explain(error.message||'暂时不能打开来源白板，当前原稿保留。')}
   finally{for(const cleanup of cleanups)cleanup();navigating=false;if(ownsPreview()){button.disabled=false;if(interrupted)explain('已停下本次打开，当前原稿保留。需要时可重试。')}}
  };
 }
 const previous=previewAsset;
 previewAsset=function(id){
  const epoch=++sequence,before=$('dialogBody').firstElementChild,result=previous(id);
  Promise.resolve(result).then(()=>{
   const asset=assetById(id),body=$('dialogBody');
   if(parent===window||!parent.whiteboardWorkspace?.canLocateLibraryCopies?.(window))return;
   if(epoch!==sequence||!$('dialog').open||body.firstElementChild===before||asset?.mime!==bundleMime||asset.archived)return;
   mountSourceReturn(asset,body);
   const section=document.createElement('details');section.className='library-copies';
   const summary=document.createElement('summary');summary.textContent='用过的白板副本';
   const status=document.createElement('p');status.setAttribute('role','status');status.textContent='按原件记录查找，副本改名后也能找到。';
   const list=document.createElement('div');list.className='library-copy-list';
   const retry=document.createElement('button');retry.type='button';retry.className='library-copy-retry';retry.textContent='重新查找';retry.hidden=true;
   const scope=document.createElement('small');scope.textContent='当前白板按正在编辑的内容核对；其他窗口尚未保存的修改可能不会显示。';
   section.append(summary,status,list,retry,scope);body.append(section);
   let request=0,controller=null,navigating=false;
   const active=()=>epoch===sequence&&section.isConnected&&$('dialog').open&&body.contains(section)&&assetById(id)?.mime===bundleMime&&!assetById(id)?.archived;
   const cancel=()=>{request++;controller?.abort();controller=null};
   onDialogDismiss(cancel);
   const validRow=row=>row&&typeof row.boardId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(row.boardId)&&nodeId(row.rootId)&&nodeId(row.nodeId)&&['boardName','folder','title','context'].every(k=>typeof row[k]==='string');
   async function load(){
    if(!active()||!section.open)return;cancel();controller=new AbortController();const token=request,signal=controller.signal;
    status.textContent='正在查找…';retry.hidden=true;list.replaceChildren();
    try{
     const data=await(await api('/api/library-copies?id='+encodeURIComponent(id),{signal})).json();
     if(!active()||token!==request||!section.open)return;
     if(data.assetId!==id||!Array.isArray(data.items)||data.items.length>40||!data.items.every(validRow)||!['limited','currentSupportedCopies'].includes(data.coverage))throw Error('结果暂时不能准确对应，请重新查找。');
     const binding=window.whiteboardHosted;
     if(binding?.account!==undefined&&String(data.account)!==String(binding.account?.id??binding.account))throw Error('页面所属账号已变化，请保留当前输入。');
     if(binding?.workspace!==undefined&&String(data.workspace)!==String(binding.workspace))throw Error('页面所属工作区已变化，请保留当前输入。');
     let rows=data.items.map(row=>({...row,current:false})),limited=data.coverage==='limited';
     const live=liveSnapshot();
     if(live?.boardId&&live.board){
      const found=scan(live.board,id);
      rows=[...found.items.map(row=>({...row,boardId:live.boardId,boardName:label(live.board.name),folder:label(live.board.folder),current:true})),...rows.filter(row=>row.boardId!==live.boardId)];
      limited||=found.limited;
     }
     if(rows.length>40){rows=rows.slice(0,40);limited=true}
     for(const hit of rows){
      const button=document.createElement('button');button.type='button';button.className='library-copy-hit';button.dataset.copyBoard=hit.boardId;button.dataset.copyNode=hit.nodeId;
      const name=document.createElement('strong'),where=document.createElement('small'),title=document.createElement('span');
      name.textContent=hit.boardName||'未命名白板';where.textContent=(hit.folder||'根目录')+' · '+hit.context+(hit.current?' · 当前工作内容':'');title.textContent=hit.title||'未命名内容';button.append(name,where,title);list.append(button);
      button.onclick=async()=>{
       if(!active()||token!==request||navigating)return;navigating=true;for(const b of list.querySelectorAll('button'))b.disabled=true;status.textContent='正在核对这处副本…';
       try{
        let latest=liveSnapshot(hit.boardId)?.board;
        if(!latest)latest=await(await api('/api/boards/'+encodeURIComponent(hit.boardId),{signal})).json();
        if(!active()||token!==request)return;
        const checked=scan(latest,id);
        if(checked.interrupted||!checked.items.some(row=>row.rootId===hit.rootId&&row.nodeId===hit.nodeId))throw Error('这处副本已有变化，请重新查找。');
        const opened=await parent.whiteboardWorkspace.openLibraryCopy(window,{board:hit.boardId,id:hit.nodeId,rootId:hit.rootId,returnName:label(liveSnapshot()?.board?.name)||'原稿'},()=>active()&&token===request);
        if(opened===false&&active())throw Error('没有打开这处副本，原稿仍保留。');
       }catch(error){if(active()&&token===request&&error.name!=='AbortError'){status.textContent=error.message||'暂时没有打开，原稿仍保留。';retry.hidden=false}}
       finally{navigating=false;if(active()&&token===request)for(const b of list.querySelectorAll('button'))b.disabled=false}
      };
     }
     status.textContent=rows.length?'找到 '+rows.length+' 处副本。':'暂未找到有原件记录的副本。';
     if(limited)status.textContent+=' 尚未查完全部范围，可稍后重新查找。';
     retry.hidden=false;
    }catch(error){if(active()&&token===request&&error.name!=='AbortError'){status.textContent=error.message||'暂时没能查找，原内容保留。';retry.hidden=false}}
   }
   retry.onclick=load;
   section.addEventListener('toggle',()=>{if(section.open)load();else cancel()});
  }).catch(()=>{});
  return result;
 };
 window.whiteboardLibraryCopies={scan};
})();

