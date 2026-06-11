-- Storage RLS for the lut-submissions bucket.
--
-- The bucket is private (created out-of-band in the Supabase dashboard,
-- not via SQL). Without storage.objects policies, no one — not even
-- admins — can read files from it. That broke
-- admin-submissions.js getSignedUrl(), which the moderation drawer
-- needs to render a preview link to the .cube file.
--
-- Inserts and deletes are done from the Edge Functions using the
-- service_role key, which bypasses RLS — so we only need a SELECT
-- policy for authenticated admins.
--
-- Reuses public.is_admin() from 20260613000000_fix_users_rls_recursion.sql.
-- If that migration hasn't run, this one will fail to create the policy
-- (function does not exist); run the RLS-fix first.
--
-- Idempotent: safe to re-run.

drop policy if exists lut_submissions_admin_read on storage.objects;
create policy lut_submissions_admin_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lut-submissions'
    and public.is_admin()
  );
