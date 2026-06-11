# Supabase Backend

LUT 站点的后端：下载流程 + 投稿贡献流程。两套独立的 Edge Function 各自单文件部署。

## 目录结构

```
supabase/
├── functions/
│   ├── request-lut-download/
│   │   └── index.ts             # 下载流：CORS + Turnstile + Resend + 限流 + 审计
│   ├── submit-lut/
│   │   └── index.ts             # 投稿：JWT 验证 + multipart 上传 + 限流 + admin 邮件通知
│   └── moderate-submission/
│       └── index.ts             # 审批：admin-only JSON 接口，approve / reject
├── migrations/
│   ├── 20260610000000_lut_download_init.sql      # luts + lut_download_requests
│   └── 20260611000000_lut_contribution.sql       # users + submissions + luts 扩展 + RLS + 触发器
└── sql/
    └── bootstrap-admin.sql       # 把某个登录用户提升为 admin
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

---

# 投稿贡献流程

让登录用户提交 `.cube` LUT，admin 在 `/admin/submissions/` 审批；通过后文件从 `lut-submissions` 复制到 `luts` 公开桶，并自动写入 `public.luts` 表。

## 数据模型

迁移 `20260611000000_lut_contribution.sql` 增加：

| 表 | 用途 |
|----|------|
| `public.users` | 与 `auth.users` 1:1 镜像（`role` 字段 `user` / `admin`） |
| `public.submissions` | 投稿记录（pending / approved / rejected 三态） |
| `public.luts` | 扩展字段：`description` / `tags` / `source_submission_id` / `published_by` / `updated_at` |

外加：

- `auth.users` 插入触发器自动写入 `public.users`
- `public.luts` 的 `luts_select_public` RLS policy：anon / authenticated 可读
- `public.submissions` RLS：本人 + admin 可读，所有写仅 service_role
- `touch_updated_at` 触发器

## 一次性准备

### 1. 创建 Storage Bucket

Dashboard → Storage → New bucket：

- **Name**：`lut-submissions`
- **Public**：**否**（私有桶，仅 service_role Edge Function 可读写）
- 文件落地路径：`submissions/{user_id}/{submission_id}.cube`
- 不需要额外 RLS policy：Edge Function 用 service_role 绕过

公开桶 `luts` 沿用下载流配置（`supabase storage` 共享）。

### 2. 跑数据库迁移

```bash
supabase db push
```

迁移会创建 `public.users` / `public.submissions`、扩展 `public.luts` 字段、加 RLS policy、装触发器。所有 SQL 都 `IF NOT EXISTS`，可重复跑。

### 3. 提升第一个 admin

参见 `supabase/sql/bootstrap-admin.sql`。流程：

1. 目标用户先用 magic link 登录一次（`/contribute/` 点登录会触发）
2. Dashboard → Authentication → Users 拿到 `User UID`
3. 跑：
   ```sql
   update public.users set role = 'admin' where id = '<uid>';
   ```
4. 在 `/admin/submissions/` 验证：右上角头像下拉出现「⚙ 审批」

### 4. 部署 Edge Function

```bash
supabase functions deploy submit-lut
supabase functions deploy moderate-submission
```

`TURNSTILE_SECRET_KEY` / `RESEND_API_KEY` / `EMAIL_FROM` / `SITE_ORIGIN` 沿用下载流已有的 secrets（同一项目）。

## 接口契约

### `submit-lut`

```
POST  /functions/v1/submit-lut
Headers:
  Authorization: Bearer <user JWT>
  Content-Type: multipart/form-data

Body:
  file:            .cube file (binary, <= 10MB)
  title:           string 1-80
  description:     string 1-500
  tags:            string, 逗号分隔，<= 5 个，每项 <= 16 字
  turnstileToken:  string
  direct_publish:  "true" | "false"（仅 admin 设为 "true" 时跳过队列）
```

| 状态码 | Body                              | 触发 |
|--------|-----------------------------------|------|
| 200    | `{ ok, submissionId, status, lutId?, slug? }` | 成功 |
| 400    | `{ error: "invalid_input" }`     | 字段 / 文件 / 扩展名不合法 |
| 400    | `{ error: "invalid_token" }`     | Turnstile 失败 |
| 401    | `{ error: "unauthenticated" }`   | 缺 / 无效 JWT |
| 403    | `{ error: "forbidden" }`         | `direct_publish=true` 但非 admin |
| 429    | `{ error: "rate_limited" }`      | 邮箱 24h 内 ≥ 5 次成功 |
| 500    | `{ error: "upload_failed" \| "internal" }` | 存储 / DB 异常 |

### `moderate-submission`

```
POST  /functions/v1/moderate-submission
Headers:
  Authorization: Bearer <admin JWT>
  Content-Type: application/json

Body:
  { "submissionId": "<uuid>", "action": "approve" }
  { "submissionId": "<uuid>", "action": "reject", "reason": ">=10 chars" }
```

| 状态码 | Body                              | 触发 |
|--------|-----------------------------------|------|
| 200    | `{ ok, status: "approved", lutId, slug }` | 通过 |
| 200    | `{ ok, status: "rejected" }`       | 拒绝 |
| 400    | `{ error: "invalid_input" }`     | reason 过短 / JSON 缺字段 |
| 401    | `{ error: "unauthenticated" }`   | 缺 / 无效 JWT |
| 403    | `{ error: "forbidden" }`         | 非 admin |
| 404    | `{ error: "not_found" }`         | submissionId 不存在 |
| 409    | `{ error: "already_reviewed" }`  | status != pending |

## 工作流

### 普通用户

1. 访问 `/contribute/`，点「登录后投稿」 → 输入邮箱 → 收到 magic link → 回到 `/contribute/`
2. 填写表单（.cube ≤ 10MB、title 1-80、description 1-500、≤ 5 tags）
3. 提交 → 文件存 `lut-submissions/` + `submissions` 表 status=pending + 所有 admin 收到通知邮件
4. 跳到 `/contribute/mine/`，看到刚提交的状态

### admin 用户

1. 同样的 `/contribute/` 表单，多出「直接发布」开关
2. 勾上 + 提交 = 走 publishApprovedLut 完整链路，submissions 直接置 approved
3. 访问 `/admin/submissions/`，三个 tab：pending（默认）/ approved / rejected
4. 点详情抽屉：「Approve & Publish」/ 「Reject + 原因」
5. 通过后：luts 表新增行 + luts/{slug}.cube 存在公开桶。**admin 还需要手动把 luts.id 复制到 `_luts/{slug}.md` 的 `lutId:` 字段，下次 Jekyll build 后前台才能展示**

## 运维

```sql
-- 看投稿队列
select id, user_email, title, status, created_at
from public.submissions
order by created_at desc
limit 50;

-- 找漏掉的 admin 通知
select user_email, title, created_at
from public.submissions
where status = 'pending'
  and created_at > now() - interval '24 hours'
order by created_at;
```

Edge Function 日志：`supabase functions logs submit-lut` / `supabase functions logs moderate-submission`。
