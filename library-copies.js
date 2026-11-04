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
 const liveBoardSummary=target=>{
  try{
   const workspace=parent!==window&&parent.whiteboardWorkspace;
   if(workspace?.libraryBoardSummary)return workspace.libraryBoardSummary(window,target);
   if(workspace?.librarySnapshot){
    const snapshot=workspace.librarySnapshot(window,target);
    return snapshot?{boardId:snapshot.boardId,name:snapshot.board.name}:null;
   }
  }
  catch{return null}
  return board&&!loading&&(!target||target===boardId)?{boardId,name:board.name}:null;
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
    const live=liveBoardSummary(source.boardId);
    if(!live)await(await api('/api/boards/'+encodeURIComponent(source.boardId),{signal:controller.signal})).json();
    if(!active()){if(!interrupted&&ownsPreview())explain('来源或所属位置已有变化，未打开其他白板。当前原稿保留。');return}
    for(const cleanup of cleanups.splice(0))cleanup();
    const opened=await parent.whiteboardWorkspace.openLibraryCopy(window,{board:source.boardId,id:null,returnName:label(liveBoardSummary()?.name)||'原稿'},active,scopeValid);
    if(opened===false&&owns())explain('暂未打开来源白板，当前原稿保留。请处理提示后再试。');
   }catch(error){if(!interrupted&&owns()&&error.name!=='AbortError')explain(error.message||'暂时不能打开来源白板，当前原稿保留。')}
   finally{for(const cleanup of cleanups)cleanup();navigating=false;if(ownsPreview()){button.disabled=false;if(interrupted)explain('已停下本次打开，当前原稿保留。需要时可重试。')}}
  };
 }
 const referenceTrails=new WeakMap(),alternativeViews=new WeakMap();
 function referenceScopeValid(initial){
  const now=libraryPreviewEditScope();
  return !!initial&&!!now&&now.inner===initial.inner&&now.outer===initial.outer&&now.key===initial.key&&!document.hidden&&(!frameElement||!!frameElement.getClientRects().length)&&[now.inner,now.outer].every(host=>!host||!host.paused&&host.account?.id!=null&&host.workspace!=null&&host.base!=null);
 }
 function referenceIntent(){
  let interrupted=false,ended=false;const cleanups=[],cancel=()=>{if(!ended)interrupted=true};
  const docs=new Set([document]);try{docs.add(parent.document);for(const frame of parent.document.querySelectorAll('iframe'))if(frame.contentDocument)docs.add(frame.contentDocument)}catch{interrupted=true}
  for(const doc of docs)for(const type of ['pointerdown','keydown','input','change','wheel','touchmove']){const stop=event=>{if(event.isTrusted)cancel()};doc.addEventListener(type,stop,true);cleanups.push(()=>doc.removeEventListener(type,stop,true))}
  const end=()=>{ended=true;for(const cleanup of cleanups.splice(0))cleanup()};onDialogDismiss(()=>{cancel();end()});return {current:()=>!interrupted,end};
 }
 async function visitLibraryReference({asset,preview,button,status,targetId,scope,trail,restore=null,referenceVersion=null,targetReferenceId=null}){
  const owns=()=>$('dialog').open&&preview.isConnected&&$('pieceList')===preview&&button.isConnected&&status.isConnected;
  const explain=message=>{if(owns()){status.textContent=message;status.hidden=false}};
  const ownerCurrent=()=>{const owners=assetIndex.assets.filter(item=>item.id===asset.id&&!item.archived&&item.mime===bundleMime);return (targetReferenceId===null||owners.length===1)&&(referenceVersion===null||owners.length===1&&JSON.stringify(owners[0].libraryReference)===referenceVersion)};
  if(!owns()||button.disabled)return;if(!referenceScopeValid(scope))return explain('所属账号、工作区或查看位置已有变化，请回到原位置后重试。');if(!ownerCurrent())return explain('来源记录已有变化，请重新打开这份资源后核对。');
  button.disabled=true;explain('正在核对来源资源…');const intent=referenceIntent();
  try{
   await loadAssets({redraw:false});
   if(!owns())return;if(!intent.current())return explain('已停下来源查看，当前预览保留。');if(!referenceScopeValid(scope))return explain('所属账号、工作区或查看位置已有变化，请回到原位置后重试。');if(!ownerCurrent())return explain('来源记录已有变化，请重新打开这份资源后核对。');
   const matches=assetIndex.assets.filter(item=>item.id===targetId&&!item.archived&&item.mime===bundleMime&&Array.isArray(item.bundle?.nodes));
   if(matches.length!==1)return explain('这份资源已移出内容库或暂不可用，当前预览保留。');
   const target=matches[0];if(targetReferenceId!==null&&target.libraryReference?.id!==targetReferenceId)return explain('这份另存内容的来源记录已有变化，请刷新列表。');intent.end();
   const pending=previewAsset(target.id),next=$('pieceList'),opened=!!next&&next!==preview&&!preview.isConnected;
   const nextOwns=()=>opened&&referenceScopeValid(scope)&&$('dialog').open&&next.isConnected&&$('pieceList')===next;
   const continuation=referenceIntent();try{
    await Promise.resolve(pending);if(!nextOwns())return;
    referenceTrails.set(next,trail);mountLibraryReferenceBack(target,next,scope,trail);
    if(continuation.current()){if(restore){alternativeViews.get(next)?.restore(restore.alternatives,nextOwns);libraryPreviewContinuations.get(next)?.restore(restore,nextOwns)}next.focus({preventScroll:true})}
   }finally{continuation.end()}
  }catch(error){if(owns())explain(error.message||'暂时不能读取来源资源，当前预览保留。')}
  finally{intent.end();if(owns())button.disabled=false}
 }
 function mountLibraryReferenceBack(asset,preview,scope,trail){
  if(!trail.length)return;const previous=trail.at(-1),button=$('dialogBody').querySelector('[data-reuse-return] button'),menu=$('dialogBody').querySelector('.reuse-source-actions');if(!button||!menu)return;
  const status=document.createElement('p');status.className='wf-explain library-reference-return-status';status.setAttribute('role','status');status.hidden=true;$('dialogBody').querySelector('.reuse-heading').after(status);
  const source=previous.returnKind==='source';button.textContent=source?'返回来源':'返回改写';button.setAttribute('aria-label',(source?'返回来源资源：':'返回这份改写：')+previous.title);
  button.onclick=()=>visitLibraryReference({asset,preview,button,status,targetId:previous.id,scope,trail:trail.slice(0,-1),restore:previous.snapshot});
 }
 function mountLibraryReference(asset,body){
  const reference=asset.libraryReference,menu=body.querySelector('.reuse-source-actions'),preview=$('pieceList');
  if(!menu||!preview||!reference||Array.isArray(reference)||typeof reference.id!=='string'||!(/^[A-Za-z0-9_-]{1,100}$/).test(reference.id)||reference.id===asset.id)return;
  const scope=libraryPreviewEditScope(),version=JSON.stringify(reference),button=document.createElement('button'),description=document.createElement('p'),status=document.createElement('p');
  const current=assetIndex.assets.filter(item=>item.id===reference.id&&!item.archived&&item.mime===bundleMime),name=current.length===1?current[0].title:typeof reference.name==='string'?reference.name.slice(0,500):'原资源';
  description.className='wf-explain';description.style.overflowWrap='anywhere';description.textContent='来自“'+name+'”。查看它目前的内容，两份分别保存。';
  button.type='button';button.textContent='查看来源资源';status.className='wf-explain library-reference-status';status.setAttribute('role','status');status.hidden=true;menu.append(button,status,description);
  button.onclick=()=>{
   if(button.disabled||!preview.isConnected||$('pieceList')!==preview||!$('dialog').open)return;
   const history=referenceTrails.get(preview)||[],last=history.at(-1);if(last?.returnKind==='source'&&last.id===reference.id)return visitLibraryReference({asset,preview,button,status,targetId:reference.id,scope,trail:history.slice(0,-1),restore:last.snapshot,referenceVersion:version});
   const trail=[...history,{id:asset.id,title:asset.title,snapshot:captureReferencePreview(preview)}];
   if(trail.some(entry=>entry.id===reference.id)){status.textContent='这条来源已在查看路径中，请先返回。';status.hidden=false;return}
   return visitLibraryReference({asset,preview,button,status,targetId:reference.id,scope,trail,referenceVersion:version});
  };
 }
 function captureReferencePreview(preview){
  const snapshot=libraryPreviewContinuations.get(preview)?.capture()||{};snapshot.alternatives=alternativeViews.get(preview)?.capture();return snapshot;
 }
 function mountLibraryAlternatives(asset,body){
  const preview=$('pieceList'),heading=body.querySelector('.reuse-heading');if(!preview||!heading)return;
  const scope=libraryPreviewEditScope(),section=document.createElement('details'),summary=document.createElement('summary'),status=document.createElement('p'),list=document.createElement('div'),refresh=document.createElement('button'),more=document.createElement('button'),description=document.createElement('small');
  section.className='library-copies library-alternatives';summary.textContent='基于这份资源另存的内容';status.setAttribute('role','status');list.className='library-copy-list library-alternative-items';refresh.type=more.type='button';refresh.className=more.className='library-copy-retry';refresh.textContent='刷新列表';more.textContent='显示更多';more.hidden=true;description.textContent='只列这份资源直接另存出的内容。';section.append(summary,status,list,more,refresh,description);heading.after(section);
  let request=0,limit=40,rows=[],skipToggle=false;
  const owns=()=>$('dialog').open&&preview.isConnected&&$('pieceList')===preview&&section.isConnected&&referenceScopeValid(scope);
  const parentPresent=()=>assetIndex.assets.filter(item=>item.id===asset.id&&!item.archived&&item.mime===bundleMime).length===1;
  const related=()=>{
   const found=assetIndex.assets.filter(item=>!item.archived&&item.mime===bundleMime&&Array.isArray(item.bundle?.nodes)&&typeof item.id==='string'&&(/^[A-Za-z0-9_-]{1,100}$/).test(item.id)&&item.id!==asset.id&&item.libraryReference?.id===asset.id),counts=new Map();
   for(const item of found)counts.set(item.id,(counts.get(item.id)||0)+1);return found.filter(item=>counts.get(item.id)===1);
  };
  function draw(){
   if(!owns()||!section.open)return;list.replaceChildren();
   for(const item of rows.slice(0,limit)){
    const entry=document.createElement('div'),button=document.createElement('button'),name=document.createElement('strong'),where=document.createElement('small'),message=document.createElement('p');
    button.type='button';button.className='library-copy-hit';button.dataset.alternativeResource=item.id;button.setAttribute('aria-label','查看另存内容：'+item.title);name.textContent=label(item.title)||'未命名内容';where.textContent=item.folder||'内容库根目录';button.append(name,where);message.className='library-alternative-status';message.setAttribute('role','status');message.hidden=true;entry.append(message,button);list.append(entry);
    button.onclick=()=>{
     if(!owns()||!section.open||!button.isConnected||button.disabled)return;
     const trail=[...(referenceTrails.get(preview)||[]),{id:asset.id,title:asset.title,snapshot:captureReferencePreview(preview),returnKind:'source'}];
     if(trail.some(previous=>previous.id===item.id)){message.textContent='这份资源已在查看路径中，请先返回。';message.hidden=false;return}
     return visitLibraryReference({asset,preview,button,status:message,targetId:item.id,scope,trail,targetReferenceId:asset.id});
    };
   }
   status.textContent=rows.length?'找到 '+rows.length+' 份；点击查看后可以返回。':'暂未找到有来源记录的另存内容。';more.hidden=limit>=rows.length;
  }
  function useCatalog(){
   if(!owns()||!section.open)return;if(!parentPresent()){rows=[];list.replaceChildren();more.hidden=true;status.textContent='这份资源已移出内容库，当前预览保留。';return}rows=related();draw();
  }
  async function load(){
   if(!owns()||!section.open)return;const token=++request;refresh.disabled=true;status.textContent='正在核对另存内容…';
   try{await loadAssets({redraw:false});if(token!==request||!section.open||!section.isConnected||!preview.isConnected||$('pieceList')!==preview)return;if(!owns()){list.replaceChildren();more.hidden=true;status.textContent='所属账号、工作区或查看位置已有变化，请回到原位置后刷新。';return}useCatalog()}
   catch(error){if(token===request&&owns()&&section.open)status.textContent=error.message||'暂时不能读取列表，当前预览保留。'}
   finally{if(token===request&&section.isConnected)refresh.disabled=false}
  }
  section.addEventListener('toggle',()=>{if(skipToggle){skipToggle=false;return}if(section.open)load();else{request++;refresh.disabled=false}});refresh.onclick=load;more.onclick=()=>{if(owns()&&section.open){limit+=40;draw()}};
  alternativeViews.set(preview,{capture:()=>({open:section.open,limit}),restore:(snapshot,current)=>{
   if(!snapshot?.open||!current()||!owns())return;limit=Number.isSafeInteger(snapshot.limit)?Math.max(40,Math.min(10000,snapshot.limit)):40;skipToggle=true;section.open=true;useCatalog();
  }});
  onDialogDismiss(()=>request++);
 }
 const previous=previewAsset;
 previewAsset=function(id){
  const epoch=++sequence,before=$('dialogBody').firstElementChild,result=previous(id);
  Promise.resolve(result).then(()=>{
   const asset=assetById(id),body=$('dialogBody');
   if(epoch!==sequence||!$('dialog').open||body.firstElementChild===before||asset?.mime!==bundleMime||asset.archived)return;
   mountLibraryReference(asset,body);mountLibraryAlternatives(asset,body);
   if(parent===window||!parent.whiteboardWorkspace?.canLocateLibraryCopies?.(window))return;
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
        const opened=await parent.whiteboardWorkspace.openLibraryCopy(window,{board:hit.boardId,id:hit.nodeId,rootId:hit.rootId,returnName:label(liveBoardSummary()?.name)||'原稿'},()=>active()&&token===request);
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

