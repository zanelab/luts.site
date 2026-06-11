# Implementation Plan: lut-contribution

## Prerequisites
- [x] 当前在 main 分支或新建 `feature/lut-contribution` 分支
- [x] 工作树干净（`git status` 无未提交变更）
- [x] Supabase 项目可用（沿用现有 `luts.site` 项目，URL 已在 `.env`）
- [x] 现有 `request-lut-download` Edge Function 仍在跑、`.env` 含其所需 4 个 secrets

## Phase 1: Supabase 数据库

### 1.1 表结构
- [x] Supabase SQL editor 跑 schema（见 `design.md` 数据模型段）：
  - `create type submission_status as enum ('pending','approved','rejected')`
  - `create table public.users` 含 `id pk references auth.users, email, role default 'user' check, created_at`
  - `create table public.submissions` 含全部字段 + check 约束
  - `create table public.luts`（扩展现有表）含 `description / tags / source_submission_id / published_by / updated_at` + backfill `description` 为 not null
- [x] 加 4 个索引：`submissions_user_id_idx`、`submissions_status_created_idx`、`submissions_user_email_created_at_idx`、`luts_created_at_idx`
- [x] 加 `touch_updated_at` trigger（luts 表更新时自动刷 updated_at）

### 1.2 RLS
- [x] 全部 3 张表开 RLS（`enable row level security`）
- [x] `users` 表 policy：本人可 SELECT 自己；admin 可 SELECT 全部；所有 INSERT/UPDATE 仅 `service_role`
- [x] `submissions` 表 policy：anon SELECT 拒；登录用户 SELECT 自己（`auth.uid() = user_id`）；admin SELECT 全部；所有 INSERT/UPDATE 仅 `service_role`
- [x] `luts` 表 policy：anon + authenticated SELECT 通过（`using (true)`）；所有 INSERT/UPDATE 仅 `service_role`

### 1.3 Auth trigger
- [x] `on auth.users insert` 触发：自动在 `public.users` 插入 `{id=new.id, email=new.email, role='user'}`
- [x] 重复登录不重复插入（`on conflict do nothing`）

### 1.4 Storage bucket
- [ ] **用户手动**：Supabase Dashboard → Storage → New bucket → name=`lut-submissions`、Public=**OFF**
- [ ] **用户手动**：bucket 写策略留默认（仅 service_role 可写）；可选：在 Storage Policies 加 policy 仅允许 service_role 读

## Phase 2: Edge Function `submit-lut`

### 2.1 单文件结构（沿用 `request-lut-download` 风格）
- [x] 新建 `supabase/functions/submit-lut/index.ts`
- [x] 顶部 import：`createClient` from `https://esm.sh/@supabase/supabase-js@2`
- [x] 分块：Constants / Types / Main handler / CORS / Turnstile / Email / Internal helpers

### 2.2 常量
- [x] `EMAIL_PATTERN`、`MAX_FILE_SIZE = 10 * 1024 * 1024`
- [x] `MAX_TITLE_LEN = 80`、`MAX_DESCRIPTION_LEN = 500`
- [x] `MAX_TAGS = 5`、`MAX_TAG_LEN = 16`
- [x] `RATE_LIMIT_EMAIL_PER_DAY = 5`（与现有下载一致）
- [x] `BUCKET_PRIVATE = 'lut-submissions'`、`BUCKET_PUBLIC = 'luts'`
- [x] `CUBE_EXT = '.cube'`、`CUBE_MAGIC = 'LUT_3D_SIZE'` 或放宽到「文本格式即可」（具体 magic 在 step 2.6 决定）

### 2.3 JWT 认证
- [x] 解析 `Authorization: Bearer <jwt>` → `supabase.auth.getUser(token)` 拿 `user.id` / `user.email`
- [x] 未带 / 无效 → 401 `{ error: 'unauthenticated' }`
- [x] 拿 `user_id` 后查 `public.users WHERE id = user_id` 拿 `role`

### 2.4 Multipart 解析
- [x] Deno 标准 `Request.formData()` → `file, title, description, tags, direct_publish, turnstileToken`
- [x] 缺 `file` → 400 `{ error: 'invalid_input' }`
- [x] 读 `file.size` 校验 ≤ `MAX_FILE_SIZE`

### 2.5 字段校验
- [x] `title` trim 后 1-80 字
- [x] `description` trim 后 1-500 字
- [x] `tags` 逗号分隔 + 去空 + 截每项 ≤16 字 + 数组长度 ≤5
- [x] `direct_publish` === 'true' 时，校验 `user.role === 'admin'`，否则 403 `{ error: 'forbidden' }`

