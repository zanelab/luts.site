# Supabase Backend

LUT 下载流程的后端：一张 Postgres 表 + 一个 Edge Function + 一段 Storage 配置。

## 目录结构

```
supabase/
├── functions/
│   └── request-lut-download/
│       └── index.ts         # 单文件：CORS + Turnstile + Resend + 限流 + 审计
└── migrations/
    └── 20260610000000_lut_download_init.sql   # 表结构 + RLS
```

## 接口契约

```
POST  /functions/v1/request-lut-download
Headers:
  Authorization: Bearer {SUPABASE_ANON_KEY}
  Content-Type: application/json

Body:
  { "lutId": "boost-shadow", "email": "user@example.com", "turnstileToken": "..." }
```

| 状态码 | Body                                                 | 触发条件 |
|--------|------------------------------------------------------|---------|
| 200    | `{ "ok": true, "message": "..." }`                   | 邮件已发出 |
| 400    | `{ "error": "invalid_email" }`                       | 邮箱格式不合法 |
| 400    | `{ "error": "invalid_token" }`                       | Turnstile 校验失败 |
| 404    | `{ "error": "lut_not_found" }`                       | `luts` 表里查不到该 ID（或 `TBD-` 前缀） |
| 429    | `{ "error": "rate_limited" }`                        | 同邮箱 24h 内 ≥ 5 次或 1h 内 ≥ 3 次成功；或同 IP 1h 内 ≥ 10 次 |
| 500    | `{ "error": "internal" }`                            | 数据库 / Storage / 邮件服务异常 |
| 405    | `{ "error": "method_not_allowed" }`                  | 非 POST |

错误码与前端 `assets/js/lut-download.js` 里的中文文案映射一一对应。

## 一次性准备

### 1. 安装 Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# 其他平台见 https://supabase.com/docs/guides/local-development/cli/getting-started
```

### 2. 关联远端项目

```bash
supabase login                              # 浏览器登录
supabase link --project-ref <your-project-ref>
```

`project-ref` 是 Dashboard URL 里 `app.supabase.com/project/<ref>` 的那段字符串。

### 3. 准备 Resend

1. 在 https://resend.com 注册账号，验证一个收发域名（如 `luts.site`）。
2. 创建 API key（`onboarding` → API Keys → Create）。
3. 记录下来：`re_xxxxxxxxx`。
4. 想要的发件人形如 `LUTs.site <download@luts.site>`，域名必须是上面验证过的。

### 4. 准备 Cloudflare Turnstile

1. 进 Cloudflare → Turnstile → Add Site。
2. 模式选 `Managed`，记录 **Site key**（`0x4...`，公开）和 **Secret key**（服务端用）。
3. Site key 放进根目录的 `.env`（前端用），Secret 放进 Supabase Secrets（下一步）。

## 部署步骤

### 步骤 A：跑数据库迁移

```bash
# 把 migrations/ 推到远端
supabase db push
```

迁移会创建 `public.luts`、`public.lut_download_requests` 两张表，并启用 RLS。Edge Function 用 service role key 绕过 RLS 写入；anon / authenticated 客户端无法直接读取这两张表。

### 步骤 B：创建 Storage Bucket

在 Dashboard → Storage → New bucket：

- **Name**：`luts`（如改名记得更新 `STORAGE_BUCKET` secret）
- **Public**：**否**（私有桶，下载靠签名 URL）
- 把 `.cube` / `.3dl` 文件上传到 `boost-shadow/boost-shadow.cube` 这样的路径。

### 步骤 C：配置 Edge Function Secrets

```bash
supabase secrets set \
  TURNSTILE_SECRET_KEY="<your turnstile secret>" \
  RESEND_API_KEY="re_xxxxxxxxxxxx" \
  EMAIL_FROM="LUTs.site <download@your-verified-domain>" \
  STORAGE_BUCKET="luts" \
  SITE_ORIGIN="https://luts.site" \
  SIGNED_URL_EXPIRES_IN="1800"
