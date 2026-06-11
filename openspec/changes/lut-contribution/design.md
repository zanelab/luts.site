# Design: lut-contribution

## 概述
扩展 LUTs.site：任何访客（无需登录）可在 `/contribute/` 投稿 `.cube` LUT，必须填邮箱（限流 + 拒绝通知用）；admin 通过 Supabase magic link 登录后，在 `/admin/submissions/` 看队列并批准 / 拒绝；批准后文件复制到现有 public `luts/` bucket，`luts` SQL 表新增一行，admin 手动同步 markdown 让前台可展示。详见 `proposal.md` 的 What/Why/Scope 与验收标准。

## 技术方案

### 方案对比 & 最终决策

| 维度 | 候选 | 决策 | 理由 |
|---|---|---|---|
| 投稿是否要登录 | 必须登录 / 完全匿名 / 表单填邮箱但免登录 | **表单填邮箱 + 免登录（投稿）** | 用户体验：投稿是低频操作，强制登录是巨大摩擦；邮箱仍能限流 + 通知 |
| Admin 角色 | Supabase Auth + `users.role` / 邮箱白名单 / OAuth group | **`users.role='admin'`** | 走 SQL 手工 bootstrap，可审计可撤销 |
| Admin 登录通道 | Supabase magic link / OAuth / 邮箱白名单硬编码 | **magic link (Supabase)** | 与投稿解耦：只有 admin 走 magic link；普通访客不感知 |
| 文件上传机制 | Edge Function multipart / Storage signed URL / RLS 直传 | **Edge Function 收 multipart** | 限流、Turnstile 验证、admin 通知都在一处；存储路径由后端控制 |
| Slug 生成 | 自动 / 表单可选 / 表单必填 | **自动从 title 生成（碰撞加 -2/-3）** | 用户填最少；管理员投稿允许覆盖（direct_publish=true 时） |
| 状态推送 | Realtime / 轮询 / 手动刷新 | **手动刷新** | 最低依赖；投稿非高频 |
| Tags 存储 | JSONB 数组 / 独立 tag 表 | **JSONB 数组** | 前期单语种、不需要按 tag 反查人；后期可平滑迁移 |
| 详情页路由 | 现有 markdown / 独立 `/luts-db/` / 同一路由 + JS 补 | **保留现有 markdown，admin 手动同步** | 详情页渲染零改动；新 LUT 走 markdown 加 front matter 即可，lutId 来自 SQL `luts.id` |
| Admin 上传路径 | 同表单 + 「直接发布」 / 独立 / 全走队列 | **同表单 + 「直接发布」** | UI 复用；用户故事对称；admin 登录后才显示该开关 |
| Edge Function 拆分 | 单 function 处理全部 / 按动作拆 | **按动作拆（`submit-lut` / `moderate-submission`）** | 单一职责，限流和鉴权逻辑互不污染 |
| 限流策略 | 邮箱 5/24h + 3/1h / 仅 IP / 邮箱+IP | **沿用 `request-lut-download` 的 5/24h（仅邮箱）** | 投稿是低频；邮箱足够；IP 限流容易误伤 NAT |
| 跨页 admin 入口 | 顶导 / 浮按钮 / 不放 | **顶导右上角「登录」按钮，admin 登录后变头像 + 「⚙ 审批」** | 普通用户看到的是「登录」按钮；不影响投稿体验 |

## 详细设计

### 数据模型

新增 2 张表（沿用现有 `lut_download_requests` 命名风格）：

