// A library insertion keeps its destination and reports the actual canvas result.
(() => {
 'use strict';
 let active=null;
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function ready(tab){
  const started=Date.now();
  while(Date.now()-started<15000){
   if(!model.tabs.some(t=>t.id===tab.id))throw Error('目标白板已关闭');
   const frame=frames.get(tab.id),view=pane(tab),state=view?.state();
   if(state&&!state.loading&&state.boardId===tab.boardId){
    if(state.deleted||state.blocked||state.saveError)throw Error('先处理目标白板的保存问题');
    return view;
   }
   if(state&&!state.loading&&frame?.contentDocument?.readyState==='complete'&&state.boardId!==tab.boardId)throw Error('目标白板未能打开');
   await pause(50);
  }
  throw Error('目标白板还在打开');
 }
 window.whiteboardLibraryTransfer={
  destination(){const tab=current();return tab?{tabId:tab.id,boardId:tab.boardId}:null},
  preview(destination,items){const tab=destination&&model.tabs.find(tab=>tab.id===destination.tabId&&tab.boardId===destination.boardId),view=tab&&pane(tab),state=view?.state();return state?.boardId===tab?.boardId&&!state?.loading?view?.beginInsertion?.(items):null},
  async place(message,source){
   const requestId=message.requestId;
   const reply=value=>source.postMessage({type:'explorer-place-result',requestId,...value},location.origin);
   if(active){reply({error:'上一批还没添加完'});return}
   if(!Array.isArray(message.items)||!message.items.length){reply({error:'没有选中内容'});return}
   active=requestId||uid();
   try{
    const specified=Object.hasOwn(message,'destination'),target=message.destination;
    let tab=specified?(target?model.tabs.find(tab=>tab.id===target.tabId&&tab.boardId===target.boardId):null):current();
    if(target&&!tab)throw Error('原白板已关闭');
    if(!tab)tab=await picker(model.side,{title:'把内容放到哪张白板？',hint:'选择白板，也可以新建。'});
    if(!tab){reply({cancelled:true});return}
    // The tab selected at the start remains the destination, even after a later tab switch.
    const view=await ready(tab),ids=await view.insertLibrary(message.items,message.position);
    if(!Array.isArray(ids)||!ids.length){reply({error:'未能添加到目标白板'});return}
    reply({ids,boardId:tab.boardId});
    if(current()?.id!==tab.id)toast('已放入「'+tab.name+'」');
   }catch(e){reply({error:e.message})}
   finally{active=null}
  }
 };
})();