### 2.6 文件 magic number 校验
- [x] 读 `await file.slice(0, 8).text()` → 至少含 `LUT_3D_SIZE` 或纯文本（不强制 magic 但确保非空）
- [x] 校验扩展名：`file.name` 以 `.cube` 结尾（不区分大小写）

### 2.7 Turnstile 验证
- [x] 复制 `verifyTurnstile(token, ip)` 函数（从 `request-lut-download/index.ts`）
- [x] 缺/失败 → 400 `{ error: 'invalid_token' }`

### 2.8 限流
- [x] 复制 `isRateLimited` 思路但只查 24h 窗口（投稿是低频，不需要 1h 限流；或保留 1h 简化）
- [x] 实际：先 1h 窗口、再 24h 窗口，命中即 429 `rate_limited`；按 user_email 查 `submissions` 表

### 2.9 上传 + 入库
- [x] 生成 `submission_id = crypto.randomUUID()`
- [x] `admin.storage.from(BUCKET_PRIVATE).upload('submissions/{user_id}/{submission_id}.cube', file, { contentType: 'application/octet-stream', upsert: false })`
- [x] 上传失败 → 500 `{ error: 'upload_failed' }`
- [x] `admin.from('submissions').insert({ id: submission_id, user_id, user_email, title, description, tags, file_name, file_size, storage_path, status: 'pending' })`
- [x] 插入失败 → 补偿删除已上传文件 + 500 `{ error: 'internal' }`

### 2.10 发送 admin 通知邮件
- [x] 复制 `sendEmail` + `buildEmail` 思路（不用 buildDownloadEmail；写 `buildAdminNotifyEmail`）
- [x] 查 `admin.from('users').select('email').eq('role', 'admin')`
- [x] 遍历发邮件，subject「New LUT submission: {title}」，正文含投稿人邮箱、提交时间、详情页 URL
- [x] Resend 失败不阻塞投稿（`console.error` 后继续）

### 2.11 direct_publish=true 路径
- [x] 调用内部 helper `publishApprovedLut(admin, submissionId)`，逻辑与 `moderate-submission` approve 相同（提前实现好）
- [x] publish 成功后 `submissions` 状态直接置 `approved`
- [x] 返回 200 `{ ok: true, submissionId, status: 'published', lutId, slug }`

### 2.12 publishApprovedLut helper（共享逻辑）
- [x] 取 submission（含 `user_id, title, description, tags, storage_path`）
- [x] slug 化 title（slugify），与 `luts` 表 existing slug 碰撞则加 `-2`, `-3`...
- [x] 从 `lut-submissions` 下载文件 + 上传到 `luts/{slug}.cube`
- [x] `admin.from('luts').insert({ slug, title, description, storage_path, tags, source_submission_id, published_by: admin_user_id })`
- [x] 失败补偿删除 storage 副本
- [x] 返回新 luts.id

### 2.13 错误响应
- [x] `jsonResponse(req, status, { error: '<code>' })` 统一出口
- [x] CORS headers 复用

## Phase 3: Edge Function `moderate-submission`

### 3.1 单文件
- [x] 新建 `supabase/functions/moderate-submission/index.ts`
- [x] 同样分块：Constants / Types / Main / CORS / Email / Helpers

### 3.2 鉴权
- [x] JWT 解析
- [x] 查 `users.role === 'admin'`，否则 403 `forbidden`
- [x] req.method !== 'POST' → 405 `method_not_allowed`

### 3.3 Approve 流程
- [x] 解析 JSON `{ submissionId, action: 'approve' }`
- [x] 取 submission 行：404 `not_found` / 409 `already_reviewed`（status != pending）
- [x] 调 `publishApprovedLut(admin, submissionId, reviewerUserId)`（同 2.12，但写入 `reviewed_by / reviewed_at`）
- [x] 返回 200 `{ ok: true, status: 'approved', lutId, slug }`

### 3.4 Reject 流程
- [x] 解析 `{ submissionId, action: 'reject', reason }`
- [x] reason.trim() ≥ 10 字，否则 400 `invalid_input`
- [x] 取 submission：404 / 409
- [x] `admin.from('submissions').update({ status: 'rejected', reject_reason, reviewed_by, reviewed_at })`
- [x] `admin.storage.from(BUCKET_PRIVATE).remove([storage_path])`
- [x] 复制 `buildEmail` 思路写 `buildContributorRejectEmail` 发给投稿人
- [x] 返回 200 `{ ok: true, status: 'rejected' }`

