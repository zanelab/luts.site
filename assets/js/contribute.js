/*
 * Contribute page (anonymous).
 *
 * Posts a new LUT submission to the submit-lut Edge Function. No login
 * required. If an admin is signed in, an extra "直接发布" toggle is
 * shown and the JWT is attached to the request.
 */
(function () {
  'use strict';

  var CFG = {
    supabaseUrl: window.LUTSITE_SUPABASE_URL || '',
    anonKey: window.LUTSITE_SUPABASE_ANON_KEY || '',
    turnstileSiteKey: window.LUTSITE_TURNSTILE_SITE_KEY || ''
  };

  // Tied to supabase/functions/submit-lut/index.ts. Not user-configurable;
  // renaming the function requires updating this constant.
  var SUBMIT_LUT_FUNCTION = 'submit-lut';

  var TURNSTILE_KEY_PATTERN = /^0x[A-Za-z0-9_-]+$/;
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var MAX_FILE_SIZE = 10 * 1024 * 1024;
  var MAX_TITLE_LEN = 80;
  var MAX_DESCRIPTION_LEN = 500;
  var MAX_TAGS = 5;
  var MAX_TAG_LEN = 16;

  var ERROR_MESSAGES = {
    forbidden: '权限不足',
    invalid_input: '表单字段不合法，请检查后重试',
    invalid_token: '人机验证失败，请重试',
    rate_limited: '投稿过于频繁，请稍后再试',
    upload_failed: '文件上传失败',
    internal: '服务器异常，请稍后再试',
    network: '网络异常，请检查连接',
    config_missing: '站点配置不完整，无法投稿'
  };

  var els = {};
  var state = {
    client: null,
    isAdmin: false,
    turnstileToken: '',
    turnstileWidgetId: null,
    turnstileRenderAttempts: 0,
    submitting: false
  };

  function $(id) { return document.getElementById(id); }

  function isConfigValid() {
    return /^https:\/\/[a-zA-Z0-9-]+\.supabase\.co/.test(CFG.supabaseUrl) &&
      CFG.anonKey && CFG.anonKey !== 'TODO';
  }

  function isTurnstileConfigured() {
    return TURNSTILE_KEY_PATTERN.test(CFG.turnstileSiteKey);
  }

  function showBanner(msg) {
    if (!els.banner) return;
    els.banner.textContent = msg;
    els.banner.hidden = false;
  }
  function hideBanner() {
    if (!els.banner) return;
    els.banner.hidden = true;
    els.banner.textContent = '';
  }

  function setStatus(msg, kind) {
    if (!els.status) return;
    els.status.textContent = msg || '';
    els.status.className = 'lut-contribute-status' + (kind ? ' ' + kind : '');
  }

  function showFieldError(id, msg) {
    var el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function disableForm() {
    if (els.submit) els.submit.disabled = true;
  }

  function renderTurnstile() {
    if (!els.turnstile) return;
    if (state.turnstileWidgetId !== null) {
      try { window.turnstile.reset(state.turnstileWidgetId); } catch (_e) {}
      return;
    }
    if (!window.turnstile) {
      if (state.turnstileRenderAttempts < 25) {
        state.turnstileRenderAttempts++;
        setTimeout(renderTurnstile, 200);
      } else {
        console.error('[lut-contribute] Turnstile script failed to load');
      }
      return;
    }
    state.turnstileWidgetId = window.turnstile.render(els.turnstile, {
      sitekey: CFG.turnstileSiteKey,
      callback: function (token) {
        state.turnstileToken = token || '';
        validateForm();
      },
      'expired-callback': function () {
        state.turnstileToken = '';
        validateForm();
      },
      'error-callback': function () {
        state.turnstileToken = '';
        validateForm();
      }
    });
  }

  function readFieldError(id) {
    var el = $(id);
    return el && !el.hidden ? el.textContent : null;
  }

  function validateForm() {
    if (!els.submit) return;
    if (state.submitting) { els.submit.disabled = true; return; }
    var fileOk = els.file && els.file.files && els.file.files[0] &&
      els.file.files[0].size > 0 && els.file.files[0].size <= MAX_FILE_SIZE;
    var emailOk = els.email && EMAIL_PATTERN.test((els.email.value || '').trim());
    var titleOk = els.title && els.title.value.trim().length >= 1 &&
      els.title.value.trim().length <= MAX_TITLE_LEN;
    var descOk = els.description && els.description.value.trim().length >= 1 &&
      els.description.value.trim().length <= MAX_DESCRIPTION_LEN;
    var tagsOk = readFieldError('lut-contribute-tags-err') == null;
    var turnstileOk = !isTurnstileConfigured() || !!state.turnstileToken;
    els.submit.disabled = !(fileOk && emailOk && titleOk && descOk && tagsOk && turnstileOk);
  }

  function parseTagsClient(raw) {
    if (!raw) return { ok: true, value: [] };
    var parts = raw.split(',').map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    if (parts.length > MAX_TAGS) return { ok: false, reason: '标签最多 5 个' };
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].length > MAX_TAG_LEN) return { ok: false, reason: '单个标签 ≤ 16 字' };
    }
    return { ok: true, value: parts };
  }

  function updateCounter(field, countEl) {
    if (!field || !countEl) return;
    countEl.textContent = (field.value || '').length;
  }

  async function loadRole(userId) {
    if (!userId || !state.client) return false;
    try {
      var r = await state.client.from('users').select('role').eq('id', userId).maybeSingle();
      if (r.error || !r.data) return false;
      return r.data.role === 'admin';
    } catch (_e) { return false; }
  }

  async function refreshAdmin() {
    if (!state.client) return;
    try {
      var sess = await state.client.auth.getSession();
      var session = sess && sess.data && sess.data.session;
      if (!session) {
        state.isAdmin = false;
        if (els.directWrap) els.directWrap.hidden = true;
        return;
      }
      state.isAdmin = await loadRole(session.user.id);
      if (els.directWrap) els.directWrap.hidden = !state.isAdmin;
    } catch (_e) {
      state.isAdmin = false;
      if (els.directWrap) els.directWrap.hidden = true;
    }
  }

  async function submitForm(e) {
    e.preventDefault();
    if (state.submitting) return;
    hideBanner();
    setStatus('');

    var email = (els.email.value || '').trim();
    if (!EMAIL_PATTERN.test(email)) {
      showFieldError('lut-contribute-email-err', '请填写有效邮箱');
      return;
    }
    showFieldError('lut-contribute-email-err', null);

    var file = els.file && els.file.files && els.file.files[0];
    if (!file) {
      showFieldError('lut-contribute-file-err', '请选择 .cube 文件');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      showFieldError('lut-contribute-file-err', '文件不能超过 10MB');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.cube')) {
      showFieldError('lut-contribute-file-err', '仅支持 .cube 文件');
      return;
    }
    showFieldError('lut-contribute-file-err', null);

    var title = (els.title.value || '').trim();
    var description = (els.description.value || '').trim();
    if (title.length < 1 || title.length > MAX_TITLE_LEN) {
      showFieldError('lut-contribute-title-err', '标题需 1-80 字');
      return;
    }
    showFieldError('lut-contribute-title-err', null);
    if (description.length < 1 || description.length > MAX_DESCRIPTION_LEN) {
      showFieldError('lut-contribute-desc-err', '描述需 1-500 字');
      return;
    }
    showFieldError('lut-contribute-desc-err', null);

    var tagsResult = parseTagsClient(els.tags.value || '');
    if (!tagsResult.ok) {
      showFieldError('lut-contribute-tags-err', tagsResult.reason);
      return;
    }
    showFieldError('lut-contribute-tags-err', null);

    var fd = new FormData();
    fd.append('file', file);
    fd.append('email', email);
    fd.append('title', title);
    fd.append('description', description);
    fd.append('tags', tagsResult.value.join(','));
    fd.append('turnstileToken', state.turnstileToken);
    fd.append('direct_publish', state.isAdmin && els.direct && els.direct.checked ? 'true' : 'false');

    state.submitting = true;
    if (els.submit) els.submit.disabled = true;
    setStatus('投稿中…');

    var headers = {
      'apikey': CFG.anonKey,
      'Authorization': 'Bearer ' + CFG.anonKey
    };
    var accessToken = null;
    if (state.client) {
      try {
        var sess = await state.client.auth.getSession();
        accessToken = sess && sess.data && sess.data.session && sess.data.session.access_token;
      } catch (_e) { accessToken = null; }
    }
    if (accessToken) headers['Authorization'] = 'Bearer ' + accessToken;

    try {
      var url = CFG.supabaseUrl + '/functions/v1/' + SUBMIT_LUT_FUNCTION;
      var res = await fetch(url, { method: 'POST', headers: headers, body: fd });
      var data = null;
      try { data = await res.json(); } catch (_e) { data = null; }
      if (!res.ok) {
        var code = (data && data.error) || 'internal';
        setStatus(ERROR_MESSAGES[code] || ERROR_MESSAGES.internal, 'error');
        if (isTurnstileConfigured() && state.turnstileWidgetId !== null) {
          try { window.turnstile.reset(state.turnstileWidgetId); } catch (_e) {}
          state.turnstileToken = '';
        }
        validateForm();
        return;
      }
      // success: show success state, hide form
      if (els.form) els.form.hidden = true;
      if (els.success) {
        els.success.hidden = false;
        var idEl = $('lut-contribute-success-id');
        var emailEl = $('lut-contribute-success-email');
        if (idEl) idEl.textContent = (data && data.submissionId) || '?';
        if (emailEl) emailEl.textContent = email;
        if (data && data.status === 'published' && data.lutId) {
          // admin direct publish: replace the success message
          var successMsg = els.success.querySelector('h3');
          if (successMsg) successMsg.textContent = '已直接发布';
          var statusSpan = els.success.querySelector('.lut-mine-badge');
          if (statusSpan) {
            statusSpan.textContent = '已发布';
            statusSpan.classList.remove('pending');
            statusSpan.classList.add('approved');
          }
          var idP = els.success.querySelector('p:nth-of-type(2)');
          if (idP) idP.innerHTML = 'luts.id = <code>' + data.lutId + '</code>（复制到 _luts/' + (data.slug || '?') + '.md 的 lutId: 字段）';
        }
      }
    } catch (err) {
      setStatus(ERROR_MESSAGES.network, 'error');
      validateForm();
    } finally {
      state.submitting = false;
    }
  }

  function updateFileSelectedUI() {
    var f = els.file && els.file.files && els.file.files[0];
    if (!els.dropzoneEmpty || !els.dropzoneSelected) return;
    if (!f) {
      els.dropzoneEmpty.hidden = false;
      els.dropzoneSelected.hidden = true;
      return;
    }
    els.dropzoneEmpty.hidden = true;
    els.dropzoneSelected.hidden = false;
    if (els.fileName) els.fileName.textContent = f.name;
    if (els.fileSize) els.fileSize.textContent = formatFileSize(f.size);
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function bindFileDropzone() {
    if (!els.file || !els.dropzone) return;
    var dz = els.dropzone;
    var dragDepth = 0;

    dz.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer || !Array.prototype.some.call(e.dataTransfer.types || [], function (t) { return t === 'Files'; })) return;
      e.preventDefault();
      dragDepth++;
      dz.classList.add('is-dragover');
    });
    dz.addEventListener('dragover', function (e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    dz.addEventListener('dragleave', function (e) {
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) dz.classList.remove('is-dragover');
    });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      dz.classList.remove('is-dragover');
      var dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;
      try {
        els.file.files = dt.files;
      } catch (_err) {
        // Some browsers reject direct assignment; fall back to manual file.
        return;
      }
      els.file.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // Prevent the browser from opening the file when dropped outside the zone.
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
  }

  function bindEvents() {
    if (els.file) {
      els.file.addEventListener('change', function () {
        var f = els.file.files && els.file.files[0];
        if (!f) { showFieldError('lut-contribute-file-err', null); updateFileSelectedUI(); validateForm(); return; }
        if (f.size > MAX_FILE_SIZE) {
          showFieldError('lut-contribute-file-err', '文件不能超过 10MB');
        } else if (!f.name.toLowerCase().endsWith('.cube')) {
          showFieldError('lut-contribute-file-err', '仅支持 .cube 文件');
        } else {
          showFieldError('lut-contribute-file-err', null);
        }
        updateFileSelectedUI();
        validateForm();
      });
    }
    if (els.email) {
      els.email.addEventListener('input', function () {
        var v = (els.email.value || '').trim();
        if (v && !EMAIL_PATTERN.test(v)) {
          showFieldError('lut-contribute-email-err', '请填写有效邮箱');
        } else {
          showFieldError('lut-contribute-email-err', null);
        }
        validateForm();
      });
    }
    if (els.title) {
      els.title.addEventListener('input', function () {
        updateCounter(els.title, els.titleCount);
        showFieldError('lut-contribute-title-err', null);
        validateForm();
      });
    }
    if (els.description) {
      els.description.addEventListener('input', function () {
        updateCounter(els.description, els.descCount);
        showFieldError('lut-contribute-desc-err', null);
        validateForm();
      });
    }
    if (els.tags) {
      els.tags.addEventListener('input', function () {
        var r = parseTagsClient(els.tags.value || '');
        if (!r.ok) showFieldError('lut-contribute-tags-err', r.reason);
        else showFieldError('lut-contribute-tags-err', null);
        validateForm();
      });
    }
    if (els.form) els.form.addEventListener('submit', submitForm);
  }

  function init() {
    els.banner = $('lut-contribute-banner');
    els.form = $('lut-contribute-form');
    els.success = $('lut-contribute-success');
    els.file = $('lut-contribute-file');
    els.dropzone = $('lut-contribute-dropzone');
    els.dropzoneEmpty = els.dropzone ? els.dropzone.querySelector('.lut-contribute-dropzone-empty') : null;
    els.dropzoneSelected = els.dropzone ? els.dropzone.querySelector('.lut-contribute-dropzone-selected') : null;
    els.fileName = $('lut-contribute-file-name');
    els.fileSize = $('lut-contribute-file-size');
    els.email = $('lut-contribute-email');
    els.title = $('lut-contribute-title');
    els.description = $('lut-contribute-description');
    els.tags = $('lut-contribute-tags');
    els.directWrap = $('lut-contribute-direct-wrap');
    els.direct = $('lut-contribute-direct');
    els.turnstile = $('lut-contribute-turnstile');
    els.submit = $('lut-contribute-submit');
    els.status = $('lut-contribute-status');
    els.titleCount = $('lut-contribute-title-count');
    els.descCount = $('lut-contribute-desc-count');

    if (!isConfigValid()) {
      showBanner(ERROR_MESSAGES.config_missing);
      disableForm();
      return;
    }
    if (!window.supabase || !window.supabase.createClient) {
      showBanner('Supabase 客户端未加载');
      disableForm();
      return;
    }

    state.client = window.supabase.createClient(CFG.supabaseUrl, CFG.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    state.client.auth.onAuthStateChange(function () {
      refreshAdmin();
      if (isTurnstileConfigured()) renderTurnstile();
    });
    bindFileDropzone();
    bindEvents();
    refreshAdmin();
    if (isTurnstileConfigured()) renderTurnstile();
    else { showBanner('人机验证未配置：投稿功能暂不可用'); disableForm(); }
    validateForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
