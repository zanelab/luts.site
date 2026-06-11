/*
 * moderate-submission
 *
 * Single-file Supabase Edge Function. Admin-only JSON endpoint that
 * approves or rejects a pending submission from /admin/submissions/.
 *
 * POST  /functions/v1/moderate-submission
 * Content-Type: application/json
 * Body  {
 *   submissionId: string (uuid),
 *   action: "approve" | "reject",
 *   reason?: string  // reject only; >= 10 chars after trim
 * }
 * Headers: Authorization: Bearer <admin JWT>
 *
 * Returns:
 *   200  { ok: true, status: "approved" | "rejected", lutId?, slug? }
 *   400  { error: "invalid_input" }
 *   401  { error: "unauthenticated" }
 *   403  { error: "forbidden" }
 *   404  { error: "not_found" }
 *   409  { error: "already_reviewed" }
 *   405  { error: "method_not_allowed" }
 *   500  { error: "internal" }
 *
 * Approve pipeline:
 *   1. Preflight + method check
 *   2. Verify admin JWT
 *   3. Parse JSON body
 *   4. publishApprovedLut() — slugify, copy to public luts/, insert luts row
 *      (id auto-generated as uuid), mark submissions approved with
 *      reviewed_by/at/published_lut_id
 *
 * Reject pipeline:
 *   1. Same 1-3
 *   2. Validate reason (>= 10 chars)
 *   3. Update submissions row to rejected + reject_reason + reviewed_by/at
 *   4. Delete file from lut-submissions
 *   5. Email the submitter
 *
 * Required env (set via `supabase secrets set ...`):
 *   RESEND_API_KEY            Resend API key (re_xxxxxxxx)
 *   EMAIL_FROM                e.g. "LUTs.site <download@luts.site>"
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

const BUCKET_PRIVATE = "lut-submissions";
const BUCKET_PUBLIC = "luts";

const MIN_REJECT_REASON_LEN = 10;

const RESEND_API_URL = "https://api.resend.com/emails";

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

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
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

  // -- Step 1: parse JSON body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (_err) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }
  const submissionId = typeof body.submissionId === "string"
    ? body.submissionId.trim()
    : "";
  const action = body.action;
  if (!submissionId) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }
  if (action !== "approve" && action !== "reject") {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }

  // -- Step 2: verify admin
  const reviewer = await authedUser(req, supabaseUrl, anonKey);
  if (!reviewer) return jsonResponse(req, 401, { error: "unauthenticated" });
  if (reviewer.role !== "admin") {
    return jsonResponse(req, 403, { error: "forbidden" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -- Step 3: load submission (404 / 409 early)
  const { data: sub, error: subErr } = await admin
    .from("submissions")
    .select(
      "id, user_email, title, description, tags, file_name, file_size, storage_path, status, created_at",
    )
    .eq("id", submissionId)
    .maybeSingle();

  if (subErr) {
    console.error("submission lookup failed", subErr);
    return jsonResponse(req, 500, { error: "internal" });
  }
  if (!sub) {
    return jsonResponse(req, 404, { error: "not_found" });
  }
  if (sub.status !== "pending") {
    return jsonResponse(req, 409, { error: "already_reviewed" });
  }

  // -- Step 4a: approve
  if (action === "approve") {
    const pub = await publishApprovedLut({
      admin,
      submissionId,
      reviewer,
    });
    if (!pub.ok) {
      console.error("approve failed", pub.error);
      if (pub.error === "not_found") {
        return jsonResponse(req, 404, { error: "not_found" });
      }
      if (pub.error === "already_reviewed") {
        return jsonResponse(req, 409, { error: "already_reviewed" });
      }
      return jsonResponse(req, 500, { error: "internal" });
    }
    return jsonResponse(req, 200, {
      ok: true,
      status: "approved",
      lutId: pub.lutId,
      slug: pub.slug,
    });
  }

  // -- Step 4b: reject
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < MIN_REJECT_REASON_LEN) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }

  const { error: updErr } = await admin.from("submissions").update({
    status: "rejected",
    reject_reason: reason,
    reviewed_by: reviewer.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", submissionId);

  if (updErr) {
    console.error("submission reject update failed", updErr);
    return jsonResponse(req, 500, { error: "internal" });
  }

  // Best-effort: remove the private file. If this fails, the row already says
  // rejected so admins can clean up manually.
  const { error: rmErr } = await admin.storage
    .from(BUCKET_PRIVATE)
    .remove([sub.storage_path]);
  if (rmErr) {
    console.warn(
      "private file remove failed (after reject)",
      sub.storage_path,
      rmErr,
    );
  }

  // Email the submitter — best-effort, don't fail the reject if email errors.
  try {
    await sendContributorRejectEmail({
      admin,
      from: Deno.env.get("EMAIL_FROM") ?? "",
      apiKey: Deno.env.get("RESEND_API_KEY") ?? "",
      to: sub.user_email,
      title: sub.title,
      reason,
      submittedAt: sub.created_at,
    });
  } catch (err) {
    console.error("contributor reject email failed", err);
  }

  return jsonResponse(req, 200, { ok: true, status: "rejected" });
});

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

// ===== Email (Resend) =======================================================

async function sendEmail(
  params: SendEmailParams,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  if (!apiKey) return { ok: false, error: "missing RESEND_API_KEY" };
  if (!from) return { ok: false, error: "missing EMAIL_FROM" };

  const body: Record<string, unknown> = {
    from,
    to: [params.to],
    subject: params.subject,
    html: params.html,
  };
  if (params.text) body.text = params.text;

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `resend ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `network: ${(err as Error).message}` };
  }
}

async function sendContributorRejectEmail(opts: {
  admin: ReturnType<typeof createClient>;
  from: string;
  apiKey: string;
  to: string;
  title: string;
  reason: string;
  submittedAt: string;
}): Promise<void> {
  const { to, title, reason, submittedAt } = opts;
  const submittedPretty = new Date(submittedAt).toISOString();

  const subject = "你的投稿未通过审核";
  const text = [
    `你于 ${submittedPretty} 提交的 LUT「${title}」未通过审核。`,
    ``,
    `原因：${reason}`,
    ``,
    `如有疑问请回复邮件。`,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#222">
  <h2 style="margin:0 0 12px">投稿未通过审核</h2>
  <p>你于 <code>${escapeHtml(submittedPretty)}</code> 提交的 LUT
    <b>「${escapeHtml(title)}」</b> 未通过审核。</p>
  <table cellpadding="6" style="border-collapse:collapse;margin:12px 0">
    <tr><td><b>原因</b></td><td>${escapeHtml(reason)}</td></tr>
  </table>
  <p style="color:#888;font-size:12px;margin-top:24px">
    如有疑问请回复本邮件。
  </p>
</body></html>`;

  const result = await sendEmail({ to, subject, html, text });
  if (!result.ok) {
    console.warn(`contributor reject email to ${to} failed:`, result.error);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== Internal helpers =====================================================

/**
 * Shared "approve" flow used by both submit-lut (direct_publish=true) and
 * moderate-submission (action=approve). Copied verbatim to both functions
 * (no _shared/ by design — Deno single-file deploys are simpler this way).
 *
 * Steps:
 *   1. Read submission row (must be status=pending)
 *   2. Slugify title; resolve collisions
 *   3. Download from private bucket, upload to public luts/{slug}.cube
 *   4. Insert into public.luts — id is auto-generated (uuid, not slug)
 *   5. Update submissions row: status=approved, reviewed_by/at, published_lut_id
 *
 * Returns { ok: true, lutId, slug } on success; { ok: false, error } on any
 * step's failure (with best-effort compensation for the public-bucket copy).
 */