```sql
-- 用户元数据，与 auth.users 1:1（仅 admin 通过 magic link 登录后写入）
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

-- 投稿记录（user_id 可空：匿名投稿无 auth.uid()）
create type submission_status as enum ('pending', 'approved', 'rejected');

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,  -- 匿名时为 NULL
  user_email text not null,                   -- 投稿时邮箱（必填，限流 + 通知用）
  title text not null check (char_length(title) between 1 and 80),
  description text not null check (char_length(description) between 1 and 500),
  tags jsonb not null default '[]'::jsonb,    -- text 数组
  file_name text not null,                    -- 原始文件名（"boost_v2.cube"）
  file_size bigint not null check (file_size > 0 and file_size <= 10 * 1024 * 1024),
  storage_path text not null,                 -- "submissions/{user_id_or_anonymous}/{submission_id}.cube"
  status submission_status not null default 'pending',
  reject_reason text check (char_length(reject_reason) >= 10),
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  published_lut_id uuid,                      -- approved 时填，指向 luts.id
  created_at timestamptz not null default now()
);

create index submissions_user_id_idx on public.submissions (user_id, created_at desc);
create index submissions_status_created_idx on public.submissions (status, created_at desc);
create index submissions_user_email_day_idx on public.submissions (user_email, created_at desc);

-- LUT 主表（审批通过后写入；不与现有 markdown LUT 冲突）
-- 注意：luts 表的 row 代表「已发布」的 LUT；未发布的投稿只在 submissions 表
create table public.luts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title text not null,
  description text not null,
  storage_path text not null,                 -- "luts/{slug}.cube"
  tags jsonb not null default '[]'::jsonb,
  source_submission_id uuid references public.submissions(id),  -- 来源溯源
  published_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index luts_created_at_idx on public.luts (created_at desc);
```

**RLS**：
- `users` 表：本人可读自己的 row；admin 可读全部；`insert/update` 仅 service_role（即 Edge Function）
- `submissions` 表：admin 可读全部（用于审批）；anon / 普通用户都不可读（无 SELECT policy）；所有人 INSERT 都禁止（只能通过 service_role Edge Function）
- `luts` 表：所有人可读；INSERT/UPDATE 仅 service_role

### API 定义

#### Edge Function: `submit-lut`（POST）

接受 `multipart/form-data`：
- `file` (binary, .cube, 必填)
- `email` (string, 必填，投稿人邮箱；用于限流 + 拒绝通知)
- `title` (string, 必填)
- `description` (string, 必填)
- `tags` (string, 必填，逗号分隔，后端解析)
- `direct_publish` (string "true"/"false", 默认 "false")
- `turnstileToken` (string, 必填)

Headers：
- `Authorization: Bearer <user JWT>` (可选；仅在 admin 想用 direct_publish 时必填)

验证链：
1. （可选）JWT → `auth.getUser(token)` → 拿到 `user.id`、`role`；解析失败视为匿名
2. `email` 字段格式校验（必填）
3. 如果 `direct_publish=true`，要求 JWT + `role='admin'`，否则 403
4. 表单字段验证（长度、类型、文件 size ≤ 10MB、扩展名 `.cube`）
5. 限流：`submissions` 表按 `user_email` 24h 滚动计数 ≥ 5 → 429 `rate_limited`
6. Turnstile token 验证（与下载相同 secret，复用 verifyTurnstile 函数）
7. 生成 `submission_id = uuid()`
8. `admin.storage.from('lut-submissions').upload('submissions/{user_id_or_anonymous}/{submission_id}.cube', file)`，匿名投稿用 `submissions/anonymous/{submission_id}.cube`
9. `admin.from('submissions').insert({ id, user_id, user_email, ...})`，匿名时 `user_id = NULL`
10. 如果是普通用户投稿（`direct_publish=false`）：发邮件给所有 admin
11. 如果是 admin 直接发布：调内部 helper `publishLut(submission)` 走完整 publish 链路（同 moderate-submission Approve 流程），但状态直接置 approved

返回：
- 200: `{ ok: true, submissionId, status: 'pending' | 'published', lutId?, slug? }`
- 4xx/5xx: `{ error: '<code>' }`，错误码见下表

错误码：

| code | HTTP | 中文 |
|------|------|------|
| `forbidden` | 403 | 无权操作（direct_publish 但非 admin） |
| `invalid_input` | 400 | 字段不合法（邮箱 / 标题 / 描述 / tags / 文件） |
| `invalid_token` | 400 | 人机验证失败 |
| `rate_limited` | 429 | 投稿过于频繁 |
| `upload_failed` | 500 | 文件上传失败 |
| `internal` | 500 | 服务器异常 |

