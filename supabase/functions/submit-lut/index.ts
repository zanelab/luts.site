/*
 * submit-lut
 *
 * Single-file Supabase Edge Function. Multipart upload that accepts a
 * .cube LUT anonymously (no auth required), validates it, stores it in
 * a private bucket, inserts a `submissions` row, and notifies admins.
 *
 * POST  /functions/v1/submit-lut
 * Content-Type: multipart/form-data
 * Body  {
 *   file: File (.cube, <= 10MB),
 *   email: string (required; for rate limit + reject notification),
 *   title: string (1-80),
 *   description: string (1-500),
 *   tags: string (comma-separated, 0-5 tags, each <=16 chars),
 *   turnstileToken: string,
 *   direct_publish: "true" | "false"  (admin-only; "true" skips the queue)
 * }
 * Headers:
 *   Authorization: Bearer <admin JWT>  (optional; required for direct_publish)
 *
 * Returns:
 *   200  { ok: true, submissionId, status: "pending" | "published", lutId?, slug? }
 *   400  { error: "invalid_input" | "invalid_token" }
 *   403  { error: "forbidden" }  (direct_publish=true but caller is not admin)
 *   429  { error: "rate_limited" }
 *   500  { error: "upload_failed" | "internal" }
 *   405  { error: "method_not_allowed" }
 *
 * Pipeline:
 *   1. Preflight + method check
 *   2. Parse multipart
 *   3. Optional auth: verify JWT if Authorization header present.
 *      Anon submissions skip this step; direct_publish=true requires admin.
 *   4. Validate fields + file (.cube, <=10MB, text-like content)
 *   5. Verify Cloudflare Turnstile token
 *   6. Rate limit by form email (5/24h, rolling, fail-open)
 *   7. Upload to lut-submissions/{user_id_or_anonymous}/{submission_id}.cube
 *   8. Insert submissions row (user_id=NULL when anonymous)
 *   9. If direct_publish=true: publishApprovedLut() (same path as approve)
 *      Else: email all admins
 *
 * Required env (set via `supabase secrets set ...`):
 *   TURNSTILE_SECRET_KEY      Cloudflare Turnstile server-side secret
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_TITLE_LEN = 80;
const MAX_DESCRIPTION_LEN = 500;
const MAX_TAGS = 5;
const MAX_TAG_LEN = 16;
const RATE_LIMIT_EMAIL_PER_DAY = 5; // per rolling 24h

const BUCKET_PRIVATE = "lut-submissions";
const BUCKET_PUBLIC = "luts";
const CUBE_EXT = ".cube";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
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

interface PublishResult {
  lutId: string;
  slug: string;
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
    console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse(req, 500, { error: "internal" });
  }

  // -- Step 1: parse multipart
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }

  const file = form.get("file");
  const emailRaw = stringField(form, "email");
  const title = stringField(form, "title");
  const description = stringField(form, "description");
  const tagsRaw = stringField(form, "tags");
  const turnstileToken = stringField(form, "turnstileToken");
  const directPublishRaw = stringField(form, "direct_publish") ?? "false";

  if (!(file instanceof File)) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }

  // -- Step 2: optional auth (verify JWT if header present)
  // Anonymous submissions are allowed. The JWT, when present, is only used
  // to gate direct_publish — it doesn't gate the submission itself.
  const authed = await tryAuthedUser(req, supabaseUrl, anonKey);
  if (authed === "error") {
    return jsonResponse(req, 500, { error: "internal" });
  }
  const user = authed; // null = anonymous

  // -- Step 3: admin gate for direct_publish
  if (directPublishRaw === "true" && (!user || user.role !== "admin")) {
    return jsonResponse(req, 403, { error: "forbidden" });
  }
  const directPublish = directPublishRaw === "true" && user?.role === "admin";

  // -- Step 4: validate fields
  const emailTrim = emailRaw.trim();
  if (!EMAIL_PATTERN.test(emailTrim)) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }
  const titleTrim = title.trim();
  if (titleTrim.length < 1 || titleTrim.length > MAX_TITLE_LEN) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }
  const descTrim = description.trim();
  if (descTrim.length < 1 || descTrim.length > MAX_DESCRIPTION_LEN) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }
  const tags = parseTags(tagsRaw);
  if (tags === null) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }
  if (!turnstileToken) {
    return jsonResponse(req, 400, { error: "invalid_token" });
  }

  // -- Step 5: validate file
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }
  if (!file.name.toLowerCase().endsWith(CUBE_EXT)) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }
  // .cube is text; refuse obviously non-text (control bytes in first 512 bytes)
  const headBytes = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  if (!looksLikeText(headBytes)) {
    return jsonResponse(req, 400, { error: "invalid_input" });
  }

  // -- Step 6: Turnstile
  const turnstile = await verifyTurnstile(turnstileToken, getClientIp(req));
  if (!turnstile.ok) {
    console.warn("turnstile failed:", turnstile.error);
    return jsonResponse(req, 400, { error: "invalid_token" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -- Step 7: rate limit (per email, rolling 24h, from form field)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount, error: rlErr } = await admin
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("user_email", emailTrim)
    .gte("created_at", since24h);

  if (rlErr) {
    console.error("rate-limit lookup failed", rlErr);
    // fail open: infra glitch shouldn't block legit users
  } else if ((recentCount ?? 0) >= RATE_LIMIT_EMAIL_PER_DAY) {
    return jsonResponse(req, 429, { error: "rate_limited" });
  }

  // -- Step 8: upload to private bucket
  const submissionId = crypto.randomUUID();
  const userSegment = user?.id ?? "anonymous";
  const storagePath = `submissions/${userSegment}/${submissionId}.cube`;

  const { error: upErr } = await admin.storage
    .from(BUCKET_PRIVATE)
    .upload(storagePath, file, {
      contentType: "application/octet-stream",
      upsert: false,
    });

  if (upErr) {
    console.error("upload failed", upErr);
    return jsonResponse(req, 500, { error: "upload_failed" });
  }

  // -- Step 9: insert submissions row
  const { error: insErr } = await admin.from("submissions").insert({
    id: submissionId,
    user_id: user?.id ?? null,
    user_email: emailTrim,
    title: titleTrim,
    description: descTrim,
    tags,
    file_name: file.name,
    file_size: file.size,
    storage_path: storagePath,
    status: "pending",
  });

  if (insErr) {
    console.error("submission insert failed", insErr);
    // best-effort cleanup
    await admin.storage.from(BUCKET_PRIVATE).remove([storagePath]);
    return jsonResponse(req, 500, { error: "internal" });
  }

  // -- Step 10: direct_publish path OR notify admins
  if (directPublish) {
    const pub = await publishApprovedLut({
      admin,
      submissionId,
      reviewer: user,
    });
    if (!pub.ok) {
      console.error("direct publish failed", pub.error);
      return jsonResponse(req, 500, { error: "internal" });
    }
    return jsonResponse(req, 200, {
      ok: true,
      submissionId,
      status: "published",
      lutId: pub.lutId,
      slug: pub.slug,
    });
  }

  // Notify all admins (best-effort — don't fail the submission if email errors)
  try {
    await notifyAdminsNewSubmission({
      admin,
      from: Deno.env.get("EMAIL_FROM") ?? "",
      apiKey: Deno.env.get("RESEND_API_KEY") ?? "",
      title: titleTrim,
      userEmail: emailTrim,
      submissionId,
    });
  } catch (err) {
    console.error("admin notify failed", err);
  }

  return jsonResponse(req, 200, {
    ok: true,
    submissionId,
    status: "pending",
  });
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

/**
 * Best-effort auth: returns the verified user if Authorization header
 * carries a valid JWT, null if no header / anon, or "error" on infra
 * failure (caller decides whether to 500 or treat as anon).
 */
