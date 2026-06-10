/*
 * LUT Download flow
 *
 * Reads runtime config from window.LUTSITE_*, wires up the trigger button,
 * Cloudflare Turnstile widget, and Supabase Edge Function call.
 * Sensitive values are injected at build time via script/build-config.sh.
 */
(function () {
  'use strict';

  var CFG = {
    supabaseUrl: window.LUTSITE_SUPABASE_URL || '',
    anonKey: window.LUTSITE_SUPABASE_ANON_KEY || '',
    edgeFn: window.LUTSITE_SUPABASE_EDGE_FUNCTION || '',
    turnstileSiteKey: window.LUTSITE_TURNSTILE_SITE_KEY || ''
  };

  var TURNSTILE_KEY_PATTERN = /^0x[A-Za-z0-9_-]+$/;
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var SUCCESS_AUTOCLOSE_MS = 3000;
  var TBD_WARNED = false;

  var ERROR_MESSAGES = {
    invalid_email: '邮箱格式不正确',
    invalid_token: '人机验证失败，请重试',
    lut_not_found: '该 LUT 暂未提供下载',
    rate_limited: '请求过于频繁，请稍后再试',
    internal: '服务器异常，请稍后再试',
    network: '网络异常，请检查连接'
  };

  var state = {
    supabaseClient: null,
    turnstileWidgetId: null,
    turnstileToken: '',
    lastTrigger: null,
    autoCloseTimer: null,
    mode: 'idle'
  };

  function isConfigValid() {
    return /^https:\/\/[a-zA-Z0-9-]+\.supabase\.co/.test(CFG.supabaseUrl) &&
      CFG.anonKey && CFG.anonKey !== 'TODO' &&
      CFG.edgeFn && CFG.edgeFn !== 'TODO';
  }

  function isTurnstileConfigured() {
    return TURNSTILE_KEY_PATTERN.test(CFG.turnstileSiteKey);
  }

  function init() {
    var modal = document.getElementById('lut-download-modal');
    if (!modal) return;

    var triggers = document.querySelectorAll('.lut-download-trigger');
    if (!triggers.length) return;

    Array.prototype.forEach.call(triggers, function (btn) {
      btn.addEventListener('click', function () {
        openModal(btn, modal);
      });
    });

    modal.addEventListener('cancel', function (e) {
      e.preventDefault();
    });

    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    modal.addEventListener('close', function () {
      handleModalClosed(modal);
    });

    var closeBtn = modal.querySelector('.lut-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        closeModal(modal);
      });
    }

    var submitBtn = modal.querySelector('.lut-modal-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', function () {
        if (state.mode === 'success') {
          closeModal(modal);
        } else {
          handleSubmit(modal);
        }
      });
    }
  }

  function openModal(triggerBtn, modal) {
    state.lastTrigger = triggerBtn;
    var lutId = triggerBtn.getAttribute('data-lut-id') || '';
    var lutTitle = triggerBtn.getAttribute('data-lut-title') || '';
    modal.dataset.lutId = lutId;
    modal.dataset.lutTitle = lutTitle;

    resetModalState(modal);

    var errorBanner = modal.querySelector('.lut-modal-error-banner');
    var submitBtn = modal.querySelector('.lut-modal-submit');
    if (!isTurnstileConfigured()) {
      errorBanner.textContent = '人机验证未配置，无法发送下载邮件。请联系网站管理员。';
      errorBanner.hidden = false;
      if (submitBtn) submitBtn.disabled = true;
    } else {
      errorBanner.hidden = true;
      renderTurnstile(modal);
    }

    if (typeof modal.showModal === 'function') {
      modal.showModal();
    } else {
      modal.setAttribute('open', '');
    }

    var emailInput = modal.querySelector('input[type="email"]');
    if (emailInput) {
      setTimeout(function () {
        try { emailInput.focus(); } catch (e) {}
      }, 50);
    }
  }

  function closeModal(modal) {
    if (state.autoCloseTimer) {
      clearTimeout(state.autoCloseTimer);
      state.autoCloseTimer = null;
    }
    if (typeof modal.close === 'function' && modal.open) {
      modal.close();
    } else {
      modal.removeAttribute('open');
      handleModalClosed(modal);
    }
  }

  function handleModalClosed(modal) {
    if (state.turnstileWidgetId !== null && window.turnstile && typeof window.turnstile.remove === 'function') {
      try { window.turnstile.remove(state.turnstileWidgetId); } catch (e) {}
    }
    state.turnstileWidgetId = null;
    state.turnstileToken = '';
    state.mode = 'idle';
    if (state.lastTrigger) {
      try { state.lastTrigger.focus(); } catch (e) {}
    }
  }

  function resetModalState(modal) {
    state.mode = 'idle';
    state.turnstileToken = '';

    var emailInput = modal.querySelector('input[type="email"]');
    if (emailInput) emailInput.value = '';

    var submitBtn = modal.querySelector('.lut-modal-submit');
    var submitLabel = modal.querySelector('.lut-modal-submit-label');
    if (submitBtn) submitBtn.disabled = true;
    if (submitLabel) submitLabel.textContent = '发送到我的邮箱';

    var status = modal.querySelector('.lut-modal-status');
    if (status) {
      status.hidden = true;
      status.className = 'lut-modal-status';
      status.textContent = '';
    }
  }

  function renderTurnstile(modal, attempt) {
    attempt = attempt || 0;
    if (!window.turnstile) {
      if (attempt < 25) {
        setTimeout(function () { renderTurnstile(modal, attempt + 1); }, 200);
      } else {
        console.error('[lut-download] Turnstile script failed to load');
        var banner = modal.querySelector('.lut-modal-error-banner');
        if (banner) {
          banner.textContent = '人机验证加载失败，请刷新页面后重试。';
          banner.hidden = false;
        }
      }
      return;
    }

    var container = modal.querySelector('.lut-modal-turnstile');
    var submitBtn = modal.querySelector('.lut-modal-submit');
    if (!container) return;

    if (state.turnstileWidgetId !== null) {
      try { window.turnstile.remove(state.turnstileWidgetId); } catch (e) {}
      state.turnstileWidgetId = null;
    }

    container.setAttribute('data-sitekey', CFG.turnstileSiteKey);
    container.innerHTML = '';

    try {
      state.turnstileWidgetId = window.turnstile.render(container, {
        sitekey: CFG.turnstileSiteKey,
        callback: function (token) {
          state.turnstileToken = token || '';
          if (submitBtn && state.mode !== 'submitting') submitBtn.disabled = false;
        },
        'expired-callback': function () {
          state.turnstileToken = '';
          if (submitBtn) submitBtn.disabled = true;
          if (window.turnstile && state.turnstileWidgetId !== null) {
            try { window.turnstile.reset(state.turnstileWidgetId); } catch (e) {}
          }
        },
        'error-callback': function () {
          state.turnstileToken = '';
          if (submitBtn) submitBtn.disabled = true;
        }
      });
    } catch (e) {
      console.error('[lut-download] Turnstile render failed', e);
    }
  }

  function handleSubmit(modal) {
    var emailInput = modal.querySelector('input[type="email"]');
    var submitBtn = modal.querySelector('.lut-modal-submit');
    var submitLabel = modal.querySelector('.lut-modal-submit-label');
    var status = modal.querySelector('.lut-modal-status');

    var email = ((emailInput && emailInput.value) || '').trim();
    if (!email) {
      showStatus(status, 'is-error', '请填写邮箱地址');
      if (emailInput) emailInput.focus();
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      showStatus(status, 'is-error', ERROR_MESSAGES.invalid_email);
      if (emailInput) emailInput.focus();
      return;
    }

    var lutId = modal.dataset.lutId || '';

    if (!lutId || lutId.indexOf('TBD-') === 0) {
      if (!TBD_WARNED) {
        console.warn('[lut-download] lutId is placeholder "' + lutId + '". Backfill the real ID from Supabase to enable downloads.');
        TBD_WARNED = true;
      }
      showStatus(status, 'is-error', ERROR_MESSAGES.lut_not_found);
      return;
    }

    if (!isConfigValid()) {
      showStatus(status, 'is-error', '下载服务尚未配置，请联系网站管理员。');
      return;
    }

    if (!state.turnstileToken) {
      showStatus(status, 'is-error', '请先完成人机验证');
      return;
    }

    state.mode = 'submitting';
    if (submitBtn) submitBtn.disabled = true;
    if (submitLabel) submitLabel.innerHTML = '<span class="lut-modal-submit-spinner"></span>发送中…';
    if (status) {
      status.hidden = true;
      status.className = 'lut-modal-status';
      status.textContent = '';
    }

    var client = getSupabaseClient();
    if (!client) {
      showError(modal, ERROR_MESSAGES.internal);
      return;
    }

    client.functions.invoke(CFG.edgeFn, {
      body: { lutId: lutId, email: email, turnstileToken: state.turnstileToken }
    }).then(function (resp) {
      var data = resp && resp.data;
      var err = resp && resp.error;

      if (err) {
        var code = extractErrorCode(err);
        showError(modal, ERROR_MESSAGES[code] || ERROR_MESSAGES.internal);
        return;
      }

      if (data && data.ok) {
        var msg = data.message || ('已发送到 ' + email + '，请在邮件中点击下载链接（30 分钟内有效）。');
        showSuccess(modal, msg);
      } else if (data && data.error) {
        showError(modal, ERROR_MESSAGES[data.error] || ERROR_MESSAGES.internal);
      } else {
        showError(modal, ERROR_MESSAGES.internal);
      }
    }).catch(function (err) {
      console.error('[lut-download] request failed', err);
      showError(modal, ERROR_MESSAGES.network);
    });
  }

  function extractErrorCode(err) {
    if (!err) return 'internal';
    if (err.context && typeof err.context.body === 'string') {
      try {
        var parsed = JSON.parse(err.context.body);
        if (parsed && parsed.error) return parsed.error;
      } catch (e) {}
    }
    if (err.message && ERROR_MESSAGES[err.message]) return err.message;
    return 'internal';
  }

  function showError(modal, msg) {
    state.mode = 'error';
    var status = modal.querySelector('.lut-modal-status');
    var submitBtn = modal.querySelector('.lut-modal-submit');
    var submitLabel = modal.querySelector('.lut-modal-submit-label');
    showStatus(status, 'is-error', msg);
    if (submitLabel) submitLabel.textContent = '重试';
    state.turnstileToken = '';
    if (submitBtn) submitBtn.disabled = true;
    if (window.turnstile && state.turnstileWidgetId !== null) {
      try { window.turnstile.reset(state.turnstileWidgetId); } catch (e) {}
    }
  }

  function showSuccess(modal, msg) {
    state.mode = 'success';
    var status = modal.querySelector('.lut-modal-status');
    var submitBtn = modal.querySelector('.lut-modal-submit');
    var submitLabel = modal.querySelector('.lut-modal-submit-label');
    showStatus(status, 'is-success', msg);
    if (submitLabel) submitLabel.textContent = '完成';
    if (submitBtn) submitBtn.disabled = false;

    if (state.autoCloseTimer) clearTimeout(state.autoCloseTimer);
    state.autoCloseTimer = setTimeout(function () {
      closeModal(modal);
    }, SUCCESS_AUTOCLOSE_MS);
  }

  function showStatus(statusEl, cls, msg) {
    if (!statusEl) return;
    statusEl.className = 'lut-modal-status ' + cls;
    statusEl.textContent = msg;
    statusEl.hidden = false;
  }

  function getSupabaseClient() {
    if (state.supabaseClient) return state.supabaseClient;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.error('[lut-download] supabase-js not loaded');
      return null;
    }
    try {
      state.supabaseClient = window.supabase.createClient(CFG.supabaseUrl, CFG.anonKey);
    } catch (e) {
      console.error('[lut-download] failed to init supabase client', e);
      return null;
    }
    return state.supabaseClient;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
