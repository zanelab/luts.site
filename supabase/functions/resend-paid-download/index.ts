/*
 * resend-paid-download
 *
 * Single-file Supabase Edge Function. Admin-only endpoint that retries
 * the Afdian DM (send-msg) for a paid_lut_orders row whose dm_sent_at is
 * NULL (i.e. the original send failed or the order was placed before DM
 * was wired up).
 *
 * POST  /functions/v1/resend-paid-download
 * Headers: Authorization: Bearer <admin JWT>
 * Content-Type: application/json
 * Body  { orderId: string (uuid) }
 *
 * Returns:
 *   200  { ok: true, dm_message_id?: string }
 *   400  { error: "invalid_input" }
 *   401  { error: "unauthenticated" }
 *   403  { error: "forbidden" }
 *   404  { error: "not_found" }
 *   409  { error: "already_delivered" }   — dm_sent_at 已有值,无需重发
 *   429  { error: "rate_limited" }
 *   500  { error: "internal" }
 *
 * Pipeline:
 *   1. Preflight + method check
 *   2. Verify admin JWT
 *   3. Parse + validate body
 *   4. Load paid_lut_orders row (404 if missing)
 *   5. Reject if dm_sent_at 已存在 (409 already_delivered)
 *   6. Rate-limit by buyer_user_id (5/24h, lut_download_requests.status='paid_resent')
 *   7. Re-generate signed URL (Supabase Storage)
 *   8. Send DM via /api/open/send-msg
 *   9. Update dm_sent_at / dm_error / dm_message_id
 *  10. Write audit row
 *
 * Required env (set via `supabase secrets set ...`):
 *   AFDIAN_USER_ID            爱发电创作者 user_id
 *   AFDIAN_TOKEN              Open API token
 *   STORAGE_BUCKET            (optional, default "luts")
 *   SIGNED_URL_EXPIRES_IN     (optional, seconds, default 1800)
 *   SITE_ORIGIN               (optional, comma-separated list)
 *
 * Auto-injected by Supabase runtime (do NOT set manually):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== Constants ============================================================

const AFDIAN_OPEN_API_BASE = "https://ifdian.net/api/open";
const DEFAULT_EXPIRES_SECONDS = 1800;
const RESEND_RATE_LIMIT_PER_DAY = 5;

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

interface PaidOrderRow {
  id: string;
  order_no: string;
  lut_id: string | null;
  state: string;
  buyer_user_id: string;
  dm_sent_at: string | null;
  dm_error: string | null;
  luts:
    | { id: string; slug: string; title: string; storage_path: string }
    | Array<{ id: string; slug: string; title: string; storage_path: string }>
    | null;
}

interface OpenApiSendMsgResponse {
  ec: number;
  em?: string;
  data?: { message_id?: string };
}

interface OpenApiOrder {
  ec: number;
  em?: string;
  data?: { message_id?: string } | unknown;
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
  const bucket = Deno.env.get("STORAGE_BUCKET") ?? "luts";
  const expiresIn = Number(
    Deno.env.get("SIGNED_URL_EXPIRES_IN") ?? DEFAULT_EXPIRES_SECONDS,
  );
  const afdianUserId = Deno.env.get("AFDIAN_USER_ID");
  const afdianToken = Deno.env.get("AFDIAN_TOKEN");

  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error(
      "Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY",
    );
    return jsonResponse(req, 500, { error: "internal" });
  }
  if (!afdianUserId || !afdianToken) {
    console.error("Missing AFDIAN_USER_ID or AFDIAN_TOKEN");
    return jsonResponse(req, 500, { error: "internal" });
  }

  // -- Parse body
  let body: { orderId?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) {
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

  // -- Load order + join lut info
  const { data: order, error: orderErr } = await admin
    .from("paid_lut_orders")
    .select(
      "id, order_no, lut_id, state, buyer_user_id, dm_sent_at, dm_error, luts!inner(id, slug, title, storage_path)",
    )
    .eq("id", orderId)
    .maybeSingle<PaidOrderRow>();

  if (orderErr) {
    console.error("paid_lut_orders lookup failed", orderErr);
    return jsonResponse(req, 500, { error: "internal" });
  }
  if (!order) return jsonResponse(req, 404, { error: "not_found" });

  if (order.state !== "paid") {
    return jsonResponse(req, 409, { error: "not_paid" });
  }
  if (order.dm_sent_at) {
    return jsonResponse(req, 409, { error: "already_delivered" });
  }
  if (!order.lut_id) {
    return jsonResponse(req, 500, { error: "missing_lut_reference" });
  }

  // -- Rate-limit by buyer_user_id
  const limited = await isResendRateLimited(
    admin,
    order.buyer_user_id,
    reviewer.email,
  );
  if (limited) {
    await audit(admin, {
      lutId: order.lut_id,
      email: order.buyer_user_id, // store user_id in `email` field for unified audit
      ip: null,
      userAgent: req.headers.get("user-agent"),
      status: "paid_resent_rate_limited",
    });
    return jsonResponse(req, 429, { error: "rate_limited" });
  }

  // -- Generate signed URL (single-lut join, postgrest returns array sometimes)
  const lut = Array.isArray(order.luts) ? order.luts[0] : order.luts;
  if (!lut) return jsonResponse(req, 500, { error: "missing_lut_reference" });

  const { data: signed, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(lut.storage_path, expiresIn, {
      download: lut.storage_path.split("/").pop() ?? `${lut.slug}.cube`,
    });
  if (signErr || !signed?.signedUrl) {
    console.error("signed url failed", signErr);
    return jsonResponse(req, 500, { error: "internal" });
  }

  // -- Send DM
  const expiresMinutes = Math.round(expiresIn / 60);
  const content = buildDmContent({
    lutTitle: lut.title,
    downloadUrl: signed.signedUrl,
    expiresMinutes,
  });
  const dm = await sendDm(
    afdianUserId,
    afdianToken,
    order.buyer_user_id,
    content,
  );

  if (!dm.ok) {
    console.warn("DM resend failed", dm.error);
    // Best-effort: record the failure on the order row so admin sees it
    // immediately without reloading.
    await admin
      .from("paid_lut_orders")
      .update({ dm_error: dm.error ?? "unknown" })
      .eq("id", order.id);
    await audit(admin, {
      lutId: order.lut_id,
      email: order.buyer_user_id,
      ip: null,
      userAgent: req.headers.get("user-agent"),
      status: "paid_resent_failed",
    });
    return jsonResponse(req, 500, { error: "dm_failed" });
  }

  // -- Persist success
  const { error: upErr } = await admin
    .from("paid_lut_orders")
    .update({
      dm_sent_at: new Date().toISOString(),
      dm_message_id: dm.messageId ?? null,
      dm_error: null,
    })
    .eq("id", order.id);

  if (upErr) {
    console.error("paid_lut_orders update failed", upErr);
    return jsonResponse(req, 500, { error: "internal" });
  }

  await audit(admin, {
    lutId: order.lut_id,
    email: order.buyer_user_id,
    ip: null,
    userAgent: req.headers.get("user-agent"),
    status: "paid_resent",
  });

  return jsonResponse(req, 200, { ok: true, dm_message_id: dm.messageId });
});

// ===== CORS =================================================================

function corsHeaders(req: Request): HeadersInit {
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
    .maybeSingle<{ id: string; email: string; role: "user" | "admin" }>();

  if (roleErr) {
    console.error("role lookup failed", roleErr);
    return null;
  }
  if (!row) return null;
  return row;
}

// ===== Rate limit ===========================================================

async function isResendRateLimited(
  admin: ReturnType<typeof createClient>,
  buyerUserId: string,
  adminEmail: string,
): Promise<boolean> {
  // 用 lut_download_requests.audit 表统一计数:email 字段既存买家邮箱也存
  // 爱发电 user_id (admin 触发的重发都是后者)。24h 滚动窗口, status 必须是
  // 'paid_resent'(成功的重发)。
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await admin
    .from("lut_download_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", buyerUserId)
    .eq("status", "paid_resent")
    .gte("created_at", since);

  if (error) {
    console.error("rate-limit lookup failed", error);
    return false; // fail-open
  }
  return (count ?? 0) >= RESEND_RATE_LIMIT_PER_DAY;
}

async function audit(
  admin: ReturnType<typeof createClient>,
  row: {
    lutId: string | null;
    email: string;
    ip: string | null;
    userAgent: string | null;
    status: string;
  },
): Promise<void> {
  const { error } = await admin.from("lut_download_requests").insert({
    lut_id: row.lutId,
    email: row.email,
    ip: row.ip,
    user_agent: row.userAgent,
    status: row.status,
  });
  if (error) console.error("audit insert failed", error);
}

// ===== Open API: send-msg ====================================================

async function afdianSign(
  token: string,
  userId: string,
  params: string,
  ts: number,
): Promise<string> {
  const kv = `params${params}ts${ts}user_id${userId}`;
  const buf = new TextEncoder().encode(`${token}${kv}`);
  const digest = await crypto.subtle.digest("MD5", buf);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

async function sendDm(
  userId: string,
  token: string,
  recipient: string,
  content: string,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const paramsStr = JSON.stringify({ recipient, content });
  const ts = Math.floor(Date.now() / 1000);
  const sign = await afdianSign(token, userId, paramsStr, ts);

  let res: Response;
  try {
    res = await fetch(`${AFDIAN_OPEN_API_BASE}/send-msg`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        params: paramsStr,
        ts,
        sign,
      }),
    });
  } catch (err) {
    return { ok: false, error: `network: ${(err as Error).message}` };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: `http ${res.status}: ${await res.text().catch(() => "")}`,
    };
  }
  const body = (await res.json()) as OpenApiSendMsgResponse;
  if (body.ec !== 200) {
    return { ok: false, error: `ec ${body.ec}: ${body.em ?? ""}` };
  }
  return { ok: true, messageId: body.data?.message_id };
}

// ===== DM content ===========================================================

function buildDmContent(opts: {
  lutTitle: string;
  downloadUrl: string;
  expiresMinutes: number;
}): string {
  const { lutTitle, downloadUrl, expiresMinutes } = opts;
  return [
    `感谢支持 LUTs.site ！`,
    ``,
    `你的 LUT「${lutTitle}」下载链接：`,
    downloadUrl,
    ``,
    `该链接 ${expiresMinutes} 分钟内有效, 过期后请重新到详情页发起订单, 或联系我们补发。`,
    ``,
    `— LUTs.site`,
  ].join("\n");
}
