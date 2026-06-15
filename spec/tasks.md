# 任务里程碑

## v0 — 站点主题移植
- [x] 移植 Sansara 主题骨架（`base.html` / assets）
- [x] 顶部导航数据化

## v1 — LUTs 模块
- [x] LUT 列表与详情
- [x] 加载更多分页
- [x] Before/After 对比滑块
- [x] 详情页下载流程（Supabase Edge Function + Turnstile + 浮动侧栏）

## v2 — 博客模块
- [x] `_posts/` 数据源
- [x] 列表 + 详情页
- [x] 标签筛选（`?tag=` 客户端 JS）
- [x] LUTs 列表复用同一筛选机制

## v3 — 投稿与审核
- [x] Supabase 表 / RLS / 存储桶
- [x] Edge Function `submit-lut`（匿名投稿）
- [x] Edge Function `moderate-submission`（admin 审批）
- [x] `/contribute/` 投稿页（drag-drop 上传）
- [x] `/admin/submissions/` 审批队列
- [x] Admin OTP 登录（顶导两步 OTP 模态，取代 magic link）
- [x] Admin 顶导登录入口（「🔒 管理」文字链接，公开页可见，admin 页自动弹模态）

## v4 — 付费 LUT 购买（爱发电）
- [x] `paid_lut_orders` 表 + `luts` 表 4 个付费字段
- [x] Edge Function `afdian-webhook`（RSA 验签 + Open API 二次校验 + DM 兑号）
- [x] Edge Function `resend-paid-download`（admin 补发 + 5/24h 限流）
- [x] Edge Function `manage-lut` 扩展付费字段
- [x] 详情页付费 CTA（价格徽章 + 购买按钮）
- [x] 列表卡片「付费」角标
- [x] `/admin/orders/` DM 补发队列
- [x] Build-time frontmatter 校验（`script/validate-luts.sh`）
- [x] 部署 `--no-verify-jwt`（webhook 走 service-to-service）
- [x] MD5 纯 JS 实现（绕开 Deno Web Crypto 限制）
