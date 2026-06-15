/*
 * manage-lut
 *
 * Single-file Supabase Edge Function. Admin-only JSON endpoint that
 * updates or deletes a published LUT (a row in public.luts).
 *
 * POST  /functions/v1/manage-lut
 * Content-Type: application/json
 * Body  {
 *   action: "update" | "delete",
 *   lutId: string (uuid),
 *   confirm?: true  // required for delete
 *   // update-only, all optional:
 *   title?:          string  (1-80 chars)
 *   description?:    string  (1-500 chars)
 *   tags?:           string[]  (0-5 entries, each <=16 chars)
 *   slug?:           string  (1-60 chars; storage_path is keyed on the row
 *                             id, so renaming the slug never relocates the
 *                             .cube file)
 *   paid?:           boolean  // true ⇒ paid-only LUT,详情页渲染购买 CTA
 *   priceCents?:     int      // 分 (cents),> 0 时前端显示 ¥<price_cents/100>
 *   afdianSkuId?:    string|null  // 爱发电 sku_id,与 webhook 推送的
 *                                    sku_detail[0].sku_id 匹配
 *   afdianOrderUrl?: string|null  // 爱发电商品页 URL,"前往购买"跳转目标
 * }
 * Headers: Authorization: Bearer <admin JWT>
 *
 * Returns:
 *   200  { ok: true, lut: {...} }              // update
 *   200  { ok: true, deleted: true, slug }     // delete
 *   400  { error: "invalid_input" }
 *   401  { error: "unauthenticated" }
 *   403  { error: "forbidden" }
 *   404  { error: "not_found" }
 *   409  { error: "slug_taken" }
 *   405  { error: "method_not_allowed" }
 *   500  { error: "internal" }
 *
 * Update pipeline:
 *   1. Preflight + method check
 *   2. Verify admin JWT
 *   3. Parse + validate body
 *   4. Load current row (404 if missing)
 *   5. If slug is changing, check the new slug isn't taken (409 slug_taken).
 *      storage_path is keyed on the row's uuid id, so renaming the slug
 *      never moves the .cube file in storage.
 *   6. Update row.
 *   7. Return the updated row.
 *
 * Delete pipeline:
 *   1. Same 1-3 + confirm=true guard
 *   4. Load row to learn storage_path
 *   5. Delete the row (FKs in lut_download_requests.lut_id and
 *      submissions.published_lut_id are on delete set null)
 *   6. Best-effort: remove the .cube file from public bucket. If the
 *      file is missing or the bucket errors, the row is already gone,
 *      log + move on.
 *
 * Required env (set via `supabase secrets set ...`):
 *   SITE_ORIGIN               (optional, comma-separated list of allowed origins;
 *                                e.g. "https://luts.site,http://127.0.0.1:4000";
 *                                echoes Origin if unset)
 *
 * Auto-injected by Supabase runtime (do NOT set manually):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== Constants ============================================================

const BUCKET_PUBLIC = "luts";

const MAX_TITLE_LEN = 80;
const MAX_DESC_LEN = 500;
const MAX_TAGS = 5;
const MAX_TAG_LEN = 16;
const MAX_SLUG_LEN = 60;

const CORS_ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
].join(", ");
const CORS_ALLOWED_METHODS = "POST, OPTIONS";

// ===== Types ================================================================

interface AuthedUser {
  id: string;
  email: string;
  role: "user" | "admin";
}

interface LutRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  storage_path: string;
  paid: boolean;
  price_cents: number | null;
  afdian_sku_id: string | null;
  afdian_order_url: string | null;
  created_at: string;
  updated_at: string;
}

// ===== Main handler =========================================================

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return jsonResponse(req, 405, { error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error(
      "Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY",
    );
    return jsonResponse(req, 500, { error: "internal" });
  }

  // -- Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_err) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }
  const lutId = typeof body.lutId === "string" ? body.lutId.trim() : "";
  const action = body.action;
  if (!lutId) return jsonResponse(req, 400, { error: "invalid_input" });
  if (action !== "update" && action !== "delete") {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }

  // -- Admin auth
  const reviewer = await authedUser(req, supabaseUrl, anonKey);
  if (!reviewer) return jsonResponse(req, 401, { error: "unauthenticated" });
  if (reviewer.role !== "admin") {
    return jsonResponse(req, 403, { error: "forbidden" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === "delete") {
    if (body.confirm !== true) {
      return jsonResponse(req, 400, { error: "invalid_input" });
    }
    return await handleDelete(req, admin, lutId);
  }

  // -- action === "update"
  const fields = parseUpdateFields(body);
  if (!fields.ok) return jsonResponse(req, 400, { error: "invalid_input" });
  return await handleUpdate(req, admin, lutId, fields.value);
});

// ===== Update ===============================================================

interface UpdateFields {
  title?: string;
  description?: string;
  tags?: string[];
  slug?: string;
  paid?: boolean;
  priceCents?: number;
  afdianSkuId?: string | null;
  afdianOrderUrl?: string | null;
}

function parseUpdateFields(
  body: Record<string, unknown>,
): { ok: true; value: UpdateFields } | { ok: false } {
  const out: UpdateFields = {};
  let any = false;

  if (body.title !== undefined) {
    if (typeof body.title !== "string") return { ok: false };
    const t = body.title.trim();
    if (t.length < 1 || t.length > MAX_TITLE_LEN) return { ok: false };
    out.title = t;
    any = true;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") return { ok: false };
    const d = body.description.trim();
    if (d.length < 1 || d.length > MAX_DESC_LEN) return { ok: false };
    out.description = d;
    any = true;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) return { ok: false };
    const tags: string[] = [];
    for (const t of body.tags) {
      if (typeof t !== "string") return { ok: false };
      const trimmed = t.trim();
      if (trimmed.length < 1 || trimmed.length > MAX_TAG_LEN) {
        return { ok: false };
      }
      tags.push(trimmed);
    }
    if (tags.length > MAX_TAGS) return { ok: false };
    out.tags = tags;
    any = true;
  }
  if (body.slug !== undefined) {
    if (typeof body.slug !== "string") return { ok: false };
    const s = slugify(body.slug);
    if (s.length < 1 || s.length > MAX_SLUG_LEN) return { ok: false };
    out.slug = s;
    any = true;
  }
  if (body.paid !== undefined) {
    if (typeof body.paid !== "boolean") return { ok: false };
    out.paid = body.paid;
    any = true;
  }
  if (body.priceCents !== undefined) {
    if (typeof body.priceCents !== "number") return { ok: false };
    if (!Number.isInteger(body.priceCents) || body.priceCents < 0) {
      return { ok: false };
    }
    out.priceCents = body.priceCents;
    any = true;
  }
  if (body.afdianSkuId !== undefined) {
    if (body.afdianSkuId !== null && typeof body.afdianSkuId !== "string") {
      return { ok: false };
    }
    if (typeof body.afdianSkuId === "string" && body.afdianSkuId.length === 0) {
      return { ok: false };
    }
    out.afdianSkuId = body.afdianSkuId;
    any = true;
  }
  if (body.afdianOrderUrl !== undefined) {
    if (
      body.afdianOrderUrl !== null && typeof body.afdianOrderUrl !== "string"
    ) return { ok: false };
    if (
      typeof body.afdianOrderUrl === "string" &&
      body.afdianOrderUrl.length === 0
    ) return { ok: false };
    out.afdianOrderUrl = body.afdianOrderUrl;
    any = true;
  }

  if (!any) return { ok: false }; // nothing to do
  return { ok: true, value: out };
}

async function handleUpdate(
  req: Request,
  admin: ReturnType<typeof createClient>,
  lutId: string,
  fields: UpdateFields,
): Promise<Response> {
  // 1. Load current row.
  const { data: current, error: curErr } = await admin
    .from("luts")
    .select(
      "id, slug, title, description, tags, storage_path, paid, price_cents, afdian_sku_id, afdian_order_url, created_at, updated_at",
    )
    .eq("id", lutId)
    .maybeSingle<LutRow>();

  if (curErr) {
    console.error("lut lookup failed", curErr);
    return jsonResponse(req, 500, { error: "internal" });
  }
  if (!current) return jsonResponse(req, 404, { error: "not_found" });

  // 2. If slug is changing, make sure the new one isn't taken by another
  //    row. storage_path is keyed on the uuid id (not slug), so renaming
  //    the slug never touches the .cube file in storage.
  if (fields.slug && fields.slug !== current.slug) {
    const { data: clash, error: clashErr } = await admin
      .from("luts")
      .select("id")
      .eq("slug", fields.slug)
      .neq("id", lutId)
      .maybeSingle();
    if (clashErr) {
      console.error("slug clash check failed", clashErr);
      return jsonResponse(req, 500, { error: "internal" });
    }
    if (clash) return jsonResponse(req, 409, { error: "slug_taken" });
  }

  // 3. Build the update payload.
  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.tags !== undefined) patch.tags = fields.tags;
  if (fields.slug !== undefined) patch.slug = fields.slug;
  if (fields.paid !== undefined) patch.paid = fields.paid;
  if (fields.priceCents !== undefined) patch.price_cents = fields.priceCents;
  if (fields.afdianSkuId !== undefined) patch.afdian_sku_id = fields.afdianSkuId;
  if (fields.afdianOrderUrl !== undefined) {
    patch.afdian_order_url = fields.afdianOrderUrl;
  }

  // 4. Apply.
  const { data: updated, error: updErr } = await admin
    .from("luts")
    .update(patch)
    .eq("id", lutId)
    .select(
      "id, slug, title, description, tags, storage_path, paid, price_cents, afdian_sku_id, afdian_order_url, created_at, updated_at",
    )
    .single<LutRow>();

  if (updErr || !updated) {
    console.error("lut update failed", updErr);
    return jsonResponse(req, 500, { error: "internal" });
  }

  return jsonResponse(req, 200, { ok: true, lut: updated });
}

// ===== Delete ===============================================================

async function handleDelete(
  req: Request,
  admin: ReturnType<typeof createClient>,
  lutId: string,
): Promise<Response> {
  const { data: current, error: curErr } = await admin
    .from("luts")
    .select("id, slug, storage_path")
    .eq("id", lutId)
    .maybeSingle<{ id: string; slug: string; storage_path: string }>();

  if (curErr) {
    console.error("lut lookup failed", curErr);
    return jsonResponse(req, 500, { error: "internal" });
  }
  if (!current) return jsonResponse(req, 404, { error: "not_found" });

  const { error: delErr } = await admin.from("luts").delete().eq("id", lutId);
  if (delErr) {
    console.error("lut delete failed", delErr);
    return jsonResponse(req, 500, { error: "internal" });
  }

  // Best-effort: drop the .cube file. If it fails, the row is already
  // gone so we just log — admin can clean up the orphan manually.
  if (current.storage_path) {
    const { error: rmErr } = await admin.storage
      .from(BUCKET_PUBLIC)
      .remove([current.storage_path]);
    if (rmErr) {
      console.warn(
        "lut file remove failed (after delete)",
        current.storage_path,
        rmErr,
      );
    }
  }

  return jsonResponse(req, 200, {
    ok: true,
    deleted: true,
    slug: current.slug,
  });
}

// ===== CORS =================================================================

function corsHeaders(req: Request): HeadersInit {
  // SITE_ORIGIN may be a comma-separated list (e.g.
  // "https://luts.site,http://127.0.0.1:4000") to support local dev
  // alongside the production origin. If the request's origin matches
  // any entry, echo it (so credentials / Authorization headers work);
  // otherwise fall back to the first entry. If SITE_ORIGIN is unset,
  // echo the request origin (dev-only) — never wildcard with credentials.
  const siteOrigin = Deno.env.get("SITE_ORIGIN") ?? "";
  const allowed = siteOrigin.split(",").map((s) => s.trim()).filter(Boolean);
  const reqOrigin = req.headers.get("origin") ?? "";
  const allowOrigin = allowed.includes(reqOrigin)
    ? reqOrigin
    : (allowed[0] || reqOrigin || "*");
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": CORS_ALLOWED_METHODS,
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  return null;
}

function jsonResponse(
  req: Request,
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

// ===== Auth =================================================================

async function authedUser(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<AuthedUser | null> {
  const authHeader = req.headers.get("authorization") ?? "";
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return null;

  const adminClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: row, error: roleErr } = await adminClient
    .from("users")
    .select("id, email, role")
    .eq("id", data.user.id)
    .maybeSingle<AuthedUser>();

  if (roleErr) {
    console.error("role lookup failed", roleErr);
    return null;
  }
  if (row) {
    return { id: row.id, email: row.email, role: row.role };
  }
  // Trigger should have inserted; if missing, treat as user (safer default).
  return {
    id: data.user.id,
    email: data.user.email ?? "",
    role: "user",
  };
}

// ===== Internal helpers =====================================================

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_SLUG_LEN) || "lut";
}
