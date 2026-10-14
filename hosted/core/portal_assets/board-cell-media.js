import {mediaTarget,checkMediaTarget} from './cell-media-model.js';
import {mediaElement,stopMedia,bytesLabel} from './board-media.js';
const $=id=>document.getElementById(id);
const el=(tag,text)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;return item;};

export class CellMedia{
  constructor(c){this.c=c;this.review=null;this.epoch=0;this.asset=null;
    $('cellMediaBack').onclick=()=>this.back();$('retryCellMedia').onclick=()=>this.load();
    for(const id of ['cellMediaBack','retryCellMedia','downloadCellMedia'])$(id).addEventListener('focus',()=>{if(!$('cellMediaPane').hidden)$(id).scrollIntoView({block:'nearest'});});
    $('downloadCellMedia').onclick=event=>{event.preventDefault();this.download();};
  }
  current(){try{return Boolean(this.review&&this.c.node()===this.review.ref&&checkMediaTarget(this.c.node(),this.review.target));}catch{return false;}}
  allowed(){return Boolean($('cellNotesDialog').open&&this.current()&&this.c.canReadMedia());}
  clear(){stopMedia($('cellMediaPreview'));$('cellMediaPreview').replaceChildren();$('cellMediaDetails').textContent='';$('downloadCellMedia').hidden=true;$('downloadCellMedia').removeAttribute('href');this.asset=null;}
  close(){++this.epoch;this.clear();this.review=null;$('cellMediaPane').hidden=true;delete $('cellNotesDialog').dataset.cellMedia;}
  back(){const reviewed=this.review;this.close();this.c.back();if(!$('cellNotesDialog').open)return;
    let choice;
    try{if(reviewed&&this.c.node()===reviewed.ref){checkMediaTarget(this.c.node(),reviewed.target);
      choice=[...$('cellNotesList').querySelectorAll('[data-cell-media-index]')].find(item=>!item.disabled&&item.dataset.cellMediaCollection===reviewed.target.collection&&Number(item.dataset.cellMediaIndex)===reviewed.target.index);}}
    catch{} // A changed original target never lends focus to a replacement item.
    const target=choice||$('closeCellNotes');target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});
  }
  open(row,column,collection,index){const node=this.c.node();if(!node||!this.c.canBrowse())return;
    try{const target=mediaTarget(node,row,column,collection,index);this.close();this.review={ref:node,target};
      const original=JSON.parse(target.original);$('cellMediaTitle').textContent=typeof original.title==='string'?original.title:typeof original.name==='string'?original.name:'单元格素材';
      $('cellMediaContext').textContent=`第${target.rowIndex+1}行 · 第${target.columnIndex+1}列 · ${collection==='cellImages'?'附加图片':'嵌入内容'} ${index+1}`;
      $('cellNotesListPane').hidden=true;$('cellNoteEditor').hidden=true;$('cellMediaPane').hidden=false;$('cellNotesDialog').dataset.cellMedia='true';$('cellNotesDialog').scrollTop=0;$('cellMediaBack').focus({preventScroll:true});this.load();
    }catch(error){this.c.message(error.message);}
  }
  async load(){if(!this.review)return;const reviewed=this.review,epoch=++this.epoch;this.clear();$('retryCellMedia').disabled=true;
    if(!this.allowed()){$('cellMediaState').textContent='原账号、素材位置或访问状态未能核对；返回原单元格重新检查。';return;}
    $('cellMediaState').textContent='正在核对原工作区的这份素材…';
    try{const api=this.c.mediaAPI();await api.access();if(epoch!==this.epoch||this.review!==reviewed||!this.allowed())return;
      const asset=await api.read(reviewed.target.assetId);if(epoch!==this.epoch||this.review!==reviewed||!this.allowed())return;await api.access();
      if(epoch!==this.epoch||!this.allowed())return;
      this.asset=asset;const item=mediaElement(asset);
      if(item){item.onerror=()=>{if(epoch===this.epoch&&this.allowed())$('cellMediaState').textContent='浏览器无法显示或播放这份文件，仍可下载原文件。';};
        if(['AUDIO','VIDEO'].includes(item.tagName))item.addEventListener('focus',()=>{if(epoch===this.epoch&&this.allowed())item.scrollIntoView({block:'nearest'});});$('cellMediaPreview').append(item);}
      else $('cellMediaPreview').append(el('p','这份文件仅提供下载，不在白板内执行。'));
      $('cellMediaDetails').textContent=(asset.title||asset.filename)+' · '+asset.mime+' · '+bytesLabel(asset.size);
      $('downloadCellMedia').href=asset.mediaURL;$('downloadCellMedia').download=asset.filename;$('downloadCellMedia').hidden=false;
      $('cellMediaState').textContent=item?'已核对原素材。查看和播放不改变单元格，也不自动播放。':'已核对原文件，可直接下载。';
    }catch(error){if(epoch===this.epoch&&this.review){this.clear();$('cellMediaState').textContent=error.message||'暂时未能打开原素材。';}}
    finally{if(epoch===this.epoch)$('retryCellMedia').disabled=!this.allowed();}
  }
  sync(){if(!this.review)return;if(!this.allowed()){++this.epoch;this.clear();$('retryCellMedia').disabled=true;$('cellMediaState').textContent='原单元格或访问状态已改变，媒体已停止；请返回重新选择。';}}
  async download(){if(!this.asset||!this.allowed())return;const epoch=this.epoch,asset=this.asset;
    try{await this.c.mediaAPI().access();if(epoch!==this.epoch||!this.allowed()||this.asset!==asset)return;
      const link=el('a');link.href=asset.mediaURL;link.download=asset.filename;document.body.append(link);link.click();link.remove();
    }catch(error){if(epoch===this.epoch){this.clear();$('cellMediaState').textContent=error.message||'原账号访问未确认，未发起下载。';}}
  }
}
