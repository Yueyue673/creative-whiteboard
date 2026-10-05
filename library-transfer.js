// A library insertion keeps its destination and reports the actual canvas result.
(() => {
 'use strict';
 let active=null;
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function ready(tab){
  const started=Date.now();
  while(Date.now()-started<15000){
   if(!model.tabs.some(t=>t.id===tab.id))throw Error('目标白板已关闭，内容尚未添加。请重新选择。');
   const frame=frames.get(tab.id),view=pane(tab),state=view?.state();
   if(state&&!state.loading&&state.boardId===tab.boardId){
    if(state.deleted||state.blocked||state.saveError)throw Error('目标白板还有保存问题，内容尚未添加。请先处理提示。');
    return view;
   }
   if(state&&!state.loading&&frame?.contentDocument?.readyState==='complete'&&state.boardId!==tab.boardId)throw Error('目标白板未能打开，内容尚未添加。请重试。');
   await pause(50);
  }
  throw Error('目标白板打开较慢，内容尚未添加。打开后可以重试。');
 }
 window.whiteboardLibraryTransfer={
  async place(message,source){
   const requestId=message.requestId;
   const reply=value=>source.postMessage({type:'explorer-place-result',requestId,...value},location.origin);
   if(active){reply({error:'上一批内容还在添加，请稍候。'});return}
   if(!Array.isArray(message.items)||!message.items.length){reply({error:'没有可添加的内容。'});return}
   active=requestId||uid();
   try{
    let tab=current();
    if(!tab)tab=await picker(model.side,{title:'把内容放到哪张白板？',hint:'选择已有白板，或新建一张。取消后保留原来的内容和勾选。'});
    if(!tab){reply({cancelled:true});return}
    // The tab selected at the start remains the destination, even after a later tab switch.
    const view=await ready(tab),ids=await view.insertLibrary(message.items);
    if(!Array.isArray(ids)||!ids.length){reply({error:'这批内容尚未添加，请查看目标白板的提示。'});return}
    reply({ids,boardId:tab.boardId});
    if(current()?.id!==tab.id)toast('已添加到“'+tab.name+'” · 在该白板可撤销');
   }catch(e){reply({error:e.message})}
   finally{active=null}
  }
 };
})();
