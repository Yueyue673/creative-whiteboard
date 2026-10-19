// Authored Markdown stays portable text. Tools change only the user's selection.
(() => {
 'use strict';
 const parser=window.markdownit({html:false,linkify:false,typographer:false,breaks:true});
 // Markdown images remain text: source attachments already have a controlled viewer.
 parser.renderer.rules.image=(tokens,i)=>esc(tokens[i].content||'图片');
 // Tables retain their columns on narrow paper; only their own surface scrolls.
 parser.renderer.rules.table_open=(tokens,i,options,env,self)=>{let columns=0;for(let j=i+1;j<tokens.length&&tokens[j].type!=='thead_close';j++)if(tokens[j].type==='th_open')columns++;return '<div class="note-text-scroll note-table-scroll inline-ui" data-note-scroll="table" style="--note-table-columns:'+Math.max(1,columns)+'">'+self.renderToken(tokens,i,options)};
 parser.renderer.rules.table_close=(tokens,i,options,env,self)=>self.renderToken(tokens,i,options)+'</div>\n';
 for(const kind of ['fence','code_block']){const original=parser.renderer.rules[kind];parser.renderer.rules[kind]=(...args)=>original(...args).replace('<pre>','<pre class="note-text-scroll inline-ui" data-note-scroll="code">');}
 const linkOpen=parser.renderer.rules.link_open;
 parser.renderer.rules.link_open=(tokens,i,options,env,self)=>{tokens[i].attrSet('target','_blank');tokens[i].attrSet('rel','noopener noreferrer');return linkOpen?linkOpen(tokens,i,options,env,self):self.renderToken(tokens,i,options)};
 parser.inline.ruler.before('link','whiteboard_link',(state,silent)=>{
  if(state.src.slice(state.pos,state.pos+2)!=='[[')return false;
  const offset=state.src.slice(state.pos+2,Math.min(state.posMax,state.pos+602)).indexOf(']]');if(offset<0)return false;const end=state.pos+2+offset;
  const raw=state.src.slice(state.pos+2,end);if(!raw||raw.includes('\n'))return false;
  if(!silent){const token=state.push('whiteboard_link','',0);token.content=raw}
  state.pos=end+2;return true;
 });
 parser.renderer.rules.whiteboard_link=(tokens,i)=>{const [target,...alias]=tokens[i].content.split('|'),label=alias.join('|')||target;return '<button type="button" class="note-wikilink inline-ui" data-note-link="'+esc(target)+'">'+esc(label)+'</button>'};
 parser.inline.ruler.before('emphasis','whiteboard_highlight',(state,silent)=>{
  if(state.src.slice(state.pos,state.pos+2)!=='==')return false;
  const end=state.src.indexOf('==',state.pos+2);if(end<=state.pos+2)return false;
  if(!silent){const token=state.push('whiteboard_highlight','mark',0);token.content=state.src.slice(state.pos+2,end)}state.pos=end+2;return true;
 });
 parser.renderer.rules.whiteboard_highlight=(tokens,i)=>'<mark>'+esc(tokens[i].content)+'</mark>';
 parser.core.ruler.after('inline','whiteboard_tasks',state=>{for(let i=1;i<state.tokens.length;i++){const token=state.tokens[i];if(token.type!=='inline'||state.tokens[i-1]?.type!=='paragraph_open'||state.tokens[i-2]?.type!=='list_item_open')continue;const first=token.children?.[0],match=first?.type==='text'&&/^\[([ xX])\] /.exec(first.content);if(!match)continue;first.content=first.content.slice(match[0].length);const checkbox=new state.Token('whiteboard_task','span',0);checkbox.content=match[1]!==' '?'true':'false';token.children.unshift(checkbox)}});
 parser.renderer.rules.whiteboard_task=(tokens,i)=>'<span class="note-task" role="checkbox" aria-checked="'+tokens[i].content+'">'+(tokens[i].content==='true'?'☑':'☐')+'</span> ';
 const rendered=text=>parser.render(String(text||''));
 // Keep stable references in the document while editing their readable labels.
 // This is a field projection, never a migration of the author's stored text.
 const referenceFields=new WeakMap();
 function wikiMatches(text){
  const matches=[],pattern=/```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*`+|\\\[\[[^\n]*?\]\]|\[\[([^\n]{1,600}?)\]\]/g;let match;
  while((match=pattern.exec(text)))if(match[1])matches.push({start:match.index,end:pattern.lastIndex,raw:match[0],content:match[1]});return matches;
 }
 function linkMarkup(content){const [target,...alias]=content.split('|');return '<button type="button" class="note-wikilink inline-ui" data-note-link="'+esc(target)+'">'+esc(alias.join('|')||target)+'</button>'}
 function linkedText(text){text=String(text||'');let html='',at=0;for(const token of wikiMatches(text)){html+=esc(text.slice(at,token.start))+linkMarkup(token.content);at=token.end}return(html+esc(text.slice(at))).replace(/\n/g,'<br>')}
 function projectReferences(raw){
  let display='',at=0;const spans=[];for(const token of wikiMatches(raw)){if(!/^@[a-zA-Z0-9_-]+\/[^\]|]+\|/.test(token.content))continue;const label=token.content.slice(token.content.indexOf('|')+1),shown='[['+label+']]';display+=raw.slice(at,token.start);const start=display.length;display+=shown;spans.push({start,end:display.length,rawStart:token.start,rawEnd:token.end});at=token.end}display+=raw.slice(at);return{raw,display,spans};
 }
 const referenceIdentity=p=>JSON.stringify(p?.spans.map(s=>p.raw.slice(s.rawStart,s.rawEnd))||[]);
 function rememberProjection(binding,projection,record=true){
  const previous=binding.current,versions=binding.referenceVersions;
  if(record&&versions&&(referenceIdentity(previous)!==referenceIdentity(projection)||!versions.size&&projection.spans.length))for(const p of [previous,projection])if(p){const rows=versions.get(p.display)||[];if(rows.at(-1)?.raw!==p.raw)rows.push(p);versions.set(p.display,rows)}
  binding.current=projection;binding.cache.delete(projection.display);binding.cache.set(projection.display,projection);let size=0,count=0;for(const [key,value]of [...binding.cache].reverse()){size+=key.length+value.raw.length;if(++count>1&&(size>2*1024*1024||count>64))binding.cache.delete(key)}
 }
 function serializeField(el,value){
  const b=referenceFields.get(el);if(!b)return value;const input=b.before;
  if(input?.type==='historyUndo'||input?.type==='historyRedo'){
   const versions=b.referenceVersions.get(value);let restored;
   if(versions?.length){if(value===input.value){const index=versions.findLastIndex(p=>p.raw===b.current.raw);restored=versions[index+(input.type==='historyUndo'?-1:1)]}else restored=versions.at(-1)}
   if(restored){b.before=null;rememberProjection(b,restored,false);return restored.raw}
  }
  const cached=b.cache.get(value);if(cached){b.current=cached;b.before=null;return cached.raw}
  const p=b.current;let left=0,right=p.display.length,newRight=value.length;
  while(left<right&&left<newRight&&p.display[left]===value[left])left++;while(right>left&&newRight>left&&p.display[right-1]===value[newRight-1]){right--;newRight--}
  const before=b.before;b.before=null;if(before&&before.value===p.display&&!before.type.startsWith('history')){let start=before.start,end=before.end;if(start===end&&before.type==='deleteContentBackward')start=Math.max(0,start-1);if(start===end&&before.type==='deleteContentForward')end=Math.min(p.display.length,end+1);const inserted=value.length-(p.display.length-(end-start));if(inserted>=0&&value.slice(0,start)===p.display.slice(0,start)&&value.slice(start+inserted)===p.display.slice(end)){left=start;right=end;newRight=start+inserted}}
  for(const s of p.spans){if(left>s.start&&left<s.end)left=s.start;if(right>s.start&&right<s.end)right=s.end}newRight=value.length-(p.display.length-right);
  const offset=pos=>{let delta=0;for(const s of p.spans){if(pos<s.end)break;delta+=(s.rawEnd-s.rawStart)-(s.end-s.start)}return pos+delta};
  let inserted=value.slice(left,newRight);const replaced=p.spans.filter(s=>s.start>=left&&s.end<=right),available=new Map();for(const s of replaced){const label=p.display.slice(s.start,s.end);if(!available.has(label))available.set(label,[]);available.get(label).push(p.raw.slice(s.rawStart,s.rawEnd))}
  let restored='',at=0;for(const token of wikiMatches(inserted)){restored+=inserted.slice(at,token.start)+(available.get(token.raw)?.shift()||token.raw);at=token.end}inserted=restored+inserted.slice(at);
  if(replaced.length===1&&left===replaced[0].start&&right===replaced[0].end&&/^\[\[[^\]\n|]+\]\]$/.test(inserted)){const original=p.raw.slice(replaced[0].rawStart,replaced[0].rawEnd);inserted=original.slice(0,original.indexOf('|')+1)+inserted.slice(2,-2)+']]'}
  const raw=p.raw.slice(0,offset(left))+inserted+p.raw.slice(offset(right)),next=projectReferences(raw);if(next.display===value)rememberProjection(b,next);else rememberProjection(b,{raw,display:value,spans:[]});return raw;
 }
 const bindReferenceInput=bindContentInput;
 function bindReferenceField(el,read,write,parse,bind){
  if(!el||el.tagName!=='TEXTAREA'||typeof read()!=='string')return bind(el,read,write,parse);
  const b={read,write,parse,cache:new Map(),referenceVersions:new Map(),current:projectReferences(read()),before:null};referenceFields.set(el,b);rememberProjection(b,b.current);el.value=b.current.display;
  el.addEventListener('beforeinput',event=>{b.before={value:el.value,start:el.selectionStart,end:el.selectionEnd,type:event.inputType||''}});
  bind(el,read,write,value=>parse(serializeField(el,value)));
 }
 bindContentInput=function(el,read,write,parse=value=>value){return bindReferenceField(el,read,write,parse,bindReferenceInput)};
 const bindDraftReference=(el,read,write)=>bindReferenceField(el,read,write,value=>value,(field,get,set,parse)=>{field.oninput=()=>set(parse(field.value))});
 function referenceSlice(el,start,end){
  const b=referenceFields.get(el);if(!b)return el.value.slice(start,end);serializeField(el,el.value);const p=b.current;let result='',at=start;
  for(const s of p.spans){if(s.start<start||s.end>end)continue;result+=el.value.slice(at,s.start)+p.raw.slice(s.rawStart,s.rawEnd);at=s.end}return result+el.value.slice(at,end);
 }
 const referenceClipboardType='application/x-creative-reference-text';
 function copyReference(event){const type=event.type;
  const el=event.target,b=referenceFields.get(el);if(!b||el.selectionStart===el.selectionEnd||!event.clipboardData)return false;const start=el.selectionStart,end=el.selectionEnd,text=el.value.slice(start,end),raw=referenceSlice(el,start,end);if(raw===text)return false;
  const payload={version:1,text,raw},html='<span data-creative-reference-text="'+esc(JSON.stringify(payload))+'">'+esc(text)+'</span>';event.clipboardData.setData('text/plain',text);event.clipboardData.setData('text/html',html);event.clipboardData.setData(referenceClipboardType,JSON.stringify(payload));event.preventDefault();event.stopImmediatePropagation();
  const coordinator=window.whiteboardClipboardCoordinator;if(coordinator?.pending)coordinator.write(null,text,{formats:Promise.resolve({'text/plain':text,'text/html':html})});else coordinator?.markNativeCopy?.();
  if(type==='cut'&&!el.readOnly&&!el.disabled){el.focus({preventScroll:true});document.execCommand('delete',false)}return true;
 }
 // The existing window clipboard handler deliberately stops text copy events.
 // Join its native-text path instead of competing with a later listener.
 if(window.whiteboardLibraryClipboard){const nativeText=whiteboardLibraryClipboard.nativeText;whiteboardLibraryClipboard.nativeText=event=>{if(!copyReference(event))nativeText(event)}}else for(const type of ['copy','cut'])document.addEventListener(type,copyReference,true);
 document.addEventListener('paste',event=>{
  const el=event.target,b=referenceFields.get(el);if(!b||el.readOnly||el.disabled||!event.clipboardData||event.clipboardData.files.length)return;
  let payload;try{let data=event.clipboardData.getData(referenceClipboardType);if(!data){const html=event.clipboardData.getData('text/html');if(html.length>2*1024*1024)return;data=new DOMParser().parseFromString(html,'text/html').querySelector('[data-creative-reference-text]')?.getAttribute('data-creative-reference-text')}payload=JSON.parse(data||'null')}catch{return}
  const normal=text=>text.replace(/\r\n/g,'\n');if(payload?.version!==1||typeof payload.raw!=='string'||payload.raw.length>512*1024||typeof payload.text!=='string'||normal(payload.text)!==normal(event.clipboardData.getData('text/plain'))||projectReferences(payload.raw).display!==payload.text)return;
  const start=el.selectionStart,end=el.selectionEnd,projection=projectReferences(referenceSlice(el,0,start)+payload.raw+referenceSlice(el,end,el.value.length));rememberProjection(b,projection);event.preventDefault();event.stopImmediatePropagation();el.focus({preventScroll:true});if(!document.execCommand('insertText',false,payload.text)){el.setRangeText(payload.text,start,end,'end');el.dispatchEvent(new Event('input',{bubbles:true}))}
 },true);

 const retainReferenceEditor=retainLiveEditor;retainLiveEditor=function(n,el,signature){
  if(n.type==='table'||n.type==='frame'||editorId!==n.id||!selected.has(n.id)||!el?.isConnected)return retainReferenceEditor(n,el,signature);
  const surface=$('immersiveSurface'),root=el.querySelector('.inner')?el:surface?.dataset.id===n.id&&surface.isConnected?surface:el,keys=['title','body','userText','annotation','url','tags'];
  for(const key of keys){const input=root.querySelector('#'+key);if(!input)return;const value=key==='tags'?input.value.split(/[,，\n]/).map(v=>v.trim()).filter(Boolean):serializeField(input,input.value),expected=key==='tags'?(n.tags||[]):(n[key]||'');if(JSON.stringify(value)!==JSON.stringify(expected))return}
  let before,next;try{before=JSON.parse(el.dataset.documentSignature);next=JSON.parse(signature)}catch{return}if(!before||!next)return;
  for(const key of new Set([...Object.keys(before),...Object.keys(next)]))if(!keys.includes(key)&&JSON.stringify(before[key])!==JSON.stringify(next[key]))return;el.dataset.documentSignature=signature;
 };
 function insertReference(n,row,label,start,end){
  const b=referenceFields.get(field),safe=label.replace(/\|/g,'').replace(/\]\]/g,']'),raw='[[@'+row.board+'/'+row.node.id+'|'+safe+']]',shown='[['+safe+']]',value=field.value.slice(0,start)+shown+field.value.slice(end);
  if(b){const next=projectReferences(referenceSlice(field,0,start)+raw+referenceSlice(field,end,field.value.length));rememberProjection(b,next)}
  return setText(n,value,start+shown.length,start+shown.length);
 }
 function noteRecords(document,id){
  const records=[];function visit(nodes,container=null,depth=0){if(depth>16)return;for(const node of nodes||[]){if(!node||node.type==='frame')continue;records.push({board:id,name:document.name,node,...(container?{container}:{} )});for(let r=0;r<(node.cellItems||[]).length;r++)for(let c=0;c<(node.cellItems[r]||[]).length;c++)visit(node.cellItems[r][c],{id:container?.id||node.id,row:r,column:c},depth+1)}}visit(document.nodes);return records;
 }
 function fieldSelector(el){
  if(el.id)return '#'+CSS.escape(el.id);
  const card=el.closest('[data-cell-item]'),prefix=card?'[data-cell-r="'+card.dataset.cellR+'"][data-cell-c="'+card.dataset.cellC+'"][data-cell-item="'+card.dataset.cellItem+'"] ':'';
  if(card&&el.dataset.cellNoteField)return prefix+'textarea[data-cell-note-field="'+CSS.escape(el.dataset.cellNoteField)+'"]';
  const table=el.closest('[data-doc-table]');
  if(card&&table){const cell=el.dataset.docColumn!==undefined?'[data-doc-column="'+el.dataset.docColumn+'"]':el.dataset.docRow!==undefined&&el.dataset.docCol!==undefined?'[data-doc-row="'+el.dataset.docRow+'"][data-doc-col="'+el.dataset.docCol+'"]':null;if(cell)return prefix+'[data-doc-table="'+table.dataset.docTable+'"] textarea'+cell}
  if(el.dataset.row!==undefined&&el.dataset.col!==undefined)return 'textarea[data-row="'+el.dataset.row+'"][data-col="'+el.dataset.col+'"]';if(el.dataset.column!==undefined)return 'textarea[data-column="'+el.dataset.column+'"]';return null;
 }
 function referenceFieldAt(place,root=document){const selector=place?.field?.selector||(place?.field?.id?'#'+CSS.escape(place.field.id):null);return selector?root.querySelector(selector):null}
 function nestedTarget(id){return noteRecords(board,boardId).find(row=>row.node.id===id)}
 function showNestedTarget(row){
  const container=board.nodes.find(n=>n.id===row.container?.id);if(!container)return false;selected=new Set([container.id]);if(canvas.clientWidth<=680)whiteboardReading.open(container.id);else openEditor(container.id);const item=[...document.querySelectorAll('.live-layout [data-cell-item]')].find(el=>container.cellItems?.[+el.dataset.cellR]?.[+el.dataset.cellC]?.[+el.dataset.cellItem]?.id===row.node.id);item?.scrollIntoView({block:'nearest',inline:'nearest'});const input=item?.querySelector('textarea');input?.focus({preventScroll:true});return true;
 }

 // Offer a keyboard stop only when there is content outside this local viewport.
 const scrollSurfaces=new Set(),scrollObserver=new ResizeObserver(scheduleScrollSurfaces);let scrollFrame=0;
 function scheduleScrollSurfaces(){if(!scrollFrame)scrollFrame=requestAnimationFrame(syncScrollSurfaces)}
 function syncScrollSurfaces(){
  scrollFrame=0;for(const el of scrollSurfaces)if(!el.isConnected){scrollObserver.unobserve(el);scrollSurfaces.delete(el)}
  for(const el of document.querySelectorAll('#nodes .note-text-scroll,#dialog .note-text-scroll,.source-from-canvas .note-text-scroll')){
   if(!scrollSurfaces.has(el)){scrollSurfaces.add(el);scrollObserver.observe(el)}
   const overflow=el.clientWidth>0&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1);
   el.classList.toggle('note-text-overflow',overflow);
   if(overflow){el.tabIndex=0;el.setAttribute('role','region');el.setAttribute('aria-label',el.dataset.noteScroll==='table'?'表格，左右滚动浏览':'代码，滚动浏览')}
   else for(const key of ['tabindex','role','aria-label'])el.removeAttribute(key);
  }
 }
 const scrollMutations=new MutationObserver(scheduleScrollSurfaces);
 for(const host of [document.getElementById('nodes'),document.getElementById('dialog')])scrollMutations.observe(host,{childList:true,subtree:true});
 window.addEventListener('resize',scheduleScrollSurfaces);scheduleScrollSurfaces();
 // Readable table/code navigation must never nudge, delete or duplicate a card.
 window.addEventListener('keydown',e=>{
  const el=e.target.closest?.('.note-text-scroll');if(!el||e.isComposing||e.key==='Escape'||e.key==='Tab')return;
  const mod=e.ctrlKey||e.metaKey;if(mod&&['k','K','\\'].includes(e.key))return;
  e.stopImmediatePropagation();if(e.target!==el||mod||e.altKey)return;
  if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();el.scrollLeft=e.key==='Home'?0:e.key==='End'?el.scrollWidth:el.scrollLeft+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?160:40)}
 },true);
 const selectedScrollSurface=()=>{const selection=getSelection();if(!selection||selection.isCollapsed)return null;const host=node=>(node?.nodeType===1?node:node?.parentElement)?.closest('.note-text-scroll');const el=host(selection.anchorNode);return el&&el===host(selection.focusNode)?el:null};
 for(const type of ['copy','cut','paste'])window.addEventListener(type,e=>{if(e.target.closest?.('.note-text-scroll')||type==='copy'&&selectedScrollSurface())e.stopImmediatePropagation()},true);
 // HTML consumes the first LF immediately after a textarea start tag.
 // A synthetic LF leaves every authored leading blank line visible and editable.
 const preserveTextareaLines=html=>html.replace(/<textarea\b[^>]*>/g,tag=>tag.includes(' data-note-newline="1"')?tag:tag.slice(0,-1)+' data-note-newline="1">\n');
 const originalInlineMarkup=inlineMarkup;inlineMarkup=function(n){return preserveTextareaLines(originalInlineMarkup(n))};
 const originalTableLayout=tableLayout;tableLayout=function(n){const html=originalTableLayout(n).replace(/<input\b([^>]*\bdata-column="(\d+)"[^>]*)>/g,(_,attrs,column)=>'<textarea rows="1"'+attrs.replace(/\svalue="[^"]*"/,'')+'>'+esc(n.columns[Number(column)]||'')+'</textarea>');return preserveTextareaLines(html)};
 const originalMarkup=noteMarkup;
 noteMarkup=function(n,readOnly=false){
  let html=originalMarkup(n);
  if(readOnly){const begin=html.indexOf('<div class="inner'),end=html.indexOf('<span class="port');html=html.slice(0,begin)+'<div class="inner editing read-layout">'+readableLayout(n)+'</div>'+html.slice(end)}
  if(n.type==='note'&&!n.assetId&&!n.mediaId&&!n.images?.length)html=html.replace('class="node ','class="node paper-card paper-'+(['lined','grid'].includes(n.paperStyle)?n.paperStyle:'plain')+' ');
  if(n.textFormat==='markdown'&&(readOnly||!(editorId===n.id&&selected.has(n.id)))){
   for(const key of ['body','userText','annotation'])html=html.replace(new RegExp('<textarea\\b[^>]*data-preview-id="'+key+'"[^>]*>[\\s\\S]*?</textarea>'),'<div class="note-markdown" data-markdown-field="'+key+'">'+rendered(n[key])+'</div>');
  }
  if(readOnly||!(editorId===n.id&&selected.has(n.id)))html=html.replace(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g,(markup,attrs,text)=>{const decoder=document.createElement('textarea');decoder.innerHTML=text;const value=decoder.value;if(!wikiMatches(value).length)return markup;const safe=attrs.replace(/\s(?:readonly|tabindex="[^"]*")/g,'');return '<div class="note-markdown note-cell-text"'+safe+'>'+linkedText(value)+'</div>'});
  return html;
 };
 let panel=null,owner=null,field=null,range=null,preview=false,colourCheckpoint=null;
 // Reference browsing keeps ephemeral author positions, never a content copy to apply.
 const referenceTrail=[];let referenceEpoch=0,referenceReturning=false,referenceBar=null;
 function captureReferencePlace(id){
  const n=board?.nodes.find(node=>node.id===id);if(!n||n.type==='frame'||loading||blocked)return null;
  const expanded=$('dialog').open&&$('dialog').classList.contains('immersive-dialog')&&$('immersiveSurface')?.dataset.id===id,root=expanded?$('immersiveSurface'):[...$('nodes').children].find(el=>el.dataset.id===id);
  const focused=document.activeElement,source=focused?.matches('textarea,input[type=text],input:not([type])')&&root?.contains(focused)?focused:field?.isConnected&&root?.contains(field)?field:null,area=root?.querySelector('.edit-scroll'),details=root?.querySelector('#inlineMeta');
  const viewport=window.whiteboardPane?.viewport?.()||{width:canvas.clientWidth,height:canvas.clientHeight};
  return {board:boardId,id,name:noteLabel(n),view:{x:view().x,y:view().y,z:view().z},selected:[...selected],mode:editorId===id?(root?.id==='immersiveSurface'?'expanded':'canvas'):'read',preview:editorId===id&&preview,width:viewport.width,height:viewport.height,
   field:source?{id:source.id,selector:fieldSelector(source),value:source.value.length<=512*1024?source.value:null,start:source.selectionStart,end:source.selectionEnd,direction:source.selectionDirection,top:source.scrollTop,left:source.scrollLeft}:null,scroll:area?.scrollTop||0,details:!!details?.open,detailsScroll:details?.scrollTop||0};
 }
 function syncReferenceReturn(){
  const place=referenceTrail.at(-1);
  if(!place&&!referenceBar)return;
  if(!referenceBar){
   referenceBar=document.createElement('div');referenceBar.id='noteReferenceReturn';referenceBar.className='note-reference-return inline-ui';
   referenceBar.innerHTML='<button type="button" id="noteReferenceBack"><span aria-hidden="true">↶</span><span><small>返回刚才</small><b></b></span></button><button type="button" id="noteReferenceDismiss" aria-label="结束这次关联浏览">×</button>';canvas.append(referenceBar);
   referenceBar.querySelector('#noteReferenceBack').onclick=returnReference;
   referenceBar.querySelector('#noteReferenceDismiss').onclick=()=>{referenceEpoch++;referenceTrail.length=0;syncReferenceReturn();canvas.focus({preventScroll:true});};
   for(const name of ['pointerdown','click'])referenceBar.addEventListener(name,event=>event.stopPropagation());
  }
  const dialog=document.getElementById('dialog'),heading=dialog?.open&&dialog.classList.contains('immersive-dialog')?dialog.querySelector('.immersive-heading'):null,host=heading||canvas;
  if(referenceBar.parentElement!==host)host.append(referenceBar);referenceBar.classList.toggle('reference-in-editor',Boolean(heading));
  referenceBar.hidden=!place||place.destination!==boardId||loading||blocked;
  const button=referenceBar.querySelector('#noteReferenceBack');button.disabled=referenceReturning;referenceBar.querySelector('#noteReferenceDismiss').disabled=referenceReturning;
  if(place){button.querySelector('b').textContent=place.name;button.title='返回刚才的便签：'+place.name;button.setAttribute('aria-label','返回刚才的便签：'+place.name);}
 }
 async function closeReferenceEditor(){
  const dialog=document.getElementById('dialog');
  if(dialog?.open){
   if(!dialog.classList.contains('immersive-dialog'))throw Error('请先关闭当前窗口，再查看关联便签。');
   await new Promise(resolve=>{dialog.addEventListener('close',resolve,{once:true});dialog.close();});
  }
  if(window.whiteboardPane?.canvasReady&&!await whiteboardPane.canvasReady())throw Error('页面还在调整，请再试一次。');
 }
 async function returnReference(){
  const place=referenceTrail.at(-1);if(!place||referenceReturning||loading||blocked||place.destination!==boardId)return;
  const epoch=++referenceEpoch;referenceReturning=true;syncReferenceReturn();
  try{
   closePanel();
   if(place.external){const result=await place.back(()=>epoch===referenceEpoch&&referenceTrail.at(-1)===place&&!loading&&!blocked);if(result===true)referenceTrail.pop();else if(result!=='cancelled')toast('原写作页面已关闭或改变，请从白板列表重新打开。');syncReferenceReturn();return;}
   await closeReferenceEditor();if(epoch!==referenceEpoch)return;

   if(place.board!==boardId){await switchBoard(place.board);if(epoch!==referenceEpoch||boardId!==place.board)return;}
   if(loading||blocked)return;
   const n=board.nodes.find(node=>node.id===place.id);
   if(!n||n.type==='frame'){referenceTrail.pop();syncReferenceReturn();toast('原便签已经移走、删除或改变类型，未还原旧内容。');return;}
   editorId=null;selected=new Set(place.selected.filter(id=>board.nodes.some(node=>node.id===id)));Object.assign(board.view,place.view);
   if(place.width!==canvas.clientWidth||place.height!==canvas.clientHeight){const z=Math.min(place.view.z,Math.max(.03,Math.min((canvas.clientWidth-40)/n.w,(canvas.clientHeight-140)/n.h)));Object.assign(board.view,{z,x:(canvas.clientWidth-n.w*z)/2-n.x*z,y:(canvas.clientHeight-n.h*z)/2-n.y*z});}
   drawNodes();renderOutline();moveView();
   if(place.mode==='expanded')whiteboardReading.open(n.id);else if(place.mode==='canvas')openEditor(n.id);
   const root=document.getElementById('immersiveSurface')?.dataset.id===n.id?document.getElementById('immersiveSurface'):[...$('nodes').children].find(el=>el.dataset.id===n.id),area=root?.querySelector('.edit-scroll'),details=root?.querySelector('#inlineMeta');
   if(details){details.open=place.details;details.scrollTop=place.detailsScroll;}
   if(place.preview&&editorId===n.id&&root?.querySelector('#notePreview'))togglePreview(root.querySelector('#notePreview'),n,root.querySelector('.inner'));
   if(area)area.scrollTop=place.scroll;
   const input=root&&referenceFieldAt(place,root);
   if(input&&place.field.value!==null&&input.value===place.field.value){
    input.setSelectionRange(place.field.start,place.field.end,place.field.direction);input.scrollTop=place.field.top;input.scrollLeft=place.field.left;
    if(!input.hidden&&(!details?.contains(input)||place.details)){input.focus({preventScroll:true});remember(input);}else root.querySelector('#notePreview')?.focus({preventScroll:true});
   }else if(place.mode==='read')canvas.focus({preventScroll:true});
   else{(root?.querySelector('#notePreview')||root?.querySelector('#body')||canvas).focus({preventScroll:true});if(place.field)toast('已回到当前原文；内容已有变化，未套用旧的光标位置。');}
   referenceTrail.pop();syncReferenceReturn();
  }catch(error){toast('暂时无法返回：'+error.message);}
  finally{referenceReturning=false;syncReferenceReturn();}
 }
 const paperChoices=[['plain','素面'],['lined','横线'],['grid','方格']];
 const swatches=[['#fff0aa','奶油黄'],['#f5dccb','杏桃'],['#eadcf2','淡紫'],['#cde8fb','雾蓝'],['#dbecc7','草绿'],['#e7e2da','暖灰'],['#ffffff','工作台灰']];
 function closePanel(){panel?.remove();panel=null;owner=null;colourCheckpoint=null}
 function positionPanel(trigger){const rect=trigger.getBoundingClientRect(),w=Math.min(360,innerWidth-24);panel.style.width=w+'px';panel.style.left=Math.max(12,Math.min(innerWidth-w-12,rect.left))+'px';panel.style.top='12px';const h=panel.offsetHeight;panel.style.top=Math.max(12,Math.min(innerHeight-h-12,rect.bottom+8))+'px'}
 function popup(trigger,n,kind){
  if(owner===trigger){closePanel();return null}closePanel();owner=trigger;
  panel=document.createElement('section');panel.id='noteTools';panel.className='note-tools inline-ui';panel.setAttribute('popover','manual');panel.setAttribute('aria-label',kind==='colour'?'便签外观':'文字格式');
  (trigger.closest('dialog')||document.body).append(panel);return panel;
 }
 function show(trigger){panel.showPopover();positionPanel(trigger)}
 function checkpoint(){undoPoint();return history.at(-1)}
 function updateSurface(n){
  for(const el of document.querySelectorAll('.node[data-id]'))if(el.dataset.id===n.id){
   el.style.background=n.color;const paper=paperSurface(n);el.classList.toggle('theme-surface',contentSurfaceClass(n)==='theme-surface');el.classList.toggle('theme-dark',!!paper?.dark);
   for(const [key,value]of [['--paper-ink',paper?.ink],['--paper-caption',paper?.caption]])value?el.style.setProperty(key,value):el.style.removeProperty(key);
   for(const style of ['plain','lined','grid'])el.classList.toggle('paper-'+style,(n.paperStyle||'plain')===style);
   for(const preview of el.querySelectorAll('.note-editor-preview')){const source=preview.previousElementSibling;if(source?.matches('textarea'))preview.style.color=getComputedStyle(source).color;}
  }
  change();
 }
 function openColour(trigger,n){const box=popup(trigger,n,'colour');if(!box)return;
  const source=board,sourceId=boardId,active=()=>panel===box&&board===source&&boardId===sourceId&&board.nodes.includes(n)&&!loading&&!blocked;
  box.innerHTML='<header><b>便签外观</b><button type="button" aria-label="关闭便签外观">×</button></header><div class="note-colours">'+swatches.map(([value,name])=>'<button type="button" data-colour="'+value+'" aria-label="'+name+'" title="'+name+'" style="--swatch:'+value+'" aria-pressed="'+(n.color===value)+'"></button>').join('')+'</div><label class="note-custom-colour">自定义颜色<input type="color" aria-label="自定义便签颜色" value="'+esc(/^#[0-9a-f]{6}$/i.test(n.color||'')?n.color:'#fff0aa')+'"><input type="text" aria-label="便签颜色值" maxlength="7" value="'+esc(n.color||'#fff0aa')+'"></label><div class="note-paper-choices">'+paperChoices.map(([value,label])=>'<button type="button" data-paper="'+value+'" aria-pressed="'+((n.paperStyle||'plain')===value)+'">'+label+'</button>').join('')+'</div>';
  box.querySelector('header button').onclick=closePanel;
  const colour=box.querySelector('input[type=color]'),hex=box.querySelector('input[type=text]');
  const refresh=()=>{colour.value=hex.value=n.color;box.querySelectorAll('[data-colour]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.colour===n.color)));box.querySelectorAll('[data-paper]').forEach(b=>b.setAttribute('aria-pressed',String((n.paperStyle||'plain')===b.dataset.paper)));trigger.style.setProperty('--swatch',n.color)};
  const choose=value=>{if(n.color===value)return;n.color=value;updateSurface(n);refresh()};
  box.querySelectorAll('[data-colour]').forEach(b=>b.onclick=()=>{if(!active()||n.color===b.dataset.colour)return;checkpoint();colourCheckpoint=null;choose(b.dataset.colour)});
  colour.oninput=()=>{if(!active()||n.color===colour.value)return;if(!colourCheckpoint||history.at(-1)!==colourCheckpoint)colourCheckpoint=checkpoint();choose(colour.value)};colour.onchange=()=>colourCheckpoint=null;
  hex.onchange=()=>{if(!active())return;if(!/^#[0-9a-f]{6}$/i.test(hex.value)){hex.setCustomValidity('请填写完整颜色，例如 #fff0aa');hex.reportValidity();return}hex.setCustomValidity('');if(n.color!==hex.value){checkpoint();choose(hex.value)}};hex.oninput=()=>hex.setCustomValidity('');
  box.querySelectorAll('[data-paper]').forEach(b=>b.onclick=()=>{if(!active()||(n.paperStyle||'plain')===b.dataset.paper)return;checkpoint();n.paperStyle=b.dataset.paper;updateSurface(n);refresh()});show(trigger);
 }
 function remember(el){if(el?.matches('textarea')&&(referenceFields.has(el)||['body','userText','annotation'].includes(el.id))){field=el;range={start:el.selectionStart,end:el.selectionEnd}}}
 function ownsField(n){return !loading&&!blocked&&field?.isConnected&&editorId===n?.id&&board?.nodes.includes(n)&&field.closest('.node')?.dataset.id===n.id&&(!document.getElementById('dialog').open||Boolean(field.closest('#dialog.immersive-dialog')))}
 function setText(n,value,start,end){if(!ownsField(n))return false;checkpoint();if(n.type!=='table')n.textFormat='markdown';const binding=referenceFields.get(field),raw=serializeField(field,value);if(binding)binding.write(binding.parse(raw));else n[field.id]=raw;field.value=value;const meta=field.closest('details');if(meta)meta.open=true;field.focus({preventScroll:true});field.setSelectionRange(start,end);range={start,end};field.dispatchEvent(new Event('input',{bubbles:true}));drawEdges();renderOutline();change();return true;}
 function format(n,kind){
  if(!ownsField(n))return false;const text=field.value,{start,end}=range||{start:field.selectionStart,end:field.selectionEnd};
  const pairs={bold:'**',italic:'*',strike:'~~',highlight:'==',code:'`'};
  if(pairs[kind]){const mark=pairs[kind],selectedText=text.slice(start,end),outer=text.slice(Math.max(0,start-mark.length),start)===mark&&text.slice(end,end+mark.length)===mark&&(kind!=='italic'||(text[start-2]!=='*'&&text[end+1]!=='*'));
   if(outer)return setText(n,text.slice(0,start-mark.length)+selectedText+text.slice(end+mark.length),start-mark.length,end-mark.length);
   return setText(n,text.slice(0,start)+mark+selectedText+mark+text.slice(end),start+mark.length,end+mark.length);
  }
  const prefixes={heading:'# ',quote:'> ',bullet:'- ',number:'1. ',task:'- [ ] '};
  if(prefixes[kind]){const left=start?text.lastIndexOf('\n',start-1)+1:0,last=end>start&&text[end-1]==='\n'?end-1:end,right=text.indexOf('\n',last),stop=right<0?text.length:right,prefix=prefixes[kind],lines=text.slice(left,stop).split('\n');const remove=lines.every(line=>line.startsWith(prefix)),changed=lines.map(line=>remove?line.slice(prefix.length):prefix+line).join('\n');return setText(n,text.slice(0,left)+changed+text.slice(stop),left,left+changed.length)}
  if(kind==='fence'){const selectedText=text.slice(start,end),begin=(start&&text[start-1]!=='\n'?'\n':'')+'```\n',after='\n```'+(end<text.length&&text[end]!=='\n'?'\n':'');return setText(n,text.slice(0,start)+begin+selectedText+after+text.slice(end),start+begin.length,end+begin.length)}
 }
 function openFormat(trigger,n){const box=popup(trigger,n,'format');if(!box)return;
  const source=board,sourceId=boardId,active=()=>panel===box&&board===source&&boardId===sourceId&&ownsField(n);
  if(!field?.isConnected){field=document.getElementById('body');remember(field)}
  box.innerHTML='<header><b>文字格式</b><button type="button" aria-label="关闭文字格式">×</button></header><div class="note-format-grid">'+[['bold','粗体','B'],['italic','斜体','I'],['strike','删除线','S'],['highlight','高亮','标记'],['code','行内代码','代码'],['heading','标题','H1'],['quote','引用','引用'],['bullet','无序列表','• 列表'],['number','有序列表','1. 列表'],['task','任务列表','☐ 任务'],['fence','代码块','代码块']].map(([id,label,text])=>'<button type="button" data-format="'+id+'" aria-label="'+label+'" title="'+label+'">'+text+'</button>').join('')+'</div><label class="note-external-link">外部链接<input type="url" aria-label="外部链接网址" placeholder="https://"><button type="button" data-insert-link>插入链接</button></label><label class="note-mode"><input type="checkbox" '+(n.textFormat==='markdown'?'checked':'')+'>按 Markdown 显示</label><p>选中文字后应用；Ctrl+B 粗体，Ctrl+I 斜体。原文保存在便签里。</p>';
  box.querySelector('header button').onclick=()=>{if(active())closePanel()};box.querySelectorAll('[data-format]').forEach(b=>{b.onpointerdown=e=>e.preventDefault();b.onclick=()=>{if(active()&&format(n,b.dataset.format))box.querySelector('input[type=checkbox]').checked=true}});
  box.querySelector('[data-insert-link]').onclick=()=>{if(!active()||!ownsField(n))return;const input=box.querySelector('input[type=url]'),url=input.value.trim();if(!/^(https?:\/\/|mailto:)/i.test(url)||!parser.validateLink(url)){input.setCustomValidity('请填写 http、https 或 mailto 链接');input.reportValidity();return}input.setCustomValidity('');const {start,end}=range||{start:field.selectionStart,end:field.selectionEnd},label=field.value.slice(start,end)||url,link='['+label.replace(/[\\[\]]/g,'\\$&')+'](<'+url.replace(/[<>\s]/g,c=>encodeURIComponent(c))+'>)';if(setText(n,field.value.slice(0,start)+link+field.value.slice(end),start+link.length,start+link.length))box.querySelector('input[type=checkbox]').checked=true};
  box.querySelector('input[type=url]').oninput=e=>e.target.setCustomValidity('');box.querySelector('input[type=checkbox]').onchange=e=>{if(!active())return;checkpoint();n.textFormat=e.target.checked?'markdown':'plain';change()};show(trigger);
 }
 function togglePreview(trigger,n,root){
  preview=!preview;trigger.setAttribute('aria-pressed',String(preview));trigger.textContent=preview?'继续编辑':'预览';
  root.querySelectorAll('textarea#body,textarea#userText,textarea#annotation').forEach(el=>{el.hidden=preview;let view=el.nextElementSibling;if(!view?.classList.contains('note-editor-preview')){view=document.createElement('div');view.className='note-markdown note-editor-preview';el.after(view)}view.hidden=!preview;view.style.color=getComputedStyle(el).color;view.innerHTML=n.textFormat==='markdown'?rendered(serializeField(el,el.value)):'<p>'+linkedText(serializeField(el,el.value))+'</p>'});if(!preview)growContentFields(root);window.whiteboardSizing?.invalidate(root);
 }
 function references(n){const refs=[];for(const key of ['body','userText','annotation'])for(const token of wikiMatches(String(n[key]||'')))refs.push(token.content.split('|')[0]);if(n.type==='table'){for(const text of [...(n.columns||[]),...(n.rows||[]).flat()])for(const token of wikiMatches(String(text||'')))refs.push(token.content.split('|')[0])}return refs}
 function resolveReference(value,records,sourceBoard=boardId){
  const explicit=/^@([a-zA-Z0-9_-]+)\/([^\]|]+)$/.exec(value);
  if(explicit)return records.find(row=>row.board===explicit[1]&&row.node.id===explicit[2]);
  const local=records.filter(row=>!row.unavailable&&row.board===sourceBoard&&(row.node.id===value||row.node.title===value));if(local.length===1)return local[0];
  if(local.length)return null;const global=records.filter(row=>!row.unavailable&&row.node.title===value);return global.length===1?global[0]:null;
 }
 async function allNotes(){
  const response=await api('/api/boards'),list=await response.json(),records=noteRecords(board,boardId);
  let incomplete=false;
  // Read a bounded batch at a time; these are explicit reference browsing requests.
  for(let start=0;start<list.length;start+=4)await Promise.all(list.slice(start,start+4).filter(b=>b.id!==boardId).map(async b=>{try{const data=await(await api('/api/boards/'+encodeURIComponent(b.id))).json();records.push(...noteRecords(data,b.id))}catch{incomplete=true}}));
  return {records,incomplete};
 }

 // Experimental comparison keeps the author field mounted throughout source visits.
 let sourcePeek=null;
 function closeSourcePeek(focus=true){
  const session=sourcePeek;if(!session)return;sourcePeek=null;session.epoch++;session.root.removeEventListener('focusin',session.rememberFocus);
  for(const type of ['input','select','pointerdown','keydown'])session.root.removeEventListener(type,session.authorActivity,true);
  for(const view of session.views.values())pauseSource(view.paper);whiteboardMedia.close();session.aside.remove();session.host.classList.remove('note-comparing','source-reading-full','source-focused','source-comparing-canvas');session.root.inert=false;session.root.removeAttribute('aria-hidden');
  if(session.returnAction){session.returnAction.removeEventListener('click',session.returnClick,true);session.returnAction.innerHTML=session.returnMarkup}const title=session.host.querySelector('.immersive-heading>span');if(title)title.textContent=session.heading;
  session.host.querySelector('#immersiveDetails')?.removeAttribute('hidden');
  if(focus&&session.root.isConnected&&board===session.source&&boardId===session.board&&editorId===session.author.id){
   const input=session.input;if(input?.isConnected){const hiddenDetails=input.closest('details:not([open])'),target=input.hidden?session.root.querySelector('#notePreview'):hiddenDetails?hiddenDetails.querySelector('summary'):input;if(target){if(session.mode==='canvas'&&window.whiteboardNavigation?.focusPreservingView)whiteboardNavigation.focusPreservingView(target);else target.focus({preventScroll:true})}remember(input)}
  }
 }
 function ownsSourcePeek(session){return session===sourcePeek&&board===session.source&&boardId===session.board&&!loading&&!blocked&&board.nodes.includes(session.author)&&editorId===session.author.id&&session.root.isConnected&&(!session.originAssetId||session.author.libraryOrigin?.id===session.originAssetId&&session.author.libraryOrigin?.nodeId===session.originNodeId)&&(!session.input||session.input.isConnected)&&(session.mode==='expanded'?$('dialog').open:!$('dialog').open)}
 function layoutSourcePeek(){
  const session=sourcePeek;if(!session)return;if(!ownsSourcePeek(session)){closeSourcePeek(false);return}
  let covering=false;if(session.mode==='canvas'){const rect=session.root.getBoundingClientRect(),left=Math.max(0,rect.left-16),right=Math.max(0,innerWidth-rect.right-16),space=Math.max(left,right);covering=innerWidth<=820||session.full||space<340;session.aside.style.width=covering?'100%':Math.min(680,space,innerWidth*.46)+'px';session.aside.style.left=!covering&&left>right?'0':'auto';session.aside.style.right=!covering&&left>right?'auto':'0'}
  const narrow=innerWidth<=820||!!session.full||covering;session.host.classList.toggle('source-focused',narrow);session.aside.classList.toggle('source-reading-full',!!session.full);if(session.returnAction){const markup=narrow?'返回记录 <small>Esc</small>':session.returnMarkup;if(session.returnAction.innerHTML!==markup)session.returnAction.innerHTML=markup}session.root.inert=narrow;session.root.setAttribute('aria-hidden',String(narrow));
  const title=session.host.querySelector('.immersive-heading>span');if(title)title.textContent=narrow?((session.row?.kind||session.originKind)==='library'?'查看原件':'查看资料'):session.heading;
  session.host.querySelector('#immersiveDetails')?.toggleAttribute('hidden',narrow);
  if(narrow&&session.root.contains(document.activeElement))session.aside.querySelector('.source-peek-return').focus({preventScroll:true});
  if(session.row?.board===boardId){const node=nestedTarget(session.row.node.id)?.node;if(node!==session.row.node||JSON.stringify(node)!==session.signature)session.render(node?{...session.row,node}:null)}
 }
 function canCompare(row){return row&&['note','image','table'].includes(row.node.type)}
 function sourceAssetIds(node,ids=new Set()){for(const id of [node.assetId,node.mediaId])if(id)ids.add(id);for(const image of node.images||[])if(image.assetId)ids.add(image.assetId);for(const row of node.cellImages||[])for(const images of row||[])for(const image of images||[])if(image.assetId)ids.add(image.assetId);for(const row of node.cellItems||[])for(const items of row||[])for(const item of items||[])sourceAssetIds(item,ids);return [...ids]}
 function pauseSource(root){for(const el of root.querySelectorAll('audio,video')){el.pause();el._captureReading?.()}for(const el of root.querySelectorAll('.json-reader'))el._captureReading?.()}
 function sourceContext(el){const session=sourcePeek;if(!session||!ownsSourcePeek(session))return null;const root=el?.closest?.('.note-source-card');if(!root||!session.aside.contains(root))return null;const view=[...session.views.values()].find(view=>view.paper===root);return view?{board:view.row.board,node:view.row.node,readOnly:true,...(view.row.kind==='library'?{library:{id:view.row.assetId,nodeId:view.row.node.id}}:{})}:null}
 function peekReference(row,place,records){
  const author=board.nodes.find(node=>node.id===editorId),expanded=place?.mode==='expanded',root=expanded?$('immersiveSurface'):[...$('nodes').children].find(el=>el.dataset.id===author?.id);
  if(!canCompare(row)||!['expanded','canvas'].includes(place?.mode)||!root||root.dataset.id!==author?.id||(row.board===boardId&&row.node===author)||expanded!==$('dialog').open)return false;
  closeSourcePeek(false);closePanel();const host=expanded?$('dialogBody'):document.body,aside=document.createElement('aside');aside.className='note-source-peek inline-ui'+(expanded?'':' source-from-canvas');aside.setAttribute('aria-label','对照资料');
  const heading=host.querySelector('.immersive-heading>span'),input=referenceFieldAt(place,root)||root.querySelector('#body');
  const returnAction=expanded?host.querySelector('#immersiveReturn'):null,session={aside,host,root,author,mode:place.mode,source:board,board:boardId,input,returnAction,returnMarkup:returnAction?.innerHTML,heading:heading?.textContent||'展开编辑',epoch:0,trail:[],positions:new Map(),views:new Map(),originKind:row.kind,originAssetId:row.kind==='library'?row.assetId:null,originNodeId:row.originNodeId,rows:relatedRows(author,records).filter(canCompare)};sourcePeek=session;session.returnClick=event=>{if(innerWidth<=820||session.full){event.preventDefault();event.stopImmediatePropagation();closeSourcePeek()}};returnAction?.addEventListener('click',session.returnClick,true);
  aside.innerHTML='<header><label>资料<select aria-label="对照资料"></select></label><button type="button" class="source-peek-return">返回记录</button></header><nav class="note-source-path" aria-label="资料浏览" hidden><button type="button" class="source-peek-back">上一份资料</button><span></span><button type="button" class="source-peek-open" hidden>打开白板</button></nav><p class="note-source-status" role="status" hidden></p><button type="button" class="source-peek-library" hidden>在内容库查看</button><div class="note-source-paper"></div>';
  const select=aside.querySelector('select'),status=aside.querySelector('[role=status]'),path=aside.querySelector('nav'),back=path.querySelector('.source-peek-back'),open=path.querySelector('.source-peek-open'),key=item=>item.kind==='library'?'library/'+item.assetId+'/'+(item.originNodeId||''):item.board+'/'+item.node.id;
  const live=epoch=>ownsSourcePeek(session)&&session.epoch===epoch;
  const libraryButton=aside.querySelector('.source-peek-library');libraryButton.onclick=()=>{if(!ownsSourcePeek(session)||!session.originAssetId)return;const id=session.originAssetId;closeSourcePeek(false);revealLibraryItem(id).catch(error=>toast(error.message))};
  const message=text=>{status.textContent=text;status.hidden=!text;libraryButton.hidden=true;aside.removeAttribute('aria-busy');open.disabled=false};
  const authorPosition=()=>{const field=session.input;return field?{field,value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection}:null};
  let authorPositionBefore=authorPosition();
  const sameAuthorPosition=next=>!!next&&!!authorPositionBefore&&['field','value','start','end','direction'].every(key=>next[key]===authorPositionBefore[key]);
  const cancel=()=>{session.epoch++;if(!session.row||session.failedOriginal){closeSourcePeek(false);return}if(aside.hasAttribute('aria-busy'))message('');select.value=key(session.row)};
  session.authorActivity=event=>{const next=authorPosition();if(event.type==='select'&&event.target===session.input&&sameAuthorPosition(next))return;authorPositionBefore=next;cancel()};
  session.rememberFocus=event=>{if(event.target.matches('textarea,input')&&root.contains(event.target)){const previous=session.input;session.input=event.target;const next=authorPosition();if(previous!==session.input||!sameAuthorPosition(next)){authorPositionBefore=next;cancel()}}};root.addEventListener('focusin',session.rememberFocus);
  for(const type of ['input','select','pointerdown','keydown'])root.addEventListener(type,session.authorActivity,true);
  const include=item=>{const old=session.rows.findIndex(r=>key(r)===key(item));if(old<0)session.rows.push(item);else session.rows[old]=item};
  session.render=item=>{
   if(!ownsSourcePeek(session))return closeSourcePeek(false);
   const box=aside.querySelector('.note-source-paper');if(session.row&&box.firstElementChild)session.positions.set(key(session.row),box.scrollTop);if(!item){session.signature=JSON.stringify(null);for(const view of session.views.values()){pauseSource(view.paper);view.paper.hidden=true}message('这份资料已移走或删除。');return}
   if(!canCompare(item)){for(const view of session.views.values()){pauseSource(view.paper);view.paper.hidden=true}message('这份资料的类型已有变化，请从白板查看。');return}
   session.row=item;session.failedOriginal=false;session.signature=JSON.stringify(item.node);include(item);select.replaceChildren();
   for(const current of session.rows){const option=document.createElement('option');option.value=key(current);option.textContent=noteLabel(current.node)+(current.board!==session.board?' · '+current.name:'');select.append(option)}
   for(const view of session.views.values()){pauseSource(view.paper);view.paper.hidden=true}whiteboardMedia.close();
   let view=session.views.get(key(item));if(view&&view.signature!==session.signature){pauseSource(view.paper);view.paper.remove();session.views.delete(key(item));view=null}
   if(!view){const template=document.createElement('template');template.innerHTML=noteMarkup(item.node,true);const paper=template.content.firstElementChild;paper.classList.remove('active');paper.classList.add('note-source-card');paper.removeAttribute('data-id');paper.style.setProperty('--body-size',(item.node.fontSize||16)+'px');paper.style.setProperty('--title-size',(item.node.titleFontSize||24)+'px');for(const table of paper.querySelectorAll('.table-scroll')){table.classList.add('note-text-scroll');table.dataset.noteScroll='table'}paper.querySelectorAll('.port,.resize,.block-actions,.space-card-label,.inline-toolbar,.table-actions,.table-help,.table-grip,.col-remove,.add-cell-image,button[disabled]').forEach(el=>el.remove());
    view={paper,row:item,signature:session.signature};session.views.set(key(item),view);box.append(paper);
    for(const img of paper.querySelectorAll('.cell-images img')){const button=document.createElement('button');button.type='button';button.className='note-source-image inline-ui';button.setAttribute('aria-label','查看原图：'+(img.alt||item.node.title||'图片'));img.before(button);button.append(img);button.onclick=()=>{if(ownsSourcePeek(session))openImageView(img.currentSrc||img.src,img.alt||item.node.title||'图片')}}
    for(const link of paper.querySelectorAll('a[data-file-link]')){const asset=assetById(item.node.assetId);if(!documentKind(asset))continue;const button=document.createElement('button');button.type='button';button.className='note-source-expand inline-ui';button.textContent='放大查看';button.onclick=()=>{session.full=!session.full;session.host.classList.toggle('source-reading-full',session.full);button.textContent=session.full?'并排查看':'放大查看';layoutSourcePeek()};link.replaceWith(button)}
   }else{view.row=item;session.views.delete(key(item));session.views.set(key(item),view)}
   view.paper.hidden=false;view.paper.querySelectorAll('.note-source-expand').forEach(button=>button.textContent=session.full?'并排查看':'放大查看');growContentFields(view.paper);select.value=key(item);box.scrollTop=session.positions.get(key(item))||0;
   while(session.views.size>6){const [id,old]=session.views.entries().next().value;pauseSource(old.paper);old.paper.remove();session.views.delete(id)}
   fillTextPreviews(view.paper);mountInlineDocuments();mountReadingState();whiteboardMedia.mount();whiteboardMedia.markers.mount();scheduleScrollSurfaces();

   const label=aside.querySelector('header label');label.firstChild.textContent=item.kind==='library'?'库中原件':'资料';let name=label.querySelector('.source-peek-name');if(!name){name=document.createElement('span');name.className='source-peek-name';label.append(name)}name.textContent=item.name;const single=item.kind==='library'&&session.rows.length===1;name.hidden=!single;select.hidden=single;layoutSourcePeek();path.hidden=!session.trail.length&&(item.kind==='library'||item.board===session.board);back.hidden=!session.trail.length;path.querySelector('span').textContent=item.name;open.hidden=item.kind==='library'||item.board===session.board;open.title='打开白板：'+item.name;message('');
  };
  const recordsFor=async id=>{if(id===session.board)return noteRecords(board,id);const value=await(await api('/api/boards/'+encodeURIComponent(id))).json();return noteRecords(value,id)};
  const rowsFor=async item=>{
   if(item.kind!=='library')return recordsFor(item.board);
   // A fresh read never replaces the live editor or its shared library index.
   const catalog=await(await api('/api/assets')).json(),asset=catalog.assets?.find(a=>a.id===item.assetId);
   if(!asset||asset.archived)throw Error('库中原件已移出内容库');
   if(!item.originNodeId||!asset.bundle?.nodes.some(n=>n.id===item.originNodeId))throw Error('找不到对应原件，请从内容库查看');
   return asset.bundle.nodes.filter(n=>n.type!=='frame').map(node=>({kind:'library',assetId:asset.id,originNodeId:node.id,board:null,name:asset.title,node}));
  };
  const visit=async(item,epoch,trail)=>{
   const records=await rowsFor(item);if(!live(epoch))return;const current=records.find(r=>r.node.id===(item.kind==='library'?item.originNodeId:item.node.id));
   if(!current){message('这份资料已移走或删除。');select.value=session.row?key(session.row):'';return}
   if(current.board===session.board&&current.node===session.author){closeSourcePeek();return}
   if(!canCompare(current)){message('这份内容暂时不能在这里查看。');select.value=session.row?key(session.row):'';return}
   const ids=sourceAssetIds(current.node);if(ids.some(id=>!assetById(id))){if(current.kind==='library')throw Error('原件的文件尚未载入，请从内容库查看');await loadAssets();if(!live(epoch))return}
   session.trail=trail;session.render(current);
  };
  const begin=()=>{const epoch=++session.epoch;message('正在打开资料…');open.disabled=true;aside.setAttribute('aria-busy','true');return epoch};
  const failed=(error,epoch)=>{if(live(epoch)){message('暂时无法打开资料：'+error.message);select.value=session.row?key(session.row):'';if(session.originAssetId){session.failedOriginal=true;for(const view of session.views.values()){pauseSource(view.paper);view.paper.hidden=true}libraryButton.hidden=false}}};
  select.onchange=()=>{const item=session.rows.find(r=>key(r)===select.value);if(item){const epoch=begin();visit(item,epoch,[]).catch(error=>failed(error,epoch))}};
  back.onclick=()=>{const item=session.trail.at(-1);if(item){const epoch=begin();visit(item,epoch,session.trail.slice(0,-1)).catch(error=>failed(error,epoch))}};
  open.onclick=()=>{if(!ownsSourcePeek(session)||!session.row||session.row.kind==='library'||aside.hasAttribute('aria-busy'))return;const row=session.row,place=captureReferencePlace(session.author.id);closeSourcePeek();jumpReference(row,place,++referenceEpoch,undefined,false).catch(error=>toast('暂时无法打开白板：'+error.message))};
  aside.querySelector('.source-peek-return').onclick=()=>closeSourcePeek();
  aside.addEventListener('pointerdown',event=>event.stopPropagation());aside.addEventListener('click',async event=>{
   event.stopPropagation();const link=event.target.closest('[data-note-link]');if(!link)return;event.preventDefault();if(!ownsSourcePeek(session)||!session.row)return;
   const from=session.row,value=link.dataset.noteLink,epoch=begin();try{
    const local=await rowsFor(from);if(!live(epoch))return;const current=local.find(r=>r.node.id===from.node.id);
    if(!current){message('这份资料已移走或删除。');return}
    if(!references(current.node).includes(value)){session.render(current);message('资料已有变化，请查看当前原文。');return}
    let target=resolveReference(value,local,from.board);
    const explicit=/^@([a-zA-Z0-9_-]+)\/([^\]|]+)$/.exec(value);
    if(!target&&explicit){const rows=await recordsFor(explicit[1]);if(!live(epoch))return;target=rows.find(r=>r.node.id===explicit[2])}
    else if(!target){const result=await allNotes();if(!live(epoch))return;target=resolveReference(value,result.records,from.board)}
    if(!target){message('没有找到唯一的资料，请从“关联”重新选择。');return}
    await visit(target,epoch,[...session.trail,from].slice(-32));
   }catch(error){failed(error,epoch)}
  });
  host.append(aside);host.classList.add(expanded?'note-comparing':'source-comparing-canvas');include(row);for(const item of session.rows){const option=document.createElement('option');option.value=key(item);option.textContent=noteLabel(item.node)+(item.board!==session.board?' · '+item.name:'');select.append(option)}select.value=key(row);const epoch=begin();visit(row,epoch,[]).catch(error=>failed(error,epoch));layoutSourcePeek();aside.querySelector('.source-peek-return').focus({preventScroll:true});return true;
 }
 window.addEventListener('resize',()=>{layoutSourcePeek();const card=sourcePeek?.aside.querySelector('.note-source-card');if(card)growContentFields(card)});
 window.addEventListener('creative-board-loading',()=>closeSourcePeek(false));
 window.addEventListener('message',event=>{if(event.data?.type!=='creative-preview-close'||!sourcePeek)return;const session=sourcePeek;if(ownsSourcePeek(session)&&[...session.aside.querySelectorAll('.note-source-card:not([hidden]) .inline-document iframe')].some(frame=>frame.contentWindow===event.source))closeSourcePeek()});
 $('dialog').addEventListener('close',()=>closeSourcePeek(false));
 $('dialog').addEventListener('cancel',event=>{if(sourcePeek&&!panel){event.preventDefault();event.stopImmediatePropagation();closeSourcePeek()}},true);
 window.addEventListener('keydown',event=>{if(event.key==='Escape'){if(sourcePeek&&!panel){event.preventDefault();event.stopImmediatePropagation();closeSourcePeek()}}},true);
 new MutationObserver(()=>{if(sourcePeek&&!ownsSourcePeek(sourcePeek))closeSourcePeek(false)}).observe($('dialog'),{attributes:true,attributeFilter:['open','class']});

 async function jumpReference(row,place=null,epoch=++referenceEpoch,records=undefined,compare=true){
  if(loading||blocked||epoch!==referenceEpoch)return;
  if(compare&&peekReference(row,place,records))return;
  if(row.board!==boardId&&window.whiteboardPane&&typeof parent.whiteboardWorkspace?.openReference==='function'){
   closePanel();const source=board,sourceBoard=boardId;
   await parent.whiteboardWorkspace.openReference(window,{board:row.board,id:row.node.id,returnName:place?.name||board.name},()=>epoch===referenceEpoch&&board===source&&boardId===sourceBoard&&!loading&&!blocked);return;
  }
  closePanel();await closeReferenceEditor();if(epoch!==referenceEpoch||place&&place.board!==boardId)return;
  if(row.board!==boardId){await switchBoard(row.board);if(epoch!==referenceEpoch||boardId!==row.board)return}
  const located=nestedTarget(row.node.id),n=located?.node;if(!n)return toast('这块内容已经移走或删除');if(located.container){showNestedTarget(located);if(place&&(place.board!==boardId||place.id!==n.id)){referenceTrail.push({...place,destination:boardId});while(referenceTrail.length>12)referenceTrail.shift()}syncReferenceReturn();return;}
  editorId=null;selected=new Set([n.id]);drawNodes();renderOutline();const rect=canvas.getBoundingClientRect();board.view.x=rect.width/2-(n.x+n.w/2)*view().z;board.view.y=rect.height/2-(n.y+n.h/2)*view().z;moveView();canvas.focus({preventScroll:true});
  if(place&&(place.board!==boardId||place.id!==n.id)){referenceTrail.push({...place,destination:boardId});while(referenceTrail.length>12||referenceTrail.reduce((size,p)=>size+(p.field?.value?.length||0)*2,0)>4*1024*1024)referenceTrail.shift();}
  syncReferenceReturn();
 }
 // Cross-document visits use the same original canvas and an ephemeral return action.
 async function visitReference(id,returnName,back,active){
  if(!active()||loading||blocked)return false;
  await closeReferenceEditor();if(!active()||loading||blocked)return false;
  const located=nestedTarget(id),n=located?.node;if(!n)throw Error('这块内容已经移走或删除');if(located.container){showNestedTarget(located);referenceTrail.push({external:true,destination:boardId,name:returnName,back});syncReferenceReturn();return true;}
  editorId=null;selected=new Set([n.id]);drawNodes();renderOutline();const rect=canvas.getBoundingClientRect();Object.assign(board.view,{x:rect.width/2-(n.x+n.w/2)*view().z,y:rect.height/2-(n.y+n.h/2)*view().z});moveView();canvas.focus({preventScroll:true});
  if(n.type==='note'&&rect.width<=680){whiteboardReading.open(n.id);const surface=$('immersiveSurface'),trigger=surface?.querySelector('#notePreview');if(trigger)togglePreview(trigger,n,surface.querySelector('.inner'));}
  referenceTrail.push({external:true,destination:boardId,name:returnName,back});while(referenceTrail.length>12)referenceTrail.shift();syncReferenceReturn();return true;
 }
 // A relation is shown beside its object; authored text and plain graph edges stay literal.
 function noteLabel(n){return String(n.title||'').trim()||Array.from(String(n.body||'').split('\n').find(line=>line.trim())?.trim()||'').slice(0,60).join('')||'未命名'}
 function relatedRows(n,records=noteRecords(board,boardId),incoming=true){
  const rows=new Map(),add=row=>{if(row&&(row.board!==boardId||row.node.id!==n.id))rows.set(row.board+'/'+row.node.id,row)};
  for(const e of board.edges){const id=e.from===n.id?e.to:e.to===n.id?e.from:null;if(id)add(records.find(r=>r.board===boardId&&r.node.id===id))}
  for(const ref of references(n))add(resolveReference(ref,records));
  if(incoming)for(const row of records)if(references(row.node).some(ref=>{const target=resolveReference(ref,records,row.board);return target?.board===boardId&&target.node.id===n.id}))add(row);
  return [...rows.values()];
 }
 function mountLibraryOrigin(n,root){
  if(!root)return;let strip=root.querySelector('.note-library-origin');
  if(n?.type!=='note'||!n.libraryOrigin?.id){strip?.remove();return}
  const title=root.querySelector('.edit-scroll>#title');if(!title)return;
  if(!strip){strip=document.createElement('div');strip.className='note-library-origin inline-ui';const caption=document.createElement('span');caption.textContent='复用自';const button=document.createElement('button');button.type='button';strip.append(caption,button);title.after(strip);strip.addEventListener('pointerdown',event=>event.stopPropagation())}
  const expanded=root.classList.contains('immersive-surface'),inner=title.closest('.inner');
  strip.classList.toggle('note-library-context',expanded);
  if(expanded&&inner){const area=title.closest('.edit-scroll');if(strip.parentElement!==inner)inner.insertBefore(strip,area)}else if(title.nextElementSibling!==strip)title.after(strip);
  const button=strip.querySelector('button');button.textContent=n.libraryOrigin.name||'内容库';button.setAttribute('aria-label','查看库中原件：'+button.textContent);button.title='查看库中原件';
  button.onclick=event=>{event.stopPropagation();if(!root.isConnected||!board.nodes.includes(n)||editorId!==n.id||loading||blocked)return;const place=captureReferencePlace(n.id),row={kind:'library',assetId:n.libraryOrigin.id,originNodeId:n.libraryOrigin.nodeId,board:null,name:n.libraryOrigin.name||'库中原件',node:clone(n)};peekReference(row,place,[])};
  // Maintenance keeps its explicit review route; reading has its own direct link.
  const review=root.querySelector('.wf-origin');if(review){review.textContent='比较原件修改…';review.title='比较原件与当前副本'}
 }
 function mountRelations(n,root){
  mountLibraryOrigin(n,root);
  if(!n||n.type!=='note'||!root)return;
  const host=root.querySelector('.inner.live-layout .note-edit-tools'),trigger=host?.querySelector('#noteLinks');if(!host||!trigger)return;
  const rows=relatedRows(n),signature=JSON.stringify([boardId,n.id,...rows.map(r=>[r.board,r.node.id,noteLabel(r.node)])]);let links=host.querySelector('.note-related-links');
  const direct=rows.length===1&&root.classList.contains('immersive-surface');
  trigger.textContent='关联';
  if(!direct){if(links){links.before(trigger);links.remove()}return}
  if(!links){links=document.createElement('div');links.className='note-related-links inline-ui';links.setAttribute('role','group');links.setAttribute('aria-label','关联内容');trigger.before(links);links.addEventListener('pointerdown',e=>e.stopPropagation())}
  if(links.dataset.signature===signature)return;links.dataset.signature=signature;
  const row=rows[0],button=document.createElement('button');button.type='button';button.dataset.noteLink='@'+row.board+'/'+row.node.id;button.textContent=noteLabel(row.node);button.title='查看：'+button.textContent;links.replaceChildren(button,trigger);
 }
 function syncRelations(){
  for(const id of selected){const n=board?.nodes.find(v=>v.id===id),root=[...$('nodes').children].find(el=>el.dataset.id===id);mountRelations(n,root)}
  const surface=$('immersiveSurface');if($('dialog').open&&surface)mountRelations(board?.nodes.find(v=>v.id===surface.dataset.id),surface);
  window.whiteboardReading?.placeActions?.();
 }
 function writeFrom(id){
  const n=board?.nodes.find(v=>v.id===id);if(!n||n.type==='frame'||loading||blocked||selected.size!==1||!selected.has(id)||$('dialog').open)return;
  addNote();const note=board.nodes.find(v=>v.id===editorId);if(!note||note===n||!board.nodes.includes(n))return;
  board.edges.push({id:uid(),from:note.id,to:n.id,fromSide:'top',toSide:'bottom',label:''});drawEdges();change();syncRelations();$('body')?.focus({preventScroll:true});
 }

 async function openLinks(trigger,n){
  const box=popup(trigger,n,'links');if(!box)return;box.setAttribute('aria-label','关联内容');box.innerHTML='<header><b>关联内容</b><button type="button" aria-label="关闭关联内容">×</button></header><p role="status">正在读取可关联的内容…</p>';box.querySelector('button').onclick=closePanel;show(trigger);
  const sourceBoard=boardId,source=board;let result;try{result=await allNotes()}catch(error){if(panel===box)box.querySelector('p').textContent='暂时无法读取：'+error.message;return}if(panel!==box||board!==source||boardId!==sourceBoard||!board.nodes.includes(n))return;
  const records=[...result.records];
  // Keep explicit relationships legible even when their target cannot be read.
  // These transient labels come from the author's link, never source content.
  for(const fieldName of ['body','userText','annotation'])for(const block of parser.parse(String(n[fieldName]||''),{}))for(const token of block.children||[]){
   if(token.type!=='whiteboard_link')continue;const [value,...alias]=token.content.split('|'),match=/^@([a-zA-Z0-9_-]+)\/([^\]|]+)$/.exec(value);if(!match||records.some(row=>row.board===match[1]&&row.node.id===match[2])||match[1]===sourceBoard&&match[2]===n.id)continue;
   records.push({board:match[1],name:'暂时无法查看',unavailable:true,node:{id:match[2],type:'note',title:alias.join('|')||'未命名资料',body:''}});
  }
  const backlinks=relatedRows(n,records);
  box.innerHTML='<header><b>关联内容</b><button type="button" aria-label="关闭关联内容">×</button></header><label class="note-link-search">查找内容<input type="search" placeholder="搜索便签与白板" aria-label="搜索关联内容"></label><div class="note-link-results"></div><div class="note-backlinks"><b>已关联 · '+backlinks.length+'</b><div></div></div>'+(result.incomplete?'<p role="status">部分白板暂时无法读取，引用列表可能不完整。</p>':'');box.querySelector('header button').onclick=closePanel;
  const rowButton=(row,insert)=>{const b=document.createElement('button');b.type='button';b.className='note-link-row';const title=document.createElement('span'),location=document.createElement('small');title.textContent=noteLabel(row.node);location.textContent=row.name;b.append(title,location);if(insert){b.className='note-link-cite';b.replaceChildren(document.createTextNode('引用'));b.setAttribute('aria-label','引用：'+(noteLabel(row.node)))}else b.title='查看：'+(noteLabel(row.node));b.onclick=async()=>{const active=()=>panel===box&&board===source&&boardId===sourceBoard&&board.nodes.includes(n)&&editorId===n.id&&!loading&&!blocked&&(!document.getElementById('dialog').open||!!trigger.closest('#dialog.immersive-dialog'));if(!active())return;
   if(row.unavailable){
    const place=captureReferencePlace(n.id),epoch=++referenceEpoch,keys=['title','body','userText','annotation'],values=keys.map(key=>n[key]),authorField=referenceFieldAt(place,trigger.closest('#immersiveSurface')||trigger.closest('.node')||document),authorValue=authorField?.value,authorRoot=authorField?.closest('.inner')||authorField;
    let cancelled=false;const cancel=()=>{cancelled=true},events=['input','select','pointerdown','keydown','focusin'];for(const name of events)authorRoot?.addEventListener(name,cancel,true);
    const same=()=>!cancelled&&active()&&epoch===referenceEpoch&&keys.every((key,i)=>n[key]===values[i])&&(!place?.field||authorField?.isConnected&&authorField===referenceFieldAt(place,authorRoot)&&authorField.value===authorValue&&authorField.selectionStart===place.field.start&&authorField.selectionEnd===place.field.end&&authorField.selectionDirection===place.field.direction);
    location.setAttribute('role','status');location.textContent='正在打开…';b.disabled=true;
    try{const response=await api('/api/boards/'+encodeURIComponent(row.board)),value=await response.json();if(!same())return;const node=noteRecords(value,row.board).find(item=>item.node.id===row.node.id)?.node;if(!node)throw Error('这份资料暂时无法查看');await jumpReference({board:row.board,name:value.name,node},place,epoch,records)}
    catch(error){if(active()){location.textContent='暂时无法查看';b.title='暂时无法查看：'+error.message}}
    finally{for(const name of events)authorRoot?.removeEventListener(name,cancel,true);if(b.isConnected){b.disabled=false;if(location.textContent==='正在打开…')location.textContent='暂时无法查看'}}return;
   }
   if(insert){if(!field?.isConnected){field=document.getElementById('body');remember(field)}if(!ownsField(n))return;const {start,end}=range||{start:field.selectionStart,end:field.selectionEnd},label=field.value.slice(start,end)||noteLabel(row.node);if(insertReference(n,row,label,start,end))closePanel()}else jumpReference(row,captureReferencePlace(n.id),++referenceEpoch,records).catch(error=>toast('暂时无法打开关联：'+error.message))};return b};
  const list=box.querySelector('.note-link-results'),search=box.querySelector('input'),incoming=box.querySelector('.note-backlinks>div'),section=incoming.parentElement,related=new Set(backlinks.map(row=>row.board+'/'+row.node.id));let limit=30;
  const otherHeading=document.createElement('b');otherHeading.className='note-other-heading';otherHeading.textContent='其他内容';list.before(section,otherHeading);
  const entry=row=>{const el=document.createElement('div');el.className='note-link-entry';el.append(rowButton(row,false));if(!row.unavailable)el.append(rowButton(row,true));return el};
  const filter=()=>{list.replaceChildren();incoming.replaceChildren();const query=search.value.toLocaleLowerCase(),matches=row=>(noteLabel(row.node)+' '+row.name).toLocaleLowerCase().includes(query),linked=backlinks.filter(matches),others=records.filter(row=>(row.board!==sourceBoard||row.node.id!==n.id)&&!related.has(row.board+'/'+row.node.id)&&matches(row));section.hidden=!linked.length;otherHeading.hidden=!others.length;for(const row of linked.slice(0,limit))incoming.append(entry(row));for(const row of others.slice(0,limit))list.append(entry(row));if(linked.length>limit||others.length>limit){const more=document.createElement('button');more.type='button';more.textContent='显示更多';more.onclick=()=>{limit+=30;filter()};list.append(more)}if(!linked.length&&!others.length){const empty=document.createElement('p');empty.textContent='没有匹配的内容';list.append(empty)}};
  search.oninput=()=>{limit=30;filter()};filter();positionPanel(trigger);search.focus();
 }
 const originalBind=bindInline;
 bindInline=function(){originalBind();const n=board?.nodes.find(n=>n.id===editorId&&selected.has(n.id)),root=document.querySelector('.live-layout');if(!n||!root)return;closePanel();field=null;range=null;preview=false;
  const bar=root.querySelector('.inline-toolbar');if(!bar||bar.querySelector('.note-edit-tools'))return;
  const tools=document.createElement('div');tools.className='note-edit-tools inline-ui';tools.innerHTML='<button type="button" id="noteColour" aria-label="便签颜色与纸面" title="颜色与纸面" style="--swatch:'+esc(n.color||'#fff0aa')+'"><i></i><span>外观</span></button>'+(n.type!=='table'?'<button type="button" id="noteFormat" title="文字格式">Aa</button><button type="button" id="noteLinks" title="关联内容与反向引用">关联</button><button type="button" id="notePreview" aria-pressed="false">预览</button>':'<button type="button" id="noteLinks" title="引用当前单元格中的内容">关联</button>');bar.prepend(tools);
  tools.querySelector('#noteColour').onclick=()=>openColour(tools.querySelector('#noteColour'),n);
  tools.querySelector('#noteFormat')?.addEventListener('click',()=>openFormat(tools.querySelector('#noteFormat'),n));
  tools.querySelector('#noteLinks')?.addEventListener('click',()=>openLinks(tools.querySelector('#noteLinks'),n));
  tools.querySelector('#notePreview')?.addEventListener('click',()=>{closePanel();togglePreview(tools.querySelector('#notePreview'),n,root)});
  root.querySelectorAll('textarea').forEach(el=>{const refresh=()=>{let links=el.nextElementSibling;if(!links?.classList.contains('field-reference-links')){links=document.createElement('div');links.className='field-reference-links inline-ui';el.after(links)}const tokens=wikiMatches(serializeField(el,el.value));links.replaceChildren();for(const token of tokens){const template=document.createElement('template');template.innerHTML=linkMarkup(token.content);links.append(template.content)}links.hidden=!tokens.length};if(n.type==='table'){refresh();el.addEventListener('input',refresh)}});
  // Input and focus loss also cover text entry without a keyboard keyup.
  root.querySelectorAll('textarea').forEach(el=>{for(const name of ['focus','select','keyup','pointerup','input','blur'])el.addEventListener(name,()=>remember(el));el.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.isComposing&&['b','i'].includes(e.key.toLowerCase())&&['body','userText','annotation'].includes(el.id)){e.preventDefault();e.stopPropagation();remember(el);format(n,e.key.toLowerCase()==='b'?'bold':'italic')}})});
 };
 document.addEventListener('pointerdown',e=>{if(panel&&!panel.contains(e.target)&&!owner?.contains(e.target))closePanel()},true);
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel){e.preventDefault();e.stopImmediatePropagation();const trigger=owner;closePanel();trigger?.focus({preventScroll:true})}},true);
 document.getElementById('dialog').addEventListener('cancel',e=>{if(!panel)return;e.preventDefault();const trigger=owner;closePanel();trigger?.focus({preventScroll:true})});
 window.addEventListener('resize',closePanel);
 document.addEventListener('click',async e=>{const link=e.target.closest('[data-note-link]');if(!link)return;e.preventDefault();e.stopPropagation();const requestedBoard=boardId,value=link.dataset.noteLink,place=captureReferencePlace(link.closest('.node')?.dataset.id),epoch=++referenceEpoch;try{const {records}=await allNotes();if(epoch!==referenceEpoch||boardId!==requestedBoard||!link.isConnected)return;const row=resolveReference(value,records);if(row)await jumpReference(row,place,epoch,records);else toast('没有找到唯一的目标，请从“关联”重新选择')}catch(error){toast('暂时无法打开关联：'+error.message)}});
 const originalDraw=drawNodes;drawNodes=function(){closePanel();originalDraw();syncReferenceReturn();syncRelations();layoutSourcePeek()};
 const originalSelection=refreshSelectionUI;refreshSelectionUI=function(){originalSelection();syncRelations()};
 window.addEventListener('creative-board-loading',()=>{if(referenceBar)referenceBar.hidden=true;});
 new MutationObserver(syncReferenceReturn).observe(document.getElementById('dialog'),{attributes:true,attributeFilter:['open','class']});
 const originalAdd=addNote;addNote=function(p=center(),data={}){return originalAdd(p,{...(!data.type||data.type==='note'?{textFormat:'markdown'}:{}),...data})};
 function openAppearance(id){
  const n=board?.nodes.find(n=>n.id===id),el=[...$('nodes').children].find(el=>el.dataset.id===id);
  if(!n||n.type!=='note'||!el||loading)return;
  if(blocked)return toast('请先处理保存冲突');
  openColour(el,n);
 }
 const previousMenu=fileMenu;
 fileMenu=function(e,items){
  const id=e.target.closest?.('#nodes>.node[data-id]')?.dataset.id,n=board?.nodes.find(n=>n.id===id);
  if(n?.type==='note'&&!e.target.closest('[data-edge]'))items=[['便签颜色与纸面',()=>openAppearance(id)],...items];
  return previousMenu(e,items);
 };
 window.whiteboardNoteEditor={sourceContext,fieldSelector,keepsEditor:()=>!!sourcePeek&&ownsSourcePeek(sourcePeek),visitReference,render:rendered,renderPlain:linkedText,bindDraftReference,readableReference:raw=>projectReferences(String(raw||'')).display,records:noteRecords,format,openAppearance,writeFrom,mountRelations,syncRelations,close:closePanel,dismissSource:()=>{if(!sourcePeek)return false;closeSourcePeek();return true},dismiss:()=>{const trigger=owner;closePanel();trigger?.focus({preventScroll:true})}};
})();

