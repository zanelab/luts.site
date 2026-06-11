# Close: lut-contribution

## Pull Request
- PR #6 — Add LUT contribution: anonymous submit + admin moderation
  https://github.com/zanelab/luts.site/pull/6

## 关闭内容
- `/contribute/` 匿名投稿页（邮箱 + .cube + 标题 + 描述 + ≤5 标签）
- `/admin/submissions/` 审批队列（pending / approved / rejected 三 tab）
- Supabase Edge Functions:
  - `submit-lut`（匿名投稿 + admin `direct_publish` 旁路）
  - `moderate-submission`（admin approve / reject + 发布到 `public.luts`）
- Cloudflare Turnstile 集成（前端轮询 + 后端 `siteverify`）
- 邮箱维度的滚动 24h 限流（5 次 / 邮箱）
- 拒信邮件（Resend）+ 批准后 `public.luts` 写入 + 公开桶复制
- 拖拽式文件上传组件（dropzone + dark theme）
- 投稿页 Turnstile widget 加载重试（修复 async defer 时序问题）
- 投稿请求补 `apikey` / `Authorization` header（修复 Supabase 网关 401）

## 关联变更
- 在 `lut-detail-download` 的 `.env` 注入机制上叠加（不重复）
- 三个 Edge Function 名（`request-lut-download` / `submit-lut` / `moderate-submission`）后改硬编码为 JS 顶部常量，避免「.env 漏一项就静默失败」

## 关键决策
- **投稿改为匿名**（Amend 1）：原方案需登录后投稿，用户反馈「应该是匿名投稿，只是审批需要管理员登录」；改成 form email 必填、Edge Function 接受匿名 + 可选 admin JWT
- **`/contribute/mine/` 整页移除**（Amend 1）：admin 不需要看到自己的历史，原 lut-mine 整页删除
- **Edge Function 名改硬编码**（Amend 2）：`.env` 里跑 4 个 / 3 个 function 名字是 over-engineering，名称跟源码绑定不会变

## 配置依赖
- Supabase 项目内：
  - `users` / `submissions` 表 + RLS
  - 私有桶 `lut-submissions`（Public OFF）
  - Edge Functions: `submit-lut`, `moderate-submission`, `request-lut-download` 已部署
  - Secrets: `TURNSTILE_SECRET_KEY` / `RESEND_API_KEY` / `EMAIL_FROM` / `SITE_ORIGIN`
- 一次性 admin 提升：`supabase/sql/bootstrap-admin.sql`
- 前端：`.env` 含 `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `TURNSTILE_SITE_KEY`（3 项，不含 function 名）
