import {BoardTransport, BoardError} from './board-transport.js';
import {BoardDrafts, checkRaw} from './board-drafts.js';
import {boardRaw, reconcileValues, validateLiveBoard} from './board-reconciliation.js';

/* Workspace recovery remains reachable when a board has been deleted. Every
   read requires the original account's current membership, not a local index. */
export async function recoverWorkspaceDrafts({account, workspace}) {
  const transport = new BoardTransport({account, workspace, key: '_recovery'});
  const drafts = new BoardDrafts(transport.scope);
  try {
    await transport.assertIdentity(); await transport.workspace();
    const rows = await drafts.listWorkspace();
    await transport.assertIdentity(); await transport.workspace();
    return rows;
  } finally { await drafts.close(); }
}

/* The editor can change content, never this session's account/workspace/board.
   Optional reconciliation adopts a checked complete result before another save.
   Overlapping originals remain separate; no character-level merge is attempted. */
export class BoardSession extends EventTarget {
  #transport; #drafts; #status = 'idle'; #raw = ''; #confirmed = ''; #etag = null;
  #revision = 0; #pending = null; #access = null; #message = ''; #conflict = null;
  #local = 'none'; #localError = ''; #role = null; #localTail = Promise.resolve();
  #channel=null;
  #collaborative=false; #adopt; #canReceive; #waitAdoption; #sync=null; #liveMessage='';

