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
