-- Paid LUT orders (爱发电 / Afdian) + luts catalog paid-flag extension
--
-- Tables:
--   public.paid_lut_orders    one row per Afdian order; source of truth for
--                              delivery status (DM sent / failed) and the
--                              idempotency guard against duplicate webhook
--                              pushes.
--
-- luts changes:
--   paid             boolean not null default false   -- true ⇒ LUT is paid-only
--   price_cents      int                              -- display price in cents
--   afdian_sku_id    text                             -- matches Afdian
--                                                       data.order.sku_detail[0].sku_id
--   afdian_order_url text                             -- Afdian 商品页 URL
--                                                       ("前往购买" 跳转目标)
--
-- 设计要点：
--   * order_no UNIQUE 是 Webhook 幂等性的核心。重复推送时
--     onConflict DO UPDATE 静默更新,不会重复发 DM。
--   * 整张表 RLS 开启,Edge Function 走 service_role 绕过。
--   * lut_id 是 nullable FK:sku_id 匹配不到 LUT 时 (404 unknown sku) 不
--     写库;反之,upsert 时一并写入。
--   * luts 新加四列全 nullable (除 paid default false),向后兼容既有
--     免费 LUT。
--   * 复用 public.is_admin() 20260613000000_fix_users_rls_recursion.sql。

-- ===== paid_lut_orders =====================================================

create table if not exists public.paid_lut_orders (
  id              uuid        primary key default gen_random_uuid(),
  order_no        text        not null,                        -- 爱发电 out_trade_no
  lut_id          uuid        references public.luts(id) on delete set null,
  sku_id          text        not null,                        -- 爱发电 sku_detail[0].sku_id
  plan_id         text        not null,                        -- 爱发电 plan_id
  buyer_user_id   text        not null,                        -- 爱发电 user_id (DM 接收人)
  amount_cents    int         not null,                        -- 订单金额 (分, total_amount * 100)
  state           text        not null,                        -- 'paid' | 'pending' | 'refunded'
  remark          text,                                         -- 爱发电订单备注原文 (留作审计)
  raw_payload     jsonb       not null,                        -- 原始 webhook body
  dm_sent_at      timestamptz,                                 -- DM 成功下发时间
  dm_message_id   text,                                         -- 爱发电 send-msg 返回的 message_id
  dm_error        text,                                         -- DM 失败时记录
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (order_no)
);

comment on table  public.paid_lut_orders is
  'One row per Afdian order. Source of truth for DM delivery + idempotency against duplicate webhook pushes.';

comment on column public.paid_lut_orders.order_no is
  'Afdian out_trade_no. UNIQUE — duplicate webhook pushes are silently idempotent via upsert onConflict.';

comment on column public.paid_lut_orders.state is
  'One of: paid (status=2) | pending (status=1, webhook not currently pushed) | refunded (admin/manual).';

comment on column public.paid_lut_orders.dm_sent_at is
  'NULL = DM not yet successfully sent. Admin must retry via /admin/orders/.';

-- ===== Indexes =============================================================

create index if not exists paid_lut_orders_lut_id_idx
  on public.paid_lut_orders (lut_id);

create index if not exists paid_lut_orders_buyer_user_id_idx
  on public.paid_lut_orders (buyer_user_id);

create index if not exists paid_lut_orders_dm_pending_idx
  on public.paid_lut_orders (state, dm_sent_at)
  where state = 'paid' and dm_sent_at is null;

-- 后两个索引让 /admin/orders/ 列表 (state=paid AND dm_sent_at IS NULL) 查询走索引扫描。

-- ===== luts 扩展 ===========================================================

alter table public.luts
  add column if not exists paid             boolean     not null default false,
  add column if not exists price_cents      int,
  add column if not exists afdian_sku_id    text,
  add column if not exists afdian_order_url text;

comment on column public.luts.paid is
  'true = paid-only LUT. 详情页渲染购买 CTA,不走 download flow.';

comment on column public.luts.price_cents is
  'Display price in 分 (cents). Frontend shows ¥<price_cents / 100>.';

comment on column public.luts.afdian_sku_id is
  'Afdian sku_detail[0].sku_id. afdian-webhook 通过此字段 match LUT.';

comment on column public.luts.afdian_order_url is
  'Afdian 商品页 URL. 详情页 "前往购买" 按钮跳转目标 (target="_blank").';

-- ===== updated_at 触发器 ===================================================
-- paid_lut_orders 没有自带触发器;手动加一个,Edge Function 用 admin client
-- update 字段时自动刷新 updated_at。

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists paid_lut_orders_touch_updated_at on public.paid_lut_orders;
create trigger paid_lut_orders_touch_updated_at
  before update on public.paid_lut_orders
  for each row execute function public.touch_updated_at();

-- ===== RLS =================================================================
-- Edge Function 走 service_role,绕过 RLS。
-- public anon 不可见;admin 角色 (authenticated) 全权。

alter table public.paid_lut_orders enable row level security;

drop policy if exists paid_lut_orders_admin_all on public.paid_lut_orders;
create policy paid_lut_orders_admin_all on public.paid_lut_orders
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