async function tryAuthedUser(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<AuthedUser | null | "error"> {
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

  // Look up role from public.users (trigger creates it on first magic-link
  // login; treat missing row as "user" — should be rare).
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
    return "error";
  }
  if (row) {
    return { id: row.id, email: row.email, role: row.role };
  }
  return {
    id: data.user.id,
    email: data.user.email ?? "",
    role: "user",
  };
}

// ===== Cloudflare Turnstile =================================================

async function verifyTurnstile(
  token: string,
  remoteIp?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) return { ok: false, error: "missing-secret" };
  if (!token) return { ok: false, error: "missing-token" };

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (remoteIp) form.append("remoteip", remoteIp);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      return { ok: false, error: `siteverify-status-${res.status}` };
    }
    const data = await res.json() as {
      success: boolean;
      "error-codes"?: string[];
    };
    if (data.success) return { ok: true };
    return {
      ok: false,
      error: (data["error-codes"] ?? ["unknown"]).join(","),
    };
  } catch (err) {
    return { ok: false, error: `network: ${(err as Error).message}` };
  }
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

async function notifyAdminsNewSubmission(opts: {
  admin: ReturnType<typeof createClient>;
  from: string;
  apiKey: string;
  title: string;
  userEmail: string;
  submissionId: string;
}): Promise<void> {
  const { admin, title, userEmail, submissionId } = opts;
  const { data: admins, error } = await admin
    .from("users")
    .select("email")
    .eq("role", "admin");
  if (error) {
    console.warn("admin lookup for notification failed", error);
    return;
  }
  if (!admins || admins.length === 0) {
    console.warn("no admin to notify for new submission", submissionId);
    return;
  }

  const siteOrigin = Deno.env.get("SITE_ORIGIN") ?? "https://luts.site";
  const reviewUrl = `${siteOrigin}/admin/submissions/#${submissionId}`;

  const subject = `New LUT submission: ${title}`;
  const text = [
    `A new LUT submission is waiting for your review.`,
    ``,
    `Title:    ${title}`,
    `From:     ${userEmail}`,
    `At:       ${new Date().toISOString()}`,
    `Review:   ${reviewUrl}`,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;color:#222">
  <h2 style="margin:0 0 12px">New LUT submission</h2>
  <table cellpadding="6" style="border-collapse:collapse">
    <tr><td><b>Title</b></td><td>${escapeHtml(title)}</td></tr>
    <tr><td><b>From</b></td><td>${escapeHtml(userEmail)}</td></tr>
    <tr><td><b>At</b></td><td>${new Date().toISOString()}</td></tr>
  </table>
  <p style="margin:16px 0">
    <a href="${escapeAttr(reviewUrl)}"
       style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:4px">
      Open review queue
    </a>
  </p>
  <p style="color:#888;font-size:12px;margin-top:24px">
    Submission ID: ${escapeHtml(submissionId)}
  </p>
</body></html>`;

  for (const a of admins) {
    const result = await sendEmail({ to: a.email, subject, html, text });
    if (!result.ok) {
      console.warn(`admin notify to ${a.email} failed:`, result.error);
    }
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
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// ===== Internal helpers =====================================================

function stringField(form: FormData, key: string): string {
  const v = form.get(key);
  if (typeof v === "string") return v;
  return "";
}

function parseTags(raw: string): string[] | null {
  if (!raw) return [];
  const parts = raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length > MAX_TAGS) return null;
  for (const t of parts) {
    if (t.length > MAX_TAG_LEN) return null;
  }
  return parts;
}

function looksLikeText(bytes: Uint8Array): boolean {
  // Reject if too many non-printable / non-ASCII bytes in the first 512B
  let bad = 0;
  for (const b of bytes) {
    // Allow ASCII printable (0x20-0x7E) + common whitespace (\n \r \t)
    const ok = (b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d || b === 0x09;
    if (!ok) bad++;
  }
  // Less than 5% bad bytes = text
  return bad / Math.max(bytes.length, 1) < 0.05;
}

function getClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? null;
}

/**
 * Shared "approve" flow used by both submit-lut (direct_publish=true) and
 * moderate-submission (action=approve). Copied verbatim to both functions
 * (no _shared/ by design).
 *
 * Steps:
 *   1. Read submission row
 *   2. Slugify title; resolve collisions
 *   3. Download from private bucket, upload to public luts/
 *   4. Insert into public.luts
 *   5. Update submissions row: status=approved, reviewed_by/at, published_lut_id
 *
 * Returns { ok: true, lutId, slug } on success; { ok: false, error } on any
 * step's failure (with best-effort compensation for the storage copy).
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
    .select("id, user_id, title, description, tags, file_name, storage_path, status")
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
    // compensate: delete the copy we just uploaded
    await admin.storage.from(BUCKET_PUBLIC).remove([destPath]);
    return { ok: false, error: `lut insert: ${lutErr?.message ?? "empty"}` };
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
    // Don't roll back the lut/storage — that's worse. Just log.
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
    // fall through; the insert will fail with unique-violation if collision
    return base;
  }
  const taken = new Set((data ?? []).map((r: { slug: string }) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Fallback: append a short UUID fragment
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-鿿]+/g, "-") // also collapse CJK runs into single hyphen
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60) || "lut";
}
