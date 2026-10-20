/* Render the four independent posters and the README cover.
 * Use an installed Playwright; no product server or user data is accessed.
 * node docs/posters/design/render.cjs /path/to/chromium [review-output-directory]
 * Output uses system fonts; install Microsoft YaHei, PingFang SC or Noto Sans CJK SC.
 */
const {chromium} = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL, fileURLToPath} = require('node:url');
const assert = require('node:assert/strict');
(async()=>{
 const executablePath=process.argv[2];
 if(!executablePath) throw new Error('Pass the path to your installed Chromium as the first argument.');
 const root=path.resolve(__dirname,'../../..');
 const outputs=[['1','docs/posters/01-reuse.png'],['2','docs/posters/02-compare.png'],['3','docs/posters/03-library.png'],['4','docs/posters/04-start.png'],['cover','docs/brand/reuse-paper-cover.png'],['cover-mobile','docs/brand/reuse-paper-cover-mobile.png']];
 const browser=await chromium.launch({executablePath,headless:true});
 const context=await browser.newContext({viewport:{width:800,height:1000},deviceScaleFactor:2});
 // Limit the renderer to files in this checkout; it cannot fetch user data or remote resources.
 await context.route('**/*',async route=>{
  const u=route.request().url();
  if(u.startsWith('file:')){
   const p=path.resolve(fileURLToPath(u));
   if(p===root||p.startsWith(root+path.sep)) return route.continue();
  }
  return route.abort();
 });
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const evidence=[];
 for(const [id,rel] of outputs){
  await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href+'?poster='+id);
  await page.evaluate(async()=>{await document.fonts.ready; await Promise.all([...document.images].map(i=>i.decode()));});
  const size=await page.locator('article.active').evaluate(el=>({w:el.clientWidth,h:el.clientHeight}));
  assert.equal(size.w,800);assert.equal(size.h,id==='cover'?400:id==='cover-mobile'?800:1000);
  const text=await page.locator('article.active').innerText();
  assert(text.includes('创作白板'));
  if(!id.startsWith('cover')) assert(text.includes('github.com/Yueyue673/creative-whiteboard'));
  const overflow=await page.locator('article.active').evaluate(el=>[...el.querySelectorAll('p,h1,footer,header,.start-steps,.steps,.pane-labels')].flatMap(x=>{
    const r=x.getBoundingClientRect(),b=el.getBoundingClientRect();
    return r.left<b.left-.5||r.right>b.right+.5||r.top<b.top-.5||r.bottom>b.bottom+.5?[{text:x.innerText,x:r.x,y:r.y,w:r.width,h:r.height}]:[];
  }));
  assert.deepEqual(overflow,[],id+' text must fit the poster');
  const destination=path.join(root,rel);
  await page.locator('article.active').screenshot({path:destination,type:'png'});
  evidence.push({id,file:rel,width:size.w*2,height:size.h*2,bytes:(await fs.stat(destination)).size,text,overflow});
 }
 assert.deepEqual(errors,[]);
 if(process.argv[3]){
  const review=path.resolve(process.argv[3]);await fs.mkdir(review,{recursive:true});
  const mobile=await context.newPage();await mobile.setViewportSize({width:360,height:450});
  for(const [id,rel] of outputs){
   await mobile.goto(pathToFileURL(path.join(root,rel)).href);
   await mobile.evaluate(()=>{document.body.style.margin='0';document.body.style.background='#faf9f3';const i=document.querySelector('img');i.style.cssText='display:block;width:360px;height:auto';});
   await mobile.locator('img').screenshot({path:path.join(review,'mobile-'+id+'.png')});
  }
  await fs.writeFile(path.join(review,'render-acceptance.json'),JSON.stringify({errors,evidence},null,2));
 }
 await browser.close();console.log(JSON.stringify(evidence.map(({text,overflow,...e})=>e),null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
