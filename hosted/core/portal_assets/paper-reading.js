// Local reading preferences never become authored document fields or API requests.
export const PAPER_FONTS=Object.freeze({
  original:{name:'原有搭配'},
  clear:{name:'清晰',family:'system-ui,"Segoe UI","Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif'},
  book:{name:'书页',family:'Georgia,"Noto Serif CJK SC","Songti SC",SimSun,serif'},
  mono:{name:'等宽',family:'ui-monospace,Consolas,"Noto Sans Mono CJK SC","Sarasa Mono SC","Microsoft YaHei",monospace'}
});
export const normalizePaperFont=value=>typeof value==='string'&&Object.hasOwn(PAPER_FONTS,value)?value:'original';
export function paperReadingKey(scope){
  return Number.isSafeInteger(scope?.account)&&scope.account>0&&typeof scope.workspace==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(scope.workspace)?'creative-paper-reading-v1:'+scope.account+':'+scope.workspace.toLowerCase():null;
}
export const normalizePaperReading=value=>({font:normalizePaperFont(value?.font),overview:value?.overview==='paper'?'paper':'smart'});
export const READING_PRESETS=Object.freeze([
  Object.freeze({id:'default',name:'默认阅读',font:'original',overview:'smart'}),
  Object.freeze({id:'clear-space',name:'清晰空间',font:'clear',overview:'smart'}),
  Object.freeze({id:'quiet-paper',name:'书页沉浸',font:'book',overview:'paper'}),
  Object.freeze({id:'mono-space',name:'等宽整理',font:'mono',overview:'smart'})
]);
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const styleName=value=>{
  if(typeof value!=='string'||!value.trim()||[...value.trim()].length>40||/[\p{Cc}\p{Cs}]/u.test(value))throw Error('名字须为1至40个字符，不含换行或控制字符。');
  return value.trim();
};
const sameReading=(a,b)=>a.font===b.font&&a.overview===b.overview;
const checkedReadingStyles=value=>{
      if(!value||value.version!==1||Object.keys(value).length!==2||!Array.isArray(value.styles)||value.styles.length>12)throw Error();
      const ids=new Set(),names=new Set();return value.styles.map(row=>{
        if(!row||Object.keys(row).length!==5||typeof row.id!=='string'||!UUID.test(row.id)||typeof row.revision!=='string'||!UUID.test(row.revision)||ids.has(row.id)||
           styleName(row.name)!==row.name||names.has(row.name)||normalizePaperFont(row.font)!==row.font||!['paper','smart'].includes(row.overview))throw Error();
        ids.add(row.id);names.add(row.name);return Object.freeze({id:row.id,revision:row.revision,name:row.name,font:row.font,overview:row.overview});
      });
};
// A separate, bounded catalog leaves the original reading-preference key and
// authored documents intact. All our tab writers share one browser lock.
export class ReadingStyles{
  constructor(scope,{storage=()=>globalThis.localStorage,locks=globalThis.navigator?.locks,uuid=()=>globalThis.crypto.randomUUID()}={}){
    const key=paperReadingKey(scope);this.key=key?key+':styles':null;this.storage=storage;this.locks=locks;this.uuid=uuid;
  }
  read(){
    if(!this.key)throw Error('当前阅读范围无法确认，已有搭配未改动。');
    let raw;try{raw=this.storage().getItem(this.key);}catch{throw Error('浏览器无法读取已存搭配，原有记录未改动。');}
    if(raw===null)return [];
    try{
      if(typeof raw!=='string'||raw.length>32768)throw Error();return checkedReadingStyles(JSON.parse(raw));
    }catch{throw Error('已存搭配暂时无法核对，原有记录保持不变。');}
  }
  async change(operation,canCommit=()=>true){
    operation=Object.freeze({...operation,profile:operation.profile?Object.freeze({...operation.profile}):null});
    if(!this.key||!this.locks?.request)throw Error('这个浏览器暂不支持安全保存搭配；当前阅读仍可调整。');
    return this.locks.request(this.key,()=>{
      const rows=this.read(),next=[...rows];
      if(!canCommit())throw Error('页面已关闭或暂停，没有改动已存搭配；名字仍在本页。');
      let profile,removed;
      if(operation.kind==='save'){
        if(normalizePaperFont(operation.font)!==operation.font||!['paper','smart'].includes(operation.overview))throw Error('无法确认字体与空间阅读方式。');
        const name=styleName(operation.name),prefs=normalizePaperReading(operation);
        const index=operation.id?rows.findIndex(row=>row.id===operation.id):-1;
        if(operation.id&&(index<0||rows[index].revision!==operation.revision))throw Error('这份搭配已在其他页面改变，请重新选择后再更新；填写的名字仍保留。');
        if(rows.some(row=>row.name===name&&row.id!==operation.id))throw Error('已有同名搭配，请换个名字或明确选择那份搭配再更新。');
        if(index<0&&rows.length>=12)throw Error('最多保存12份搭配；可先移除不再使用的搭配。');
        if(index>=0&&rows[index].name===name&&sameReading(rows[index],prefs))return {profile:rows[index],styles:rows};
        profile=Object.freeze({id:index>=0?rows[index].id:this.uuid(),revision:this.uuid(),name,...prefs});
        if(index>=0)next[index]=profile;else next.push(profile);
      }else if(operation.kind==='remove'){
        const index=rows.findIndex(row=>row.id===operation.id);
        if(index<0||rows[index].revision!==operation.revision)throw Error('这份搭配已在其他页面改变，请重新选择后再移除。');
        removed=rows[index];next.splice(index,1);
      }else if(operation.kind==='restore'){
        const old=operation.profile;
        if(!old||rows.some(row=>row.id===old.id||row.name===old.name))throw Error('原位置或名字已被使用，没有覆盖任何搭配。');
        if(rows.length>=12)throw Error('已存满12份搭配，请先腾出位置再撤销移除。');
        // Reuse the validated removed value, but give its new version a fresh basis.
        const checked=checkedReadingStyles({version:1,styles:[old]})[0];
        profile=Object.freeze({...checked,revision:this.uuid()});next.push(profile);
      }else throw Error('无法确认这项搭配操作。');
      const encoded=JSON.stringify({version:1,styles:next});
      try{this.storage().setItem(this.key,encoded);if(this.storage().getItem(this.key)!==encoded)throw Error();}
      catch{throw Error('浏览器未确认保存搭配；请保留这页名字，重新打开后核对，当前阅读仍可用。');}
      return {profile,removed,styles:next};
    });
  }
}
export class PaperReading{
  constructor({scope,canRead,canApply,onApply,capture,restore,afterClose}){
    this.key=paperReadingKey(scope);this.canRead=canRead;this.canApply=canApply;this.onApply=onApply;this.capture=capture;this.restore=restore;this.afterClose=afterClose;this.styles=new ReadingStyles(scope);this.savedStyles=[];this.styleTarget=null;this.styleBusy=false;this.removedStyle=null;
    const button=document.getElementById('showPaperReading'),dialog=document.createElement('dialog');dialog.id='paperReadingDialog';dialog.className='paper-reading-dialog';this.dialog=dialog;this.button=button;
    dialog.innerHTML='<form method="dialog" class="reading-heading"><h2>纸面阅读</h2><button aria-label="关闭纸面阅读">×</button></form><p>选择你读起来舒服的搭配。仅保存在当前浏览器、当前账号与工作区，其他人的阅读方式保持原样。</p><label class="reading-start">从一套搭配开始<select id="readingStyleChoice" aria-describedby="readingStyleState"></select></label><p id="readingStyleState" class="reading-scope"></p><div class="reading-presets" role="group" aria-label="调整纸面字体"></div><p class="reading-scope">标题、正文、补充与备注一起切换；代码和操作控件保持原样。原文、字号、位置和手动尺寸保留；自动纸面按新的换行显示高度。字体来自当前设备。</p><label class="distance-reading-choice"><input id="distanceReadingChoice" type="checkbox">缩远时显示便签与表格名称<small>自动切换名称视图；点击或按 Enter 回到原内容。取消后保持原纸面。</small></label><details class="reading-personal"><summary>命名保存自己的搭配</summary><p id="readingStyleTarget" class="reading-scope"></p><label>搭配名字<input id="readingStyleName" maxlength="80" autocomplete="off" placeholder="例如：我的长文阅读"></label><p id="readingStyleMessage" class="reading-scope reading-style-message" role="status" aria-live="polite"></p><div class="reading-style-actions"><button type="button" id="saveReadingStyle">保存新搭配</button><button type="button" id="updateReadingStyle" hidden>更新所选搭配</button><button type="button" id="removeReadingStyle" class="quiet" hidden>移除所选搭配</button><button type="button" id="undoReadingStyle" hidden>撤销移除</button></div><p class="reading-scope">最多12份，只记在当前浏览器的原账号与工作区；移除搭配不会改变当前阅读。</p></details><p class="reading-message" role="status" aria-live="polite"></p><footer><button type="button" id="paperReadingDefault">恢复默认阅读</button><button type="button" id="paperReadingRevert">还原本次调整</button><button type="button" id="paperReadingDone">完成</button></footer>';
    button.setAttribute('aria-label','纸面阅读');button.title='纸面阅读 · 仅当前浏览器';document.body.append(dialog);
    for(const [id,row] of Object.entries(PAPER_FONTS)){
      const choice=document.createElement('button');choice.type='button';choice.dataset.readingFont=id;choice.setAttribute('aria-label','纸面字体：'+row.name);
      const label=document.createElement('strong'),sample=document.createElement('span');label.textContent=row.name;sample.textContent='中文 English 0123';if(row.family)sample.style.fontFamily=row.family;choice.append(label,sample);
      choice.onclick=()=>this.choose({...this.preferences,font:id});dialog.querySelector('.reading-presets').append(choice);
    }
    // Dialog keyboard commands must never save, undo or dismiss the note behind it.
    dialog.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&['s','z','y'].includes(event.key.toLowerCase())&&!(event.key.toLowerCase()!=='s'&&event.target?.matches('input[type="text"],input:not([type]),textarea')))event.preventDefault();event.stopPropagation();});
    button.addEventListener('pointerdown',()=>{this.place=this.capture();});
    button.addEventListener('focus',event=>{if(event.relatedTarget?.matches('#noteTitle,#noteBody,#noteUserText,#noteAnnotation'))this.place=this.capture(event.relatedTarget);});
    button.onclick=()=>this.open();
    dialog.querySelector('#paperReadingDefault').onclick=()=>this.choose({font:'original',overview:'smart'});
    dialog.querySelector('#distanceReadingChoice').onchange=()=>this.choose({...this.preferences,overview:dialog.querySelector('#distanceReadingChoice').checked?'smart':'paper'});
    dialog.querySelector('#paperReadingRevert').onclick=()=>this.choose(this.opening);
    dialog.querySelector('#paperReadingDone').onclick=()=>dialog.close();
    dialog.querySelector('#readingStyleName').addEventListener('input',()=>{if(!this.styleBusy)dialog.querySelector('#readingStyleMessage').textContent='';});
    dialog.querySelector('#readingStyleName').addEventListener('focus',()=>dialog.querySelector('#readingStyleName').scrollIntoView({block:'nearest'}));
    dialog.querySelector('#readingStyleName').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();this.changeStyle('save');}});
    dialog.querySelector('#readingStyleChoice').onchange=()=>this.useStyle(dialog.querySelector('#readingStyleChoice').value);
    for(const [id,kind] of [['saveReadingStyle','save'],['updateReadingStyle','update'],['removeReadingStyle','remove'],['undoReadingStyle','restore']])dialog.querySelector('#'+id).onclick=()=>this.changeStyle(kind);
    dialog.addEventListener('close',()=>{const place=this.place;this.place=null;if(this.canRead())this.restore(place);this.afterClose?.();});
    window.addEventListener('storage',event=>{if(event.key===this.key||event.key===null){this.apply(this.read());if(dialog.open)this.refresh();}if(event.key===this.styles.key||event.key===null){this.loadStyles();if(dialog.open)this.refresh();}});
    this.loadStyles();this.apply(this.read());this.sync();
  }
  read(){if(!this.key)return normalizePaperReading(null);try{return normalizePaperReading(JSON.parse(localStorage.getItem(this.key)||'null'));}catch{return normalizePaperReading(null);}}
  apply(value){this.preferences=normalizePaperReading(value);this.value=this.preferences.font;if(this.canApply&&!this.canApply()){this.pending=true;return;}this.pending=false;document.documentElement.dataset.paperReading=this.value;document.documentElement.dataset.spaceReading=this.preferences.overview;const family=PAPER_FONTS[this.value].family;if(family)document.documentElement.style.setProperty('--paper-reading-family',family);else document.documentElement.style.removeProperty('--paper-reading-family');this.onApply?.();}
  flush(){if(this.pending)this.apply(this.preferences);}
  refresh(){this.refreshStyles();this.dialog.querySelector('#distanceReadingChoice').checked=this.preferences.overview==='smart';for(const button of this.dialog.querySelectorAll('[data-reading-font]'))button.setAttribute('aria-pressed',String(button.dataset.readingFont===this.value));}
  open(){if(!this.key||!this.canRead())return;this.opening=this.read();this.loadStyles();this.apply(this.opening);this.dialog.querySelector('.reading-message').textContent='';this.refresh();this.dialog.showModal();}
  choose(value){if(!this.dialog.open||!this.key||!this.canRead())return;if(!this.styleBusy)this.dialog.querySelector('#readingStyleMessage').textContent='';this.apply(value);this.refresh();try{localStorage.setItem(this.key,JSON.stringify(this.preferences));this.dialog.querySelector('.reading-message').textContent='';}catch{this.dialog.querySelector('.reading-message').textContent='浏览器未保存这次选择；本页预览仍可用，重开会使用先前搭配。';}}
  loadStyles(){try{this.savedStyles=this.styles.read();this.styleError='';}catch(error){this.savedStyles=[];this.styleError=error.message;}}
  refreshStyles(){
    const $=id=>this.dialog.querySelector('#'+id),select=$('readingStyleChoice');select.replaceChildren(new Option('当前自定搭配',''));
    const ready=document.createElement('optgroup');ready.label='现成搭配';for(const row of READING_PRESETS)ready.append(new Option(row.name,row.id));select.append(ready);
    if(this.savedStyles.length){const mine=document.createElement('optgroup');mine.label='我保存的搭配';for(const row of this.savedStyles)mine.append(new Option(row.name,row.id));select.append(mine);}
    const target=this.styleTarget,listed=target&&this.savedStyles.find(row=>row.id===target.id),current=listed?.revision===target?.revision;
    const preset=READING_PRESETS.find(row=>row.id===this.selectedStyle),named=this.savedStyles.find(row=>row.id===this.selectedStyle),selected=named||preset||(!target&&READING_PRESETS.find(row=>sameReading(row,this.preferences)));
    select.value=selected&&sameReading(selected,this.preferences)?selected.id:'';select.disabled=this.styleBusy;
    $('readingStyleState').textContent=this.styleError||(!selected||!sameReading(selected,this.preferences)?'当前已调整，可命名保存自己的搭配。':named?'正在使用你保存的搭配 · '+named.name:'现成搭配也可以继续调整。');
    $('readingStyleTarget').textContent=target?'所选搭配：'+target.name+(current?'':' · 已在其他页面改变；原名字仍保留，请重新选择再更新。'):'将当前字体与缩远阅读方式保存为自己的搭配。';
    for(const id of ['updateReadingStyle','removeReadingStyle']){$(id).hidden=!target;$(id).disabled=this.styleBusy||!current||Boolean(this.styleError)||!this.styles.locks?.request;}
    $('saveReadingStyle').disabled=this.styleBusy||Boolean(this.styleError)||!this.styles.locks?.request;
    $('undoReadingStyle').hidden=!this.removedStyle;$('undoReadingStyle').disabled=this.styleBusy||Boolean(this.styleError)||!this.styles.locks?.request;
    if(!this.styles.locks?.request&&!this.styleError)$('readingStyleState').textContent='这个浏览器暂不支持安全保存搭配；现成搭配和当前阅读仍可使用。';
  }
  useStyle(id){
    if(!this.dialog.open||!this.canRead()||this.styleBusy)return;
    this.loadStyles();const row=READING_PRESETS.find(row=>row.id===id)||this.savedStyles.find(row=>row.id===id);
    if(!row){this.refresh();return;}
    this.selectedStyle=id;this.styleTarget=UUID.test(id)?row:null;
    const name=this.dialog.querySelector('#readingStyleName');if(!name.value.trim()||name.value===this.lastSuggestedName){name.value=this.styleTarget?.name||'';this.lastSuggestedName=name.value;}
    this.choose(row);
  }
  async changeStyle(kind){
    if(!this.dialog.open||!this.canRead()||this.styleBusy)return;
    const name=this.dialog.querySelector('#readingStyleName').value,target=this.styleTarget;
    if(['update','remove'].includes(kind)&&!target||kind==='restore'&&!this.removedStyle)return;
    const operation=kind==='remove'?{kind,id:target.id,revision:target.revision}:kind==='restore'?{kind,profile:this.removedStyle}:{kind:'save',name,...this.preferences,...(kind==='update'?{id:target.id,revision:target.revision}:{})};
    this.styleBusy=true;this.dialog.querySelector('#readingStyleMessage').textContent='正在核对这份搭配…';this.refresh();
    try{
      const result=await this.styles.change(operation,()=>this.dialog.open&&this.canRead());
      if(result.removed){this.removedStyle=result.removed;this.styleTarget=null;this.selectedStyle=null;}
      else{if(kind==='restore')this.removedStyle=null;this.styleTarget=result.profile;this.selectedStyle=sameReading(result.profile,this.preferences)?result.profile.id:null;}
      this.loadStyles();this.dialog.querySelector('#readingStyleMessage').textContent=result.removed?'搭配已移除，当前阅读保持原样；可以撤销移除。':kind==='restore'?'搭配已恢复；当前阅读保持原样。':this.dialog.querySelector('#readingStyleName').value!==name||!sameReading(operation,this.preferences)?'已保存「'+result.profile.name+'」；后来调整仍在本页，尚未更新这份搭配。':'搭配已保存在这个浏览器的原账号与工作区。';
    }catch(error){this.loadStyles();this.dialog.querySelector('#readingStyleMessage').textContent=error.message;}
    finally{this.styleBusy=false;this.refresh();if(this.dialog.open&&document.activeElement!==this.dialog.querySelector('#readingStyleName'))this.dialog.querySelector('#readingStyleMessage').scrollIntoView({block:'nearest'});}
  }
  sync(){this.button.disabled=!this.key||!this.canRead();if(this.button.disabled&&this.dialog.open){this.place=null;this.dialog.close();}}
}
