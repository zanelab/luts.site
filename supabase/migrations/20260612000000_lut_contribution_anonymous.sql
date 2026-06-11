-- Allow anonymous submissions
--
-- Drops NOT NULL on submissions.user_id. Anonymous contributors don't have
-- an auth.uid() at submission time, so we record user_id as NULL and
-- keep user_email as the contact + rate-limit key.
--
-- Also drops the "self read" RLS policy: with no /contribute/mine/ page
-- and the "submit anonymously" UX, there's no need to let authenticated
-- users see their own submissions. Only admins (via moderate-submission
-- or the /admin/submissions/ page) read submissions.
--
-- Idempotent: safe to re-run.

alter table public.submissions
  alter column user_id drop not null;

drop policy if exists submissions_select_self on public.submissions;

comment on column public.submissions.user_id is
  'NULL for anonymous submissions; auth.uid() when the submitter is logged in.';

