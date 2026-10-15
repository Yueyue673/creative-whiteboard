import {BoardSession} from './board-session.js';
import {BoardTransport} from './board-transport.js';
import {BoardMedia,validAssetId,mediaElement,stopMedia,bytesLabel} from './board-media.js';
import {BoardLibrary} from './board-library.js';
import {ReferenceIndex,NoteReferences,installReferences} from './note-references.js';
import {SpatialViews,fitRegion,safeViewport} from './board-views.js';
import {FrameEditor,frameCard,framePatch} from './board-frames.js';
import {TableEditor,tableCard} from './board-tables.js';
import {MediaCues} from './media-cues.js';
import {OwnHistory,valueEqual,validateLiveBoard,canReceiveTableCell} from './board-reconciliation.js';
import {PaperReading} from './paper-reading.js';
import {DistanceReading} from './space-reading.js';
import {BoardRecovery} from './board-recovery.js';
import {BoardFinder} from './board-finder.js';

const $ = id => document.getElementById(id);
const context = Object.freeze(JSON.parse($('board-context').textContent));
const scope = Object.freeze({account: context.account.id, workspace: context.workspace, key: context.key});
const session = new BoardSession(scope,{reconcile:true,onAdopt:adoptCanonical,canReceive:canReceiveCanonical,waitForAdoption});
const destination = `/w/${scope.workspace}/b/${scope.key}/`;
const colours = [['#f0d79e','麦纸'],['#e7bbc5','玫瑰'],['#bed5c5','苔绿'],['#c9c2e8','雾紫'],['#bcd2df','雨蓝'],['#e8e5dc','素白'],['#343943','石墨']];
const parser = window.markdownit({html: false, linkify: false, typographer: false, breaks: true});
installReferences(parser);
parser.renderer.rules.image = (tokens, index) => `<span class="image-reference">${parser.utils.escapeHtml(tokens[index].content || '图片引用')}</span>`;
const linkOpen = parser.renderer.rules.link_open || ((tokens,index,options,env,self) => self.renderToken(tokens,index,options));
parser.renderer.rules.link_open = (tokens,index,options,env,self) => {
  tokens[index].attrSet('target','_blank'); tokens[index].attrSet('rel','noopener noreferrer');
  return linkOpen(tokens,index,options,env,self);
};
let board = null, selected = null, creating = context.create, saveTimer, editorError = '', workspaceName = null;
let view = {x: 48, y: 55, z: 1}, inputGroup = null, composing=false, renderPending=false, historyMessage='',readingLayoutPending=false;
const ownHistory=new OwnHistory();
const narrowEditor=matchMedia('(max-width:680px)'),historyHome=$('undo').parentElement,historyAnchor=$('redo').nextSibling,mediaAnchor=$('showMedia').nextSibling,readingAnchor=$('showPaperReading').nextSibling,finderAnchor=$('showBoardFinder').nextSibling;
function syncHistoryControls(){
  const narrow=narrowEditor.matches&&!$('inspector').hidden,host=narrow?$('inspectorHistory'):historyHome;
  for(const[id,label,icon]of [['undo','撤销','↶'],['redo','重做','↷']]){
    const button=$(id);if(button.parentElement!==host){if(narrow)host.append(button);else host.insertBefore(button,historyAnchor);}
    button.textContent=narrow?icon+' '+label:icon;
  }
  // The narrow inspector covers the canvas toolbar. Keep the same permission-
  // bound library button available while writing, without duplicate controls.
  const reading=$('showPaperReading');
  const readingHost=narrow?document.querySelector('.inspector-heading-actions'):historyHome;
  if(reading.parentElement!==readingHost){if(narrow)readingHost.insertBefore(reading,$('showViewsFromNote'));else readingHost.insertBefore(reading,readingAnchor);}
  reading.textContent=narrow?'Aa':'阅读';
  const media=$('showMedia');
  if(media.parentElement!==host){if(narrow)host.append(media);else host.insertBefore(media,mediaAnchor);}
  const find=$('showBoardFinder');
  if(find.parentElement!==host){if(narrow)host.append(find);else host.insertBefore(find,finderAnchor);}
  $('inspectorHistory').hidden=!narrow;
}
narrowEditor.addEventListener('change',syncHistoryControls);
new MutationObserver(syncHistoryControls).observe($('inspector'),{attributes:true,attributeFilter:['hidden']});
syncHistoryControls();
const adoptionWaiters=new Set();
const stateCanEdit = () => board && ['ready','offline','conflict'].includes(session.state.status);
const selectedNode=()=>board?.nodes.find(node=>node.id===selected);
const editableInspector=()=>['note','frame','table'].includes(selectedNode()?.type);
const activeNode = () => board?.nodes.find(node => node.id === selected && node.type === 'note');
const frames=new FrameEditor({board:()=>board,node:()=>selectedNode()?.type==='frame'?selectedNode():null,canEdit:stateCanEdit,endGroup:()=>{inputGroup=null;},
 change:(next,group)=>{checkpoint(group);Object.assign(selectedNode(),next);commit();},fit:node=>fit([node]),
 remove:id=>{checkpoint();board.nodes=board.nodes.filter(n=>n.id!==id);board.edges=board.edges.filter(e=>e.from!==id&&e.to!==id);selectNode(null);commit();}});
const tables=new TableEditor({scope,colours,raw:()=>rawBoard(),download,mediaAPI:()=>mediaAPI,canReadMedia:()=>mediaAllowed,select:id=>selectNode(id),node:()=>selectedNode()?.type==='table'?selectedNode():null,canEdit:stateCanEdit,canBrowse:()=>canBrowseReferences(),endGroup:()=>{inputGroup=null;},
 change:(next,group)=>{checkpoint(group);Object.assign(selectedNode(),next);commit();},remove:id=>{checkpoint();board.nodes=board.nodes.filter(n=>n.id!==id);board.edges=board.edges.filter(e=>e.from!==id&&e.to!==id);selectNode(null);commit();}});
