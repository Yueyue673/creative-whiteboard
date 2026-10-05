// Folder names are navigation; stable identities keep imports and history attached.
'use strict';
function libraryFolderPaths(catalog=assetIndex){
 const paths=new Set(catalog.folders||[]);
 for(const item of catalog.assets||[])if(!item.archived)paths.add(item.folder||'');
 for(const path of [...paths]){const parts=path.split('/');for(let i=1;i<=parts.length;i++)paths.add(parts.slice(0,i).join('/'))}
 return [...paths].filter(Boolean).sort();
}
function prepareLibraryFolderIds(next,previous=assetIndex){
 const given=next.folderIds||{},old=previous.folderIds||{};
 next.folderIds=Object.fromEntries(libraryFolderPaths(next).map(path=>[path,given[path]||old[path]||uid()]));
 return next.folderIds;
}
function moveLibraryFolderIds(next,old,destination){
 const ids={...next.folderIds};
 for(const path of Object.keys(ids))if(path===old||path.startsWith(old+'/')){
  const identity=ids[path];delete ids[path];ids[destination+path.slice(old.length)]=identity;
 }
 next.folderIds=ids;
}
function libraryFolderTarget(path=assetFolder){return {path,id:assetIndex.folderIds?.[path]||''}}
function libraryFolderLocation(target,catalog=assetIndex){
 if(!target.id)return target.path&&libraryFolderPaths(catalog).includes(target.path)?target.path:'';
 return Object.entries(catalog.folderIds||{}).find(([,id])=>id===target.id)?.[0]??'';
}
function syncLibraryFolderNavigation(previous,next){
 const paths=new Set(libraryFolderPaths(next)),locations=new Map(Object.entries(next.folderIds||{}).map(([path,id])=>[id,path]));
 const locate=path=>{if(!path)return '';const id=previous.folderIds?.[path];return id?(locations.get(id)??''):(paths.has(path)?path:'')};
 assetFolder=locate(assetFolder);assetFolderPick=locate(assetFolderPick)||null;
 const expanded=[...assetExpanded].map(locate).filter(Boolean);assetExpanded.clear();expanded.forEach(path=>assetExpanded.add(path));
 const parts=assetFolder.split('/').filter(Boolean);for(let i=1;i<=parts.length;i++)assetExpanded.add(parts.slice(0,i).join('/'));
 const live=new Set(next.assets.filter(a=>!a.archived).map(a=>a.id));assetSelected=new Set([...assetSelected].filter(id=>live.has(id)));
}
function selectLibraryImports(added,target,startedAt){
 // Navigation during an upload is intentional; do not pull the user back.
 const location=libraryFolderLocation(target),current=libraryFolderTarget(assetFolder);
 if(assetFolder!==startedAt&&current.id!==target.id)return;
 enterAssetFolder(location);assetSelected=new Set(added.filter(a=>!assetById(a.id)?.archived&&assetById(a.id)?.folder===location).map(a=>a.id));
 renderAssets();$('assetPane').focus({preventScroll:true});
}
