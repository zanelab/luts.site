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

  // LUT columns. Fallback: if PR #9 not merged yet, the luts table doesn't
  // have paid/price_cents/afdian_sku_id/afdian_order_url, so the query
  // would 42703 (undefined_column). Retry with COLS_BASIC in that case.
  var COLS_BASIC = 'id, slug, title, description, tags, created_at, updated_at';
  var COLS_FULL = COLS_BASIC + ', paid, price_cents, afdian_sku_id, afdian_order_url';

  var els = {};
  var state = {
    client: null,
    session: null,
    isAdmin: null,
    isAdminUserId: null,
    list: [],
    current: null,
    busy: false,
    deletingId: null
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
      list.appendChild(buildListItem(r));
    });
  }

  function buildListItem(r) {
    var li = document.createElement('li');
    li.dataset.id = r.id;
    var tagsArr = Array.isArray(r.tags) ? r.tags : [];
    li.innerHTML =
      '<div class="title">' +
        renderPaidBadge(r) +
        '<span class="title-text">' + escapeHtml(r.title) + '</span>' +
      '</div>' +
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
    return li;
  }

  function renderPaidBadge(r) {
    if (r.paid && typeof r.price_cents === 'number' && r.price_cents > 0) {
      return '<span class="paid-badge paid-badge--paid">付费 ¥' +
        (r.price_cents / 100).toFixed(2) + '</span>';
    }
    if (r.paid) {
      return '<span class="paid-badge paid-badge--paid-no-price">付费</span>';
    }
    return '<span class="paid-badge paid-badge--free">免费</span>';
  }

  function patchRowInList(r) {
    if (!els.list) return;
    // r.id is a UUID (hex + hyphens), safe for CSS attribute selector.
    var existing = els.list.querySelector('li[data-id="' + r.id + '"]');
    if (!existing) return;
    var fresh = buildListItem(r);
    existing.replaceWith(fresh);
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
    if (action === 'delete') return confirmDelete(row, btn);
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
    // Paid fields. Coerce defensively — page may have loaded without them
    // (PR #9 not merged yet → COLS_BASIC path).
    var paid = !!row.paid;
    var priceCents = typeof row.price_cents === 'number' ? row.price_cents : null;
    var sku = row.afdian_sku_id || '';
    var url = row.afdian_order_url || '';
    els.editPaid.checked = paid;
    els.editPrice.value = (priceCents != null && priceCents > 0) ?
      (priceCents / 100).toFixed(2) : '';
    els.editSku.value = sku;
    els.editUrl.value = url;
    updateCount(els.editTitle, els.editTitleCount, MAX_TITLE_LEN);
    updateCount(els.editDesc, els.editDescCount, MAX_DESC_LEN);
    els.status.textContent = '';
    els.status.className = 'lut-admin-drawer-status';
    updatePaidSectionUi();
    updateValidationUi();
    els.saveBtn.disabled = false;
  }

  function closeDrawer() {
    els.drawer.hidden = true;
    els.drawer.setAttribute('aria-hidden', 'true');
    state.current = null;
    // Clear paid fields so the next open starts blank if state.current
    // is replaced with a row that has paid=false.
    if (els.editPaid) els.editPaid.checked = false;
    if (els.editPrice) els.editPrice.value = '';
    if (els.editSku) els.editSku.value = '';
    if (els.editUrl) els.editUrl.value = '';
    clearPaidFieldErrors();
  }

  function updatePaidSectionUi() {
    if (!els.paidFields || !els.editPaid) return;
    if (els.editPaid.checked) {
      els.paidFields.classList.remove('lut-admin-paid-fields--disabled');
    } else {
      els.paidFields.classList.add('lut-admin-paid-fields--disabled');
    }
  }

  function clearPaidFieldErrors() {
    var fields = ['Price', 'Sku', 'Url'];
    fields.forEach(function (f) {
      var input = els['edit' + f];
      var hint = els['edit' + f + 'Hint'];
      if (input) input.classList.remove('is-invalid');
      if (hint) hint.textContent = '';
    });
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

  // ---- paid fields validation ---------------------------------------------

  function readPaidInputs() {
    return {
      paid: !!(els.editPaid && els.editPaid.checked),
      priceYuan: els.editPrice ? (parseFloat(els.editPrice.value) || 0) : 0,
      sku: els.editSku ? (els.editSku.value || '').trim() : '',
      url: els.editUrl ? (els.editUrl.value || '').trim() : ''
    };
  }

  // Returns null if valid, or a string with the first error message
  // (used by saveEdit to surface a top-of-drawer error).
  function validatePaidFields() {
    var v = readPaidInputs();
    if (!v.paid) return null;
    if (!(v.priceYuan > 0)) return '付费 LUT 必须填价格';
    if (!/^[a-zA-Z0-9]{8,64}$/.test(v.sku)) {
      return '爱发电 SKU 格式不正确（8-64 位字母数字）';
    }
    if (!/^https:\/\/ifdian\.net\//.test(v.url)) {
      return '爱发电商品页 URL 必须以 https://ifdian.net/ 开头';
    }
    return null;
  }

  // Returns { ok: bool, errors: { price?, sku?, url? } } for live UI updates.
  function validatePaidFieldsDetailed() {
    var errs = {};
    var v = readPaidInputs();
    if (!v.paid) return { ok: true, errors: {} };
    if (!(v.priceYuan > 0)) {
      errs.price = '付费 LUT 必须填价格（> 0）';
    }
    if (!v.sku) {
      errs.sku = '必须填爱发电 SKU ID';
    } else if (!/^[a-zA-Z0-9]{8,64}$/.test(v.sku)) {
      errs.sku = 'SKU 格式不正确（8-64 位字母数字）';
    }
    if (!v.url) {
      errs.url = '必须填爱发电商品页 URL';
    } else if (!/^https:\/\/ifdian\.net\//.test(v.url)) {
      errs.url = '必须是 https://ifdian.net/ 开头的链接';
    }
    return { ok: Object.keys(errs).length === 0, errors: errs };
  }

  function updateValidationUi() {
    if (!els.editPaid) return;
    var r = validatePaidFieldsDetailed();
    var fmap = { price: 'Price', sku: 'Sku', url: 'Url' };
    Object.keys(fmap).forEach(function (k) {
      var input = els['edit' + fmap[k]];
      var hint = els['edit' + fmap[k] + 'Hint'];
      if (!input || !hint) return;
      if (r.errors[k]) {
        input.classList.add('is-invalid');
        hint.textContent = r.errors[k];
      } else {
        input.classList.remove('is-invalid');
        hint.textContent = '';
      }
    });
    if (els.saveBtn) {
      // Only the paid fields affect the save button; the existing
      // length-based validation in saveEdit handles the rest. The drawer
      // starts enabled and is disabled only if paid fields are invalid.
      els.saveBtn.disabled = !r.ok;
    }
  }

  async function loadList() {
    if (!state.client) return;
    if (state.loading) return;
    state.loading = true;
    try {
      var r = await state.client
        .from('luts')
        .select(COLS_FULL)
        .order('created_at', { ascending: false })
        .limit(200);
      if (r.error && looksLikeMissingColumn(r.error)) {
        // PR #9 not merged yet — fall back to a column set that exists on
        // main. All paid badges degrade to "免费".
        r = await state.client
          .from('luts')
          .select(COLS_BASIC)
          .order('created_at', { ascending: false })
          .limit(200);
      }
      if (r.error) {
        showError('查询失败：' + r.error.message);
        return;
      }
      state.list = r.data || [];
      normalizePaidFields(state.list);
      renderList();
    } finally {
      state.loading = false;
    }
  }

  function looksLikeMissingColumn(err) {
    if (!err) return false;
    if (err.code === '42703' || err.code === 'PGRST204') return true;
    return /column.*does not exist|undefined column/i.test(err.message || '');
  }

  function normalizePaidFields(list) {
    list.forEach(function (r) {
      if (typeof r.paid === 'undefined') r.paid = false;
      if (typeof r.price_cents === 'undefined') r.price_cents = null;
      if (typeof r.afdian_sku_id === 'undefined') r.afdian_sku_id = null;
      if (typeof r.afdian_order_url === 'undefined') r.afdian_order_url = null;
    });
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

    // Read & validate paid fields.
    var paidIn = readPaidInputs();
    var paidErr = validatePaidFields();
    if (paidErr) {
      setStatus(paidErr, 'error');
      return;
    }
    // Cancellation (paid=false) is allowed to clear all 4 fields.
    var priceCents = (paidIn.paid && paidIn.priceYuan > 0)
      ? Math.round(paidIn.priceYuan * 100) : null;
    var skuVal = (paidIn.paid && paidIn.sku) ? paidIn.sku : null;
    var urlVal = (paidIn.paid && paidIn.url) ? paidIn.url : null;

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
        tags: tags,
        paid: paidIn.paid,
        priceCents: priceCents,
        afdianSkuId: skuVal,
        afdianOrderUrl: urlVal
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

      // Update local state so subsequent edits / list badge see new values.
      var saved = {
        paid: paidIn.paid,
        price_cents: priceCents,
        afdian_sku_id: skuVal,
        afdian_order_url: urlVal
      };
      Object.assign(state.current, saved);
      var idx = state.list.findIndex(function (x) { return x.id === state.current.id; });
      if (idx >= 0) {
        Object.assign(state.list[idx], saved);
        patchRowInList(state.list[idx]);
      }
    } catch (err) {
      setStatus('网络异常', 'error');
    } finally {
      state.busy = false;
      // Don't re-enable if validation says it shouldn't be enabled.
      var v = validatePaidFieldsDetailed();
      els.saveBtn.disabled = !v.ok;
    }
  }

  function setStatus(text, kind) {
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.className = 'lut-admin-drawer-status' + (kind ? ' ' + kind : '');
  }

  function setListStatus(text, kind) {
    if (!els.listStatus) return;
    els.listStatus.textContent = text || '';
    els.listStatus.className = 'lut-admin-list-status' + (kind ? ' ' + kind : '');
  }

  async function confirmDelete(row, btn) {
    if (state.busy) return;
    var msg = '确认删除 LUT「' + (row.title || row.slug) + '」？\n' +
      '将同时删除数据库记录和 storage 中的 .cube 文件。\n' +
      '此操作不可撤销。';
    if (!window.confirm(msg)) return;

    state.busy = true;
    state.deletingId = row.id;

    // Lock the row in place. loadList() will re-render on success and
    // drop the row entirely; on failure we revert the in-place edits.
    var li = btn && btn.closest('li');
    var rowButtons = li
      ? Array.prototype.slice.call(li.querySelectorAll('button'))
      : [];
    var origBtnText = btn ? btn.textContent : null;
    if (li) li.classList.add('is-deleting');
    for (var i = 0; i < rowButtons.length; i++) rowButtons[i].disabled = true;
    if (btn) btn.textContent = '删除中…';
    setListStatus('正在删除「' + (row.title || row.slug) + '」…');

    var revertRow = function () {
      if (li) li.classList.remove('is-deleting');
      for (var j = 0; j < rowButtons.length; j++) rowButtons[j].disabled = false;
      if (btn && origBtnText != null) btn.textContent = origBtnText;
    };

    try {
      var r = await callManage({
        action: 'delete',
        lutId: row.id,
        confirm: true
      });
      if (!r.ok) {
        var code = (r.data && r.data.error) || 'internal';
        setListStatus('删除失败：' + code, 'error');
        window.alert('删除失败：' + code);
        revertRow();
        return;
      }
      setListStatus('已删除「' + (row.title || row.slug) + '」', 'ok');
      // Re-render so the row disappears; auto-clear the status after a beat.
      loadList();
      setTimeout(function () { setListStatus('', ''); }, 2500);
    } catch (err) {
      setListStatus('网络异常', 'error');
      window.alert('网络异常');
      revertRow();
    } finally {
      state.busy = false;
      state.deletingId = null;
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
    if (els.editPaid) {
      els.editPaid.addEventListener('change', function () {
        updatePaidSectionUi();
        updateValidationUi();
      });
    }
    if (els.editPrice) els.editPrice.addEventListener('input', updateValidationUi);
    if (els.editSku) els.editSku.addEventListener('input', updateValidationUi);
    if (els.editUrl) els.editUrl.addEventListener('input', updateValidationUi);
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
    els.listStatus = $('lut-admin-list-status');
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
    els.editPaid = $('lut-admin-edit-paid');
    els.editPrice = $('lut-admin-edit-price');
    els.editSku = $('lut-admin-edit-sku');
    els.editUrl = $('lut-admin-edit-url');
    els.editPriceHint = $('lut-admin-edit-price-hint');
    els.editSkuHint = $('lut-admin-edit-sku-hint');
    els.editUrlHint = $('lut-admin-edit-url-hint');
    els.paidFields = $('lut-admin-paid-fields');
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