```

| Secret                       | 必填 | 说明 |
|------------------------------|------|------|
| `TURNSTILE_SECRET_KEY`       | 是   | Cloudflare Turnstile 服务端密钥（**不是** site key） |
| `RESEND_API_KEY`             | 是   | Resend API key（`re_` 开头） |
| `EMAIL_FROM`                 | 是   | 发件人，域名必须在 Resend 中已验证 |
| `STORAGE_BUCKET`             | 否   | Storage bucket 名称，默认 `luts` |
| `SITE_ORIGIN`                | 否   | 前端域名，用于 CORS。未设则回声请求 Origin |
| `SIGNED_URL_EXPIRES_IN`      | 否   | 签名 URL 有效期（秒），默认 1800 |

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 由 Supabase 运行时自动注入，不要手动设置。

### 步骤 D：部署函数

```bash
supabase functions deploy request-lut-download
```

部署后函数 URL 为：

```
https://<project-ref>.supabase.co/functions/v1/request-lut-download
```

### 步骤 E：登记 LUT 行

每个真正可下载的 LUT 都需要在 `public.luts` 里有一行。可以用 Dashboard → Table editor，或 SQL：

```sql
insert into public.luts (id, slug, title, storage_path)
values
  ('boost-shadow', 'boost-shadow', '强化暗影', 'boost-shadow/boost-shadow.cube'),
  ('sun-shine',    'sun-shine',    '阳光灿烂', 'sun-shine/sun-shine.cube');
```

然后把对应 markdown 里的 `lutId: TBD-boost-shadow` 改成 `lutId: boost-shadow`，前端就会从拦截状态切到真正调用 Edge Function。

## 本地调试

```bash
# 启动本地 Supabase（含 Postgres、Storage、Auth）
supabase start

# 启动 Edge Function（监听 http://127.0.0.1:54321/functions/v1/...）
supabase functions serve request-lut-download --no-verify-jwt --env-file ./supabase/.env.local
```

`./supabase/.env.local`（**不提交**，已被 `.gitignore`）示例：

```ini
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=LUTs.site <download@your-verified-domain>
STORAGE_BUCKET=luts
SITE_ORIGIN=http://127.0.0.1:4000
SIGNED_URL_EXPIRES_IN=1800
```

Turnstile 调试可以用 Cloudflare 的 [Always passes](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) 测试密钥：
- Site key: `1x00000000000000000000AA`
- Secret key: `1x0000000000000000000000000000000AA`

### curl 自测

```bash
curl -i -X POST http://127.0.0.1:54321/functions/v1/request-lut-download \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <anon-key>" \
  -d '{
    "lutId": "boost-shadow",
    "email": "you@example.com",
    "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX"
  }'
```

## 安全说明

- **service-role key 只在 Edge Function 内部使用**，不会下发给浏览器。
- `luts` / `lut_download_requests` 已启用 RLS 且无 policy，anon/auth 客户端无法直接读取或写入。
- 签名 URL 走 Supabase Storage 自带签名机制，30 分钟后自动失效；即使被中转分享，过期即不可用。
- 限流默认：**单邮箱 5 次/24 小时 且 3 次/小时；单 IP 10 次/小时**（任一命中即返回 `rate_limited`）。要调整改 `index.ts` 顶部的 `RATE_LIMIT_EMAIL_PER_DAY` / `RATE_LIMIT_EMAIL_PER_HOUR` / `RATE_LIMIT_IP_PER_HOUR` 三个常量并重新部署。
- Turnstile 在前端 + 服务端双重校验，前端 token 只能用一次；重放被 Cloudflare 拒绝。

## 运维

- **查看实时日志**：Dashboard → Edge Functions → request-lut-download → Logs，或 `supabase functions logs request-lut-download`。
- **查最近请求**：
  ```sql
  select created_at, lut_id, status, email, ip
  from public.lut_download_requests
  order by created_at desc
  limit 50;
  ```
- **解封某个邮箱**：删掉该邮箱过去 24 小时内 `status='success'` 的记录，所有窗口（1h、24h）都会一起清零。
  ```sql
  delete from public.lut_download_requests
  where email = 'someone@example.com'
    and status = 'success'
    and created_at > now() - interval '24 hours';
  ```
