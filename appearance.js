// Appearance is a browser preference, never authored content.
(() => {
 'use strict';
 const key='creative-appearance-v1';
 const collectionKey='creative-appearance-presets-v1';
 const navigationKey='creative-navigation-v1',navigationDefaults={snap:true,zoomSpeed:1,nudge:1,bigNudge:10,gap:32};
 const overviewPresets={compact:{name:'紧凑',at:30,font:10},balanced:{name:'均衡',at:45,font:12},readable:{name:'易读',at:60,font:16}};
 const paperTypefaces={
  original:{name:'原有搭配'},
  clear:{name:'清晰',family:'system-ui,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif'},
  book:{name:'书页',family:'Georgia,"Noto Serif CJK SC","Songti SC",SimSun,serif'},
  mono:{name:'等宽',family:'ui-monospace,Consolas,"Noto Sans Mono CJK SC","Sarasa Mono SC","Microsoft YaHei",monospace'}
 };
 const palettes={
  resolve:{name:'深灰',bg:'#16181c',canvas:'#23262b',panel:'#272a30',raised:'#32363e',field:'#1c1f24',border:'#15171b',line:'#484d57',text:'#e6e8ed',muted:'#adb3bf',hover:'#3b4049',selected:'#424955',accent:'#e7b77b'},
  paper:{name:'纸白',bg:'#f8f8f6',canvas:'#eaece8',panel:'#f3f4f1',raised:'#ffffff',field:'#ffffff',border:'#d5d8d2',line:'#d5d8d2',text:'#30342f',muted:'#686f65',hover:'#e4e8e0',selected:'#dce4d5',accent:'#69805c'},
  slate:{name:'蓝灰',bg:'#19212a',canvas:'#273340',panel:'#202b36',raised:'#313f4e',field:'#18232e',border:'#121b25',line:'#455363',text:'#e1e8ef',muted:'#a6b4c3',hover:'#3a4c5d',selected:'#43586e',accent:'#85b5d8'},
  sand:{name:'暖砂',bg:'#ede7dc',canvas:'#e3dacc',panel:'#f2ecdf',raised:'#fff9ef',field:'#fffcf6',border:'#ccc1af',line:'#c5b89f',text:'#3c352c',muted:'#716557',hover:'#e5dbc9',selected:'#dacdb6',accent:'#805735'},
  forest:{name:'森林',bg:'#15201d',canvas:'#23332d',panel:'#24302a',raised:'#303f37',field:'#17241e',border:'#121e18',line:'#485b4f',text:'#e4eee6',muted:'#acbdae',hover:'#3b4e40',selected:'#455c4a',accent:'#b9d49a'},
  iris:{name:'墨紫',bg:'#1e1b26',canvas:'#302a3c',panel:'#2b2735',raised:'#3b3447',field:'#211c2a',border:'#17131e',line:'#55495f',text:'#eee8f5',muted:'#bfb1cb',hover:'#473d53',selected:'#554862',accent:'#d2b2eb'}
 };
 const valid=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
 const bounded=(v,min,max,fallback)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):fallback;
 function navigationPrefs(value){
  if(arguments.length===0)try{value=JSON.parse(localStorage.getItem(navigationKey)||'{}')}catch{}value=value&&typeof value==='object'?value:{};
  return {snap:value.snap!==false,zoomSpeed:bounded(value.zoomSpeed??1,.3,2,1),nudge:bounded(value.nudge??1,.1,100,1),bigNudge:bounded(value.bigNudge??10,1,500,10),gap:bounded(value.gap??32,0,500,32)};
 }
 function normalise(p={}){
  p=p&&typeof p==='object'?p:{};const custom={};
  for(const role of ['canvas','panel','accent'])if(valid(p.custom?.[role]))custom[role]=p.custom[role].toLowerCase();
  return {preset:Object.hasOwn(palettes,p.preset)?p.preset:'resolve',custom,note:valid(p.note)?p.note.toLowerCase():'#fff0aa',
   pattern:['plain','dots','grid'].includes(p.pattern)?p.pattern:'plain',gridSize:bounded(p.gridSize??24,12,64,24),paperTypeface:Object.hasOwn(paperTypefaces,p.paperTypeface)?p.paperTypeface:'original',
   overviewMode:['smart','original'].includes(p.overviewMode)?p.overviewMode:'smart',overviewAt:Math.round(bounded(p.overviewAt??45,15,75,45)),overviewFont:Math.round(bounded(p.overviewFont??12,9,18,12))};
 }
 function read(){try{return normalise(JSON.parse(localStorage.getItem(key)||'{}'))}catch{return normalise()}}
 function interfacePrefs(){try{const ui=JSON.parse(localStorage.getItem('creative-interface')||'{}');return {scale:bounded(ui?.scale??1,.8,1.25,1),width:bounded(ui?.width??340,260,520,340)}}catch{return {scale:1,width:340}}}
 function applyInterface(ui){localStorage.setItem('creative-interface',JSON.stringify(ui));if(typeof applyInterfacePrefs==='function')applyInterfacePrefs(ui,false);window.dispatchEvent(new CustomEvent('creative-appearance-sizing',{detail:ui}))}
 function savedPresets(){
  try{const rows=JSON.parse(localStorage.getItem(collectionKey)||'[]');if(!Array.isArray(rows))return [];
   const ids=new Set();return rows.filter(row=>row&&typeof row.id==='string'&&typeof row.name==='string'&&row.name.trim()&&row.name.length<=40&&!ids.has(row.id)&&ids.add(row.id)).slice(0,24)
    .map(row=>({id:row.id,name:row.name,appearance:normalise(row.appearance),ui:{scale:bounded(row.ui?.scale??1,.8,1.25,1),width:bounded(row.ui?.width??340,260,520,340)},...(row.navigation&&typeof row.navigation==='object'?{navigation:navigationPrefs(row.navigation)}:{})}));
  }catch{return []}
 }
 const rgb=value=>[1,3,5].map(offset=>parseInt(value.slice(offset,offset+2),16));
 function mix(a,b,amount){const start=rgb(a),end=rgb(b);return '#'+start.map((c,i)=>Math.round(c+(end[i]-c)*amount).toString(16).padStart(2,'0')).join('')}
 function luminance(value){return rgb(value).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0)}
 function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
 const inkFor=surface=>contrast('#ffffff',surface)>contrast('#000000',surface)?'#ffffff':'#000000';
 function readable(color,surfaces,minimum,ink=inkFor(surfaces[0])){
  for(let step=0;step<=100;step++){const candidate=mix(color,ink,step/100);if(surfaces.every(surface=>contrast(candidate,surface)>=minimum))return candidate}
  return ink;
 }
 function theme(p){
  const preset=palettes[p.preset]?p.preset:'resolve',palette={...palettes[preset]};
  for(const k of ['canvas','panel','accent'])if(valid(p.custom?.[k]))palette[k]=p.custom[k];
  const ink=inkFor(palette.panel),tone=ink==='#ffffff'?'dark':'light';
  if(valid(p.custom?.panel)&&p.custom.panel!==palettes[preset].panel){
   const panel=palette.panel,light=tone==='light';
   const surface=(toward,amount)=>{const draft=mix(panel,toward,amount);for(let step=0;step<=100;step++){const value=mix(draft,panel,step/100);if(contrast(ink,value)>=4.5)return value}return panel};
   palette.bg=surface('#000000',light ? .03 : .3);palette.field=surface(light?'#ffffff':'#000000',light ? .38 : .25);
   palette.raised=surface('#ffffff',light ? .2 : .055);palette.hover=surface(ink,light ? .07 : .1);palette.selected=surface(ink,light ? .12 : .13);
   palette.border=mix(panel,ink,.12);palette.line=mix(panel,ink,.23);
   palette.text=mix(panel,ink,.92);palette.muted=mix(panel,ink,.68);
  }
  const surfaces=['bg','panel','field','raised','hover','selected'].map(role=>palette[role]);
  palette.text=readable(palette.text,surfaces,4.5,ink);palette.muted=readable(palette.muted,surfaces,4.5,ink);
  palette.link=readable(tone==='light'?'#345e8b':'#95bddc',surfaces,4.5,ink);
  palette.focus=readable(palette.accent,surfaces,3,ink);
  palette['canvas-focus']=readable(palette.accent,[palette.canvas],3);
  palette['canvas-text']=readable(palette.text,[palette.canvas],4.5);
  palette['canvas-muted']=readable(palette.muted,[palette.canvas],4.5);
  return {preset,palette,tone};
 }
 let activeGridSize=24;
 function positionPattern(){
  const canvas=document.getElementById('canvas');if(!canvas)return;
  const v=typeof board!=='undefined'&&board&&typeof view==='function'?view():{x:0,y:0,z:1};let size=activeGridSize*(Number(v.z)||1);
  // Thin out distant marks rather than producing a dense moire at low zoom.
  while(size<12)size*=2;
  canvas.style.setProperty('--canvas-pattern-size',size+'px');canvas.style.setProperty('--canvas-pattern-position',(Number(v.x)||0)+'px '+(Number(v.y)||0)+'px');
 }
 function apply(p,save=false){
  p=normalise(p);const {preset,palette,tone}=theme(p),root=document.documentElement;
  for(const [k,v] of Object.entries(palette))if(k!=='name')root.style.setProperty('--ui-'+k,v);
  root.dataset.appearance=preset;root.dataset.uiTone=tone;root.dataset.canvasPattern=p.pattern;root.style.setProperty('--ui-scheme',tone);root.style.colorScheme=tone;
  root.style.setProperty('--ui-grid',mix(palette.canvas,inkFor(palette.canvas),.16));activeGridSize=p.gridSize;positionPattern();
  const typographyChanged=(root.dataset.paperTypeface||'original')!==p.paperTypeface;root.dataset.paperTypeface=p.paperTypeface;
  const family=paperTypefaces[p.paperTypeface].family;
  for(const role of ['body','heading'])if(family)root.style.setProperty('--paper-'+role+'-family',family);else root.style.removeProperty('--paper-'+role+'-family');
  if(typographyChanged){if(typeof fitContentLayouts==='function')fitContentLayouts();window.whiteboardSizing?.invalidate?.();}
  window.dispatchEvent(new CustomEvent('creative-overview-preferences',{detail:{mode:p.overviewMode,at:p.overviewAt,font:p.overviewFont}}));
  if(typeof colors!=='undefined')colors[0]=p.note;
  if(save)try{localStorage.setItem(key,JSON.stringify(p))}catch{return false}return true;
 }
 if(typeof moveView==='function'){const move=moveView;moveView=function(...args){const result=move(...args);positionPattern();return result}}
 function open(){
  const focused=document.activeElement,source=typeof board==='undefined'?null:board,sourceId=typeof boardId==='undefined'?null:boardId,node=source?.nodes?.find(n=>n.id===focused?.closest('.node')?.dataset.id);
  const returning=focused?.matches('textarea,input[type=text],input:not([type])')&&typeof focused.selectionStart==='number'?{value:focused.value,start:focused.selectionStart,end:focused.selectionEnd,direction:focused.selectionDirection,top:focused.scrollTop,left:focused.scrollLeft}:null;
  const previous=document.getElementById('appearanceDialog');if(previous){previous.disposeAppearance?.();previous.remove()}const d=document.createElement('dialog');d.id='appearanceDialog';
  d.innerHTML='<form method="dialog" class="appearance-heading"><h2>外观</h2><button aria-label="关闭外观设置">×</button></form><div class="appearance-body"><p>先选一种感觉，再调成自己的工作台。已有内容保持原色与尺寸。</p><h3>配色预设</h3><div class="appearance-presets"></div><section class="appearance-saved"><h3>我的预设</h3><p>保存颜色、画布底纹、界面大小与侧栏宽度，仅保存在当前浏览器。</p><div class="appearance-saved-list"></div><div class="appearance-save-row"><input id="appearanceName" aria-label="预设名称" maxlength="40" placeholder="给当前外观起个名字"><button type="button" id="appearanceSave">保存当前外观</button></div><div class="appearance-message" role="status" aria-live="polite"></div></section><details class="appearance-custom" open><summary>继续自定义</summary><div class="appearance-colors"></div><section class="appearance-pattern"><h3>画布底纹</h3><div role="group" aria-label="画布底纹"><button type="button" data-pattern="plain">纯色</button><button type="button" data-pattern="dots">点阵</button><button type="button" data-pattern="grid">细网格</button></div><label>底纹间距<input id="appearanceGrid" type="range" min="12" max="64" step="4"><output></output></label><p>底纹跟随画布移动与缩放，帮助定位，不改变内容位置或吸附方式。</p></section><div class="appearance-size"><label>界面大小<input id="appearanceScale" type="range" min="80" max="125" step="5"><output></output></label><label>侧栏宽度<input id="appearanceWidth" type="range" min="260" max="520" step="10"><output></output></label></div></details></div><footer><button type="button" id="appearanceReset">恢复默认</button><button type="button" id="appearanceRevert" title="还原打开设置时的外观；已保存的预设保留">还原本次调整</button><button type="button" id="appearanceDone">完成</button></footer>';
  d.querySelector('.appearance-heading h2').textContent='外观与操作';d.querySelector('#appearanceRevert').title='还原打开设置时的外观与操作偏好；已保存的预设保留';
  d.querySelector('.appearance-body>p').textContent='先选一种感觉，再调成自己的工作台。已有原文与内容配色保留，自动便签仍随内容适应。';
   d.querySelector('.appearance-saved p').textContent='保存颜色、画布底纹、纸面字体、缩略显示、界面大小、侧栏宽度与操作偏好，仅保存在当前浏览器。';
   const typography=document.createElement('section');typography.className='appearance-pattern appearance-typography';typography.innerHTML='<h3>纸面字体</h3><label>阅读搭配<select id="appearancePaperTypeface">'+Object.entries(paperTypefaces).map(([id,row])=>'<option value="'+id+'">'+row.name+'</option>').join('')+'</select></label><p>标题和正文一起切换，按钮与代码保持原样。文字、字号、位置和手动尺寸保留；自动便签仍随内容适应。字体由当前设备提供。</p>';d.querySelector('.appearance-size').before(typography);
  const overview=document.createElement('section');overview.className='appearance-pattern appearance-overview';overview.innerHTML='<h3>缩远后的便签</h3><div role="group" aria-label="缩略显示方式"><button type="button" data-overview-mode="smart">名称导航</button><button type="button" data-overview-mode="original">原样缩小</button></div><label>阅读预设<select id="appearanceOverviewPreset" aria-label="概览阅读预设">'+Object.entries(overviewPresets).map(([id,p])=>'<option value="'+id+'">'+p.name+'</option>').join('')+'<option value="custom" disabled>自定义</option></select></label><details class="appearance-custom"><summary>精细调整</summary><label>开始概览<input id="appearanceOverviewAt" aria-label="开始概览的比例" type="range" min="15" max="75" step="1"><output></output></label><label>文字上限<input id="appearanceOverviewFont" aria-label="概览文字上限" type="range" min="9" max="18" step="1"><output></output></label></details><p>名称导航在缩远时显示名称；原样缩小保留纸面原貌。概览会按纸面空间缩小文字，已有内容、字号、位置和尺寸保持原样。</p>';d.querySelector('.appearance-size').before(overview);
  const navigation=document.createElement('section');navigation.className='navigation-settings';navigation.innerHTML='<h3>白板操作</h3><label class="navigation-check"><input id="navSnap" type="checkbox">拖动时显示对齐参考线并吸附</label><label>缩放速度<input id="navZoom" type="range" min="30" max="200" step="10"><output></output></label><div><label>方向键移动<input id="navNudge" required type="number" min="0.1" max="100" step="0.1"></label><label>Shift＋方向键<input id="navBigNudge" required type="number" min="1" max="500" step="any"></label></div><p>右键或空格＋拖动移动画布；Ctrl＋滚轮缩放；H 切到手形工具，V 切回选择。Shift＋拖动限制方向，Alt＋拖动创建副本。拖动时按 Ctrl 可临时关闭吸附。</p><p class="navigation-message" role="status" aria-live="polite"></p>';d.querySelector('.appearance-body').append(navigation);
  document.body.append(d);let p=read();const opening={appearance:read(),ui:interfacePrefs(),navigation:navigationPrefs()},presets=d.querySelector('.appearance-presets'),owns=()=>d.isConnected&&d.open&&document.getElementById('appearanceDialog')===d;
  // Modal controls keep native editing and dismissal; their keys never reach canvas commands.
  d.addEventListener('keydown',event=>{if(owns())event.stopPropagation()});
  function renderNavigation(force=false){
   const value=navigationPrefs();navigation.querySelector('#navSnap').checked=value.snap;navigation.querySelector('#navZoom').value=value.zoomSpeed*100;navigation.querySelector('#navZoom').nextElementSibling.textContent=Number(value.zoomSpeed.toFixed(2))+'×';
   for(const [id,key] of [['navNudge','nudge'],['navBigNudge','bigNudge']]){const input=navigation.querySelector('#'+id);if(force||document.activeElement!==input||input.validity.valid&&Number(input.value)!==value[key]){input.value=value[key];input.removeAttribute('aria-invalid')}}
  }
  function saveNavigation(value){
   if(!owns())return false;try{localStorage.setItem(navigationKey,JSON.stringify(navigationPrefs(value)));navigation.querySelector('.navigation-message').textContent='';renderNavigation();return true}
   catch{navigation.querySelector('.navigation-message').textContent='浏览器未保存这次操作设置，仍使用原来的操作偏好。';renderNavigation(true);return false}
  }
  const message=(text,undo)=>{const box=d.querySelector('.appearance-message');box.replaceChildren(document.createTextNode(text));if(undo){const b=document.createElement('button');b.type='button';b.textContent='撤销移除';b.onclick=()=>{if(owns())undo()};box.append(b)}};
  for(const [id,v]of Object.entries(palettes)){
   const b=document.createElement('button');b.type='button';b.dataset.preset=id;
   b.innerHTML='<span style="background:'+v.canvas+';border-color:'+v.line+'"><i style="background:#fff0aa"></i><i style="background:'+v.raised+'"></i><i style="background:'+v.accent+'"></i></span>'+v.name;
   b.onclick=()=>{p.preset=id;p.custom={};update()};presets.append(b);
  }
  function refreshSaved(){
   const list=d.querySelector('.appearance-saved-list');list.replaceChildren();const rows=savedPresets();
   if(!rows.length){const empty=document.createElement('small');empty.textContent='调好后保存，下次一键切换。';list.append(empty)}
   for(const row of rows){
    const item=document.createElement('div'),choose=document.createElement('button'),remove=document.createElement('button');choose.type=remove.type='button';
    choose.dataset.savedPreset=row.id;choose.textContent=row.name;choose.title=row.name;choose.setAttribute('aria-label','应用预设：'+row.name);
    const palette=theme(row.appearance).palette;choose.style.setProperty('--saved-canvas',palette.canvas);choose.style.setProperty('--saved-accent',palette.accent);
    choose.setAttribute('aria-pressed',String(JSON.stringify(normalise(p))===JSON.stringify(row.appearance)&&JSON.stringify(interfacePrefs())===JSON.stringify(row.ui)&&(!row.navigation||JSON.stringify(navigationPrefs())===JSON.stringify(row.navigation))));
    choose.onclick=()=>{if(!owns())return;message('');p=normalise(row.appearance);applyInterface(row.ui);const operationSaved=!row.navigation||saveNavigation(row.navigation);if(update()!==false&&operationSaved)message('已应用“'+row.name+'”。')};
    remove.textContent='×';remove.setAttribute('aria-label','移除预设：'+row.name);
    remove.onclick=()=>{if(!owns())return;try{localStorage.setItem(collectionKey,JSON.stringify(savedPresets().filter(r=>r.id!==row.id)));refreshSaved();d.querySelector('#appearanceName').focus();message('已移除“'+row.name+'”，当前外观保留。',()=>{
      try{const current=savedPresets();if(current.length>=24){message('已满 24 个预设，请先移除一个。');return}if(!current.some(r=>r.id===row.id))localStorage.setItem(collectionKey,JSON.stringify([...current,row]));refreshSaved();message('已恢复“'+row.name+'”。')}catch{message('浏览器无法保存预设，请检查存储空间。')}
     })}catch{message('浏览器无法保存预设，请检查存储空间。')}};item.append(choose,remove);list.append(item);
   }
  }
  d.querySelector('#appearanceSave').onclick=()=>{
   const input=d.querySelector('#appearanceName'),name=input.value.trim(),rows=savedPresets();
   const invalid=d.querySelector('[data-hex][aria-invalid="true"]');if(invalid){message('请先修正颜色值，再保存预设。');invalid.focus();return}
   if(!name){message('请先给预设起个名字。');input.focus();return}
   if(rows.some(row=>row.name===name)){message('这个名称已存在，请换一个名称。');input.focus();return}
   if(rows.length>=24){message('已满 24 个预设，请先移除一个。');return}
   const invalidNavigation=navigation.querySelector('input[type=number]:invalid');if(invalidNavigation){message('请先填写范围内的移动距离，再保存预设。');invalidNavigation.focus();return}
   try{rows.push({id:crypto.randomUUID(),name,appearance:normalise(p),ui:interfacePrefs(),navigation:navigationPrefs()});localStorage.setItem(collectionKey,JSON.stringify(rows));input.value='';refreshSaved();message('已保存“'+name+'”。')}catch{message('浏览器无法保存预设，请检查存储空间。')}
  };
  d.querySelector('#appearanceName').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();d.querySelector('#appearanceSave').click()}};
  const fields=[['canvas','画布'],['panel','工具与侧栏'],['accent','选中颜色'],['note','新便签颜色']];
  for(const [id,name]of fields){
   const label=document.createElement('label'),caption=document.createElement('span'),input=document.createElement('input'),hex=document.createElement('input');caption.textContent=name;
   input.type='color';input.dataset.color=id;input.setAttribute('aria-label',name);hex.type='text';hex.dataset.hex=id;hex.maxLength=7;hex.spellcheck=false;hex.setAttribute('aria-label',name+'颜色值');
   const change=value=>{if(id==='note')p.note=value;else p.custom[id]=value;update()};
   input.oninput=()=>change(input.value);hex.onchange=()=>{if(!valid(hex.value)){hex.setAttribute('aria-invalid','true');message('颜色值请填写 # 和六位十六进制数字，例如 #335566。');return}hex.removeAttribute('aria-invalid');change(hex.value.toLowerCase())};
   hex.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();hex.dispatchEvent(new Event('change'))}};label.append(caption,input,hex);d.querySelector('.appearance-colors').append(label);
  }
  function labels(){for(const [id,unit]of [['appearanceScale','%'],['appearanceWidth',' px'],['appearanceGrid',' px'],['appearanceOverviewAt','%'],['appearanceOverviewFont',' px']]){const input=d.querySelector('#'+id);input.nextElementSibling.textContent=input.value+unit}}
  function update(save=true){
   if(!owns())return false;p=normalise(p);const saved=apply(p,save);presets.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preset===p.preset&&!Object.keys(p.custom).length)));
   for(const input of d.querySelectorAll('[data-color]')){const id=input.dataset.color,value=id==='note'?p.note:p.custom[id]||palettes[p.preset][id];input.value=value;const hex=d.querySelector('[data-hex="'+id+'"]');if(document.activeElement!==hex||!hex.hasAttribute('aria-invalid')){hex.value=value;hex.removeAttribute('aria-invalid')}}
   d.querySelectorAll('[data-pattern]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pattern===p.pattern)));d.querySelector('#appearanceGrid').value=p.gridSize;d.querySelector('#appearanceGrid').disabled=p.pattern==='plain';
   d.querySelector('#appearancePaperTypeface').value=p.paperTypeface;
   d.querySelectorAll('[data-overview-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.overviewMode===p.overviewMode)));
   d.querySelector('#appearanceOverviewAt').value=p.overviewAt;d.querySelector('#appearanceOverviewFont').value=p.overviewFont;
   for(const id of ['appearanceOverviewPreset','appearanceOverviewAt','appearanceOverviewFont'])d.querySelector('#'+id).disabled=p.overviewMode==='original';
   d.querySelector('#appearanceOverviewPreset').value=Object.keys(overviewPresets).find(id=>overviewPresets[id].at===p.overviewAt&&overviewPresets[id].font===p.overviewFont)||'custom';
   const ui=interfacePrefs();d.querySelector('#appearanceScale').value=Math.round(ui.scale*100);d.querySelector('#appearanceWidth').value=ui.width;labels();renderNavigation();refreshSaved();
   if(!saved)message('浏览器无法保存这次外观；当前预览仍可使用，重新打开可能还原。');else if(save&&d.querySelector('.appearance-message').textContent.startsWith('浏览器无法保存这次外观'))message('');return saved;
  }
  d.querySelectorAll('[data-pattern]').forEach(b=>b.onclick=()=>{p.pattern=b.dataset.pattern;update()});
  d.querySelector('#appearanceGrid').oninput=e=>{p.gridSize=Number(e.target.value);update()};
   d.querySelector('#appearancePaperTypeface').onchange=e=>{p.paperTypeface=e.target.value;update()};
  d.querySelectorAll('[data-overview-mode]').forEach(b=>b.onclick=()=>{p.overviewMode=b.dataset.overviewMode;update()});
  d.querySelector('#appearanceOverviewPreset').onchange=e=>{const choice=overviewPresets[e.target.value];if(!choice)return;p.overviewAt=choice.at;p.overviewFont=choice.font;update()};
  d.querySelector('#appearanceOverviewAt').oninput=e=>{p.overviewAt=Number(e.target.value);update()};d.querySelector('#appearanceOverviewFont').oninput=e=>{p.overviewFont=Number(e.target.value);update()};
  const sizing=()=>{applyInterface({scale:Number(d.querySelector('#appearanceScale').value)/100,width:Number(d.querySelector('#appearanceWidth').value)});labels();refreshSaved()};d.querySelector('#appearanceScale').oninput=d.querySelector('#appearanceWidth').oninput=sizing;
  for(const [id,key] of [['navSnap','snap'],['navZoom','zoomSpeed'],['navNudge','nudge'],['navBigNudge','bigNudge']])navigation.querySelector('#'+id).oninput=event=>{
   const input=event.target;if(input.type==='number'&&!input.validity.valid){input.setAttribute('aria-invalid','true');navigation.querySelector('.navigation-message').textContent='请填写范围内的移动距离；未完成的数值暂不应用。';return}
   input.removeAttribute('aria-invalid');const value=input.type==='checkbox'?input.checked:Number(input.value)/(id==='navZoom'?100:1);saveNavigation({...navigationPrefs(),[key]:value});refreshSaved();
  };
  d.querySelector('#appearanceReset').onclick=()=>{message('');p=normalise();applyInterface({scale:1,width:340});saveNavigation(navigationDefaults);update()};
  d.querySelector('#appearanceRevert').onclick=()=>{message('');p=normalise(opening.appearance);applyInterface(opening.ui);const operationSaved=saveNavigation(opening.navigation);if(update()!==false&&operationSaved)message('已还原打开设置时的外观与操作偏好。')};
  d.querySelector('#appearanceDone').onclick=()=>d.close();
  const storage=e=>{if(!owns())return;if([key,'creative-interface'].includes(e.key)){p=read();update(false)}else if(e.key===navigationKey){renderNavigation();refreshSaved()}else if(e.key===collectionKey)refreshSaved()};window.addEventListener('storage',storage);
  d.disposeAppearance=()=>window.removeEventListener('storage',storage);d.addEventListener('close',()=>{
   d.disposeAppearance();d.remove();
   // Native dialog focus return can collapse a textarea's selected text.
   // Restore only this still-current field; never replay text or another document's position.
   if(!returning||!focused.isConnected||focused.value!==returning.value||source!==(typeof board==='undefined'?null:board)||sourceId!==(typeof boardId==='undefined'?null:boardId)||node&&source.nodes.find(n=>n.id===node.id)!==node)return;
   if([...document.querySelectorAll('dialog[open]')].some(dialog=>!dialog.contains(focused))||document.activeElement!==focused&&document.activeElement!==document.body)return;
   focused.focus({preventScroll:true});focused.setSelectionRange(returning.start,returning.end,returning.direction);focused.scrollTop=returning.top;focused.scrollLeft=returning.left;
  },{once:true});
  // Native pickers can finish after a dialog closes; an old control owns no later preview.
  for(const el of d.querySelectorAll('button,input,select'))for(const name of ['onclick','oninput','onchange','onkeydown']){const action=el[name];if(action)el[name]=function(...args){if(owns())return action.apply(this,args)}}
  d.showModal();update(false);
 }
 // Storage notifications can arrive after a later choice. Read the latest
 // value, and never broadcast a received older preference back to other panes.
 window.addEventListener('storage',e=>{if(e.key===key)apply(read());if(e.key==='creative-interface'&&typeof applyInterfacePrefs==='function')applyInterfacePrefs(readInterfacePrefs(),false)});
 apply(read());window.whiteboardAppearance={open,read,apply,palettes};
 // The earlier workflow menu captured its old sizing function. Resolve the
 // current appearance entry when clicked so standalone boards use it too.
 const menu=document.getElementById('menu'),legacy=menu&&[...menu.querySelectorAll('button')].find(b=>b.textContent==='界面大小');
 if(legacy){legacy.textContent='外观';legacy.onclick=()=>{menu.open=false;window.whiteboardAppearance.open()}}
})();
