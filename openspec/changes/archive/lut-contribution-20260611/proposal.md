# Proposal: lut-contribution

## What
让任何注册用户向 LUTs.site 提交 `.cube` LUT 文件，经过管理员审核后发布到前台列表；同时给管理员提供登录、查看待审投稿、批准 / 拒绝（带原因）、邮件通知的能力。

- **投稿人**：访问 `/contribute/` → Supabase Auth magic link 登录 → 填写标题 / 描述 / 标签 / 上传 `.cube` → 提交。提交后状态为 `pending`，可在 `/contribute/mine/` 看自己历史。
- **管理员**：`role='admin'` 的用户登录后看到 `/admin/submissions/`，列出全部 `pending` 投稿；点开看详情 → Approve（文件从 private bucket 转到 public `luts/` bucket，lut 表新增记录，前台公开）或 Reject（填原因，邮件通知投稿人）。
- **新投稿到来时**：邮件通知所有 admin（用现有的 Resend 通道）。

## Why
当前 LUT 库只有「管理员手工补」和「静态 markdown」两条路径，扩展慢、缺反馈环。开放投稿能把内容生产从单人维护变成众包，且审批环节把控质量；admin 不用每次手写 markdown / 调 Storage，只要点 Approve。

## Scope
- [x] backend（Supabase：Auth、Storage 私有 bucket、Edge Function、Postgres 表）
- [x] frontend（`_layouts/contribute.html`、`_layouts/admin-submissions.html`、`/contribute/`、`/contribute/mine/`、`/admin/submissions/` 三个新页面 + 登录/退出 UI）

## Acceptance Criteria
- [ ] 未登录用户访问 `/contribute/` 重定向到 Supabase Auth 登录页（magic link）
- [ ] 投稿表单字段：`.cube` 文件（必填，≤10MB）、标题（必填，≤80 字）、描述（必填，≤500 字）、标签（可选，每个 ≤16 字，≤5 个）
- [ ] 提交成功后：投稿记录入库（status=pending），文件落 private bucket 路径 `submissions/{user_id}/{submission_id}.cube`
- [ ] 投稿成功后 5 分钟内：所有 admin 邮箱收到通知邮件，主题「New LUT submission: <标题>」，正文含投稿人邮箱、标题、提交时间、详情页链接
- [ ] 投稿人邮箱 24h 内提交次数 ≤ 5（沿用下载限流 `RATE_LIMIT_EMAIL_PER_DAY` 同等语义），超限返回 `rate_limited`
- [ ] admin 登录后访问 `/admin/submissions/` 看到 status=pending 的投稿列表（按时间倒序，含投稿人邮箱、标题、提交时间、文件大小）
- [ ] admin 点「Approve & Publish」→ 文件复制到 public `luts/` bucket 路径 `luts/{slug}.cube`，`luts` 表新增一行（含 `slug` / `title` / `description` / `storage_path` / `tags` / `status=published`），submission 行更新为 `status=approved`、记录批准时间和 `lut_id`
- [ ] admin 点「Reject」→ 必须填拒绝原因（≥10 字），submission 更新为 `status=rejected` + `reject_reason` + 拒绝时间，给投稿人发邮件说明原因
- [ ] admin 列表默认只显示 `pending`；tab 切换可看 `approved` / `rejected` 历史
- [ ] 非 admin 用户访问 `/admin/submissions/` 返回 403（Edge Function 鉴权 + 前端兜底）
- [ ] 投稿人可在自己 `/contribute/mine/` 看到全部历史投稿及状态（pending / approved / rejected + 拒绝原因）
- [ ] CI 回归：现有 `lut-detail-download` 流程的下载/审批/限流代码 0 改动；新 Edge Function 单文件、不与 `_shared/` 混用
- [ ] `_luts/boost-shadow.md`、`_luts/sun-shine.md` 不受影响（仍是 admin 手工维护路径）

## Out of Scope（明确不做）
- ❌ 预览图上传（用户已确认本期不含）
- ❌ 投稿后 admin 在审批前编辑内容（Edit before approve）—— 一旦 Approve 就是「原样发布」
- ❌ 投稿人收到状态变更邮件（除非被拒绝；批准时静默，前台公开即可见）
- ❌ 投稿评论 / 多轮沟通
- ❌ 投稿人撤回已提交投稿
- ❌ admin 角色自助注册（admin 角色由现有 `users` 表手工维护 / SQL 写入）
- ❌ 公开投稿人排行榜 / 致谢页

## Status
- [x] 提案已确认（2026-06-11）

## 与现有系统的关系
- **复用**：`request-lut-download` Edge Function 的 Resend 发邮件链路 / CORS / `printenv → .env → 'TODO'` 配置管线
- **复用**：`RATE_LIMIT_EMAIL_PER_DAY = 5` 的语义（直接共用同一常量或复制到新函数）
- **不冲突**：`lut-detail-download` 流程不动；新内容由新 Edge Function `submit-lut` 和新 Edge Function `moderate-submission` 处理
- **存储**：在 Supabase Storage 现有 `luts` public bucket 之外新增 `lut-submissions` private bucket（审批通过后 server-side copy 到 `luts`）
- **数据库**：新增 3 张表 `users`（含 role）/ `submissions` / `luts`（或扩展现有 LUT 详情页用的 markdown 来源之外，再走 SQL 来源）
