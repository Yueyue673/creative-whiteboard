import {mediaElement,stopMedia} from './board-media.js';
import {readableCue,captureCue,cueTime,cueMatches} from './media-cue-model.js';
const $=id=>document.getElementById(id),text=(tag,value,cls)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=value;if(cls)e.className=cls;return e;};
export class MediaCues{
  constructor(c){this.c=c;this.bindings=new Map();this.creating=null;this.epoch=0;this.context=null;this.active=false;
    $('closeMediaCue').onclick=()=>this.close();$('mediaCueDialog').addEventListener('cancel',e=>{e.preventDefault();this.close();});$('mediaCueDialog').addEventListener('close',()=>{if(!$('mediaCueDialog').open&&this.active)this.finishClose();});
    $('openNoteCue').onclick=()=>this.open(this.c.active());$('removeNoteCue').onclick=()=>this.remove();
  }
  get pending(){return Boolean(this.creating);}
  attach(player,asset,sourceId,root){
    if(!['audio','video'].includes(asset.kind))return;
    const button=text('button','在此刻留便签','capture-media-cue'),state=text('p','','media-cue-state');button.dataset.captureCue=sourceId;button.disabled=true;state.hidden=true;state.setAttribute('role','status');root.append(state);
    const card=root.closest('.media-card'),title=card.querySelector('.card-title'),heading=text('div',undefined,'media-cue-title');title.replaceWith(heading);heading.append(title,button);card.classList.add('media-time-card');
    const binding={player,asset,sourceId,button,state,title,heading,card};this.bindings.set(player,binding);
    const update=()=>this.controls(binding);binding.update=update;for(const name of ['loadedmetadata','durationchange','timeupdate','seeking','seeked','error','emptied'])player.addEventListener(name,update);
    button.onclick=()=>this.capture(binding);update();
  }
  detach(player){
    const b=this.bindings.get(player);if(!b)return;this.bindings.delete(player);
    b.button.disabled=true;b.button.onclick=null;
    for(const name of ['loadedmetadata','durationchange','timeupdate','seeking','seeked','error','emptied'])player.removeEventListener(name,b.update);
    b.state.remove();b.button.remove();
    if(b.title.parentElement===b.heading)b.heading.replaceWith(b.title);
    b.card.classList.remove('media-time-card');
  }
  controls(b){const source=this.c.node(b.sourceId);let ready=false;try{captureCue(b.asset,b.player.currentTime,b.player.duration);ready=b.player.readyState>=1&&!b.player.error;}catch{}
    b.button.disabled=!ready||!this.c.canCreate()||Boolean(this.creating)||source?.type!=='image'||source.assetId!==b.asset.id;
    b.button.replaceChildren(text('span',this.creating===b?'正在核对…':'留便签'));if(ready)b.button.append(text('small',cueTime(b.player.currentTime)));b.button.title='在当前位置留一张由你填写的便签';
  }
  sync(){
    for(const [player,b] of this.bindings){if(!player.isConnected){this.detach(player);continue;}this.controls(b);}
    const node=this.c.active(),cue=node?.mediaCue,exists=node&&Object.prototype.hasOwnProperty.call(node,'mediaCue');$('noteCueContext').hidden=!exists;
    const valid=readableCue(cue);$('noteCueSource').textContent=valid?cue.sourceTitle+' · '+cueTime(cue.time):'原时间关联暂无法核对；原文仍保留。';$('openNoteCue').hidden=$('removeNoteCue').hidden=!valid;
    $('openNoteCue').disabled=!this.c.canRead();$('removeNoteCue').disabled=!this.c.canEdit();
    for(const b of this.c.cards().querySelectorAll('[data-media-cue]'))b.disabled=!this.c.canRead();
    if(this.context&&!this.c.canRead()){this.epoch++;stopMedia($('mediaCuePlayer'));$('mediaCuePlayer').replaceChildren();$('mediaCueDownload').hidden=true;$('mediaCueDownload').removeAttribute('href');$('mediaCueState').textContent='原账号的素材访问已暂停，便签原文仍保留。';}
  }
  async capture(b){
    if(b.button.disabled||this.creating)return;
    let cue;try{cue=captureCue(b.asset,b.player.currentTime,b.player.duration);}catch(e){b.state.hidden=false;b.state.textContent=e.message;return;}
    const source=this.c.node(b.sourceId);this.creating=b;this.sync();b.state.hidden=false;b.state.textContent='正在核对原素材与编辑权限…';
    try{await this.c.api.access(true);const asset=await this.c.api.read(cue.assetId);await this.c.api.access(true);
      if(!this.c.canCreate()||this.c.node(b.sourceId)!==source||source?.assetId!==cue.assetId||!b.player.isConnected)throw Error('原内容或编辑权限已改变；这一刻尚未添加到白板。');
      if(!cueMatches(cue,asset))throw Error('原文件无法核对；没有把这一刻关联到其他文件。');
      this.c.create(cue,source);b.state.textContent='这一刻已放在空白便签里，内容由你填写。';
    }catch(e){b.state.textContent=e.message;}finally{if(this.creating===b)this.creating=null;this.sync();}
  }
  badge(node){if(!readableCue(node.mediaCue))return null;const b=text('button','回到原片段 · '+cueTime(node.mediaCue.time),'media-cue-link');b.dataset.mediaCue=node.id;b.disabled=!this.c.canRead();b.onclick=e=>{e.stopPropagation();this.open(node);};return b;}
  async open(node){
    if(!this.c.canRead()||!node||this.c.node(node.id)!==node||!readableCue(node.mediaCue))return;
    const dialog=$('mediaCueDialog');if(dialog.open)this.close();const epoch=++this.epoch,cue=Object.freeze({...node.mediaCue}),raw=JSON.stringify(node.mediaCue);
    this.context={node,raw,cue,place:this.c.capturePlace()};this.active=true;dialog.showModal();
    $('mediaCueSource').textContent=cue.sourceTitle;$('mediaCueTime').textContent=cueTime(cue.time);$('mediaCueNote').textContent=node.body||node.title||'';$('mediaCuePlayer').replaceChildren();$('mediaCueDownload').hidden=true;$('mediaCueState').textContent='正在核对原素材…';
    for(const item of document.querySelectorAll('audio,video'))item.pause();
    const current=()=>epoch===this.epoch&&dialog.open&&this.c.canRead()&&this.c.node(node.id)===node&&JSON.stringify(node.mediaCue)===raw;
    try{await this.c.api.access();const asset=await this.c.api.read(cue.assetId);await this.c.api.access();if(!current())return;
      if(!cueMatches(cue,asset))throw Error('原文件无法核对；便签和时间关联仍保留，没有打开其他文件。');
      const player=mediaElement(asset);player.autoplay=false;
      player.addEventListener('loadedmetadata',()=>{if(!current())return;if(!Number.isFinite(player.duration)||cue.time>player.duration){$('mediaCueState').textContent='这一刻超出当前媒体可定位的范围；关联原文仍保留。';return;}player.pause();player.currentTime=cue.time;if(cue.time===0)$('mediaCueState').textContent='已位于开头；播放由你决定。';});
      player.addEventListener('seeked',()=>{if(current())$('mediaCueState').textContent=Math.abs(player.currentTime-cue.time)<.3?'已定位到这一刻；播放由你决定。':'浏览器返回了相近位置，原时间记录保持不变。';});
      player.addEventListener('error',()=>{if(current())$('mediaCueState').textContent='浏览器暂时无法播放，仍可下载原文件；关联原文保持不变。';});
      $('mediaCuePlayer').append(player);$('mediaCueDownload').hidden=false;$('mediaCueDownload').href=asset.mediaURL;$('mediaCueDownload').download=asset.filename;
      $('mediaCueDownload').onclick=async e=>{e.preventDefault();try{await this.c.api.access();if(!current())return;const link=text('a');link.href=this.c.api.url(cue.assetId);link.download=asset.filename;document.body.append(link);link.click();link.remove();}catch(error){if(current())$('mediaCueState').textContent=error.message;}};
      $('mediaCueState').textContent='正在读取这一刻，随后可用播放控件试听。';
    }catch(e){if(current())$('mediaCueState').textContent=e.message;}
  }
  finishClose(){this.active=false;this.epoch++;stopMedia($('mediaCuePlayer'));$('mediaCuePlayer').replaceChildren();$('mediaCueDownload').hidden=true;$('mediaCueDownload').removeAttribute('href');const place=this.context?.place;this.context=null;if(place)this.c.restorePlace(place);}
  close(){if(!$('mediaCueDialog').open)return;this.active=false;$('mediaCueDialog').close();this.finishClose();}
  remove(){const node=this.c.active();if(!node||!this.c.canEdit()||!readableCue(node.mediaCue))return;const raw=JSON.stringify(node.mediaCue);if(confirm('解除这张便签的时间关联？文字与原文件保留，可以撤销。')&&this.c.active()===node&&this.c.canEdit()&&JSON.stringify(node.mediaCue)===raw)this.c.remove(node);}
}
