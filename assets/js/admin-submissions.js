/*
 * /admin/submissions/ — admin moderation queue.
 *
 * Reads submissions, lists them by status tab, opens a detail drawer
 * that calls the moderate-submission Edge Function for approve/reject.
 */
(function () {
  'use strict';

  var CFG = {
    supabaseUrl: window.LUTSITE_SUPABASE_URL || '',
    anonKey: window.LUTSITE_SUPABASE_ANON_KEY || ''
  };

  // Tied to supabase/functions/moderate-submission/index.ts. Not
  // user-configurable; renaming the function requires updating this constant.
  var MODERATE_FUNCTION = 'moderate-submission';

  // Use the page-wide client set up in supabase-client.js. Two separate
  // createClient calls on the same localStorage key make GoTrueClient
  // warn "Multiple GoTrueClient instances" and thrash the auth state —
  // SIGNED_IN gets re-emitted by the sibling client on every mutation.
  // The init() guard below handles the missing-client case with a
  // visible error banner; an early return here would silently leave
  // the page stuck on "加载中…".

  var TABS = ['pending', 'approved', 'rejected'];
  var STATUS_LABELS = {
    pending: '待审核',
    approved: '已通过',
    rejected: '已拒绝'
  };
  var MIN_REJECT_REASON = 10;

  var els = {};
  var state = {
    client: null,
    session: null,
    isAdmin: null,         // null = not loaded yet; true/false = cached
    isAdminUserId: null,   // cache key — invalidate on user change
    tab: 'pending',
    list: [],
    current: null,
    busy: false
  };

  function $(id) { return document.getElementById(id); }

  function isConfigValid() {
    return /^https:\/\/[a-zA-Z0-9-]+\.supabase\.co/.test(CFG.supabaseUrl) &&
      CFG.anonKey && CFG.anonKey !== 'TODO';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function show(id) { var e = $(id); if (e) e.hidden = false; }
  function hide(id) { var e = $(id); if (e) e.hidden = true; }

  function showError(msg) {
    hide('lut-admin-loading');
    hide('lut-admin-content');
    els.errorMsg.textContent = msg || '加载失败';
    show('lut-admin-error');
  }

  function relativeTime(iso) {
    if (!iso) return '';
    var then = new Date(iso).getTime();
    var now = Date.now();
    var diff = Math.max(0, now - then);
    var s = Math.floor(diff / 1000);
    if (s < 60) return s + ' 秒前';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    var d = Math.floor(h / 24);
    return d + ' 天前';
  }

  function renderList() {
    var list = els.list;
    list.innerHTML = '';
    if (!state.list.length) {
      show('lut-admin-empty');
      return;
    }
    hide('lut-admin-empty');
    state.list.forEach(function (r) {
      var li = document.createElement('li');
      li.dataset.id = r.id;
      var status = r.status || 'pending';
      var fileSize = r.file_size ? Math.round(r.file_size / 1024) + ' KB' : '';
      li.innerHTML =
        '<div>' +
          '<div class="title">' + escapeHtml(r.title) + '</div>' +
          '<div class="meta">' + escapeHtml(r.user_email || '') + ' · ' +
            escapeHtml(relativeTime(r.created_at)) + ' · ' + escapeHtml(fileSize) +
          '</div>' +
        '</div>' +
        '<span class="status ' + status + '">' + (STATUS_LABELS[status] || status) + '</span>' +
        '<button type="button" class="detail-btn" data-action="open">详情</button>';
      list.appendChild(li);
    });
    list.addEventListener('click', listClick);
  }

  function listClick(e) {
    var btn = e.target.closest('button[data-action="open"]');
    if (!btn) return;
    var li = btn.closest('li');
    var id = li && li.dataset.id;
    if (!id) return;
    var row = state.list.find(function (r) { return r.id === id; });
    if (row) openDrawer(row);
  }

  function openDrawer(row) {
    state.current = row;
    els.drawer.hidden = false;
    els.drawer.setAttribute('aria-hidden', 'false');
    els.drawerTitle.textContent = row.title || '';
    var meta = (row.user_email || '') +
      ' · ' + relativeTime(row.created_at) +
      (row.reviewed_at ? ' · 审核 ' + relativeTime(row.reviewed_at) : '');
    els.drawerMeta.textContent = meta;
    els.drawerDesc.textContent = row.description || '';
    var tagsArr = Array.isArray(row.tags) ? row.tags : [];
    els.drawerTags.textContent = tagsArr.length
      ? '标签：' + tagsArr.map(escapeHtml).join('、')
      : '';
    els.drawerFile.textContent = '文件：' + (row.file_name || '') +
      (row.file_size ? ' (' + Math.round(row.file_size / 1024) + ' KB)' : '');
    els.drawerLink.innerHTML = '';
    if (row.status === 'pending') {
      getSignedUrl(row.storage_path).then(function (url) {
        if (url) {
          els.drawerLink.innerHTML =
            '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener">下载预览 .cube</a>';
        }
      });
      els.actions.hidden = false;
      els.reject.style.display = '';
      els.reason.value = '';
      els.reasonCount.textContent = '0';
      els.rejectBtn.disabled = true;
    } else {
      els.actions.hidden = true;
      els.reject.style.display = 'none';
    }
    els.status.textContent = '';
    els.status.className = 'lut-admin-drawer-status';
  }

  function closeDrawer() {
    els.drawer.hidden = true;
    els.drawer.setAttribute('aria-hidden', 'true');
    state.current = null;
  }

  async function getSignedUrl(storagePath) {
    try {
      var r = await state.client.storage
        .from('lut-submissions')
        .createSignedUrl(storagePath, 3600);
      if (r.error || !r.data) return null;
      return r.data.signedUrl;
    } catch (_e) { return null; }
  }

  async function loadList() {
    if (!state.client) return;
    // In-flight guard: if a load is already running for the current tab,
    // don't fire another. Tab clicks can otherwise fire overlapping
    // /submissions queries that race and stomp each other's results.
    if (state.loading) return;
    state.loading = true;
    try {
      var r = await state.client
        .from('submissions')
        .select('id, user_email, title, description, tags, file_name, file_size, storage_path, status, reject_reason, created_at, reviewed_at')
        .eq('status', state.tab)
        .order('created_at', { ascending: false })
        .limit(50);
      if (r.error) {
        showError('查询失败：' + r.error.message);
        return;
      }
      state.list = r.data || [];
      renderList();
    } finally {
      state.loading = false;
    }
  }

  function setTab(tab) {
    if (TABS.indexOf(tab) < 0) tab = 'pending';
    state.tab = tab;
    Array.prototype.forEach.call(els.tabs, function (btn) {
      btn.classList.toggle('active', btn.dataset.status === tab);
    });
    if (window.history && window.history.replaceState) {
      var newHash = '#' + tab;
      if (window.location.hash !== newHash) {
        window.history.replaceState(null, '', newHash);
      }
    }
    loadList();
  }

  async function moderate(payload) {
    var accessToken = state.session && state.session.access_token;
    var url = CFG.supabaseUrl + '/functions/v1/' + MODERATE_FUNCTION;
    var res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + (accessToken || ''),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    var data = null;
    try { data = await res.json(); } catch (_e) {}
    return { ok: res.ok, status: res.status, data: data };
  }

  async function approve() {
    if (!state.current || state.busy) return;
    if (!window.confirm('确认批准并发布这条投稿？')) return;
    state.busy = true;
    els.status.textContent = '处理中…';
    els.status.className = 'lut-admin-drawer-status';
    try {
      var r = await moderate({ submissionId: state.current.id, action: 'approve' });
      if (!r.ok) {
        var code = (r.data && r.data.error) || 'internal';
        els.status.textContent = '失败：' + code;
        els.status.className = 'lut-admin-drawer-status error';
        return;
      }
      var lutId = (r.data && r.data.lutId) || '?';
      els.status.innerHTML = '已发布。luts.id = <code>' + escapeHtml(lutId) + '</code>（复制后写入 markdown）';
      els.status.className = 'lut-admin-drawer-status ok';
      els.actions.hidden = true;
      els.reject.style.display = 'none';
      loadList();
    } catch (err) {
      els.status.textContent = '网络异常';
      els.status.className = 'lut-admin-drawer-status error';
    } finally {
      state.busy = false;
    }
  }

  async function reject() {
    if (!state.current || state.busy) return;
    var reason = (els.reason.value || '').trim();
    if (reason.length < MIN_REJECT_REASON) return;
    if (!window.confirm('确认拒绝这条投稿？')) return;
    state.busy = true;
    els.status.textContent = '处理中…';
    els.status.className = 'lut-admin-drawer-status';
    try {
      var r = await moderate({
        submissionId: state.current.id,
        action: 'reject',
        reason: reason
      });
      if (!r.ok) {
        var code = (r.data && r.data.error) || 'internal';
        els.status.textContent = '失败：' + code;
        els.status.className = 'lut-admin-drawer-status error';
        return;
      }
      els.status.textContent = '已拒绝。投稿人已收到邮件。';
      els.status.className = 'lut-admin-drawer-status ok';
      els.actions.hidden = true;
      els.reject.style.display = 'none';
      loadList();
    } catch (err) {
      els.status.textContent = '网络异常';
      els.status.className = 'lut-admin-drawer-status error';
    } finally {
      state.busy = false;
    }
  }

  function bindEvents() {
    Array.prototype.forEach.call(els.tabs, function (btn) {
      btn.addEventListener('click', function () { setTab(btn.dataset.status); });
    });
    if (els.close) els.close.addEventListener('click', closeDrawer);
    if (els.approve) els.approve.addEventListener('click', approve);
    if (els.rejectBtn) els.rejectBtn.addEventListener('click', reject);
    if (els.reason) {
      els.reason.addEventListener('input', function () {
        var v = els.reason.value || '';
        els.reasonCount.textContent = v.length;
        els.rejectBtn.disabled = v.trim().length < MIN_REJECT_REASON;
      });
    }
    if (els.retry) els.retry.addEventListener('click', loadList);
    if (els.drawer) {
      els.drawer.addEventListener('click', function (e) {
        if (e.target === els.drawer) closeDrawer();
      });
    }
  }

  async function loadRole(userId) {
    if (!userId || !state.client) return false;
    // Cache hit: role for this user has already been resolved this session.
    // Re-querying on every refresh is the main reason users?select=role
    // showed up dozens of times in DevTools.
    if (state.isAdminUserId === userId && state.isAdmin !== null) return state.isAdmin;
    try {
      var r = await state.client.from('users').select('role').eq('id', userId).maybeSingle();
      if (r.error || !r.data) {
        state.isAdmin = false;
        state.isAdminUserId = userId;
        return false;
      }
      state.isAdmin = r.data.role === 'admin';
      state.isAdminUserId = userId;
      return state.isAdmin;
    } catch (_e) {
      state.isAdmin = false;
      state.isAdminUserId = userId;
      return false;
    }
  }

  async function start() {
    if (!state.client || !state.session) return;
    state.isAdmin = await loadRole(state.session.user.id);
    if (!state.isAdmin) {
      hide('lut-admin-loading');
      renderDenied(state.session.user && state.session.user.email);
      show('lut-admin-denied');
      return;
    }
    hide('lut-admin-denied');
    hide('lut-admin-denied-hint');
    hide('lut-admin-loading');
    show('lut-admin-content');
    // pick initial tab from URL hash
    var hash = (window.location.hash || '').replace('#', '');
    setTab(hash && TABS.indexOf(hash) >= 0 ? hash : 'pending');
  }

  function renderDenied(signedInEmail) {
    if (signedInEmail) {
      var msg = $('lut-admin-denied-msg');
      var hint = $('lut-admin-denied-hint');
      var emailEl = $('lut-admin-denied-email');
      var sqlEl = $('lut-admin-denied-sql');
      if (msg) msg.textContent = '你已登录，但此页面仅对管理员开放。';
      if (emailEl) emailEl.textContent = signedInEmail;
      if (sqlEl) {
        sqlEl.textContent =
          "update public.users\n" +
          "set role = 'admin'\n" +
          "where email = '" + signedInEmail.replace(/'/g, "''") + "';";
      }
      if (hint) hint.hidden = false;
    } else {
      var msg2 = $('lut-admin-denied-msg');
      var hint2 = $('lut-admin-denied-hint');
      if (msg2) msg2.textContent = '此页面仅对管理员开放。请先登录。';
      if (hint2) hint2.hidden = true;
    }
  }

  async function refresh() {
    if (!state.client) return;
    hide('lut-admin-denied');
    hide('lut-admin-denied-hint');
    hide('lut-admin-error');
    hide('lut-admin-content');
    show('lut-admin-loading');
    var sess = await state.client.auth.getSession();
    state.session = sess && sess.data && sess.data.session;
    if (!state.session) {
      // Sign out (or never signed in) — invalidate role cache so the next
      // sign-in starts from a clean slate.
      state.isAdmin = null;
      state.isAdminUserId = null;
      hide('lut-admin-loading');
      renderDenied(null);
      show('lut-admin-denied');
      return;
    }
    start();
  }

  function init() {
    els.loading = $('lut-admin-loading');
    els.denied = $('lut-admin-denied');
    els.error = $('lut-admin-error');
    els.errorMsg = $('lut-admin-error-msg');
    els.retry = $('lut-admin-retry');
    els.content = $('lut-admin-content');
    els.tabs = document.querySelectorAll('.lut-admin-tab');
    els.list = $('lut-admin-list');
    els.empty = $('lut-admin-empty');
    els.drawer = $('lut-admin-drawer');
    els.close = $('lut-admin-drawer-close');
    els.drawerTitle = $('lut-admin-drawer-title');
    els.drawerMeta = $('lut-admin-drawer-meta');
    els.drawerDesc = $('lut-admin-drawer-desc');
    els.drawerTags = $('lut-admin-drawer-tags');
    els.drawerFile = $('lut-admin-drawer-file');
    els.drawerLink = $('lut-admin-drawer-link');
    els.actions = $('lut-admin-drawer-actions');
    els.reject = $('lut-admin-reject');
    els.reason = $('lut-admin-reject-reason');
    els.reasonCount = $('lut-admin-reject-count');
    els.rejectBtn = $('lut-admin-reject-btn');
    els.approve = $('lut-admin-approve');
    els.status = $('lut-admin-drawer-status');

    if (!isConfigValid()) {
      showError('站点配置不完整');
      return;
    }
    if (!window.LUTSITE_SUPABASE) {
      showError('Supabase 客户端未加载');
      return;
    }
    state.client = window.LUTSITE_SUPABASE;
    // Filter events: INITIAL_SESSION fires on subscription (we already
    // trigger an explicit refresh() below, so skip it). TOKEN_REFRESHED
    // just renews the JWT — the user + role haven't changed, so don't
    // re-query. Only react to real sign-in / sign-out / user updates.
    state.client.auth.onAuthStateChange(function (event) {
      if (event === 'INITIAL_SESSION') return;
      if (event === 'TOKEN_REFRESHED') return;
      refresh();
    });
    bindEvents();
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