const canBrowseReferences = () => board && ['ready','readonly','offline','conflict'].includes(session.state.status);
const distanceReading=new DistanceReading({canvas:$('canvas'),cards:$('cards'),board:()=>board,zoom:()=>view.z,height:displayedHeight,mode:()=>document.documentElement.dataset.spaceReading,canRead:canBrowseReferences});
const paperReading=new PaperReading({scope,canRead:canBrowseReferences,canApply:()=>!board||!gesture&&!composing,onApply:refreshReadingLayout,capture:captureReadingPlace,restore:restoreReadingPlace,afterClose:releaseAdoption});
function refreshReadingLayout(){if(!board)return;if(gesture||composing){readingLayoutPending=true;return;}readingLayoutPending=false;const focus=document.activeElement?.matches('#cards>.card')?document.activeElement.dataset.node:null;drawCanvas(false);if(focus&&!document.querySelector('dialog[open]'))[...$('cards').children].find(el=>el.dataset.node===focus)?.focus({preventScroll:true});}
function captureReadingPlace(field=document.activeElement){
  if(!field?.matches('#noteTitle,#noteBody,#noteUserText,#noteAnnotation'))return null;
  return {board,node:selected,field,value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,top:field.scrollTop,left:field.scrollLeft,inspectorTop:$('inspector').scrollTop,view:{...view}};
}
function restoreReadingPlace(place){
  if(!place||place.board!==board||place.node!==selected||!place.field.isConnected||place.field.closest('[hidden]')||place.field.value!==place.value||document.querySelector('dialog[open]'))return;
  view={...place.view};applyView();place.field.focus({preventScroll:true});place.field.setSelectionRange(place.start,place.end,place.direction);place.field.scrollTop=place.top;place.field.scrollLeft=place.left;$('inspector').scrollTop=place.inspectorTop;
}
const finder=new BoardFinder({scope,canRead:canBrowseReferences,name:()=>workspaceName,capture:captureFinderPlace,restore:restoreFinderPlace,afterClose:releaseAdoption});
function captureFinderPlace(field=document.activeElement){
  if(!board||!field?.isConnected||field.id==='showBoardFinder'||field.closest('dialog'))return null;
  return {board,node:selected,field,value:typeof field.value==='string'?field.value:undefined,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,top:field.scrollTop,left:field.scrollLeft,inspectorTop:$('inspector').scrollTop,view:{...view}};
}
function restoreFinderPlace(place){
  if(!place||place.board!==board||place.node!==selected||!place.field.isConnected||place.field.closest('[hidden]')||document.querySelector('dialog[open]')||(place.value!==undefined&&place.field.value!==place.value))return;
  view={...place.view};applyView();place.field.focus({preventScroll:true});
  if(typeof place.start==='number'&&typeof place.end==='number')try{place.field.setSelectionRange(place.start,place.end,place.direction);}catch{}
  place.field.scrollTop=place.top;place.field.scrollLeft=place.left;$('inspector').scrollTop=place.inspectorTop;
}
const referenceIndex=new ReferenceIndex(scope.key,parser),referenceTrail=[];
const references=new NoteReferences(referenceIndex,{navigate:navigateReference,insert:insertReference,canBrowse:canBrowseReferences,canEdit:stateCanEdit,activeNode});
let viewRestorePending=false;
const spatialViews=new SpatialViews({board:()=>board,canBrowse:canBrowseReferences,canEdit:stateCanEdit,view:()=>view,size:()=>$('canvas').getBoundingClientRect(),selected:()=>board?.nodes.find(n=>n.id===selected),inspectorHidden:()=>$('inspector').hidden,
  capturePlace:()=>({...captureReferencePlace(),inspectorHidden:$('inspector').hidden,focus:document.activeElement?.id,trail:structuredClone(referenceTrail)}),
  showRegion:(region,clear=true)=>{if(clear){selected=null;$('inspector').hidden=true;for(const card of $('cards').children)card.classList.remove('selected');}const rect=$('canvas').getBoundingClientRect();view=fitRegion(region,rect.width,rect.height);applyView();refreshReferenceReturn();},
  restorePlace:place=>{viewRestorePending=true;referenceTrail.splice(0,referenceTrail.length,...place.trail);selectNode(board.nodes.some(n=>n.id===place.node)?place.node:null);$('inspector').hidden=place.inspectorHidden||!editableInspector();view={...place.view};applyView();for(const saved of place.fields){const f=$(saved.id);f.setSelectionRange(saved.start,saved.end);f.scrollTop=saved.scroll;}if(selectedNode()?.type==='table'&&tables.restore(place.table,!place.inspectorHidden)){}else if(place.focus&&$(place.focus)&&!$(place.focus).closest('[hidden]'))$(place.focus).focus({preventScroll:true});else if(editableInspector()&&!place.inspectorHidden)$(place.field).focus({preventScroll:true});else $('canvas').focus({preventScroll:true});$('inspector').scrollTop=place.scroll;requestAnimationFrame(()=>requestAnimationFrame(()=>{viewRestorePending=false;}));},
  change:data=>{checkpoint();board.spatialViews=data;commit(false);},refreshReturn:refreshReferenceReturn});
const element = (tag,text,className) => { const item=document.createElement(tag); if(text!==undefined)item.textContent=text; if(className)item.className=className; return item; };
const hex = value => typeof value==='string' && /^#[a-f0-9]{6}$/i.test(value);
const finite = (value,fallback) => typeof value==='number' && Number.isFinite(value) ? value : fallback;
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const rawBoard = () => JSON.stringify(board,null,2);
const mediaAPI=new BoardMedia(scope),mediaCards=new Map(),displayedNoteHeights=new Map();let mediaEpoch=0,mediaAllowed=false;
const cues=new MediaCues({api:mediaAPI,node:id=>board?.nodes.find(n=>n.id===id),active:activeNode,cards:()=>$('cards'),
  canRead:()=>mediaAllowed,canEdit:stateCanEdit,canCreate:()=>stateCanEdit()&&session.state.status==='ready',
  create:(cue,source)=>{checkpoint();const node={id:crypto.randomUUID(),type:'note',title:'',body:'',textFormat:'markdown',color:'#f0d79e',sizeMode:'auto',x:clamp(source.x+source.w+40,-999000,999000),y:clamp(source.y,-999000,999000),w:320,h:180,mediaCue:cue};board.nodes.push(node);commit();selectNode(node.id);fit([source,node]);$('noteBody').focus({preventScroll:true});},
  remove:node=>{checkpoint();delete node.mediaCue;commit();},
  capturePlace:()=>({...captureReferencePlace(),focus:document.activeElement,fields:[...captureReferencePlace().fields,{id:'noteTitle',start:$('noteTitle').selectionStart,end:$('noteTitle').selectionEnd,scroll:$('noteTitle').scrollTop}]}),
  restorePlace:place=>{if(selected!==place.node)return;viewRestorePending=true;view={...place.view};applyView();for(const saved of place.fields){const f=$(saved.id);f.setSelectionRange(saved.start,saved.end);f.scrollTop=saved.scroll;}if(place.focus?.isConnected&&!place.focus.closest('[hidden]'))place.focus.focus({preventScroll:true});else $('canvas').focus({preventScroll:true});$('inspector').scrollTop=place.scroll;requestAnimationFrame(()=>requestAnimationFrame(()=>{viewRestorePending=false;}));}});
const library=new BoardLibrary(mediaAPI,asset=>{
  if(!stateCanEdit()||session.state.status!=='ready')return;checkpoint();
  const rect=$('canvas').getBoundingClientRect();
  const node={id:crypto.randomUUID(),type:'image',assetId:asset.id,title:asset.title||asset.filename,
    x:Math.round((rect.width/2-view.x)/view.z-200),y:Math.round((rect.height/2-view.y)/view.z-140),w:400,h:asset.kind==='audio'?210:310};
  board.nodes.push(node);commit();selectNode(node.id);fit([node]);
},scope);

$('backWorkspace').href = $('cancelCreate').href = `/w/${scope.workspace}/`;
$('latestBoard').href = destination;
$('accountLabel').textContent = context.account.name;

