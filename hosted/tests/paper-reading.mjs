import assert from 'node:assert/strict';
import {normalizePaperFont,paperReadingKey,PAPER_FONTS} from '../core/portal_assets/paper-reading.js';
const workspace='12345678-1234-1234-1234-123456789abc',other='87654321-1234-1234-1234-123456789abc';
let count=0;const test=(name,run)=>{run();count++;console.log('PASS '+name);};
test('Absent/old/invalid local preferences use original without interpreting CSS, paths or prototype keys',()=>{
  for(const value of [undefined,null,{},[],1,'__proto__','constructor','url(https://external.invalid/font)','file:///font.ttf',{toString(){throw Error('Do not coerce');}}])assert.equal(normalizePaperFont(value),'original');
  for(const key of ['original','clear','book','mono'])assert.equal(normalizePaperFont(key),key);
  assert(Object.values(PAPER_FONTS).every(row=>!row.family||!row.family.includes('url(')));
});
test('Fixed original account/workspace keys do not collide across accounts/spaces or depend on current board/cookie',()=>{
  const source=Object.freeze({account:1,workspace,key:'first',cookie:'another-account'});
  const key=paperReadingKey(source);assert.equal(key,paperReadingKey({...source,key:'second',cookie:'changed'}));assert.notEqual(key,paperReadingKey({...source,account:2}));assert.notEqual(key,paperReadingKey({...source,workspace:other}));
  assert.equal(key,paperReadingKey({...source,workspace:workspace.toUpperCase()}));
});
test('Invalid scope cannot silently create a shared/global preference key or coerce an identity',()=>{
  for(const account of [null,0,-1,'1',Infinity,Number.MAX_SAFE_INTEGER+1,{}])assert.equal(paperReadingKey({account,workspace}),null);
  for(const workspace of [null,'',{},'../other','current','https://example.test/'])assert.equal(paperReadingKey({account:1,workspace}),null);
  assert.equal(paperReadingKey(null),null);
});
console.log(`${count} local reading identity/fallback cases passed`);
