const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
export function readableCue(value){return Boolean(value&&value.version===1&&typeof value.assetId==='string'&&UUID.test(value.assetId)&&typeof value.contentHash==='string'&&HASH.test(value.contentHash)&&typeof value.time==='number'&&Number.isFinite(value.time)&&value.time>=0&&value.time<=31536000&&typeof value.sourceTitle==='string'&&value.sourceTitle.length<=1000);}
export function captureCue(asset,time,duration){
  if(!asset||!['audio','video'].includes(asset.kind)||typeof asset.id!=='string'||!UUID.test(asset.id)||typeof asset.contentHash!=='string'||!HASH.test(asset.contentHash)||typeof time!=='number'||typeof duration!=='number'||!Number.isFinite(duration)||duration<=0||!Number.isFinite(time)||time<0||time>duration||time>31536000)throw Error('还无法核对当前位置，请等待媒体就绪后再记录。');
  const title=asset.title||asset.filename;if(typeof title!=='string'||title.length>1000)throw Error('原素材名称无法核对。');
  return Object.freeze({version:1,assetId:asset.id,contentHash:asset.contentHash,time,sourceTitle:title});
}
export function cueTime(time){if(typeof time!=='number'||!Number.isFinite(time)||time<0||time>31536000)return '未核对';const ms=Math.round(time*1000),s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s/60)%60;return (h?h+':':'')+String(m).padStart(2,'0')+':'+String(s%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');}
export function cueMatches(cue,asset){return readableCue(cue)&&asset?.id===cue.assetId&&asset.contentHash===cue.contentHash&&['audio','video'].includes(asset.kind);}