function applyView() {
  $('world').style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
  $('canvas').style.setProperty('--control-scale',String(Math.min(1e6,1/view.z)));
  $('zoomValue').textContent = (view.z<.01?(view.z*100).toFixed(2):Math.round(view.z*100))+'%';
  distanceReading.schedule();
}
function displayedHeight(node){
  const height=node.type==='note'&&node.sizeMode==='auto'?(displayedNoteHeights.get(node.id)??node.h):node.h;
  // Existing short manual paper still paints at the card's 96px minimum.
  // Names, connections and Fit follow that view without normalizing author data.
  return ['note','table'].includes(node.type)?Math.max(96,height):height;
}
function fit(nodes = board?.nodes) {
  if(!nodes?.length){view={x:48,y:55,z:1};applyView();return;}
  const rect=$('canvas').getBoundingClientRect();
  const minX=Math.min(...nodes.map(n=>n.x)), minY=Math.min(...nodes.map(n=>n.y));
  const maxX=Math.max(...nodes.map(n=>n.x+n.w)), maxY=Math.max(...nodes.map(n=>n.y+displayedHeight(n)));
  if(rect.width<80||rect.height<180)return;
  const area=safeViewport(rect.width,rect.height),z=clamp(Math.min(area.w/Math.max(1,maxX-minX),area.h/Math.max(1,maxY-minY)),1e-6,1.35);
  view={x:area.x+(area.w-(maxX-minX)*z)/2-minX*z,y:area.y+(area.h-(maxY-minY)*z)/2-minY*z,z};applyView();
}
function zoom(factor, clientX, clientY) {
  const rect=$('canvas').getBoundingClientRect(); const x=(clientX??rect.left+rect.width/2)-rect.left, y=(clientY??rect.top+rect.height/2)-rect.top;
  const z=clamp(view.z*factor,1e-6,3);view.x=x-(x-view.x)*z/view.z;view.y=y-(y-view.y)*z/view.z;view.z=z;applyView();
}
function checkpoint(group = null) {
  if(!stateCanEdit() || (group && inputGroup===group))return;
  ownHistory.begin(board);inputGroup=group;historyMessage='';
}
function scheduleSave() {
  clearTimeout(saveTimer);
  if(!gesture&&!composing&&!editorError && session.state.status==='ready' && session.state.dirty)saveTimer=setTimeout(()=>performSave(),1000);
}
function commit(draw = true) {
  if(!stateCanEdit())return;
  ownHistory.record(board);
  try { session.updateRaw(rawBoard()).catch(()=>{}); editorError=''; }
  catch(error){editorError=error.message+' 当前输入仍在页面，可导出；缩减内容后再保存。';clearTimeout(saveTimer);}
  if(draw)drawCanvas(true);refreshState();scheduleSave();
}
async function performSave() {
  clearTimeout(saveTimer);
  if(!board ||gesture||composing|| editorError || !['ready','offline'].includes(session.state.status))return;
  try {
    const result=await session.save();
    if(creating && result.saved){creating=false;$('createPanel').hidden=true;history.replaceState(null,'',destination);}
    if(result.remainingDirty && session.state.status==='ready')scheduleSave();
  } catch { /* Session status explains failure; no background retry of failed writes. */ }
}

function refreshPageTitle(state=session.state) {
  const notices=[];
  if(state.status==='paused')notices.push('已暂停');
  else if(state.status==='conflict')notices.push('需核对');
  else if(state.status==='offline')notices.push('连接中断');
  else if(state.status==='readonly')notices.push('只读');
  // A missing acknowledgement can follow a committed write. Describe the local
  // confirmation boundary, rather than claiming the server has no saved copy.
  if(board&&(state.dirty||editorError))notices.push('修改待确认');
  const name=board?(board.name.trim()||'未命名白板'):creating?'新建白板':'白板';
  document.title=[...notices,name,...(workspaceName===null?[]:[workspaceName]),'创作白板'].join(' · ');
}
function refreshState() {
  const state=session.state, editable=stateCanEdit();
  refreshPageTitle(state);
  distanceReading.schedule();
  paperReading.sync();
  references.sync();refreshReferenceReturn();
  spatialViews.sync();
  for(const button of $('cards').querySelectorAll('[data-reference]'))button.disabled=!canBrowseReferences();
  const canRead=Boolean(board)&&['ready','readonly','conflict'].includes(state.status);
  const resumed=!mediaAllowed&&canRead;
  if(mediaAllowed&&!canRead){mediaEpoch++;for(const entry of mediaCards.values()){stopMedia(entry.card);entry.card.remove();}mediaCards.clear();}
  mediaAllowed=canRead;library.sync(canRead,Boolean(editable)&&state.status==='ready');
  if(resumed)drawCanvas();
  $('saveState').textContent=historyMessage || editorError || state.message || (state.status==='readonly'?'只读 · 原文可以查看与导出':state.saving?'正在保存…':state.dirty?'修改仍在当前页面':board?'已保存':'正在打开…');
  $('saveState').dataset.stopped=String(Boolean(editorError)||['paused','readonly','conflict','offline'].includes(state.status));
  const localText=editorError?'较早的浏览器副本不包含这次超限输入，请先导出当前原文。':state.local==='stored'&&state.dirty?'浏览器副本已保留':state.local==='pending'?'正在保留浏览器副本…':state.localError || state.liveMessage || '';
  if($('localState').textContent!==localText)$('localState').textContent=localText;
  $('boardName').readOnly=!editable;
  $('addNote').disabled=!editable;$('addFrame').disabled=!editable;$('addTable').disabled=!editable;
  $('saveBoard').disabled=!board || Boolean(editorError) || !['ready','offline'].includes(state.status) || state.saving || !state.dirty;
  $('saveBoard').textContent=state.saving?'保存中':'保存';
  $('exportBoard').disabled=!state.raw;
  $('undo').disabled=!editable || !ownHistory.undoEntries.length;$('redo').disabled=!editable || !ownHistory.redoEntries.length;
  for(const input of $('inspector').querySelectorAll('input,textarea')){
    if(['text','number'].includes(input.type)||input.tagName==='TEXTAREA')input.readOnly=!editable;
    else input.disabled=!editable;
  }
  for(const button of $('inspector').querySelectorAll('button,select'))if(!['closeInspector','undo','redo'].includes(button.id))button.disabled=button.hasAttribute('data-reference-read')?!canBrowseReferences():!editable;
  $('noteHeight').readOnly=!editable || activeNode()?.sizeMode==='auto';frames.sync();tables.sync();cues.sync();finder.sync();
  if(['paused','readonly','conflict','offline'].includes(state.status))clearTimeout(saveTimer);
}
session.addEventListener('change',refreshState);

