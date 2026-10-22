/* Prepare every original Undo/Redo snapshot before changing live objects. */
import {reconcileValues,validateLiveBoard} from './board-reconciliation.js';

export function prepareNativeReception(base,next,undo,redo,{maxBytes=24*1024*1024,maxMs=100,now=()=>performance.now()}={}){
 validateLiveBoard(next);
 const remote={...structuredClone(next),view:structuredClone(base.view)},start=now();let bytes=0;
 const entries=values=>values.map(value=>{
  bytes+=new TextEncoder().encode(JSON.stringify(value)).length;
  if(bytes>maxBytes||now()-start>maxMs)throw Error('Original history requires explicit review');
  return validateLiveBoard(reconcileValues(base,value,remote));
 });
 return {board:remote,undo:entries(undo),redo:entries(redo)};
}

export function applyReceivedBoard(board,next){
 validateLiveBoard(next);
 // Native DOM handlers close over node objects. Preserve their identity even
 // when geometry alone changes and the incremental renderer keeps the field.
 const rewrite=(target,value)=>{
  for(const key of Object.keys(target))if(!Object.hasOwn(value,key))delete target[key];
  for(const [key,item]of Object.entries(value))Object.defineProperty(target,key,{value:item,writable:true,enumerable:true,configurable:true});
  return target;
 };
 const retain=(before,after)=>{const existing=new Map(before.map(item=>[item.id,item]));return after.map(item=>existing.has(item.id)?rewrite(existing.get(item.id),item):item);};
 next.nodes=retain(board.nodes,next.nodes);next.edges=retain(board.edges,next.edges);
 return rewrite(board,next);
}
