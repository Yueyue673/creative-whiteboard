import {boardScope, validETag} from './board-transport.js';

const DATABASE = 'creative-hosted-board-drafts-v1';
const VERSION = 1;
const MAX_RAW_BYTES = 8 * 1024 * 1024;
const MAX_ALL_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 128;
const encoder = new TextEncoder();

export class DraftError extends Error {
  constructor(message) { super(message); this.name = 'DraftError'; }
}

export function checkRaw(raw) {
  if (typeof raw !== 'string' || encoder.encode(raw).length > MAX_RAW_BYTES) throw new DraftError('这份输入过大，未写入浏览器副本。');
  let value;
  try { value = JSON.parse(raw); } catch { throw new DraftError('输入不是有效的白板 JSON。'); }
  if (!value || value.format !== 'creative-board' || value.version !== 1 || typeof value.name !== 'string' ||
      !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new DraftError('输入不是支持的白板格式。');
  const pending = [[value, 0]];
  while (pending.length) {
    const [item, depth] = pending.pop();
    if (depth > 64 || (typeof item === 'number' && !Number.isFinite(item))) throw new DraftError('输入含有无法保存的数字或过深的结构。');
    if (item && typeof item === 'object') for (const child of Object.values(item)) pending.push([child, depth + 1]);
  }
  return value;
}

/* A row belongs to a page, not just a board. One page never erases another's input.
   The browser can evict this store: it is recovery help, not a server backup. */
export class BoardDrafts {
  #scope; #scopeKey; #workspaceKey; #page; #id; #database = null; #opening = null; #tail = Promise.resolve(); #closed = false;
  constructor(scope) {
    this.#scope = boardScope(scope);
    this.#scopeKey = JSON.stringify([this.#scope.account, this.#scope.workspace, this.#scope.key]);
    this.#workspaceKey = JSON.stringify([this.#scope.account, this.#scope.workspace]);
    this.#page = crypto.randomUUID();
    this.#id = JSON.stringify([this.#scopeKey, this.#page]);
  }
  get id() { return this.#id; }
  get scope() { return this.#scope; }

  #open() {
    if (this.#closed) return Promise.reject(new DraftError('浏览器副本连接已关闭。'));
    if (this.#database) return Promise.resolve(this.#database);
    if (this.#opening) return this.#opening;
    const opening = new Promise((resolve, reject) => {
      let request, settled = false;
      const fail = message => { if (!settled) { settled = true; clearTimeout(timer); reject(new DraftError(message)); } };
      const timer = setTimeout(() => fail('浏览器副本仍无法打开；当前输入仍在页面，可以导出。'), 5000);
      try { request = indexedDB.open(DATABASE, VERSION); }
      catch { fail('浏览器不允许保存本地副本；请保留页面或导出输入。'); return; }
      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.createObjectStore('drafts', {keyPath: 'id'});
        store.createIndex('scope', 'scope');
        store.createIndex('workspaceScope', 'workspaceScope');
      };
      request.onblocked = () => fail('其他页面暂时阻止了浏览器副本升级；请保留当前页面并检查其他标签。');
      request.onerror = () => fail('无法打开浏览器副本；输入仍在页面，可以导出。');
      request.onsuccess = () => {
        const database = request.result;
        if (settled || this.#closed) { database.close(); return; }
        settled = true; clearTimeout(timer);
        database.onversionchange = () => { database.close(); if (this.#database === database) this.#database = null; };
        this.#database = database; resolve(database);
      };
    });
    this.#opening = opening;
    opening.finally(() => { if (this.#opening === opening) this.#opening = null; }).catch(() => {});
    return opening;
  }

  #enqueue(operation) {
    const task = this.#tail.then(operation);
    this.#tail = task.catch(() => {});
    return task;
  }

  #transaction(database, mode, operation) {
    return new Promise((resolve, reject) => {
      let result, failure, transaction;
      try { transaction = database.transaction('drafts', mode); }
      catch { reject(new DraftError('浏览器副本连接中断，输入仍在页面。')); return; }
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure || new DraftError('浏览器容量或写入失败，未确认本地保存；输入仍在页面，可以导出。'));
      transaction.onerror = () => { /* Abort is the final outcome; request success is not a commit. */ };
      const abort = error => { failure = error; try { transaction.abort(); } catch {} };
      try { operation(transaction.objectStore('drafts'), value => { result = value; }, abort); }
      catch (error) { abort(error); }
    });
  }

  write(snapshot) {
    checkRaw(snapshot.raw);
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 || !validETag(snapshot.baseETag, true)) throw new DraftError('浏览器副本版本无效。');
    const row = {id: this.#id, scope: this.#scopeKey, workspaceScope: this.#workspaceKey, key: this.#scope.key, page: this.#page, raw: snapshot.raw,
      baseETag: snapshot.baseETag, revision: snapshot.revision, updatedAt: Date.now()};
    return this.#enqueue(async () => {
      const database = await this.#open();
      return this.#transaction(database, 'readwrite', (store, done, abort) => {
        let count = 0, bytes = 0, own = null;
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (current) {
            const existing = current.value;
            if (existing.id === this.#id) own = existing;
            else { count++; bytes += encoder.encode(typeof existing.raw === 'string' ? existing.raw : '').length; }
            if (count >= MAX_ROWS || bytes > MAX_ALL_BYTES) { abort(new DraftError('浏览器副本已满；没有删除旧输入，请先导出或处理自己的副本。')); return; }
            current.continue(); return;
          }
          if (own && (own.scope !== this.#scopeKey || own.page !== this.#page || own.revision > row.revision)) {
            abort(new DraftError('已有更新的页面输入，旧副本未覆盖它。')); return;
          }
          if (count + 1 > MAX_ROWS || bytes + encoder.encode(row.raw).length > MAX_ALL_BYTES) {
            abort(new DraftError('浏览器副本已满；没有删除旧输入，请先导出或处理自己的副本。')); return;
          }
          store.put(row); done(true);
        };
      });
    });
  }

  /* Exact acknowledged input only; a later edit survives a delayed server reply. */
  removeConfirmed(snapshot) {
    return this.#enqueue(async () => {
      const database = await this.#open();
      return this.#transaction(database, 'readwrite', (store, done) => {
        const request = store.get(this.#id);
        request.onsuccess = () => {
          const row = request.result;
          if (row && row.scope === this.#scopeKey && row.page === this.#page && row.revision === snapshot.revision && row.raw === snapshot.raw) {
            store.delete(this.#id); done(true);
          } else done(false);
        };
      });
    });
  }

  list() { return this.#list(false); }
  listWorkspace() { return this.#list(true); }

  #row(row,workspace=true){
    checkRaw(row.raw);
    const identity=JSON.parse(row.scope);
    if(!Array.isArray(identity)||identity.length!==3)throw new DraftError('浏览器副本索引不一致，未应用任何内容。');
    const scope=boardScope({account:identity[0],workspace:identity[1],key:identity[2]});
    if(scope.account!==this.#scope.account||scope.workspace!==this.#scope.workspace||(!workspace&&scope.key!==this.#scope.key)||
       row.workspaceScope!==this.#workspaceKey||row.key!==scope.key||!validETag(row.baseETag,true)||!Number.isSafeInteger(row.revision)||row.revision<1||
       typeof row.page!=='string'||row.id!==JSON.stringify([row.scope,row.page])||!Number.isFinite(row.updatedAt))
      throw new DraftError('浏览器副本不属于原账号与工作区，未处理任何内容。');
    return Object.freeze({...row});
  }

  readReviewed(expected){return this.#reviewed(expected,false);}
  removeReviewed(expected){return this.#reviewed(expected,true);}
  #reviewed(expected,remove){
    const reviewed=structuredClone(this.#row(expected));
    return this.#enqueue(async()=>{
      const database=await this.#open();
      const result=await this.#transaction(database,remove?'readwrite':'readonly',(store,done,abort)=>{
        const request=store.get(reviewed.id);
        request.onsuccess=()=>{
          const row=request.result;
          if(!row){done({missing:true,removed:false});return;}
          try{
            this.#row(row);
            // Exact row, not just its revision: replacement/recreation or later
            // input with the same revision must also invalidate old confirmation.
            if(JSON.stringify(row)!==JSON.stringify(reviewed))throw new DraftError('这份副本已更新或变化，未清理；请刷新后查看新内容。');
            if(remove){store.delete(reviewed.id);done({removed:true,missing:false});}
            else done(this.#row(row));
          }catch(error){abort(error);}
        };
      });
      if(remove&&result.removed){
        try{const channel=new BroadcastChannel('creative-board-local-input');channel.postMessage({type:'removed',id:reviewed.id,revision:reviewed.revision});channel.close();}catch{}
      }
      return result;
    });
  }

  #list(workspace) {
    return this.#enqueue(async () => {
      const database = await this.#open();
      return this.#transaction(database, 'readonly', (store, done, abort) => {
        const rows = []; let bytes = 0;
        const cursor = store.index(workspace ? 'workspaceScope' : 'scope').openCursor(IDBKeyRange.only(workspace ? this.#workspaceKey : this.#scopeKey));
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (!current) { done(rows.sort((a, b) => b.updatedAt - a.updatedAt)); return; }
          const row = current.value;
          try {
            this.#row(row,workspace);
            bytes += encoder.encode(row.raw).length;
            if (rows.length >= MAX_ROWS || bytes > MAX_ALL_BYTES) throw new DraftError('浏览器副本超过读取限制，未应用任何内容。');
            rows.push(Object.freeze({...row})); current.continue();
          } catch (error) { abort(error); }
        };
      });
    });
  }

  async close() {
    await this.#tail;
    this.#closed = true; this.#database?.close(); this.#database = null;
  }
}
