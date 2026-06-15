# 架构设计（累积式）

> 每完成一个模块在 archive 阶段追加一节。

## 总体形态
- Jekyll 静态站点，主题骨架来自 Sansara WordPress 主题（已转成 `_layouts/base.html` + `assets/` 资源）
- 内容驱动：`_luts/`（自定义 collection）+ `_posts/`（原生 posts）+ `_data/*.yml`（导航/首页）
- 列表与详情共享主题的 `.blog-block` / `.blog-items` / isotope 布局
- 客户端 JS：jQuery + isotope 主题脚本 + 自写 IIFE（标签筛选、加载更多、对比滑块）

## 1. LUTs 模块
- 自定义 collection（`_luts/`），front matter 含 beforeImg/afterImg/tags
- 详情页 `_layouts/lut.html` 包含双图对比滑块
- 见 `openspec/changes/luts-list-detail/`

## 2. 博客模块
- 原生 posts 集合（`_posts/`），`defaults` 注入 `layout: post` 与 `permalink: /blog/:slug.html`
- 列表复用 `.blog-block` 容器，去掉双图对比改为单封面
- 标签筛选：`<article data-tags="...">` + URL `?tag=` + JS 客户端过滤
- 筛选机制移植自 LUTs 列表页（统一脚本模式）
- 见 `openspec/changes/archive/blog-list-detail-20260610/`

## 3. 付费 LUT（爱发电）

### 架构
- **数据**：`luts` 表加 4 列（`paid` / `price_cents` / `afdian_sku_id` / `afdian_order_url`），新表 `paid_lut_orders`（`order_no` 唯一约束做幂等）
- **支付**：爱发电平台（ifdian.net）—— 不是 Stripe/支付宝，需要走爱发电的 webhook 协议
- **兑号**：爱发电 DM（无 email 字段），用 `send-msg` Open API 把 30 分钟 signed URL 文本发给买家

### Edge Function 拓扑
```
[买家] → 爱发电付款 → 爱发电 webhook POST → /functions/v1/afdian-webhook
  ├─ 验签 (RSA-SHA256, 公钥 hardcoded)
  ├─ 二次校验 (query-order Open API, 防 webhook 私钥泄漏)
  ├─ 按 afdian_sku_id 查 luts
  ├─ 生成 30 分钟 signed URL
  └─ send-msg Open API → 买家 DM 收到下载链接
[管理员] → /admin/orders/ → resend-paid-download → 重发 DM (5/24h/buyer 限流)
```

### 安全 / 一致性
- `afdian-webhook` 部署时 `--no-verify-jwt`（服务对服务无 JWT，依赖 RSA 验签 + 二次校验）
- webhook 永远返回 HTTP 200 + `ec: 200`（Afdian 协议），DM 失败只把 `dm_error` 写库，不影响 webhook ACK
- DM 失败由 admin 在 `/admin/orders/` 手动补发（避免无限重试浪费 Open API 配额）
- 订单行用 `order_no` 唯一约束 + upsert 天然幂等

### 平台差异 / 已知限制
- **MD5 纯 JS**：`crypto.subtle.digest("MD5", ...)` 在 Deno Edge Function 不被支持（W3C Web Crypto 只允许 SHA 家族），爱发电 Open API 签名的 MD5 必须用纯 JS。函数内联 RFC 1321 实现
- **sign 位置兼容**：爱发电测试工具走 `payload.sign`（body），生产可能走 `sign` header，函数两处都读
- **买家身份**：爱发电 webhook 给的是爱发电 `user_id`（不是我们 Supabase auth 的 user），不与本站 `auth.users` 关联——所以付费 LUT 的"谁买过"用 `paid_lut_orders.buyer_user_id` 单独追踪

### 见
- `openspec/changes/archive/lut-paid-afdian-20260615/`