#### Edge Function: `moderate-submission`（POST）

接受 JSON：
```ts
{
  submissionId: string,
  action: 'approve' | 'reject',
  reason?: string  // reject 时必填，≥10 字
}
```

Headers：同上，要求 JWT + admin role。

Approve 流程：
1. 取 submission 行（404 if not found；409 if status != pending）
2. 校验 slug 唯一；若 collision → 在 title slug 基础上加 -2/-3/... 试到不冲突
3. `admin.storage.from('luts').upload('luts/{slug}.cube', file)` —— 从 `lut-submissions/{user_id}/{submission_id}.cube` 下载再上传到 `luts/{slug}.cube`
4. `admin.from('luts').insert({ slug, title, description, storage_path, tags, source_submission_id, published_by })`
5. `admin.from('submissions').update({ status: 'approved', reviewed_by, reviewed_at, published_lut_id })`
6. 不发邮件给投稿人（按 proposal out-of-scope）

Reject 流程：
1. 同上 1
2. 校验 `reason` ≥ 10 字
3. `admin.from('submissions').update({ status: 'rejected', reject_reason, reviewed_by, reviewed_at })`
4. 删除 `lut-submissions` 里的文件（避免泄漏）
5. 发邮件给投稿人：`from + reject_reason`

返回：
- 200: `{ ok: true, status: 'approved' | 'rejected', lutId?, slug? }`
- 错误码同 submit-lut + `not_found` (404) + `already_reviewed` (409)

### UI 交互

```
Header 顶导
  ├─ LUTs / Blog / 投稿  (现有 + 新增)
  └─ 右上角：[登录] 按钮   (admin 登录后变为头像下拉)
              ├─ 头像初始
              ├─ ⚙ 审批  (仅 admin 可见) → /admin/submissions/
              └─ 退出
```

`/contribute/` 页面（**无需登录**）：
- 顶部 banner：投稿流程说明 + 「提交后，管理员审核通过即可发布」
- 表单字段（顺序）：
  - **邮箱** (必填，限流 + 拒绝通知用)
  - .cube 文件 (accept=".cube", ≤10MB)
  - 标题 (1-80)
  - 描述 (1-500)
  - 标签 (≤5 个, 每个 ≤16 字)
  - Turnstile widget
  - **仅当 admin 登录后** 额外显示「直接发布」开关
  - 提交按钮：表单合法 + Turnstile 通过 → enabled
- 成功：显示「已投稿，状态 pending」+ submissionId；不跳转

`/admin/submissions/` 页面：
- admin 通过 magic link 登录后访问
- 三个 tab：Pending (默认) / Approved / Rejected
- 列表项：投稿人邮箱、标题、提交时间（相对）、文件大小、`[详情]`
- 详情抽屉：
  - 描述、tags、原始文件名
  - 「下载预览 .cube」(signed URL, 1h)
  - 「Approve & Publish」/「Reject」+ reason 文本框 (≥10 字)

### 邮件模板

`admin-notify.html`（发给所有 admin）：

> Subject: New LUT submission: {{ title }}
> 
> From: {{ user_email }}
> Submitted: {{ submitted_at }}
> 
> {{ description }}
> 
> Tags: {{ tags }}
> 
> Review at: https://luts.site/admin/submissions/?id={{ submission_id }}

`contributor-reject.html`：

> Subject: 你的投稿未通过审核
> 
> 你于 {{ submitted_at }} 提交的 LUT「{{ title }}」未通过审核。
> 
> 原因：{{ reject_reason }}
> 
> 如有疑问请回复邮件。

### 与现有 markdown LUT 详情页的衔接

