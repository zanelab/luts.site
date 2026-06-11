/*
 * /admin/luts/ — admin management for published LUTs.
 *
 * Reads the luts table, lists each row with its uuid (so admins can
 * copy it into markdown front matter), and exposes edit + delete
 * actions that hit the manage-lut Edge Function.
 *
 * Update / delete need an admin bearer token. Listing is just a
 * direct read (RLS policy luts_select_public is open to authenticated).
 */
(function () {
  'use strict';

  var CFG = {
    supabaseUrl: window.LUTSITE_SUPABASE_URL || '',
    anonKey: window.LUTSITE_SUPABASE_ANON_KEY || ''
  };

  // Tied to supabase/functions/manage-lut/index.ts. Renaming the function
  // requires updating this constant.
  var MANAGE_FUNCTION = 'manage-lut';

  var MAX_TITLE_LEN = 80;
  var MAX_DESC_LEN = 500;
  var MAX_TAGS = 5;
  var MAX_TAG_LEN = 16;

  var els = {};
  var state = {
    client: null,
    session: null,
    isAdmin: null,
    isAdminUserId: null,
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
      var tagsArr = Array.isArray(r.tags) ? r.tags : [];
      li.innerHTML =
        '<div class="title">' + escapeHtml(r.title) + '</div>' +
        '<div class="uuid-row">' +
          '<code>' + escapeHtml(r.id) + '</code>' +
          '<button type="button" class="copy-btn" data-action="copy" data-id="' + escapeHtml(r.id) + '">复制</button>' +
        '</div>' +
        '<div class="meta">' +
          'slug: <code>' + escapeHtml(r.slug) + '</code>' +
          ' · 创建 ' + escapeHtml(relativeTime(r.created_at)) +
          (tagsArr.length ? ' · 标签 ' + escapeHtml(tagsArr.join('、')) : '') +
        '</div>' +
        '<div class="actions">' +
          '<button type="button" class="action-btn" data-action="edit">编辑</button>' +
          '<button type="button" class="action-btn action-btn--danger" data-action="delete">删除</button>' +
        '</div>';
      list.appendChild(li);
    });
  }

  function listClick(e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;
    var li = btn.closest('li');
    var id = li && li.dataset.id;
    if (!id) return;
    var row = state.list.find(function (r) { return r.id === id; });
    if (!row) return;
    var action = btn.dataset.action;
    if (action === 'edit') return openDrawer(row);
    if (action === 'delete') return confirmDelete(row);
    if (action === 'copy') return copyUuid(btn, row.id);
  }

  function copyUuid(btn, id) {
    var done = function () {
      var orig = btn.textContent;
      btn.textContent = '已复制';
      btn.classList.add('copied');
      setTimeout(function () {
        btn.textContent = orig;
        btn.classList.remove('copied');
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(id).then(done, function () {
        fallbackCopy(id);
        done();
      });
    } else {
      fallbackCopy(id);
      done();
    }
  }

  function fallbackCopy(text) {
    // execCommand fallback for older browsers / non-https contexts.
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_e) {}
    document.body.removeChild(ta);
  }

  function openDrawer(row) {
    state.current = row;
    els.drawer.hidden = false;
    els.drawer.setAttribute('aria-hidden', 'false');
    els.drawerTitle.textContent = row.title || '编辑 LUT';
    els.drawerMeta.innerHTML = 'uuid: <code>' + escapeHtml(row.id) + '</code>';
    els.editTitle.value = row.title || '';
    els.editSlug.value = row.slug || '';
    els.editDesc.value = row.description || '';
    var tagsArr = Array.isArray(row.tags) ? row.tags : [];
    els.editTags.value = tagsArr.join(', ');
    updateCount(els.editTitle, els.editTitleCount, MAX_TITLE_LEN);
    updateCount(els.editDesc, els.editDescCount, MAX_DESC_LEN);
    els.status.textContent = '';
    els.status.className = 'lut-admin-drawer-status';
    els.saveBtn.disabled = false;
  }

  function closeDrawer() {
    els.drawer.hidden = true;
    els.drawer.setAttribute('aria-hidden', 'true');
    state.current = null;
  }

  function updateCount(input, counter, max) {
    if (!counter) return;
    counter.textContent = (input.value || '').length + ' / ' + max;
  }

  function parseTagsInput(raw) {
    return (raw || '')
      .split(/[,，]/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  async function loadList() {
    if (!state.client) return;
    if (state.loading) return;
    state.loading = true;
    try {
      var r = await state.client
        .from('luts')
        .select('id, slug, title, description, tags, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(200);
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

  async function callManage(payload) {
    var accessToken = state.session && state.session.access_token;
    var url = CFG.supabaseUrl + '/functions/v1/' + MANAGE_FUNCTION;
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

  async function saveEdit(e) {
    e.preventDefault();
    if (!state.current || state.busy) return;

    var title = (els.editTitle.value || '').trim();
    var slug = (els.editSlug.value || '').trim();
    var description = (els.editDesc.value || '').trim();
    var tags = parseTagsInput(els.editTags.value);

    if (title.length < 1 || title.length > MAX_TITLE_LEN) {
      setStatus('标题长度需在 1-' + MAX_TITLE_LEN + ' 字之间', 'error');
      return;
    }
    if (description.length < 1 || description.length > MAX_DESC_LEN) {
      setStatus('描述长度需在 1-' + MAX_DESC_LEN + ' 字之间', 'error');
      return;
    }
    if (tags.length > MAX_TAGS) {
      setStatus('标签最多 ' + MAX_TAGS + ' 个', 'error');
      return;
    }
    for (var i = 0; i < tags.length; i++) {
      if (tags[i].length > MAX_TAG_LEN) {
        setStatus('标签「' + tags[i] + '」超过 ' + MAX_TAG_LEN + ' 字', 'error');
        return;
      }
    }
    if (slug.length < 1 || slug.length > 60) {
      setStatus('slug 长度需在 1-60 字之间', 'error');
      return;
    }
    if (!/^[a-z0-9一-鿿\-]+$/.test(slug)) {
      setStatus('slug 只能包含小写字母、数字、连字符、中文', 'error');
      return;
    }

    state.busy = true;
    els.saveBtn.disabled = true;
    setStatus('保存中…');
    try {
      var r = await callManage({
        action: 'update',
        lutId: state.current.id,
        title: title,
        slug: slug,
        description: description,
        tags: tags
      });
      if (!r.ok) {
        var code = (r.data && r.data.error) || 'internal';
        var hint = code === 'slug_taken'
          ? 'slug 已被其他 LUT 占用'
          : ('失败：' + code);
        setStatus(hint, 'error');
        return;
      }
      setStatus('已保存', 'ok');
      loadList();
    } catch (err) {
      setStatus('网络异常', 'error');
    } finally {
      state.busy = false;
      els.saveBtn.disabled = false;
    }
  }

  function setStatus(text, kind) {
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.className = 'lut-admin-drawer-status' + (kind ? ' ' + kind : '');
  }

  async function confirmDelete(row) {
    var msg = '确认删除 LUT「' + (row.title || row.slug) + '」？\n' +
      '将同时删除数据库记录和 storage 中的 .cube 文件。\n' +
      '此操作不可撤销。';
    if (!window.confirm(msg)) return;
    state.busy = true;
    try {
      var r = await callManage({
        action: 'delete',
        lutId: row.id,
        confirm: true
      });
      if (!r.ok) {
        var code = (r.data && r.data.error) || 'internal';
        window.alert('删除失败：' + code);
        return;
      }
      loadList();
    } catch (err) {
      window.alert('网络异常');
    } finally {
      state.busy = false;
    }
  }

  function bindEvents() {
    if (els.close) els.close.addEventListener('click', closeDrawer);
    if (els.drawer) {
      els.drawer.addEventListener('click', function (e) {
        if (e.target === els.drawer) closeDrawer();
      });
    }
    if (els.list) els.list.addEventListener('click', listClick);
    if (els.editForm) els.editForm.addEventListener('submit', saveEdit);
    if (els.editTitle) {
      els.editTitle.addEventListener('input', function () {
        updateCount(els.editTitle, els.editTitleCount, MAX_TITLE_LEN);
      });
    }
    if (els.editDesc) {
      els.editDesc.addEventListener('input', function () {
        updateCount(els.editDesc, els.editDescCount, MAX_DESC_LEN);
      });
    }
    if (els.retry) els.retry.addEventListener('click', loadList);
  }

  async function loadRole(userId) {
    if (!userId || !state.client) return false;
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
    loadList();
  }

  function renderDenied(signedInEmail) {
    var msg = $('lut-admin-denied-msg');
    var hint = $('lut-admin-denied-hint');
    var emailEl = $('lut-admin-denied-email');
    var sqlEl = $('lut-admin-denied-sql');
    if (signedInEmail) {
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
      if (msg) msg.textContent = '此页面仅对管理员开放。请先登录。';
      if (hint) hint.hidden = true;
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
    els.list = $('lut-admin-list');
    els.empty = $('lut-admin-empty');
    els.drawer = $('lut-admin-drawer');
    els.close = $('lut-admin-drawer-close');
    els.drawerTitle = $('lut-admin-drawer-title');
    els.drawerMeta = $('lut-admin-drawer-meta');
    els.editForm = $('lut-admin-edit-form');
    els.editTitle = $('lut-admin-edit-title');
    els.editTitleCount = $('lut-admin-edit-title-count');
    els.editSlug = $('lut-admin-edit-slug');
    els.editDesc = $('lut-admin-edit-desc');
    els.editDescCount = $('lut-admin-edit-desc-count');
    els.editTags = $('lut-admin-edit-tags');
    els.saveBtn = $('lut-admin-save-btn');
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
    // INITIAL_SESSION is fired on subscription; refresh() already kicks below.
    // TOKEN_REFRESHED is just a JWT renewal — user/role don't change.
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
