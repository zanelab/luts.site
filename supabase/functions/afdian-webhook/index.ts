/*
 * afdian-webhook
 *
 * Single-file Supabase Edge Function. Receives order push from 爱发电 (Afdian),
 * verifies signature, does Open API second-check, looks up LUT, and sends the
 * download URL to the buyer via Afdian DM (/api/open/send-msg).
 *
 * POST  /functions/v1/afdian-webhook
 * Headers:
 *   sign:       base64(RSA-SHA256(sign_str, afdian-private-key))   2025-07-01+
 *   Content-Type: application/json
 * Body (decoded):
 *   {
 *     "ec": 200, "em": "ok",
 *     "data": {
 *       "type": "order",
 *       "order": {
 *         "out_trade_no": "...", "user_id": "...", "plan_id": "...",
 *         "total_amount": "5.00", "status": 2, "product_type": 1,
 *         "sku_detail": [{ "sku_id": "..." }], ...
 *       }
 *     }
 *   }
 *
 * Returns:  { ec: <int>, em: <string> }   (Afdian treats non-200 as failure)
 *   200 { ec: 200, em: "" }               — accepted (DM may still fail internally)
 *   200 { ec: 200, em: "" }               — duplicate webhook (idempotent)
 *   400 { ec: 400, em: "invalid signature" }
 *   400 { ec: 400, em: "missing sign header" }
 *   400 { ec: 400, em: "malformed payload" }
 *   402 { ec: 402, em: "order not paid" } — Open API second-check failed
 *   404 { ec: 404, em: "unknown sku" }
 *   422 { ec: 422, em: "invalid product type" }
 *   500 { ec: 500, em: "internal" }
 *
 * Pipeline:
 *   1. Read raw body (for sign verification)
 *   2. Parse JSON + structural check
 *   3. Verify RSA-SHA256 sign (公钥 hardcoded below)
 *   4. Open API `query-order` second-check
 *   5. Look up LUT by afdian_sku_id
 *   6. Idempotency: skip DM if order already paid + DM sent
 *   7. Generate signed URL (Supabase Storage, 30-min TTL)
 *   8. Send DM via /api/open/send-msg
 *   9. upsert paid_lut_orders
 *  10. Return 200 (DM failure logged but webhook still 200)
 *
 * Required env (set via `supabase secrets set ...`):
 *   AFDIAN_USER_ID            爱发电创作者 user_id
 *   AFDIAN_TOKEN              Open API token
 *   STORAGE_BUCKET            (optional, default "luts")
 *   SIGNED_URL_EXPIRES_IN     (optional, seconds, default 1800)
 *
 * NOT in env (intentionally hardcoded, see design.md §10):
 *   AFDIAN_PUBLIC_KEY         验签公钥 — fixed by Afdian for all webhooks
 *
 * Auto-injected by Supabase runtime (do NOT set manually):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== Constants ============================================================

// 公钥。爱发电于 2025-07-01 在所有 webhook 中加入签名, 公钥固定。
// 见 https://ifdian.net/dashboard/dev 文档 "签名介绍" 段。
const AFDIAN_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwwdaCg1Bt+UKZKs0R54y
lYnuANma49IpgoOwNmk3a0rhg/PQuhUJ0EOZSowIC44l0K3+fqGns3Ygi4AfmEfS
4EKbdk1ahSxu7Zkp2rHMt+R9GarQFQkwSS/5x1dYiHNVMiR8oIXDgjmvxuNes2Cr
8fw9dEF0xNBKdkKgG2qAawcN1nZrdyaKWtPVT9m2Hl0ddOO9thZmVLFOb9NVzgYf
jEgI+KWX6aY19Ka/ghv/L4t1IXmz9pctablN5S0CRWpJW3Cn0k6zSXgjVdKm4uN7
jRlgSRaf/Ind46vMCm3N2sgwxu/g3bnooW+db0iLo13zzuvyn727Q3UDQ0MmZcEW
MQIDAQAB
-----END PUBLIC KEY-----`;

const AFDIAN_OPEN_API_BASE = "https://ifdian.net/api/open";
const DEFAULT_EXPIRES_SECONDS = 1800; // 30 minutes

// ===== Types ================================================================

interface WebhookOrder {
  out_trade_no: string;
  custom_order_id?: string;
  user_id: string;
  user_private_id?: string;
  plan_id: string;
  month?: number;
  total_amount: string;
  show_amount?: string;
  status: number;
  remark?: string;
  redeem_id?: string;
  product_type: number;
  discount?: string;
  sku_detail?: Array<{ sku_id: string; count?: number; name?: string }>;
  address_person?: string;
  address_phone?: string;
  address_address?: string;
}

interface WebhookPayload {
  ec: number;
  em?: string;
  data: {
    type: string;
    order: WebhookOrder;
  };
}

interface LutRow {
  id: string;
  slug: string;
  title: string;
  storage_path: string;
}

interface OpenApiOrder {
  out_trade_no: string;
  status: number;
  total_amount: string;
  plan_id: string;
  sku_detail?: Array<{ sku_id: string }>;
}

interface OpenApiResponse {
  ec: number;
  em?: string;
  data?: {
    list?: OpenApiOrder[];
    total_count?: number;
    total_page?: number;
  };
}

interface OpenApiSendMsgResponse {
  ec: number;
  em?: string;
  data?: { message_id?: string };
}

// ===== Main handler =========================================================

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(200, { ec: 405, em: "method not allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const bucket = Deno.env.get("STORAGE_BUCKET") ?? "luts";
  const expiresIn = Number(
    Deno.env.get("SIGNED_URL_EXPIRES_IN") ?? DEFAULT_EXPIRES_SECONDS,
  );
  const afdianUserId = Deno.env.get("AFDIAN_USER_ID");
  const afdianToken = Deno.env.get("AFDIAN_TOKEN");

  if (!supabaseUrl || !serviceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse(200, { ec: 500, em: "internal" });
  }
  if (!afdianUserId || !afdianToken) {
    console.error("Missing AFDIAN_USER_ID or AFDIAN_TOKEN");
    return jsonResponse(200, { ec: 500, em: "internal" });
  }

  // -- 1. Read raw body (sign verification needs the byte-exact body)
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    console.error("body read failed", err);
    return jsonResponse(200, { ec: 400, em: "malformed payload" });
  }

  // -- 2. Parse + structural check
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse(200, { ec: 400, em: "malformed payload" });
  }

  if (
    !payload ||
    payload.ec !== 200 ||
    !payload.data ||
    payload.data.type !== "order" ||
    !payload.data.order
  ) {
    return jsonResponse(200, { ec: 400, em: "malformed payload" });
  }
  const order = payload.data.order;
  if (order.status !== 2) {
    return jsonResponse(200, { ec: 402, em: "order not paid" });
  }
  if (order.product_type !== 1) {
    return jsonResponse(200, { ec: 422, em: "invalid product type" });
  }
  const skuId = order.sku_detail?.[0]?.sku_id;
  if (!skuId) {
    return jsonResponse(200, { ec: 400, em: "malformed payload" });
  }

  // -- 3. Verify signature
  const signHeader = req.headers.get("sign");
  if (!signHeader) {
    return jsonResponse(200, { ec: 400, em: "missing sign header" });
  }
  const signOk = await verifyAfdianSign(
    rawBody,
    signHeader,
    order.out_trade_no,
    order.user_id,
    order.plan_id,
    order.total_amount,
  );
  if (!signOk) {
    return jsonResponse(200, { ec: 400, em: "invalid signature" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -- 4. Open API second-check (defense in depth — even if signing key
  //      leaks, attacker can't fake an order that Afdian didn't actually
  //      settle. Also catches `status=2` race conditions where the order
  //      got refunded between the webhook push and our processing.)
  const verified = await queryOrder(
    afdianUserId,
    afdianToken,
    order.out_trade_no,
  );
  if (!verified.ok) {
    console.warn("query-order failed", verified.error);
    return jsonResponse(200, { ec: 402, em: "order not paid" });
  }
  if (verified.status !== 2) {
    return jsonResponse(200, { ec: 402, em: "order not paid" });
  }
  if (verified.skuId !== skuId) {
    console.warn("sku mismatch", { webhook: skuId, api: verified.skuId });
    return jsonResponse(200, { ec: 400, em: "sku mismatch" });
  }

  // -- 5. Look up LUT by afdian_sku_id
  const { data: lut, error: lutErr } = await admin
    .from("luts")
    .select("id, slug, title, storage_path")
    .eq("afdian_sku_id", skuId)
    .maybeSingle<LutRow>();

  if (lutErr) {
    console.error("lut lookup failed", lutErr);
    return jsonResponse(200, { ec: 500, em: "internal" });
  }
  if (!lut) {
    return jsonResponse(200, { ec: 404, em: "unknown sku" });
  }

  // -- 6. Idempotency: if we already delivered a DM for this order, skip.
  //      Re-pushing the same webhook must not spam the buyer.
  const { data: existing, error: existingErr } = await admin
    .from("paid_lut_orders")
    .select("id, state, dm_sent_at")
    .eq("order_no", order.out_trade_no)
    .maybeSingle();

  if (existingErr) {
    console.error("paid_lut_orders lookup failed", existingErr);
    return jsonResponse(200, { ec: 500, em: "internal" });
  }
  const alreadyDelivered = existing?.state === "paid" &&
    existing.dm_sent_at !== null;

  // -- 7. Generate signed URL (we do this before DM, so the URL inside the
  //      DM is fresh; we don't store it in DB)
  const { data: signed, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(lut.storage_path, expiresIn, {
      download: lut.storage_path.split("/").pop() ?? `${lut.slug}.cube`,
    });
  if (signErr || !signed?.signedUrl) {
    console.error("signed url failed", signErr);
    return jsonResponse(200, { ec: 500, em: "internal" });
  }

  // -- 8. Send DM (skip if already delivered)
  let dmOk = alreadyDelivered;
  let dmError: string | null = null;
  let dmMessageId: string | null = existing?.dm_sent_at
    ? (await admin.from("paid_lut_orders")
      .select("dm_message_id")
      .eq("order_no", order.out_trade_no)
      .maybeSingle()).data?.dm_message_id ?? null
    : null;

  if (!alreadyDelivered) {
    const expiresMinutes = Math.round(expiresIn / 60);
    const content = buildDmContent({
      lutTitle: lut.title,
      downloadUrl: signed.signedUrl,
      expiresMinutes,
    });
    const dm = await sendDm(
      afdianUserId,
      afdianToken,
      order.user_id,
      content,
    );
    dmOk = dm.ok;
    dmError = dm.ok ? null : dm.error ?? "unknown dm error";
    dmMessageId = dm.ok ? (dm.messageId ?? null) : null;
  }

  // -- 9. upsert paid_lut_orders
  const amountCents = Math.round(parseFloat(order.total_amount) * 100);
  const row = {
    order_no: order.out_trade_no,
    lut_id: lut.id,
    sku_id: skuId,
    plan_id: order.plan_id,
    buyer_user_id: order.user_id,
    amount_cents: amountCents,
    state: "paid" as const,
    remark: order.remark ?? null,
    raw_payload: payload,
    dm_sent_at: dmOk ? new Date().toISOString() : null,
    dm_message_id: dmMessageId,
    dm_error: dmError,
  };

  const { error: upErr } = await admin
    .from("paid_lut_orders")
    .upsert(row, { onConflict: "order_no" });

  if (upErr) {
    console.error("paid_lut_orders upsert failed", upErr);
    return jsonResponse(200, { ec: 500, em: "internal" });
  }

  // -- 10. Always 200 — DM failure is recorded in dm_error, admin retries.
  return jsonResponse(200, { ec: 200, em: "" });
});

// ===== Response helper ======================================================

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status, // we use 200 for Afdian-visible responses (ec field carries the real code)
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// ===== Signature verification ==============================================

async function verifyAfdianSign(
  rawBody: string,
  signHeader: string,
  outTradeNo: string,
  userId: string,
  planId: string,
  totalAmount: string,
): Promise<boolean> {
  // sign_str = out_trade_no + user_id + plan_id + total_amount  (concat, no separator)
  const signStr = `${outTradeNo}${userId}${planId}${totalAmount}`;
  const data = new TextEncoder().encode(signStr);

  // PEM -> CryptoKey. Strip BEGIN/END headers + newlines.
  const pem = AFDIAN_PUBLIC_KEY
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  const der = base64ToBytes(pem);

  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "spki",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch (err) {
    console.error("importKey failed", err);
    return false;
  }

  // signHeader is base64. We deliberately *don't* URL-decode it — Afdian
  // sends raw base64 in the header.
  let signature: Uint8Array;
  try {
    signature = base64ToBytes(signHeader);
  } catch {
    return false;
  }

  try {
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signature,
      data,
    );
  } catch (err) {
    console.error("verify threw", err);
    return false;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  // atob is part of Deno globals; convert string -> Uint8Array.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ===== Open API client ======================================================

/**
 * Build the Afdian signature for Open API calls:
 *   sign = md5(token + "params" + params + "ts" + ts + "user_id" + user_id)
 *
 * See design.md §4 / 爱发电 docs "签名介绍".
 */
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

