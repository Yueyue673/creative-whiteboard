import {ArchiveTransport} from './archive-transport.js';

const $=id=>document.getElementById(id),contextElement=$('board-context')||$('portal-context');
const context=contextElement?JSON.parse(contextElement.textContent):null;
if(context?.account?.id&&context.workspace&&$('workspaceArchiveDialog'))initialise(context);

function initialise(context){
  const transport=new ArchiveTransport({account:context.account.id,workspace:context.workspace}),dialog=$('workspaceArchiveDialog');
  let view='history',records=[],selected=null,busy=false,role=null,epoch=0,reviewValid=false,recordState='idle',cleanupPlan=null,cleanupEpoch=0,applicationPlan=null;
  const cleanupDialog=$('archiveCleanupDialog'),formatBytes=bytes=>bytes>=1024*1024?(bytes/1024/1024).toLocaleString('zh-CN',{maximumFractionDigits:2})+' MiB':bytes>=1024?(bytes/1024).toLocaleString('zh-CN',{maximumFractionDigits:2})+' KiB':bytes.toLocaleString()+' 字节';
  const labels={board:'白板',folders:'分类目录',library:'资料库目录'},stamp=value=>new Date(value*1000).toLocaleString('zh-CN',{hour12:false});
  const message=text=>{$('archiveState').textContent=text;};
  const el=(tag,text,className)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(className)item.className=className;return item;};
  function controls(){
    $('showWorkspaceArchive').disabled=busy;$('refreshArchive').disabled=busy;$('archiveBoard').disabled=busy;$('archiveKind').disabled=busy;
    for(const button of document.querySelectorAll('[data-archive-view]'))button.disabled=busy;
    for(const button of $('archiveRecords').querySelectorAll('button'))button.disabled=busy;
    $('exportArchive').disabled=!selected||(busy&&selected.source!=='conflict');
    $('ackArchiveRestore').disabled=busy||!reviewValid||selected?.source!=='trash'||role==='viewer';
    $('restoreArchive').disabled=busy||!reviewValid||selected?.source!=='trash'||role==='viewer'||!$('ackArchiveRestore').checked;
    $('ackConflictRemoval').disabled=busy||!reviewValid||selected?.source!=='conflict'||!['owner','editor'].includes(role);
    $('removeConflict').disabled=$('ackConflictRemoval').disabled||!$('ackConflictRemoval').checked;
    $('cancelConflictRemoval').disabled=busy;
    $('prepareVersionApplication').disabled=busy||selected?.source!=='history'||selected.deleted||(selected.kind??'board')!=='board'||!['owner','editor'].includes(role);
    $('ackVersionApplication').disabled=busy||!applicationPlan?.canApply||!applicationPlan?.changed||!['owner','editor'].includes(role);
    $('confirmVersionApplication').disabled=$('ackVersionApplication').disabled||!$('ackVersionApplication').checked;$('cancelVersionApplication').disabled=busy;
    $('archiveKeep').disabled=busy;$('previewArchiveCleanup').disabled=busy||role!=='owner'||!['history','trash'].includes(selected?.source);
    $('ackCleanup').disabled=busy||!cleanupPlan||role!=='owner'||cleanupPlan.removeRevisions===0;
    $('confirmCleanup').disabled=busy||!cleanupPlan||role!=='owner'||!$('ackCleanup').checked||cleanupPlan.removeRevisions===0;
  }
  function preview(){
    $('archiveEmpty').hidden=Boolean(selected);$('archiveSelected').hidden=!selected;
    if(!selected){$('archiveRaw').value='';$('archiveExcerpt').textContent='';$('archiveCleanupEntry').hidden=true;controls();return;}
    $('archiveTitle').textContent=selected.name||'未命名记录';
    $('archiveInfo').textContent=`${stamp(selected.savedAt)}${selected.revision?' · 版本 '+selected.revision:''}${selected.source==='conflict'?' · 只有你的原账号能查看这份提交':''}${selected.source==='trash'?' · 回收站中的保留内容':''}`;
    const value=JSON.parse(selected.raw),note=Array.isArray(value.nodes)?value.nodes.find(node=>node&&typeof node==='object'&&node.type==='note'&&(typeof node.body==='string'||typeof node.title==='string')):null;
    const catalog=selected.kind&&selected.kind!=='board';
    const excerpt=catalog&&Array.isArray(value.folders)?value.folders.slice(0,6).map(folder=>selected.kind==='folders'?folder?.name:folder).filter(name=>typeof name==='string').join('\n'):typeof note?.body==='string'?note.body:typeof note?.title==='string'?note.title:'';
    $('archiveExcerptLabel').textContent=catalog?`${labels[selected.kind]} · ${Array.isArray(value.folders)?value.folders.length:0} 个分类 · 名称节选（只读，完整内容在下方）`:Array.isArray(value.nodes)?`共 ${value.nodes.length} 个内容 · 便签节选（只读，完整内容在下方）`:'完整内容在下方';
    $('archiveExcerpt').textContent=excerpt.slice(0,600);$('archiveExcerpt').hidden=!excerpt;
    $('archiveRaw').value=selected.raw;$('openArchiveBoard').hidden=selected.kind&&selected.kind!=='board';
    $('openArchiveBoard').href=`/w/${encodeURIComponent(transport.scope.workspace)}/b/${encodeURIComponent(selected.key)}/`;
    $('archiveRestoreReview').hidden=selected.source!=='trash';$('archiveReadOnly').hidden=role!=='viewer';
    $('archiveConflictRemoval').hidden=selected.source!=='conflict';$('conflictRemovalReadOnly').hidden=role!=='viewer';
    $('archiveVersionEntry').hidden=selected.source!=='history'||selected.deleted||catalog;$('versionApplicationReadOnly').hidden=role!=='viewer';
    $('archiveCleanupEntry').hidden=role!=='owner'||!['history','trash'].includes(selected.source);
    $('archiveKeepLabel').hidden=selected.source!=='history';$('archiveCleanupLabel').textContent=selected.source==='trash'?'永久移除这张回收站白板':'检查旧版本占用';
    if(selected.source==='history'){
      const keep=$('archiveKeep'),prior=Number(keep.value),count=records.length;keep.replaceChildren();
      for(let i=1;i<=count;i++)keep.add(new Option('最新 '+i+' 个版本',String(i)));
      keep.value=String(Math.min(count,prior||5));
    }
    controls();
  }
  function render(){
    for(const button of document.querySelectorAll('[data-archive-view]'))button.setAttribute('aria-pressed',String(button.dataset.archiveView===view));
    $('archiveHistorySelectors').hidden=view!=='history';$('archiveBoardLabel').hidden=view!=='history'||$('archiveKind').value!=='board';$('archiveCatalogCaption').hidden=view!=='history'||$('archiveKind').value==='board';$('archiveCapacity').hidden=view!=='quota';$('archiveRecordLayout').hidden=view==='quota';
    const list=$('archiveRecords');list.replaceChildren();
    if(!records.length){
      const empty=recordState==='loading'?'记录仍在读取，请稍候。':recordState==='failed'?'列表尚未核对，请刷新后再检查。':view==='history'?($('archiveKind').value==='board'?'选择白板后查看保留版本。':'这份目录还没有服务器保存记录。'):view==='conflicts'?'这次没有读到未合入输入。':'这次读取的回收站没有白板。';
      list.append(el('p',empty,'archive-caption'));
    }
    for(const record of records){
      const button=el('button',undefined,'archive-row');button.type='button';button.setAttribute('aria-pressed',String(selected?.id===record.id));
      const title=view==='history'?`版本 ${record.revision}${record.deleted?' · 回收站状态':''}`:view==='conflicts'?`${labels[record.kind]} · ${record.key}`:record.name;
      const info=stamp(record.savedAt??record.createdAt)+(view==='history'&&record.name?' · '+record.name.slice(0,100):'');
      button.append(el('strong',title),el('small',info));button.onclick=()=>inspect(record);list.append(button);
    }
    preview();
  }
  function fail(error,token,text){
    if(token!==epoch)return;
    resetCleanup();records=[];recordState='failed';reviewValid=false;role=null;$('ackArchiveRestore').checked=false;$('archiveCapacity').replaceChildren();
    if(selected?.source!=='conflict')selected=null;
    const prior=$('archiveBoard').value; $('archiveBoard').replaceChildren(new Option('请重新核对原工作区白板',''));
    if(prior){const option=new Option('原选择尚未核对 · '+prior,prior);option.disabled=true;$('archiveBoard').add(option);$('archiveBoard').value=prior;}
    $('archiveAfterAction').hidden=true;
    message(text||`${error.message||'暂时无法核对工作区记录。'}${selected?' 你已经查看的自己的提交仍可导出。':''}`);render();
  }
  async function boardChoices(){
    const options=await transport.boards(),deleted=await transport.trash(),prior=$('archiveBoard').value||context.key||'';
    return {options,deleted,prior};
  }
  function applyBoardChoices({options,deleted,prior}){
    const select=$('archiveBoard');select.replaceChildren(new Option('请选择白板',''));
    const seen=new Set();for(const row of options){select.add(new Option(row.name.slice(0,120)||'未命名白板',row.id));seen.add(row.id);}
    for(const row of deleted)if(!seen.has(row.id)){select.add(new Option((row.name.slice(0,100)||'未命名白板')+' · 回收站',row.id));seen.add(row.id);}
    if(prior&&!seen.has(prior)){const option=new Option('原白板暂不在列表 · '+prior,prior);option.disabled=true;select.add(option);}
    select.value=prior;
  }
  function capacity(data){
    const format=formatBytes;
    const target=$('archiveCapacity');target.replaceChildren();
    function card(title,used,limit,breakdown,caption){
      const item=el('section',undefined,'archive-capacity-card');item.append(el('h3',title),el('strong',format(used)),el('p',`配置上限 ${format(limit)}${used>limit?' · 已超过当前配置上限':''}`));
      const meter=el('meter');meter.min=0;meter.max=Math.max(limit,used,1);meter.value=used;meter.setAttribute('aria-label',title+'占用');item.append(meter);
      const dl=el('dl');for(const [label,bytes]of breakdown){const line=el('div');line.append(el('dt',label),el('dd',format(bytes)));dl.append(line);}item.append(dl,el('p',caption));target.append(item);
    }
    const d=data.document,f=data.files;
    card('白板与说明',d.totalBytes,d.limitBytes,[['当前文档（含回收站）',d.currentBytes],['保留版本',d.historyBytes],['未合入输入',d.draftBytes],['素材说明',d.assetMetadataBytes]],'这是工作区记录的内容容量，不代表服务器磁盘总用量；未合入输入的具体内容仅原作者可查看。');
    card('这个工作区的原文件',f.workspaceBytes+f.workspacePendingBytes,f.workspaceLimitBytes,[['已经登记的素材',f.workspaceBytes],['等待确认的上传',f.workspacePendingBytes]],'上传等待确认时也计入容量；这页不自动清除任何文件。');
    card('你上传的原文件',f.accountUploadedBytes+f.accountPendingBytes,f.accountLimitBytes,[['所有工作区的已上传素材',f.accountUploadedBytes],['你等待确认的上传',f.accountPendingBytes],['单份文件上传上限',f.singleUploadLimitBytes]],'这一项只统计原账号自己的上传，和工作区容量分别核对。');
  }
  async function load(){
    if(busy)return;resetCleanup();const token=++epoch;busy=true;records=[];recordState='loading';reviewValid=false;$('ackArchiveRestore').checked=false;$('archiveAfterAction').hidden=true;
    if(selected?.source!=='conflict')selected=null;
    render();message('正在核对原账号与工作区，读取保存记录…');
    try{
      const space=await transport.access();let result,choices;
      if(view==='history'){const kind=$('archiveKind').value;if(kind==='board'){choices=await boardChoices();result=choices.prior?await transport.history(choices.prior):[];}else result=await transport.history('catalog',kind);}
      else if(view==='conflicts')result=await transport.conflicts();
      else if(view==='trash')result=await transport.trash();
      else result=await transport.quota();
      if(token!==epoch||!dialog.open)return;
      role=space.role;const finalSpace=await transport.access();if(token!==epoch||!dialog.open)return;role=finalSpace.role;
      if(choices)applyBoardChoices(choices);
      if(view==='quota'){capacity(result);message('已读取容量快照。数值会随其他设备保存与上传变化；没有清理内容。');}
      else{records=result;message(view==='history'?`找到 ${records.length} 个保留版本；选择后查看完整内容。`:view==='conflicts'?`找到 ${records.length} 份原账号未合入的提交；不会自动应用。`:`回收站有 ${records.length} 张白板；先核对内容再决定恢复。`);}
      recordState='ready';render();
    }catch(error){fail(error,token);}
    finally{busy=false;controls();}
  }
  async function inspect(record){
    if(busy)return;resetCleanup();const token=++epoch;busy=true;reviewValid=false;$('ackArchiveRestore').checked=false;$('archiveAfterAction').hidden=true;controls();message('正在读取这份具体记录，并再次核对访问权限…');
    try{
      const result=view==='history'?await transport.revision(record.key,record.id,record.kind):view==='trash'?await transport.inspectTrash(record):await transport.conflict(record.id);
      const space=await transport.access();if(token!==epoch||!dialog.open)return;selected=result;role=space.role;reviewValid=['trash','conflict'].includes(selected.source);$('archiveRawDetails').open=false;render();
      message(selected.source==='trash'?'已核对回收站中的具体内容。恢复前请确认，当前编辑页不会被替换。':selected.source==='conflict'?'这是你当时提交但未合入的内容，不包含后来继续输入的部分；浏览器副本请到“浏览器输入”检查。':selected.kind!=='board'?'已读取这份目录保存的完整内容。可导出；清理旧记录不会替换当前目录或移除原文件。':'已读取所选保留版本。查看与导出不会替换当前白板。');
      $('archiveSelected').scrollIntoView({block:'nearest'});
    }catch(error){fail(error,token);}
    finally{busy=false;controls();}
  }
  function resetCleanup(){
    ++cleanupEpoch;cleanupPlan=null;$('ackCleanup').checked=false;$('ackConflictRemoval').checked=false;cleanupDialog.close();
    applicationPlan=null;$('ackVersionApplication').checked=false;$('versionApplicationReview').hidden=true;$('applicationCurrentRaw').value='';$('applicationSourceRaw').value='';
    $('cleanupRetained').replaceChildren();$('cleanupRemoved').replaceChildren();controls();
  }
  function cleanupVersions(target,rows){
    target.replaceChildren();
    if(!rows.length){target.append(el('p','没有版本在这一列。','archive-caption'));return;}
    for(const row of rows){const item=el('div',undefined,'cleanup-version');item.append(el('strong',`版本 ${row.revision}${row.deleted?' · 回收站状态':''}`),el('small',stamp(row.savedAt)),el('span',row.name));target.append(item);}
  }
  async function prepareCleanup(){
    if(busy||role!=='owner'||!selected)return;
    resetCleanup();const reviewed=selected,token=epoch,ct=cleanupEpoch,keep=Number($('archiveKeep').value);busy=true;controls();message('正在核对具体版本与清理范围；尚未移除内容…');
    try{
      const plan=await transport.prepareCleanup(reviewed,keep);
      if(token!==epoch||ct!==cleanupEpoch||!dialog.open||selected!==reviewed)return;
      cleanupPlan=plan;role='owner';$('cleanupHeading').textContent=plan.action==='discard_board'?'永久移除这张白板？':'永久移除这些旧版本？';
      cleanupDialog.dataset.action=plan.action;$('cleanupRetained').parentElement.hidden=plan.action==='discard_board';
      $('cleanupTarget').textContent=(plan.kind==='board'?plan.name:labels[plan.kind])+' · 原编号 '+plan.key;$('cleanupWarning').textContent=plan.warning;
      $('cleanupRemoveCount').textContent=String(plan.removeRevisions);$('cleanupKeepCount').textContent=String(plan.keepRevisions);$('cleanupBytes').textContent=formatBytes(plan.reclaimPayloadBytes);
      cleanupVersions($('cleanupRetained'),plan.retainVersions);cleanupVersions($('cleanupRemoved'),plan.removeVersions);
      $('cleanupState').textContent=plan.removeRevisions?'预览已核对。确认前会再次检查；其他设备保存了新内容时，本次范围失效。':'所选范围没有可移除的旧版本，可以直接关闭。';
      $('confirmCleanup').textContent=plan.action==='discard_board'?'永久移除白板及其历史':'永久移除 '+plan.removeRevisions+' 个旧版本';
      cleanupDialog.showModal();cleanupDialog.scrollTop=0;
      (cleanupDialog.scrollHeight>cleanupDialog.clientHeight?$('cleanupHeading'):$('cancelCleanup')).focus({preventScroll:true});
      message('清理预览已打开；还没有移除任何记录。');
    }catch(error){if(token===epoch&&ct===cleanupEpoch)fail(error,token);}
    finally{busy=false;controls();}
  }
  async function confirmCleanup(){
    if(busy||!cleanupPlan||role!=='owner'||!$('ackCleanup').checked||!cleanupPlan.removeRevisions)return;
    const reviewed=cleanupPlan,token=epoch,ct=cleanupEpoch;busy=true;$('ackCleanup').checked=false;controls();
    $('cleanupState').textContent='正在再次核对原账号、原保存内容与版本范围…';let accepted=false;
    try{
      const result=await transport.cleanup(reviewed,()=>token===epoch&&ct===cleanupEpoch&&dialog.open&&cleanupDialog.open&&cleanupPlan===reviewed);
      accepted=result.cleaned;
      if(token!==epoch||ct!==cleanupEpoch||!dialog.open||!cleanupDialog.open)return;
      // Erase the one-shot approval before refreshing any subsequent snapshot.
      resetCleanup();selected=null;records=[];recordState='loading';render();
      records=view==='history'?await transport.history(reviewed.key,reviewed.kind):await transport.trash();
      if(token!==epoch||!dialog.open)return;recordState='ready';render();
      message(`服务器已确认${reviewed.action==='discard_board'?'永久移除这张回收站白板及其历史':'永久移除 '+result.removeRevisions+' 个旧版本'}，记录列表已刷新。当前页面输入、原文件和成员未合入输入保持原样；最新容量请到“容量”刷新查看。`);
    }catch(error){
      if(token!==epoch||(!accepted&&ct!==cleanupEpoch)||!dialog.open)return;
      if(error.code==='cancelled'){message(error.message);return;}
      fail(error,token,accepted?'服务器已确认永久移除，但列表暂未刷新成功，请刷新检查；未重复提交。':error.message);
    }finally{busy=false;controls();}
  }
  async function restore(){
    if(busy||!reviewValid||selected?.source!=='trash'||!$('ackArchiveRestore').checked)return;
    const reviewed=selected,token=++epoch;busy=true;reviewValid=false;$('ackArchiveRestore').checked=false;controls();let accepted=false;
    message('正在按这份已核对的回收站版本恢复原白板…');
    try{
      const result=await transport.restore(reviewed);accepted=result.restored;
      const fresh=await transport.trash();if(token!==epoch||!dialog.open)return;
      selected=null;records=fresh;recordState='ready';render();message(result.verified?'原白板已恢复，完整内容已核对。请在新页面打开，当前编辑页保持原样。':'服务器已接受恢复，但白板随后又有变化，请在新页面检查；未继续覆盖。');
      $('archiveAfterAction').href=`/w/${encodeURIComponent(transport.scope.workspace)}/b/${encodeURIComponent(reviewed.key)}/`;
      $('archiveAfterAction').textContent=result.verified?'在新页面打开已恢复的白板 ↗':'在新页面核对这张白板 ↗';$('archiveAfterAction').hidden=false;
      window.dispatchEvent(new CustomEvent('creative-archive-restored',{detail:{account:transport.scope.account,workspace:transport.scope.workspace,key:reviewed.key}}));
    }catch(error){fail(error,token,accepted?'服务器已接受恢复，但列表暂未确认，请刷新后检查；未重复提交。':error.message);}
    finally{busy=false;controls();}
  }
  async function removeConflict(){
    if(busy||!reviewValid||selected?.source!=='conflict'||!['owner','editor'].includes(role)||!$('ackConflictRemoval').checked)return;
    const reviewed=selected,token=++epoch;busy=true;reviewValid=false;$('ackConflictRemoval').checked=false;controls();
    message('正在重新核对原账号的这份提交；当前白板与浏览器输入保持原样…');
    try{
      const result=await transport.removeConflict(reviewed,()=>token===epoch&&dialog.open&&selected===reviewed&&view==='conflicts');
      if(token!==epoch||!dialog.open)return;
      records=result.records;recordState='ready';render();message('这份服务器记录已移除，列表已核对。刚才查看的原文仍可导出；当前白板与浏览器输入保留。');
    }catch(error){fail(error,token,error.message);}
    finally{busy=false;controls();}
  }
  async function prepareVersion(){
    if(busy||selected?.source!=='history'||selected.deleted||selected.kind!=='board'||!['owner','editor'].includes(role))return;
    resetCleanup();const reviewed=selected,token=epoch;busy=true;controls();message('正在对照原白板的当前内容与所选版本；尚未取回…');
    try{
      const plan=await transport.prepareApplication(reviewed);if(token!==epoch||!dialog.open||selected!==reviewed)return;
      applicationPlan=plan;$('applicationCurrentName').textContent=plan.currentName;$('applicationCurrentVersion').textContent='版本 '+plan.currentRevision;$('applicationCurrentRaw').value=plan.currentRaw;
      $('applicationSourceName').textContent=plan.sourceName;$('applicationSourceVersion').textContent='版本 '+plan.sourceRevision+' · '+stamp(plan.sourceSavedAt);
      const excerpt=text=>{const node=JSON.parse(text).nodes.find(n=>n.type==='note'&&(typeof n.body==='string'||typeof n.title==='string')),words=typeof node?.body==='string'?node.body:typeof node?.title==='string'?node.title:'';return words?words.slice(0,240):'没有便签文字，可展开核对完整内容。'};
      $('applicationCurrentExcerpt').textContent=excerpt(plan.currentRaw);$('applicationSourceExcerpt').textContent=excerpt(reviewed.raw);$('applicationSourceRaw').value=reviewed.raw;
      $('applicationAvailability').textContent=!plan.canApply?plan.blockedReason:!plan.changed?'这个版本与现在保存的内容相同，无需取回。':`会新增一条保存记录，现有 ${plan.retainedVersions} 个版本继续保留。正在编辑的页面和未合入输入保持原样。`;
      $('versionApplicationReview').hidden=false;message(plan.canApply&&plan.changed?'范围已核对；请先对照完整内容，再决定是否取回。':$('applicationAvailability').textContent);
      $('versionApplicationHeading').scrollIntoView({block:'nearest'});
    }catch(error){fail(error,token,error.message);}
    finally{busy=false;controls();}
  }
  async function applyVersion(){
    if(busy||!applicationPlan?.canApply||!applicationPlan.changed||!$('ackVersionApplication').checked||!['owner','editor'].includes(role))return;
    const reviewed=selected,plan=applicationPlan,token=++epoch;busy=true;applicationPlan=null;$('ackVersionApplication').checked=false;controls();message('正在再次核对并保存取回结果；当前编辑页保持原样…');let accepted=false;
    try{
      const result=await transport.applyVersion(reviewed,plan,()=>token===epoch&&dialog.open&&selected===reviewed&&view==='history');accepted=result.applied;
      const fresh=await transport.history(reviewed.key);if(token!==epoch||!dialog.open)return;
      selected=null;records=fresh;recordState='ready';render();message(result.verified?`已取回并保存为版本 ${result.revision}，完整内容已核对。当前页面的输入仍保留。`:'服务器已接受取回，但之后又有变化；请在新页面检查，未继续覆盖。');
      $('archiveAfterAction').href=`/w/${encodeURIComponent(transport.scope.workspace)}/b/${encodeURIComponent(reviewed.key)}/`;$('archiveAfterAction').textContent='在新页面核对取回后的白板 ↗';$('archiveAfterAction').hidden=false;
    }catch(error){fail(error,token,accepted?'服务器已接受取回，但列表暂未确认；请刷新检查，未重复提交。':error.message);}
    finally{busy=false;controls();}
  }
  function download(snapshot){
    const url=URL.createObjectURL(new Blob([snapshot.raw],{type:'application/json;charset=utf-8'})),link=el('a');link.href=url;link.download=(snapshot.name.replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,80)||'whiteboard')+'-保存内容.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('已发起这份内容的导出，请核对浏览器下载结果。');
  }
  async function exportSelected(){
    if(!selected)return;const snapshot=selected;
    if(snapshot.source==='conflict'){download(snapshot);return;}
    if(busy)return;const token=epoch;busy=true;controls();
    try{await transport.access();if(token===epoch&&dialog.open&&selected===snapshot)download(snapshot);}catch(error){fail(error,token);}finally{busy=false;controls();}
  }
  function close(){++epoch;resetCleanup();reviewValid=false;$('ackArchiveRestore').checked=false;dialog.close();}
  $('showWorkspaceArchive').hidden=false;$('showWorkspaceArchive').onclick=()=>{if(busy)return;dialog.showModal();load();};
  $('closeArchive').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});$('refreshArchive').onclick=load;
  $('archiveBoard').onchange=()=>{selected=null;load();};
  $('archiveKind').onchange=()=>{if(busy)return;selected=null;load();};
  for(const button of document.querySelectorAll('[data-archive-view]'))button.onclick=()=>{if(busy)return;view=button.dataset.archiveView;selected=null;load();};
  $('ackArchiveRestore').onchange=controls;$('restoreArchive').onclick=restore;$('exportArchive').onclick=exportSelected;
  $('ackConflictRemoval').onchange=controls;$('removeConflict').onclick=removeConflict;$('cancelConflictRemoval').onclick=()=>{$('ackConflictRemoval').checked=false;controls();message('已选择保留这份记录，没有发送移除请求。');$('exportArchive').focus({preventScroll:true})};
  $('prepareVersionApplication').onclick=prepareVersion;$('ackVersionApplication').onchange=controls;$('confirmVersionApplication').onclick=applyVersion;
  $('cancelVersionApplication').onclick=()=>{resetCleanup();message('已选择保留现在的内容，没有发送取回保存。');$('prepareVersionApplication').focus({preventScroll:true})};
  $('previewArchiveCleanup').onclick=prepareCleanup;$('ackCleanup').onchange=controls;$('confirmCleanup').onclick=confirmCleanup;
  function cancelCleanup(){resetCleanup();message(busy?'预览已关闭。已发送的请求不会被撤回，请等操作结束后刷新核对。':'已取消清理，记录保留。');}
  $('closeCleanup').onclick=cancelCleanup;$('cancelCleanup').onclick=cancelCleanup;cleanupDialog.addEventListener('cancel',event=>{event.preventDefault();cancelCleanup();});
  cleanupDialog.addEventListener('close',()=>{if(!cleanupDialog.open&&cleanupPlan)resetCleanup();});
  async function recheck(){if(!dialog.open||busy)return;const token=epoch;try{const space=await transport.access();if(token===epoch){role=space.role;if(role!=='owner'&&cleanupDialog.open)cancelCleanup();if(!['owner','editor'].includes(role)&&applicationPlan){resetCleanup();message('权限已变化，取回确认已取消。原文仍可查看和导出。')}preview();}}catch(error){fail(error,token);}}
  window.addEventListener('focus',recheck);window.addEventListener('pageshow',recheck);document.addEventListener('visibilitychange',()=>{if(!document.hidden)recheck();});
  try{const channel=new BroadcastChannel('creative-account-session');channel.onmessage=recheck;}catch{}
}
