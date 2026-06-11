/*
 * request-lut-download
 *
 * Single-file Supabase Edge Function. Everything (CORS, Turnstile verify,
 * Resend email, audit log) lives here on purpose — keeps deployment simple
 * and avoids relative-path quirks with `_shared/`.
 *
 * POST  /functions/v1/request-lut-download
 * Body  { lutId: string, email: string, turnstileToken: string }
 *
 * Returns:
 *   200  { ok: true, message: string }
 *   400  { error: "invalid_email" | "invalid_token" }
 *   404  { error: "lut_not_found" }
 *   429  { error: "rate_limited" }
 *   500  { error: "internal" }
 *   405  { error: "method_not_allowed" }
 *
 * Pipeline:
 *   1. Parse + validate input
 *   2. Verify Cloudflare Turnstile token (server-side)
 *   3. Look up LUT by id (table `luts`)
 *   4. Rate-limit (email 5/24h + 3/1h, IP 10/1h — all rolling windows)
 *   5. Generate Supabase Storage signed URL (default 30-min TTL)
 *   6. Send email via Resend
 *   7. Audit-log the request (table `lut_download_requests`)
 *
 * Required env (set via `supabase secrets set ...`):
 *   TURNSTILE_SECRET_KEY      Cloudflare Turnstile server-side secret
 *   RESEND_API_KEY            Resend API key (re_xxxxxxxx)
 *   EMAIL_FROM                e.g. "LUTs.site <download@luts.site>"
 *   STORAGE_BUCKET            (optional, default "luts")
 *   SITE_ORIGIN               (optional, comma-separated list of allowed origins;
 *                                e.g. "https://luts.site,http://127.0.0.1:4000";
 *                                echoes Origin if unset)
 *   SIGNED_URL_EXPIRES_IN     (optional, seconds, default 1800)
 *
 * Auto-injected by Supabase runtime (do NOT set manually):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== Constants ============================================================

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_EXPIRES_SECONDS = 1800; // 30 minutes
const RATE_LIMIT_EMAIL_PER_HOUR = 3;
const RATE_LIMIT_EMAIL_PER_DAY = 5;
const RATE_LIMIT_IP_PER_HOUR = 10;

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

interface RequestBody {
  lutId?: unknown;
  email?: unknown;
  turnstileToken?: unknown;
}

interface LutRow {
  id: string;
  slug: string;
  title: string;
  storage_path: string;
}

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

// ===== Main handler =========================================================

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return jsonResponse(req, 405, { error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const bucket = Deno.env.get("STORAGE_BUCKET") ?? "luts";
  const expiresIn = Number(
    Deno.env.get("SIGNED_URL_EXPIRES_IN") ?? DEFAULT_EXPIRES_SECONDS,
  );

  if (!supabaseUrl || !serviceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse(req, 500, { error: "internal" });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, 400, { error: "invalid_email" });
  }

  const lutId = typeof body.lutId === "string" ? body.lutId.trim() : "";
  const email = typeof body.email === "string"
    ? body.email.trim().toLowerCase()
    : "";
  const turnstileToken = typeof body.turnstileToken === "string"
    ? body.turnstileToken
    : "";

  // -- Step 1: validate inputs
  if (!email || !EMAIL_PATTERN.test(email) || email.length > 254) {
    return jsonResponse(req, 400, { error: "invalid_email" });
  }
  if (!lutId || lutId.startsWith("TBD-")) {
    return jsonResponse(req, 404, { error: "lut_not_found" });
  }
  if (!turnstileToken) {
    return jsonResponse(req, 400, { error: "invalid_token" });
  }

  const clientIp = getClientIp(req);

  // -- Step 2: verify Turnstile token
  const turnstile = await verifyTurnstile(turnstileToken, clientIp);
  if (!turnstile.ok) {
    console.warn("turnstile failed:", turnstile.error);
    return jsonResponse(req, 400, { error: "invalid_token" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -- Step 3: look up the LUT
  const { data: lut, error: lutErr } = await admin
    .from("luts")
    .select("id, slug, title, storage_path")
    .eq("id", lutId)
    .maybeSingle<LutRow>();

  if (lutErr) {
    console.error("lut lookup failed", lutErr);
    return jsonResponse(req, 500, { error: "internal" });
  }
  if (!lut) {
    await audit(admin, {
      lutId,
      email,
      ip: clientIp,
      userAgent: req.headers.get("user-agent"),
      status: "lut_not_found",
    });
    return jsonResponse(req, 404, { error: "lut_not_found" });
  }

  // -- Step 4: rate limit
  const limited = await isRateLimited(admin, email, clientIp);
  if (limited) {
    await audit(admin, {
      lutId: lut.id,
      email,
      ip: clientIp,
      userAgent: req.headers.get("user-agent"),
      status: "rate_limited",
    });
    return jsonResponse(req, 429, { error: "rate_limited" });
  }

  // -- Step 5: signed URL
  const { data: signed, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(lut.storage_path, expiresIn, {
      download: lut.storage_path.split("/").pop() ?? `${lut.slug}.cube`,
    });

  if (signErr || !signed?.signedUrl) {
    console.error("signed url failed", signErr);
    return jsonResponse(req, 500, { error: "internal" });
  }

  // -- Step 6: email
  const { subject, html, text } = buildDownloadEmail({
    lutTitle: lut.title,
    downloadUrl: signed.signedUrl,
    expiresMinutes: Math.round(expiresIn / 60),
  });
  const mail = await sendEmail({ to: email, subject, html, text });
  if (!mail.ok) {
    console.error("email failed", mail.error);
    await audit(admin, {
      lutId: lut.id,
      email,
      ip: clientIp,
      userAgent: req.headers.get("user-agent"),
      status: "email_failed",
    });
    return jsonResponse(req, 500, { error: "internal" });
  }

  // -- Step 7: audit
  await audit(admin, {
    lutId: lut.id,
    email,
    ip: clientIp,
    userAgent: req.headers.get("user-agent"),
    status: "success",
  });

  return jsonResponse(req, 200, {
    ok: true,
    message:
      `下载链接已发送到 ${email}，请查收邮件（链接 ${
        Math.round(expiresIn / 60)
      } 分钟内有效）。`,
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
  if (params.replyTo) body.reply_to = params.replyTo;

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

function buildDownloadEmail(opts: {
  lutTitle: string;
  downloadUrl: string;
  expiresMinutes: number;
}): { subject: string; html: string; text: string } {
  const { lutTitle, downloadUrl, expiresMinutes } = opts;
  const subject = `你申请的 LUT 下载链接：${lutTitle}`;
  const text = [
    `你好，`,
    ``,
    `这是你刚刚在 LUTs.site 申请的 LUT「${lutTitle}」下载链接：`,
    downloadUrl,
    ``,
    `该链接 ${expiresMinutes} 分钟内有效，过期后请重新到网站申请。`,
    ``,
    `如果不是你本人操作，可以忽略这封邮件。`,
    ``,
    `— LUTs.site`,
  ].join("\n");
  const html = `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px;background:#f7f7f7;font-family:'Helvetica Neue',Arial,sans-serif;color:#222;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
    <tr>
      <td style="padding:32px 32px 8px;">
        <h1 style="margin:0 0 16px;font-size:20px;color:#111;">你的 LUT 下载链接已就绪</h1>
        <p style="margin:0 0 16px;line-height:1.6;font-size:14px;">
          你刚刚在 <strong>LUTs.site</strong> 申请的 LUT —— <strong>${escapeHtml(lutTitle)}</strong> —— 的下载链接如下：
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 32px 24px;">
        <a href="${escapeAttr(downloadUrl)}"
           style="display:inline-block;padding:14px 28px;background:#111;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;letter-spacing:1px;text-transform:uppercase;">
          点击下载
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding:0 32px 32px;">
        <p style="margin:0 0 12px;font-size:13px;color:#555;line-height:1.6;">
          该链接 <strong>${expiresMinutes} 分钟</strong>内有效，过期后请重新到网站申请。<br>
          如果按钮无法点击，请把以下地址复制到浏览器：
        </p>
        <p style="margin:0 0 16px;font-size:12px;color:#666;word-break:break-all;background:#f3f3f3;padding:12px;border-radius:4px;">
          ${escapeHtml(downloadUrl)}
        </p>
        <p style="margin:0;font-size:12px;color:#888;line-height:1.6;">
          如果不是你本人操作，可以忽略这封邮件。<br>
          — LUTs.site
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return { subject, html, text };
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

function getClientIp(req: Request): string | null {
  // Supabase / Cloudflare in front of Edge Functions populate these headers.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") ?? null;
}

async function isRateLimited(
  admin: ReturnType<typeof createClient>,
  email: string,
  ip: string | null,
): Promise<boolean> {
  const now = Date.now();
  const sinceHour = new Date(now - 60 * 60 * 1000).toISOString();
  const sinceDay = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // Email per 24h (rolling) — longest window first, short-circuits the rest.
  const { count: emailDayCount, error: emailDayErr } = await admin
    .from("lut_download_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .eq("status", "success")
    .gte("created_at", sinceDay);

  if (emailDayErr) {
    console.error("rate-limit email/day lookup failed", emailDayErr);
    return false; // fail open: infra glitch shouldn't block legitimate users
  }
  if ((emailDayCount ?? 0) >= RATE_LIMIT_EMAIL_PER_DAY) return true;

  // Email per 1h (rolling)
  const { count: emailHourCount, error: emailHourErr } = await admin
    .from("lut_download_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .eq("status", "success")
    .gte("created_at", sinceHour);

  if (emailHourErr) {
    console.error("rate-limit email/hour lookup failed", emailHourErr);
    return false;
  }
  if ((emailHourCount ?? 0) >= RATE_LIMIT_EMAIL_PER_HOUR) return true;

  // IP per 1h (rolling)
  if (ip) {
    const { count: ipCount, error: ipErr } = await admin
      .from("lut_download_requests")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .eq("status", "success")
      .gte("created_at", sinceHour);
    if (ipErr) {
      console.error("rate-limit ip lookup failed", ipErr);
      return false;
    }
    if ((ipCount ?? 0) >= RATE_LIMIT_IP_PER_HOUR) return true;
  }

  return false;
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
