/*
 * /admin/orders/ — admin DM-resend queue for paid Afdian orders.
 *
 * Lists paid_lut_orders rows where state='paid' AND dm_sent_at IS NULL
 * (i.e. the original Afdian DM didn't make it). Each row has a "重新发送"
 * button that calls the resend-paid-download Edge Function.
 *
 * Same auth pattern as admin-submissions.js: wait for supabase auth,
 * load role from public.users, gate the page on role==='admin'.
 */
(function () {
  'use strict';

  var CFG = {
    supabaseUrl: window.LUTSITE_SUPABASE_URL || '',
    anonKey: window.LUTSITE_SUPABASE_ANON_KEY || ''
  };

  var RESEND_FUNCTION = 'resend-paid-download';

  var els = {};
  var state = {
    client: null,
    session: null,
    isAdmin: null,
    isAdminUserId: null,
    list: [],
    busy: {}
  };

  function $(id) { return document.getElementById(id); }
  function show(id) { var e = $(id); if (e) e.hidden = false; }
  function hide(id) { var e = $(id); if (e) e.hidden = true; }

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

  function showError(msg) {
    hide('lut-admin-loading');
    hide('lut-admin-content');
    els.errorMsg.textContent = msg || '加载失败';
    show('lut-admin-error');
  }

  async function loadRole(userId) {
    if (state.isAdminUserId === userId && state.isAdmin !== null) {
      return state.isAdmin;
    }
    if (!state.client) {
      state.isAdmin = false;
      state.isAdminUserId = userId;
      return false;
    }
    try {
      var r = await state.client
        .from('users')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
      state.isAdmin = !!(r.data && r.data.role === 'admin');
      state.isAdminUserId = userId;
      return state.isAdmin;
    } catch (err) {
      console.warn('role lookup failed', err);
      state.isAdmin = false;
      state.isAdminUserId = userId;
      return false;
    }
  }

  async function loadOrders() {
    var r = await state.client
      .from('paid_lut_orders')
      .select(
        'id, order_no, lut_id, sku_id, buyer_user_id, amount_cents, state, dm_error, created_at, updated_at, luts!inner(title, slug)'
      )
      .eq('state', 'paid')
      .is('dm_sent_at', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (r.error) {
      console.error('paid_lut_orders query failed', r.error);
      throw new Error(r.error.message || '查询失败');
    }
    state.list = r.data || [];
  }

  function fmtAmount(cents) {
    if (typeof cents !== 'number') return '—';
    return '¥' + (cents / 100).toFixed(2);
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function render() {
    if (!state.list.length) {
      els.summary.textContent = '';
      els.list.innerHTML = '';
      show('lut-admin-empty');
      return;
    }
    hide('lut-admin-empty');
    els.summary.textContent = '共 ' + state.list.length + ' 条待补发订单（最多展示 50 条）';

    var html = '';
    for (var i = 0; i < state.list.length; i++) {
      var row = state.list[i];
      var lut = Array.isArray(row.luts) ? row.luts[0] : row.luts;
      var lutTitle = lut ? lut.title : '(已删除)';
      html += '<li data-id="' + escapeHtml(row.id) + '">';
      html += '  <div>';
      html += '    <div class="title">' + escapeHtml(lutTitle) + '</div>';
      html += '    <div class="meta">订单 ' + escapeHtml(row.order_no)
        + ' · ' + escapeHtml(fmtAmount(row.amount_cents))
        + ' · ' + escapeHtml(fmtTime(row.created_at))
        + ' · user ' + escapeHtml(row.buyer_user_id) + '</div>';
      if (row.dm_error) {
        html += '  <div class="error">' + escapeHtml(row.dm_error) + '</div>';
      }
      html += '  </div>';
      html += '  <button type="button" class="resend-btn" data-id="' +
        escapeHtml(row.id) + '">重新发送</button>';
      html += '</li>';
    }
    els.list.innerHTML = html;
  }

  async function resend(id, btn) {
    if (state.busy[id]) return;
    state.busy[id] = true;
    var origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '发送中…';

    try {
      var accessToken = state.session.access_token;
      var r = await fetch(
        CFG.supabaseUrl + '/functions/v1/' + RESEND_FUNCTION,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + accessToken
          },
          body: JSON.stringify({ orderId: id })
        }
      );
      var body = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        var msg = body && body.error ? body.error : ('http ' + r.status);
        throw new Error('重发失败: ' + msg);
      }
      btn.textContent = '已发送 ✓';
      btn.classList.add('is-ok');
      // Remove row from list after a short delay so admin sees confirmation.
      setTimeout(function () {
        var li = btn.closest('li');
        if (li) li.remove();
        state.list = state.list.filter(function (x) { return x.id !== id; });
        if (!state.list.length) {
          hide('lut-admin-empty');
          els.summary.textContent = '';
          show('lut-admin-empty');
        } else {
          els.summary.textContent = '共 ' + state.list.length + ' 条待补发订单';
        }
      }, 1500);
    } catch (err) {
      console.error('resend failed', err);
      btn.textContent = origText;
      btn.disabled = false;
      alert(err.message || '重发失败');
    } finally {
      state.busy[id] = false;
    }
  }

  function bindList() {
    els.list.addEventListener('click', function (e) {
      var t = e.target;
      if (!(t && t.classList && t.classList.contains('resend-btn'))) return;
      var id = t.getAttribute('data-id');
      if (!id) return;
      resend(id, t);
    });
  }

  async function init() {
    els.loading = $('lut-admin-loading');
    els.denied = $('lut-admin-denied');
    els.deniedMsg = $('lut-admin-denied-msg');
    els.errorMsg = $('lut-admin-error-msg');
    els.content = $('lut-admin-content');
    els.summary = $('lut-admin-summary');
    els.list = $('lut-admin-list');
    els.empty = $('lut-admin-empty');

    $('lut-admin-retry').addEventListener('click', function () {
      hide('lut-admin-error');
      show('lut-admin-loading');
      init();
    });
    bindList();

    if (!isConfigValid()) {
      els.deniedMsg.textContent = 'Supabase 未配置,无法管理订单。';
      hide('lut-admin-loading');
      show('lut-admin-denied');
      return;
    }
    if (!window.LUTSITE_SUPABASE) {
      showError('Supabase 客户端未加载,请刷新页面重试。');
      return;
    }
    state.client = window.LUTSITE_SUPABASE;

    var sessionR = await state.client.auth.getSession();
    state.session = sessionR.data && sessionR.data.session;
    if (!state.session) {
      els.deniedMsg.textContent = '请先登录管理员账号。';
      hide('lut-admin-loading');
      show('lut-admin-denied');
      return;
    }
    var isAdmin = await loadRole(state.session.user.id);
    if (!isAdmin) {
      els.deniedMsg.textContent = '此页面仅对管理员开放。';
      hide('lut-admin-loading');
      show('lut-admin-denied');
      return;
    }

    try {
      await loadOrders();
    } catch (err) {
      showError(err.message || String(err));
      return;
    }
    hide('lut-admin-loading');
    render();
    show('lut-admin-content');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