// Distance changes presentation only: keep original content, editors and players mounted.
(() => {
 'use strict';
 const elements=new WeakMap();let lastLevel=null,lastZ=null,lastBoard=null,lastEditor=null;
 const normalisePreferences=p=>({mode:p?.mode==='original'?'original':'smart',at:Math.max(15,Math.min(75,Number(p?.at??45)||45)),font:Math.max(9,Math.min(18,Number(p?.font??12)||12))});
 const appearance=window.whiteboardAppearance?.read?.();let preferences=normalisePreferences({mode:appearance?.overviewMode,at:appearance?.overviewAt,font:appearance?.overviewFont});
 window.addEventListener('creative-overview-preferences',event=>{preferences=normalisePreferences(event.detail);distance(true)});
 const fullName=document.createElement('aside');fullName.id='spaceTitlePreview';fullName.className='space-title-preview';fullName.hidden=true;fullName.setAttribute('aria-hidden','true');fullName.innerHTML='<p></p><small>点击查看原便签</small>';canvas.append(fullName);let peekButton=null,dismissedName=null;
 function hideName(){fullName.hidden=true;fullName.querySelector('p').textContent='';peekButton=null}
 function showName(button,n,source,sourceId){
  const el=button.parentElement;if(button===dismissedName||source!==board||sourceId!==boardId||!board.nodes.includes(n)||loading||blocked||gesture||button.hidden||!el?.isConnected||el.parentElement!==$('nodes')||elements.get(el)!==button||!canvas.classList.contains('space-overview')||$('dialog').open)return;
  const bounds=canvas.getBoundingClientRect(),r=button.getBoundingClientRect(),width=Math.max(1,Math.min(320,bounds.width-16));
  dismissedName=null;peekButton=button;fullName.querySelector('p').textContent=label(n);fullName.style.width=width+'px';fullName.style.maxHeight=Math.max(1,Math.min(240,bounds.height-16))+'px';fullName.hidden=false;
  const height=fullName.offsetHeight,left=Math.max(8,Math.min(r.left-bounds.left,bounds.width-width-8)),below=r.bottom-bounds.top+8,above=r.top-bounds.top-height-8;
  fullName.style.left=left+'px';fullName.style.top=Math.max(8,Math.min(below+height<=bounds.height-8?below:above,bounds.height-height-8))+'px';
 }
 canvas.addEventListener('pointerdown',hideName,true);window.addEventListener('blur',hideName);window.addEventListener('resize',hideName);window.addEventListener('creative-board-loading',hideName);
 window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!fullName.hidden&&!gesture){event.preventDefault();event.stopImmediatePropagation();dismissedName=peekButton;hideName()}},true);
 function label(n){const title=String(n.title||'').trim();return title||String(n.body||'').trim().split(/\r?\n/)[0]||(n.type==='table'?'空白表格':'空白便签')}
 function open(id){
  const n=board?.nodes.find(n=>n.id===id);if(!n||loading)return;
  const r=canvas.getBoundingClientRect(),z=Math.max(.85,view().z);
  board.view={...board.view,x:r.width/2-(n.x+n.w/2)*z,y:r.height/2-(n.y+n.h/2)*z,z};
  moveView();change(true);const expanded=canvas.clientWidth<420&&n.type==='note'&&!n.assetId;selectNode(id,!expanded);if(expanded){whiteboardReading.open(id);return;}
  const field=$('body')||$('title');field?.focus({preventScroll:true});
 }
 function mount(){
  hideName();
  if(!board)return;
  const lookup=new Map(board.nodes.map(n=>[n.id,n]));
  for(const el of $('nodes').children){
   const n=lookup.get(el.dataset.id);if(!n||n.type==='frame')continue;
   if(!el.classList.contains('paper-card')){elements.get(el)?.remove();elements.delete(el);continue}
   let button=elements.get(el);
   if(!button){button=document.createElement('button');button.type='button';button.className='space-card-label inline-ui';button.onclick=e=>{e.stopPropagation();open(el.dataset.id)};el.append(button);elements.set(el,button)}
   const text=label(n);if(button.textContent!==text||!button.querySelector('.space-card-name')){const name=document.createElement('span');name.className='space-card-name';name.textContent=text;button.replaceChildren(name)}
   button.removeAttribute('title');button.setAttribute('aria-label','定位并编辑：'+text);
   const source=board,sourceId=boardId;
   button.onpointerenter=event=>{if(event.pointerType==='mouse'||event.pointerType==='pen')showName(button,n,source,sourceId)};
   button.onpointermove=event=>{if(fullName.hidden&&(event.pointerType==='mouse'||event.pointerType==='pen'))showName(button,n,source,sourceId)};
   button.onpointerleave=()=>{if(dismissedName===button)dismissedName=null;if(document.activeElement!==button)hideName()};button.onfocus=()=>{dismissedName=null;showName(button,n,source,sourceId)};button.onblur=hideName;
  }
  distance(true);
 }
 function distance(force=false){
  if(!board)return;
  if(!force&&lastZ===view().z&&lastBoard===board&&lastEditor===editorId)return;
  hideName();
  lastZ=view().z;lastBoard=board;lastEditor=editorId;
  const overview=preferences.mode==='smart'&&view().z<preferences.at/100;
  if(lastLevel!==overview){canvas.classList.toggle('space-overview',overview);lastLevel=overview}
  const scale=String(1/view().z);if($('nodes').style.getPropertyValue('--space-label-scale')!==scale)$('nodes').style.setProperty('--space-label-scale',scale);
  const nodes=new Map(board.nodes.map(n=>[n.id,n]));
  for(const el of $('nodes').children){const button=elements.get(el),n=nodes.get(el.dataset.id);if(button&&n){
   button.hidden=!overview||editorId===el.dataset.id;const width=Math.max(1,(n.w-24)*view().z),height=Math.max(1,(n.h-12)*view().z),baseFont=Math.max(9,Math.min(preferences.font,width/7)),font=height>=26.3?Math.max(9,Math.min(baseFont,(height-2)/2.7)):baseFont,lines=Math.max(1,Math.min(3,Math.floor((height-2)/(font*1.35)+1e-6)));
   if(button.style.maxWidth!==width+'px')button.style.maxWidth=width+'px';
   for(const [key,value]of [['--space-label-height',height+'px'],['--space-label-font',font+'px'],['--space-title-lines',String(lines)]])if(button.style.getPropertyValue(key)!==value)button.style.setProperty(key,value);
  }}
 }
 const previousDraw=drawNodes;drawNodes=function(){previousDraw();mount()};
 const previousSelect=refreshSelectionUI;refreshSelectionUI=function(){previousSelect();mount()};
 const previousView=moveView;moveView=function(){previousView();distance()};
 window.whiteboardSpace={open,mount,preferences:()=>({...preferences})};if(board)mount();
})();

