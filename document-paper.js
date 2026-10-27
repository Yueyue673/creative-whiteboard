// A long document composes the existing editable note/cell objects in one flow.
// It keeps their IDs, reference handling, native text undo and shared save path.
(() => {
 'use strict';
 const isDocument=n=>n?.type==='table'&&n.documentMode===true;
 const colour=(v,f='#364152')=>/^#[\da-f]{6}$/i.test(v||'')?v:f;
 const font=v=>String(v||'').replace(/["'<>;{}\\]/g,'').slice(0,100);
 const nodeFor=el=>board?.nodes.find(n=>n.id===(el.closest('#immersiveSurface,.node[data-id]')?.dataset.id));
 const live=n=>n&&board?.nodes.includes(n)&&!loading&&!blocked;
 const layout=tableLayout;tableLayout=function(n){return layout(n).replace('<table class="edit-table"','<table '+(isDocument(n)?'data-document-paper="true" ':'')+'class="edit-table"')};
 const content=cellContentMarkup;
 cellContentMarkup=function(n,r,c){
  let html=content(n,r,c);if(!isDocument(n))return html;
  for(const [index,item]of(n.cellItems?.[r]?.[c]||[]).entries()){
   const begin='<section class="cell-content inline-ui',needle='data-cell-item="'+index+'"';
   const start=html.indexOf(needle);if(start<0)continue;const open=html.lastIndexOf(begin,start);if(open>=0){const at=open+begin.length;html=html.slice(0,at)+(item.documentParagraph?' document-paragraph':' document-note')+html.slice(at)}
   if(item.type!=='table')continue;
   const old='<p>内含表格 · '+(item.rows?.length||0)+' 行；取出到白板后编辑</p>';
   const table='<div class="document-table-scroll"><table class="document-embedded-table" data-doc-table="'+index+'"><thead><tr>'+item.columns.map((text,col)=>'<th><textarea data-note-newline="1" data-doc-column="'+col+'" aria-label="文中表格列名 '+(col+1)+'">\n'+esc(text)+'</textarea></th>').join('')+'</tr></thead><tbody>'+item.rows.map((row,ri)=>'<tr>'+row.map((text,ci)=>'<td><textarea data-note-newline="1" data-doc-row="'+ri+'" data-doc-col="'+ci+'" aria-label="文中表格第'+(ri+1)+'行第'+(ci+1)+'列">\n'+esc(text)+'</textarea></td>').join('')+'</tr>').join('')+'</tbody></table><div class="document-table-actions"><button type="button" data-doc-add-row="'+index+'">＋ 行</button><button type="button" data-doc-add-column="'+index+'">＋ 列</button></div></div>';
   html=html.replace(old,table);
  }
  return html;
 };
 const markup=noteMarkup;noteMarkup=function(n,readOnly=false){let html=markup(n,readOnly);if(isDocument(n))html=html.replace('class="node ','class="node document-paper ');return html};
 function append(n,kind,afterId){
  if(!live(n))return;const items=cellItemGrid(n)[0][0],index=afterId===undefined?items.length:items.findIndex(item=>item.id===afterId)+1;if(afterId!==undefined&&index===0)return;
  const owner=board,ownerId=boardId;undoPoint();const item={id:uid(),type:kind==='table'?'table':'note',sizeMode:'auto',x:0,y:0,w:320,h:160,title:'',body:'',tags:[],...(kind==='paragraph'?{documentParagraph:true}:{}),...(kind==='note'?{color:'#fff0b4'}:{}),...(kind==='table'?{columns:['',''],rows:[['',''],['','']]}:{})};
  items.splice(index,0,item);drawNodes();change();
  const focusOwner=document.activeElement;
  requestAnimationFrame(()=>{if(board!==owner||boardId!==ownerId||!live(n)||editorId!==n.id||document.activeElement!==focusOwner)return;const index=n.cellItems[0][0].findIndex(value=>value.id===item.id);if(index<0)return;const root=document.querySelector('#immersiveSurface[data-id="'+CSS.escape(n.id)+'"]')||document.querySelector('#nodes>.node[data-id="'+CSS.escape(n.id)+'"]');const field=root?.querySelector('[data-cell-item="'+index+'"] '+(kind==='table'?'[data-doc-column]':kind==='paragraph'?'[data-cell-note-field="body"]':'[data-cell-note-field="title"]'));field?.focus({preventScroll:true});field?.scrollIntoView({block:'nearest'})});
 }
 // Keep an expanded paper's own menus inside its visible paper.
 const toolPanels=new Map();let toolPanelFrame=0;
 function restoreToolPanel(details){
  const state=toolPanels.get(details);if(!state)return;
  if(state.style===null)state.panel.removeAttribute('style');else state.panel.setAttribute('style',state.style);
  toolPanels.delete(details);
 }
 function placeToolPanels(){
  toolPanelFrame=0;const paper=$('dialog'),paperBox=paper.getBoundingClientRect();
  for(const [details,state]of toolPanels){
   const panel=state.panel,summary=details.querySelector('summary');
   if(!details.isConnected||!details.open||!paper.open||!details.closest('#immersiveSurface')||!summary){restoreToolPanel(details);continue}
   const scroll={top:panel.scrollTop,left:panel.scrollLeft};
   if(state.style===null)panel.removeAttribute('style');else panel.setAttribute('style',state.style);
   const anchor=summary.getBoundingClientRect(),natural=panel.getBoundingClientRect(),gap=8;
   if(natural.left>=paperBox.left+gap&&natural.right<=paperBox.right-gap&&natural.top>=paperBox.top+gap&&natural.bottom<=paperBox.bottom-gap)continue;
   const width=Math.min(natural.width,Math.max(1,paperBox.width-gap*2));
   Object.assign(panel.style,{position:'fixed',boxSizing:'border-box',width:width+'px',maxWidth:width+'px'});
   const height=panel.getBoundingClientRect().height,below=Math.max(1,paperBox.bottom-gap-anchor.bottom-gap),above=Math.max(1,anchor.top-gap-paperBox.top-gap),up=height>below&&above>below,shown=Math.min(height,up?above:below);
   Object.assign(panel.style,{left:Math.max(paperBox.left+gap,Math.min(anchor.left,paperBox.right-width-gap))+'px',top:(up?anchor.top-gap-shown:anchor.bottom+gap)+'px',maxHeight:shown+'px',overflow:'auto'});
   void panel.offsetHeight;panel.scrollTop=scroll.top;panel.scrollLeft=scroll.left;
   const active=document.activeElement;
   if(panel.contains(active)){const box=panel.getBoundingClientRect(),item=active.getBoundingClientRect();if(item.bottom>box.bottom-gap)panel.scrollTop+=item.bottom-box.bottom+gap;else if(item.top<box.top+gap)panel.scrollTop-=box.top+gap-item.top}
  }
 }
 function scheduleToolPanels(){if(toolPanels.size&&!toolPanelFrame)toolPanelFrame=requestAnimationFrame(placeToolPanels)}
 document.addEventListener('toggle',event=>{
  const details=event.target;if(!details.matches?.('.document-format,.document-after'))return;
  if(details.open&&details.closest('#immersiveSurface')&&!toolPanels.has(details)){const panel=details.querySelector(':scope>div');if(panel)toolPanels.set(details,{panel,style:panel.getAttribute('style')})}
  scheduleToolPanels();
 },true);
 window.addEventListener('resize',scheduleToolPanels);new ResizeObserver(scheduleToolPanels).observe($('dialog'));$('dialog').addEventListener('close',scheduleToolPanels);

 // A contextual library read retains the original paragraph and inserts one independent copy.
 const libraryPlaces=new WeakMap();let libraryPicker=null;
 const canTakeLibrary=n=>live(n)&&!saveError&&!window.whiteboardHosted?.paused&&window.whiteboardHosted?.role!=='viewer';
 function rememberLibraryPlace(){
  const field=document.activeElement,root=field?.closest?.('#immersiveSurface'),section=field?.closest?.('[data-cell-item]');
  if(!root||!section||!root.contains(section)||!field.matches('input,textarea')||!field.dataset.cellNoteField)return;
  const n=board?.nodes.find(value=>value.id===root.dataset.id),item=n?.cellItems?.[0]?.[0]?.[+section.dataset.cellItem];
  if(!isDocument(n)||!item)return;
  libraryPlaces.set(root,{itemId:item.id,key:field.dataset.cellNoteField,value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,top:field.scrollTop,left:field.scrollLeft,reading:$('dialog').querySelector('.edit-scroll')?.scrollTop||0});
 }
 for(const event of ['focusin','input','selectionchange'])document.addEventListener(event,rememberLibraryPlace);
 function validLibraryPicker(session){
  return libraryPicker===session&&board===session.owner&&boardId===session.boardId&&canTakeLibrary(session.node)&&editorId===session.node.id&&session.root.isConnected&&$('dialog').open&&session.panel.isConnected;
 }
 function restoreLibraryPlace(session,place=libraryPlaces.get(session.root)){
  if(!place||place.itemId!==session.anchor||board!==session.owner||boardId!==session.boardId||!canTakeLibrary(session.node)||editorId!==session.node.id||!$('dialog').open||!document.hasFocus())return;
  const root=document.querySelector('#immersiveSurface[data-id="'+CSS.escape(session.node.id)+'"]'),index=session.node.cellItems?.[0]?.[0]?.findIndex(item=>item.id===place.itemId),field=root?.querySelector('[data-cell-item="'+index+'"] [data-cell-note-field="'+place.key+'"]');
  if(!field||field.value!==place.value)return;
  field.focus({preventScroll:true});field.setSelectionRange(place.start,place.end,place.direction);field.scrollTop=place.top;field.scrollLeft=place.left;
  const scroll=$('dialog').querySelector('.edit-scroll');if(scroll)scroll.scrollTop=place.reading;
 }
 function closeLibraryPicker(restore=true){
  const session=libraryPicker;if(!session)return false;
  libraryPicker=null;session.resize.disconnect();window.removeEventListener('resize',session.position);session.panel.remove();if(restore)restoreLibraryPlace(session);return true;
 }
 $('dialog').addEventListener('close',()=>closeLibraryPicker(false));
 function libraryPieces(a){
  if(!a||a.archived||a.mime!==bundleMime||!Array.isArray(a.bundle?.nodes)||a.bundle.edges!==undefined&&!Array.isArray(a.bundle.edges))return [];
  const nodes=a.bundle.nodes,edges=a.bundle.edges||[];if(nodes.some(node=>!node||typeof node!=='object')||edges.some(edge=>!edge||typeof edge!=='object'||typeof edge.from!=='string'||typeof edge.to!=='string')||nodes.length===1&&edges.length)return [];
  const counts=new Map(),selfLinked=new Set(edges.filter(edge=>edge.from===edge.to).map(edge=>edge.from));
  for(const node of nodes)counts.set(node.id,(counts.get(node.id)||0)+1);
  return nodes.filter(node=>typeof node.id==='string'&&node.id&&counts.get(node.id)===1&&!selfLinked.has(node.id)&&['note','table'].includes(node.type)&&!node.canvasObject);
 }
 function libraryChoices(){
  const choices=[];
  for(const asset of assetIndex.assets){
   const pieces=libraryPieces(asset);if(!pieces.length)continue;
   const commonText=wfLibraryText({...asset,bundle:{nodes:[],edges:[]}}).toLowerCase();
   for(const piece of pieces)choices.push({asset,piece,commonText,pieceText:wfLibraryText({...asset,title:'',notes:'',folder:'',path:'',tags:[],bundle:{nodes:[piece],edges:[]}}).toLowerCase()});
  }
  return choices;
 }
 const libraryChoiceSnapshot=(a,piece)=>clone({id:a.id,title:a.title,folder:a.folder||'',notes:a.notes||'',tags:a.tags||[],source:a.source||{},updated:a.updated,piece});
 function openDocumentLibrary(n,root,anchor){
  if(root.id!=='immersiveSurface'||!$('dialog').open||!canTakeLibrary(n)||editorId!==n.id)return;
  const items=n.cellItems?.[0]?.[0],index=items?.findIndex(item=>item.id===anchor);if(!(index>=0))return;if(items.filter(item=>item.id===anchor).length!==1)return toast('这段内容暂时无法准确对应，请重新选择。');
  closeLibraryPicker(false);
  const panel=document.createElement('section');panel.className='document-library inline-ui';panel.tabIndex=-1;panel.setAttribute('aria-label','取用库中便签和表格');panel.setAttribute('role','region');
  panel.innerHTML='<div class="document-library-heading"><b>取用库中内容</b><button type="button" data-document-library-return>返回原文</button></div><p data-document-library-destination></p><label>查找便签和表格<input type="search" data-document-library-search autocomplete="off"></label><p data-document-library-status role="status"></p><button type="button" data-document-library-retry hidden>重试</button><div data-document-library-results></div>';
  $('dialog').append(panel);
  const session={owner:board,boardId,node:n,root,anchor,panel,pending:false,epoch:0};libraryPicker=session;
  const search=panel.querySelector('[data-document-library-search]'),status=panel.querySelector('[data-document-library-status]'),retry=panel.querySelector('[data-document-library-retry]'),results=panel.querySelector('[data-document-library-results]');
  session.position=()=>{if(!validLibraryPicker(session)){closeLibraryPicker(false);return}const b=$('dialog').getBoundingClientRect();Object.assign(panel.style,{left:(b.left+8)+'px',top:(b.top+8)+'px',width:Math.min(520,Math.max(1,b.width-16))+'px',maxHeight:Math.max(1,b.height-16)+'px'})};
  session.resize=new ResizeObserver(session.position);session.resize.observe($('dialog'));window.addEventListener('resize',session.position);session.position();
  panel.querySelector('[data-document-library-destination]').textContent='放在第 '+(index+1)+' 块后 · '+String(items[index].title||items[index].body||'表格').split('\n')[0].slice(0,70);
  panel.querySelector('[data-document-library-return]').onclick=()=>closeLibraryPicker();
  let entries=[];
  const busy=value=>{session.pending=value;if(value&&panel.contains(document.activeElement))panel.focus({preventScroll:true});search.disabled=value;retry.disabled=value;for(const button of results.querySelectorAll('button'))button.disabled=value};
  const paint=()=>{
   results.replaceChildren();const query=search.value.trim().toLowerCase(),matches=entries.filter(entry=>entry.commonText.includes(query)||entry.pieceText.includes(query));
   for(const {asset:a,piece} of matches.slice(0,40)){
    const shown=libraryChoiceSnapshot(a,piece),section=document.createElement('section'),heading=document.createElement('b'),location=document.createElement('small'),preview=document.createElement('p'),button=document.createElement('button'),group=a.bundle.nodes.length>1;
    section.dataset.documentLibraryAsset=a.id;section.dataset.documentLibraryPiece=piece.id;heading.textContent=(group?piece.title:a.title)||piece.title||'未命名内容';location.textContent=(group?(a.title||'未命名组合')+' · ':'')+(a.folder||'内容库根目录')+' · '+(piece.type==='table'?(piece.documentMode?'长文':'表格 · '+(piece.rows?.length||0)+' 行'):'便签')+(group?' · 取用 1 块':'');
    const previewText=String(piece.body||piece.userText||piece.annotation||(piece.type==='table'?[(piece.columns||[]).join(' · '),...(piece.rows||[]).slice(0,3).map(row=>row.join(' · '))].join('\n'):piece.title)||'');preview.textContent=previewText.slice(0,500)+(previewText.length>500?'…':'');
    button.type='button';button.textContent='将副本接在原段后';button.dataset.documentLibraryPlace='';section.append(heading,location,preview,button);results.append(section);
    button.onclick=async()=>{
     if(!validLibraryPicker(session)||session.pending)return;busy(true);status.textContent='正在核对库中原件…';
     try{
      const applied=await loadAssets({redraw:false});if(!validLibraryPicker(session))return;
      const current=assetById(shown.id),item=libraryPieces(current).find(piece=>piece.id===shown.piece.id);
      if(!applied||!item||JSON.stringify(libraryChoiceSnapshot(current,item))!==JSON.stringify(shown)){entries=libraryChoices();paint();status.textContent='库中内容已变化，请重新选择。';return}
      const at=n.cellItems?.[0]?.[0]?.findIndex(value=>value.id===anchor);if(!(at>=0)||n.cellItems[0][0].filter(value=>value.id===anchor).length!==1){status.textContent='原段落已改变，请返回原文重新选择。';return}
      const place=libraryPlaces.get(root),copy={...clone(item),id:uid(),libraryOrigin:{id:current.id,nodeId:item.id,name:current.title,source:clone(current.source||{})}};
      undoPoint();n.cellItems[0][0].splice(at+1,0,copy);closeLibraryPicker(false);drawNodes();change();
      const focusOwner=document.activeElement;requestAnimationFrame(()=>{if(document.activeElement===focusOwner)restoreLibraryPlace(session,place)});
     }catch(error){if(validLibraryPicker(session)){status.textContent='未能读取库中原件：'+error.message;retry.hidden=false}}
     finally{if(validLibraryPicker(session))busy(false)}
    };
   }
   status.textContent=matches.length?'找到 '+matches.length+' 块内容'+(matches.length>40?'，请继续输入以缩小范围。':''):(query?'没有匹配的便签或表格。':'还没有可取用的便签或表格资源。');
  };
  const read=async()=>{
   if(!validLibraryPicker(session)||session.pending)return;busy(true);retry.hidden=true;status.textContent='正在读取内容库…';results.replaceChildren();const epoch=++session.epoch;
   try{const applied=await loadAssets({redraw:false});if(!validLibraryPicker(session)||session.epoch!==epoch)return;if(!applied){status.textContent='内容库正在刷新，请重试。';retry.hidden=false;return}entries=libraryChoices();paint()}
   catch(error){if(validLibraryPicker(session)){status.textContent='内容库暂时未能读取：'+error.message;retry.hidden=false}}
   finally{if(validLibraryPicker(session)){busy(false);if(document.activeElement===panel.querySelector('[data-document-library-return]')||document.activeElement===$('dialog')||panel.contains(document.activeElement))search.focus({preventScroll:true})}}
  };
  search.oninput=paint;retry.onclick=read;search.focus({preventScroll:true});read();
 }
 function mount(){
  if(libraryPicker&&!validLibraryPicker(libraryPicker))closeLibraryPicker(false);
  const lookup=new Map(board?.nodes.map(n=>[n.id,n])||[]);
  for(const root of document.querySelectorAll('#nodes>.node[data-id],#immersiveSurface[data-id]')){
   const n=lookup.get(root.dataset.id);if(!n)continue;
   if(!isDocument(n)&&!n.fontFamily&&!n.inkColor&&!root.dataset.customFont&&!root.dataset.customInk)continue;
   if(n.fontFamily){root.dataset.customFont='true';root.style.setProperty('--object-font',font(n.fontFamily))}else{delete root.dataset.customFont;root.style.removeProperty('--object-font')}
   if(n.inkColor){root.dataset.customInk='true';root.style.setProperty('--object-ink',colour(n.inkColor))}else{delete root.dataset.customInk;root.style.removeProperty('--object-ink')}
   if(!isDocument(n))continue;
   for(const section of root.querySelectorAll('.document-paragraph'))section.querySelector('[data-cell-note-field="body"]')?.setAttribute('placeholder','继续写…');
   const editing=root.querySelector('.live-layout');if(!editing||!live(n))continue;
   const toolbar=editing.querySelector('.inline-toolbar');
   if(toolbar&&!toolbar.querySelector('.document-insert')){
    const tools=document.createElement('div');tools.className='document-insert';tools.setAttribute('role','group');tools.setAttribute('aria-label','插入文中');
    for(const [kind,label]of[['paragraph','正文'],['note','便签'],['table','表格']]){const b=document.createElement('button');b.type='button';b.textContent='＋ '+label;b.onclick=e=>{e.stopPropagation();if(live(n)&&editorId===n.id)append(n,kind)};tools.append(b)}toolbar.prepend(tools);
   }
   if(toolbar&&!toolbar.querySelector('.document-after')){
    const after=document.createElement('details');after.className='document-after inline-ui';
    const summary=document.createElement('summary'),panel=document.createElement('div'),caption=document.createElement('p');summary.textContent='在此处后添加';caption.className='document-after-context';panel.append(caption);after.append(summary,panel);toolbar.insertBefore(after,toolbar.querySelector('.document-insert').nextSibling);
    const owner=board,ownerId=boardId;let anchor=null;
    const valid=()=>board===owner&&boardId===ownerId&&live(n)&&editorId===n.id&&after.isConnected;
    const ready=()=>valid()&&anchor!==null&&n.cellItems?.[0]?.[0]?.some(item=>item.id===anchor);
    const sync=()=>{const enabled=!!ready();summary.setAttribute('aria-disabled',String(!enabled));summary.tabIndex=enabled?0:-1;summary.title=enabled?'在选中的原文块后添加':'先选择长文里的一段或材料';for(const button of panel.querySelectorAll('button'))button.disabled=!enabled;if(!enabled)after.open=false};
    summary.addEventListener('click',e=>{if(!ready()){e.preventDefault();e.stopPropagation()}});
    summary.addEventListener('keydown',e=>{if(!ready()&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopImmediatePropagation()}});
    const update=e=>{const section=e.target.closest?.('[data-cell-item]');if(section&&editing.contains(section)){
     const item=n.cellItems?.[+section.dataset.cellR]?.[+section.dataset.cellC]?.[+section.dataset.cellItem];if(!item||+section.dataset.cellR!==0||+section.dataset.cellC!==0)return;
     anchor=item.id;sync();
     caption.textContent='第 '+(+section.dataset.cellItem+1)+' 块 · '+String(item.title||item.body||(item.type==='table'?'表格':'正文')).split('\n')[0].slice(0,70);
    }else if(e.target.matches?.('#title')){anchor=null;sync()}};
    editing.addEventListener('pointerdown',update);editing.addEventListener('focusin',update);editing.addEventListener('input',update);
    for(const [kind,label]of[['paragraph','正文'],['note','便签'],['table','表格']]){const button=document.createElement('button');button.type='button';button.dataset.documentAfter=kind;button.textContent=label;button.onclick=e=>{e.preventDefault();e.stopPropagation();if(!ready())return;after.open=false;append(n,kind,anchor)};panel.append(button)}
    {const take=document.createElement('button');take.type='button';take.textContent='从内容库取用…';take.dataset.documentLibraryOpen='';take.hidden=root.id!=='immersiveSurface';take.onclick=e=>{e.preventDefault();e.stopPropagation();const surface=take.closest('#immersiveSurface');if(!ready()||!surface)return;after.open=false;openDocumentLibrary(n,surface,anchor)};panel.append(take)}
    after.addEventListener('keydown',e=>{if(e.key==='Escape'&&after.open){e.preventDefault();e.stopImmediatePropagation();after.open=false;summary.focus({preventScroll:true})}});
    sync();update({target:document.activeElement});
   }
   const libraryButton=toolbar?.querySelector('[data-document-library-open]');if(libraryButton)libraryButton.hidden=root.id!=='immersiveSurface';
   if(toolbar&&!toolbar.querySelector('.document-format')){
    const format=document.createElement('details');format.className='document-format inline-ui';format.innerHTML='<summary>字体 / 颜色</summary><div><label>字体名称<input data-document-font maxlength="100" placeholder="设备上已安装的字体" value="'+esc(n.fontFamily||'')+'"></label><label>文字颜色<input data-document-ink type="color" value="'+colour(n.inkColor)+'"></label><button type="button" data-document-default>恢复默认</button></div>';toolbar.append(format);
    const source=board,sourceId=boardId;const valid=()=>source===board&&sourceId===boardId&&live(n)&&format.isConnected;
    const apply=(family,ink)=>{if(!valid()||family===(n.fontFamily||'')&&ink===(n.inkColor||''))return;undoPoint();if(family)n.fontFamily=family;else delete n.fontFamily;if(ink)n.inkColor=ink;else delete n.inkColor;mount();growContentFields(format.closest('.node')||root);change()};
    format.querySelector('[data-document-font]').onchange=e=>apply(font(e.target.value),n.inkColor||'');format.querySelector('[data-document-ink]').onchange=e=>apply(n.fontFamily||'',e.target.value);format.querySelector('[data-document-default]').onclick=()=>{apply('','');format.querySelector('[data-document-font]').value='';format.querySelector('[data-document-ink]').value='#364152'};
    format.addEventListener('keydown',e=>{if(e.key==='Escape'&&format.open){e.preventDefault();e.stopImmediatePropagation();format.open=false;format.querySelector('summary').focus()}});
   }
   for(const table of root.querySelectorAll('[data-doc-table]')){
    const item=n.cellItems?.[0]?.[0]?.[+table.dataset.docTable];if(item?.type!=='table')continue;
    for(const field of table.querySelectorAll('textarea')){
     if(field.dataset.docBound)continue;field.dataset.docBound='true';
     const col=Number(field.dataset.docColumn??field.dataset.docCol),row=field.dataset.docRow===undefined?null:Number(field.dataset.docRow);
     bindContentInput(field,()=>row===null?item.columns[col]:item.rows[row][col],value=>{if(!live(n)||!n.cellItems[0][0].includes(item))return;if(row===null)item.columns[col]=value;else item.rows[row][col]=value;growContentFields(field.closest('.document-table-scroll'));change()});
    }
   }
   for(const button of root.querySelectorAll('[data-doc-add-row],[data-doc-add-column]'))button.onclick=e=>{
    e.stopPropagation();if(!live(n)||editorId!==n.id)return;const index=Number(button.dataset.docAddRow??button.dataset.docAddColumn),item=n.cellItems?.[0]?.[0]?.[index];if(item?.type!=='table')return;
    const row=button.hasAttribute('data-doc-add-row');if(row&&item.rows.length>=5000||!row&&item.columns.length>=100)return toast('表格已到数量上限');undoPoint();
    if(row)item.rows.push(item.columns.map(()=>''));else{item.columns.push('');item.rows.forEach(r=>r.push(''))}drawNodes();change();
   };
  }
  scheduleToolPanels();
 }
 const draw=drawNodes;drawNodes=function(){draw();mount()};const refresh=refreshSelectionUI;refreshSelectionUI=function(){refresh();mount()};const bind=bindInline;bindInline=function(...args){const result=bind(...args);mount();return result};
 document.addEventListener('pointerdown',e=>{for(const format of document.querySelectorAll('.document-format[open],.document-after[open]'))if(!format.contains(e.target))format.open=false},true);
 document.addEventListener('input',e=>{const table=e.target.closest('[data-document-paper]');if(table)growContentFields(table)});
 const documentButton=document.createElement('button');documentButton.id='addDocument';documentButton.type='button';documentButton.textContent='长文';documentButton.title='写长文，插入便签与表格';($('creationDock')||canvas).append(documentButton);
 documentButton.onclick=()=>{
  if(!board||loading||blocked)return;cancelCanvasGesture();undoPoint();const p=center(),base={x:p.x-320,y:p.y-200,w:640,h:720},rect=window.whiteboardExperience?.newContentRect?.(base,{readingColumn:true})||base,n={id:uid(),type:'table',documentMode:true,title:'',body:'',tags:[],color:'#fffefa',...rect,columns:['正文'],rows:[['']],cellItems:[[[{id:uid(),type:'note',documentParagraph:true,title:'',body:'',x:0,y:0,w:320,h:160,tags:[]}]]],sizeMode:'manual'};
  board.nodes.push(n);selected=new Set([n.id]);editorId=null;render();change();whiteboardReading.open(n.id);$('title')?.setAttribute('placeholder','文档标题');$('title')?.focus();
 };
 const startDocument=document.createElement('button');startDocument.id='emptyDocument';startDocument.textContent='写长文';startDocument.onclick=()=>documentButton.click();$('empty')?.querySelector('.empty-actions')?.append(startDocument);
 const menu=fileMenu;fileMenu=function(e,items){if(e.target?.id==='creationMore')items=[['形状与画笔',()=>whiteboardCanvasObjects.showTools()],['写长文',()=>documentButton.click()],...items];return menu(e,items)};
 const typeButton=document.createElement('button');typeButton.id='contentTypeface';typeButton.type='button';typeButton.textContent='字体 / 颜色';typeButton.onclick=()=>{
  const n=board?.nodes.find(n=>n.id===(editorId||[...selected][0]));if(!live(n)||selected.size!==1)return toast('先选中一块内容');const session={board,boardId,node:n};
  showDialog('<h2>字体与文字颜色</h2><label>字体名称<input id="contentFontFamily" maxlength="100" placeholder="设备上已安装的字体；留空用默认字体" value="'+esc(n.fontFamily||'')+'"></label><label>文字颜色<input id="contentInk" type="color" value="'+colour(n.inkColor)+'"></label><label><input id="contentDefaultInk" type="checkbox" '+(!n.inkColor?'checked':'')+'>自动适应纸面颜色</label>',[['取消',()=>$('dialog').close()],['应用',()=>{if(board!==session.board||boardId!==session.boardId||!live(n))return $('dialog').close();const family=font($('contentFontFamily').value),ink=$('contentDefaultInk').checked?'':$('contentInk').value;if(family!==(n.fontFamily||'')||ink!==(n.inkColor||'')){undoPoint();if(family)n.fontFamily=family;else delete n.fontFamily;if(ink)n.inkColor=ink;else delete n.inkColor;change();drawNodes()}$('dialog').close()}]]);
 };($('textSizeTools')?.querySelector('.text-size-popup')||$('drawingTools')?.querySelector('div')||$('creationDock')).append(typeButton);
 for(const key of ['documentMode','documentParagraph','fontFamily','inkColor'])if(!wfContentFields.includes(key))wfContentFields.push(key);Object.assign(wfLabels,{documentMode:'长文排版',documentParagraph:'正文段落',fontFamily:'字体',inkColor:'文字颜色'});
 const dismissFormat=()=>{if(closeLibraryPicker())return true;const format=document.querySelector('.document-format[open],.document-after[open]');if(!format)return false;format.open=false;format.querySelector('summary').focus({preventScroll:true});return true};
 window.whiteboardDocumentPaper={isDocument,append,dismissFormat};let scheduled=false;new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;mount()})}}).observe($('dialog'),{childList:true,subtree:true});if(board)mount();
})();