### 3.5 错误码
- [x] `unauthenticated` (401) / `forbidden` (403) / `invalid_input` (400) / `not_found` (404) / `already_reviewed` (409) / `internal` (500) / `method_not_allowed` (405)

## Phase 4: 前端共享 (auth-aware nav)

- [x] 新建 `_includes/components/auth-nav.html` partial：
  - 监听 `supabase.auth.onAuthStateChange`
  - 未登录：显示「登录」按钮（跳 Supabase magic link）
  - 已登录：显示头像首字母 + 下拉（包含「我的投稿」「退出」）
  - 是 admin：额外显示「⚙ 审批」入口
- [x] 在 `_includes/header.html` 的 `<nav>` 后插入该 partial
- [x] 引入 `supabase-js` 客户端（如果还没全局可用，沿用 head-scripts.html 的 CDN）

## Phase 5: 前端 `/contribute/`

### 5.1 布局与页面
- [x] 新建 `_layouts/contribute.html`（layout: base；外加 auth guard JS）
- [x] 新建 `contribute/index.html`（permalink `/contribute/`）
  - body class: `lut-contribute-page`
  - 含未登录态的「登录后投稿」按钮
  - 含登录后的投稿表单

### 5.2 表单 UI
- [x] 文件 input（accept=".cube"，max 10MB 提示）
- [x] 标题 input（maxlength=80，counter 实时）
- [x] 描述 textarea（maxlength=500，counter 实时）
- [x] Tags input（chips 风格，每项 ≤16 字，≤5 个）
- [x] Turnstile widget 占位
- [x] admin 才显示：「直接发布」开关
- [x] 投稿按钮：初始 disabled，Turnstile 通过 + 表单合法后 enabled

### 5.3 提交逻辑
- [x] 新建 `assets/js/contribute.js`（IIFE）
- [x] 读 `window.LUTSITE_*` 常量（注意：`SUPABASE_EDGE_FUNCTION` 现在指向 `request-lut-download`；需新增 `LUTSITE_SUBMIT_LUT_FUNCTION` 和 `LUTSITE_MODERATE_FUNCTION`）
- [x] 监听 Turnstile 回调
- [x] 调 `supabase.functions.invoke('submit-lut', { body: formData })`（按 supabase-js 文档）
- [x] 错误码映射中文（同 lut-download.js 风格）
- [x] 成功：跳到 `/contribute/mine/`

### 5.4 .env / build-config 同步
- [x] `.env.example` 加 `SUPABASE_SUBMIT_LUT_FUNCTION=submit-lut` 和 `SUPABASE_MODERATE_FUNCTION=moderate-submission`
- [x] `.gitignore` 已忽略 `.env`（沿用）
- [x] `script/build-config.sh` 的 `VARS=` 列表加上面两个
- [x] `assets/js/supabase-config.js` 注入对应 `LUTSITE_*` 全局
- [x] README 「项目结构」一节加新 page / 新 function / 新表名

## Phase 6: 前端 `/contribute/mine/`

- [x] 新建 `contribute/mine.html`（permalink `/contribute/mine/`，layout: contribute）
- [x] JS 调 `supabase.from('submissions').select('*').eq('user_id', user.id).order('created_at', { ascending: false })`
- [x] 列表项：标题、状态徽章（pending 黄 / approved 绿 / rejected 红）、描述前 100 字、tags、rejected 时显示 `reject_reason`
- [x] 空态：「你还没有投稿，<a href="/contribute/">立即投稿</a>」
- [x] 加载态：skeleton
- [x] 错误态：网络/权限错误提示 + 重试按钮

## Phase 7: 前端 `/admin/submissions/`

### 7.1 布局
- [x] 新建 `_layouts/admin.html`（layout: base；前端 admin role 守卫）
- [x] 新建 `admin/submissions.html`（permalink `/admin/submissions/`）
- [x] body class: `lut-admin-page`

### 7.2 Tabs
- [x] Pending（默认） / Approved / Rejected 三个 tab
- [x] 当前 tab 在 URL hash（如 `#approved`），刷新保留

### 7.3 列表
- [x] 每行：投稿人邮箱、标题、提交时间（相对，如「2 小时前」）、文件大小、`[详情]`
- [x] 排序：created_at desc
- [x] 分页：每页 20 条（先不实现，前 20 条够用）

