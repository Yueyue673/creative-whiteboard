// Focus stays with the file list through navigation, refresh and modal viewing.
(() => {
 'use strict';
 const panels={assetPane:'assetList',manager:'boardContents'};
 const selector='[data-asub],[data-asset],[data-entry-id]';
 let modalReturn=null;

 function list(panel){return $(panels[panel])}
 function rows(panel){return [...list(panel).querySelectorAll(selector)]}
 function key(row){
  if(row?.dataset.asset)return 'asset:'+row.dataset.asset;
  if(row?.dataset.asub)return 'folder:'+row.dataset.asub;
  if(row?.dataset.entryId)return 'entry:'+row.dataset.entryId;
  return null;
 }
 function chosen(row,panel){
  return panel==='manager'?boardEntry?.id===row.dataset.entryId:
   row.dataset.asset?assetSelected.has(row.dataset.asset):assetFolderPick===row.dataset.asub;
 }
 function focus(row,reveal=true){
  if(!row)return;
  row.parentElement.querySelectorAll(selector).forEach(el=>el.tabIndex=el===row?0:-1);
  row.focus({preventScroll:true});if(reveal)row.scrollIntoView({block:'nearest'});
 }
 function sync(panel){
  const root=list(panel),items=rows(panel);
  root.tabIndex=items.length?-1:0;root.setAttribute('role','listbox');
  root.setAttribute('aria-label',panel==='manager'?'白板与文件夹':'内容与文件夹');
  root.setAttribute('aria-multiselectable',String(panel==='assetPane'));
  const active=document.activeElement?.closest(selector),tabStop=items.includes(active)?active:items.find(row=>chosen(row,panel))||items[0];
  for(const row of items){
   row.setAttribute('role','option');row.setAttribute('aria-selected',String(chosen(row,panel)));
   row.tabIndex=row===tabStop?0:-1;
   row.querySelectorAll('button,input[type=checkbox]').forEach(el=>el.tabIndex=-1);
  }
 }
 function selection(panel,row,{range=false,toggle=false,additive=false}={}){
  if(panel==='manager'){row.click();sync(panel);return}
  if(row.dataset.asub){
   if(toggle&&assetFolderPick===row.dataset.asub){assetFolderPick=null;assetSelected.clear();row.classList.remove('selected')}
   else row.click();
   sync(panel);return;
  }
  const id=row.dataset.asset,visible=rows(panel).filter(el=>el.dataset.asset).map(el=>el.dataset.asset);
  const anchor=visible.indexOf(libraryRangeAnchor),at=visible.indexOf(id);
  assetFolderPick=null;
  if(range&&anchor>=0){if(!additive)assetSelected.clear();visible.slice(Math.min(anchor,at),Math.max(anchor,at)+1).forEach(value=>assetSelected.add(value))}
  else if(toggle){assetSelected.has(id)?assetSelected.delete(id):assetSelected.add(id);libraryRangeAnchor=id}
  else {assetSelected=new Set([id]);libraryRangeAnchor=id}
  for(const el of rows(panel)){
   el.classList.toggle('selected',chosen(el,panel));
   const check=el.querySelector('input[type=checkbox]');if(check)check.checked=assetSelected.has(el.dataset.asset);
  }
  const folders=rows(panel).filter(el=>el.dataset.asub).length;
  $('assetCount').textContent=(folders?folders+' 个文件夹 · ':'')+libraryMatches().length+' 项'+(assetSelected.size?' · 已选 '+assetSelected.size+' 项':'');
  sync(panel);
 }
 function inList(e,panel){return e.target.closest('#'+panels[panel])||e.target===$(panel)}
 function currentRow(panel,e){return e.target.closest(selector)||rows(panel).find(row=>chosen(row,panel))}
 function location(panel){return JSON.stringify(panel==='assetPane'?[assetFolder,$('assetSearch').value]:[folderSelected,$('boardSearch').value])}
 function rememberScroll(panel){
  const values=[];
  for(let el=list(panel);el&&el!==$(panel).parentElement;el=el.parentElement)values.push({el,top:el.scrollTop,left:el.scrollLeft});
  return values;
 }
 function restoreScroll(values){for(const value of values||[])if(value.el.isConnected){value.el.scrollTop=value.top;value.el.scrollLeft=value.left}}
 function restoreAfterRender(panel,previous){
  sync(panel);
  const sameLocation=previous?.location===location(panel);
  list(panel)._navigationLocation=location(panel);
  if(previous?.active&& !$(panel).hidden){const row=rows(panel).find(el=>key(el)===previous.key);if(row)focus(row,!sameLocation);else list(panel).focus({preventScroll:true})}
  if(sameLocation)restoreScroll(previous.scroll);
 }
 function capture(panel){const active=document.activeElement;return {active:!!active?.closest('#'+panels[panel]),key:key(active?.closest(selector)),location:list(panel)._navigationLocation,scroll:rememberScroll(panel)}}
 const renderAssetsBefore=renderAssets;
 renderAssets=function(){const previous=capture('assetPane');renderAssetsBefore();restoreAfterRender('assetPane',previous)};
 const renderFoldersBefore=renderFolders;
 renderFolders=function(){const previous=capture('manager');renderFoldersBefore();restoreAfterRender('manager',previous)};
 const enterAssetsBefore=enterAssetFolder;
 enterAssetFolder=function(path){const focused=!!document.activeElement?.closest('#assetPane');enterAssetsBefore(path);if(focused&&!$('assetPane').hidden)list('assetPane').focus({preventScroll:true})};
 const enterBoardsBefore=enterBoardFolder;
 enterBoardFolder=function(id){const focused=!!document.activeElement?.closest('#manager');enterBoardsBefore(id);if(focused&&!$('manager').hidden)list('manager').focus({preventScroll:true})};

 function handle(e){
  if($('dialog').open||isTyping(e))return false;
  const panel=e.target.closest('#assetPane,#manager')?.id;
  if(!panel||!inList(e,panel))return false;
  if(e.isComposing||e.keyCode===229){e.stopImmediatePropagation();return true}
  const mod=e.ctrlKey||e.metaKey;
  if(e.altKey&&e.key==='ArrowUp'){
   e.preventDefault();e.stopImmediatePropagation();
   const previous=panel==='assetPane'?assetFolder:folderSelected;
   $(panel==='assetPane'?'assetUp':'boardUp').click();
   const row=rows(panel).find(el=>panel==='assetPane'?el.dataset.asub===previous:el.dataset.entryId===previous);
   if(row){selection(panel,row);focus(row)}else list(panel).focus({preventScroll:true});
   return true;
  }
  if(e.altKey)return false;
  if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){
   const row=currentRow(panel,e);if(!row)return false;
   e.preventDefault();e.stopImmediatePropagation();
   const rect=row.getBoundingClientRect();
   row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left+Math.min(30,rect.width/2),clientY:rect.top+Math.min(25,rect.height/2)}));
   return true;
  }
  if(e.key==='Enter'&&!mod){
   const row=currentRow(panel,e);if(!row)return false;
   e.preventDefault();e.stopImmediatePropagation();
   if(panel==='manager'){selection(panel,row);wfSafe(()=>openBoardEntry({id:row.dataset.entryId,type:row.dataset.entryType}))}
   else if(row.dataset.asub){assetFolderPick=null;enterAssetFolder(row.dataset.asub)}
   else {if(!assetSelected.has(row.dataset.asset))selection(panel,row);wfSafe(()=>previewAsset(row.dataset.asset))}
   return true;
  }
  if(e.key===' '){
   const row=currentRow(panel,e);if(!row)return false;
   e.preventDefault();e.stopImmediatePropagation();selection(panel,row,{toggle:panel==='assetPane',additive:mod});focus(row);return true;
  }
  if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return false;
  e.preventDefault();e.stopImmediatePropagation();
  let items=rows(panel),row=currentRow(panel,e),at=items.indexOf(row);
  if(panel==='assetPane'&&libraryMatches().length>assetLimit&&(e.key==='End'||e.key==='ArrowDown'&&at===items.length-1)){
   const previous=key(row);assetLimit=e.key==='End'?libraryMatches().length:assetLimit+80;renderAssets();items=rows(panel);at=items.findIndex(el=>key(el)===previous);
  }
  if(!items.length)return true;
  const next=e.key==='Home'?0:e.key==='End'?items.length-1:Math.max(0,Math.min(items.length-1,at+(e.key==='ArrowDown'?1:-1)));
  if(e.shiftKey&&panel==='assetPane'&&!libraryRangeAnchor&&row?.dataset.asset)libraryRangeAnchor=row.dataset.asset;
  if(!mod||e.shiftKey)selection(panel,items[next],{range:e.shiftKey,additive:mod});
  focus(items[next]);return true;
 }
 for(const panel of Object.keys(panels)){
  list(panel).addEventListener('click',e=>{
   const row=e.target.closest(selector);if(!row)return;
   sync(panel);
   if(e.target.matches('input[type=checkbox]'))focus(rows(panel).find(el=>key(el)===key(row)));
  });
 }
 const showDialogBefore=showDialog;
 showDialog=function(...args){
  if(!$('dialog').open){const panel=document.activeElement?.closest('#assetPane,#manager')?.id;modalReturn=panel?{panel,key:key(document.activeElement.closest(selector)),location:location(panel),scroll:rememberScroll(panel)}:null}
  return showDialogBefore(...args);
 };
 $('dialog').addEventListener('close',()=>{
  if($('dialog').open)return;
  const previous=modalReturn;modalReturn=null;if(!previous||$(previous.panel).hidden)return;
  const items=rows(previous.panel),row=items.find(el=>key(el)===previous.key)||items.find(el=>chosen(el,previous.panel));
  const sameLocation=previous.location===location(previous.panel);
  if(row)focus(row,!sameLocation||!previous.key);else list(previous.panel).focus({preventScroll:true});
  if(sameLocation&&previous.key)restoreScroll(previous.scroll);
 });
 window.whiteboardExplorerNavigation={handle};
 for(const panel of Object.keys(panels)){sync(panel);list(panel)._navigationLocation=location(panel)}
})();
