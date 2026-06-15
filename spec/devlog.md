# 开发日志

> 按时间倒序记录，每次 archive 追加一节。

## 2026-06-15 — Admin 后台 LUT 付费字段编辑（admin-lut-paid-fields）

### 摘要
`/admin/luts/` 编辑抽屉扩 4 个付费字段（`paid` 开关 + `price` 元 + `afdian_sku_id` + `afdian_order_url`），admin 可在不动 SQL 的情况下把任意 LUT 标成付费，保存路径复用 `manage-lut`。同时给投稿页 admin 的「直接发布」checkbox 套了同款 iOS 开关（亮色主题）。

### 变更
- `admin/luts.html` — 编辑表单追加 4 个付费字段；iOS 开关、价格 `¥/元` 输入组、URL `↗ 预览` action；列表角标 `.paid-badge` 样式
- `assets/js/admin-luts.js` — 列表渲染读 `paid` / `price_cents` 出角标；`COLS_FULL` / `COLS_BASIC` 双重 select（PR #9 未部署时降级）；`updateValidationUi()` / `validatePaidFieldsDetailed()` live 校验；保存走 `manage-lut` + 以返回的 `lut` 行作 state 来源；列表行用 `patchRowInList()` 单行 patch 避免整列重渲
- `contribute/index.html` — admin 直接发布 checkbox 套 iOS 开关（亮色主题配色）
- 见 `openspec/changes/archive/admin-lut-paid-fields-20260615/`

### 关键决策
- **状态来源切到服务端**：`saveEdit` 之前用请求体 patch 本地 state，遇上部署的 `manage-lut` 是 PR #9 之前的旧版本时静默丢付费字段，UI 翻角标 + 显示「已保存」但 DB 没变；改成读 `r.data.lut` 后 UI 跟 DB 永远一致
- **降级列集**：如果 `manage-lut` 升级到 PR #9 但 `luts` 表迁移没 apply，`select(COLS_FULL)` 报 `42703`，catch 后回退到 `COLS_BASIC` 重查；列表全显示「免费」但不抛错
- **iOS 开关亮 vs 暗**：admin 深色用 `#ebb85e`，contribute 亮色用 `#c98a17`；关闭态都不饱和（亮色用暖灰白 `#e8e3d8`，深色用 `rgba(255,255,255,0.12)`），让 on/off 看起来是同色系淡 vs 浓而不是两个不同色

### 已知遗留
- PR #9 的 `manage-lut` Edge Function 是否已部署到生产 Supabase 未确认；用户在生产跑端到端前需 `supabase functions deploy manage-lut`
- `_luts/*.md` frontmatter `paid: true` 跟 DB `luts.paid` 仍是两套数据源；当前 spec 不做反向同步，运营改了 .md 还要再去后台改 DB

## 2026-06-15 — LUT 付费购买（lut-paid-afdian）

### 摘要
付费 LUT 通过爱发电（ifdian.net）完成支付与交付。`paid: true` 的 LUT 在详情页渲染价格徽章 + 购买 CTA，列表卡片显示「付费」角标；下载按钮在付费场景下被替换为跳爱发电商品页的购买按钮。爱发电 webhook 推单后做验签 + Open API 二次校验，通过 `send-msg` DM 把 30 分钟 signed URL 发给买家。Admin 侧提供 DM 补发队列。

