// Paper ink follows the displayed color; stored colors and authored text stay intact.
const paperSurface=(()=>{
 const cache=new Map(),rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
 const luminance=value=>value.map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
 const css=value=>'#'+value.map(c=>c.toString(16).padStart(2,'0')).join('');
 return n=>{
  if(n.type==='frame'||n.type==='table'||n.assetId||n.mediaId||(n.color||'').toLowerCase()==='#ffffff')return null;
  const color=(/^#[\da-f]{6}$/i.test(n.color||'')?n.color:colors[0]).toLowerCase();
  if(cache.has(color))return cache.get(color);
  const background=rgb(color),dark=rgb('#242529'),light=rgb('#eeeef0');
  const ink=contrast(dark,background)>=4.5?dark:contrast(light,background)>=4.5?light:
   contrast([0,0,0],background)>=contrast([255,255,255],background)?[0,0,0]:[255,255,255];
  let caption=ink;
  for(let step=60;step<=100;step++){
   const candidate=ink.map((c,i)=>Math.round(background[i]+(c-background[i])*step/100));
   if(contrast(candidate,background)>=4.5){caption=candidate;break}
  }
  const value={ink:css(ink),caption:css(caption),dark:luminance(ink)>luminance(background)};
  cache.set(color,value);return value;
 };
})();
function contentSurfaceClass(n){
 if(n.type==='table'||n.assetId||n.mediaId||(n.color||'').toLowerCase()==='#ffffff')return 'theme-surface';
 return paperSurface(n)?.dark?'theme-dark':'';
}
function contentSurfaceStyle(n){const paper=paperSurface(n);return paper?'--paper-ink:'+paper.ink+';--paper-caption:'+paper.caption+';':''}
(()=>{const before=noteMarkup;noteMarkup=function(n){const extra=contentSurfaceClass(n);return before(n)
 .replace('class="node ','class="node '+(extra?extra+' ':''))
 .replace('style="','style="'+contentSurfaceStyle(n))}})();
