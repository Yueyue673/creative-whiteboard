// Authored spatial metadata travels in the original, permission-scoped document.
// Browsing changes only the page camera; it never arranges or rewrites content.
const FIELD='spatialViews',KIND='creative-spatial-views',MAX=48;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const validRegion=r=>object(r)&&['x','y','w','h'].every(k=>finite(r[k]))&&Math.abs(r.x)<=1e7&&Math.abs(r.y)<=1e7&&r.w>0&&r.h>0&&r.w<=2e7&&r.h<=2e7;
const validName=name=>typeof name==='string'&&name.trim().length>0&&name.length<=160;
export function readViews(board){
  if(!board||!Object.hasOwn(board,FIELD))return {available:true,items:[],signature:'absent'};
  const data=board[FIELD],ids=new Set();
  const valid=object(data)&&data.kind===KIND&&data.version===1&&Array.isArray(data.items)&&data.items.length<=MAX&&data.items.every(item=>{
    if(!object(item)||typeof item.id!=='string'||!item.id||item.id.length>100||ids.has(item.id)||!validName(item.name)||!validRegion(item.region))return false;
    ids.add(item.id);return true;
  });
  return {available:valid,items:valid?data.items:[],signature:JSON.stringify(data)};
}
export function safeViewport(width,height){
  if(!finite(width)||!finite(height)||width<80||height<180)throw Error('画面太小，请先扩大窗口。');
  return {x:24,y:76,w:Math.max(1,width-48),h:Math.max(1,height-206)};
}
export function captureRegion(view,width,height){
  if(!view||!['x','y','z'].every(k=>finite(view[k]))||view.z<=0)throw Error('当前画面无法保存，请先调整缩放。');
  const a=safeViewport(width,height),r={x:(a.x-view.x)/view.z,y:(a.y-view.y)/view.z,w:a.w/view.z,h:a.h/view.z};
  if(!validRegion(r))throw Error('这个画面范围过大，请靠近内容后再保存。');return r;
}
export function contentRegion(nodes){
  const valid=(nodes||[]).filter(n=>n&&['x','y','w','h'].every(k=>finite(n[k]))&&n.w>0&&n.h>0);
  if(!valid.length)throw Error('这里还没有可以定位的内容。');
  const x=Math.min(...valid.map(n=>n.x))-24,y=Math.min(...valid.map(n=>n.y))-24;
  const r={x,y,w:Math.max(...valid.map(n=>n.x+n.w))-x+24,h:Math.max(...valid.map(n=>n.y+n.h))-y+24};
  if(!validRegion(r))throw Error('内容范围过大，暂时无法保存这个视角。');return r;
}
export function fitRegion(region,width,height){
  if(!validRegion(region))throw Error('这个视角的数据无法读取，原数据仍保留。');
  const a=safeViewport(width,height),z=Math.min(a.w/region.w,a.h/region.h,3);
  return {x:a.x+(a.w-region.w*z)/2-region.x*z,y:a.y+(a.h-region.h*z)/2-region.y*z,z};
}
export function changeViews(board,expected,action){
  const current=readViews(board);
  if(!current.available)throw Error('已有视角格式暂不支持，原数据保持完整。');
  if(current.signature!==expected)throw Error('视角列表已经变化，请关闭后重新选择。');
  const data=structuredClone(board[FIELD]??{kind:KIND,version:1,items:[]}),items=data.items,index=items.findIndex(item=>item.id===action.id);
  if(action.kind==='add'){
    if(items.length>=MAX)throw Error('这张白板已有48个视角；可以修改或移除旧视角。');
    if(index!==-1||typeof action.id!=='string'||!action.id||action.id.length>100)throw Error('视角编号无效。');
    if(!validName(action.name)||!validRegion(action.region))throw Error('请填写名称，并选择有效的画面范围。');
    items.push({id:action.id,name:action.name,region:structuredClone(action.region)});
  }else{
    if(index<0)throw Error('这个视角已移除，原内容没有改变。');
    if(action.kind==='edit'){
      if(!validName(action.name)||action.region!==undefined&&!validRegion(action.region))throw Error('请填写名称，并选择有效的画面范围。');
      items[index].name=action.name;if(action.region!==undefined)items[index].region={...items[index].region,...structuredClone(action.region)};
    }else if(action.kind==='remove')items.splice(index,1);
    else if(action.kind==='move'){
      if(![-1,1].includes(action.delta))throw Error('视角顺序无效。');
      const to=index+action.delta;if(to<0||to>=items.length)throw Error('已经在列表边缘。');
      [items[index],items[to]]=[items[to],items[index]];
    }else throw Error('视角操作无法识别。');
  }
  return data;
}
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
function preview(item,nodes){
  const r=item.region,svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`${r.x} ${r.y} ${r.w} ${r.h}`);svg.setAttribute('preserveAspectRatio','xMidYMid meet');svg.setAttribute('aria-hidden','true');svg.classList.add('view-preview');
  for(const n of (nodes||[]).filter(n=>n.x+n.w>r.x&&n.x<r.x+r.w&&n.y+n.h>r.y&&n.y<r.y+r.h).sort((a,b)=>(a.type!=='frame')-(b.type!=='frame')).slice(0,200)){
    if(![n.x,n.y,n.w,n.h].every(finite)||n.w<=0||n.h<=0)continue;
    const rect=document.createElementNS(svg.namespaceURI,'rect');for(const k of ['x','y'])rect.setAttribute(k,String(n[k]));rect.setAttribute('width',String(n.w));rect.setAttribute('height',String(n.h));rect.setAttribute('rx',String(Math.min(n.w,n.h)*.04));
    rect.setAttribute('fill',n.type==='frame'?'none':n.type==='note'&&/^#[a-f0-9]{6}$/i.test(n.color)?n.color:'#938f9e');rect.setAttribute('stroke',n.type==='frame'?'#807587':'#0003');rect.setAttribute('stroke-width',String(Math.max(r.w,r.h)/230));svg.append(rect);
  }return svg;
}
export class SpatialViews{
  constructor(callbacks){
    this.cb=callbacks;this.active=null;this.returnPlace=null;this.form=null;this.drafts=new Map();this.limit=12;this.rendered='';
    $('showViews').onclick=()=>this.toggle('showViews');$('showViewsFromNote').onclick=()=>this.toggle('showViewsFromNote');$('closeViews').onclick=()=>this.closePanel();$('saveView').onclick=()=>this.openForm();$('startViews').onclick=()=>this.visit(this.state.items[0]?.id);
    $('viewPrevious').onclick=()=>this.step(-1);$('viewNext').onclick=()=>this.step(1);$('exitViews').onclick=()=>this.exit();
    $('closeViewDialog').onclick=()=>$('viewDialog').close();$('viewForm').onsubmit=e=>{e.preventDefault();this.submit();};
    $('replaceView').onchange=()=>this.refreshForm();$('moveViewUp').onclick=()=>this.mutate({kind:'move',id:this.form?.id,delta:-1});$('moveViewDown').onclick=()=>this.mutate({kind:'move',id:this.form?.id,delta:1});
    $('removeView').onclick=()=>{if(this.form&&confirm('移除这个视角？白板里的内容不变，可以撤销。'))this.mutate({kind:'remove',id:this.form.id});};
    $('discardViewDraft').onclick=()=>{if(this.form){this.drafts.delete(this.form.existing?this.form.id:'new');this.form=null;}$('viewDialog').close();this.sync();};
    $('reviewViewChanges').onclick=()=>{if(!this.form||!this.cb.canEdit()||!this.state.available)return;this.form.signature=this.state.signature;$('viewChanges').hidden=true;$('viewFormState').textContent='已按刚查看的列表重新核对；名字仍由你确认保存。';};
    $('viewDialog').addEventListener('close',()=>{if(!$('viewDialog').open){this.retainForm();this.form=null;this.sync();this.focusOpener();}});
    document.addEventListener('keydown',e=>{
      if(!this.active||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]')||e.target.closest('input,textarea,select,audio,video,[contenteditable]'))return;
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.exit();}
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();this.step(e.key==='ArrowRight'?1:-1);}
    });
  }
  get state(){return readViews(this.cb.board());}
  get pending(){return Boolean(this.drafts.size)||$('viewDialog').open&&this.formChanged();}
  formChanged(){return this.form&&($('viewName').value!==this.form.originalName||$('replaceView').checked||!this.form.existing&&Boolean($('viewName').value));}
  retainForm(){if(!this.form||!this.formChanged())return;this.drafts.set(this.form.existing?this.form.id:'new',{...this.form,name:$('viewName').value,replace:$('replaceView').checked,source:$('viewSource').value});}
  focusOpener(){const source=$(!this.cb.inspectorHidden()&&matchMedia('(max-width:680px)').matches?'showViewsFromNote':'showViews');source.focus({preventScroll:true});}
  toggle(opener){if(!this.cb.canBrowse())return;this.opener=opener;const panel=$('viewsPanel');panel.hidden=!panel.hidden;for(const id of ['showViews','showViewsFromNote'])$(id).setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden){$('outline').hidden=true;$('showOutline').setAttribute('aria-expanded','false');this.render(true);$('closeViews').focus({preventScroll:true});}}
  closePanel(){const wasOpen=!$('viewsPanel').hidden;$('viewsPanel').hidden=true;for(const id of ['showViews','showViewsFromNote'])$(id).setAttribute('aria-expanded','false');if(wasOpen)this.focusOpener();}
  sync(){
    const browse=this.cb.canBrowse(),editable=this.cb.canEdit(),state=this.state;
    $('showViews').disabled=!browse;$('saveView').disabled=!editable||!state.available||state.items.length>=MAX;$('startViews').disabled=!browse||!state.items.length;
    $('showViewsFromNote').disabled=!browse;
    $('saveView').textContent=this.drafts.has('new')?'继续保存视角':'＋ 保存视角';
    if(!browse){this.closePanel();if(this.active)this.exit(false);}
    if(this.active&&!state.items.some(item=>item.id===this.active))this.exit();
    this.render();this.refreshJourney();if(this.form)this.refreshForm();
  }
  render(force=false){
    if($('viewsPanel').hidden&&!force)return;const state=this.state,editable=this.cb.canEdit(),signature=state.signature+'|'+this.limit+'|'+editable+'|'+JSON.stringify(this.cb.board()?.nodes.map(n=>[n.x,n.y,n.w,n.h,n.color,n.type]));
    if(!force&&signature===this.rendered)return;this.rendered=signature;
    const list=$('viewItems');list.replaceChildren();$('viewPanelState').textContent=!state.available?'已有视角格式暂不支持；原数据保留，可用白板导出。':!state.items.length?'放大到想回来的地方，把这个画面命名保存。':`共 ${state.items.length} 个视角 · 浏览不改动布局`;
    for(const [index,item] of state.items.slice(0,this.limit).entries()){
      const row=el('div',undefined,'view-row'),button=el('button',undefined,'view-open');button.dataset.view=item.id;button.setAttribute('aria-label',`打开视角 ${index+1}：${item.name}`);button.append(preview(item,this.cb.board()?.nodes),el('span',String(index+1).padStart(2,'0'),'view-number'),el('strong',item.name));button.onclick=()=>this.visit(item.id);
      const edit=el('button','调整','view-edit');edit.dataset.viewEdit=item.id;edit.disabled=!editable;edit.setAttribute('aria-label','调整视角 '+item.name);edit.onclick=()=>this.openForm(item.id);row.append(button,edit);list.append(row);
    }
    if(state.items.length>this.limit){const more=el('button','显示更多视角','view-more');more.onclick=()=>{this.limit+=12;this.render(true);$('closeViews').focus({preventScroll:true});};list.append(more);}
  }
  visit(id){
    if(!this.cb.canBrowse())return;const item=this.state.items.find(i=>i.id===id);if(!item)return;
    if(!this.active)this.returnPlace=this.cb.capturePlace();this.active=id;this.closePanel();this.cb.showRegion(item.region);this.refreshJourney();$('exitViews').focus({preventScroll:true});
  }
  refreshJourney(){
    const state=this.state,index=state.items.findIndex(i=>i.id===this.active),item=state.items[index];$('viewJourney').hidden=!item;
    if(!item)return;$('viewJourneyName').textContent=item.name;$('viewJourneyName').title=item.name;$('viewJourneyCount').textContent=`${index+1} / ${state.items.length}`;
    $('viewPrevious').disabled=index===0;$('viewNext').disabled=index===state.items.length-1;
  }
  step(delta){const items=this.state.items,index=items.findIndex(i=>i.id===this.active);if(index>=0&&items[index+delta])this.visit(items[index+delta].id);}
  resize(){const item=this.state.items.find(i=>i.id===this.active);if(!item)return false;this.cb.showRegion(item.region,false);return true;}
  exit(restore=true){const place=this.returnPlace;this.active=null;this.returnPlace=null;$('viewJourney').hidden=true;if(restore&&place&&this.cb.canBrowse())this.cb.restorePlace(place);this.cb.refreshReturn();}
  openForm(id=null){
    if(!this.cb.canEdit())return;const state=this.state;if(!state.available)return;const item=state.items.find(i=>i.id===id);if(id&&!item)return;
    const draft=this.drafts.get(id||'new');this.form=draft?{...draft}:{id:item?.id||crypto.randomUUID(),existing:Boolean(item),signature:state.signature,originalName:item?.name||''};$('viewDialogTitle').textContent=item?'调整这个视角':'保存一个视角';$('viewName').value=draft?.name??item?.name??'';$('replaceView').checked=draft?.replace??false;$('viewSource').value=draft?.source??'current';$('viewChanges').hidden=true;$('viewFormState').textContent=draft?'上次没保存的名字仍在这里；关闭会保留，放弃填写才移除。':'名字由你来写；修改会随白板保存，也可以撤销。';this.refreshForm();$('viewDialog').showModal();$('viewName').focus();
  }
  refreshForm(){
    const form=this.form;if(!form)return;const editable=this.cb.canEdit(),state=this.state,index=state.items.findIndex(i=>i.id===form.id);
    $('viewName').readOnly=!editable;$('replaceViewLabel').hidden=!form.existing;$('replaceView').disabled=!editable;$('viewSourceLabel').hidden=form.existing&&!$('replaceView').checked;$('viewSource').disabled=!editable;
    for(const id of ['moveViewUp','moveViewDown','removeView'])$(id).hidden=!form.existing;
    $('moveViewUp').disabled=!editable||index<=0;$('moveViewDown').disabled=!editable||index<0||index>=state.items.length-1;$('removeView').disabled=!editable||index<0;$('submitView').disabled=!editable||!state.available;$('reviewViewChanges').disabled=!editable||!state.available;
    if(!editable)$('viewFormState').textContent='当前无法修改；你填写的名字仍留在这里。';
  }
  region(){
    const board=this.cb.board();if($('viewSource').value==='all')return contentRegion(board.nodes);
    if($('viewSource').value==='node'){const node=this.cb.selected();if(!node)throw Error('先关闭窗口，在画布选择内容，再回来保存。');return contentRegion([node]);}
    const rect=this.cb.size();return captureRegion(this.cb.view(),rect.width,rect.height);
  }
  submit(){
    if(!this.form||!this.cb.canEdit())return;
    try{const action={kind:this.form.existing?'edit':'add',id:this.form.id,name:$('viewName').value};if(!this.form.existing||$('replaceView').checked)action.region=this.region();this.mutate(action);}catch(e){$('viewFormState').textContent=e.message;}
  }
  mutate(action){
    if(!this.form||!this.cb.canEdit())return;
    try{
      const data=changeViews(this.cb.board(),this.form.signature,action);this.cb.change(data);
      if(['add','edit','remove'].includes(action.kind)){this.drafts.delete(this.form.existing?this.form.id:'new');this.form=null;$('viewDialog').close();this.render(true);}
      else{this.form.signature=this.state.signature;this.refreshForm();$('viewFormState').textContent='顺序已修改；还没提交的名字仍留在输入框，可撤销顺序。';}
    }catch(e){$('viewFormState').textContent=e.message;const state=this.state;if(state.available&&state.signature!==this.form.signature){$('viewChanges').hidden=false;$('viewCurrentNames').textContent=state.items.map((item,index)=>`${index+1}. ${item.name}`).join('\n')||'当前列表没有视角。';}}
  }
}
