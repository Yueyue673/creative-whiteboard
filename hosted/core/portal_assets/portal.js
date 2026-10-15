(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const context = Object.freeze(JSON.parse($('portal-context').textContent));
  const originalAccount = context.account?.id ?? null;
  const workspaceID = context.workspace;
  const base = workspaceID ? `/w/${workspaceID}/api/` : null;
  const roles = {owner: '所有者', editor: '可编辑', viewer: '只读'};
  const invitationStates = {pending: '等待接受', accepted: '已接受', revoked: '已撤回', expired: '已过期'};
  const roleDrafts = new Map();
  let paused = false, registerMode = false, issuedID = null, space = null;
  let homeRead = 0, spaceRead = 0, memberRead = 0, invitationRead = 0, sessionRead = null;
  let invitationToken = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  if (location.hash) history.replaceState(null, '', location.pathname);
  if (!/^[A-Za-z0-9_-]{43}$/.test(invitationToken)) invitationToken = '';
  let channel;
  try { channel = new BroadcastChannel('creative-account-session'); } catch {}

  function message(text, error = false) {
    if (paused) return;
    $('status').textContent = text;
    $('status').dataset.error = String(error);
    $('status').hidden = !text;
  }
  function freeze(text) {
    if (paused) return;
    paused = true;
    $('pausedText').textContent = text + ' 当前填写的名称、邮箱和选择仍留在这里；没有自动切换保存对象。';
    $('paused').hidden = false;
    $('status').hidden = true;
    $('password').value = '';
    document.querySelectorAll('button').forEach(button => { if (button.id !== 'copyInvite' && button.id !== 'forgetInvite' && button.id !== 'showPassword' && !button.hasAttribute('data-browser-recovery-safe') && !button.hasAttribute('data-archive-safe') && !button.hasAttribute('data-account-safe')) button.disabled = true; });
  }
  function csrf() {
    const item = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith('__Host-creative_csrf='));
    return item ? decodeURIComponent(item.slice(item.indexOf('=') + 1)) : '';
  }
  async function request(path, method = 'GET', value) {
    if (paused) throw new Error('页面已暂停，输入仍保留');
    const headers = {'Accept': 'application/json'};
    if (originalAccount !== null) headers['X-Creative-Account'] = String(originalAccount);
    if (method !== 'GET') headers['X-CSRFToken'] = csrf();
    if (value !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try { response = await fetch(path, {method, headers, credentials: 'same-origin', cache: 'no-store', body: value === undefined ? undefined : JSON.stringify(value)}); }
    catch { throw new Error('连接暂时中断，输入已保留。恢复连接后可以再试。'); }
    const result = await response.json().catch(() => ({}));
    if (paused) throw new Error('页面已暂停，输入仍保留');
    if (!response.ok) {
      if (result.code === 'account_changed' || (originalAccount !== null && response.status === 401)) freeze('登录状态已改变。');
      if (base && path === base + 'workspace' && response.status === 404) freeze('这个页面原来的工作区已无法访问。');
      const error = new Error(result.error || '暂时无法完成操作，输入已保留。');
      error.status = response.status; throw error;
    }
    return result;
  }
  async function run(container, operation) {
    if (paused || container.dataset.busy === 'true') return;
    container.dataset.busy = 'true';
    const controls = [...container.querySelectorAll('input,select,button')].map(element => [element, element.disabled]);
    controls.forEach(([element]) => { element.disabled = true; });
    container.setAttribute('aria-busy', 'true');
    try { await operation(); }
    catch (error) { message(error.message, true); }
    finally {
      controls.forEach(([element, wasDisabled]) => { element.disabled = paused && element.tagName === 'BUTTON' ? true : wasDisabled; });
      container.dataset.busy = 'false'; container.removeAttribute('aria-busy');
    }
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function navigate(path) {
    if (paused) return;
    location.assign(path);
  }
  function announceSessionChange() { channel?.postMessage({type: 'changed'}); }
  async function checkSession() {
    if (paused || sessionRead) return;
    sessionRead = (async () => {
      try {
        const current = await request('/api/session');
        if ((current.account?.id ?? null) !== originalAccount) freeze('另一个页面改变了登录账号，或登录已过期。');
      } catch { /* Offline does not prove logout. Mutations still require server validation. */ }
    })();
    try { await sessionRead; } finally { sessionRead = null; }
  }
  if (channel) channel.onmessage = event => { if (event.data?.type === 'changed') checkSession(); };
  window.addEventListener('focus', checkSession);
  window.addEventListener('creative-account-check', checkSession);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSession(); });
  window.addEventListener('pageshow', event => { if (event.persisted) checkSession(); });
  const inviteCopyReminder = '请现在复制保存；离开页面后无法再次查看原链接。';
  function hasIssuedInvite() { return issuedID !== null && Boolean($('inviteLink').value); }
  function forgetIssuedInvite() {
    issuedID = null; $('inviteLink').value = ''; $('issuedInvite').hidden = true;
    $('inviteCopyHint').textContent = inviteCopyReminder;
  }
  function hasInputs() {
    return hasIssuedInvite() || Boolean(invitationToken) || roleDrafts.size > 0 || [...document.querySelectorAll('form input')].some(input => {
      if (input.type === 'password' || input.type === 'search') return false;
      if (input.type === 'checkbox' || input.type === 'radio') return input.checked !== input.defaultChecked;
      return input.value && input.value !== input.defaultValue;
    });
  }
  window.addEventListener('beforeunload', event => { if (hasInputs()) { event.preventDefault(); event.returnValue = ''; } });

  function setAuthMode(register) {
    if (paused || $('authForm').dataset.busy === 'true') return;
    registerMode = register;
    $('nameField').hidden = !register; $('displayName').required = register;
    $('authTokenField').hidden = !register; $('authToken').required = register;
    $('password').autocomplete = register ? 'new-password' : 'current-password';
    $('password').minLength = register ? 12 : 1;
    $('accountRecoveryHelp').hidden = register;
    if (register) $('accountRecoveryHelp').open = false;
    $('authTitle').textContent = register ? '受邀注册' : '登录';
    $('authSubmit').textContent = register ? '创建账号并加入' : '登录';
    $('loginTab').setAttribute('aria-pressed', String(!register));
    $('registerTab').setAttribute('aria-pressed', String(register));
    $('authHint').textContent = register ? '账号创建后，你还会拥有一个独立的私有工作区。' : (invitationToken ? '登录后先检查邮箱，再确认接受这份邀请。' : '没有账号时，需要工作区所有者先发给你邀请。');
  }
  $('loginTab').onclick = () => setAuthMode(false);
  $('registerTab').onclick = () => setAuthMode(true);
  $('showPassword').onclick = () => {
    const reveal = $('password').type === 'password'; $('password').type = reveal ? 'text' : 'password';
    $('showPassword').textContent = reveal ? '隐藏' : '显示'; $('showPassword').setAttribute('aria-pressed', String(reveal));
  };
  $('authForm').onsubmit = event => {
    event.preventDefault();
    const registration = registerMode;
    const value = {email: $('email').value, password: $('password').value};
    if (registration) Object.assign(value, {name: $('displayName').value, token: $('authToken').value.trim()});
    run($('authForm'), async () => {
      await request(registration ? '/api/register' : '/api/login', 'POST', value);
      $('password').value = ''; $('email').defaultValue = $('email').value; $('displayName').defaultValue = $('displayName').value;
      $('authToken').defaultValue = $('authToken').value;
      announceSessionChange();
      const destination = !registration && invitationToken ? `/join#token=${encodeURIComponent(invitationToken)}` : (context.destination || (workspaceID ? `/w/${workspaceID}/` : '/'));
      invitationToken = '';
      navigate(destination);
    });
  };
  $('logout').onclick = () => {
    if (hasInputs() && !confirm('当前页面还有填写、权限选择或未收起的邀请链接。退出会离开这个页面，确定退出吗？')) return;
    run($('logout').parentElement, async () => {
      await request('/api/logout', 'POST', {}); roleDrafts.clear(); invitationToken = ''; forgetIssuedInvite();
      document.querySelectorAll('form').forEach(form => form.reset());
      announceSessionChange(); navigate('/');
    });
  };

  async function loadHome() {
    const revision = ++homeRead;
    const result = await request('/api/workspaces');
    if (paused || revision !== homeRead) return;
    const list = $('workspaceList'); list.replaceChildren();
    for (const workspace of result.workspaces) {
      const card = element('a', undefined, 'space-card' + (workspace.kind === 'personal' ? ' personal' : ''));
      card.href = `/w/${workspace.id}/`;
      const symbol = element('span', workspace.kind === 'personal' ? '◇' : '◈', 'space-symbol'); symbol.setAttribute('aria-hidden', 'true');
      card.append(symbol, element('h2', workspace.name), element('p', `${workspace.kind === 'personal' ? '私有空间 · 仅自己' : '共享空间'} · ${roles[workspace.role]}`));
      list.append(card);
    }
    if (!result.workspaces.length) list.append(element('p', '暂无可以访问的工作区。', 'empty'));
  }
  $('refreshHome').onclick = () => run($('refreshHome').parentElement, loadHome);
  $('createForm').onsubmit = event => {
    event.preventDefault(); const value = {name: $('workspaceName').value};
    run($('createForm'), async () => {
      const workspace = await request('/api/workspaces', 'POST', value);
      $('workspaceName').value = ''; navigate(`/w/${workspace.id}/`);
    });
  };
  $('acceptForm').onsubmit = event => {
    event.preventDefault(); const value = {token: $('acceptToken').value.trim()};
    run($('acceptForm'), async () => {
      const workspace = await request('/api/invitations/accept', 'POST', value);
      $('acceptToken').value = ''; invitationToken = ''; navigate(`/w/${workspace.id}/`);
    });
  };
  function roleSelect(member) {
    const select = element('select'); select.setAttribute('aria-label', `${member.name}的权限`);
    for (const [role, label] of [['editor', '可编辑'], ['viewer', '只读']]) {
      const option = element('option', label); option.value = role; select.append(option);
    }
    select.value = roleDrafts.get(member.id) ?? member.role;
    select.onchange = () => { if (select.value === member.role) roleDrafts.delete(member.id); else roleDrafts.set(member.id, select.value); };
    return select;
  }
  async function loadMembers() {
    const revision = ++memberRead;
    const result = await request(base + 'members');
    if (paused || revision !== memberRead) return;
    const list = $('memberList'); list.replaceChildren();
    for (const member of result.members) {
      const row = element('div', undefined, 'member-row'); row.dataset.member = String(member.id);
      const avatar = element('span', [...member.name][0] || '◇', 'avatar'); avatar.setAttribute('aria-hidden', 'true');
      const info = element('div', undefined, 'member-info'); info.append(element('div', member.name + (member.id === originalAccount ? ' · 你' : ''), 'member-name'));
      if (member.email) info.append(element('div', member.email, 'member-email'));
      info.append(element('div', '当前：' + roles[member.role], 'role-label'));
      row.append(avatar, info);
      if (space.role === 'owner' && space.kind === 'shared' && member.role !== 'owner') {
        const actions = element('div', undefined, 'member-actions'); const select = roleSelect(member);
        const save = element('button', '保存权限', 'quiet'); save.type = 'button';
        save.onclick = () => { const value = {role: select.value}; run(actions, async () => {
          await request(base + `members/${member.id}`, 'PATCH', value); roleDrafts.delete(member.id);
          await loadMembers(); message('成员权限已更新。');
        }); };
        const remove = element('button', '移除', 'quiet danger'); remove.type = 'button';
        remove.onclick = () => { if (!confirm(`移除“${member.name}”后，对方将不能继续访问这个共享工作区。确定移除吗？`)) return;
          run(actions, async () => { await request(base + `members/${member.id}`, 'DELETE'); roleDrafts.delete(member.id); await loadMembers(); message('已移除成员，原工作区内容保留。'); });
        };
        actions.append(select, save, remove); row.append(actions);
      }
      list.append(row);
    }
  }
  async function loadInvitations() {
    if (space.role !== 'owner' || space.kind !== 'shared') return;
    const revision = ++invitationRead;
    const result = await request(base + 'invitations');
    if (paused || revision !== invitationRead) return;
    const list = $('invitationList'); list.replaceChildren();
    for (const invitation of result.invitations) {
      const row = element('div', undefined, 'invite-row'); const info = element('div');
      info.append(element('div', invitation.email, 'invite-address'));
      const date = new Date(invitation.expiresAt).toLocaleDateString('zh-CN');
      info.append(element('p', `${roles[invitation.role]} · ${invitationStates[invitation.state]} · ${date} 到期`, 'caption')); row.append(info);
      if (invitation.state === 'pending') {
        const revoke = element('button', '撤回', 'quiet'); revoke.type = 'button';
        revoke.onclick = () => run(row, async () => {
          await request(base + `invitations/${invitation.id}`, 'DELETE');
          if (issuedID === invitation.id) forgetIssuedInvite();
          await loadInvitations(); message('邀请已撤回，原链接不能再使用。');
        }); row.append(revoke);
      }
      list.append(row);
    }
    if (!result.invitations.length) list.append(element('p', '还没有发出邀请。', 'empty'));
  }
  async function loadSpace() {
    const revision = ++spaceRead;
    const result = await request(base + 'workspace');
    if (paused || revision !== spaceRead) return;
    space = result;
    $('workspaceTitle').textContent = space.name;
    $('workspaceKind').textContent = space.kind === 'personal' ? '私有工作区' : '共享工作区';
    $('workspaceRole').textContent = roles[space.role];
    $('workspaceDescription').textContent = space.kind === 'personal' ? '这里的内容只属于你的账号。' : '由成员邀请建立的创作空间，每个人的权限由所有者管理。';
    $('invitePanel').hidden = space.kind !== 'shared' || space.role !== 'owner';
    $('privatePanel').hidden = space.kind !== 'personal';
    $('newBoard').hidden = space.role === 'viewer';
    $('newBoard').href = `/w/${workspaceID}/new/${crypto.randomUUID()}/`;
    await Promise.all([loadMembers(), loadInvitations(), loadBoards()]);
  }
  let boardRead = 0;
  async function loadBoards() {
    const revision = ++boardRead;
    const result = await request(base + 'boards');
    if (paused || revision !== boardRead) return;
    const list = $('boardList'); list.replaceChildren();
    for (const board of result) {
      const card = element('a', undefined, 'space-card board-card');
      card.href = `/w/${workspaceID}/b/${encodeURIComponent(board.id)}/`;
      card.append(element('span', '▱', 'space-symbol'), element('h3', board.name), element('p', `${board.count} 个内容 · ${new Date(board.updated * 1000).toLocaleDateString('zh-CN')}`));
      list.append(card);
    }
    if (!result.length) list.append(element('p', '这里还没有白板。为自己的第一张白板取一个名字，再开始写。', 'empty'));
  }
  $('refreshBoards').onclick = () => run($('refreshBoards').parentElement, loadBoards);
  window.addEventListener('creative-archive-restored',event=>{
    if(paused||event.detail?.account!==originalAccount||event.detail?.workspace!==workspaceID)return;
    loadBoards().catch(error=>message('白板列表暂未刷新，请稍后检查。 '+error.message,true));
  });
  $('refreshMembers').onclick = () => run($('refreshMembers').parentElement, loadSpace);
  $('inviteForm').onsubmit = event => {
    event.preventDefault();
    if (paused || $('inviteForm').dataset.busy === 'true') return;
    if (hasIssuedInvite() && !confirm('这里还有一份只能在本页查看的邀请链接。新邀请会替换这里的显示；同一邮箱的旧邀请还会失效。请先复制保存，确定继续生成吗？')) return;
    const value = {email: $('inviteEmail').value, role: $('inviteRole').value};
    run($('inviteForm'), async () => {
      const result = await request(base + 'invitations', 'POST', value);
      issuedID = result.invitation.id;
      $('inviteLink').value = `${location.origin}/join#token=${encodeURIComponent(result.token)}`;
      $('issuedInvite').hidden = false; $('inviteEmail').value = '';
      $('inviteCopyHint').textContent = inviteCopyReminder;
      // Keep the only copy of this link even if subsequent list refresh fails.
      message('邀请链接已生成，请复制后亲自发给对方。');
      $('copyInvite').focus();
      await loadInvitations();
    });
  };
  $('copyInvite').onclick = async () => {
    const link = $('inviteLink').value;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      if (hasIssuedInvite() && $('inviteLink').value === link) $('inviteCopyHint').textContent = '链接已复制。请发给指定邮箱的那个人。';
    } catch {
      if (!hasIssuedInvite() || $('inviteLink').value !== link) return;
      $('inviteLink').focus(); $('inviteLink').select();
      $('inviteCopyHint').textContent = '浏览器没有允许复制，链接已选中，可手动复制。';
    }
  };

  $('forgetInvite').onclick = () => {
    if (!hasIssuedInvite()) return;
    forgetIssuedInvite();
    message('已收起本页链接，原邀请仍有效；需要取消时可在邀请记录中撤回。');
    if (!paused) $('inviteEmail').focus({preventScroll: true});
  };

  async function start() {
    $('accountName').textContent = context.account?.name || '';
    $('logout').hidden = originalAccount === null;
    if (originalAccount === null) {
      $('auth').hidden = false; $('authToken').value = invitationToken;
      if (invitationToken) $('authToken').defaultValue = invitationToken;
      setAuthMode(false); return;
    }
    if (workspaceID) {
      $('workspace').hidden = false;
      $('workspaceTitle').textContent = '正在读取工作区…';
      try { await loadSpace(); }
      catch (error) {
        // Retain this URL; never substitute a different available workspace.
        if (error.status === 404) freeze(error.message + ' 可以在新页面重新检查工作区权限。');
        else message(error.message, true);
      }
    } else {
      $('home').hidden = false; $('acceptToken').value = invitationToken; $('acceptToken').defaultValue = invitationToken;
      await loadHome();
      if (invitationToken) message(`当前登录邮箱：${context.account.email}。确认邀请属于这个邮箱后，再点击“加入工作区”。`);
    }
  }
  start().catch(error => message(error.message, true));
})();