// Named camera positions belong to this browser, not to the author's board content.
(() => {
 'use strict';
 const prefix='creative-canvas-views:',limit=40;let returning=null;
 const bar=document.createElement('div');bar.className='canvas-view-return inline-ui';bar.hidden=true;
 const back=document.createElement('button'),dismiss=document.createElement('button');back.type=dismiss.type='button';back.textContent='返回之前视角';dismiss.textContent='×';dismiss.setAttribute('aria-label','收起视角返回');bar.append(back,dismiss);canvas.append(bar);bar.addEventListener('pointerdown',event=>event.stopPropagation());bar.addEventListener('dblclick',event=>event.stopPropagation());
 const camera=()=>{const r=canvas.getBoundingClientRect(),v=view();return {cx:(r.width/2-v.x)/v.z,cy:(r.height/2-v.y)/v.z,z:v.z}};
 const same=(a,b)=>['id','name','cx','cy','z'].every(key=>a[key]===b[key]);
 const valid=p=>p&&typeof p.id==='string'&&p.id.length<=80&&typeof p.name==='string'&&p.name.length>0&&p.name.length<=80&&[p.cx,p.cy,p.z].every(Number.isFinite)&&Math.abs(p.cx)<=1e9&&Math.abs(p.cy)<=1e9&&p.z>=.15&&p.z<=32;
 function read(key){
  let raw;try{raw=localStorage.getItem(key)}catch{throw Error('浏览器暂时不能读取视角。你可以稍后重试。')}if(raw===null)return [];
  let value;try{value=JSON.parse(raw)}catch{throw Error('已保存的视角暂时不能读取，原记录保持原样。')}
  if(!Array.isArray(value)||value.length>limit||!value.every(valid)||new Set(value.map(p=>p.id)).size!==value.length)throw Error('已保存的视角暂时不能读取，原记录保持原样。');
  return value;
 }
 function positionReturn(){
  if(returning&&(returning.source!==board||returning.id!==boardId||loading))returning=null;
  if(returning?.returned&&['cx','cy','z'].some(key=>Math.abs(camera()[key]-returning.value[key])>1e-6))returning=null;
  bar.hidden=!returning;if(bar.hidden)return;
  const bounds=canvas.getBoundingClientRect(),tools=$('canvasTools').getBoundingClientRect(),reference=document.querySelector('.note-reference-return:not([hidden])'),r=reference?.getBoundingClientRect(),compact=bounds.height<240;
  back.disabled=!!returning.returned;back.textContent=returning.returned?(compact?'已返回':'已返回原视角'):(compact?'返回视角':'返回之前视角');back.setAttribute('aria-label',returning.returned?'已返回原视角':'返回之前视角');
  bar.style.left='';bar.style.right='12px';
  const size=bar.getBoundingClientRect(),height=size.height,dock=$('creationDock')?.getBoundingClientRect(),candidate={left:bounds.left+16,right:bounds.left+16+size.width,top:tools.top,bottom:tools.top+height},clear=b=>!b||candidate.right<=b.left||candidate.left>=b.right||candidate.bottom<=b.top||candidate.top>=b.bottom;
  if(compact&&tools.left-bounds.left-24>=size.width&&candidate.bottom<=bounds.bottom-8&&clear(dock)&&clear(r)){bar.style.left='16px';bar.style.right='auto';bar.style.top=tools.top-bounds.top+'px';return;}
  let top=tools.bottom-bounds.top+8;
  if(top+height>bounds.height-8)top=tools.top-bounds.top-height-8;
  if(r&&top<r.bottom-bounds.top+8&&top+height>r.top-bounds.top)top=r.bottom-bounds.top+8;
  bar.style.top=Math.max(8,Math.min(top,bounds.height-height-8))+'px';
 }
 function applyCamera(value){const r=canvas.getBoundingClientRect();board.view={...board.view,x:r.width/2-value.cx*value.z,y:r.height/2-value.cy*value.z,z:value.z};moveView();change(true)}
 function navigate(value){const current=camera();if(['cx','cy','z'].every(key=>Math.abs(current[key]-value[key])<1e-6)){canvas.focus({preventScroll:true});return}if(!returning||returning.returned)returning={source:board,id:boardId,value:current};applyCamera(value);positionReturn();canvas.focus({preventScroll:true})}
 back.onclick=()=>{if(!returning||returning.returned||returning.source!==board||returning.id!==boardId||loading||blocked||gesture)return;const prior=returning.value;returning.returned=true;applyCamera(prior);positionReturn();canvas.focus({preventScroll:true})};
 dismiss.onclick=()=>{returning=null;positionReturn();canvas.focus({preventScroll:true})};
 function selectedCamera(){
  const nodes=board.nodes.filter(n=>selected.has(n.id));if(!nodes.length)return null;
  const left=Math.min(...nodes.map(n=>n.x)),top=Math.min(...nodes.map(n=>n.y)),right=Math.max(...nodes.map(n=>n.x+n.w)),bottom=Math.max(...nodes.map(n=>n.y+n.h)),r=canvas.getBoundingClientRect();
  return {cx:(left+right)/2,cy:(top+bottom)/2,z:Math.max(.15,Math.min(1.1,Math.max(1,r.width-80)/Math.max(1,right-left),Math.max(1,r.height-100)/Math.max(1,bottom-top)))};
 }
 function open(){
  if(!board||loading||gesture||$('dialog').open)return;
  if(blocked)return toast('请先处理保存冲突');
  const source=board,id=boardId,key=prefix+id,savedCamera=camera(),focused=document.activeElement,selection=selectedCamera();let form;
  const ownsDialog=()=>$('dialog').open&&form?.isConnected&&$('dialogBody').contains(form);
  const active=()=>source===board&&id===boardId&&!loading&&!blocked&&!gesture&&ownsDialog();
  const message=value=>{if(!active())return;const status=form.querySelector('[role=status]');status.textContent=value;status.hidden=!value};
  showDialog('<section class="canvas-view-form"><h2 id="canvasViewTitle">视角与位置</h2><p class="canvas-view-explain">在同一张白板里来回走动，记住自己常用的位置。</p><div class="canvas-view-presets"><button type="button" data-view="all">全览白板<small>看看整体</small></button><button type="button" data-view="selection">聚焦选中<small>看清这一组</small></button><button type="button" data-view="actual">100%<small>按原比例查看</small></button></div><form class="canvas-view-save"><label for="canvasViewName">保存打开面板前的位置</label><div><input id="canvasViewName" maxlength="80" autocomplete="off" placeholder="给这个位置起个名称"><button type="submit">保存视角</button></div></form><p role="status" hidden></p><div class="canvas-view-list" aria-label="这张白板的已存视角"></div><p class="canvas-view-local">只保存在这个浏览器，暂不跨设备同步。</p></section>',[['返回白板',()=>{if(!ownsDialog())return;$('dialog').close();if(focused?.isConnected)focused.focus({preventScroll:true});else canvas.focus({preventScroll:true})}]]);
  form=$('dialogBody').querySelector('.canvas-view-form');const input=form.querySelector('input'),list=form.querySelector('.canvas-view-list');let removed=null;
  const dialog=$('dialog'),priorLabel=dialog.getAttribute('aria-labelledby');dialog.setAttribute('aria-labelledby','canvasViewTitle');
  const tabKey=event=>{if(event.key!=='Tab'||!ownsDialog())return;const buttons=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(el=>el.getClientRects().length);const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}};
  dialog.addEventListener('keydown',tabKey);onDialogDismiss(()=>{dialog.removeEventListener('keydown',tabKey);if(priorLabel===null)dialog.removeAttribute('aria-labelledby');else dialog.setAttribute('aria-labelledby',priorLabel)});
  const undo=document.createElement('button');undo.type='button';undo.textContent='撤销移除';undo.className='canvas-view-undo';undo.hidden=true;form.querySelector('[role=status]').after(undo);
  undo.onclick=()=>{
   if(!active()||!removed)return;let rows;try{rows=read(key)}catch(error){message(error.message||'浏览器暂时不能读取视角。');return}
   if(rows.length>=limit||rows.some(p=>p.id===removed.row.id||p.name===removed.row.name)){message('已有同名视角或记录已满，暂时不能恢复。移除的位置仍保留到你关闭面板。');return}
   rows.splice(Math.min(removed.at,rows.length),0,removed.row);
   try{localStorage.setItem(key,JSON.stringify(rows))}catch{message('浏览器没有保存这次恢复，移除的位置仍保留到你关闭面板。');return}
   removed=null;undo.hidden=true;render();message('已恢复视角。');input.focus({preventScroll:true});
  };
  function render(){
   if(!active())return;list.replaceChildren();let rows;try{rows=read(key)}catch(error){message(error.message||'浏览器暂时不能读取视角。');return}
   if(!rows.length){const empty=document.createElement('p');empty.className='canvas-view-empty';empty.textContent='还没有保存位置。先给当前区域起个名称。';list.append(empty);return}
   for(const row of rows){
    const line=document.createElement('div'),go=document.createElement('button'),remove=document.createElement('button'),name=document.createElement('span'),scale=document.createElement('small');line.className='canvas-view-row';go.type=remove.type='button';go.className='canvas-view-go';name.textContent=row.name;scale.textContent=Math.round(row.z*100)+'%';go.append(name,scale);remove.className='canvas-view-remove';remove.textContent='×';remove.setAttribute('aria-label','移除视角：'+row.name);line.append(go,remove);list.append(line);
    const fresh=()=>{if(!active())return false;let rows;try{rows=read(key)}catch(error){message(error.message||'浏览器暂时不能读取视角。');return false}if(!rows.some(p=>same(p,row))){message('这项视角已在另一窗口改变。请重新打开面板，原记录保留。');return false}return rows};
    go.onclick=()=>{if(!fresh())return;$('dialog').close();navigate(row)};
    remove.onclick=()=>{const rows=fresh();if(!rows)return;try{localStorage.setItem(key,JSON.stringify(rows.filter(p=>p.id!==row.id)))}catch{message('浏览器没有保存这次移除，原视角仍保留。');return}removed={row,at:rows.findIndex(p=>p.id===row.id)};undo.hidden=false;render();input.focus({preventScroll:true});message('已移除视角。便签和白板内容保持原样。')};
   }
  }
  form.querySelector('[data-view=selection]').disabled=!selection;
  form.querySelector('[data-view=all]').disabled=!board.nodes.length;
  for(const button of form.querySelectorAll('[data-view]'))button.onclick=()=>{
   if(!active())return;const value=button.dataset.view;
   if(value==='selection'&&!selection)return;
   $('dialog').close();if(value==='all'){if(!returning||returning.returned)returning={source:board,id:boardId,value:camera()};fit();positionReturn();canvas.focus({preventScroll:true})}else navigate(value==='selection'?selection:{...savedCamera,z:1});
  };
  form.querySelector('form').onsubmit=event=>{
   event.preventDefault();if(!active())return;const name=input.value.trim();if(!name){message('请给这个位置起一个名称。');input.focus();return}
   let rows;try{rows=read(key)}catch(error){message(error.message||'浏览器暂时不能读取视角。');return}
   if(rows.some(p=>p.name===name)){message('已有同名视角。请换个名称，原位置保留。');input.focus();return}
   if(rows.length>=limit){message('这张白板已保存 40 个视角。先移除不再需要的位置，再保存。');return}
   try{localStorage.setItem(key,JSON.stringify([...rows,{id:uid(),name,...savedCamera}]))}catch{message('浏览器没有保存这次视角，你输入的名称仍在这里。');return}
   input.value='';render();message('已保存视角，只在这个浏览器使用。');input.focus({preventScroll:true});
  };
  render();form.querySelector('[data-view]:not(:disabled)').focus({preventScroll:true});
 }
 const previousMenu=fileMenu;fileMenu=function(event,items){if(event.target.closest?.('#canvas')&&!event.target.closest('.node,[data-edge],input,textarea,button'))items=[['视角与位置  Shift+V',open],...items];return previousMenu(event,items)};
 window.addEventListener('keydown',event=>{if(event.shiftKey&&event.code==='KeyV'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.isComposing&&!isTyping(event)&&!event.target.closest?.('#workspaceSidebar,header,#fileContext')&&!$('dialog').open){event.preventDefault();event.stopImmediatePropagation();open()}},true);
 const guide=$('canvasGuide'),previousGuide=guide.onclick;guide.onclick=function(event){previousGuide.call(this,event);const p=document.createElement('p');p.textContent='Shift+V 打开视角与位置，也可以右键画布空白处。给常用位置起个名称，再回来时更容易找到。';$('dialogBody').append(p)};
 const previousView=moveView;moveView=function(){previousView();positionReturn()};
 window.addEventListener('creative-board-loading',()=>{returning=null;positionReturn()});
 new ResizeObserver(positionReturn).observe(canvas);
 window.whiteboardCanvasViews={open,navigate};
})();

