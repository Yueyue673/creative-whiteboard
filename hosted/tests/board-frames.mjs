import assert from 'node:assert/strict';
import {frameContents,surround,framePatch,validRect} from '../core/portal_assets/board-frames.js';
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name);};
const frame={id:'f',type:'frame',title:'作者原名',body:'作者说明',x:-100,y:-100,w:600,h:500,opaque:{kept:[17]},style:{external:true}};
const nodes=[{id:'n',type:'note',x:-100,y:-100,w:100,h:100,sizeMode:'manual',body:'Exact original'},
 {id:'t',type:'table',x:100,y:100,w:180,h:80,rows:[['Exact cell']],cellItems:{unknown:true}},
 {id:'i',type:'image',x:400,y:300,w:100,h:100,assetId:'registered-original'},
 {id:'partial',type:'note',x:490,y:390,w:100,h:100},
 {id:'nested',type:'frame',x:0,y:0,w:100,h:100},
 {id:'bad',type:'note',x:0,y:0,w:-1,h:100}];
check('Full geometric containment includes exact edges, excludes partial/nested/invalid content',()=>{assert.deepEqual(frameContents(frame,nodes).map(n=>n.id),['n','t','i']);assert.deepEqual(frameContents({...frame,w:NaN},nodes),[]);});
check('All three padding presets surround original content without modifying cells/media/manual size',()=>{const input=nodes.slice(0,3),raw=JSON.stringify(input);for(const pad of [12,24,48]){const r=surround(input,pad);assert.deepEqual(frameContents({...r,type:'frame'},input),input);for(const n of input)assert.ok(n.x>=r.x+pad&&n.y>=r.y+pad&&n.x+n.w<=r.x+r.w-pad&&n.y+n.h<=r.y+r.h-pad);}assert.equal(JSON.stringify(input),raw);});
check('Unknown frame fields and exact authored text survive immutable edits',()=>{const raw=JSON.stringify(frame),out=framePatch(frame,{title:' <b>原样</b> ',body:'\n作者自己的说明\n',color:'#AB12ef'});assert.equal(JSON.stringify(frame),raw);assert.deepEqual(out.opaque,frame.opaque);assert.deepEqual(out.style,frame.style);assert.equal(out.title,' <b>原样</b> ');assert.equal(out.body,'\n作者自己的说明\n');});
check('No content, invalid geometry and out-of-range surround operations refuse silent truncation',()=>{for(const ns of [[],[nodes[4]],[nodes[5]],[{type:'note',x:-999000,y:0,w:100,h:100}]])assert.throws(()=>surround(ns));assert.throws(()=>surround([nodes[0]],20));});
check('Unsafe or unrelated patches cannot alter node identity/type/unknown payload',()=>{for(const patch of [{id:'retarget'},{type:'note'},{opaque:'replace'},{color:'var(--unsafe)'},{title:[]},{w:79},{x:Infinity},{h:1e7}])assert.throws(()=>framePatch(frame,patch));assert.throws(()=>framePatch(nodes[0],{title:'Wrong type'}));});
check('Negative and fractional positions remain exact while dimensions stay bounded',()=>{const p={x:-331.125,y:21.75,w:80,h:999000};assert.deepEqual(framePatch(frame,p),{...frame,...p});assert.ok(validRect(framePatch(frame,p)));});
check('Malformed preexisting dimensions remain untouched during author text edits and require explicit valid geometry',()=>{const n={...frame,w:-1},raw=JSON.stringify(n);assert.equal(framePatch(n,{body:'Original entered text'}).w,-1);assert.throws(()=>framePatch(n,{x:10}));assert.equal(framePatch(n,{w:80}).w,80);assert.equal(JSON.stringify(n),raw);});
console.log(`${count} frame geometry/preservation checks passed`);
