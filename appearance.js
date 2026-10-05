// Appearance belongs to the workspace, never to the stored content.
(() => {
 'use strict';
 const key='creative-appearance-v1';
 const palettes={
  resolve:{name:'深灰',bg:'#18191b',canvas:'#26272c',panel:'#212226',raised:'#303136',field:'#17181b',border:'#111214',line:'#414248',text:'#dedee1',muted:'#a0a1a7',hover:'#383a40',selected:'#41444c',accent:'#ed5945'},
  paper:{name:'纸白',bg:'#f8f8f6',canvas:'#eaece8',panel:'#f3f4f1',raised:'#ffffff',field:'#ffffff',border:'#d5d8d2',line:'#d5d8d2',text:'#30342f',muted:'#686f65',hover:'#e4e8e0',selected:'#dce4d5',accent:'#69805c'},
  slate:{name:'蓝灰',bg:'#19212a',canvas:'#273340',panel:'#202b36',raised:'#313f4e',field:'#18232e',border:'#121b25',line:'#455363',text:'#e1e8ef',muted:'#a6b4c3',hover:'#3a4c5d',selected:'#43586e',accent:'#85b5d8'}
 };
 const valid=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
 function read(){try{const p=JSON.parse(localStorage.getItem(key)||'{}');return {preset:palettes[p.preset]?p.preset:'resolve',custom:p.custom||{},note:valid(p.note)?p.note:'#fff0aa'}}catch{return {preset:'resolve',custom:{},note:'#fff0aa'}}}
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
  palette['canvas-text']=readable(palette.text,[palette.canvas],4.5);
  palette['canvas-muted']=readable(palette.muted,[palette.canvas],4.5);
  return {preset,palette,tone};
 }
 function apply(p,save=false){const {preset,palette,tone}=theme(p),root=document.documentElement;for(const [k,v] of Object.entries(palette))if(k!=='name')root.style.setProperty('--ui-'+k,v);root.dataset.appearance=preset;root.dataset.uiTone=tone;root.style.setProperty('--ui-scheme',tone);root.style.colorScheme=tone;if(save)localStorage.setItem(key,JSON.stringify(p));if(typeof colors!=='undefined')colors[0]=valid(p.note)?p.note:'#fff0aa';}
 function open(){document.getElementById('appearanceDialog')?.remove();const d=document.createElement('dialog');d.id='appearanceDialog';d.innerHTML='<form method="dialog" class="appearance-heading"><h2>外观</h2><button aria-label="关闭外观设置">×</button></form><p>界面颜色可以调整，已有内容的颜色保持不变。</p><div class="appearance-presets"></div><div class="appearance-colors"></div><div class="appearance-size"><label>界面大小<input id="appearanceScale" type="range" min="80" max="125" step="5"><output></output></label><label>侧栏宽度<input id="appearanceWidth" type="range" min="260" max="520" step="10"><output></output></label></div><footer><button id="appearanceReset">恢复默认</button><button id="appearanceDone">完成</button></footer>';document.body.append(d);let p=read();const presets=d.querySelector('.appearance-presets');for(const [id,v]of Object.entries(palettes)){const b=document.createElement('button');b.type='button';b.dataset.preset=id;b.innerHTML='<span style="background:'+v.canvas+';border-color:'+v.line+'"><i style="background:#fff0aa"></i><i style="background:'+v.raised+'"></i></span>'+v.name;b.onclick=()=>{p.preset=id;p.custom={};update()};presets.append(b)}
 const fields=[['canvas','画布'],['panel','工具与侧栏'],['accent','选中颜色'],['note','新便签颜色']];for(const [id,name]of fields){const label=document.createElement('label');label.textContent=name;const input=document.createElement('input');input.type='color';input.dataset.color=id;input.setAttribute('aria-label',name);input.oninput=()=>{if(id==='note')p.note=input.value;else p.custom[id]=input.value;apply(p,true)};label.append(input);d.querySelector('.appearance-colors').append(label)}
 function prefs(){try{return JSON.parse(localStorage.getItem('creative-interface')||'{}')}catch{return {}}}
 function update(){apply(p,true);presets.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.preset===p.preset)));for(const input of d.querySelectorAll('[data-color]')){const id=input.dataset.color;input.value=id==='note'?p.note:p.custom[id]||palettes[p.preset][id]}const ui=prefs();d.querySelector('#appearanceScale').value=Math.round((ui.scale||1)*100);d.querySelector('#appearanceWidth').value=ui.width||340;labels()}
 function labels(){for(const id of ['appearanceScale','appearanceWidth']){const input=d.querySelector('#'+id);input.nextElementSibling.textContent=input.value+(id==='appearanceScale'?'%':' px')}}
 const sizing=()=>{const ui={scale:Number(d.querySelector('#appearanceScale').value)/100,width:Number(d.querySelector('#appearanceWidth').value)};localStorage.setItem('creative-interface',JSON.stringify(ui));if(typeof applyInterfacePrefs==='function')applyInterfacePrefs(ui);window.dispatchEvent(new CustomEvent('creative-appearance-sizing',{detail:ui}));labels()};d.querySelector('#appearanceScale').oninput=d.querySelector('#appearanceWidth').oninput=sizing;
 d.querySelector('#appearanceReset').onclick=()=>{p={preset:'resolve',custom:{},note:'#fff0aa'};localStorage.setItem('creative-interface',JSON.stringify({scale:1,width:340}));update();sizing()};d.querySelector('#appearanceDone').onclick=()=>d.close();d.addEventListener('close',()=>d.remove());update();d.showModal();
 }
 window.addEventListener('storage',e=>{if(e.key===key)apply(read());if(e.key==='creative-interface'&&typeof applyInterfacePrefs==='function')applyInterfacePrefs(JSON.parse(e.newValue||'{}'))});
 apply(read());window.whiteboardAppearance={open,read,apply,palettes};
})();
