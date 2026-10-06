// Authored time markers are stored with the node or its independent table item.
(() => {
 'use strict';
 const players=new WeakMap(),restoredOwners=new Set();let active=null;
 const stamp=s=>{const units=Math.round(Math.max(0,Number(s)||0)*100),fraction=String(units%100).padStart(2,'0').replace(/0+$/,'');return Math.floor(units/6000)+':'+String(Math.floor(units%6000/100)).padStart(2,'0')+(fraction?'.'+fraction:'')};
 function parseTime(raw){const parts=raw.trim().split(':');return parts.length<=3&&parts.every((p,i)=>(i===parts.length-1?/^\d+(?:\.\d+)?$/:/^\d+$/).test(p)&&(i===0||Number(p)<60))?parts.reduce((sum,p)=>sum*60+Number(p),0):NaN}
 function owner(el){const n=board?.nodes.find(n=>n.id===el.closest('.node')?.dataset.id),cell=el.closest('[data-cell-item]');return cell?n?.cellItems?.[+cell.dataset.cellR]?.[+cell.dataset.cellC]?.[+cell.dataset.cellItem]:n}
 const mediaKey=el=>el.getAttribute('src')||el.querySelector('source')?.getAttribute('src')||'media';
 function timeline(el,create=false){const n=owner(el);if(!n)return null;if(create){n.mediaTimeline??={};n.mediaTimeline[mediaKey(el)]??={markers:[],startMarkerId:null}}return n.mediaTimeline?.[mediaKey(el)]||null}
 const sorted=el=>(timeline(el)?.markers||[]).slice().sort((a,b)=>a.time-b.time);
 function jump(el,time,play=false){if(!Number.isFinite(el.duration)||el.duration<=0)return;el.currentTime=Math.max(0,Math.min(time,el.duration));el._captureReading?.();if(play)el.play().catch(()=>toast('无法播放，请检查原文件'))}
 function write(el,fn,checkpoint=true){if(blocked)return toast('请先处理保存冲突');if(!owner(el))return;if(checkpoint)undoPoint();fn(timeline(el,true));change();update(el);if(active?.el===el)renderPanel(active);renderOutline()}
 function open(el,id=null){const ui=el.nextElementSibling;if(!ui?.matches('.media-controls'))return;active={el,selected:id};ui.querySelector('.media-time').click();decorate();const panel=$('mediaPopover');if(id&&panel)renderPanel(active)}
 function update(el){
  const info=players.get(el);if(!info)return;const t=timeline(el),list=sorted(el),ready=Number.isFinite(el.duration)&&el.duration>0;
  if(!info.restored&&el.readyState>=1&&el._readingRestored){info.restored=true;const key=boardId+'|'+owner(el)?.id+'|'+mediaKey(el),m=t?.markers.find(m=>m.id===t.startMarkerId);if(!restoredOwners.has(key)&&m)jump(el,m.time);restoredOwners.add(key)}
  const roots=[el.nextElementSibling];if(active?.el===el&&$('mediaPopover'))roots.push($('mediaPopover').querySelector('.media-controls'));
  for(const root of roots){if(!root?.matches('.media-controls'))continue;let ticks=root.querySelector('.media-marker-ticks');if(!ticks){ticks=document.createElement('div');ticks.className='media-marker-ticks';root.append(ticks)}
   const seek=root.querySelector('.media-seek');if(seek){ticks.style.left=(seek.offsetLeft+7)+'px';ticks.style.right=Math.max(7,root.clientWidth-seek.offsetLeft-seek.offsetWidth+7)+'px';ticks.style.top=(seek.offsetTop+seek.offsetHeight/2+4)+'px'}
   const signature=JSON.stringify([ready?el.duration:0,t?.startMarkerId,list.map(m=>[m.id,m.time,m.title])]);if(ticks.dataset.signature===signature)continue;ticks.dataset.signature=signature;ticks.replaceChildren();
   for(const m of list){const b=document.createElement('button');b.type='button';b.className='media-marker-tick';b.title=(m.title||'时间标记')+' · '+stamp(m.time);b.setAttribute('aria-label',b.title);b.style.left=(ready?Math.min(100,m.time/el.duration*100):0)+'%';b.disabled=!ready;b.classList.toggle('replay-start',m.id===t?.startMarkerId);b.onclick=e=>{e.stopPropagation();jump(el,m.time);if(active?.el===el&&$('mediaPopover')){active.selected=m.id;renderPanel(active)}else open(el,m.id)};ticks.append(b)}
  }
  info.toggle.setAttribute('aria-label',list.length?'时间标记（'+list.length+' 个）':'时间标记');info.toggle.classList.toggle('has-markers',!!list.length);
  if(active?.el===el&&active.add){active.add.disabled=!ready;active.replay.disabled=!ready}
 }
 function growTitle(s){const field=s.title;if(!field?.isConnected||s.editor.hidden)return;const css=getComputedStyle(field);field.style.height='auto';field.style.height=(field.scrollHeight+parseFloat(css.borderTopWidth)+parseFloat(css.borderBottomWidth))+'px'}
 function renderPanel(s){
  if(!s.list?.isConnected)return;const focus=document.activeElement,keepFocus=s.list.contains(focus),all=sorted(s.el),t=timeline(s.el);s.list.replaceChildren();
  if(!all.length){const empty=document.createElement('p');empty.className='media-marker-empty';empty.textContent='在需要回看的位置添加标记，再写下它的用途或你的想法。';s.list.append(empty)}
  for(const m of all){const row=document.createElement('button');row.type='button';row.className='media-marker-row';row.dataset.markerId=m.id;row.setAttribute('role','option');row.setAttribute('aria-selected',String(m.id===s.selected));row.tabIndex=m.id===s.selected?0:-1;const time=document.createElement('span'),title=document.createElement('span'),flag=document.createElement('small');time.textContent=stamp(m.time);title.textContent=m.title||'未命名标记';flag.textContent=m.id===t?.startMarkerId?'重播起点':'';row.append(time,title,flag);row.onclick=()=>{s.selected=m.id;jump(s.el,m.time);renderPanel(s)};s.list.append(row)}
  const m=all.find(m=>m.id===s.selected);s.editor.hidden=!m;s.summary.textContent=t?.startMarkerId?'再次打开从选定标记开始。':'再次打开接着上次的位置。';s.resume.hidden=!t?.startMarkerId;
  if(m){s.title.value=m.title||'';s.note.value=m.note||'';s.time.value=String(Math.round(m.time*100)/100);s.start.checked=m.id===t?.startMarkerId;s.time.setCustomValidity('');s.time.setAttribute('aria-invalid','false');s.error.hidden=true;s.error.textContent='';growTitle(s)}
  const row=[...s.list.children].find(row=>row.dataset.markerId===s.selected);if(row){if(keepFocus)row.focus({preventScroll:true});row.scrollIntoView({block:'nearest'})}
  if(focus===s.resume&&s.resume.hidden)(m?s.start:s.add).focus({preventScroll:true});else if(s.editor.hidden&&s.editor.contains(focus))s.add.focus({preventScroll:true});
  whiteboardMedia.fit();
 }
 function decorate(){
  const popup=$('mediaPopover'),el=active?.el;if(!popup||!el||popup.querySelector('.media-markers'))return;
  const section=document.createElement('section');section.className='media-markers';section.innerHTML='<div class="media-marker-heading"><strong>时间标记</strong><button class="media-add-marker">＋ 添加当前时间</button><button class="media-replay">重播</button></div><div class="media-marker-list" role="listbox" aria-label="时间标记：方向键选择，Home / End 到首尾"></div><div class="media-marker-editor" hidden><label>名称<textarea class="media-marker-title" rows="1" maxlength="200" placeholder="例如：这里接转场"></textarea></label><label>时间（秒或分:秒）<input class="media-marker-time" inputmode="decimal" aria-describedby="mediaMarkerError"></label><p class="media-marker-error" id="mediaMarkerError" role="alert" hidden></p><label class="media-marker-description">备注<textarea class="media-marker-note" rows="3" placeholder="这段用来做什么，或有哪些想法。" maxlength="20000"></textarea></label><div class="media-marker-actions"><label><input type="checkbox" class="media-marker-start">下次从这里开始</label><button class="media-remove-marker">删除标记</button></div></div><div class="media-replay-policy"><small></small><button class="media-resume">改为接着上次播放</button></div>';
  popup.append(section);const s=Object.assign(active,{list:section.querySelector('.media-marker-list'),editor:section.querySelector('.media-marker-editor'),title:section.querySelector('.media-marker-title'),note:section.querySelector('.media-marker-note'),time:section.querySelector('.media-marker-time'),error:section.querySelector('.media-marker-error'),start:section.querySelector('.media-marker-start'),summary:section.querySelector('.media-replay-policy small'),resume:section.querySelector('.media-resume'),add:section.querySelector('.media-add-marker'),replay:section.querySelector('.media-replay')});s.selected??=sorted(el)[0]?.id||null;
  s.list.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;const all=sorted(el);if(!all.length)return;e.preventDefault();e.stopPropagation();const index=all.findIndex(m=>m.id===s.selected),next=e.key==='Home'?0:e.key==='End'?all.length-1:Math.max(0,Math.min(all.length-1,index+(e.key==='ArrowDown'?1:-1)));s.selected=all[next].id;jump(el,all[next].time);renderPanel(s)});
  s.add.onclick=()=>{const id=uid();s.selected=id;write(el,t=>t.markers.push({id,time:Math.round(el.currentTime*100)/100,title:'',note:''}));s.title.focus()};
  s.replay.onclick=()=>{const t=timeline(el),m=t?.markers.find(m=>m.id===t.startMarkerId);jump(el,m?.time||0,true)};
  const current=()=>timeline(el)?.markers.find(m=>m.id===s.selected);
  for(const [field,key]of [[s.title,'title'],[s.note,'note']]){bindContentInput(field,()=>current()?.[key]||'',value=>{const m=current();if(m){m[key]=value;change();update(el);const row=[...s.list.children].find(r=>r.dataset.markerId===m.id);if(key==='title'){if(row)row.children[1].textContent=m.title||'未命名标记';growTitle(s);whiteboardMedia.fit()}}});const input=field.oninput;field.oninput=()=>{if(!blocked&&current())input()}}
  s.time.oninput=()=>{s.time.setCustomValidity('');s.time.setAttribute('aria-invalid','false');s.error.hidden=true};
  s.time.onchange=()=>{
   const value=parseTime(s.time.value),ready=Number.isFinite(el.duration)&&el.duration>0;let message='';
   if(!ready)message=el.error?'未能读取媒体时长，这次时间修改未保存。请检查原文件后重试。':'还没读取到媒体时长，这次时间修改未保存。请等加载完成后重新调整。';
   else if(!Number.isFinite(value)||value<0||value>el.duration)message='请输入媒体时长以内的时间，例如 12.5 或 0:12.5。';
   if(message){s.time.setCustomValidity(message);s.time.setAttribute('aria-invalid','true');s.error.textContent=message;s.error.hidden=false;return}
   write(el,t=>{const m=t.markers.find(m=>m.id===s.selected);if(m)m.time=value});
  };
  s.start.onchange=()=>write(el,t=>t.startMarkerId=s.start.checked?s.selected:null);s.resume.onclick=()=>write(el,t=>t.startMarkerId=null);
  section.querySelector('.media-remove-marker').onclick=()=>write(el,t=>{t.markers=t.markers.filter(m=>m.id!==s.selected);if(t.startMarkerId===s.selected)t.startMarkerId=null;s.selected=t.markers[0]?.id||null});
  renderPanel(s);update(el);
 }
 function mount(){
  for(const el of document.querySelectorAll('.node audio,.node video')){let info=players.get(el);const controls=el.nextElementSibling;if(!controls?.matches('.media-controls'))continue;
   if(!info){const toggle=document.createElement('button');toggle.className='media-marker-toggle';toggle.type='button';toggle.textContent='⌖';toggle.title='时间标记与重播起点';toggle.onclick=()=>open(el);controls.append(toggle);info={toggle,restored:false};players.set(el,info);for(const event of ['loadedmetadata','durationchange','timeupdate','creative-media-restored'])el.addEventListener(event,()=>update(el))}
   update(el);
  }
 }
 // Decorate after the player exists, including real clicks inside a dialog.
 document.addEventListener('creative-media-opened',e=>{const el=e.detail;if(!el?.matches?.('.node audio,.node video')||!$('mediaPopover'))return;if(active?.el!==el)active={el,selected:null};decorate()});
 document.addEventListener('creative-media-closed',e=>{if(active?.el===e.detail)active=null});
 const oldDraw=drawNodes;drawNodes=function(){oldDraw();mount()};const oldSelect=refreshSelectionUI;refreshSelectionUI=function(){oldSelect();mount()};
 whiteboardMedia.open=el=>open(el);whiteboardMedia.markers={timeline,parseTime,jump,mount};if(board)mount();
 const beforeLoad=loadBoard;loadBoard=async function(...args){restoredOwners.clear();return beforeLoad(...args)};
})();
