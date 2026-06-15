# 需求（累积式）

> 每完成一个模块在 archive 阶段追加一节。

## 1. LUTs 列表与详情（luts-list-detail）
- 用户可在 `/lut-list/` 浏览所有 LUT 资源，每张卡片支持前后对比拖拽预览
- 详情页 `/luts/:slug/` 提供完整 before/after 对比图
- 列表支持"加载更多"分页
- 见 `openspec/changes/archive/luts-list-detail-20260611/`

## 2. 首页全配置化（configurable-menu）
- 首页 hero、section 等内容由 `_data/homepage.yml` 驱动
- 菜单项由 `_data/navigation.yml` 配置
- 见 `openspec/changes/configurable-menu/`

## 3. 博客列表与详情（blog-list-detail）
- 文章以 Markdown 存放在 `_posts/`，URL 形如 `/blog/:slug.html`
- 列表页 `/blog/` 横向卡片 + 加载更多
- 详情页含封面、标题、日期、标签、正文、prev/next
- 标签可点击，跳转 `?tag=...` 在列表页筛选
- 标签筛选机制同样适用于 `/lut-list/`
- 见 `openspec/changes/archive/blog-list-detail-20260610/`

## 4. LUT 详情页下载流程（lut-detail-download）
- 详情页"下载 LUT"按钮打开模态，提交邮箱 + Turnstile token
- 通过 Supabase Edge Function `request-lut-download` 派发限时下载链接
- `lutId: TBD-` 占位时前端拦截，避免误发请求
- 桌面端 sticky 侧栏，移动端自然流
- 见 `openspec/changes/archive/lut-detail-download-20260611/`

## 5. LUT 投稿与审核（lut-contribution）
- 任何访客（**无需登录**）可在 `/contribute/` 提交邮箱 + .cube（≤10MB）+ 标题 + 描述 + ≤5 标签
- 表单提交通过 Cloudflare Turnstile 验证，按邮箱 5 次 / 24 小时限流
- 投稿后文件存私有桶 `lut-submissions`、submissions 表 status=pending
- Admin 登录后在 `/admin/submissions/` 审批：下载预览 .cube（signed URL, 1h） / 批准 / 拒绝（≥10 字理由）
- 批准后写入 `public.luts` 表、复制 .cube 到公开桶，admin 把 luts.id 复制到 `_luts/{slug}.md` 的 `lutId:`
- Edge Functions：`submit-lut`（匿名投稿 + admin 直接发布） / `moderate-submission`（admin 审批）
- 见 `openspec/changes/archive/lut-contribution-20260611/`

## 6. Admin OTP 登录（admin-otp-login）
- 顶导登录模态改为两步 OTP：邮箱 → 6 个独立数字输入框 → `verifyOtp`
- 首次登录即注册（`shouldCreateUser: true`），无独立注册流程
- 60 秒重发倒计时；6 个 input 自动跳格 / Backspace 回跳 / 黏贴拆分
- 错误码 → 中文映射：`otp_expired` / `token_invalid` / `email_rate_limit_exceeded` / 网络异常
- `detectSessionInUrl: false`（URL hash 不再带 session）
- 未配置 Supabase 时整个 `.auth-nav` 节点隐藏
- 仅 admin 用，public 端（`/lut-list/`、`/blog/`）`base.html` 不加载 supabase-config，登录按钮不显示
- Edge Function JWT 不变（OTP 产物与 magic link 一致）
- 见 `openspec/changes/archive/admin-otp-login-20260611/`

## 7. Admin 顶导登录入口（admin-nav-entry）
- 本项目用 `header_left_side` 侧边栏式布局，桌面下顶导 `display: none`，所以「🔒 管理」链接**两处**放置：
  - **手机**：顶导 `.site-header` 内（主菜单之后、`.auth-nav` 节点之前）
  - **桌面**：侧边栏 `.side-header` 的 `.bottom` 容器内（社交按钮下方）
