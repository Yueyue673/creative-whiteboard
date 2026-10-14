(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const context = JSON.parse($('portal-context').textContent);
  if (!context.workspace || !context.account) return;
  const scope = Object.freeze({workspace: context.workspace, account: context.account.id});
  const base = `/w/${scope.workspace}/api/`;
  const form = $('workspaceSearch'), input = $('workspaceSearchQuery'), submit = $('submitWorkspaceSearch');
  const clear = $('clearWorkspaceSearch'), state = $('workspaceSearchState'), list = $('workspaceSearchResults');
  let epoch = 0, controller = null, paused = false, checkedResult = null;
  function text(message, error = false) {
    state.textContent = message; state.dataset.error = String(error); state.hidden = !message;
  }
  function discard() {
    ++epoch; controller?.abort(); controller = null;
    checkedResult = null;
    list.replaceChildren(); list.hidden = true; form.removeAttribute('aria-busy');
    submit.disabled = paused; $('boardList').hidden = false;
  }
  function freeze(message) {
    paused = true; discard(); text(message + ' 查找词仍留在这里，请在新页面核对账号和权限。', true);
  }
  function current(token, query) {
    return token === epoch && !paused && input.value.trim() === query && $('paused').hidden;
  }
  async function read(path, signal) {
    const response = await fetch(path, {headers: {'Accept': 'application/json', 'X-Creative-Account': String(scope.account)},
      credentials: 'same-origin', cache: 'no-store', signal});
    let data;
    try { data = await response.json(); }
    catch { throw Error('查找回复无法核对，请重新查找。'); }
    if (!response.ok) {
      const error = new Error(data.error || '暂时无法查找，请稍后再试。');
      error.status = response.status; error.code = data.code; throw error;
    }
    return data;
  }
  function validate(result, query) {
    if (result?.account !== scope.account || result.workspace !== scope.workspace || result.query !== query ||
        !['currentSupportedText', 'limited'].includes(result.coverage) || !Number.isInteger(result.scannedBoards) || result.scannedBoards < 0 ||
        !Array.isArray(result.items) || result.items.length > 40) throw Error('查找回复无法核对，请重新查找。');
    const seen = new Set();
    for (const row of result.items) {
      if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id) || seen.has(row.id) ||
          typeof row.name !== 'string' || [...row.name].length > 1000 || typeof row.context !== 'string' || [...row.context].length > 180 ||
          typeof row.excerpt !== 'string' || [...row.excerpt].length > 142 || typeof row.updated !== 'number' || !Number.isFinite(row.updated))
        throw Error('查找结果无法核对，请重新查找。');
      seen.add(row.id);
    }
    return result;
  }
  function node(tag, content, className) {
    const item = document.createElement(tag); item.textContent = content;
    if (className) item.className = className; return item;
  }
  function render(result) {
    checkedResult = result;
    const rows = [];
    for (const row of result.items) {
      const link = document.createElement('a'); link.className = 'search-result';
      link.href = `/w/${scope.workspace}/b/${encodeURIComponent(row.id)}/`; link.target = '_blank'; link.rel = 'noopener';
      link.append(node('h3', row.name), node('p', row.context, 'search-result-context'), node('p', row.excerpt, 'search-result-excerpt'),
        node('span', '在新页面打开 ↗', 'search-result-open'));
      link.onclick = event => { if (paused || !$('paused').hidden || list.hidden || list.inert) event.preventDefault(); };
      rows.push(link);
    }
    list.replaceChildren(...rows); list.hidden = !rows.length; list.inert = false; $('boardList').hidden = true;
    const found = rows.length ? `找到 ${rows.length} 张白板。` : '这次查找没有找到匹配白板。';
    text(result.coverage === 'limited' ? `${found}本次只检查了部分内容，请缩小查找范围；没有结果也不代表不存在。` : found);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (paused || !$('paused').hidden) return;
    discard(); const query = input.value.trim();
    if (!query) { text(''); input.focus(); return; }
    if ([...query].length > 120 || /[\u0000-\u001f\u007f-\u009f]/.test(query)) { text('查找词须为1至120个字符，不含换行或控制字符。', true); return; }
    const token = epoch; controller = new AbortController(); const signal = controller.signal;
    form.setAttribute('aria-busy', 'true'); submit.disabled = true; $('boardList').hidden = true; text('正在查找这个空间已保存的文字…');
    try {
      const result = validate(await read(base + 'search?q=' + encodeURIComponent(query), signal), query);
      if (!current(token, query)) return;
      // Fresh account-bound scoped read before presenting delayed content.
      const access = await read(base + 'workspace', signal);
      if (!current(token, query)) return;
      if (access.id !== scope.workspace || !['owner', 'editor', 'viewer'].includes(access.role)) throw Error('原工作区权限回复无法核对，请重新查找。');
      render(result);
    } catch (error) {
      if (!current(token, query)) return;
      if (error.status === 401 || error.status === 404 || error.code === 'account_changed') freeze('登录或工作区访问状态已改变。');
      else { $('boardList').hidden = false; text(error.name === 'TypeError' ? '连接暂时中断，查找词已保留。恢复后可以再试。' : error.message, true); }
    } finally {
      if (token === epoch) { controller = null; form.removeAttribute('aria-busy'); submit.disabled = paused; }
    }
  });
  input.addEventListener('input', () => { discard(); clear.hidden = !input.value; if (!paused) text(''); });
  function reset() { discard(); input.value = ''; clear.hidden = true; if (!paused) text(''); input.focus(); }
  clear.onclick = reset;
  input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); reset(); } });
  // A refresh/recovered board changes saved contents: retain the query but do
  // not retain an old result as evidence of the new saved state.
  function invalidate() {
    const hadResults = list.children.length > 0 || form.hasAttribute('aria-busy');
    discard(); if (hadResults && !paused) text('列表已重新读取，请按“查找”核对这段文字。');
  }
  $('refreshBoards').addEventListener('click', invalidate);
  window.addEventListener('creative-archive-restored', event => { if (event.detail?.account === scope.account && event.detail?.workspace === scope.workspace) invalidate(); });
  async function recheck() {
    if (paused) return;
    const result = checkedResult;
    if (!result) {
      if (form.hasAttribute('aria-busy')) { discard(); text('请按“查找”重新核对已保存的文字。'); }
      return;
    }
    const token = ++epoch; controller?.abort(); controller = new AbortController();
    const signal = controller.signal; list.inert = true;
    try {
      const access = await read(base + 'workspace', signal);
      if (!current(token, result.query) || checkedResult !== result) return;
      if (access.id !== scope.workspace || !['owner', 'editor', 'viewer'].includes(access.role)) throw Error('原工作区权限回复无法核对，请重新查找。');
      list.inert = false;
    } catch (error) {
      if (token !== epoch || paused) return;
      if (error.status === 401 || error.status === 404 || error.code === 'account_changed') freeze('登录或工作区访问状态已改变。');
      else { discard(); text('暂时无法核对访问状态，查找词已保留。恢复后可以再试。', true); }
    } finally { if (token === epoch) controller = null; }
  }
  window.addEventListener('focus', recheck);
  window.addEventListener('pageshow', event => { if (event.persisted) recheck(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      list.inert = true;
      if (form.hasAttribute('aria-busy')) { discard(); text('请按“查找”重新核对已保存的文字。'); }
    } else recheck();
  });
  try { const channel = new BroadcastChannel('creative-account-session'); channel.onmessage = recheck; } catch {}
  new MutationObserver(() => { if (!$('paused').hidden && !paused) freeze('这个页面的登录或访问状态已改变。'); }).observe($('paused'), {attributes: true, attributeFilter: ['hidden']});
})();
