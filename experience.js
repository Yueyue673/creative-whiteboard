// Shared interaction rules for content on the canvas, in cells and in the library.
(() => {
 'use strict';
 const fileFrame = (a, ratio = 4 / 3) => {
  const titleLines = Math.max(1, Math.ceil((a.title || '').length / 24));
  const header = 62 + (titleLines - 1) * 24;
  const notes = a.notes ? Math.min(180, 24 * Math.ceil(a.notes.length / 24) + 16) : 0;
  if(a.mime?.startsWith('audio/'))return {w:340,h:header + 84 + notes};
  if(a.mime?.startsWith('video/'))return {w:420,h:header + 420 * 9 / 16 + 36 + notes};
  if(a.mime?.startsWith('image/'))return {w:360,h:header + Math.min(560, 318 / Math.max(.15, ratio)) + notes};
  if(documentKind(a))return {w:580,h:440};
  return {w:340,h:Math.max(150,header + 70 + notes)};
 };
 const baseItemBundle = itemBundle;
 itemBundle = function(a){const bundle=baseItemBundle(a);if(a.mime!==bundleMime)Object.assign(bundle.nodes[0],fileFrame(a));return bundle};
 const imageRatios=new Map();
 function imageRatio(a){
  if(!a.mime?.startsWith('image/'))return Promise.resolve(null);
  if(imageRatios.has(a.id))return imageRatios.get(a.id);
  const promise=new Promise(resolve=>{
   const img=new Image(),timer=setTimeout(()=>resolve(4/3),3000);
   const finish=value=>{clearTimeout(timer);resolve(value)};
   img.onload=()=>finish(img.naturalWidth/Math.max(1,img.naturalHeight));img.onerror=()=>finish(4/3);img.src=mediaURL(a.id);
  });imageRatios.set(a.id,promise);return promise;
 }
 placeAssets=async function(ids,p){
  const assets=[...new Set(ids)].map(assetById).filter(a=>a&&!a.archived),items=[];
  for(let i=0;i<assets.length;i+=8){
   const batch=await Promise.all(assets.slice(i,i+8).map(async a=>{
    const bundle=itemBundle(a),ratio=await imageRatio(a);
    if(ratio)Object.assign(bundle.nodes[0],fileFrame(a,ratio));return {asset:a,bundle};
   }));items.push(...batch);
  }
  return commitLibraryBatch(items,p);
 };
 const baseTable=addTableFromMatrix;
 addTableFromMatrix=function(matrix,header){
  const previous=new Set(board?.nodes.map(n=>n.id));baseTable(matrix,header);const n=board?.nodes.find(n=>n.id===editorId&&!previous.has(n.id));
  if(n?.type==='table'){n.h=Math.min(520,Math.max(300,156+n.rows.length*48));drawNodes();change();$('title')?.focus()}
 };
 function fitBlock(id){
  const n=board.nodes.find(n=>n.id===id),el=document.querySelector('.node[data-id="'+CSS.escape(id)+'"]');if(!n||!el)return;
  const area=el.querySelector('.edit-scroll');if(!area)return;
  const table=area.querySelector('.edit-table'),doc=area.querySelector('.inline-document');
  let height;
  if(doc)height=440;
  else if(table)height=Math.max(240,Math.min(1000,table.offsetHeight+100));
  else height=Math.max(120,Math.min(1000,[...area.children].reduce((sum,c)=>sum+c.offsetHeight+parseFloat(getComputedStyle(c).marginTop||0)+parseFloat(getComputedStyle(c).marginBottom||0),0)+48));
  undoPoint();n.h=Math.ceil(height);drawNodes();change();
 }
 function openBlock(id){const n=board.nodes.find(n=>n.id===id);if(!n)return;if(n.assetId)return previewAsset(n.assetId);openEditor(id)}
 function contentMenu(e,id){
  const n=board.nodes.find(n=>n.id===id);if(!n)return;
  if(!selected.has(id)){selected=new Set([id]);refreshSelectionUI()}
  const el=document.querySelector('.node[data-id="'+CSS.escape(id)+'"]'),r=e.currentTarget?.getBoundingClientRect?.()||el.getBoundingClientRect();
  fileMenu({target:el,clientX:r.right-210,clientY:r.bottom+4,preventDefault:()=>e.preventDefault(),stopPropagation:()=>e.stopPropagation()},
   [...(n.assetId?[['打开查看  Enter',()=>openBlock(id)]]:[]),['按内容调整大小',()=>fitBlock(id)],...(n.assetId?[['重新定位原文件…',()=>referenceDialog({replaceId:n.assetId})]]:[])]);
 }
 function mountBlocks(){
  if(!board)return;
  const lookup=new Map(board.nodes.map(n=>[n.id,n]));
  for(const el of $('nodes').children){
   const n=lookup.get(el.dataset.id);if(!n||n.type==='frame')continue;
   el.dataset.fileKind=assetById(n.assetId||n.mediaId)?.mime?.split('/')[0]||'';
   if(!el.querySelector('.block-actions')){
    const actions=document.createElement('div');actions.className='block-actions inline-ui';
    const drag=document.createElement('button');drag.className='block-transfer';drag.draggable=true;drag.textContent='⠿';drag.title='拖到表格、内容库或另一张白板；保留原内容';drag.setAttribute('aria-label','拖动内容副本');
    drag.ondragstart=e=>{
     if(blocked){e.preventDefault();toast('请先处理当前白板的保存冲突');return}if(!selected.has(n.id))selected=new Set([n.id]);const bundle=selectionBundle(),value={format:'creative-board-fragment',version:1,...bundle,source:{boardId,nodeIds:bundle.nodes.map(n=>n.id)}};wfSafe(persist);
     e.dataTransfer.setData('text/plain',JSON.stringify(value));e.dataTransfer.setData('application/x-creative-board-content',JSON.stringify(value));e.dataTransfer.effectAllowed='copy';
     document.body.classList.add('content-transfer');e.stopPropagation();
    };drag.ondragend=()=>document.body.classList.remove('content-transfer');
    const more=document.createElement('button');more.textContent='⋯';more.title='内容操作';more.setAttribute('aria-label','内容操作');more.onclick=e=>contentMenu(e,n.id);actions.append(drag,more);el.append(actions);
   }
   for(const td of el.querySelectorAll('.read-layout [data-cell]')){
    td.ondragover=e=>{if(acceptsContent(e)){e.preventDefault();e.stopPropagation();td.classList.add('drop-target')}};
    td.ondragleave=()=>td.classList.remove('drop-target');
    td.ondrop=e=>{
     if(!acceptsContent(e))return;e.preventDefault();e.stopPropagation();td.classList.remove('drop-target');
     const [r,c]=td.dataset.cell.split(',').map(Number);wfSafe(()=>attachDrop(e,{nodeId:n.id,r,c}));
    };
   }
  }
 }
 function acceptsContent(e){return [...e.dataTransfer.types].some(t=>['application/x-creative-board-content','application/x-creative-assets','Files','text/plain'].includes(t))}
 const originalDraw=drawNodes;drawNodes=function(){originalDraw();mountBlocks()};
 const originalSelect=refreshSelectionUI;refreshSelectionUI=function(){originalSelect();mountBlocks()};
 const originalDrop=canvas.ondrop;
 canvas.ondrop=e=>{
  const raw=e.dataTransfer.getData('application/x-creative-board-content');
  if(!raw)return originalDrop(e);
  const td=e.target.closest('[data-cell]');
  if(td){e.preventDefault();e.stopPropagation();const [r,c]=td.dataset.cell.split(',').map(Number);return wfSafe(()=>attachDrop(e,{nodeId:td.closest('.node').dataset.id,r,c}))}
  if(e.target.closest('#creationDock,#canvasTools'))return;
  e.preventDefault();e.stopPropagation();try{const value=JSON.parse(raw);editorId=null;insertBundle(normalize(value),worldPoint(e.clientX,e.clientY))}catch(err){toast(err.message)}
 };
 // The same drag payload can be stored in any library folder without moving its source.
 $('assetPane').addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('application/x-creative-board-content')){e.preventDefault();e.stopImmediatePropagation();e.dataTransfer.dropEffect='copy'}},true);
 $('assetPane').addEventListener('drop',e=>{
  const raw=e.dataTransfer.getData('application/x-creative-board-content');if(!raw)return;
  e.preventDefault();e.stopImmediatePropagation();const path=e.target.closest('[data-asub],[data-afolder]')?.dataset;
  wfSafe(async()=>{
   const value=JSON.parse(raw),bundle=normalize(value),folder=path?(path.asub??path.afolder):assetFolder;
   if(value.source?.boardId===boardId&&!await persist())return;
   if(!bundle.nodes.length)return;await loadAssets();const next=clone(assetIndex),id=uid();
   next.assets.push({id,title:bundle.nodes.length===1?bundle.nodes[0].title||'未命名内容':'内容组合',path:'',folder,mime:bundleMime,size:0,notes:'',tags:[],bundle,source:value.source||{},updated:Date.now()});
   if(folder&&!next.folders.includes(folder))next.folders.push(folder);
   if(await saveAssets(next)){enterAssetFolder(folder);assetSelected=new Set([id]);renderAssets();toast('已保存到内容库，原内容保留')}
  });
 },true);
 window.addEventListener('keydown',e=>{
  if($('dialog').open||isTyping(e)||e.target.closest('#workspaceSidebar,#fileContext,header')||e.ctrlKey||e.metaKey||e.altKey)return;
  if(selected.size!==1)return;const id=[...selected][0];
  if(e.key==='F2'||e.key==='Enter'&&!editorId){e.preventDefault();e.stopImmediatePropagation();e.key==='F2'?openEditor(id):openBlock(id)}
 },true);
 $('dialog').addEventListener('close',()=>{if(!editorId)canvas.focus({preventScroll:true})});
 async function referenceDialog({replaceId=null,initialPaths='',folder=assetFolder}={}){
  showDialog('<h2>'+(replaceId?'重新定位原文件':'引用本地文件')+'</h2><p class="wf-explain">'+(replaceId?'此文件在所有白板上的引用会一起更新。你的文字、尺寸和连线保留。':'保留文件原位置，不复制。可以从文件资源管理器复制路径后粘贴在这里。')+'</p><label>文件路径<textarea id="referencePaths" rows="3" placeholder="每行一个完整路径">'+esc(initialPaths)+'</textarea></label>'+(replaceId?'':'<label>存放位置<select id="referenceFolder">'+libraryFolderOptions(folder)+'</select></label>')+'<p id="referenceError" role="status"></p>',[['取消',()=>$('dialog').close()],[replaceId?'更新位置':'添加',async()=>{
   try{
    const paths=$('referencePaths').value.split(/\r?\n/).map(p=>p.trim().replace(/^"(.*)"$/,'$1')).filter(Boolean);
    const response=await api('/api/assets/reference',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths,folder:replaceId?'':$('referenceFolder').value,replaceId})});
    const result=await response.json();await loadAssets();$('dialog').close();
    if(replaceId){imageRatios.delete(replaceId);drawNodes();toast('已更新文件位置，内容和连线保留')}
    else await placeAssets(result.assets.map(a=>a.id));
   }catch(err){$('referenceError').textContent=err.message}
  }]]);
 }
 const importClick=$('import').onclick;
 $('import').onclick=e=>{
  const r=$('import').getBoundingClientRect();fileMenu({target:$('import'),clientX:r.left,clientY:r.top-90,preventDefault:()=>e.preventDefault(),stopPropagation:()=>e.stopPropagation()},[
   ['选择文件…',()=>importClick()],['引用本地文件…',()=>referenceDialog()]
  ]);
 };
 // Direct task/reply exchange keeps the existing scope, version and approval checks.
 function parseProposal(raw){
  let text=raw.trim();if(!text.startsWith('{')){const fences=[...text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)];if(fences.length===1)text=fences[0][1];else if(fences.length>1)throw Error('回复中有多段代码，请只粘贴要审核的那份提案。')}
  const proposal=JSON.parse(text);if(proposal.format!=='creative-board-proposal')throw Error('请粘贴 AI 返回的修改提案，而不是原始资料或任务包。');return proposal;
 }
 function composeAI(){
  const key='creative-ai-draft-'+boardId;let draft={};try{draft=JSON.parse(sessionStorage.getItem(key)||'{}')}catch{}
  showDialog('<h2>AI 整理</h2><div class="ai-compose"><label>整理哪些内容<select id="aiTaskScope"><option value="selected">选中的内容（'+selectionBundle().nodes.length+' 块）</option><option value="board">当前整张白板</option><option value="library">库中选中的内容（'+assetSelected.size+' 项）</option></select></label><label>希望怎么整理<textarea id="aiTaskText" rows="3" placeholder="写下你的要求。默认保留原文与备注。">'+esc(draft.text||'')+'</textarea></label><div class="task-presets"><button data-task="只补充便于查找的标签，不改原文。">补充标签</button><button data-task="整理所选内容的位置和间距，让阅读顺序清楚，不改原文。">整理布局</button><button data-task="检查所选内容中重复或关系相近的部分，用标签标注，不删除，不改原文。">检查重复</button></div><details class="ai-options"><summary>保留与修改范围</summary><div class="task-options"><label><input type="checkbox" id="aiKeepWords" checked>保留标题和正文</label><label><input type="checkbox" id="aiKeepNotes" checked>保留补充和备注</label><label><input type="checkbox" id="aiAllowAdd">允许新增</label><label><input type="checkbox" id="aiAllowDelete">允许删除</label></div><p id="aiTaskScopeHint" class="wf-explain"></p></details><div class="ai-task-controls"><button id="aiCopyTask">复制任务给 AI</button><button id="aiHaveReply">粘贴 AI 回复</button></div><section id="aiReplyArea" hidden><label>AI 的修改提案<textarea id="aiReplyText" rows="4" placeholder="粘贴回复中的 JSON；带代码框也可以。"></textarea></label><p id="aiReplyStatus" role="status"></p><button id="aiReadClipboard">从剪贴板读取</button><button id="aiReviewReply">查看修改</button></section><p class="ai-connection-note">使用你自己的 AI。复制任务交给它，回复粘回这里，确认后才会修改内容。</p></div>',[
   ['关闭',()=>$('dialog').close()],['已有提案',()=>wfSafe(wfAIInbox)],['下载任务包',()=>wfSafe(async()=>wfDownloadJSON('AI整理任务.json',await whiteboardAI.makePack()))]
  ]);
  const scope=$('aiTaskScope');scope.querySelector('[value=selected]').disabled=!selected.size;scope.querySelector('[value=library]').disabled=!assetSelected.size;
  scope.value=selected.size?'selected':assetSelected.size?'library':'board';
  const remember=()=>{try{sessionStorage.setItem(key,JSON.stringify({text:$('aiTaskText').value}))}catch{}};
  $('aiTaskText').oninput=remember;
  const hint=()=>{$('aiTaskScopeHint').textContent=scope.value==='board'?'包括整张白板的正文、备注和文件引用。':'只提供所选内容及其内部连线。'};scope.onchange=hint;hint();
  $('dialogBody').querySelectorAll('[data-task]').forEach(b=>b.onclick=()=>{$('aiTaskText').value=b.dataset.task;remember()});
  const reveal=()=>{$('aiReplyArea').hidden=false;$('aiReplyText').focus();$('aiReplyText').scrollIntoView({block:'nearest'})};
  $('aiHaveReply').onclick=reveal;
  $('aiCopyTask').onclick=()=>wfSafe(async()=>{
   const pack=await whiteboardAI.makePack();await navigator.clipboard.writeText(JSON.stringify(pack,null,2));remember();reveal();$('aiReplyStatus').textContent='任务已复制。把它交给 AI，回复粘在这里。';
  });
  $('aiReadClipboard').onclick=async()=>{try{$('aiReplyText').value=await navigator.clipboard.readText()}catch{$('aiReplyStatus').textContent='请直接按 Ctrl+V 粘贴回复。'}};
  $('aiReviewReply').onclick=async()=>{try{const proposal=parseProposal($('aiReplyText').value);await wfImportProposal(proposal)}catch(err){if($('aiReplyStatus'))$('aiReplyStatus').textContent=err.message;else toast(err.message)}};
 }
 $('aiWorkspace').onclick=()=>wfSafe(composeAI);
 const basePaste=pastePayload;
 pastePayload=async function(text,files,anchor){
  if(!files.length&&text){let proposal;try{proposal=parseProposal(text)}catch{}
   if(proposal){await wfImportProposal(proposal);return}
  }return basePaste(text,files,anchor);
 };
 wfHelp=function(){showDialog('<h2>使用白板</h2><div class="experience-help"><h3>写下来，放在一起</h3><p>双击空白处写便签，双击内容编辑。右键拖动画布，Ctrl＋滚轮缩放。新便签默认随内容增高；拖动四角后固定为你的尺寸，右键可恢复自动适应。从选中内容边缘的圆点拉出连线。长内容可点击“展开编辑”，在大空间直接修改，返回后保留白板位置。</p><h3>放进表格，或者继续复用</h3><p>选中内容后，按住内容旁的“拖出副本”，拖到表格单元格、库中文件夹或另一张白板。也可以按 Ctrl＋C / V 复制粘贴。原内容保留，复制的内容可以独立修改；媒体文件仍共用原文件。表格列宽可拖动列名右侧的边界调整。</p><h3>白板和内容库</h3><p>左上角的侧栏图标打开白板、内容库和本页内容。整个窗口共用这一处；分栏时，内容会放进你刚操作的那一栏。更多菜单里的“外观”可以调整主题、界面大小和侧栏宽度。</p><h3>在侧栏里连续整理</h3><p>方向键选择，Enter 打开，F2 编辑，Alt＋上方向键返回上一层。Shift＋方向键连续选择内容，Ctrl＋方向键只移动焦点，空格切换是否选中。Ctrl＋C / X / V 在内容库复制、剪切和粘贴，Ctrl＋Z 撤销，Ctrl＋Shift＋Z 重做。进入文件夹、刷新和关闭预览后，焦点会留在列表。</p><h3>看资料时顺手记录</h3><p>文件内容按 Enter 打开查看，按 F2 编辑说明。Ctrl＋C / V 复制粘贴，Delete 删除内容块，Ctrl＋Z 撤销。删除白板里的内容不会删除硬盘上的原文件。</p><h3>请 AI 帮忙</h3><p>点击顶部 AI，写下要查的问题，提供所选背景。AI 仅查资料或介绍已有参考体系，不能创作文案或修改白板。带来源的回复单独存为参考资料，由你核对原文并决定如何使用。图片可附真实预览，音频不自动转写。</p><h3>下次接着做</h3><p>内容自动保存，标签、分栏、播放器进度和支持的文档阅读位置会恢复。更多菜单中的“恢复与历史”可查看旧记录。</p></div>',[['关闭',()=>$('dialog').close()]])};
 $('help').onclick=wfHelp;whiteboardAI.compose=composeAI;
 window.whiteboardExperience={fileFrame,fitBlock,referenceDialog,composeAI,parseProposal};
 if(board)mountBlocks();
})();
