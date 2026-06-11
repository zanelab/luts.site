/*
 * Auth-aware top-nav slot.
 *
 * Two-step OTP sign-in for admins:
 *   1. Email step:  user types email → signInWithOtp({ shouldCreateUser: true })
 *   2. Code step:   6 independent digit inputs → verifyOtp({ email, token, type: 'email' })
 *
 * Page must include assets/js/supabase-config.js (window.LUTSITE_*) BEFORE
 * this script runs. supabase-js@2 loads deferred from head-scripts.html.
 *
 * If Supabase is not configured, the whole .auth-nav node is hidden to
 * avoid a broken UI. Only used for admin sign-in — /contribute/ is anonymous.
 */
(function () {
  'use strict';

  var RESEND_COOLDOWN_SEC = 60;
  var CODE_LEN = 6;
  var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  var ERROR_MESSAGES = {
    otp_expired: '验证码已过期，请重新发送',
    token_invalid: '验证码不正确',
    email_rate_limit_exceeded: '请求过于频繁，请稍后再试',
    over_email_send_rate_limit: '请求过于频繁，请稍后再试',
    network: '网络异常，请重试'
  };

  var supabaseUrl = window.LUTSITE_SUPABASE_URL;
  var anonKey = window.LUTSITE_SUPABASE_ANON_KEY;

  // Role cache, keyed by user.id. Reset on sign out. Stops
  // auth-nav.js from re-querying /users on every auth state event.
  var roleCache = { userId: null, role: null };

  if (!supabaseUrl || !anonKey || supabaseUrl === 'TODO' || anonKey === 'TODO') {
    var el = document.getElementById('auth-nav');
    if (el) el.style.display = 'none';
    return;
  }
  if (!window.LUTSITE_SUPABASE) return;

  var client = window.LUTSITE_SUPABASE;

  var els = {};
  var state = {
    email: '',
    cooldown: 0,
    verifying: false,
    cooldownTimer: null
  };

  function showEmail(email) {
    if (els.codeEmail) els.codeEmail.textContent = email || '';
  }

  function $(id) { return document.getElementById(id); }

  function setMsg(text, kind) {
    if (!els.msg) return;
    els.msg.textContent = text || '';
    els.msg.className = 'auth-nav-modal-msg' + (kind ? ' ' + kind : '');
  }

  function showStep(name) {
    if (els.stepEmail) els.stepEmail.hidden = name !== 'email';
    if (els.stepCode) els.stepCode.hidden = name !== 'code';
  }

  function openModal() {
    if (!els.modal) return;
    setMsg('');
    showStep('email');
    if (els.emailInput) els.emailInput.value = state.email || '';
    els.modal.hidden = false;
    setTimeout(function () {
      try { els.emailInput.focus(); } catch (_e) {}
    }, 50);
  }
  function closeModal() {
    if (!els.modal) return;
    els.modal.hidden = true;
    if (state.cooldownTimer) {
      clearInterval(state.cooldownTimer);
      state.cooldownTimer = null;
    }
    state.cooldown = 0;
    state.verifying = false;
    updateResendButton();
  }

  function setSignedOut() {
    if (els.signinBtn) els.signinBtn.hidden = false;
    if (els.userBox) els.userBox.hidden = true;
  }
  function setSignedIn(user, role) {
    if (els.signinBtn) els.signinBtn.hidden = true;
    if (els.userBox) els.userBox.hidden = false;
    var email = (user && user.email) || '';
    if (els.initial) els.initial.textContent = email ? email[0].toUpperCase() : '?';
    if (els.adminItem) els.adminItem.hidden = role !== 'admin';
  }

  async function loadRole(userId) {
    if (!userId) return 'user';
    if (roleCache.userId === userId && roleCache.role !== null) return roleCache.role;
    try {
      var r = await client.from('users').select('role').eq('id', userId).maybeSingle();
      if (r.error || !r.data) {
        roleCache = { userId: userId, role: 'user' };
        return 'user';
      }
      roleCache = { userId: userId, role: r.data.role || 'user' };
      return roleCache.role;
    } catch (_e) {
      roleCache = { userId: userId, role: 'user' };
      return 'user';
    }
  }

  async function refresh() {
    try {
      var sess = await client.auth.getSession();
      var session = sess && sess.data && sess.data.session;
      if (!session) { setSignedOut(); autoOpenIfEligible(); return; }
      var role = await loadRole(session.user.id);
      setSignedIn(session.user, role);
    } catch (err) {
      console.warn('auth-nav refresh failed', err);
      setSignedOut();
    }
  }

  // ===== Auto-open modal on admin pages when signed out ====================

  function autoOpenIfEligible() {
    try {
      if (!document.body || document.body.dataset.authAutoOpen !== 'true') return;
      openModal();
    } catch (err) {
      console.warn('auth-nav autoOpen failed', err);
    }
  }

  // ===== Step 1: email → send code =========================================

  async function submitEmail(e) {
    e.preventDefault();
    var email = (els.emailInput && els.emailInput.value || '').trim();
    if (!EMAIL_PATTERN.test(email)) {
      setMsg('请填写有效邮箱', 'error');
      return;
    }
    if (els.emailSubmit) els.emailSubmit.disabled = true;
    setMsg('发送中…');
    try {
      var r = await client.auth.signInWithOtp({
        email: email,
        options: { shouldCreateUser: true }
      });
      if (r.error) {
        setMsg(ERROR_MESSAGES[r.error.code] || ('发送失败：' + (r.error.message || '')), 'error');
        return;
      }
      state.email = email;
      showEmail(email);
      setMsg('验证码已发送到 ' + email, 'ok');
      showStep('code');
      clearCodeInputs();
      startCooldown();
      setTimeout(function () {
        try { els.codeInputs[0].focus(); } catch (_e) {}
      }, 50);
    } catch (err) {
      setMsg(ERROR_MESSAGES.network, 'error');
    } finally {
      if (els.emailSubmit) els.emailSubmit.disabled = false;
    }
  }

  // ===== Step 2: 6-digit code ===============================================

  function clearCodeInputs() {
    if (!els.codeInputs) return;
    for (var i = 0; i < els.codeInputs.length; i++) {
      els.codeInputs[i].value = '';
    }
  }
  function readCode() {
    if (!els.codeInputs) return '';
    var s = '';
    for (var i = 0; i < els.codeInputs.length; i++) {
      s += (els.codeInputs[i].value || '');
    }
    return s;
  }

  function onCodeInput(idx, e) {
    var v = (e.target.value || '').replace(/\D/g, '');
    e.target.value = v.slice(0, 1);
    if (e.target.value && idx < els.codeInputs.length - 1) {
      els.codeInputs[idx + 1].focus();
    }
    // Auto-verify when full
    if (readCode().length === CODE_LEN && !state.verifying) {
      verifyCode();
    }
  }
  function onCodeKeydown(idx, e) {
    if (e.key === 'Backspace' && !e.target.value && idx > 0) {
      els.codeInputs[idx - 1].focus();
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault();
      els.codeInputs[idx - 1].focus();
    } else if (e.key === 'ArrowRight' && idx < els.codeInputs.length - 1) {
      e.preventDefault();
      els.codeInputs[idx + 1].focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (readCode().length === CODE_LEN) verifyCode();
    }
  }
  function onCodePaste(e) {
    var data = (e.clipboardData || window.clipboardData).getData('text') || '';
    var digits = data.replace(/\D/g, '').slice(0, CODE_LEN);
    if (!digits) return;
    e.preventDefault();
    for (var i = 0; i < digits.length && i < els.codeInputs.length; i++) {
      els.codeInputs[i].value = digits[i];
    }
    var last = Math.min(digits.length, els.codeInputs.length) - 1;
    if (last >= 0) els.codeInputs[last].focus();
    if (digits.length === CODE_LEN && !state.verifying) verifyCode();
  }

  async function verifyCode() {
    var token = readCode();
    if (token.length !== CODE_LEN || state.verifying) return;
    state.verifying = true;
    setMsg('验证中…');
    try {
      var r = await client.auth.verifyOtp({
        email: state.email,
        token: token,
        type: 'email'
      });
      if (r.error) {
        var code = r.error.code || r.error.status || 'unknown';
        setMsg(ERROR_MESSAGES[code] || '验证失败，请重试', 'error');
        clearCodeInputs();
        try { els.codeInputs[0].focus(); } catch (_e) {}
        return;
      }
      // success
      setMsg('登录成功');
      closeModal();
      await refresh();
    } catch (err) {
      setMsg(ERROR_MESSAGES.network, 'error');
    } finally {
      state.verifying = false;
    }
  }

  // ===== Resend cooldown ====================================================

  function startCooldown() {
    if (state.cooldownTimer) clearInterval(state.cooldownTimer);
    state.cooldown = RESEND_COOLDOWN_SEC;
    updateResendButton();
    state.cooldownTimer = setInterval(function () {
      state.cooldown--;
      if (state.cooldown <= 0) {
        clearInterval(state.cooldownTimer);
        state.cooldownTimer = null;
        state.cooldown = 0;
      }
      updateResendButton();
    }, 1000);
  }
  function updateResendButton() {
    if (!els.resendBtn) return;
    if (state.cooldown > 0) {
      els.resendBtn.disabled = true;
      els.resendBtn.textContent = '重新发送 (' + state.cooldown + 's)';
    } else {
      els.resendBtn.disabled = false;
      els.resendBtn.textContent = '重新发送';
    }
  }
  async function resendCode(e) {
    e.preventDefault();
    if (state.cooldown > 0 || !state.email) return;
    setMsg('重新发送中…');
    try {
      var r = await client.auth.signInWithOtp({
        email: state.email,
        options: { shouldCreateUser: true }
      });
      if (r.error) {
        setMsg(ERROR_MESSAGES[r.error.code] || ('发送失败：' + (r.error.message || '')), 'error');
        return;
      }
      setMsg('验证码已重新发送到 ' + state.email, 'ok');
      startCooldown();
    } catch (err) {
      setMsg(ERROR_MESSAGES.network, 'error');
    }
  }

  function backToEmail(e) {
    e.preventDefault();
    showStep('email');
    setMsg('');
    if (state.cooldownTimer) {
      clearInterval(state.cooldownTimer);
      state.cooldownTimer = null;
    }
    state.cooldown = 0;
    setTimeout(function () {
      try { els.emailInput.focus(); } catch (_e) {}
    }, 50);
  }

  // ===== Wire up ============================================================

  function bindEvents() {
    if (els.signinBtn) els.signinBtn.addEventListener('click', openModal);
    if (els.modalClose) els.modalClose.addEventListener('click', closeModal);
    if (els.modal) {
      els.modal.addEventListener('click', function (e) {
        if (e.target === els.modal) closeModal();
      });
    }
    if (els.emailForm) els.emailForm.addEventListener('submit', submitEmail);
    if (els.changeEmail) els.changeEmail.addEventListener('click', backToEmail);
    if (els.resendBtn) els.resendBtn.addEventListener('click', resendCode);
    if (els.codeInputs) {
      for (var i = 0; i < els.codeInputs.length; i++) {
        els.codeInputs[i].addEventListener('input', onCodeInput.bind(null, i));
        els.codeInputs[i].addEventListener('keydown', onCodeKeydown.bind(null, i));
        els.codeInputs[i].addEventListener('paste', onCodePaste);
        els.codeInputs[i].addEventListener('focus', function (e) {
          // select existing content so re-typing replaces it
          setTimeout(function () { try { e.target.select(); } catch (_e) {} }, 0);
        });
      }
    }
    if (els.avatarBtn && els.dropdown) {
      els.avatarBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = !els.dropdown.hidden;
        els.dropdown.hidden = open;
        els.avatarBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
      document.addEventListener('click', function (e) {
        if (els.userBox && !els.userBox.contains(e.target)) {
          els.dropdown.hidden = true;
          els.avatarBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }
    if (els.signoutBtn) {
      els.signoutBtn.addEventListener('click', async function () {
        try { await client.auth.signOut(); } catch (_e) {}
        roleCache = { userId: null, role: null };
        els.dropdown.hidden = true;
        setSignedOut();
      });
    }
  }

  function init() {
    els.signinBtn = $('auth-nav-signin');
    els.userBox = document.querySelector('.auth-nav-user');
    els.initial = document.querySelector('.auth-nav-initial');
    els.avatarBtn = $('auth-nav-avatar');
    els.dropdown = $('auth-nav-dropdown');
    els.adminItem = document.querySelector('.auth-nav-admin');
    els.signoutBtn = $('auth-nav-signout');
    els.modal = $('auth-nav-modal');
    els.modalClose = $('auth-nav-modal-close');
    els.msg = $('auth-nav-modal-msg');
    els.stepEmail = $('auth-nav-step-email');
    els.stepCode = $('auth-nav-step-code');
    els.emailForm = $('auth-nav-email-form');
    els.emailInput = $('auth-nav-email');
    els.emailSubmit = $('auth-nav-email-submit');
    els.codeInputs = document.querySelectorAll('.auth-nav-code-input');
    els.resendBtn = $('auth-nav-resend');
    els.changeEmail = $('auth-nav-change-email');
    els.codeEmail = $('auth-nav-code-email');

    bindEvents();
    // Filter events: skip the redundant INITIAL_SESSION (we already trigger
    // refresh() below) and TOKEN_REFRESHED (JWT renewal doesn't change
    // user/role — would otherwise re-query /users every ~hour).
    client.auth.onAuthStateChange(function (event) {
      if (event === 'INITIAL_SESSION') return;
      if (event === 'TOKEN_REFRESHED') return;
      refresh();
    });
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