### 变更
- `supabase/migrations/20260615000000_paid_lut_orders.sql` — 新表 `paid_lut_orders`（`order_no` 唯一约束做幂等，`state` 状态机，`dm_sent_at` / `dm_error` 跟踪兑号），`luts` 表加 4 个付费字段
- `supabase/functions/afdian-webhook/index.ts` — 单文件 Edge Function，部署带 `--no-verify-jwt`：RSA-SHA256 验签（公钥 hardcoded）→ Open API 二次校验 → 按 `afdian_sku_id` 查 LUT → 30 分钟 signed URL → `send-msg` DM 兑号 → upsert 订单
- `supabase/functions/resend-paid-download/index.ts` — Admin 补发，Bearer JWT 校验 + 5/24h 每买家限流
- `supabase/functions/manage-lut/index.ts` — 扩展付费字段 upsert
- `_layouts/lut.html` — `{% if page.paid %}` 条件块：`#lut-purchase-cta` 价格徽章 + 购买按钮 + 提示文案；`.lut-purchase-trigger` 与 `.lut-download-trigger` 共用同一下载流程脚本
- `lut-list/index.html` — 卡片右上角「付费」角标（纯文字，pointer-events: none，不影响卡片交互）
- `admin/orders.html` + `assets/js/admin-orders.js` — DM 补发队列（`state='paid' AND dm_sent_at IS NULL`），与 `/admin/submissions/` 共用 admin 鉴权模式
- `_includes/components/auth-nav.html` — admin 顶导加「订单管理」入口
- `script/validate-luts.sh` — build-time 校验：`paid: true` 的 LUT 必须填齐 `price` / `afdianSkuId` / `afdianOrderUrl`
- `Makefile` — `build` / `serve` 目标接入 `validate-luts`
- `.env.example` — 新增爱发电 secrets 章节（`AFDIAN_USER_ID` / `AFDIAN_TOKEN` 走 `supabase secrets`，公钥 hardcoded）
- `_luts/paid-smoke-test.md` — 冒烟 LUT，build pipeline 端到端验证
- `openspec/changes/archive/lut-paid-afdian-20260615/` — proposal / design / spec / plan / close-issues

### 关键决策
- **兑号走 DM 不走 email**：爱发电 webhook payload 没有 email 字段，最自然的兑号通道就是 DM（买家本就在爱发电账号上）
- **二次校验**：`query-order` Open API 在验签通过后再调一次（防 webhook 私钥泄漏 + 退款 race）
- **MD5 纯 JS**：Deno Web Crypto 不支持 MD5（W3C 标准只允许 SHA 家族），`afdianSign` 改用 RFC 1321 纯 JS 实现，所有 7 个 RFC 1321 标定向量验证通过
- **sign 位置兼容**：爱发电测试工具走 body，生产可能走 header，函数同时读 `payload.sign ?? req.headers.get("sign")`
- **补发机制**：webhook 永远 200 返回（Afdian 协议），DM 失败只把 `dm_error` 写库，admin 通过 `/admin/orders/` 手动补发，避免无限重试浪费 API 配额
- **限流策略**：补发按 `buyer_user_id` 5 次 / 24h（写在 `lut_download_requests.status='paid_resent'`），跟 free 下载的 5/24h 限流对齐
- **付费 LUT `lutId` 仍必填**：详情页用 `lutId` 关联 Supabase 行，付费 LUT 跟 free LUT 走同一张 `luts` 表，仅靠 `paid` 字段区分

### 验证
- 18/18 plan items 通过
- 端到端 build：`make build` 通过，paid LUT 详情页渲染 `#lut-purchase-cta` + `¥1` 价格徽章 + 购买按钮；free LUT 行为不变
- 列表卡片：搜索 `lut-card-paid-badge` 出现 2 次（首屏 + 加载更多模板）
- 爱发电测试 webhook 工具验证到 MD5 二次校验（Open API 调用前卡住——见下方 hotfix）
- 部署时 `--no-verify-jwt` 必须带（webhook 走 service-to-service 不带 JWT）

### 验证阶段 hotfix
部署到 Supabase 后暴露 2 个 bug：
1. `sign` 读 header 一直 400 — 爱发电测试工具把 sign 放 body。改成 `payload.sign ?? headers.get("sign")`
2. `crypto.subtle.digest("MD5", ...)` 抛 `NotSupportedError` — Deno Web Crypto 不支持 MD5。换纯 JS 实现

### 链接
- Branch: `feature/lut-paid-afdian-20260615`
- Commits: `3baf7bc`（主体）→ `0e8ef06`（hotfix：sign + MD5 + auth-nav + SKU）

## 2026-06-11 — Admin 顶导登录入口（admin-nav-entry）

### 摘要
顶导加「🔒 管理」文字链接，所有页面始终可见，公开页零额外 JS 开销。点击跳 `/admin/submissions/`，admin 布局检测无 session → 自动弹模态。contribute / lut 布局不弹。