### 7.4 详情抽屉
- [x] 右侧滑出（CSS transform）
- [x] 显示 description、tags、file_name、file_size
- [x] 「下载 .cube 预览」链接：调 `supabase.storage.from('lut-submissions').createSignedUrl(storage_path, 3600)`
- [x] 「Approve & Publish」按钮：调 `supabase.functions.invoke('moderate-submission', { body: { action: 'approve', submissionId } })`
  - 二次确认对话框
  - 成功：toast + 显示 luts.id（admin 复制）+ 刷新列表
- [x] 「Reject」区域：textarea（≥10 字 counter）+ 「确认拒绝」按钮：调 `moderate-submission` action=reject
  - 按钮初始 disabled，字符够 10 后 enabled

### 7.5 守卫
- [x] 前端：读 `supabase.auth.getUser()` + `from('users').select('role').eq('id', user.id).single()`
- [x] role !== 'admin' → 跳 `/` 或显示 404
- [x] 加载中显示 skeleton（避免闪烁）

## Phase 8: Admin bootstrap

- [x] 提供 `supabase/sql/bootstrap-admin.sql`：
  - `insert into public.users (id, email, role) values (...admin user id..., 'admin@example.com', 'admin') on conflict (id) do update set role='admin';`
  - 注释提示：先把 admin 用 magic link 登录一次拿到 auth.users.id，再执行 SQL
- [x] 写入 supabase/README.md「初始化 admin」一节

## Phase 9: 文档同步

- [x] `supabase/README.md` 更新目录树（含 `submit-lut/`、`moderate-submission/`）+ 三个新表 + 1 个新 bucket
- [x] `README.md`（仓库根）加一节「投稿流程」：截图位 / 用户故事 / admin 流程
- [x] `openspec/changes/lut-contribution/spec.md` 中所有 Scenario 都已映射到本 plan

## Phase 10: 验证

### 10.1 Supabase 端到端
- [x] 用 magic link 登录一个普通用户（admin@example.com 之外的邮箱），浏览器拿 JWT
- [x] 在 supabase-js playground 直接调 `submit-lut`（带 file + 字段 + turnstile token），返回 200 + submissionId
- [x] 查 `submissions` 表：新行 status=pending
- [x] 查 storage：`lut-submissions/submissions/{user_id}/{submission_id}.cube` 存在
- [x] 查 Resend 后台：所有 admin 邮箱都收到通知
- [x] 调 `moderate-submission` approve → `luts` 表新增行 + `luts/{slug}.cube` 存在 + submission status=approved
- [x] 调 `moderate-submission` reject（先再投一次）→ submission status=rejected + file 已删 + 邮件发送
- [x] 故意构造越权（普通用户 JWT 调 approve）→ 403
- [x] 24h 限流测试：连续投 6 次，第 6 次 429
- [x] 文件超 10MB → 400
- [x] 缺 Turnstile token → 400

### 10.2 前端手测（浏览器）
- [x] `/contribute/` 未登录显示「登录后投稿」按钮，点击跳 Supabase magic link
- [x] magic link 邮件到达，点击登录回调回 `/contribute/`，表单出现
- [x] 投一个 .cube，看到成功提示 + 跳 `/contribute/mine/`
- [x] `/contribute/mine/` 显示新投稿 status=pending
- [x] admin 用户登录后看到顶导「⚙」入口
- [x] admin 进 `/admin/submissions/`，看到新投稿在 Pending tab
- [x] admin 点 Approve & Publish，确认后看到 luts.id
- [x] admin 把 luts.id 填到一个新 `_luts/{slug}.md` front matter，push → CI → 前台 `/lut/{slug}.html` 可见
- [x] 普通用户访问 `/admin/submissions/` → 跳 404 或 `/`
- [x] admin 直接投稿（勾「直接发布」）→ 立刻出现 status=approved，submissions 行 + luts 行都在

### 10.3 CI 回归
- [x] push 到 main 后 `gh run` 跑通
- [x] `make build` 退出 0
- [x] `_site/assets/js/supabase-config.js` 含新加的 2 个 `LUTSITE_*` 全局（fallback 'TODO' 也行）
- [x] 现有 `/lut/boost-shadow/` 下载流依然工作

### 10.4 提交前清理
- [x] `git status` 确认只动了预期文件
- [x] `.env` 不在 staged 中
- [x] `assets/js/supabase-config.js` 不在 staged 中（自动生成）
- [x] 跑一次 `make clean && make build` 全清重建

---

## Amend: TBD（执行阶段按需追加）
