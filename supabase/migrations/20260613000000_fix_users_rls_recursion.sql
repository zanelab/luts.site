-- Fix infinite recursion in public.users RLS policy.
--
-- Bug: users_select_admin on public.users does
--   using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
-- That subquery re-triggers RLS on the same table, which re-evaluates the
-- same policy, which subqueries the same table → 500 "infinite recursion
-- detected in policy for relation 'users'". Any authenticated user trying
-- to read public.users (including the self-read loadRole call in
-- auth-nav.js / admin-submissions.js) hits this.
--
-- Fix: wrap the role lookup in a SECURITY DEFINER function owned by
-- `postgres` (the migration runner). SECURITY DEFINER executes with the
-- owner's privileges; the postgres role bypasses RLS, so the function
-- can read public.users without re-triggering policy evaluation.
-- The policy then just calls the function — no recursive table read.
--
-- Idempotent: safe to re-run.

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select role = 'admin' from public.users where id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists users_select_admin on public.users;
create policy users_select_admin on public.users
  for select to authenticated
  using (public.is_admin());
