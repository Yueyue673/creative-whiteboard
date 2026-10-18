import assert from 'node:assert/strict';
import {reconcileValues, OwnHistory, boardRaw} from '../core/portal_assets/board-reconciliation.js';
const clone=structuredClone;
const board=body=>({format:'creative-board',version:1,name:'Synthetic originals',nodes:[{id:'one',type:'note',x:0,y:0,w:320,h:180,sizeMode:'auto',title:'Original',body,userText:'  supplementary  ',textFormat:'plain'}],edges:[]});
let cases=0;
for(const ending of ['\n','\r\n'])for(const final of ['',ending])for(const count of [3,5,11,33])for(const [a,c] of [[0,2],[count-3,count-1],[count-1,0]])for(const literal of ['  合成 😀 e\u0301\t','literal **value**','\t  spaced  ']){
 if(Math.abs(a-c)<2)continue;
 const lines=Array.from({length:count},(_,i)=>`${literal} ${i}`),own=lines.slice(),peer=lines.slice(),both=lines.slice();own[a]+=' / own';peer[c]+=' / peer';both[a]=own[a];both[c]=peer[c];
 const b=board(lines.join(ending)+final),i=board(own.join(ending)+final),p=board(peer.join(ending)+final),before=boardRaw([b,i,p]),v=reconcileValues(b,i,p);
 assert.equal(v.nodes[0].body,both.join(ending)+final);assert.deepEqual(reconcileValues(b,p,i),v);assert.equal(boardRaw([b,i,p]),before);
 const h=new OwnHistory();h.begin(b);h.record(i);h.boundary();const undone=h.apply(v);assert.equal(undone.nodes[0].body,p.nodes[0].body);assert.deepEqual(h.apply(undone,true),v);
 const overlapping=clone(v),rows=overlapping.nodes[0].body.split('\n');rows[a]+=' later peer';overlapping.nodes[0].body=rows.join('\n');const history=boardRaw({undo:h.undoEntries,redo:h.redoEntries,bytes:h.bytes()});assert.throws(()=>h.apply(overlapping));assert.equal(boardRaw({undo:h.undoEntries,redo:h.redoEntries,bytes:h.bytes()}),history);
 const later=clone(i);later.nodes[0].body=later.nodes[0].body.replace(' / own',' / later own');assert.equal(reconcileValues(i,later,v).nodes[0].body,v.nodes[0].body.replace(' / own',' / later own'));cases++;
}
const base='first\nseparator\nthird\nanother separator\nfifth',own=base.replace('first','own'),peer=base.replace('fifth','peer');
for(const [a,c] of [[own,base.replace('first','other')],[own,base.replace('separator','adjacent')],[own+'\nadded',peer],[own.split('\n').slice(1).join('\n'),peer],[own.replaceAll('\n','\r\n'),peer],[own.replace('third','another own'),peer],[base.replace('first','third'),peer],[base.replace('first','shared'),base.replace('fifth','shared')],[base.replace('first',' \t'),peer],[own+'\ud800',peer]]){
 const values=[board(base),board(a),board(c)],before=boardRaw(values);assert.throws(()=>reconcileValues(...values));assert.equal(boardRaw(values),before);cases++;
}
for(const mutate of [v=>v.textFormat='markdown',v=>v.userText='peer',v=>delete v.userText,v=>v.extension={meaning:'peer'}]){const values=[board(base),board(own),board(peer)];mutate(values[2].nodes[0]);assert.throws(()=>reconcileValues(...values));cases++;}
for(const type of ['frame','image','table']){const values=[board(base),board(own),board(peer)];for(const v of values)v.nodes[0].type=type;assert.throws(()=>reconcileValues(...values));cases++;}
for(const [b,a,c] of [['first\r\nmiddle\nthird\r\n','own\r\nmiddle\nthird\r\n','first\r\nmiddle\npeer\r\n']])assert.equal(reconcileValues(board(b),board(a),board(c)).nodes[0].body,'own\r\nmiddle\npeer\r\n');
for(const b of ['first\nmiddle\nfirst\nlast\nfifth',' \t\nmiddle\nthird','中'.repeat(21845)+'\nmiddle\nthird',Array.from({length:2049},(_,i)=>String(i)).join('\n')]){const rows=b.split('\n'),a=rows.slice(),c=rows.slice();a[0]='own';c[c.length-1]='peer';assert.throws(()=>reconcileValues(board(b),board(a.join('\n')),board(c.join('\n'))));cases++;}
console.log(cases+' exact note-line cases: immutable originals, inverse own history, pending input and conservative refusal passed');
