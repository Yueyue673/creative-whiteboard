// File work belongs to the document and attachment target chosen when it starts.
(() => {
 'use strict';
 const explorer = new URLSearchParams(location.search).get('explorer') === '1';
 const tasks = new Map();
 const fileJobs = new Map();
 const feedback = document.createElement('aside');
 feedback.id = 'importFeedback'; feedback.hidden = true;
 feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
 feedback.setAttribute('aria-atomic', 'true');
 const heading = document.createElement('strong'), detail = document.createElement('span'), dismiss = document.createElement('button');
 dismiss.type = 'button'; dismiss.textContent = '知道了';
 feedback.append(heading, detail, dismiss); document.body.append(feedback);
 let failure = '';
 function updateFeedback() {
  const active = [...tasks.values()].filter(task => task.label), latest = active.at(-1);
  feedback.hidden = !latest && !failure;
  feedback.classList.toggle('import-failed', !!failure);
  heading.textContent = failure ? '有文件尚未添加' : latest?.label || '';
  detail.textContent = failure || (latest?.names ? latest.names + ' · 已接收，请稍候，不必重复拖入。' : '正在处理，请稍候，不必重复拖入。');
  dismiss.hidden = !failure || !!latest;
 }
 dismiss.onclick = () => {failure = ''; updateFeedback();};
 function filesLabel(files, action = '正在导入') {
  const images = files.length && files.every(file => file.type.startsWith('image/'));
  return {label:action + ' ' + files.length + (images ? ' 张图片' : ' 个文件'), names:files.map(file => file.name).join('、')};
 }
 function fileKey(operation, files, destination = '') {
  if (!files.length) return '';
  // Only coalesce a matching in-flight selection at the same destination.
  // Once settled, the author can intentionally insert that file again.
  return JSON.stringify([operation, boardId, destination, files.map(file => [file.name, file.size, file.type, file.lastModified]).sort()]);
 }
 let preparingPlacement = false;
 const pendingCanvas = () => [...tasks.values()].some(task => task.kind === 'canvas');
 const announce = () => {
  updateFeedback();
  window.dispatchEvent(new Event('creative-import-state'));
  if (explorer && parent !== window) parent.postMessage({type:'explorer-import-state'}, location.origin);
 };
 function run(action, kind = 'canvas', info = {}) {
  if (kind === 'canvas' && !explorer && (loading || !board)) {
   notice('白板还在打开，内容尚未添加。请打开后再试。');
   return Promise.resolve(false);
  }
  if (info.key && fileJobs.has(info.key)) {
   notice('这批文件正在导入，不必重复拖入。完成后仍可再次添加。');
   return fileJobs.get(info.key).result;
  }
  if (!tasks.size) failure = '';
  const token = {}, entry = {kind, promise:null, ...info};
  let finish;
  entry.promise = new Promise(resolve => finish = resolve);
  tasks.set(token, entry); announce();
  if (info.key) fileJobs.set(info.key, entry);
  entry.result = (async () => {
   try {
    const result = await action();
    if (result === false && entry.label) failure ||= '本次内容尚未添加，请查看原白板或内容库的提示。';
    return result;
   } catch (error) {
    if (entry.label) failure = (entry.names ? entry.names + '：' : '') + (error.message || '连接失败，请稍后重新拖入。');
    throw error;
   } finally {
    tasks.delete(token); if (info.key) fileJobs.delete(info.key);
    finish(); announce();
   }
  })();
  return entry.result;
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
  return run(async () => {
   const preparation=window.whiteboardImagePreparation?.prepare(snapshot);
   try{const added=await upload(snapshot,folder);preparation?.remember(added);return added}
   finally{preparation?.dispose()}
  }, 'library', snapshot.length ? {...filesLabel(snapshot, '正在上传'), key:fileKey('upload', snapshot, libraryFolderIdentity(folder))} : {});
 };
 const importBefore = importFiles;
 importFiles = function(files, position) {
  const snapshot = [...files], point = position || (!explorer && board ? center() : undefined);
  return run(() => importBefore(snapshot, point), explorer ? 'library' : 'canvas', snapshot.length ? {...filesLabel(snapshot), key:fileKey('import', snapshot)} : {});
 };
 const pasteBefore = pastePayload;
 pastePayload = function(text, files = [], anchor = pasteAnchor()) {
  const snapshot = [...files], point = {...anchor};
  return run(() => pasteBefore(text, snapshot, point), explorer ? 'library' : 'canvas', snapshot.length ? {...filesLabel(snapshot), key:fileKey('paste', snapshot, text)} : {});
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
  return run(() => placeBefore(snapshot, point), explorer ? 'library' : 'canvas', {label:'正在准备并放入白板', names:snapshot.map(id => assetById(id)?.title || '素材').join('、')})
   .finally(() => {if (explorer) preparingPlacement = false;});
 };
 const attachBefore = attachFiles;
 attachFiles = function(files, target) {
  const snapshot = [...files], destination = attachmentTarget(target);
  return run(() => attachBefore(snapshot, destination), 'canvas', {...filesLabel(snapshot), key:fileKey('attach', snapshot, destination._importDestination)});
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
