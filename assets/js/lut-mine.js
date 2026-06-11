/*
 * /contribute/mine/ — list the signed-in user's submissions.
 */
(function () {
  'use strict';

  var CFG = {
    supabaseUrl: window.LUTSITE_SUPABASE_URL || '',
    anonKey: window.LUTSITE_SUPABASE_ANON_KEY || ''
  };

  var STATUS_LABELS = {
    pending: '待审核',
    approved: '已通过',
    rejected: '已拒绝'
  };

  var els = {};
  var state = { client: null, session: null, loading: false };

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

  function renderList(rows) {
    var list = els.list;
    list.innerHTML = '';
    if (!rows || rows.length === 0) {
      hide('lut-mine-list');
      show('lut-mine-empty');
      return;
    }
    rows.forEach(function (r) {
      var item = document.createElement('div');
      item.className = 'lut-mine-item';
      var status = r.status || 'pending';
      var statusLabel = STATUS_LABELS[status] || status;
      var dateStr = r.created_at ? new Date(r.created_at).toLocaleString() : '';
      var tagsArr = Array.isArray(r.tags) ? r.tags : [];
      var tagsHtml = tagsArr.length
        ? '<div class="lut-mine-item-tags">标签：' + tagsArr.map(escapeHtml).join('、') + '</div>'
        : '';
      var reasonHtml = (status === 'rejected' && r.reject_reason)
        ? '<div class="lut-mine-item-reason">拒绝原因：' + escapeHtml(r.reject_reason) + '</div>'
        : '';
      item.innerHTML =
        '<div>' +
          '<p class="lut-mine-item-title">' + escapeHtml(r.title) + '</p>' +
          '<p class="lut-mine-item-meta">' + escapeHtml(dateStr) + ' · ' +
            (r.file_size ? Math.round(r.file_size / 1024) + ' KB' : '') +
          '</p>' +
        '</div>' +
        '<span class="lut-mine-badge ' + status + '">' + statusLabel + '</span>' +
        '<p class="lut-mine-item-desc">' + escapeHtml(r.description || '') + '</p>' +
        tagsHtml + reasonHtml;
      list.appendChild(item);
    });
    show('lut-mine-list');
  }

  function showError(msg) {
    hide('lut-mine-loading');
    hide('lut-mine-list');
    hide('lut-mine-empty');
    els.errorMsg.textContent = msg || '加载失败';
    show('lut-mine-error');
  }

  async function load() {
    if (!state.client || !state.session) return;
    hide('lut-mine-error');
    hide('lut-mine-list');
    hide('lut-mine-empty');
    show('lut-mine-loading');
    try {
      var r = await state.client
        .from('submissions')
        .select('id, title, description, tags, file_name, file_size, status, reject_reason, created_at')
        .eq('user_id', state.session.user.id)
        .order('created_at', { ascending: false });
      if (r.error) {
        showError('查询失败：' + r.error.message);
        return;
      }
      hide('lut-mine-loading');
      renderList(r.data || []);
    } catch (err) {
      showError('网络异常：' + (err && err.message || err));
    }
  }

  async function refresh() {
    if (!state.client) return;
    var sess = await state.client.auth.getSession();
    state.session = sess && sess.data && sess.data.session;
    if (!state.session) {
      hide('lut-mine-loading');
      hide('lut-mine-error');
      hide('lut-mine-list');
      hide('lut-mine-empty');
      show('lut-mine-signedout');
      return;
    }
    hide('lut-mine-signedout');
    load();
  }

  function bindEvents() {
    if (els.signinBtn) {
      els.signinBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var btn = document.getElementById('auth-nav-signin');
        if (btn) btn.click();
      });
    }
    if (els.retryBtn) {
      els.retryBtn.addEventListener('click', function () { load(); });
    }
  }

  function init() {
    els.loading = $('lut-mine-loading');
    els.signedout = $('lut-mine-signedout');
    els.error = $('lut-mine-error');
    els.errorMsg = $('lut-mine-error-msg');
    els.list = $('lut-mine-list');
    els.empty = $('lut-mine-empty');
    els.signinBtn = $('lut-mine-signin');
    els.retryBtn = $('lut-mine-retry');

    if (!isConfigValid()) {
      showError('站点配置不完整');
      return;
    }
    if (!window.supabase || !window.supabase.createClient) {
      showError('Supabase 客户端未加载');
      return;
    }

    state.client = window.supabase.createClient(CFG.supabaseUrl, CFG.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    state.client.auth.onAuthStateChange(function () { refresh(); });
    bindEvents();
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
