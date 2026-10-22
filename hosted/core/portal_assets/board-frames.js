const $=id=>document.getElementById(id);
const limit=999000;
export const frameColours=[['#8da6bc','雨蓝'],['#9fae91','苔绿'],['#b29ebc','雾紫'],['#c3aa83','麦金'],['#ba969c','玫瑰'],['#a8aaad','石墨']];
const hex=value=>typeof value==='string'&&/^#[a-f0-9]{6}$/i.test(value);
export function validRect(node){return !!node&&['x','y','w','h'].every(k=>typeof node[k]==='number'&&Number.isFinite(node[k])&&Math.abs(node[k])<=limit)&&node.w>0&&node.h>0;}
export function frameContents(frame,nodes){
  if(!validRect(frame))return [];
  return nodes.filter(n=>n.type!=='frame'&&validRect(n)&&n.x>=frame.x&&n.y>=frame.y&&n.x+n.w<=frame.x+frame.w&&n.y+n.h<=frame.y+frame.h);
}
export function surround(nodes,padding=24){
  if(![12,24,48].includes(padding))throw Error('请选择一个留白预设。');
  const content=nodes.filter(n=>n.type!=='frame');
  if(!content.length)throw Error('没有内容可以围住；当前分区保持原样。');
  if(content.some(n=>!validRect(n)))throw Error('有内容的尺寸或位置无法核对；请先检查，当前分区保持原样。');
  const x=Math.min(...content.map(n=>n.x))-padding,y=Math.min(...content.map(n=>n.y))-padding;
  const w=Math.max(...content.map(n=>n.x+n.w))+padding-x,h=Math.max(...content.map(n=>n.y+n.h))+padding-y;
  const rect={x,y,w:Math.max(80,w),h:Math.max(80,h)};
  if(!validRect(rect))throw Error('范围超出可编辑尺寸；请先缩小范围，当前内容保持原样。');
  return rect;
}
export function framePatch(node,patch){
  if(node?.type!=='frame'||!patch||Object.keys(patch).some(k=>!['title','body','color','x','y','w','h'].includes(k)))throw Error('这次操作只适用于分区。');
  const next={...node,...patch};
  if(('title' in patch&&typeof patch.title!=='string')||('body' in patch&&typeof patch.body!=='string')||('color' in patch&&!hex(patch.color)))throw Error('请核对名称、说明或完整颜色值。');
  if(['x','y','w','h'].some(k=>k in patch)&&(!validRect(next)||next.w<80||next.h<80))throw Error('位置须在 ±999000 内，宽高须在 80 至 999000 内。');
  return next;
}
export function frameCard(node,selected){
  const card=document.createElement('article');card.className='card reference-card frame-card';
  card.style.setProperty('--frame-colour',hex(node.color)?node.color:'#a8aaad');
  const label=document.createElement('div');label.className='frame-label';
  const title=document.createElement('h2');title.className='card-title';title.textContent=node.title||'未命名分区';label.append(title);
  if(node.body){const text=document.createElement('p');text.className='frame-description';text.textContent=node.body;label.append(text);}
  card.append(label);
  if(selected){const grip=document.createElement('button');grip.className='frame-resize';grip.dataset.frameResize=node.id;grip.setAttribute('aria-label','拉伸分区右下角；方向键微调，Shift 加速');grip.title='拉伸边界 · 方向键微调';grip.textContent='⤡';card.append(grip);}
  return card;
}
export class FrameEditor{
  constructor(callbacks){this.c=callbacks;this.lastField='frameTitle';
    for(const [id,key] of [['frameTitle','title'],['frameBody','body']]){
      $(id).onfocus=()=>{this.lastField=id;this.c.endGroup();};
      $(id).oninput=()=>this.change({[key]:$(id).value},id);
    }
    for(const [id,key] of [['frameX','x'],['frameY','y'],['frameWidth','w'],['frameHeight','h']]){
      $(id).oninput=()=>$(id).setCustomValidity('');
      $(id).onchange=()=>{if($(id).reportValidity())this.change({[key]:Number($(id).value)});};
    }
    $('frameColour').oninput=()=>{this.change({color:$('frameColour').value},'frameColour');$('frameHex').value=$('frameColour').value;};
    $('frameColour').onchange=()=>this.c.endGroup();
    $('frameHex').oninput=()=>$('frameHex').setCustomValidity('');
    $('frameHex').onchange=()=>{if(!hex($('frameHex').value)){$('frameHex').setCustomValidity('请填写完整颜色，例如 #8da6bc');$('frameHex').reportValidity();return;}this.change({color:$('frameHex').value});$('frameColour').value=$('frameHex').value;};
    for(const [color,name] of frameColours){const button=document.createElement('button');button.className='swatch';button.dataset.colour=color;button.style.backgroundColor=color;button.setAttribute('aria-label',name+'边框');button.title=name;button.onclick=()=>{this.change({color});$('frameColour').value=$('frameHex').value=color;};$('frameSwatches').append(button);}
    $('fitFrameContents').onclick=()=>this.fit(false);$('fitFrameAll').onclick=()=>this.fit(true);
    $('deleteFrame').onclick=()=>{const node=this.c.node();if(!node||!this.c.canEdit()||!confirm('只移除这个分区边框及其自身连线？里面的便签、表格和素材都会保留；可以撤销。'))return;this.c.remove(node.id);};
  }
  select(){const n=this.c.node();if(!n)return;
    for(const [id,key] of [['frameTitle','title'],['frameBody','body'],['frameX','x'],['frameY','y'],['frameWidth','w'],['frameHeight','h']]){$(id).value=n[key]??'';$(id).setCustomValidity('');}
    $('frameColour').value=$('frameHex').value=hex(n.color)?n.color:'#a8aaad';$('frameState').textContent='';this.sync();
  }
  sync(){const n=this.c.node();if(!n)return;const content=frameContents(n,this.c.board().nodes),editable=this.c.canEdit();
    $('frameContentCount').textContent=`完整落在边界内的内容：${content.length} 个。拉伸或拖动边界只改变这个分区。`;
    $('fitFrameContents').disabled=!editable||!content.length;
    $('fitFrameAll').disabled=!editable||!this.c.board().nodes.some(n=>n.type!=='frame');
    for(const b of $('frameSwatches').children)b.setAttribute('aria-pressed',String(b.dataset.colour.toLowerCase()===String(n.color).toLowerCase()));
    for(const b of document.querySelectorAll('[data-frame-resize]'))b.disabled=!editable;
  }
  geometry(){const n=this.c.node();if(!n)return;for(const [id,key] of [['frameX','x'],['frameY','y'],['frameWidth','w'],['frameHeight','h']])$(id).value=n[key];this.sync();}
  change(patch,group=null){const n=this.c.node();if(!n||!this.c.canEdit())return false;
    try{const next=framePatch(n,patch);if(Object.keys(patch).every(k=>n[k]===next[k]))return false;this.c.change(next,group);$('frameState').textContent='';this.sync();return true;}
    catch(e){$('frameState').textContent=e.message;return false;}
  }
  fit(all){const n=this.c.node();if(!n||!this.c.canEdit())return;
    try{const nodes=all?this.c.board().nodes:frameContents(n,this.c.board().nodes);const patch=surround(nodes,Number($('framePadding').value));if(this.change(patch)){this.geometry();this.c.fit(this.c.node());}}
    catch(e){$('frameState').textContent=e.message;}
  }
}
