import {BoardTransport, BoardError} from './board-transport.js';
import {BoardDrafts, checkRaw} from './board-drafts.js';

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
   Conflicting inputs remain separate. This does not perform collaborative merges. */
export class BoardSession extends EventTarget {
  #transport; #drafts; #status = 'idle'; #raw = ''; #confirmed = ''; #etag = null;
  #revision = 0; #pending = null; #access = null; #message = ''; #conflict = null;
  #local = 'none'; #localError = ''; #role = null; #localTail = Promise.resolve();
  #channel=null;

  constructor(scope) {
    super(); this.#transport = new BoardTransport(scope); this.#drafts = new BoardDrafts(this.#transport.scope);
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
      local: this.#local, localError: this.#localError, message: this.#message, conflict: this.#conflict});
  }
  #emit() { if (this.#status !== 'closed') this.dispatchEvent(new CustomEvent('change', {detail: this.state})); }
  #pause(error) { if (this.#status !== 'closed') { this.#status = 'paused'; this.#message = error.message; this.#emit(); } }

  async open(newRaw) {
    if (this.#status !== 'idle') throw new Error('这个白板页面已固定，不能重新指定内容。');
    this.#status = 'loading'; this.#emit();
    try {
      await this.#transport.assertIdentity();
      const workspace = await this.#transport.workspace();
      let raw, etag;
      if (newRaw === undefined) {
        const result = await this.#transport.read();
        raw = JSON.stringify(result.value, null, 2); checkRaw(raw); etag = result.etag;
      } else {
        checkRaw(newRaw);
        if (workspace.role === 'viewer') throw new BoardError('只有阅读权限，无法创建白板。', 403);
        raw = newRaw; etag = 'new';
      }
      if (this.#status !== 'loading') return this.state;
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
    checkRaw(raw);
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
      const result = await this.#transport.save(snapshot.raw, snapshot.baseETag);
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
        currentETag: error.details?.currentETag || null});
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
