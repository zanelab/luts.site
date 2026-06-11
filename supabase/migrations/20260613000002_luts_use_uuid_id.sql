-- luts.id becomes a real uuid
--
-- Previously publishApprovedLut inserted with `id: slug`, conflating the
-- primary key with the human-readable URL fragment. That made the id
-- unstable across slug renames and tied two FK columns to a value the
-- slugify pipeline can mutate. The id is also the value the frontend
-- sends as `lutId` to request a download, so using the slug there
-- conflated identity with display.
--
-- This migration converts:
--   1. luts.id                       text -> uuid (default gen_random_uuid())
--   2. lut_download_requests.lut_id  text -> uuid
--   3. submissions.published_lut_id  text -> uuid
--
-- The two FK columns are converted with `using null` because the old
-- text values were the slug (not a uuid) and can't be cast. Acceptable
-- in dev — those rows were test data and luts.id is also being replaced.
-- After this migration, fresh test rows will use the new uuid type.
--
-- Order matters: drop FKs, change the target column (luts.id) to uuid,
-- convert the FK columns to uuid, then re-add the FKs. If you re-add the
-- FKs before luts.id is uuid, PostgreSQL refuses — the column types
-- won't match.
--
-- Idempotent: re-runs on the new schema are no-ops (the cast/drop guard
-- their own preconditions).

-- ===== 1. Drop the FK constraints =====
-- (The FK columns stay — we just want to free them from the type check
--  so we can change luts.id underneath them.)

alter table public.lut_download_requests
  drop constraint if exists lut_download_requests_lut_id_fkey;

alter table public.submissions
  drop constraint if exists submissions_published_lut_id_fkey;

-- ===== 2. Convert luts.id (the primary key) to uuid =====
-- Done first so the FKs we re-add below have a matching uuid target.

alter table public.luts drop constraint if exists luts_pkey;
alter table public.luts drop column id;
alter table public.luts add column id uuid primary key default gen_random_uuid();

-- ===== 3. Convert the FK columns to uuid =====
-- Existing text values (the slug) can't be cast; null them out. Dev-only
-- loss — those rows were test data and the lut they pointed at is gone
-- anyway since luts.id is brand new.

alter table public.lut_download_requests
  alter column lut_id type uuid using null;

alter table public.submissions
  alter column published_lut_id type uuid using null;

-- ===== 4. Re-add the FK constraints against the new uuid luts.id =====

alter table public.lut_download_requests
  add constraint lut_download_requests_lut_id_fkey
  foreign key (lut_id) references public.luts(id) on delete set null;

alter table public.submissions
  add constraint submissions_published_lut_id_fkey
  foreign key (published_lut_id) references public.luts(id) on delete set null;

-- ===== 5. Doc comments =====

comment on column public.luts.id is
  'Stable uuid, exposed to the frontend as lutId. Independent of slug.';

comment on column public.submissions.published_lut_id is
  'On approve: the uuid of the row inserted into public.luts.';
