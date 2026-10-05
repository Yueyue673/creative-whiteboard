// Native clipboard operations for the library, with shared media references.
// A cut is only a pending move; the catalog changes after a successful paste.
(() => {
 'use strict';
 const cutKey='creative-library-cut-v1';
 let busy=false,pendingRefresh=false;
 const clipboard=window.whiteboardClipboardCoordinator;
 const inside=(path,parent)=>path===parent||path.startsWith(parent+'/');
 function cutState(){try{return JSON.parse(localStorage.getItem(cutKey)||'null')}catch{return null}}
 function clearCut(){try{localStorage.removeItem(cutKey)}catch{}paintCut()}
 function paintCut(){const cut=cutState(),ids=new Set(cut?.ids||[]);$('assetPane').querySelectorAll('[data-asset],[data-asub],[data-afolder]').forEach(el=>{const folder=el.dataset.asub??el.dataset.afolder;el.classList.toggle('cut-pending',!!cut&&(el.dataset.asset?ids.has(el.dataset.asset):!!cut.folder&&folder===cut.folder))})}
 const renderBefore=renderAssets;renderAssets=function(){renderBefore();paintCut();refreshPending()};
 function handles(e,writing=false){return !!e.target?.closest?.('#assetPane')&&!$('dialog').open&&!isTyping(e)&&(!writing||!clipboardIsText(e))}
 function selection(){const folder=assetFolderPick;return {folder:folder||null,entries:assetIndex.assets.filter(a=>!a.archived&&(folder?inside(a.folder,folder):assetSelected.has(a.id))).map(clone),folders:folder?allAssetFolders().filter(f=>inside(f,folder)):[]}}
 function flatten(entries){const nodes=[],edges=[];let x=0;for(const a of entries){const b=itemBundle(a),ids=new Map(b.nodes.map(n=>[n.id,uid()]));for(const n of b.nodes){const old=n.id;n.id=ids.get(old);n.x=(Number(n.x)||0)+x;n.libraryOrigin={id:a.id,name:a.title,nodeId:old};nodes.push(n)}for(const edge of b.edges||[])if(ids.has(edge.from)&&ids.has(edge.to))edges.push({...edge,id:uid(),from:ids.get(edge.from),to:ids.get(edge.to)});x+=400}return {nodes,edges}}
 function prepare(cut){const s=selection();if(!s.entries.length&&!s.folder)return null;return {format:'creative-board-fragment',version:1,...flatten(s.entries),library:{version:1,origin:location.origin,operation:cut?'cut':'copy',token:uid(),...s}}}
 function remember(pack){clearCut();if(pack.library.operation==='cut'){try{localStorage.setItem(cutKey,JSON.stringify({token:pack.library.token,ids:pack.library.entries.map(a=>a.id),folder:pack.library.folder}))}catch{toast('当前浏览器不能记录剪切，请改用复制');return}paintCut()}toast(pack.library.operation==='cut'?'已剪切，选择存放位置后粘贴':'已复制，可粘贴到内容库或白板')}
 function queueWrite(pack,rememberOnSuccess=true,text=JSON.stringify(pack)){
  return clipboard.write(pack,text,{
   success:()=>{if(rememberOnSuccess)remember(pack);else if(!pack?.library)clearCut()},
   error:()=>toast('请选中内容后使用 Ctrl+'+(pack?.library?.operation==='cut'?'X':'C'))
  });
 }
 const pendingPayload=(text,files)=>clipboard.payload(text,files);
 const ready=()=>clipboard.ready();
 function nativePayload(raw){clearCut();if(clipboard.pending)queueWrite(JSON.parse(raw),false);else clipboard.markNativeCopy?.()}
 function nativeText(e){
  if(clipboard.nativeText(e))clearCut();
 }
 const canvasPasteBefore=pastePayload;pastePayload=async function(text,files=[],anchor=pasteAnchor()){const payload=await pendingPayload(text,files);if(payload)return canvasPasteBefore(payload.text,payload.files,anchor)};
 function writeEvent(e,cut){const pack=prepare(cut);e.preventDefault();e.stopImmediatePropagation();if(!pack)return;try{e.clipboardData.setData('text/plain',JSON.stringify(pack));if(clipboard.pending)queueWrite(pack,false);else clipboard.markNativeCopy?.();remember(pack)}catch{toast('无法写入剪贴板，请使用 Ctrl+C')}}
 function write(cut){const pack=prepare(cut);return pack?queueWrite(pack):Promise.resolve(false)}
 function uniqueName(name,used){if(!used.has(name)){used.add(name);return name}let i=1,candidate;do{candidate=name+' 副本'+(i>1?' '+i:'');i++}while(used.has(candidate));used.add(candidate);return candidate}
 function parentOf(folder){return folder.includes('/')?folder.slice(0,folder.lastIndexOf('/')):''}
 function join(parent,name){return parent?parent+'/'+name:name}
 function checkDestination(folder){if(folder&&!allAssetFolders().includes(folder))throw Error('存放的文件夹已变化，请重新选择位置')}
 function captureDestination(path=assetFolder){return {folder:libraryFolderTarget(path),view:libraryFolderIdentity(assetFolder),path:assetFolder}}
 function resolveDestination(target){const folder=target.path?libraryFolderLocation(target):'';if(target.path&&!folder)throw Error('存放的文件夹已变化，请重新选择位置');checkDestination(folder);return folder}
 function verifyEntries(meta,moving){if(meta.origin!==location.origin)throw Error('这份目录来自另一个工作区，请导入原文件');if(!Array.isArray(meta.entries)||!Array.isArray(meta.folders))throw Error('剪贴板中的目录不完整');for(const a of meta.entries){const current=assetById(a.id);if(!current||current.archived)throw Error('原件已移出内容库，请重新复制');if(current.path!==a.path||current.mime!==a.mime)throw Error('原文件已变化，请重新复制');if(moving&&!wfEqual(current,a))throw Error('剪切后原件又被改过，请重新剪切')}if(moving&&meta.folder){const ids=assetIndex.assets.filter(a=>!a.archived&&inside(a.folder,meta.folder)).map(a=>a.id).sort(),folders=allAssetFolders().filter(f=>inside(f,meta.folder)).sort();if(!wfEqual(ids,meta.entries.map(a=>a.id).sort())||!wfEqual(folders,[...meta.folders].sort()))throw Error('文件夹内容已变化，请重新剪切')}}
 function selectResult(ids,folder,startedView){if(startedView&&libraryFolderIdentity(assetFolder)!==startedView)return;assetFolderPick=null;enterAssetFolder(folder);assetSelected=new Set(ids);renderAssets();$('assetPane').focus({preventScroll:true})}
 async function pasteLibrary(meta,destination,startedView){if(meta.version!==1)throw Error('这份剪贴板目录版本不受支持');const moving=meta.operation==='cut';if(moving&&cutState()?.token!==meta.token)throw Error('这次剪切已完成或取消，请重新复制或剪切');checkDestination(destination);verifyEntries(meta,moving);
  const next=clone(assetIndex),ids=[];let root=null;
  if(meta.folder){if(moving&&inside(destination,meta.folder))throw Error('不能把文件夹移动到它自己里面');const name=meta.folder.split('/').at(-1),siblings=new Set(allAssetFolders().filter(f=>parentOf(f)===destination&&(!moving||f!==meta.folder)).map(f=>f.split('/').at(-1)));root=join(destination,uniqueName(name,siblings));if(moving&&root===meta.folder){clearCut();selectResult(meta.entries.map(a=>a.id),destination,startedView);return}const map=f=>root+f.slice(meta.folder.length);if(moving){moveLibraryFolderIds(next,meta.folder,root);next.folders=next.folders.filter(f=>!inside(f,meta.folder))}next.folders=[...new Set([...next.folders,...meta.folders.map(map),root])];for(const a of meta.entries){const item=moving?next.assets.find(x=>x.id===a.id):clone(a);if(!moving){item.id=uid();next.assets.push(item)}item.folder=map(a.folder);item.updated=Date.now();ids.push(item.id)}}
  else {const names=new Set(next.assets.filter(a=>!a.archived&&a.folder===destination&&(!moving||!meta.entries.some(x=>x.id===a.id))).map(a=>a.title));for(const a of meta.entries){const item=moving?next.assets.find(x=>x.id===a.id):clone(a);if(!moving){item.id=uid();item.title=uniqueName(a.title||'未命名内容',names);next.assets.push(item)}item.folder=destination;item.updated=Date.now();ids.push(item.id)}if(moving&&meta.entries.every(a=>a.folder===destination)){clearCut();selectResult(ids,destination,startedView);return}}
  if(!ids.length&&!root)return;if(!await saveAssets(next))return;if(moving)clearCut();selectResult(ids,destination,startedView);toast(moving?'已移动 · Ctrl+Z 撤销':'已粘贴副本 · Ctrl+Z 撤销')
 }
 function decode(text){try{return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))}catch{return null}}
 async function storeFragment(bundle,destination,startedView){if(!bundle.nodes?.length)return;if(bundle.nodes.length>5000||(bundle.edges||[]).length>10000)throw Error('内容超过单组上限，请分批收录');checkDestination(destination);const next=clone(assetIndex),id=uid(),title=bundle.nodes[0].title||'未命名内容',names=new Set(next.assets.filter(a=>!a.archived&&a.folder===destination).map(a=>a.title));next.assets.push({id,title:uniqueName(title,names),path:'',mime:bundleMime,size:0,tags:[],notes:'',folder:destination,bundle:clone(bundle),updated:Date.now()});if(await saveAssets(next)){selectResult([id],destination,startedView);toast('已收进内容库 · Ctrl+Z 撤销')}}
 async function paste(text,files=[],destination=assetFolder){if(busy)return toast('上一批内容还在粘贴，请稍候');const target=typeof destination==='string'?captureDestination(destination):destination;busy=true;try{const payload=await pendingPayload(text,files);if(!payload)return;({text,files}=payload);const parsed=decode(text);if(parsed?.format==='creative-board-references'||parsed?.format==='creative-board-proposal')return await pastePayload(text,[],pasteAnchor());await loadAssets();destination=resolveDestination(target.folder);if(files.length){const added=await uploadFiles(files,destination);selectLibraryImports(added,target.folder,target.path);return}if(parsed?.format==='creative-board-fragment'){if(parsed.library)return await pasteLibrary(parsed.library,destination,target.view);return await storeFragment(normalize(parsed),destination,target.view)}if(!text)return;await storeFragment({nodes:[{id:uid(),type:'note',title:text.split(/\r?\n/)[0].slice(0,60),body:text,userText:'',annotation:'',tags:[],color:'#fff2a8',x:0,y:0,w:340,h:120,sizeMode:'auto'}],edges:[]},destination,target.view)}finally{busy=false}}
 async function pasteFromMenu(destination){if(!await ready())return;let text,files=[];try{text=await navigator.clipboard.readText();if(!text)for(const item of await navigator.clipboard.read())for(const type of item.types)if(type.startsWith('image/')){const blob=await item.getType(type);files.push(new File([blob],'粘贴图片.'+(type.split('/')[1]||'png'),{type}))}}catch{return toast('请在内容库中按 Ctrl+V 粘贴')}if(text||files.length)await paste(text,files,destination)}
 const menuBefore=fileMenu;fileMenu=function(e,items){if(e.target.closest?.('#assetPane')&&!e.target.closest('input,textarea,[contenteditable=true]')){const f=e.target.closest('[data-asub],[data-afolder]'),destination=captureDestination(f?(f.dataset.asub??f.dataset.afolder):assetFolder);items=[...(assetFolderPick||assetSelected.size?[['复制  Ctrl+C',()=>write(false)],['剪切  Ctrl+X',()=>write(true)]]:[]),['粘贴  Ctrl+V',()=>pasteFromMenu(destination)],...items]}return menuBefore(e,items)};
 function cancel({silent=false}={}){const writing=clipboard.pending?.pack?.library?.operation==='cut'?clipboard.pending:null;if(writing)writing.cancelled=true;if(!cutState()&&!writing)return false;clearCut();if(!silent)toast('已取消剪切，原件保留');return true}
 async function refreshPending(){if(!pendingRefresh||busy||editorId||$('dialog').open)return;pendingRefresh=false;try{await loadAssets();assetSelected=new Set([...assetSelected].filter(id=>assetById(id)&&!assetById(id).archived));if(assetFolder&&!allAssetFolders().includes(assetFolder))enterAssetFolder('');renderAssets()}catch{pendingRefresh=true}}
 window.addEventListener('storage',e=>{if(e.key===cutKey){paintCut();if(e.oldValue&&!e.newValue){pendingRefresh=true;refreshPending()}}});
 $('dialog').addEventListener('close',()=>refreshPending());
 const drawBefore=drawNodes;drawNodes=function(){drawBefore();refreshPending()};
 window.whiteboardLibraryClipboard={handles,writeEvent,paste,cancel,ready,nativePayload,nativeText,copyPayload:pack=>queueWrite(pack,false)};
})();
