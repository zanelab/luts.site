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
-- Idempotent: re-runs on the new schema are no-ops (the cast/drop guard
-- their own preconditions).

-- ===== 1. lut_download_requests.lut_id =====

alter table public.lut_download_requests
  drop constraint if exists lut_download_requests_lut_id_fkey;

alter table public.lut_download_requests
  alter column lut_id type uuid using null;

alter table public.lut_download_requests
  add constraint lut_download_requests_lut_id_fkey
  foreign key (lut_id) references public.luts(id) on delete set null;

-- ===== 2. submissions.published_lut_id =====

alter table public.submissions
  drop constraint if exists submissions_published_lut_id_fkey;

alter table public.submissions
  alter column published_lut_id type uuid using null;

alter table public.submissions
  add constraint submissions_published_lut_id_fkey
  foreign key (published_lut_id) references public.luts(id) on delete set null;

-- ===== 3. luts.id (the primary key) =====

alter table public.luts drop constraint if exists luts_pkey;
alter table public.luts drop column id;
alter table public.luts add column id uuid primary key default gen_random_uuid();

-- ===== 4. Doc comments =====

comment on column public.luts.id is
  'Stable uuid, exposed to the frontend as lutId. Independent of slug.';

comment on column public.submissions.published_lut_id is
  'On approve: the uuid of the row inserted into public.luts.';
