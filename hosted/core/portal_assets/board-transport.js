/* This page owns one immutable destination. A newer cookie is never an identity. */
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const KEY = /^[A-Za-z0-9_-]{1,100}$/;
const ETAG = /^"[a-f0-9]{64}"$/;

export function boardScope(value) {
  if (!value || !Number.isSafeInteger(value.account) || value.account < 1 ||
      typeof value.workspace !== 'string' || !UUID.test(value.workspace) ||
      typeof value.key !== 'string' || !KEY.test(value.key)) throw new TypeError('白板所属账号或编号无效');
  return Object.freeze({account: value.account, workspace: value.workspace, key: value.key});
}

export function validETag(value, allowNew = false) {
  return typeof value === 'string' && (ETAG.test(value) || (allowNew && value === 'new'));
}

export class BoardError extends Error {
  constructor(message, status = 0, code = 'request_failed', details = {}) {
    super(message); this.name = 'BoardError'; this.status = status; this.code = code;
    this.details = Object.freeze({...details});
  }
}

function csrf() {
  const item = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('__Host-creative_csrf='));
  try { return item ? decodeURIComponent(item.slice(item.indexOf('=') + 1)) : ''; }
  catch { return ''; }
}

export class BoardTransport {
  #scope;
  constructor(scope) { this.#scope = boardScope(scope); }
  get scope() { return this.#scope; }
  get base() { return `/w/${this.#scope.workspace}/api/`; }
  get boardURL() { return this.base + 'boards/' + this.#scope.key; }

  async #request(path, method = 'GET', raw, expected, timeoutMs = 30000) {
    const headers = {'Accept': 'application/json', 'X-Creative-Account': String(this.#scope.account)};
    if (method !== 'GET') headers['X-CSRFToken'] = csrf();
    if (raw !== undefined) headers['Content-Type'] = 'application/json';
    if (expected !== undefined) headers['If-Match'] = expected;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetch(path, {method, headers, body: raw, credentials: 'same-origin',
          cache: 'no-store', redirect: 'error', signal: controller.signal});
      } catch {
        throw new BoardError('连接中断或等待超时，输入仍在当前页面；请检查连接后再试。', 0, 'offline');
      }
      let value;
      try { value = await response.json(); }
      catch {
        throw new BoardError('服务器没有返回可核对的结果，请保留输入后再检查。', response.status, 'protocol');
      }
      if (!response.ok) throw new BoardError(value?.error || '操作未完成，请保留当前输入。', response.status, value?.code || 'request_failed', value);
      return {value, etag: response.headers.get('ETag')};
    } finally { clearTimeout(timeout); }
  }

  async assertIdentity() {
    const result = await this.#request('/api/session', 'GET', undefined, undefined, 5000);
    if (result.value.account?.id !== this.#scope.account) throw new BoardError('登录账号已改变，当前页面已暂停；原输入仍保留。', 409, 'account_changed');
  }

  async workspace() {
    const {value} = await this.#request(this.base + 'workspace');
    if (value?.id !== this.#scope.workspace || !['owner', 'editor', 'viewer'].includes(value.role))
      throw new BoardError('工作区返回结果不一致，请保留输入。', 0, 'protocol');
    return value;
  }

  async read() {
    const result = await this.#request(this.boardURL);
    if (!validETag(result.etag)) throw new BoardError('缺少白板版本，未启用保存；请保留输入。', 0, 'protocol');
    return result;
  }

  async save(raw, expected) {
    if (typeof raw !== 'string' || !validETag(expected, true)) throw new TypeError('缺少原始输入或保存前版本');
    const result = await this.#request(this.boardURL, 'PUT', raw, expected);
    if (result.value?.saved !== true || !validETag(result.etag))
      throw new BoardError('保存结果无法核对，输入仍保留；请在新页面检查服务器版本。', 0, 'protocol');
    return result;
  }
}
