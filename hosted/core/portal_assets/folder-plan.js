// Pure, immutable directory operations. A target is always a stable ID.
const ID=/^[A-Za-z0-9_-]{1,100}$/;
const pathOK=p=>typeof p==='string'&&p.length<=1000&&!p.includes('\\')&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
const under=(p,root)=>p===root||p.startsWith(root+'/');
const order=(a,b)=>a<b?-1:a>b?1:0;

export function folderCatalog(value){
  if(!value||value.version!==1||!Array.isArray(value.assets)||value.assets.length||
     !Array.isArray(value.folders)||value.folders.length>1000||new Set(value.folders).size!==value.folders.length||
     !value.folderIds||typeof value.folderIds!=='object'||Array.isArray(value.folderIds)||
     Object.keys(value).some(k=>!['version','folders','folderIds','assets'].includes(k)))throw Error('目录格式无法核对，请保留输入。');
  const paths=new Set();
  for(const path of value.folders){
    if(!pathOK(path))throw Error('目录路径无法核对。');
    const parts=path.split('/');for(let i=1;i<=parts.length;i++)paths.add(parts.slice(0,i).join('/'));
  }
  const entries=Object.entries(value.folderIds),ids=new Set();
  if(paths.size>1000||entries.length!==paths.size)throw Error('目录数量或位置编号无法核对。');
  for(const [path,id] of entries){
    if(!paths.has(path)||typeof id!=='string'||!ID.test(id)||ids.has(id))throw Error('目录位置编号无法核对。');ids.add(id);
  }
  return {version:1,folders:[...paths].sort(order),folderIds:Object.fromEntries(entries.sort((a,b)=>order(a[0],b[0]))),assets:[]};
}
export const folderEntries=value=>Object.entries(folderCatalog(value).folderIds).map(([name,id])=>({name,id}));

export function planFolder(catalog,input,newId){
  const base=folderCatalog(catalog),entries=Object.entries(base.folderIds);
  if(!input||!['create','rename','remove'].includes(input.kind)||typeof input.target!=='string')throw Error('请选择目录操作。');
  const target=input.target?entries.find(([_,id])=>id===input.target)?.[0]:'';
  if(input.target&&target===undefined)throw Error('原目录已不存在，请明确选择其他目录。');
  if(input.kind!=='create'&&!input.target)throw Error('请选择一个目录，根目录不能改名或移除。');
  if(input.kind!=='remove'&&(typeof input.name!=='string'||!input.name.trim()||input.name.length>1000||
     /[/\\\r\n]/.test(input.name)||['.','..'].includes(input.name)))throw Error('请填写一个目录名称，不含斜杠或换行；内容不会自动修剪。');
  let next,changes;
  if(input.kind==='create'){
    const path=target?target+'/'+input.name:input.name;
    if(typeof newId!=='string'||!ID.test(newId)||entries.some(([_,id])=>id===newId))throw Error('新目录编号无效。');
    if(entries.some(([p])=>p===path))throw Error('这个位置已有同名目录，请换一个名称。');
    next=[...entries,[path,newId]];changes=[{before:null,after:path,id:newId}];
  }else if(input.kind==='rename'){
    const parent=target.includes('/')?target.slice(0,target.lastIndexOf('/')):'';
    const replacement=parent?parent+'/'+input.name:input.name;
    if(replacement===target)throw Error('名称没有变化，请修改后再核对。');
    changes=entries.filter(([p])=>under(p,target)).map(([p,id])=>({before:p,after:replacement+p.slice(target.length),id}));
    next=entries.map(([p,id])=>[under(p,target)?replacement+p.slice(target.length):p,id]);
  }else{
    changes=entries.filter(([p])=>under(p,target)).map(([p,id])=>({before:p,after:null,id}));
    next=entries.filter(([p])=>!under(p,target));
  }
  if(new Set(next.map(([p])=>p)).size!==next.length)throw Error('会与已有目录重名，本次操作尚未保存。');
  const value=folderCatalog({version:1,folders:next.map(([p])=>p),folderIds:Object.fromEntries(next),assets:[]});
  return {value,changes,input:structuredClone(input)};
}