### 变更
- `_includes/header.html` — 顶导 `.fr` 容器内插入 `<a class="auth-nav-entry" href="/admin/submissions/">🔒 管理</a>`；侧边栏 `.side-header .bottom` 容器内插入 `<a class="auth-nav-entry auth-nav-entry--side" href="/admin/submissions/">🔒 管理</a>`（桌面可见）
- `_layouts/base.html` — `<body>` 在 `page.layout == 'admin'` 时输出 `data-auth-auto-open="true"`
- `assets/js/auth-nav.js` — 新增 `autoOpenIfEligible()`，`refresh()` 在无 session 路径调
- `_includes/components/auth-nav.html` — `.auth-nav-entry` CSS（discreet 风格、hover 下划线、focus-visible 描边）+ `.auth-nav-entry--side`（侧边栏内变体，居中、字号略小）
- `spec/requirements.md` / `spec/tasks.md` / `spec/devlog.md` — 同步

### 关键决策
- **入口双放置**：原计划只放顶导，但项目用 `header_left_side` 侧边栏布局（`style.css:2534` 把 `.site-header.with-side` 桌面下 `display: none`），桌面下顶导整块不可见。改成顶导 + 侧边栏各放一份，由 CSS 互斥可见（手机看顶导、桌面看侧边栏），无需 JS 切换
- **布局信号机制**：原计划在 `admin.html` front matter 加 `body_data` 字段，base.html 渲染。但 Jekyll 嵌套 layout 的 front matter 不向父 layout 传播，base.html 模板里 `admin.html` 的字段不可见。改用 `{% if page.layout == 'admin' %}` 判定更直接，避免传染到其他 layout。spec / plan 同步更新
- **公开页零开销**：`.auth-nav-entry` 是纯静态链接，不依赖 supabase 加载状态，公开页（`base.html`）继续不加载 supabase-config / supabase-js CDN

### 验证
- 28/28 实现类 checkbox + 6/8 验证 checkbox（5 公开页含链接、admin/submissions 含 data attr、contribute/luts 不含、build pass、回归、git status）
- 10 项浏览器手测留给 staging
- 桌面下「🔒 管理」实际显示位置是侧边栏（左侧），非顶导右侧 —— 已在 commit a508832 修复

### 链接
- PR: https://github.com/zanelab/luts.site/pull/8
- Commits: ed5c29d（初版）+ a508832（侧边栏变体）

## 2026-06-11 — Admin OTP 登录（admin-otp-login）

### 摘要
把顶导的 magic link 登录换成两步 OTP（邮箱 → 6 位数字 → `verifyOtp`）。同一台设备完成登录，无需切到邮箱点链接；首次登录即注册（`shouldCreateUser: true`）。

### 变更
- `assets/js/auth-nav.js`（新建）— ~370 行状态机，auto-advance / Backspace / 黏贴 6 位拆分 / 60s 倒计时 / 错误码 → 中文映射
- `_includes/components/auth-nav.html` — 改为 markup only，去掉原 inline IIFE；两段 `.auth-nav-step`
- `openspec/changes/admin-otp-login/{proposal,spec,plan}.md` — 提案 + 10 个 Scenario + 46 项 plan
- `spec/requirements.md` / `spec/tasks.md` / `spec/devlog.md` — 同步更新

### 关键决策
- `detectSessionInUrl: false`（URL hash 不再带 session）
- 6 个独立小框（`inputmode="numeric"`），mobile 友好且支持黏贴
- Edge Function JWT 不变（OTP / magic link 产物一致）
- 错误码一对一映射：`otp_expired` / `token_invalid` / `email_rate_limit_exceeded` / `over_email_send_rate_limit` / `network`
- `base.html` 布局的公开页（`/`、`/lut-list/`、`/blog/`）不加载 supabase-config，登录按钮自动隐藏

### 验证
- 38/46 plan items ticked（35 实现类 + 3 build 验证），10 项浏览器手测留给 staging
- `node --check` 通过、`make build` 退出 0
- `_site/index.html` 等页面包含完整 markup

### 链接
- PR: https://github.com/zanelab/luts.site/pull/7
- Commit: 3d2deb7

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
