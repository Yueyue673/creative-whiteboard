// Cell attachments are independent content copies; media files remain shared references.
// Row and column identities survive document snapshots without relying on cell text.
function tableAxisIds(n){
 for(const [key,length] of [['rowIds',n.rows.length],['columnIds',n.columns.length]]){
  if(!Array.isArray(n[key]))n[key]=[];
  n[key].length=length;const seen=new Set();
  for(let i=0;i<length;i++){
   const id=n[key][i];
   if(typeof id!=='string'||!id||id.length>100||seen.has(id))n[key][i]=uid();
   seen.add(n[key][i]);
  }
 }
 return n;
}
function cellItemGrid(n){tableAxisIds(n);n.cellItems??=[];while(n.cellItems.length<n.rows.length)n.cellItems.push([]);n.cellItems.length=n.rows.length;for(const row of n.cellItems){while(row.length<n.columns.length)row.push([]);row.length=n.columns.length}return n.cellItems}
function cellContentMarkup(n,r,c){return '<div class="cell-contents">'+(n.cellItems?.[r]?.[c]||[]).map((item,i)=>{const a=assetById(item.mediaId||item.assetId),media=a?.mime?.startsWith('audio/')?'<audio class="inline-ui" controls preload="metadata" src="'+mediaURL(a.id)+'"></audio>':a?.mime?.startsWith('video/')?'<video class="inline-ui" controls preload="metadata" src="'+mediaURL(a.id)+'"></video>':'';const field=(key,label)=>'<textarea data-cell-note-field="'+key+'" aria-label="'+label+'">'+esc(item[key]||'')+'</textarea>';const paper=/^#[\da-f]{6}$/i.test(item.color||'')?item.color:colors[0],surface=typeof contentSurfaceClass==='function'?contentSurfaceClass(item):'';return '<section class="cell-content inline-ui'+(a?' cell-file':'')+(surface?' '+surface:'')+'" style="--cell-paper:'+paper+'" data-cell-item="'+i+'" data-cell-r="'+r+'" data-cell-c="'+c+'">'+field('title','单元格内容标题')+media+imageGallery(item.images||[])+(item.image?imageGallery([{data:item.image}]):'')+(item.type==='table'?'<p>内含表格 · '+(item.rows?.length||0)+' 行；取出到白板后编辑</p>':field('body','单元格内容正文'))+(item.userText?field('userText','单元格内容补充'):'')+(item.annotation?field('annotation','单元格内容备注'):'')+(a&&!media&&!a.mime?.startsWith('image/')?'<a class="inline-ui" href="'+mediaURL(a.id)+'" target="_blank" rel="noopener">打开文件</a>':'')+'</section>'}).join('')+'</div>'}
(()=>{
function tableAt(target){const n=board?.nodes.find(n=>n.id===target.nodeId);return n?.type==='table'&&Number.isInteger(target.r)&&Number.isInteger(target.c)&&n.rows[target.r]?.[target.c]!==undefined?n:null}
function appendItems(nodes,target){const n=tableAt(target);if(!n)return;const items=nodes.filter(x=>x&&x.type!=='frame').map(x=>({...clone(x),id:uid()}));if(!items.length)return toast('请选中便签、表格或文件内容');undoPoint();cellItemGrid(n)[target.r][target.c].push(...items);openEditor(n.id);change();toast('已放入单元格，原内容保留')}
const priorAssets=attachAssets;attachAssets=function(ids,target){if(!tableAt(target))return priorAssets(ids,target);const nodes=[];for(const a of ids.map(assetById).filter(Boolean)){if(a.bundle?.nodes)nodes.push(...a.bundle.nodes);else nodes.push({id:uid(),type:'note',title:a.title,body:a.notes||'',assetId:a.id,mediaId:/^(audio|video)\//.test(a.mime)?a.id:undefined,images:a.mime?.startsWith('image/')?[{assetId:a.id,name:a.title}]:[],tags:a.tags||[],url:a.path,x:0,y:0,w:340,h:240})}appendItems(nodes,target)};
const priorFiles=attachFiles;attachFiles=async function(files,target){if(!tableAt(target))return priorFiles(files,target);try{const added=await uploadFiles([...files]);attachAssets(added.map(a=>a.id),target)}catch(e){toast(e.message)}};
const priorChoose=chooseImages;chooseImages=function(target){$('imageFiles').accept=tableAt(target)?'':'image/png,image/jpeg,image/webp,image/gif';priorChoose(target)};
const priorDrop=attachDrop;attachDrop=async function(e,target){if(!tableAt(target))return priorDrop(e,target);const raw=e.dataTransfer.getData('text/plain');try{const value=JSON.parse(raw);if(value.format==='creative-board-fragment'&&Array.isArray(value.nodes))return appendItems(value.nodes,target)}catch{}if(raw&&!e.dataTransfer.files.length&&!e.dataTransfer.getData('application/x-creative-assets')){const n=tableAt(target);undoPoint();n.rows[target.r][target.c]+=(n.rows[target.r][target.c]?'\n':'')+raw;openEditor(n.id);change();return}return priorDrop(e,target)};
const priorMount=mountTableEditor;
mountTableEditor=function(n){
 priorMount(n);
 const root=$('inlineTable'),live=root.closest('.live-layout'),toolbar=live.querySelector('.inline-toolbar');
 const tools=document.createElement('div');tools.className='cell-tools';tools.hidden=true;
 tools.setAttribute('role','group');tools.setAttribute('aria-label','单元格内容操作');
 tools.innerHTML='<button data-cell-extract title="取出副本到白板" aria-label="取出副本到白板">↗</button><button data-cell-remove title="移除单元格里的内容" aria-label="移除单元格里的内容">×</button>';
 toolbar.insertBefore(tools,$('inlineDone'));
 let target=null;
 const clear=()=>{target?.classList.remove('cell-target');target=null;tools.hidden=true};
 const labelTarget=()=>{
  const title=target.querySelector('[data-cell-note-field=title]')?.value.trim()||'未命名内容';
  for(const b of tools.children){const label=b.hasAttribute('data-cell-extract')?'取出副本到白板':'移除单元格里的内容';b.title=label+'：'+title;b.setAttribute('aria-label',b.title)}
 };
 const choose=el=>{if(target===el)return;clear();target=el;target.classList.add('cell-target');tools.hidden=false;labelTarget()};
 live.addEventListener('pointerdown',e=>{const el=e.target.closest('[data-cell-item]');if(el&&root.contains(el))choose(el);else if(!e.target.closest('.cell-tools'))clear()});
 // Keep the chosen copy while tabbing back to its toolbar actions.
 live.addEventListener('focusin',e=>{const el=e.target.closest('[data-cell-item]');if(el&&root.contains(el))choose(el)});
 root.querySelectorAll('[data-cell-note-field]').forEach(field=>{
  const el=field.closest('[data-cell-item]'),item=n.cellItems[+el.dataset.cellR][+el.dataset.cellC][+el.dataset.cellItem];
  bindContentInput(field,()=>item[field.dataset.cellNoteField]||'',value=>{item[field.dataset.cellNoteField]=value;if(target===el&&field.dataset.cellNoteField==='title')labelTarget();change()});
 });
 tools.querySelectorAll('button').forEach(button=>{button.onclick=()=>{
  if(!target?.isConnected||editorId!==n.id||board.nodes.find(x=>x.id===n.id)!==n)return;
  const items=n.cellItems[+target.dataset.cellR]?.[+target.dataset.cellC],index=+target.dataset.cellItem,item=items?.[index];
  if(!item)return;
  if(button.hasAttribute('data-cell-remove')){undoPoint();items.splice(index,1);openEditor(n.id);change()}
  else{insertBundle({nodes:[clone(item)],edges:[]},{x:n.x+n.w+40,y:n.y});toast('已将副本放到表格右侧')}
 }});
 root.querySelectorAll('[data-cell]').forEach(td=>{td.addEventListener('paste',e=>{
  if(e.target.closest('[data-cell-item]'))return;let data;
  try{data=JSON.parse(e.clipboardData.getData('text/plain'))}catch{return}
  if(data.format!=='creative-board-fragment'||!Array.isArray(data.nodes))return;
  e.preventDefault();e.stopImmediatePropagation();const [r,c]=td.dataset.cell.split(',').map(Number);appendItems(data.nodes,{nodeId:n.id,r,c});
 },true)});
};
const priorMarkdown=tableMarkdown;tableMarkdown=function(n){let result=priorMarkdown(n);for(let r=0;r<n.rows.length;r++)for(let c=0;c<n.columns.length;c++)for(const item of n.cellItems?.[r]?.[c]||[]){const a=assetById(item.mediaId||item.assetId);result+='\n\n第 '+(r+1)+' 行 · '+n.columns[c]+'\n\n'+[item.title,item.body,item.userText,item.annotation].filter(Boolean).join('\n\n')+(a?'\n\n文件：'+a.path:'');}return result};
const css=document.createElement('style');css.textContent='.cell-content{position:relative;margin:8px 0;padding:10px;border:1px solid #dddccf;border-radius:6px;background:#fff8cf;min-width:0}.node .cell-content textarea{background:transparent;border:0;padding:2px 0;min-height:24px!important;width:100%}.cell-content [data-cell-note-field=title]{font-weight:600}.cell-content audio{width:100%;min-width:0}.cell-content p{font-size:12px}.cell-content a{font-size:12px}.read-layout .cell-content audio,.read-layout .cell-content video,.read-layout .cell-content a{pointer-events:auto}.node .edit-scroll,.node .table-scroll{overflow-anchor:none}';document.head.append(css);

// Growing textareas need their outer scroller to follow the caret, not the whole page.
const measure=document.createElement('div');measure.setAttribute('aria-hidden','true');Object.assign(measure.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',whiteSpace:'pre-wrap',overflowWrap:'break-word',pointerEvents:'none'});document.body.append(measure);
function caretBox(field){const style=getComputedStyle(field);for(const key of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','textIndent','textTransform','paddingTop','paddingBottom','paddingLeft','paddingRight','borderTopWidth','borderBottomWidth','borderLeftWidth','borderRightWidth','boxSizing','wordBreak','tabSize'])measure.style[key]=style[key];measure.style.width=field.offsetWidth+'px';measure.textContent=field.value.slice(0,field.selectionEnd??field.value.length);const mark=document.createElement('span');mark.textContent='\u200b';measure.append(mark);const mr=measure.getBoundingClientRect(),cr=mark.getBoundingClientRect(),fr=field.getBoundingClientRect(),sx=fr.width/Math.max(1,field.offsetWidth),sy=fr.height/Math.max(1,field.offsetHeight);return {left:fr.left+(cr.left-mr.left-field.scrollLeft)*sx,top:fr.top+(cr.top-mr.top-field.scrollTop)*sy,height:(parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.5)*sy}}
let followFrame;function followCaret(field){if(!field?.isConnected||field.readOnly||document.activeElement!==field)return;for(let parent=field.parentElement;parent&&parent!==canvas;parent=parent.parentElement){if(!parent.matches('.table-scroll,.edit-scroll,#inlineMeta'))continue;if(parent.scrollHeight<=parent.clientHeight+1&&parent.scrollWidth<=parent.clientWidth+1)continue;const caret=caretBox(field),box=parent.getBoundingClientRect(),scale=box.height/Math.max(1,parent.offsetHeight),margin=8*scale;if(caret.top+caret.height>box.bottom-margin)parent.scrollTop+=(caret.top+caret.height-box.bottom+margin)/scale;else if(caret.top<box.top+margin)parent.scrollTop-=(box.top+margin-caret.top)/scale;if(caret.left>box.right-12)parent.scrollLeft+=(caret.left-box.right+12)/scale;else if(caret.left<box.left+8)parent.scrollLeft-=(box.left+8-caret.left)/scale}}
function queueFollow(e){const field=e.target;if(!field.matches?.('.live-layout textarea'))return;cancelAnimationFrame(followFrame);followFrame=requestAnimationFrame(()=>followCaret(field))}
for(const name of ['input','keyup','click','compositionend'])document.addEventListener(name,queueFollow);document.addEventListener('selectionchange',()=>{const field=document.activeElement;if(field?.matches('.live-layout textarea'))queueFollow({target:field})});
})();