async function openApiCall<T>(
  userId: string,
  token: string,
  path: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const paramsStr = JSON.stringify(params);
  const ts = Math.floor(Date.now() / 1000);
  const sign = await afdianSign(token, userId, paramsStr, ts);

  let res: Response;
  try {
    res = await fetch(`${AFDIAN_OPEN_API_BASE}${path}`, {
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
    return {
      ok: false,
      status: 0,
      data: null,
      error: `network: ${(err as Error).message}`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: `http ${res.status}: ${await res.text().catch(() => "")}`,
    };
  }
  const body = await res.json() as OpenApiResponse | OpenApiSendMsgResponse;
  if (body.ec !== 200) {
    return {
      ok: false,
      status: 200,
      data: null,
      error: `ec ${body.ec}: ${body.em ?? ""}`,
    };
  }
  return { ok: true, status: 200, data: body as unknown as T };
}

async function queryOrder(
  userId: string,
  token: string,
  outTradeNo: string,
): Promise<
  | { ok: true; status: number; skuId: string | null }
  | { ok: false; error: string }
> {
  const r = await openApiCall<OpenApiResponse>(
    userId,
    token,
    "/query-order",
    { out_trade_no: outTradeNo },
  );
  if (!r.ok || !r.data) return { ok: false, error: r.error ?? "unknown" };
  const first = r.data.data?.list?.[0];
  if (!first) {
    return { ok: false, error: "order not found in query-order response" };
  }
  return {
    ok: true,
    status: first.status,
    skuId: first.sku_detail?.[0]?.sku_id ?? null,
  };
}

async function sendDm(
  userId: string,
  token: string,
  recipient: string,
  content: string,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const r = await openApiCall<OpenApiSendMsgResponse>(
    userId,
    token,
    "/send-msg",
    { recipient, content },
  );
  if (!r.ok) return { ok: false, error: r.error ?? "unknown" };
  return {
    ok: true,
    messageId: r.data?.data?.message_id,
  };
}

// ===== DM content ===========================================================

function buildDmContent(opts: {
  lutTitle: string;
  downloadUrl: string;
  expiresMinutes: number;
}): string {
  const { lutTitle, downloadUrl, expiresMinutes } = opts;
  // 爱发电 DM 是纯文本, 不支持 HTML。
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
