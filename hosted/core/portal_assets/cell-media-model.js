import {cellTarget} from './cell-notes-model.js';
import {tableLayoutKey} from './table-model.js';
import {validAssetId} from './board-media.js';

export function cellEntries(node,row,column){
  const target=cellTarget(node,row,column),items=JSON.parse(target.cell);
  const images=node.cellImages?.[target.rowIndex]?.[target.columnIndex];
  const imageShape=(node.cellImages===undefined||Array.isArray(node.cellImages))&&(node.cellImages?.[target.rowIndex]===undefined||Array.isArray(node.cellImages[target.rowIndex]))&&(images===undefined||Array.isArray(images));
  return {target,imageShape,entries:[...items.map((item,index)=>({collection:'cellItems',index,item})),...(imageShape?(images||[]):[]).map((item,index)=>({collection:'cellImages',index,item}))]};
}
export function mediaTarget(node,row,column,collection,index){
  if(!['cellItems','cellImages'].includes(collection)||!Number.isSafeInteger(index)||index<0)throw Error('单元格素材位置无效。');
  const {target,entries,imageShape}=cellEntries(node,row,column);
  if(collection==='cellImages'&&!imageShape)throw Error('原图片引用的格式无法核对，保持原样。');
  const item=entries.find(entry=>entry.collection===collection&&entry.index===index)?.item;
  if(!item||typeof item!=='object'||Array.isArray(item)||!validAssetId(item.assetId)||(collection==='cellItems'&&item.type!=='image'))throw Error('这份引用没有可核对的网页版素材编号；原内容保持不变。');
  return Object.freeze({table:node.id,row,column,rowIndex:target.rowIndex,columnIndex:target.columnIndex,layout:tableLayoutKey(node),collection,index,assetId:item.assetId,original:JSON.stringify(item)});
}
export function checkMediaTarget(node,target){
  const fresh=mediaTarget(node,target.row,target.column,target.collection,target.index);
  if(['table','row','column','layout','collection','index','assetId','original'].some(key=>fresh[key]!==target[key]))throw Error('原单元格素材或行列已改变，请返回重新选择；原内容保持不变。');
  return fresh;
}