function luminance(colour) {
  const components=[1,3,5].map(start=>parseInt(colour.slice(start,start+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return components[0]*.2126+components[1]*.7152+components[2]*.0722;
}
function ink(colour) {
  const paper=luminance(colour);
  const choices=['#000000','#ffffff'];
  return choices.reduce((best,candidate)=>{
    const contrast=value=>{const light=luminance(value);return (Math.max(paper,light)+.05)/(Math.min(paper,light)+.05);};
    return contrast(candidate)>contrast(best)?candidate:best;
  });
}
function noteContent(node) {
  const content=element('div',undefined,'note-content');
  const title=element('h2',node.title || '', 'card-title');if(!node.title)title.hidden=true;content.append(title);
  for(const name of ['body','userText','annotation']){
    if(typeof node[name]!=='string' || !node[name])continue;
    const text=element('div',undefined,'note-text'+(name==='body'?'':' supplementary'));
    if(node.textFormat==='markdown')text.innerHTML=parser.render(node[name],{references:referenceIndex});else {text.textContent=node[name];text.classList.add('plain-text');}
    content.append(text);
  }
  if(!node.title&&!node.body&&!node.userText&&!node.annotation)content.append(element('p','点击这张便签，开始写自己的内容。','empty-note'));
  return content;
}
function drawEdges() {
  const svg=$('edges');svg.replaceChildren();
  for(const edge of board.edges){
    const from=board.nodes.find(n=>n.id===edge.from),to=board.nodes.find(n=>n.id===edge.to);if(!from||!to)continue;
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    for(const [key,value] of Object.entries({x1:from.x+from.w/2,y1:from.y+displayedHeight(from)/2,x2:to.x+to.w/2,y2:to.y+displayedHeight(to)/2}))line.setAttribute(key,String(value));
    svg.append(line);
  }
}
function drawOutline() {
  const list=$('outlineItems');list.replaceChildren();
  for(const node of board.nodes){const button=element('button',node.title || ({note:'空白便签',table:'表格',image:'图片',frame:'分区'}[node.type]||'内容'),'outline-item');button.dataset.node=node.id;button.onclick=()=>{fit([node]);selectNode(node.id);$('outline').hidden=true;$('showOutline').setAttribute('aria-expanded','false');};list.append(button);}
}
function mediaCard(node){
  const previous=mediaCards.get(node.id);
  if(previous?.assetId===node.assetId){previous.card.querySelector('.card-title').textContent=node.title||'';return previous.card;}
  if(previous){for(const player of previous.card.querySelectorAll('audio,video'))cues.detach(player);stopMedia(previous.card);}
  const id=node.id,assetId=node.assetId,card=element('article',undefined,'card reference-card media-card');
  card.append(element('span','素材','reference-type'),element('h2',node.title||'','card-title'));
  const body=element('div',undefined,'media-card-body'),download=element('a','下载原文件 ↧','media-download');card.append(body,download);download.hidden=true;
  mediaCards.set(id,{assetId,card});let generation=0,pending=false;
  const current=()=>mediaAllowed&&card.isConnected&&mediaCards.get(id)?.card===card&&board.nodes.some(row=>row.id===id&&row.type==='image'&&row.assetId===assetId);
  const clear=()=>{for(const player of body.querySelectorAll('audio,video'))cues.detach(player);stopMedia(body);body.replaceChildren();};
  const report=message=>{let state=body.querySelector('.media-retry-state');if(!state){state=element('p',undefined,'reference-caption media-retry-state');state.setAttribute('role','status');body.append(state);}state.textContent=message;};
  const offer=(message='',resume=null)=>{
    const epoch=++generation,focused=body.contains(document.activeElement);clear();
    if(message)report(message);
    const open=element('button',message?'重新核对媒体':'打开媒体','media-reopen');open.type='button';body.append(open);
    open.onclick=async()=>{
      if(pending||epoch!==generation||open.parentElement!==body||!current())return;
      const token=++generation;pending=true;open.disabled=true;open.textContent='正在核对素材…';download.hidden=true;download.removeAttribute('href');
      const valid=()=>token===generation&&current();
      try{
        await mediaAPI.access();const asset=await mediaAPI.read(assetId);await mediaAPI.access();if(!valid())return;
        clear();const item=mediaElement(asset);
        if(item){
          item.onerror=()=>{if(valid()&&item.parentElement===body)offer('媒体暂时无法加载；可以重新核对，也可下载原文件。',{asset,position:Number.isFinite(item.currentTime)?item.currentTime:null});};
          if(resume&&Number.isFinite(resume.position)&&resume.position>0&&['id','contentHash','size','mime','mediaURL'].every(key=>resume.asset?.[key]===asset[key])){
            item.addEventListener('loadedmetadata',()=>{if(valid()&&item.parentElement===body&&Number.isFinite(item.duration)&&item.duration>0){try{item.currentTime=Math.min(resume.position,item.duration);}catch{}}},{once:true});
          }
          body.append(item);
        }else body.append(element('p','这个文件只提供下载，不在白板内执行。','reference-caption'));
        body.append(element('span',asset.mime+' · '+bytesLabel(asset.size),'media-item-caption'));
        if(item)cues.attach(item,asset,id,body);
        download.hidden=false;download.href=asset.mediaURL;download.download=asset.filename;
      }catch(error){if(valid())offer(error.message,resume);}
      finally{pending=false;}
    };
    if(focused)open.focus({preventScroll:true});
  };
  offer();
  download.onclick=async event=>{event.preventDefault();if(download.hidden||pending||!current())return;const token=generation;
    try{await mediaAPI.access();if(token!==generation||!current())return;
      const link=element('a');link.href=mediaAPI.url(assetId);link.download=download.download;document.body.append(link);link.click();link.remove();
    }catch(error){if(token===generation&&current())report(error.message);}
  };
  return card;
}
function drawCanvas(allowResize=false) {
  if(!board)return;let resized=false;
  displayedNoteHeights.clear();
  referenceIndex.update(board);
  const cards=$('cards');
  // Keep opened media mounted: editing a different note must not restart playback.
  for(const child of [...cards.children])if(!mediaCards.has(child.dataset.node))child.remove();
  for(const [id,entry] of mediaCards){if(!board.nodes.some(node=>node.id===id&&node.type==='image'&&node.assetId===entry.assetId)){
    stopMedia(entry.card);entry.card.remove();mediaCards.delete(id);
  }}
  for(const node of board.nodes){
    const hostedMedia=node.type==='image'&&validAssetId(node.assetId);
    const card=hostedMedia?mediaCard(node):node.type==='frame'?frameCard(node,node.id===selected):node.type==='table'?tableCard(node):element('article',undefined,'card '+(node.type==='note'?'note-card':'reference-card'));card.dataset.node=node.id;card.tabIndex=0;
    card.setAttribute('aria-label',node.title||({note:'空白便签',table:'表格',image:'图片',frame:'分区'}[node.type]||'内容'));
    card.classList.toggle('selected',node.id===selected);
    card.style.left=node.x+'px';card.style.top=node.y+'px';card.style.width=node.w+'px';
    if(node.type==='note'){
      const colour=hex(node.color)?node.color:'#e8e5dc';card.style.setProperty('--paper',colour);card.style.setProperty('--paper-ink',ink(colour));
      card.style.setProperty('--note-font',clamp(finite(node.fontSize,16),10,40)+'px');
      card.classList.add('paper-'+(['lined','grid'].includes(node.paperStyle)?node.paperStyle:'plain'));
      card.append(noteContent(node));const cueBadge=cues.badge(node);if(cueBadge)card.append(cueBadge);
    }else if(!hostedMedia&&!['frame','table'].includes(node.type)){
      card.append(element('span',{table:'表格',image:'图片',frame:'分区'}[node.type]||'内容','reference-type'),element('h2',node.title||'', 'card-title'));
      if(node.type==='table'){
        const table=element('table');const header=element('tr');for(const name of (node.columns||[]).slice(0,5))header.append(element('th',name));table.append(header);
        for(const row of (node.rows||[]).slice(0,8)){const tr=element('tr');for(const value of row.slice(0,5))tr.append(element('td',value));table.append(tr);}card.append(table);
      }else if(node.body)card.append(element('p',node.body,'plain-text'));
      card.append(element('p','可移动与查看；这类内容的完整编辑仍在开发。','reference-caption'));
    }
    card.style.height=node.type==='note'&&node.sizeMode==='auto'?'auto':node.h+'px';if(card.parentNode!==cards)cards.append(card);
    if(node.type==='note'&&node.sizeMode==='auto'){
      const height=clamp(card.offsetHeight,96,20000);card.style.height=height+'px';displayedNoteHeights.set(node.id,height);
      const before=ownHistory.pending?.before.nodes.find(item=>item.id===node.id);
      if(allowResize&&ownHistory.pending&&(!before||!valueEqual(before,node))&&stateCanEdit()&&node.h!==height){node.h=height;resized=true;}
    }
    card.onkeydown=event=>{if(event.target===card&&event.key==='Enter'){event.preventDefault();selectNode(node.id);}};
  }
  $('nodeCount').textContent=board.nodes.length+' 个内容';$('emptyCanvas').hidden=board.nodes.length!==0;
  drawEdges();drawOutline();applyView();
  if(resized)commit(false);
}
function selectNode(id,retainTableFields=false) {
  selected=id;inputGroup=null;
  for(const card of $('cards').children)card.classList.toggle('selected',card.dataset.node===id);
  const chosen=selectedNode();$('noteFields').hidden=chosen?.type!=='note';$('frameFields').hidden=chosen?.type!=='frame';$('tableFields').hidden=chosen?.type!=='table';$('inspector').classList.toggle('table-inspector',chosen?.type==='table');
  $('inspectorTitle').textContent=chosen?.type==='frame'?'整理这个区域':chosen?.type==='table'?'原文，放进表格':'专注这一张';$('inspectorEyebrow').textContent=chosen?.type==='frame'?'空间的边界':chosen?.type==='table'?'按你的思路整理':'你的原文';$('inspector').setAttribute('aria-label',chosen?.type==='frame'?'编辑分区边界':chosen?.type==='table'?'编辑表格文字与行列':'专注编辑便签');$('closeInspector').setAttribute('aria-label','关闭内容编辑');
  if(!editableInspector()){$('inspector').hidden=true;refreshReferenceReturn();return;}
  $('inspector').hidden=false;
  if(chosen.type==='frame'){drawCanvas();frames.select();refreshState();return;}
  if(chosen.type==='table'){tables.select(retainTableFields);refreshState();return;}
  const node=activeNode();
  for(const [field,key] of [['noteTitle','title'],['noteBody','body'],['noteUserText','userText'],['noteAnnotation','annotation']])$(field).value=node[key]||'';
  const colour=hex(node.color)?node.color:'#e8e5dc';$('noteColour').value=$('noteHex').value=colour;
  $('paperStyle').value=['lined','grid'].includes(node.paperStyle)?node.paperStyle:'plain';$('sizeMode').value=node.sizeMode==='auto'?'auto':'manual';
  $('markdownMode').checked=node.textFormat==='markdown';$('noteFont').value=clamp(finite(node.fontSize,16),10,40);
  $('noteWidth').value=node.w;$('noteHeight').value=node.h;
  for(const button of $('swatches').children)button.setAttribute('aria-pressed',String(button.dataset.colour===colour));
  refreshState();
}
let lastCanvasSize=null;
new ResizeObserver(()=>{
  const rect=$('canvas').getBoundingClientRect();
  const changed=lastCanvasSize&&(lastCanvasSize.width!==rect.width||lastCanvasSize.height!==rect.height);
  lastCanvasSize={width:rect.width,height:rect.height};
  if(!changed||!board||gesture||viewRestorePending)return;
  if(spatialViews.resize())return;
  const node=board.nodes.find(item=>item.id===selected);
  const visible=item=>{const x=view.x+item.x*view.z,y=view.y+item.y*view.z;return x+item.w*view.z>24&&x<rect.width-24&&y+displayedHeight(item)*view.z>24&&y<rect.height-100;};
  if(node&&!visible(node))fit([node]);
  else if(!board.nodes.some(visible))fit();
}).observe($('canvas'));
$('closeInspector').onclick=()=>{$('inspector').hidden=true;selected=null;for(const card of $('cards').children)card.classList.remove('selected');inputGroup=null;refreshReferenceReturn();};
function captureReferencePlace(){
  return {node:selected,view:{...view},scroll:$('inspector').scrollTop,table:tables.capture(),field:selectedNode()?.type==='frame'?frames.lastField:selectedNode()?.type==='table'?tables.lastField:references.lastField||'noteBody',fields:['noteBody','noteUserText','noteAnnotation','frameTitle','frameBody','tableTitle','tableBody'].map(id=>({id,start:$(id).selectionStart,end:$(id).selectionEnd,scroll:$(id).scrollTop}))};
}
function navigateReference(node,{field='body'}={}){
  if(!canBrowseReferences()||!referenceIndex.ids.has(node.id))return;
  referenceTrail.push(captureReferencePlace());if(referenceTrail.length>16)referenceTrail.shift();
  selectNode(node.id);fit([node]);
  if(activeNode()){const id={body:'noteBody',userText:'noteUserText',annotation:'noteAnnotation'}[field]||'noteBody';if(id!=='noteBody')$(id).closest('details').open=true;$(id).focus({preventScroll:true});$('inspector').scrollTop=0;}else $('canvas').focus({preventScroll:true});
  refreshReferenceReturn();
}
function refreshReferenceReturn(){
  const place=referenceTrail.at(-1),node=board?.nodes.find(n=>n.id===place?.node),label='← 回到 '+(node?.title||'刚才的位置');
  for(const id of ['returnReference','returnReferenceCanvas']){$(id).hidden=Boolean(spatialViews.active)||!place||(id==='returnReferenceCanvas'?!$('inspector').hidden:$('inspector').hidden);$(id).textContent=label;$(id).disabled=!canBrowseReferences();}
}
function returnReference(){
  if(!canBrowseReferences()||!referenceTrail.length)return;const place=referenceTrail.pop(),node=board.nodes.find(n=>n.id===place.node);
  if(!node){refreshReferenceReturn();$('referenceMessage').textContent='刚才的内容已移除；当前原文没有改动。';return;}
  selectNode(node.id);view={...place.view};applyView();
  if(editableInspector()){for(const saved of place.fields){const field=$(saved.id);field.setSelectionRange(saved.start,saved.end);field.scrollTop=saved.scroll;}if(selectedNode()?.type==='table')tables.restore(place.table);else $(place.field).focus({preventScroll:true});$('inspector').scrollTop=place.scroll;}else $('canvas').focus({preventScroll:true});
  refreshReferenceReturn();
}
$('returnReference').onclick=$('returnReferenceCanvas').onclick=returnReference;
function insertReference(place,link){
  const node=activeNode();if(!node||node.id!==place.node||!stateCanEdit())return;const field=$(place.field),key={noteBody:'body',noteUserText:'userText',noteAnnotation:'annotation'}[place.field];
  if(!key||field.value!==place.raw)return;checkpoint();node[key]=place.raw.slice(0,place.start)+link+place.raw.slice(place.end);node.textFormat='markdown';field.value=node[key];$('markdownMode').checked=true;commit();
  field.focus({preventScroll:true});field.setSelectionRange(place.start+link.length,place.start+link.length);field.scrollTop=place.scroll;
}
$('cards').addEventListener('click',event=>{const link=event.target.closest('[data-reference]');if(link){event.preventDefault();event.stopPropagation();const node=board?.nodes.find(n=>n.id===link.closest('[data-node]')?.dataset.node);if(node&&node.id!==selected)selectNode(node.id);references.follow(link.dataset.reference);}});
$('addNote').onclick=()=>{
  if(!stateCanEdit())return;checkpoint();
  const rect=$('canvas').getBoundingClientRect();const node={id:crypto.randomUUID(),type:'note',x:Math.round((rect.width/2-view.x)/view.z-160),y:Math.round((rect.height/2-view.y)/view.z-90),w:320,h:180,title:'',body:'',userText:'',annotation:'',sizeMode:'auto',textFormat:'plain',paperStyle:'plain',color:'#f0d79e'};
  board.nodes.push(node);commit();selectNode(node.id);$('noteBody').focus({preventScroll:true});
};
for(const [field,key] of [['noteTitle','title'],['noteBody','body'],['noteUserText','userText'],['noteAnnotation','annotation']]){
  $(field).addEventListener('focus',()=>{inputGroup=null;});
  $(field).addEventListener('input',()=>{const node=activeNode();if(!node||!stateCanEdit())return;checkpoint(field);node[key]=$(field).value;commit();});
}
$('addFrame').onclick=()=>{if(!stateCanEdit())return;checkpoint();const rect=$('canvas').getBoundingClientRect(),node={id:crypto.randomUUID(),type:'frame',title:'',body:'',color:'#a8aaad',x:clamp(Math.round((rect.width/2-view.x)/view.z-280),-999000,999000),y:clamp(Math.round((rect.height/2-view.y)/view.z-210),-999000,999000),w:560,h:420};board.nodes.unshift(node);commit();selectNode(node.id);fit([node]);$('frameTitle').focus({preventScroll:true});};
$('addTable').onclick=()=>{if(!stateCanEdit())return;checkpoint();const rect=$('canvas').getBoundingClientRect(),node={id:crypto.randomUUID(),type:'table',title:'',body:'',columns:['','',''],rows:Array.from({length:3},()=>['','','']),rowIds:Array.from({length:3},()=>crypto.randomUUID()),columnIds:Array.from({length:3},()=>crypto.randomUUID()),x:clamp(Math.round((rect.width/2-view.x)/view.z-310),-999000,999000),y:clamp(Math.round((rect.height/2-view.y)/view.z-180),-999000,999000),w:620,h:360};board.nodes.push(node);commit();selectNode(node.id);$('tableTitle').focus({preventScroll:true});};
$('boardName').onfocus=()=>{inputGroup=null;};
$('boardName').oninput=()=>{if(!stateCanEdit())return;checkpoint('boardName');board.name=$('boardName').value;commit(false);};
function noteChange(key,value) {const node=activeNode();if(!node||!stateCanEdit()||node[key]===value)return;checkpoint();node[key]=value;commit();refreshState();}
function refreshColourChoice(colour) {for(const button of $('swatches').children)button.setAttribute('aria-pressed',String(button.dataset.colour.toLowerCase()===colour.toLowerCase()));}
for(const [colour,name] of colours){const button=element('button',undefined,'swatch');button.dataset.colour=colour;button.style.backgroundColor=colour;button.setAttribute('aria-label',name);button.title=name;button.onclick=()=>{noteChange('color',colour);$('noteColour').value=$('noteHex').value=colour;for(const b of $('swatches').children)b.setAttribute('aria-pressed',String(b===button));};$('swatches').append(button);}
$('noteColour').oninput=()=>{const node=activeNode();if(!node||!stateCanEdit())return;checkpoint('colour');node.color=$('noteColour').value;$('noteHex').value=node.color;refreshColourChoice(node.color);commit();};$('noteColour').onchange=()=>{inputGroup=null;};
$('noteHex').oninput=()=>$('noteHex').setCustomValidity('');
$('noteHex').onchange=()=>{if(!hex($('noteHex').value)){$('noteHex').setCustomValidity('请填写完整颜色，例如 #f0d79e');$('noteHex').reportValidity();return;}noteChange('color',$('noteHex').value);$('noteColour').value=$('noteHex').value;refreshColourChoice($('noteHex').value);};
$('paperStyle').onchange=()=>noteChange('paperStyle',$('paperStyle').value);
$('markdownMode').onchange=()=>noteChange('textFormat',$('markdownMode').checked?'markdown':'plain');
$('noteFont').onchange=()=>{if($('noteFont').reportValidity())noteChange('fontSize',Number($('noteFont').value));};
$('sizeMode').onchange=()=>{noteChange('sizeMode',$('sizeMode').value);$('noteHeight').value=activeNode()?.h??'';};
for(const [field,key] of [['noteWidth','w'],['noteHeight','h']])$(field).onchange=()=>{if($(field).reportValidity())noteChange(key,Number($(field).value));};
$('deleteNote').onclick=()=>{const node=activeNode();if(!node||!stateCanEdit()||!confirm('移除这张便签及其连线？可以撤销。'))return;checkpoint();board.nodes=board.nodes.filter(n=>n.id!==node.id);board.edges=board.edges.filter(e=>e.from!==node.id&&e.to!==node.id);selected=null;$('inspector').hidden=true;commit();};

function format(kind) {
  const node=activeNode(),field=$('noteBody');if(!node||!stateCanEdit())return;
  const raw=field.value,start=field.selectionStart,end=field.selectionEnd,selection=raw.slice(start,end);
  const wrappers={bold:['**','**'],italic:['*','*'],strike:['~~','~~'],code:['`','`'],fence:['```\n','\n```']};
  let from=start,to=end,replacement,caret;
  if(wrappers[kind]){const [before,after]=wrappers[kind];replacement=before+selection+after;caret=[start+before.length,end+before.length];}
  else{
    from=start===0?0:raw.lastIndexOf('\n',start-1)+1;to=raw.indexOf('\n',end);if(to===-1)to=raw.length;
    const prefixes={heading:'# ',quote:'> ',bullet:'- ',number:'1. ',task:'- [ ] '};
    replacement=raw.slice(from,to).split('\n').map((line,index)=>(kind==='number'?`${index+1}. `:prefixes[kind])+line).join('\n');caret=[from,from+replacement.length];
  }
  checkpoint();node.body=raw.slice(0,from)+replacement+raw.slice(to);node.textFormat='markdown';field.value=node.body;$('markdownMode').checked=true;commit();
  field.focus({preventScroll:true});field.setSelectionRange(...caret);
}
for(const button of document.querySelectorAll('[data-format]')){button.onpointerdown=event=>event.preventDefault();button.onclick=()=>format(button.dataset.format);}
function travelHistory(redo) {
  if(!stateCanEdit())return;
  let next;try{next=ownHistory.apply(board,redo);}catch{historyMessage='这部分又被修改，未撤销或重做后来的内容。';refreshState();return;}if(!next)return;
  board=next;inputGroup=null;historyMessage='';
  $('boardName').value=board.name;commit();if(editableInspector())selectNode(selected);else{$('inspector').hidden=true;selected=null;}
}
$('undo').onclick=()=>travelHistory(false);$('redo').onclick=()=>travelHistory(true);
$('saveBoard').onclick=performSave;$('zoomIn').onclick=()=>zoom(1.2);$('zoomOut').onclick=()=>zoom(1/1.2);$('fitView').onclick=()=>fit();
$('showOutline').onclick=()=>{spatialViews.closePanel();$('outline').hidden=!$('outline').hidden;$('showOutline').setAttribute('aria-expanded',String(!$('outline').hidden));};
$('closeOutline').onclick=()=>{$('outline').hidden=true;$('showOutline').setAttribute('aria-expanded','false');};
$('canvas').addEventListener('wheel',event=>{if(event.target.closest('audio,video'))return;event.preventDefault();zoom(Math.exp(-clamp(event.deltaY,-120,120)*.002),event.clientX,event.clientY);},{passive:false});

const pointers=new Map();let gesture=null;
$('canvas').onpointerdown=event=>{
  const grip=event.target.closest('[data-frame-resize]');
  if(event.button!==0||(!grip&&event.target.closest('a,button,input,audio,video')))return;
  if(grip&&!stateCanEdit())return;
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});$('canvas').setPointerCapture(event.pointerId);
  if(pointers.size===2){const [a,b]=[...pointers.values()];gesture={kind:'pinch',distance:Math.hypot(a.x-b.x,a.y-b.y),z:view.z};return;}
  const card=event.target.closest('[data-node]');const node=card&&board?.nodes.find(n=>n.id===card.dataset.node);
  gesture={kind:grip&&node?.type==='frame'?'resize':node&&stateCanEdit()?'node':'pan',node,startX:event.clientX,startY:event.clientY,x:node?.x??view.x,y:node?.y??view.y,w:node?.w,h:node?.h,moved:false};
};
$('canvas').onpointermove=event=>{
  if(!pointers.has(event.pointerId)||!gesture)return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(gesture.kind==='pinch'){
    if(pointers.size!==2)return;const [a,b]=[...pointers.values()];const distance=Math.hypot(a.x-b.x,a.y-b.y);zoom(distance/Math.max(1,gesture.distance),(a.x+b.x)/2,(a.y+b.y)/2);gesture.distance=distance;return;
  }
  const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;if(Math.hypot(dx,dy)<4&&!gesture.moved)return;
  if(gesture.kind==='resize'){
    if(!stateCanEdit()||selectedNode()!==gesture.node||!board.nodes.includes(gesture.node))return;
    if(!gesture.moved)checkpoint();
    try{Object.assign(gesture.node,framePatch(gesture.node,{w:clamp(Math.round(gesture.w+dx/view.z),80,999000),h:clamp(Math.round(gesture.h+dy/view.z),80,999000)}));}catch{return;}
    const card=[...$('cards').children].find(c=>c.dataset.node===gesture.node.id);if(card){card.style.width=gesture.node.w+'px';card.style.height=gesture.node.h+'px';}frames.geometry();drawEdges();commit(false);
  }else if(gesture.kind==='node'){
    if(!stateCanEdit()||!board.nodes.includes(gesture.node))return;if(!gesture.moved)checkpoint();
    gesture.node.x=clamp(Math.round(gesture.x+dx/view.z),-999000,999000);gesture.node.y=clamp(Math.round(gesture.y+dy/view.z),-999000,999000);
    const card=[...$('cards').children].find(c=>c.dataset.node===gesture.node.id);if(card){card.style.left=gesture.node.x+'px';card.style.top=gesture.node.y+'px';}
    if(gesture.node.type==='frame')frames.geometry();drawEdges();commit(false);
  }else{view.x=gesture.x+dx;view.y=gesture.y+dy;applyView();}
  gesture.moved=true;
};
function finishGesture(event) {
  pointers.delete(event.pointerId);
  if(!gesture)return;
  if(gesture.kind!=='pinch'&&!gesture.moved&&gesture.node)selectNode(gesture.node.id);
  if(['node','resize'].includes(gesture.kind)&&gesture.moved)drawOutline();
  gesture=null;
  releaseAdoption();scheduleSave();
  if(renderPending)renderCanonical();
}
$('canvas').onpointerup=finishGesture;$('canvas').onpointercancel=finishGesture;
$('canvas').onlostpointercapture=finishGesture;
window.addEventListener('blur',()=>{if(gesture){pointers.clear();gesture=null;releaseAdoption();scheduleSave();if(renderPending)renderCanonical();}});
$('cards').addEventListener('keydown',event=>{const grip=event.target.closest('[data-frame-resize]');if(!grip||!stateCanEdit()||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;const node=selectedNode();if(node?.id!==grip.dataset.frameResize||node.type!=='frame')return;event.preventDefault();const amount=event.shiftKey?10:1,patch=event.key==='ArrowLeft'?{w:Math.max(80,node.w-amount)}:event.key==='ArrowRight'?{w:Math.min(999000,node.w+amount)}:event.key==='ArrowUp'?{h:Math.max(80,node.h-amount)}:{h:Math.min(999000,node.h+amount)};if(frames.change(patch)){frames.geometry();$('cards').querySelector('[data-frame-resize]')?.focus({preventScroll:true});}});

function download(raw,name='whiteboard') {
  const blob=new Blob([raw],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=element('a');
  a.href=url;a.download=(name.replace(/[^\w\u4e00-\u9fff.-]+/g,'_').slice(0,80)||'whiteboard')+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('exportBoard').onclick=()=>download(board?rawBoard():session.exportRaw(),board?.name||'whiteboard');
new BoardRecovery({scope,session,raw:rawBoard,canEdit:stateCanEdit,download,
  capture:(field=document.activeElement)=>{if(!field?.matches('#inspector input:not([type]),#inspector input[type="text"],#inspector textarea'))return null;return {board,node:selected,field,value:field.value,start:field.selectionStart,end:field.selectionEnd,direction:field.selectionDirection,top:field.scrollTop,left:field.scrollLeft,inspectorTop:$('inspector').scrollTop,view:{...view}};},
  restore:restoreReadingPlace,
  apply:value=>{checkpoint();board=value;$('boardName').value=board.name;selected=null;$('inspector').hidden=true;commit();},
  afterApply:()=>$('canvas').focus({preventScroll:true})});
document.addEventListener('keydown',event=>{
  if(event.isComposing)return;
  // A modal owns its command. Native field undo remains local; an explicitly
  // reviewed operation must never save the canvas behind the active window.
  if(document.querySelector('dialog[open]')){
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s')event.preventDefault();
    return;
  }
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();performSave();}
  if((event.ctrlKey||event.metaKey)&&document.activeElement===$('noteBody')&&['b','i'].includes(event.key.toLowerCase())){event.preventDefault();format(event.key.toLowerCase()==='b'?'bold':'italic');}
  if(event.key==='Escape'&&!['paperReadingDialog','viewDialog','referenceDialog','recoveryDialog','mediaDialog','metadataDialog','foldersDialog','browserRecoveryDialog','workspaceArchiveDialog','archiveCleanupDialog','accountDialog','cellNotesDialog','mediaCueDialog','tablePasteDialog'].some(id=>$(id).open)){spatialViews.closePanel();$('closeInspector').click();$('closeOutline').click();}
});
function checkAccess(){if(board)session.checkAccess();}
window.addEventListener('focus',checkAccess);window.addEventListener('creative-account-check',checkAccess);window.addEventListener('pageshow',event=>{if(event.persisted)checkAccess();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkAccess();});
try{const channel=new BroadcastChannel('creative-account-session');channel.onmessage=event=>{if(event.data?.type==='changed')checkAccess();};}catch{}
window.addEventListener('beforeunload',event=>{if(cues.pending||tables.pending||spatialViews.pending||library.pending||editorError || session.state.dirty || (creating&&$('newBoardName').value)){event.preventDefault();event.returnValue='';}});

document.addEventListener('compositionstart',()=>{composing=true;});
document.addEventListener('compositionend',()=>{composing=false;releaseAdoption();scheduleSave();if(renderPending)renderCanonical();});
$('localState').setAttribute('role','status');$('localState').setAttribute('aria-live','polite');

function canReceiveCanonical(next){
  if(!board||creating||gesture||composing||viewRestorePending||cues.pending||tables.pending||spatialViews.pending||library.pending||document.querySelector('dialog[open]'))return false;
  const active=document.activeElement;
  if(next&&active?.matches('input,textarea,select')&&($('inspector').contains(active)||active===$('boardName'))){
    if(active===$('boardName'))return board.name===next.name;
    const nextNode=next.nodes.find(node=>node.id===selected);
    if(active.matches('[data-table-cell]')&&canReceiveTableCell(selectedNode(),nextNode,active.dataset.rowKey,active.dataset.columnKey,active.value))return true;
    return valueEqual(selectedNode(),nextNode);
  }
  return true;
}
async function waitForAdoption(){while(gesture||composing)await new Promise(resolve=>adoptionWaiters.add(resolve));}
function releaseAdoption(){if(gesture||composing)return;paperReading.flush();if(readingLayoutPending)refreshReadingLayout();for(const resolve of adoptionWaiters)requestAnimationFrame(()=>requestAnimationFrame(resolve));adoptionWaiters.clear();}
function adoptCanonical(raw){
  const next=validateLiveBoard(JSON.parse(raw));
  if(!board)return false;
  // Keep objects used by a captured pointer gesture; draw only after it ends.
  const existing=new Map(board.nodes.map(node=>[node.id,node]));
  next.nodes=next.nodes.map(node=>{
    const current=existing.get(node.id);if(!current||current.type!==node.type)return node;
    for(const key of Object.keys(current))if(!Object.hasOwn(node,key))delete current[key];
    for(const [key,value]of Object.entries(node))Object.defineProperty(current,key,{value,writable:true,configurable:true,enumerable:true});
    return current;
  });
  for(const key of Object.keys(board))if(!Object.hasOwn(next,key))delete board[key];
  for(const [key,value]of Object.entries(next))Object.defineProperty(board,key,{value,writable:true,configurable:true,enumerable:true});
  ownHistory.boundary();inputGroup=null;renderPending=true;
  queueMicrotask(()=>{if(!gesture&&!composing)renderCanonical();});return true;
}
function renderCanonical(){
  if(!renderPending||gesture||composing||!board)return;renderPending=false;
  const focus=document.activeElement,field=focus?.id,range=focus?.matches('input[type="text"],input:not([type]),textarea')?[focus.selectionStart,focus.selectionEnd,focus.selectionDirection,focus.scrollTop]:null;
  const focusValue=focus?.value,tablePlace=tables.capture();
  const selectedId=selected,hidden=$('inspector').hidden,scroll=$('inspector').scrollTop;
  const focusedNode=focus?.closest('[data-node]')?.dataset.node;
  const inspectorValues=[...$('inspector').querySelectorAll('input,textarea,select')].map(input=>[input.id,input.value]);
  const node=selectedNode();
  drawCanvas();$('boardName').value=board.name;
  // Updating an unrelated note keeps the original field and range in place.
  if(node&&!hidden){selectNode(selectedId,true);for(const[id,value]of inspectorValues){const input=$(id);if(input&&input.value===value&&field===id&&range){input.setSelectionRange(range[0],range[1],range[2]);input.scrollTop=range[3];}}$('inspector').scrollTop=scroll;}
  else if(!node){selected=null;$('inspector').hidden=true;}
  if(selectedNode()?.type==='table')tables.restore(tablePlace,!hidden);
  if(field&&$(field)?.value===focusValue&&range){$(field).setSelectionRange(range[0],range[1],range[2]);$(field).scrollTop=range[3];}
  if(field&&$(field)&&!$(field).closest('[hidden]'))$(field).focus({preventScroll:true});
  else if(focusedNode){$('cards').querySelector(`[data-node="${CSS.escape(focusedNode)}"]`)?.focus({preventScroll:true});}
  refreshState();
}
async function receiveOthers(){
  try{if(!document.hidden&&board&&!creating&&!editorError)await session.syncRemote();}
  finally{setTimeout(receiveOthers,2500);}
}
setTimeout(receiveOthers,2500);

async function start() {
  const transport=new BoardTransport(scope);
  refreshPageTitle();
  try{
    await transport.assertIdentity();const workspace=await transport.workspace();workspaceName=workspace.name;$('spaceName').textContent=workspaceName;refreshPageTitle();
    if(creating){
      $('createPanel').hidden=false;
      if(workspace.role==='viewer'){$('createBoardButton').disabled=true;$('createError').textContent='这个工作区只有阅读权限，无法创建白板。';}
      else $('newBoardName').focus();
    }else{
      await session.open();board=JSON.parse(session.state.raw);$('boardName').value=board.name;
      const source=board.view||{};view={x:finite(source.x,48),y:finite(source.y,55),z:clamp(finite(source.z,1),.03,3)};
      drawCanvas();refreshState();
    }
  }catch(error){$('saveState').textContent=error.message;$('createError').textContent=error.message;}
}
$('createBoardForm').onsubmit=async event=>{
  event.preventDefault();if($('createBoardButton').disabled)return;
  $('createBoardButton').disabled=true;$('newBoardName').readOnly=true;$('createError').textContent='正在创建…';
  try{
    if(session.state.status==='idle'){
      const value={format:'creative-board',version:1,name:$('newBoardName').value,nodes:[],edges:[],folder:'',view:{x:48,y:55,z:1}};
      await session.open(JSON.stringify(value,null,2));board=value;$('boardName').value=board.name;drawCanvas();
    }
    const result=await session.save();if(result.saved){creating=false;$('createPanel').hidden=true;history.replaceState(null,'',destination);refreshState();}
  }catch(error){$('createError').textContent=error.message+' 原输入仍保留，可导出并在新页面检查。';$('createBoardButton').disabled=!['ready','offline'].includes(session.state.status);}
};
start();