// Resume only a uniquely verified, existing note. Authored documents stay unchanged.
(() => {
 'use strict';
 if(new URLSearchParams(location.search).get('explorer')==='1')return;
 const hosted=window.whiteboardHosted,scope=hosted?Object.freeze({base:String(hosted.base),account:String(hosted.account.id),workspace:String(hosted.workspace)}):null;
 const maximumBytes=512*1024,maximumRevisions=6,maximumMs=5000,keys=['title','body','userText','annotation'];
 const bar=document.createElement('div');bar.className='writing-resume inline-ui';bar.hidden=true;canvas.append(bar);
 let job=null,opening=null,dismissed=null,lastMetrics={phase:'idle'};
 const label=n=>String(n.title||'').trim()||String(n.body||'').split('\n').find(line=>line.trim())?.trim().slice(0,60)||'未命名';
 const active=j=>job===j&&!j.controller.signal.aborted&&board===j.source&&boardId===j.id&&etag===j.etag&&contentRevision===j.revision&&!loading&&!blocked&&!saveError&&!dirty&&!savePromise&&dismissed!==j.source&&!hosted?.paused;
 function cancel(){job?.controller.abort();job=null;}
 function position(){
  const place=opening;if(!place||place.source!==board||place.id!==boardId||place.etag!==etag||place.revision!==contentRevision||dismissed===board||loading||blocked||saveError||gesture||$('dialog').open||hosted?.paused){bar.hidden=true;return;}
  const n=board.nodes.find(n=>n.id===place.nodeId);if(!n||n.type!=='note'){bar.hidden=true;return;}
  const c=canvas.getBoundingClientRect(),v=view(),left=n.x*v.z+v.x,top=n.y*v.z+v.y;if(c.width<1||c.height<1||left+n.w*v.z>0&&left<c.width&&top+n.h*v.z>0&&top<c.height){bar.hidden=true;return;}
  const title=bar.querySelector('b'),button=bar.querySelector('button');title.textContent=label(n);button.setAttribute('aria-label','接着写：'+label(n));
  const tools=$('canvasTools').getBoundingClientRect(),dock=$('creationDock'),compact=c.height<240;bar.classList.toggle('compact',compact);bar.style.left='';bar.style.right='16px';bar.style.maxWidth='';bar.hidden=false;
  const h=bar.getBoundingClientRect().height,d=dock?.getClientRects().length?dock.getBoundingClientRect():null,available=tools.left-c.left-24;
  if(compact&&available>=112){bar.style.left='16px';bar.style.right='auto';bar.style.maxWidth=available+'px';bar.style.top=tools.top-c.top+'px';}
  else{const room=(d?d.top:c.bottom-8)-tools.bottom;if(room<h){bar.hidden=true;return;}bar.style.top=tools.bottom-c.top+Math.min(8,(room-h)/2)+'px';}
 }
 function mount(place){
  bar.replaceChildren();if(!place)return;
  const button=document.createElement('button'),dismiss=document.createElement('button'),caption=document.createElement('small'),title=document.createElement('b');button.type=dismiss.type='button';caption.textContent='接着写';button.append(caption,title);dismiss.textContent='×';dismiss.setAttribute('aria-label','暂不接着写');bar.append(button,dismiss);
  const owns=()=>opening===place&&place.source===board&&place.id===boardId&&place.etag===etag&&place.revision===contentRevision&&dismissed!==board&&!bar.hidden&&bar.isConnected&&button.parentElement===bar&&!loading&&!blocked&&!saveError&&!gesture&&!$('dialog').open&&!hosted?.paused;
  button.onclick=()=>{if(!owns())return;const n=board.nodes.find(n=>n.id===place.nodeId);if(!n||n.type!=='note')return;dismissed=board;bar.hidden=true;const c=canvas.getBoundingClientRect(),z=Math.max(.15,Math.min(1.1,view().z,(c.width-48)/n.w,(c.height-100)/n.h));whiteboardCanvasViews.navigate({cx:n.x+n.w/2,cy:n.y+n.h/2,z});selected=new Set([n.id]);refreshSelectionUI();whiteboardReading.open(n.id);};
  dismiss.onclick=()=>{if(!owns())return;dismissed=board;bar.hidden=true;canvas.focus({preventScroll:true});};
 }
 async function boundedJSON(j,suffix){
  if(!active(j))throw Error('inactive');const path=scope?scope.base+'native/history/boards/'+encodeURIComponent(j.id)+suffix:'/api/history/boards/'+encodeURIComponent(j.id)+suffix,url=new URL(path,location.href);if(url.origin!==location.origin)throw Error('scope');
  const headers=scope?{'X-Creative-Account':scope.account}:{};const start=performance.now(),response=await fetch(url,{headers,signal:j.controller.signal,credentials:'same-origin',cache:'no-store',redirect:'error'});j.metrics.requestMs+=performance.now()-start;j.metrics.requests++;
  if(response.status===401){hosted?.pause?.('原登录已经失效。');throw Error('authentication');}
  const length=Number(response.headers.get('Content-Length'));if(length>maximumBytes-j.metrics.bytes){await response.body?.cancel();throw Error('byte-budget');}
  const reader=response.body?.getReader();if(!reader)throw Error('stream');const chunks=[];let size=0,readStart=performance.now();
  try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;j.metrics.bytes+=item.value.byteLength;if(j.metrics.bytes>maximumBytes){await reader.cancel();throw Error('byte-budget');}chunks.push(item.value);if(!active(j)){await reader.cancel();throw Error('inactive');}}}finally{j.metrics.readMs+=performance.now()-readStart;reader.releaseLock();}
  const decodeStart=performance.now(),raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.byteLength;}const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));j.metrics.decodeParseMs+=performance.now()-decodeStart;
  if(response.status===409&&value.code==='account_changed'){hosted?.pause?.('登录账号已经改变。');throw Error('authentication');}if(!response.ok)throw Error('history-'+response.status);return value;
 }
 function historyNodes(value){if(!value||!Array.isArray(value.nodes)||value.nodes.length>5000)throw Error('history-format');const rows=new Map();for(const n of value.nodes){if(typeof n?.id!=='string'||rows.has(n.id))throw Error('history-format');if(n.type==='note'&&keys.some(key=>n[key]!==undefined&&typeof n[key]!=='string'))throw Error('history-format');rows.set(n.id,n);}return rows;}
 function sameCurrent(a,b){let remaining=30000;function equal(a,b,depth){if(--remaining<0||depth>64)throw Error('comparison-budget');if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const names=Object.keys(a);return names.length===Object.keys(b).length&&names.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key],depth+1));}return equal(a,b,0);}
 function difference(after,before){const changed=[];for(const [id,n]of after){const old=before.get(id);if(!old)return {ambiguous:true};if(!sameCurrent(n,old))changed.push(id);}for(const id of before.keys())if(!after.has(id))return {ambiguous:true};if(changed.length>1)return {ambiguous:true};if(!changed.length)return {id:null};const id=changed[0],n=after.get(id),old=before.get(id);if(n.type!=='note'||old.type!=='note'||!keys.some(key=>(n[key]||'')!==(old[key]||'')))throw Error('not-writing-history');return {id};}
 async function discover(){
  cancel();opening=null;bar.hidden=true;mount(null);dismissed=null;
  if(!board||loading||blocked||saveError||dirty||savePromise||!boardId||!/^[a-zA-Z0-9_-]{1,100}$/.test(boardId)||$('dialog').open||hosted?.paused)return;
  const c=canvas.getBoundingClientRect(),v=view();if(!board.nodes.some(n=>n.type==='note'&&(n.x*v.z+v.x>=c.width||(n.x+n.w)*v.z+v.x<=0||n.y*v.z+v.y>=c.height||(n.y+n.h)*v.z+v.y<=0)))return;
  const j={source:board,id:boardId,etag,revision:contentRevision,controller:new AbortController(),metrics:{phase:'checking',requests:0,revisions:0,bytes:0,requestMs:0,readMs:0,decodeParseMs:0,compareMs:0,scope:scope?'hosted-original':'desktop-original'}};job=j;lastMetrics=j.metrics;const start=performance.now(),timer=setTimeout(()=>j.controller.abort(),maximumMs);
  try{let current=historyNodes(board);const rows=await boundedJSON(j,'');if(!Array.isArray(rows)||rows.length>1000||rows.some(r=>typeof r?.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(r.id)||!Number.isFinite(r.savedAt)))throw Error('history-list');for(const row of rows.slice(0,maximumRevisions)){if(row.deleted)throw Error('deleted-history');const revision=await boundedJSON(j,'/'+encodeURIComponent(row.id));j.metrics.revisions++;if(revision.deleted)throw Error('deleted-history');const compareStart=performance.now();try{if(scope&&j.metrics.revisions===1&&!sameCurrent(board,revision.value))throw Error('current-history-mismatch');const previous=historyNodes(revision.value),diff=difference(current,previous);if(diff.ambiguous)throw Error('multiple-objects');if(diff.id){if(!active(j))throw Error('inactive');const n=board.nodes.find(n=>n.id===diff.id);if(!n||n.type!=='note')throw Error('missing-current-object');opening={source:board,id:boardId,etag,revision:contentRevision,nodeId:n.id};mount(opening);position();j.metrics.phase='matched';j.metrics.nodeId=n.id;return;}current=previous;}finally{j.metrics.compareMs+=performance.now()-compareStart;}}j.metrics.phase='no-unique-history';}
  catch(error){const code=error?.message||'';j.metrics.phase=j.controller.signal.aborted?'cancelled':error instanceof SyntaxError?'history-json':/^(inactive|scope|authentication|byte-budget|stream|history-\d{3}|history-format|history-list|deleted-history|multiple-objects|missing-current-object|comparison-budget|current-history-mismatch|not-writing-history)$/.test(code)?code:'history-unavailable';}
  finally{clearTimeout(timer);j.metrics.totalMs=performance.now()-start;if(job===j)job=null;if(lastMetrics===j.metrics)lastMetrics={...j.metrics};}
 }
 const previousLoad=loadBoard;loadBoard=async function(...args){cancel();opening=null;bar.hidden=true;mount(null);const ok=await previousLoad(...args);if(ok)discover();return ok;};
 document.addEventListener('pointerdown',event=>{if(!bar.contains(event.target)&&board){dismissed=board;cancel();bar.hidden=true;}},true);document.addEventListener('keydown',event=>{if(!bar.contains(event.target)&&board){dismissed=board;cancel();bar.hidden=true;}},true);
 bar.addEventListener('pointerdown',event=>event.stopPropagation());bar.addEventListener('dblclick',event=>event.stopPropagation());
 const previousView=moveView;moveView=function(){previousView();position();};new ResizeObserver(position).observe(canvas);new MutationObserver(position).observe($('dialog'),{attributes:true,attributeFilter:['open']});
 window.addEventListener('creative-board-loading',()=>{if(loading){cancel();opening=null;bar.hidden=true;}});
 window.whiteboardWritingContinuation={status:()=>({...lastMetrics})};
})();
