-- LUT contribution flow: schema + RLS + auth trigger
--
-- Adds:
--   public.users                   user metadata (role for admin gating)
--   public.submissions             pending/approved/rejected submissions
--   public.luts (extended)         + description, tags, source_submission_id,
--                                    published_by, updated_at
--   trigger: on auth.users insert  -> public.users row
--
-- Idempotent: safe to re-run.

-- ===== 1. Extend luts with contribution-related columns =====
-- Existing rows (if any) keep their id/slug/title/storage_path; new columns
-- are nullable. The id remains `text` (it carries the slug, e.g. "boost-shadow");
-- admins write this same value into the Markdown front matter as `lutId:`.

alter table public.luts
  add column if not exists description     text,
  add column if not exists tags            jsonb not null default '[]'::jsonb,
  add column if not exists source_submission_id uuid,
  add column if not exists published_by    uuid,
  add column if not exists updated_at      timestamptz not null default now();

-- Backfill description for any existing rows to allow the not-null check below
-- (only matters if there are pre-existing rows without description).
update public.luts set description = '' where description is null;

alter table public.luts
  alter column description set not null;

create index if not exists luts_created_at_idx
  on public.luts (created_at desc);

-- ===== 2. users =====
-- Mirrors auth.users 1:1. Trigger below keeps it in sync.

create table if not exists public.users (
  id          uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null,
  role        text        not null default 'user' check (role in ('user', 'admin')),
  created_at  timestamptz not null default now()
);

create index if not exists users_role_idx on public.users (role);

comment on table  public.users  is 'User metadata mirrored from auth.users. role gates admin-only paths.';
comment on column public.users.role is 'user | admin. Admin role is set by SQL bootstrap, not self-claim.';

-- ===== 3. submissions =====
-- Single status enum drives the pending -> approved | rejected state machine.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'submission_status') then
    create type public.submission_status as enum ('pending', 'approved', 'rejected');
  end if;
end$$;

create table if not exists public.submissions (
  id                uuid                       primary key default gen_random_uuid(),
  user_id           uuid                       not null references public.users(id) on delete cascade,
  user_email        text                       not null,
  title             text                       not null check (char_length(title) between 1 and 80),
  description       text                       not null check (char_length(description) between 1 and 500),
  tags              jsonb                      not null default '[]'::jsonb,
  file_name         text                       not null,
  file_size         bigint                     not null check (file_size > 0 and file_size <= 10 * 1024 * 1024),
  storage_path      text                       not null,
  status            public.submission_status   not null default 'pending',
  reject_reason     text                       check (reject_reason is null or char_length(reject_reason) >= 10),
  reviewed_by       uuid                       references public.users(id),
  reviewed_at       timestamptz,
  published_lut_id  text                       references public.luts(id) on delete set null,
  created_at        timestamptz                not null default now()
);

create index if not exists submissions_user_id_idx
  on public.submissions (user_id, created_at desc);

create index if not exists submissions_status_created_idx
  on public.submissions (status, created_at desc);

-- Powers the 24h per-email rate limit on submit-lut. Same column order pattern
-- as lut_download_requests_email_created_at_idx so the optimizer can share plans.
create index if not exists submissions_user_email_created_at_idx
  on public.submissions (user_email, created_at desc);

comment on table  public.submissions         is 'User-submitted LUTs awaiting admin review.';
comment on column public.submissions.user_email is 'Snapshot of submitter email at submission time (auth.email can change).';
comment on column public.submissions.storage_path is 'Path inside lut-submissions bucket: submissions/{user_id}/{submission_id}.cube';
comment on column public.submissions.published_lut_id is 'On approve: the id (= slug) of the row inserted into public.luts.';

-- ===== 4. Auth trigger: mirror auth.users -> public.users =====

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ===== 5. RLS =====

-- 5.1 users
alter table public.users enable row level security;

drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select to authenticated
  using (id = auth.uid());

drop policy if exists users_select_admin on public.users;
create policy users_select_admin on public.users
  for select to authenticated
  using (exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  ));

-- No insert/update policies: all writes go through service_role (Edge Function).

-- 5.2 submissions
alter table public.submissions enable row level security;

-- Self read
drop policy if exists submissions_select_self on public.submissions;
create policy submissions_select_self on public.submissions
  for select to authenticated
  using (user_id = auth.uid());

-- Admin read
drop policy if exists submissions_select_admin on public.submissions;
create policy submissions_select_admin on public.submissions
  for select to authenticated
  using (exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  ));

-- No insert/update policies on the client: writes only via service_role Edge Function.

-- 5.3 luts
-- Already RLS-enabled with no policies in 20260610000000_lut_download_init.sql
-- (anon/authenticated cannot read). For contribution flow, anon needs to read
-- approved LUTs so /lut-list/ and detail pages can render them.
-- Drop the no-policy = deny-everyone effect by adding a read policy for all roles.

drop policy if exists luts_select_public on public.luts;
create policy luts_select_public on public.luts
  for select to anon, authenticated
  using (true);

-- No insert/update policies: writes only via service_role Edge Function.

-- ===== 6. updated_at trigger for luts =====
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists luts_touch_updated_at on public.luts;
create trigger luts_touch_updated_at
  before update on public.luts
  for each row execute function public.touch_updated_at();
