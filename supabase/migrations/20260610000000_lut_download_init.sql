-- LUT download flow: schema + RLS
--
-- Tables:
--   public.luts                    catalog (id → storage_path mapping)
--   public.lut_download_requests   audit log + rate-limit source

-- ===== Tables =====

create table if not exists public.luts (
  id            text        primary key,
  slug          text        not null unique,
  title         text        not null,
  storage_path  text        not null,
  created_at    timestamptz not null default now()
);

comment on table  public.luts                is 'LUT catalog. id matches frontend lutId; storage_path points inside STORAGE_BUCKET.';
comment on column public.luts.id             is 'Public identifier exposed to the frontend (matches Markdown front matter `lutId`).';
comment on column public.luts.storage_path   is 'Path inside the storage bucket, e.g. "boost-shadow/boost-shadow.cube".';

create table if not exists public.lut_download_requests (
  id          uuid        primary key default gen_random_uuid(),
  lut_id      text        references public.luts(id) on delete set null,
  email       text        not null,
  ip          inet,
  user_agent  text,
  status      text        not null,
  created_at  timestamptz not null default now()
);

comment on table  public.lut_download_requests is 'Audit log + source for per-email and per-IP rate limiting.';
comment on column public.lut_download_requests.status is
  'One of: success | rate_limited | lut_not_found | email_failed | invalid_token';

-- ===== Indexes =====

create index if not exists lut_download_requests_email_created_at_idx
  on public.lut_download_requests (email, created_at desc);

create index if not exists lut_download_requests_ip_created_at_idx
  on public.lut_download_requests (ip, created_at desc);

create index if not exists lut_download_requests_lut_id_created_at_idx
  on public.lut_download_requests (lut_id, created_at desc);

-- ===== Row Level Security =====
-- Public anon / authenticated clients must not be able to read these directly.
-- The Edge Function uses the service-role key, which bypasses RLS.

alter table public.luts                    enable row level security;
alter table public.lut_download_requests   enable row level security;

-- No policies means: anon / authenticated cannot select/insert/update/delete.
-- Service role (used by the Edge Function) bypasses RLS automatically.