  constructor(scope, options={}) {
    super(); this.#transport = new BoardTransport(scope); this.#drafts = new BoardDrafts(this.#transport.scope);
    this.#collaborative=options.reconcile===true;this.#adopt=options.onAdopt;this.#canReceive=options.canReceive||(()=>true);this.#waitAdoption=options.waitForAdoption||(()=>Promise.resolve());
    try{
      this.#channel=new BroadcastChannel('creative-board-local-input');
      this.#channel.onmessage=event=>{
        const message=event.data;
        if(message?.type==='removed'&&message.id===this.#drafts.id&&message.revision===this.#revision&&this.#status!=='closed'){
          this.#local='none';this.#localError='这份浏览器副本已由你在恢复界面移除；原文仍在页面，继续修改会生成新的副本。';this.#emit();
        }
      };
    }catch{}
  }
  get scope() { return this.#transport.scope; }
  get state() {
    return Object.freeze({scope: this.scope, status: this.#status, raw: this.#raw,
      etag: this.#etag, dirty: this.#raw !== this.#confirmed, saving: Boolean(this.#pending), role: this.#role,
      local: this.#local, localError: this.#localError, message: this.#message, conflict: this.#conflict, liveMessage:this.#liveMessage});
  }
  #emit() { if (this.#status !== 'closed') this.dispatchEvent(new CustomEvent('change', {detail: this.state})); }
  #pause(error) { if (this.#status !== 'closed') { this.#status = 'paused'; this.#message = error.message; this.#emit(); } }

  async open(newRaw) {
    if (this.#status !== 'idle') throw new Error('这个白板页面已固定，不能重新指定内容。');
    this.#status = 'loading'; this.#emit();
    try {
      await this.#transport.assertIdentity();
      let workspace = await this.#transport.workspace();
      let raw, etag;
      if (newRaw === undefined) {
        const result = await this.#transport.read();
        if(this.#collaborative){try{validateLiveBoard(result.value,result.originalRaw);}catch(error){this.#raw=result.originalRaw;throw error;}}
        raw = this.#collaborative?boardRaw(result.value):JSON.stringify(result.value, null, 2); checkRaw(raw); etag = result.etag;
      } else {
        const value=checkRaw(newRaw);
        if(this.#collaborative)newRaw=boardRaw(validateLiveBoard(value,newRaw));
        if (workspace.role === 'viewer') throw new BoardError('只有阅读权限，无法创建白板。', 403);
        raw = newRaw; etag = 'new';
      }
      if (this.#status !== 'loading') return this.state;
      if(this.#collaborative&&newRaw===undefined){await this.#transport.assertIdentity();workspace=await this.#transport.workspace();if(this.#status!=='loading')return this.state;}
      this.#role = workspace.role; this.#raw = raw; this.#etag = etag;
      this.#confirmed = newRaw === undefined ? raw : ''; this.#revision = 1;
      this.#status = workspace.role === 'viewer' ? 'readonly' : 'ready'; this.#emit();
      if (newRaw !== undefined) await this.#persist();
    } catch (error) { this.#pause(error); throw error; }
    return this.state;
  }

  #snapshot() { return Object.freeze({raw: this.#raw, revision: this.#revision, baseETag: this.#etag}); }
  #persist() {
    const snapshot = this.#snapshot();
    this.#local = 'pending'; this.#localError = ''; this.#emit();
    const task = this.#localTail.then(async () => {
      // Coalesce queued typing without redirecting or dropping the newest input.
      if (snapshot.revision !== this.#revision || this.#status === 'closed') return;
      try {
        await this.#drafts.write(snapshot);
        if (snapshot.revision === this.#revision) { this.#local = 'stored'; this.#localError = ''; }
      } catch (error) {
        if (snapshot.revision === this.#revision) { this.#local = 'error'; this.#localError = error.message; }
      }
      this.#emit();
    });
    this.#localTail = task.catch(() => {});
    return task;
  }

  updateRaw(raw) {
    if (!['ready', 'offline', 'conflict'].includes(this.#status)) throw new Error('当前页面不能修改；已有输入仍可导出。');
    const value=checkRaw(raw);
    if(this.#collaborative)raw=boardRaw(validateLiveBoard(value,raw));
    if (raw === this.#raw) return this.#localTail;
    this.#raw = raw; this.#revision++; this.#emit();
    return this.#persist();
  }

  save() {
    if (this.#pending) return this.#pending;
    if (!['ready', 'offline'].includes(this.#status)) return Promise.reject(new Error('当前页面已停止保存；请先保留输入并检查状态。'));
    if (this.#raw === this.#confirmed) return Promise.resolve({saved: true, unchanged: true, remainingDirty: false});
    const snapshot = this.#snapshot();
    // Begin on a later microtask so the pending guard exists even for a fast response.
    const pending = Promise.resolve().then(() => this.#saveSnapshot(snapshot));
    this.#pending = pending; this.#emit();
    pending.finally(() => { if (this.#pending === pending) this.#pending = null; this.#emit(); }).catch(() => {});
    return pending;
  }

  async #saveSnapshot(snapshot) {
    await this.#localTail;
    if (!['ready', 'offline'].includes(this.#status)) throw new Error('页面已暂停，未发出新的保存请求。');
    try {
      const result = await (this.#collaborative&&snapshot.baseETag!=='new'?this.#transport.reconcile(snapshot.raw,snapshot.baseETag):this.#transport.save(snapshot.raw, snapshot.baseETag));
      if(this.#collaborative&&snapshot.baseETag!=='new')return await this.#acceptReconciliation(result,snapshot);
      this.#etag = result.etag; this.#confirmed = snapshot.raw;
      if (this.#status === 'closed' || this.#status === 'paused' || this.#status === 'readonly')
        return {saved: true, remainingDirty: this.#raw !== this.#confirmed};
      this.#status = 'ready'; this.#message = ''; this.#conflict = null;
      if (this.#raw !== this.#confirmed) await this.#persist();
      else {
        try {
          await this.#drafts.removeConfirmed(snapshot);
          if (this.#revision === snapshot.revision) { this.#local = 'none'; this.#localError = ''; }
        } catch (error) {
          if (this.#revision === snapshot.revision) { this.#local = 'error'; this.#localError = error.message; }
        }
      }
      this.#emit(); return {saved: true, remainingDirty: this.#raw !== this.#confirmed};
    } catch (error) {
      if (!['closed', 'paused', 'readonly'].includes(this.#status)) await this.#saveFailure(error, snapshot);
      throw error;
    }
  }

  async #acceptReconciliation(result,snapshot){
    const canonical=boardRaw(result.value.board);checkRaw(canonical);
    if(['closed','paused','readonly'].includes(this.#status))return {saved:true,adopted:false,remainingDirty:true};
    await this.#waitAdoption();
    if(['closed','paused','readonly'].includes(this.#status))return {saved:true,adopted:false,remainingDirty:true};
    try{
      await this.#transport.assertIdentity();const workspace=await this.#transport.workspace();
      if(['closed','paused','readonly'].includes(this.#status))return {saved:true,adopted:false,remainingDirty:true};
      if(workspace.role==='viewer'){this.#role='viewer';this.#status='readonly';throw new Error('工作区现为只读。');}
      this.#role=workspace.role;
    }catch(error){if(this.#status!=='closed'){this.#status=this.#status==='readonly'?'readonly':'paused';this.#message='服务器已接受刚才这次输入，但当前账号或权限未重新核对；原输入仍可导出。';this.#emit();}return {saved:true,adopted:false,remainingDirty:true};}
    let next;
    try{
      next=this.#revision===snapshot.revision?canonical:boardRaw(validateLiveBoard(reconcileValues(JSON.parse(snapshot.raw),JSON.parse(this.#raw),result.value.board)));
      checkRaw(next);
      if(this.#adopt?.(next,{source:'saved',merged:result.value.merged})===false)throw new Error('编辑器还不能采用完整结果。');
    }catch(error){
      this.#status='conflict';this.#message='刚才这次已保存；后来输入与共同更新尚未合并，原输入仍保留。';
      this.#conflict=Object.freeze({code:'local_reconciliation_conflict',submittedRaw:this.#raw,draftSaved:false,draftId:null,currentETag:result.etag,accepted:true});
      await this.#persist();this.#emit();return {saved:true,adopted:false,remainingDirty:true};
    }
    const unchangedRevision=this.#revision===snapshot.revision;
    this.#raw=next;this.#etag=result.etag;this.#confirmed=canonical;this.#revision++;
    const adoptedRevision=this.#revision;
    this.#status='ready';this.#message='';this.#conflict=null;
    if(this.#raw!==this.#confirmed)await this.#persist();
    else try{await this.#drafts.removeConfirmed(snapshot);if(unchangedRevision&&this.#revision===adoptedRevision){this.#local='none';this.#localError='';}}catch(error){this.#localError=error.message;}
    this.#emit();return {saved:true,adopted:true,remainingDirty:this.#raw!==this.#confirmed};
  }

  syncRemote(){
    if(this.#sync)return this.#sync;
    if(!this.#collaborative||!['ready','readonly'].includes(this.#status)||this.#pending||this.#raw!==this.#confirmed||!this.#canReceive())return Promise.resolve({skipped:true});
    const snapshot=this.#snapshot();
    const task=Promise.resolve().then(async()=>{
      try{
        const result=await this.#transport.readLatest(snapshot.baseETag);
        if(['closed','paused','conflict','offline'].includes(this.#status))return {skipped:true};
        this.#role=result.role;
        if(result.role==='viewer'){this.#status='readonly';this.#message='工作区现为只读；未保存的输入仍可导出。';this.#emit();}
        if(this.#pending||snapshot.revision!==this.#revision||snapshot.baseETag!==this.#etag||this.#raw!==this.#confirmed)return {skipped:true};
        if(result.unchanged){this.#liveMessage='自动接收其他页面的更新';this.#emit();return result;}
        if(!this.#canReceive(result.value)){this.#liveMessage='有共同更新，结束当前操作后再显示。';this.#emit();return {deferred:true};}
        const raw=boardRaw(result.value);checkRaw(raw);
        if(this.#adopt?.(raw,{source:'remote'})===false)throw new Error('完整更新还不能采用。');
        this.#raw=raw;this.#confirmed=raw;this.#etag=result.etag;this.#revision++;
        this.#liveMessage='其他页面的更新已显示';this.#emit();return {changed:true};
      }catch(error){
        if(['closed','paused'].includes(this.#status))return {skipped:true};
        if(error.code==='account_changed'||[401,404,410].includes(error.status))this.#pause(error);
        else if(error.code==='protocol'||error instanceof Error&&error.code!=='offline'){this.#status='paused';this.#message=error.message+' 原输入保留，未采用这份更新。';this.#emit();}
        else{this.#liveMessage='暂时收不到其他页面的更新；原输入保留。';this.#emit();}
        return {received:false};
      }
    });
    this.#sync=task;task.finally(()=>{if(this.#sync===task)this.#sync=null;}).catch(()=>{});return task;
  }

  async #saveFailure(error, snapshot) {
    if (error.code === 'account_changed' || [401, 404, 410].includes(error.status)) { this.#pause(error); return; }
    if (error.code === 'offline') {
      // A connection failure proves neither logout nor continued permission.
      // An available session/ACL can still stop this page; no write is retried.
      await this.checkAccess();
      if (['closed', 'paused', 'readonly'].includes(this.#status)) return;
    }
    if (error.status === 403) {
      // A permission change and an expired CSRF token are different. Never
      // replace identity or retry a rejected mutation automatically.
      try {
        await this.#transport.assertIdentity();
        const workspace = await this.#transport.workspace();
        if (['closed', 'paused', 'readonly'].includes(this.#status)) return;
        this.#role = workspace.role;
        if (workspace.role === 'viewer') { this.#status = 'readonly'; this.#message = '工作区现为只读；未保存的输入仍可导出。'; this.#emit(); return; }
      } catch (accessError) {
        if (accessError.code === 'account_changed' || [401, 404].includes(accessError.status)) { this.#pause(accessError); return; }
      }
    }
    if (['closed', 'paused', 'readonly'].includes(this.#status)) return;
    if (error.status === 409 || error.code === 'protocol') {
      this.#status = 'conflict';
      this.#conflict = Object.freeze({code: error.code, submittedRaw: snapshot.raw,
        draftSaved: error.details?.draftSaved === true, draftId: error.details?.draftId || null,
        currentETag: error.details?.currentETag || null,accepted:error.details?.accepted===true});
    } else this.#status = error.code === 'offline' ? 'offline' : 'ready';
    this.#message = error.message; this.#emit();
  }

  checkAccess() {
    if (this.#access) return this.#access;
    if (['idle', 'loading', 'closed', 'paused'].includes(this.#status)) return Promise.resolve(this.state);
    const access = (async () => {
      try {
        await this.#transport.assertIdentity();
        const workspace = await this.#transport.workspace();
        if (['closed', 'paused'].includes(this.#status)) return this.state;
        this.#role = workspace.role;
        if (workspace.role === 'viewer') { this.#status = 'readonly'; this.#message = '工作区现为只读；未保存的输入仍可导出。'; this.#emit(); }
        // Restored permission does not silently restart an old stopped editor.
      } catch (error) {
        if (error.code === 'account_changed' || [401, 404].includes(error.status)) this.#pause(error);
      }
      return this.state;
    })();
    this.#access = access;
    access.finally(() => { if (this.#access === access) this.#access = null; }).catch(() => {});
    return access;
  }

  async recoverableDrafts() {
    if (['idle', 'loading', 'closed', 'paused'].includes(this.#status)) throw new Error('先在原账号和工作区打开白板，再检查浏览器副本。');
    // Local indices are not authorization. A fresh original-account ACL check
    // precedes every recovery list, even if a newer cookie can read this space.
    try { await this.#transport.assertIdentity(); await this.#transport.workspace(); }
    catch (error) { if (error.code === 'account_changed' || [401, 404].includes(error.status)) this.#pause(error); throw error; }
    if (['closed', 'paused'].includes(this.#status)) throw new Error('页面已暂停，未读取浏览器副本。');
    const rows = await this.#drafts.list();
    try { await this.#transport.assertIdentity(); await this.#transport.workspace(); }
    catch (error) { if (error.code === 'account_changed' || [401, 404].includes(error.status)) this.#pause(error); throw error; }
    if (['closed', 'paused'].includes(this.#status)) throw new Error('页面已暂停，未应用浏览器副本。');
    return rows;
  }

  exportRaw() { return this.#raw; }
  async close() { this.#status = 'closed';this.#channel?.close(); await this.#localTail; await this.#drafts.close(); }
}
