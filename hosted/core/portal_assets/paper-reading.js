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
export class PaperReading{
  constructor({scope,canRead,canApply,onApply,capture,restore,afterClose}){
    this.key=paperReadingKey(scope);this.canRead=canRead;this.canApply=canApply;this.onApply=onApply;this.capture=capture;this.restore=restore;this.afterClose=afterClose;
    const button=document.getElementById('showPaperReading'),dialog=document.createElement('dialog');dialog.id='paperReadingDialog';dialog.className='paper-reading-dialog';this.dialog=dialog;this.button=button;
    dialog.innerHTML='<form method="dialog" class="reading-heading"><h2>纸面阅读</h2><button aria-label="关闭纸面阅读">×</button></form><p>选择你读起来舒服的搭配。仅保存在当前浏览器、当前账号与工作区，其他人的阅读方式保持原样。</p><div class="reading-presets" role="group" aria-label="纸面字体"></div><p class="reading-scope">标题、正文、补充与备注一起切换；代码和操作控件保持原样。原文、字号、位置和手动尺寸保留；自动纸面按新的换行显示高度。字体来自当前设备。</p><label class="distance-reading-choice"><input id="distanceReadingChoice" type="checkbox">缩远时显示便签与表格名称<small>自动切换名称视图；点击或按 Enter 回到原内容。取消后保持原纸面。</small></label><p class="reading-message" role="status" aria-live="polite"></p><footer><button type="button" id="paperReadingDefault">恢复默认阅读</button><button type="button" id="paperReadingRevert">还原本次调整</button><button type="button" id="paperReadingDone">完成</button></footer>';
    button.setAttribute('aria-label','纸面阅读');button.title='纸面阅读 · 仅当前浏览器';document.body.append(dialog);
    for(const [id,row] of Object.entries(PAPER_FONTS)){
      const choice=document.createElement('button');choice.type='button';choice.dataset.readingFont=id;choice.setAttribute('aria-label','纸面字体：'+row.name);
      const label=document.createElement('strong'),sample=document.createElement('span');label.textContent=row.name;sample.textContent='中文 English 0123';if(row.family)sample.style.fontFamily=row.family;choice.append(label,sample);
      choice.onclick=()=>this.choose({...this.preferences,font:id});dialog.querySelector('.reading-presets').append(choice);
    }
    // Dialog keyboard commands must never save, undo or dismiss the note behind it.
    dialog.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&['s','z','y'].includes(event.key.toLowerCase()))event.preventDefault();event.stopPropagation();});
    button.addEventListener('pointerdown',()=>{this.place=this.capture();});
    button.addEventListener('focus',event=>{if(event.relatedTarget?.matches('#noteTitle,#noteBody,#noteUserText,#noteAnnotation'))this.place=this.capture(event.relatedTarget);});
    button.onclick=()=>this.open();
    dialog.querySelector('#paperReadingDefault').onclick=()=>this.choose({font:'original',overview:'smart'});
    dialog.querySelector('#distanceReadingChoice').onchange=()=>this.choose({...this.preferences,overview:dialog.querySelector('#distanceReadingChoice').checked?'smart':'paper'});
    dialog.querySelector('#paperReadingRevert').onclick=()=>this.choose(this.opening);
    dialog.querySelector('#paperReadingDone').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{const place=this.place;this.place=null;if(this.canRead())this.restore(place);this.afterClose?.();});
    window.addEventListener('storage',event=>{if(event.key===this.key||event.key===null){this.apply(this.read());if(dialog.open)this.refresh();}});
    this.apply(this.read());this.sync();
  }
  read(){if(!this.key)return normalizePaperReading(null);try{return normalizePaperReading(JSON.parse(localStorage.getItem(this.key)||'null'));}catch{return normalizePaperReading(null);}}
  apply(value){this.preferences=normalizePaperReading(value);this.value=this.preferences.font;if(this.canApply&&!this.canApply()){this.pending=true;return;}this.pending=false;document.documentElement.dataset.paperReading=this.value;document.documentElement.dataset.spaceReading=this.preferences.overview;const family=PAPER_FONTS[this.value].family;if(family)document.documentElement.style.setProperty('--paper-reading-family',family);else document.documentElement.style.removeProperty('--paper-reading-family');this.onApply?.();}
  flush(){if(this.pending)this.apply(this.preferences);}
  refresh(){this.dialog.querySelector('#distanceReadingChoice').checked=this.preferences.overview==='smart';for(const button of this.dialog.querySelectorAll('[data-reading-font]'))button.setAttribute('aria-pressed',String(button.dataset.readingFont===this.value));}
  open(){if(!this.key||!this.canRead())return;this.opening=this.read();this.apply(this.opening);this.dialog.querySelector('.reading-message').textContent='';this.refresh();this.dialog.showModal();}
  choose(value){if(!this.dialog.open||!this.key||!this.canRead())return;this.apply(value);this.refresh();try{localStorage.setItem(this.key,JSON.stringify(this.preferences));this.dialog.querySelector('.reading-message').textContent='';}catch{this.dialog.querySelector('.reading-message').textContent='浏览器未保存这次选择；本页预览仍可用，重开会使用先前搭配。';}}
  sync(){this.button.disabled=!this.key||!this.canRead();if(this.button.disabled&&this.dialog.open){this.place=null;this.dialog.close();}}
}
