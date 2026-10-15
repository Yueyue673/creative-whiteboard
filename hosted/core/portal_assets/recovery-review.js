import {checkRaw} from './board-drafts.js';
import {valueEqual,validateLiveBoard} from './board-reconciliation.js';

const own=(value,key)=>Object.hasOwn(value,key);
const field=(value,key)=>own(value,key)?[value[key]]:[];
const other=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['nodes','edges','name','view'].includes(key)));
const label=node=>{
  const raw=typeof node.title==='string'&&node.title.trim()?node.title:typeof node.body==='string'?node.body.split(/\r?\n/).find(line=>line.trim())||'':'';
  return [...raw].slice(0,80).join('')||({note:'未命名便签',table:'未命名表格',frame:'未命名分区',image:'未命名素材'}[node.type]);
};

/* This is a comparison of two complete originals, never a merge or text edit.
   The review is valid only for the exact current page input that was compared. */
export class RecoveryReview {
  #current=null; #source=null; #summary=null;
  clear(){this.#current=this.#source=this.#summary=null;}
  get source(){return this.#source;}
  get summary(){return this.#summary;}
  select(currentRaw,sourceRaw){
    this.clear();
    const before=validateLiveBoard(checkRaw(currentRaw),currentRaw),after=validateLiveBoard(checkRaw(sourceRaw),sourceRaw);
    const old=new Map(before.nodes.map(node=>[node.id,node])),next=new Map(after.nodes.map(node=>[node.id,node]));
    const changes=[];let added=0,removed=0,changed=0;
    for(const node of before.nodes){
      const present=next.get(node.id);
      if(!present){removed++;changes.push(Object.freeze({kind:'removed',id:node.id,label:label(node)}));}
      else if(!valueEqual(node,present)){changed++;changes.push(Object.freeze({kind:'changed',id:node.id,label:label(present)}));}
    }
    for(const node of after.nodes)if(!old.has(node.id)){added++;changes.push(Object.freeze({kind:'added',id:node.id,label:label(node)}));}
    const summary=Object.freeze({sourceName:after.name,beforeCount:before.nodes.length,afterCount:after.nodes.length,added,removed,changed,unchanged:before.nodes.length-removed-changed,
      nameChanged:before.name!==after.name,relationsChanged:!valueEqual(before.edges,after.edges),beforeRelations:before.edges.length,afterRelations:after.edges.length,
      orderChanged:!valueEqual(before.nodes.map(node=>node.id),after.nodes.map(node=>node.id)),viewChanged:!valueEqual(field(before,'view'),field(after,'view')),
      otherChanged:!valueEqual(other(before),other(after)),identical:valueEqual(before,after),changes:Object.freeze(changes)});
    this.#current=currentRaw;this.#source=sourceRaw;this.#summary=summary;return summary;
  }
  matches(currentRaw){return this.#summary!==null&&this.#current===currentRaw;}
  value(currentRaw){if(!this.matches(currentRaw))throw new Error('当前页面已有变化，请重新核对恢复摘要。');return validateLiveBoard(checkRaw(this.#source),this.#source);}
}