async function publishApprovedLut(opts: {
  admin: ReturnType<typeof createClient>;
  submissionId: string;
  reviewer: AuthedUser;
}): Promise<
  { ok: true; lutId: string; slug: string } | { ok: false; error: string }
> {
  const { admin, submissionId, reviewer } = opts;

  const { data: sub, error: subErr } = await admin
    .from("submissions")
    .select("id, title, description, tags, storage_path, status")
    .eq("id", submissionId)
    .maybeSingle();

  if (subErr) return { ok: false, error: `lookup: ${subErr.message}` };
  if (!sub) return { ok: false, error: "not_found" };
  if (sub.status !== "pending") {
    return { ok: false, error: "already_reviewed" };
  }

  const baseSlug = slugify(sub.title);
  const slug = await uniqueSlug(admin, baseSlug);

  // Download from private bucket
  const { data: dl, error: dlErr } = await admin.storage
    .from(BUCKET_PRIVATE)
    .download(sub.storage_path);
  if (dlErr || !dl) {
    return { ok: false, error: `download: ${dlErr?.message ?? "empty"}` };
  }

  // Upload to public bucket
  const destPath = `${slug}.cube`;
  const { error: upErr } = await admin.storage
    .from(BUCKET_PUBLIC)
    .upload(destPath, dl, {
      contentType: "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    return { ok: false, error: `upload: ${upErr.message}` };
  }

  // Insert into luts. id is auto-generated (gen_random_uuid()) so it stays
  // independent of slug — renaming a slug later won't break the FK from
  // submissions.published_lut_id or lut_download_requests.lut_id.
  const { data: lutRow, error: lutErr } = await admin.from("luts").insert({
    slug,
    title: sub.title,
    description: sub.description,
    tags: sub.tags,
    storage_path: destPath,
    source_submission_id: sub.id,
    published_by: reviewer.id,
  }).select("id").single();

  if (lutErr || !lutRow) {
    await admin.storage.from(BUCKET_PUBLIC).remove([destPath]);
    return {
      ok: false,
      error: `lut insert: ${lutErr?.message ?? "empty"}`,
    };
  }

  // Update submissions row
  const { error: updErr } = await admin.from("submissions").update({
    status: "approved",
    reviewed_by: reviewer.id,
    reviewed_at: new Date().toISOString(),
    published_lut_id: lutRow.id,
  }).eq("id", submissionId);

  if (updErr) {
    console.error("submission update failed (after publish)", updErr);
    // The luts row + file are already live; don't roll them back.
  }

  return { ok: true, lutId: lutRow.id, slug };
}

async function uniqueSlug(
  admin: ReturnType<typeof createClient>,
  base: string,
): Promise<string> {
  const { data, error } = await admin
    .from("luts")
    .select("slug")
    .ilike("slug", `${base}%`);
  if (error) {
    console.error("slug collision check failed", error);
    return base;
  }
  const taken = new Set((data ?? []).map((r: { slug: string }) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60) || "lut";
}