- 两处由 CSS 互斥可见（`style.css:2534` / `mobile.css`），无需 JS 切换
- 链接可见性与 supabase 加载状态无关，公开页零额外 JS 开销
- 链接 href = `/admin/submissions/`，点击跳转
- `_layouts/base.html` 在 `page.layout == 'admin'` 时输出 `data-auth-auto-open="true"`
- `assets/js/auth-nav.js` 的 `refresh()` 在无 session 路径调 `autoOpenIfEligible()`，检查该标志 → `openModal()`
- admin 布局未登录进入 → 自动弹模态；contribute / lut 布局未登录进入 → 不弹
- admin 布局中退出登录 → 模态弹出引导重新登录；contribute / lut 布局退出 → 不弹
- 已登录 admin 同时看到「🔒 管理」+ 头像双入口（互不冲突）
- 见 `openspec/changes/archive/admin-nav-entry-20260611/`

## 8. LUT 付费购买（lut-paid-afdian）

付费 LUT 通过**爱发电** (ifdian.net) 完成支付与交付。`paid: true` 的 LUT 在详情页渲染价格徽章 + 购买 CTA，列表卡片显示「付费」角标；下载按钮在付费场景被替换为跳爱发电商品页的购买按钮。

- 前端 frontmatter：`paid: true` + `price: <元>` + `afdianSkuId: <SKU>` + `afdianOrderUrl: <商品页 URL>`（build-time 校验脚本 `script/validate-luts.sh` 强制四件套齐全）
- 数据库：`luts.paid` / `luts.price_cents` / `luts.afdian_sku_id` / `luts.afdian_order_url` 字段；新增 `paid_lut_orders` 表（`order_no` 唯一约束做幂等，state machine: pending → paid，字段 `dm_sent_at` / `dm_error` 跟踪 DM 兑号）
- Edge Functions：
  - `afdian-webhook`（部署时 `--no-verify-jwt`）— 验签（RSA-SHA256，公钥 hardcoded）+ Open API `query-order` 二次校验 + 30 分钟 signed URL + `/api/open/send-msg` DM 兑号
  - `resend-paid-download` — 管理员补发，5/24h 每买家限流
  - `manage-lut` 扩展 — 付费字段 upsert
- 兑号机制：**爱发电 DM**（webhook payload 无 email 字段；用 buyer 的 `user_id` 走 `send-msg` Open API 发 30 分钟 signed URL 文本）
- 签名位置：爱发电测试工具走 `payload.sign`（body），生产可能走 `sign` header，函数两个位置都读
- MD5：Web Crypto 不支持 MD5（仅 SHA 家族），`md5()` 用纯 JS RFC 1321 实现
- Admin 补发队列：`/admin/orders/` 列出 `state='paid' AND dm_sent_at IS NULL` 的订单，一键重新触发 DM
- 列表「付费」角标：纯文字（不显示价格，避免反复修改）
- 见 `openspec/changes/archive/lut-paid-afdian-20260615/`

## 9. Admin 后台 LUT 付费字段编辑（admin-lut-paid-fields）

`/admin/luts/` 编辑抽屉扩 4 个付费字段（`paid` 开关 + `price` 元 + `afdianSkuId` + `afdianOrderUrl`），admin 可在不动 SQL 的情况下把任意 LUT 标成付费；保存路径复用 `manage-lut`（PR #9 已支持）。

- 编辑抽屉：4 个付费字段在 `paid` 开关下排开，关闭时三字段变灰
- 校验：勾 `paid` 时三字段必填；SKU 必须匹配 `/^[a-zA-Z0-9]{8,64}$/`；URL 必须以 `https://ifdian.net/` 开头
- 列表角标：免费显示「免费」灰字，付费显示「付费 ¥X.XX」金底
- 投稿页 admin 直接发布 checkbox 同步美化为 iOS 风格开关（亮色主题）
- 保存成功以**后端返回的 `lut` 行**为本地 state 来源（避免旧版 `manage-lut` 静默丢弃付费字段时 UI 与 DB 漂移）
- 部署依赖：PR #9 的 `manage-lut` 必须已部署到目标 Supabase 项目，否则列表读 `r.paid` 为 undefined → 全部降级为「免费」角标
- 见 `openspec/changes/archive/admin-lut-paid-fields-20260615/`
