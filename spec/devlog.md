# 开发日志

> 按时间倒序记录，每次 archive 追加一节。

## 2026-06-11 — LUT 投稿与审核（lut-contribution）

### 摘要
任何访客可在 `/contribute/` 匿名投稿 .cube LUT（邮箱 + Turnstile + 文件 + 标签），Admin 通过 magic link 登录后在 `/admin/submissions/` 审批。通过后自动发布到 `public.luts` 表 + 公开桶。

### 变更
- `supabase/migrations/20260612000000_lut_contribution_anonymous.sql` — submissions 表 user_id 改 nullable，RLS 收紧为 admin 可见
- `supabase/functions/submit-lut/index.ts` — 匿名 multipart 上传 + Turnstile + 邮箱限流（5/24h）+ admin direct_publish 路径
- `supabase/functions/moderate-submission/index.ts` — admin approve/reject 转发到 publishApprovedLut
- `contribute/index.html` — 投稿页（drag-drop 文件、深色 dropzone 主题、disabled 按钮状态）
- `assets/js/contribute.js` — Turnstile 重试逻辑、apikey/Authorization 头、拖拽绑定
- `admin/submissions.html` + `assets/js/admin-submissions.js` — 三 tab 审批队列 + 详情抽屉
- `supabase/sql/bootstrap-admin.sql` — admin 一次性提升脚本
- `script/build-config.sh` / `.env.example` / `README.md` — Edge Function 名从 .env 改硬编码

### 关键决策
- 投稿流程改为**匿名**——可访问性 + 减少注册摩擦，仅 admin 登录审批
- 三个 Edge Function 名（`request-lut-download` / `submit-lut` / `moderate-submission`）写为 JS 顶部常量而非 .env，避免「缺一项就静默失败」模式
- Admin approve 路径共享 `publishApprovedLut()` 函数，单文件 _shared/ 不引入

### 验证
- 170/170 plan items 通过
- `/contribute/` 端到端：上传 → Turnstile → submit → 200
- `/admin/submissions/` 端到端：登录 → pending tab → 详情 → approve → 复制 lutId
- 端到端手测链路：投稿 → 拒/批 → 拒邮件/上线发布

### 链接
- PR: https://github.com/zanelab/luts.site/pull/6
- Commits: 746b56e..7538a8f

## 2026-06-11 — LUT 详情页下载流程（lut-detail-download）

### 摘要
详情页"下载 LUT"按钮打开模态，提交邮箱 + Turnstile token 后通过 Supabase Edge Function `request-lut-download` 派发 30 分钟有效下载链接。桌面端侧栏 sticky，移动端自然流。

### 变更
- `_layouts/lut.html` — 重构详情页布局，新增 sticky 侧栏、下载 modal、Turnstile 容器
- `assets/js/lut-download.js` — 模态交互、Supabase 调用、错误码映射、TBD- 拦截
- `script/build-config.sh` + `.env.example` + `assets/js/supabase-config.js` — build-time 注入 4 个 `window.LUTSITE_*` 全局（后续又压成 3 个）
- `supabase/functions/request-lut-download/` — Edge Function（不在本仓库内）
- `README.md` — 新增"快速开始" / "配置 .env" / "无 .env 时的降级" / "接口约定" 章节

### 关键决策
- 注入机制：build 脚本把 `.env` 转 `supabase-config.js`，已 gitignore；缺失时写 `'TODO'` 让前端能识别
- `lutId: TBD-` 前端拦截，避免误发请求
- 侧栏 sticky 仅 ≥992px 生效

### 验证
- 39/39 plan items 通过
- 桌面端 sticky / 移动端自然流 / 模态 open-close / Turnstile 渲染 / TBD- 拦截 / CI 通过 / 详情页 console 干净

### 链接
- PR: https://github.com/zanelab/luts.site/pull/5
- Commits: 746b56e 起 + f903178 merge

## 2026-06-10 — 博客列表与详情（blog-list-detail）

### 摘要
新增博客模块，复用 LUTs 已验证的横向卡片 + 加载更多 + isotope 模式。引入按 `?tag=` 客户端筛选机制，并同步应用到 `/lut-list/`，统一两个列表的标签体验。

### 变更
- `_config.yml` — 新增 posts 的 `defaults`（`layout: post`，`permalink: /blog/:slug.html`）
- `_data/navigation.yml` — 加 "博客" 入口
- `_layouts/post.html` — 博客详情布局（封面/标题/日期/标签/正文/prev/next/侧栏）
- `blog/index.html` — 列表页 + 加载更多 + 标签筛选
- `lut-list/index.html` — 增加 `data-tags` 与同款标签筛选
- `_layouts/lut.html` — 标签改为链接
- `assets/images/blog/default-cover.svg` — 1.2KB 默认封面
- `_posts/2026-06-10-welcome-to-the-blog.md` — 欢迎（带 cover，标签：公告、介绍）
- `_posts/2026-06-08-lut-tutorial-basics.md` — LUT 基础（带 cover，标签：教程、基础）
- `_posts/2026-06-05-color-grading-tips.md` — 婚礼调色技巧（带 cover，标签：技巧、婚礼、调色）
- `_posts/2026-06-01-release-notes-v1.md` — v1 发布说明（无 cover，标签：发布、更新）
- `_posts/2026-05-28-team-update.md` — 团队动态（无 cover，标签：团队）

### 关键决策
- 文章 URL 使用 `.html` 后缀（用户后续要求）
- 标签筛选走客户端 JS（静态站无服务端能力）
- LUTs 与博客列表共用同一筛选模式

### 验证
- `jekyll build` 退出 0，无 Liquid 警告
- `/blog/` 渲染 4 篇 + 加载更多
- `/blog/:slug.html` 详情页 prev/next 正确
- 标签链接跳转 `?tag=...` 工作正常，banner / empty state 正常
- `/lut-list/` 与 `/luts/...` 回归无影响

### 链接
- PR: https://github.com/zanelab/luts.site/pull/4
- Commit: 1d626a0
