// File work belongs to the document and attachment target chosen when it starts.
(() => {
 'use strict';
 const explorer = new URLSearchParams(location.search).get('explorer') === '1';
 const tasks = new Map();
 let preparingPlacement = false;
 const pendingCanvas = () => [...tasks.values()].some(task => task.kind === 'canvas');
 const announce = () => {
  window.dispatchEvent(new Event('creative-import-state'));
  if (explorer && parent !== window) parent.postMessage({type:'explorer-import-state'}, location.origin);
 };
 function run(action, kind = 'canvas') {
  if (kind === 'canvas' && !explorer && (loading || !board)) {
   notice('白板还在打开，内容尚未添加。请打开后再试。');
   return Promise.resolve(false);
  }
  const token = {}, entry = {kind, promise:null};
  let finish;
  entry.promise = new Promise(resolve => finish = resolve);
  tasks.set(token, entry); announce();
  return (async () => {
   try {return await action();}
   finally {tasks.delete(token); finish(); announce();}
  })();
 }
 async function idle() {
  for (;;) {
   const pending = [...tasks.values()].filter(task => task.kind === 'canvas');
   if (!pending.length) return;
   await Promise.all(pending.map(task => task.promise));
  }
 }
 async function flush(operation = () => persist()) {
  for (;;) {
   await idle();
   if (!await operation()) return false;
   if (!pendingCanvas() && !dirty && !savePromise) return true;
  }
 }
 function notice(text) {
  toast(text);
  if (parent !== window && !explorer) parent.postMessage({type:'pane-import-notice', text}, location.origin);
 }
 function attachmentTarget(target) {
  if (target._importDestination) return target;
  const node = board?.nodes.find(node => node.id === target.nodeId);
  let cell = null;
  if (node?.type === 'table' && Number.isInteger(target.r) && Number.isInteger(target.c)) {
   tableAxisIds(node);
   cell = {rowId:node.rowIds[target.r], columnId:node.columnIds[target.c]};
  }
  return {...target, _importDestination:{boardId, nodeId:node?.id, cell}};
 }
 function resolveAttachment(target) {
  const saved = target._importDestination;
  if (!saved) return target;
  const node = board?.nodes.find(node => node.id === target.nodeId);
  if (saved.boardId !== boardId || node?.id !== saved.nodeId || !node) return null;
  if (saved.cell) {
   if (node.type !== 'table' || !saved.cell.rowId || !saved.cell.columnId) return null;
   const r = node.rowIds?.indexOf(saved.cell.rowId) ?? -1, c = node.columnIds?.indexOf(saved.cell.columnId) ?? -1;
   return r >= 0 && c >= 0 && node.rows[r]?.[c] !== undefined ? {...target, r, c} : null;
  }
  return target;
 }
 const upload = uploadFiles;
 uploadFiles = function(files, folder = assetFolder) {
  const snapshot = [...files];
  return run(() => upload(snapshot, folder), 'library');
 };
 const importBefore = importFiles;
 importFiles = function(files, position) {
  const snapshot = [...files], point = position || (!explorer && board ? center() : undefined);
  return run(() => importBefore(snapshot, point), explorer ? 'library' : 'canvas');
 };
 const pasteBefore = pastePayload;
 pastePayload = function(text, files = [], anchor = pasteAnchor()) {
  const snapshot = [...files], point = {...anchor};
  return run(() => pasteBefore(text, snapshot, point), explorer ? 'library' : 'canvas');
 };
 const pasteMenuBefore = pasteBlocks;
 pasteBlocks = function(anchor = pasteAnchor()) {
  return run(() => pasteMenuBefore({...anchor}), explorer ? 'library' : 'canvas');
 };
 const placeBefore = placeAssets;
 placeAssets = function(ids, position) {
  if (explorer && preparingPlacement) {toast('上一批内容还在添加，请稍候。'); return Promise.resolve(false);}
  const snapshot = [...ids], point = position;
  if (explorer) preparingPlacement = true;
  return run(() => placeBefore(snapshot, point), explorer ? 'library' : 'canvas')
   .finally(() => {if (explorer) preparingPlacement = false;});
 };
 const attachBefore = attachFiles;
 attachFiles = function(files, target) {
  const snapshot = [...files], destination = attachmentTarget(target);
  return run(() => attachBefore(snapshot, destination));
 };
 const chooseBefore = chooseImages;
 chooseImages = function(target) {return chooseBefore(attachmentTarget(target));};
 const attachAssetsBefore = attachAssets;
 attachAssets = function(ids, target) {
  const snapshot = [...new Set(ids)], saved = attachmentTarget(target);
  const append = () => {
   const destination = resolveAttachment(saved);
   if (!destination) {
    notice('原来的内容或单元格已改变，文件已保留在内容库中，可以重新放置。');
    return false;
   }
   if (snapshot.some(id => !assetById(id) || assetById(id).archived)) {
    notice('有内容已移除，整批尚未放入。请刷新内容库后重试。');
    return false;
   }
   return attachAssetsBefore(snapshot, destination);
  };
  if (snapshot.every(id => assetById(id))) return append();
  // A shared-library upload may reach this cell before its catalog refresh.
  return run(async () => {
   try {await loadAssets();} catch (error) {notice(error.message); return false;}
   return append();
  });
 };
 for (const name of ['switchBoard', 'newBoard', 'confirmReload', 'saveCopy']) {
  const before = window[name];
  window[name] = async function(...args) {await idle(); return before(...args);};
 }
 if (window.whiteboardPane) {
  const flushBefore = whiteboardPane.flush;
  whiteboardPane.flush = () => flush(flushBefore);
 }
 window.addEventListener('beforeunload', event => {
  if (!tasks.size) return;
  event.preventDefault(); event.returnValue = '';
 });
 window.whiteboardImports = {
  idle,
  flush,
  pending:() => tasks.size > 0,
  pendingCanvas
 };
})();
