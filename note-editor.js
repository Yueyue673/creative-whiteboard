// Authored Markdown stays portable text. Tools change only the user's selection.
(() => {
 'use strict';
 const parser=window.markdownit({html:false,linkify:false,typographer:false,breaks:true});
 // Markdown images remain text: source attachments already have a controlled viewer.
 parser.renderer.rules.image=(tokens,i)=>esc(tokens[i].content||'图片');
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
 const originalMarkup=noteMarkup;
 noteMarkup=function(n){
  let html=originalMarkup(n);
  if(n.type==='note'&&!n.assetId&&!n.mediaId&&!n.images?.length)html=html.replace('class="node ','class="node paper-card paper-'+(['lined','grid'].includes(n.paperStyle)?n.paperStyle:'plain')+' ');
  if(n.textFormat==='markdown'&&!(editorId===n.id&&selected.has(n.id))){
   for(const key of ['body','userText','annotation'])html=html.replace(new RegExp('<textarea\\b[^>]*data-preview-id="'+key+'"[^>]*>[\\s\\S]*?</textarea>'),'<div class="note-markdown" data-markdown-field="'+key+'">'+rendered(n[key])+'</div>');
  }
  return html;
 };
 let panel=null,owner=null,field=null,range=null,preview=false,colourCheckpoint=null;
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
  }
  change();
 }
 function openColour(trigger,n){const box=popup(trigger,n,'colour');if(!box)return;
  box.innerHTML='<header><b>便签外观</b><button type="button" aria-label="关闭便签外观">×</button></header><div class="note-colours">'+swatches.map(([value,name])=>'<button type="button" data-colour="'+value+'" aria-label="'+name+'" title="'+name+'" style="--swatch:'+value+'" aria-pressed="'+(n.color===value)+'"></button>').join('')+'</div><label class="note-custom-colour">自定义颜色<input type="color" aria-label="自定义便签颜色" value="'+esc(/^#[0-9a-f]{6}$/i.test(n.color||'')?n.color:'#fff0aa')+'"><input type="text" aria-label="便签颜色值" maxlength="7" value="'+esc(n.color||'#fff0aa')+'"></label><div class="note-paper-choices">'+paperChoices.map(([value,label])=>'<button type="button" data-paper="'+value+'" aria-pressed="'+((n.paperStyle||'plain')===value)+'">'+label+'</button>').join('')+'</div>';
  box.querySelector('header button').onclick=closePanel;
  const colour=box.querySelector('input[type=color]'),hex=box.querySelector('input[type=text]');
  const refresh=()=>{colour.value=hex.value=n.color;box.querySelectorAll('[data-colour]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.colour===n.color)));box.querySelectorAll('[data-paper]').forEach(b=>b.setAttribute('aria-pressed',String((n.paperStyle||'plain')===b.dataset.paper)));trigger.style.setProperty('--swatch',n.color)};
  const choose=value=>{if(n.color===value)return;n.color=value;updateSurface(n);refresh()};
  box.querySelectorAll('[data-colour]').forEach(b=>b.onclick=()=>{if(n.color===b.dataset.colour)return;checkpoint();colourCheckpoint=null;choose(b.dataset.colour)});
  colour.oninput=()=>{if(n.color===colour.value)return;if(!colourCheckpoint||history.at(-1)!==colourCheckpoint)colourCheckpoint=checkpoint();choose(colour.value)};colour.onchange=()=>colourCheckpoint=null;
  hex.onchange=()=>{if(!/^#[0-9a-f]{6}$/i.test(hex.value)){hex.setCustomValidity('请填写完整颜色，例如 #fff0aa');hex.reportValidity();return}hex.setCustomValidity('');if(n.color!==hex.value){checkpoint();choose(hex.value)}};hex.oninput=()=>hex.setCustomValidity('');
  box.querySelectorAll('[data-paper]').forEach(b=>b.onclick=()=>{if((n.paperStyle||'plain')===b.dataset.paper)return;checkpoint();n.paperStyle=b.dataset.paper;updateSurface(n);refresh()});show(trigger);
 }
 function remember(el){if(el?.matches('textarea')&&['body','userText','annotation'].includes(el.id)){field=el;range={start:el.selectionStart,end:el.selectionEnd}}}
 function setText(n,value,start,end){if(!field?.isConnected)return;checkpoint();n.textFormat='markdown';n[field.id]=value;field.value=value;const meta=field.closest('details');if(meta)meta.open=true;field.focus({preventScroll:true});field.setSelectionRange(start,end);range={start,end};field.dispatchEvent(new Event('input',{bubbles:true}));drawEdges();renderOutline();change();}
 function format(n,kind){
  if(!field?.isConnected)return;const text=field.value,{start,end}=range||{start:field.selectionStart,end:field.selectionEnd};
  const pairs={bold:'**',italic:'*',strike:'~~',highlight:'==',code:'`'};
  if(pairs[kind]){const mark=pairs[kind],selectedText=text.slice(start,end),outer=text.slice(Math.max(0,start-mark.length),start)===mark&&text.slice(end,end+mark.length)===mark&&(kind!=='italic'||(text[start-2]!=='*'&&text[end+1]!=='*'));
   if(outer)setText(n,text.slice(0,start-mark.length)+selectedText+text.slice(end+mark.length),start-mark.length,end-mark.length);
   else setText(n,text.slice(0,start)+mark+selectedText+mark+text.slice(end),start+mark.length,end+mark.length);return;
  }
  const prefixes={heading:'# ',quote:'> ',bullet:'- ',number:'1. ',task:'- [ ] '};
  if(prefixes[kind]){const left=text.lastIndexOf('\n',start-1)+1,right=text.indexOf('\n',end),stop=right<0?text.length:right,prefix=prefixes[kind],lines=text.slice(left,stop).split('\n');const remove=lines.every(line=>line.startsWith(prefix)),changed=lines.map(line=>remove?line.slice(prefix.length):prefix+line).join('\n');setText(n,text.slice(0,left)+changed+text.slice(stop),left,left+changed.length)}
  if(kind==='fence'){const selectedText=text.slice(start,end),begin=(start&&text[start-1]!=='\n'?'\n':'')+'```\n',after='\n```'+(end<text.length&&text[end]!=='\n'?'\n':'');setText(n,text.slice(0,start)+begin+selectedText+after+text.slice(end),start+begin.length,end+begin.length)}
 }
 function openFormat(trigger,n){const box=popup(trigger,n,'format');if(!box)return;
  if(!field?.isConnected){field=document.getElementById('body');remember(field)}
  box.innerHTML='<header><b>文字格式</b><button type="button" aria-label="关闭文字格式">×</button></header><div class="note-format-grid">'+[['bold','粗体','B'],['italic','斜体','I'],['strike','删除线','S'],['highlight','高亮','标记'],['code','行内代码','代码'],['heading','标题','H1'],['quote','引用','引用'],['bullet','无序列表','• 列表'],['number','有序列表','1. 列表'],['task','任务列表','☐ 任务'],['fence','代码块','代码块']].map(([id,label,text])=>'<button type="button" data-format="'+id+'" aria-label="'+label+'" title="'+label+'">'+text+'</button>').join('')+'</div><label class="note-external-link">外部链接<input type="url" aria-label="外部链接网址" placeholder="https://"><button type="button" data-insert-link>插入链接</button></label><label class="note-mode"><input type="checkbox" '+(n.textFormat==='markdown'?'checked':'')+'>按 Markdown 显示</label><p>选中文字后应用；Ctrl+B 粗体，Ctrl+I 斜体。原文保存在便签里。</p>';
  box.querySelector('header button').onclick=closePanel;box.querySelectorAll('[data-format]').forEach(b=>{b.onpointerdown=e=>e.preventDefault();b.onclick=()=>{format(n,b.dataset.format);box.querySelector('input[type=checkbox]').checked=true}});
  box.querySelector('[data-insert-link]').onclick=()=>{const input=box.querySelector('input[type=url]'),url=input.value.trim();if(!/^(https?:\/\/|mailto:)/i.test(url)||!parser.validateLink(url)){input.setCustomValidity('请填写 http、https 或 mailto 链接');input.reportValidity();return}input.setCustomValidity('');if(!field?.isConnected)return;const {start,end}=range||{start:field.selectionStart,end:field.selectionEnd},label=field.value.slice(start,end)||url,link='['+label.replace(/[\\[\]]/g,'\\$&')+'](<'+url.replace(/[<>\s]/g,c=>encodeURIComponent(c))+'>)';setText(n,field.value.slice(0,start)+link+field.value.slice(end),start+link.length,start+link.length);box.querySelector('input[type=checkbox]').checked=true};
  box.querySelector('input[type=url]').oninput=e=>e.target.setCustomValidity('');box.querySelector('input[type=checkbox]').onchange=e=>{checkpoint();n.textFormat=e.target.checked?'markdown':'plain';change()};show(trigger);
 }
 function togglePreview(trigger,n,root){
  preview=!preview;trigger.setAttribute('aria-pressed',String(preview));trigger.textContent=preview?'继续编辑':'预览';
  root.querySelectorAll('textarea#body,textarea#userText,textarea#annotation').forEach(el=>{el.hidden=preview;let view=el.nextElementSibling;if(!view?.classList.contains('note-editor-preview')){view=document.createElement('div');view.className='note-markdown note-editor-preview';el.after(view)}view.hidden=!preview;view.innerHTML=n.textFormat==='markdown'?rendered(el.value):'<p>'+esc(el.value).replace(/\n/g,'<br>')+'</p>'});window.whiteboardSizing?.invalidate(root);
 }
 function references(n){if(n.textFormat!=='markdown')return [];const refs=[];for(const key of ['body','userText','annotation'])for(const block of parser.parse(String(n[key]||''),{}))for(const token of block.children||[])if(token.type==='whiteboard_link')refs.push(token.content.split('|')[0]);return refs}
 function resolveReference(value,records,sourceBoard=boardId){
  const explicit=/^@([a-zA-Z0-9_-]+)\/([^\]|]+)$/.exec(value);
  if(explicit)return records.find(row=>row.board===explicit[1]&&row.node.id===explicit[2]);
  const local=records.filter(row=>row.board===sourceBoard&&(row.node.id===value||row.node.title===value));if(local.length===1)return local[0];
  if(local.length)return null;const global=records.filter(row=>row.node.title===value);return global.length===1?global[0]:null;
 }
 async function allNotes(){
  const response=await api('/api/boards'),list=await response.json(),records=board.nodes.filter(n=>n.type!=='frame').map(node=>({board:boardId,name:board.name,node}));
  let incomplete=false;
  // Read a bounded batch at a time; these are explicit reference browsing requests.
  for(let start=0;start<list.length;start+=4)await Promise.all(list.slice(start,start+4).filter(b=>b.id!==boardId).map(async b=>{try{const data=await(await api('/api/boards/'+encodeURIComponent(b.id))).json();for(const node of data.nodes||[])if(node.type!=='frame')records.push({board:b.id,name:data.name,node})}catch{incomplete=true}}));
  return {records,incomplete};
 }
 async function jumpReference(row){
  closePanel();if(document.getElementById('dialog')?.classList.contains('immersive-dialog'))document.getElementById('dialog').close();
  if(row.board!==boardId){await switchBoard(row.board);if(boardId!==row.board)return}
  const n=board.nodes.find(n=>n.id===row.node.id);if(!n)return toast('这块内容已经移走或删除');
  editorId=null;selected=new Set([n.id]);drawNodes();renderOutline();const rect=canvas.getBoundingClientRect();board.view.x=rect.width/2-(n.x+n.w/2)*view().z;board.view.y=rect.height/2-(n.y+n.h/2)*view().z;moveView();canvas.focus({preventScroll:true});
 }
 async function openLinks(trigger,n){
  const box=popup(trigger,n,'links');if(!box)return;box.setAttribute('aria-label','双向链接');box.innerHTML='<header><b>关联内容</b><button type="button" aria-label="关闭关联内容">×</button></header><p role="status">正在读取可关联的内容…</p>';box.querySelector('button').onclick=closePanel;show(trigger);
  const sourceBoard=boardId;let result;try{result=await allNotes()}catch(error){if(panel===box)box.querySelector('p').textContent='暂时无法读取：'+error.message;return}if(panel!==box||boardId!==sourceBoard||!board.nodes.includes(n))return;
  const records=result.records,backlinks=records.filter(row=>references(row.node).some(ref=>{const target=resolveReference(ref,records,row.board);return target?.board===sourceBoard&&target.node.id===n.id}));
  box.innerHTML='<header><b>关联内容</b><button type="button" aria-label="关闭关联内容">×</button></header><label class="note-link-search">链接到<input type="search" placeholder="搜索便签与白板" aria-label="搜索关联内容"></label><div class="note-link-results"></div><div class="note-backlinks"><b>引用这块内容 · '+backlinks.length+'</b><div></div></div>'+(result.incomplete?'<p role="status">部分白板暂时无法读取，引用列表可能不完整。</p>':'');box.querySelector('header button').onclick=closePanel;
  const rowButton=(row,insert)=>{const b=document.createElement('button');b.type='button';b.className='note-link-row';const title=document.createElement('span'),location=document.createElement('small');title.textContent=row.node.title||'未命名';location.textContent=row.name;b.append(title,location);b.onclick=()=>{if(insert){if(!field?.isConnected){field=document.getElementById('body');remember(field)}if(!field?.isConnected)return;const {start,end}=range||{start:field.selectionStart,end:field.selectionEnd},label=field.value.slice(start,end)||row.node.title||'未命名',safeLabel=label.replace(/\|/g,'').replace(/\]\]/g,']'),link='[[@'+row.board+'/'+row.node.id+'|'+safeLabel+']]';setText(n,field.value.slice(0,start)+link+field.value.slice(end),start+link.length,start+link.length);closePanel()}else jumpReference(row)};return b};
  const list=box.querySelector('.note-link-results'),search=box.querySelector('input');let limit=30;
  const filter=()=>{list.replaceChildren();const query=search.value.toLocaleLowerCase(),matches=records.filter(row=>(row.board!==sourceBoard||row.node.id!==n.id)&&(row.node.title+' '+row.name).toLocaleLowerCase().includes(query));for(const row of matches.slice(0,limit))list.append(rowButton(row,true));if(matches.length>limit){const more=document.createElement('button');more.type='button';more.textContent='显示更多 · '+(matches.length-limit);more.onclick=()=>{limit+=30;filter()};list.append(more)}if(!matches.length){const empty=document.createElement('p');empty.textContent='没有匹配的内容';list.append(empty)}};
  search.oninput=()=>{limit=30;filter()};filter();const incoming=box.querySelector('.note-backlinks>div');for(const row of backlinks)incoming.append(rowButton(row,false));if(!backlinks.length)incoming.textContent='尚未被其他内容引用';positionPanel(trigger);search.focus();
 }
 const originalBind=bindInline;
 bindInline=function(){originalBind();const n=board?.nodes.find(n=>n.id===editorId&&selected.has(n.id)),root=document.querySelector('.live-layout');if(!n||!root)return;closePanel();field=null;range=null;preview=false;
  const bar=root.querySelector('.inline-toolbar');if(!bar||bar.querySelector('.note-edit-tools'))return;
  const tools=document.createElement('div');tools.className='note-edit-tools inline-ui';tools.innerHTML='<button type="button" id="noteColour" aria-label="便签颜色与纸面" title="颜色与纸面" style="--swatch:'+esc(n.color||'#fff0aa')+'"><i></i><span>外观</span></button>'+(n.type!=='table'?'<button type="button" id="noteFormat" title="文字格式">Aa</button><button type="button" id="noteLinks" title="关联内容与反向引用">关联</button><button type="button" id="notePreview" aria-pressed="false">预览</button>':'');bar.prepend(tools);
  tools.querySelector('#noteColour').onclick=()=>openColour(tools.querySelector('#noteColour'),n);
  tools.querySelector('#noteFormat')?.addEventListener('click',()=>openFormat(tools.querySelector('#noteFormat'),n));
  tools.querySelector('#noteLinks')?.addEventListener('click',()=>openLinks(tools.querySelector('#noteLinks'),n));
  tools.querySelector('#notePreview')?.addEventListener('click',()=>{closePanel();togglePreview(tools.querySelector('#notePreview'),n,root)});
  root.querySelectorAll('textarea').forEach(el=>{for(const name of ['focus','select','keyup','pointerup'])el.addEventListener(name,()=>remember(el));el.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.isComposing&&['b','i'].includes(e.key.toLowerCase())&&['body','userText','annotation'].includes(el.id)){e.preventDefault();e.stopPropagation();remember(el);format(n,e.key.toLowerCase()==='b'?'bold':'italic')}})});
 };
 document.addEventListener('pointerdown',e=>{if(panel&&!panel.contains(e.target)&&!owner?.contains(e.target))closePanel()},true);
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&panel){e.preventDefault();e.stopImmediatePropagation();const trigger=owner;closePanel();trigger?.focus({preventScroll:true})}},true);
 document.getElementById('dialog').addEventListener('cancel',e=>{if(!panel)return;e.preventDefault();const trigger=owner;closePanel();trigger?.focus({preventScroll:true})});
 window.addEventListener('resize',closePanel);
 document.addEventListener('click',async e=>{const link=e.target.closest('[data-note-link]');if(!link)return;e.preventDefault();e.stopPropagation();const requestedBoard=boardId,value=link.dataset.noteLink;try{const {records}=await allNotes();if(boardId!==requestedBoard||!link.isConnected)return;const row=resolveReference(value,records);if(row)await jumpReference(row);else toast('没有找到唯一的目标，请从“关联”重新选择')}catch(error){toast('暂时无法打开关联：'+error.message)}});
 const originalDraw=drawNodes;drawNodes=function(){closePanel();originalDraw()};
 const originalAdd=addNote;addNote=function(p=center(),data={}){return originalAdd(p,{...(!data.type||data.type==='note'?{textFormat:'markdown'}:{}),...data})};
 window.whiteboardNoteEditor={render:rendered,format,close:closePanel,dismiss:()=>{const trigger=owner;closePanel();trigger?.focus({preventScroll:true})}};
})();
