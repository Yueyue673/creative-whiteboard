import assert from 'node:assert/strict';
import {distanceTitle,distanceLayout} from '../core/portal_assets/space-reading.js';
import {normalizePaperReading} from '../core/portal_assets/paper-reading.js';
const test=(name,run)=>{run();console.log('PASS '+name);};
test('Names are literal original title or first authored body line; no Markdown/HTML execution or rewritten copy.',()=>{
  const node={type:'note',title:'  Own <b>title</b>\nsecond line  ',body:'Other words'},raw=JSON.stringify(node);
  assert.deepEqual(distanceTitle(node),{text:node.title,source:'title'});assert.equal(JSON.stringify(node),raw);
  assert.deepEqual(distanceTitle({type:'note',title:'  ',body:'\r\n  **Own raw line**  \r\nNext'}),{text:'  **Own raw line**  ',source:'body'});
  assert.deepEqual(distanceTitle({type:'table',body:'Never infer a table name from its contents'}),{text:'未命名表格',source:'empty'});
});
test('Projected name bounds remain inside original cards over small/manual/automatic paper dimensions and zooms.',()=>{
  for(const width of [80,320,400,900])for(const height of [96,180,503,1200])for(const zoom of [.000001,.04,.12,.25,.449,1,3]){
    const out=distanceLayout(width,height,zoom);assert(out);assert(out.width<=width*zoom);assert(out.height<=height*zoom);assert(out.font>=9&&out.font<=12);assert(out.lines>=0&&out.lines<=3);assert.equal(out.scale,1/zoom);
    if(out.visible){assert(out.width>=out.font);assert(out.lines*out.font*1.35<=out.height+1e-9);}
  }
});
test('Invalid geometry is never coerced or allowed to emit a CSS layout.',()=>{
  for(const value of [undefined,null,'320',{},[],Infinity,NaN,-1,0])assert.equal(distanceLayout(value,180,.2),null);
  assert.equal(distanceLayout(16,180,.2),null);assert.equal(distanceLayout(320,12,.2),null);
  assert.equal(distanceLayout(320,180,0),null);assert.equal(distanceLayout(320,180,Infinity),null);
});
test('Old browser font preferences migrate to adaptive names; explicit original paper and invalid data remain bounded.',()=>{
  assert.deepEqual(normalizePaperReading({font:'book'}),{font:'book',overview:'smart'});
  assert.deepEqual(normalizePaperReading({font:'mono',overview:'paper',ignored:'not persisted'}),{font:'mono',overview:'paper'});
  for(const value of [null,undefined,{},[],{font:'url(https://external.invalid/font)',overview:'file:///outside'},{font:'constructor',overview:{}}])assert.deepEqual(normalizePaperReading(value),{font:'original',overview:'smart'});
});
