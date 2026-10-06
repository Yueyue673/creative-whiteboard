// Board cards and table copies share surface rules without rewriting stored colors.
function contentSurfaceClass(n){
 const neutral=(n.color||'').toLowerCase()==='#ffffff';
 if(n.type==='table'||n.assetId||n.mediaId||neutral)return 'theme-surface';
 if(/^#[\da-f]{6}$/i.test(n.color||'')){
  const rgb=n.color.slice(1).match(/../g).map(x=>parseInt(x,16));
  if(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722<125)return 'theme-dark';
 }
 return '';
}
(()=>{const before=noteMarkup;noteMarkup=function(n){const extra=contentSurfaceClass(n);return before(n).replace('class="node ','class="node '+(extra?extra+' ':''))}})();
