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
 function append(n,kind){
  if(!live(n))return;undoPoint();const item={id:uid(),type:kind==='table'?'table':'note',sizeMode:'auto',x:0,y:0,w:320,h:160,title:'',body:'',tags:[],...(kind==='paragraph'?{documentParagraph:true}:{}),...(kind==='note'?{color:'#fff0b4'}:{}),...(kind==='table'?{columns:['',''],rows:[['',''],['','']]}:{})};
  cellItemGrid(n)[0][0].push(item);drawNodes();change();
  requestAnimationFrame(()=>{const root=document.querySelector('#immersiveSurface[data-id="'+CSS.escape(n.id)+'"]')||document.querySelector('#nodes>.node[data-id="'+CSS.escape(n.id)+'"]');const field=root?.querySelector('[data-cell-item="'+(n.cellItems[0][0].length-1)+'"] '+(kind==='table'?'[data-doc-column]':kind==='paragraph'?'[data-cell-note-field="body"]':'[data-cell-note-field="title"]'));field?.focus({preventScroll:true});field?.scrollIntoView({block:'nearest'})});
 }
 function mount(){
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
 }
 const draw=drawNodes;drawNodes=function(){draw();mount()};const refresh=refreshSelectionUI;refreshSelectionUI=function(){refresh();mount()};const bind=bindInline;bindInline=function(...args){const result=bind(...args);mount();return result};
 document.addEventListener('pointerdown',e=>{for(const format of document.querySelectorAll('.document-format[open]'))if(!format.contains(e.target))format.open=false},true);
 document.addEventListener('input',e=>{const table=e.target.closest('[data-document-paper]');if(table)growContentFields(table)});
 const documentButton=document.createElement('button');documentButton.id='addDocument';documentButton.type='button';documentButton.textContent='长文';documentButton.title='写长文，插入便签与表格';($('creationDock')||canvas).append(documentButton);
 documentButton.onclick=()=>{
  if(!board||loading||blocked)return;cancelCanvasGesture();undoPoint();const p=center(),n={id:uid(),type:'table',documentMode:true,title:'',body:'',tags:[],color:'#fffefa',x:p.x-320,y:p.y-200,w:640,h:720,columns:['正文'],rows:[['']],cellItems:[[[{id:uid(),type:'note',documentParagraph:true,title:'',body:'',x:0,y:0,w:320,h:160,tags:[]}]]],sizeMode:'manual'};
  board.nodes.push(n);selected=new Set([n.id]);editorId=null;render();change();whiteboardReading.open(n.id);$('title')?.setAttribute('placeholder','文档标题');$('title')?.focus();
 };
 const startDocument=document.createElement('button');startDocument.id='emptyDocument';startDocument.textContent='写长文';startDocument.onclick=()=>documentButton.click();$('empty')?.querySelector('.empty-actions')?.append(startDocument);
 const menu=fileMenu;fileMenu=function(e,items){if(e.target?.id==='creationMore')items=[['形状与画笔',()=>whiteboardCanvasObjects.showTools()],['写长文',()=>documentButton.click()],...items];return menu(e,items)};
 const typeButton=document.createElement('button');typeButton.id='contentTypeface';typeButton.type='button';typeButton.textContent='字体 / 颜色';typeButton.onclick=()=>{
  const n=board?.nodes.find(n=>n.id===(editorId||[...selected][0]));if(!live(n)||selected.size!==1)return toast('先选中一块内容');const session={board,boardId,node:n};
  showDialog('<h2>字体与文字颜色</h2><label>字体名称<input id="contentFontFamily" maxlength="100" placeholder="设备上已安装的字体；留空用默认字体" value="'+esc(n.fontFamily||'')+'"></label><label>文字颜色<input id="contentInk" type="color" value="'+colour(n.inkColor)+'"></label><label><input id="contentDefaultInk" type="checkbox" '+(!n.inkColor?'checked':'')+'>自动适应纸面颜色</label>',[['取消',()=>$('dialog').close()],['应用',()=>{if(board!==session.board||boardId!==session.boardId||!live(n))return $('dialog').close();const family=font($('contentFontFamily').value),ink=$('contentDefaultInk').checked?'':$('contentInk').value;if(family!==(n.fontFamily||'')||ink!==(n.inkColor||'')){undoPoint();if(family)n.fontFamily=family;else delete n.fontFamily;if(ink)n.inkColor=ink;else delete n.inkColor;change();drawNodes()}$('dialog').close()}]]);
 };($('textSizeTools')?.querySelector('.text-size-popup')||$('drawingTools')?.querySelector('div')||$('creationDock')).append(typeButton);
 for(const key of ['documentMode','documentParagraph','fontFamily','inkColor'])if(!wfContentFields.includes(key))wfContentFields.push(key);Object.assign(wfLabels,{documentMode:'长文排版',documentParagraph:'正文段落',fontFamily:'字体',inkColor:'文字颜色'});
 const dismissFormat=()=>{const format=document.querySelector('.document-format[open]');if(!format)return false;format.open=false;format.querySelector('summary').focus({preventScroll:true});return true};
 window.whiteboardDocumentPaper={isDocument,append,dismissFormat};let scheduled=false;new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;mount()})}}).observe($('dialog'),{childList:true,subtree:true});if(board)mount();
})();
