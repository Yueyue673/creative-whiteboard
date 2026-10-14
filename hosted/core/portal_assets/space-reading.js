// A distance view changes only presentation. Original paper, media and authored
// geometry stay mounted; the label's projected paint area never exceeds its card.
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function distanceTitle(node){
  if(typeof node?.title==='string'&&node.title.trim())return {text:node.title,source:'title'};
  if(node?.type==='note'&&typeof node.body==='string'){
    const first=node.body.split(/\r\n|\r|\n/).find(line=>line.trim());
    if(first)return {text:first,source:'body'};
  }
  return {text:node?.type==='table'?'未命名表格':'空白便签',source:'empty'};
}
export function distanceLayout(width,height,zoom){
  if(![width,height,zoom].every(finite)||width<=16||height<=12||zoom<=0)return null;
  const w=(width-16)*zoom,h=(height-12)*zoom,font=Math.max(9,Math.min(12,w/7));
  const lines=Math.max(0,Math.min(3,Math.floor(h/(font*1.35))));
  return {width:w,height:h,font,lines,visible:w>=font&&lines>0,scale:1/zoom};
}
export class DistanceReading{
  constructor(callbacks){this.c=callbacks;this.states=new WeakMap();this.pending=0;}
  schedule(){if(this.pending)return;this.pending=requestAnimationFrame(()=>{this.pending=0;this.render();});}
  render(){
    const board=this.c.board(),z=this.c.zoom(),active=!!board&&this.c.canRead()&&this.c.mode()!=='paper'&&finite(z)&&z<.45;
    this.c.canvas.classList.toggle('space-overview',active);
    const nodes=new Map((board?.nodes||[]).map(node=>[node.id,node]));
    for(const card of this.c.cards.children){
      const node=nodes.get(card.dataset.node);if(!node||!['note','table'].includes(node.type))continue;
      let state=this.states.get(card);
      if(!state){const label=document.createElement('span');label.className='space-card-label';label.setAttribute('aria-hidden','true');card.append(label);state={label,title:card.getAttribute('title'),name:card.getAttribute('aria-label')};this.states.set(card,state);}
      const {label}=state,text=distanceTitle(node),layout=distanceLayout(node.w,this.c.height(node),z);
      label.hidden=!active||!layout?.visible;
      if(label.textContent!==text.text)label.textContent=text.text;
      if(active){card.title=text.text;card.setAttribute('aria-label',(text.source==='body'?'正文开头：':'')+text.text);}
      else {for(const [key,value] of [['title',state.title],['aria-label',state.name]]){if(value===null)card.removeAttribute(key);else card.setAttribute(key,value);}}
      if(!layout||!active)continue;
      for(const [key,value] of [['width',layout.width+'px'],['max-height',layout.height+'px'],['--distance-font',layout.font+'px'],['--distance-lines',String(layout.lines)],['transform','scale('+layout.scale+')']]){
        if(label.style.getPropertyValue(key)!==value)label.style.setProperty(key,value);
      }
    }
  }
}
