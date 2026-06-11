/*
 * Single shared Supabase client for the page.
 *
 * Both auth-nav.js and admin-submissions.js previously called
 * createClient independently, producing two GoTrueClient instances
 * on the same localStorage key. That triggers GoTrueClient's
 * "Multiple GoTrueClient instances" warning and causes the auth
 * state to thrash — events fire in the wrong order and SIGNED_IN
 * can re-emit after every mutation by the sibling client, which
 * makes loadRole() re-query /users on every event.
 *
 * Load order in head-scripts.html:
 *   1. supabase-js@2 (CDN)
 *   2. supabase-config.js (window.LUTSITE_SUPABASE_URL / _ANON_KEY)
 *   3. this file
 * The two consumers (auth-nav.js, admin-submissions.js) load later
 * and read window.LUTSITE_SUPABASE instead of creating their own.
 */
(function () {
  'use strict';
  if (window.LUTSITE_SUPABASE) return;
  if (!window.supabase || !window.supabase.createClient) return;
  var url = window.LUTSITE_SUPABASE_URL;
  var key = window.LUTSITE_SUPABASE_ANON_KEY;
  if (!url || !key || url === 'TODO' || key === 'TODO') return;
  window.LUTSITE_SUPABASE = window.supabase.createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false  // OTP code is verified in-modal, not via URL
    }
  });
})();