管理员审批通过后：
1. Edge Function 写 `luts` 表成功
2. admin 在 admin 列表中点「打开 luts.id」按钮 → 复制 UUID
3. admin 手动创建 `_luts/{slug}.md`，front matter 含：
   ```yaml
   lutId: <从 luts.id 复制的 UUID>
   title: ...
   beforeImg: /assets/images/luts/{slug}/before.jpg
   afterImg: ...
   ```
4. 提交 git push → CI build → 新 LUT 详情页出现在 `/lut/{slug}.html`
5. 用户在详情页点下载 → 现有 `request-lut-download` 流程通过 `lutId` 查 `luts` 表拿 storage_path → 签名 URL → 发邮件

**为什么不自动化 markdown 同步？**
- Jekyll 是构建时系统，没法监听 DB 变更
- 引入 build hook（`supabase functions deploy` 后跑 `make build` + `git commit`）会污染 git history
- 现状手动一步，反而给了 admin 补图、补描述的机会

### 复用现有代码

| 现有 | 复用方式 |
|---|---|
| `verifyTurnstile` (download function) | 直接复制到 submit-lut（Edge Function 跨文件 import 不可靠） |
| `sendEmail` / `buildEmail` (download function) | 复制 + 改造正文 |
| `isRateLimited` (download function) | 复制到 submit-lut，重定向到 `submissions` 表 |
| `RATE_LIMIT_EMAIL_PER_DAY` 常量 | 复制到 submit-lut（Edge Function 跨文件 import 同样不可靠） |
| `corsHeaders` / `preflight` / `jsonResponse` | 复制到两个新 function |
| 现有 `lut.html` layout | 0 改动（markdown 驱动） |
| 现有 `lut-download.js` | 0 改动 |
| `script/build-config.sh` 注入 | 0 改动（不变更前端需要的新全局） |

**为什么每个 Edge Function 都要复制一份？**
- Deno Deploy 单文件部署，跨 `_shared/` 相对路径有坑
- 用户在 amend「Edge Function 改为单文件」中已明确：每个 function 自包含
- 单 function 代码量小（~150 行），复制可接受

## 风险与应对

| 风险 | 应对 |
|---|---|
| 管理员手动同步 markdown 容易忘 → 新投稿在列表里看得到但前台看不到 | admin 列表「状态徽章」分两态：DB 状态 vs 「前台已展示」（Jekyll build 后才体现；UI 提示「下次部署后前台可见」） |
| 投稿人邮箱被冒用 | Turnstile + magic link + 邮箱限流三重；admin 拒绝时填原因、用户看到原因后知道是否要换号 |
| 文件被冒充 .cube | Edge Function 读文件头几个字节校验 magic number；.cube 是文本格式，可读前 50 字符验证是 LUT 格式 |
| 审批后 luts 表和 storage 数据不一致 | publish 流程包在 transaction... Deno + Supabase 暂不支持跨表事务；用补偿：storage 失败 → 回滚 luts 表；luts 表失败 → 删除 storage 副本 |
| 投稿人邮箱改名 / 账号被删 | `submissions.user_email` 是投稿时快照，保留可追溯性 |
| 未登录用户直接访问 `/admin/submissions/` | 前端读 supabase.auth 后判断 role，无 role 跳 404；Edge Function 二次校验 |
| RLS 配错导致 anon 越权 | dev 阶段先用 service_role 跑通、最后开 RLS、做端到端测试（anon 读 submissions 应 403） |
| admin 邮箱没及时维护，新投稿无人收邮件 | 启动时必须至少有一个 admin 在 users 表（提供 SQL 脚本）；admin UI 里显示「当前 admin 列表」帮助记忆 |
| slug 碰撞时连加 -2/-3 都不够 | 限制 -99；超 99 改用 UUID 后缀；管理员投稿可用 direct_publish=true 强制 slug |

## 验收映射

每条 `proposal.md` 的验收标准对应到本 design 的具体实现位置（`submit-lut` / `moderate-submission` / 某个页面 / 某条 SQL）。在 `plan.md` 里逐条变成 checkbox。
