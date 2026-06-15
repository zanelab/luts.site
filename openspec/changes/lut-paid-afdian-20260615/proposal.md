---
parent_branch: main
change_name: lut-paid-afdian
---

# Proposal: LUT 付费购买（爱发电）

## What

为部分 LUT 启用付费购买通道。用户在爱发电按 SKU 付款后，Webhook + Open API 二次校验通过后自动把下载链接发到订单填写的邮箱，与现有「邮箱 + Turnstile → 限时下载链接」流程复用。免费 LUT 行为完全不变。

用户故事：

- **付费 LUT 作者**：在 `_luts/<slug>.md` frontmatter 中标记 `paid: true` + 写入 `afdianSkuId` + `price` + `afdianOrderUrl`，详情页自动出现价格徽章和「前往购买」按钮
- **付费 LUT 访客**：在详情页看到价格 + 「前往购买」按钮 → 跳转到爱发电对应商品页 → 付款后留邮箱 → 收到邮件含 30 分钟有效下载链接
- **免费 LUT 访客**：行为零变化，沿用原「下载 LUT」模态
- **Admin**：通过 Supabase 表查看所有付费订单与下发记录，必要时人工补发

## Why

LUT 是创作者核心产出，平台目前所有 LUT 均可免费下载，缺乏变现通道。爱发电是国内创作者常用的赞助/付费平台，对个人开发者友好、API 简洁，适合作为首个商业化通道接入。复用现有下载链路（Edge Function + 限时链接 + Turnstile）可避免重建防滥用体系。

## Scope

- [x] backend（Supabase：新表 `paid_lut_orders`、新 Edge Function `afdian-webhook`、扩展 `request-lut-download` 接受付费 LUT 邮箱校验、配置 `AFDIAN_*` 环境变量）
- [x] frontend（`_layouts/lut.html` 价格徽章 + 购买按钮、`lut-list/` 卡片价格标签、`assets/js/lut-download.js` 区分免费/付费 LUT、`script/build-config.sh` 注入 `AFDIAN_*`）

## Acceptance Criteria

- [ ] 付费 LUT Markdown frontmatter 新增 `paid: true`、`afdianSkuId`、`afdianOrderUrl`、`price`（人民币数字）字段，作者不填全则 Jekyll 构建报警告
- [ ] 详情页头部：付费 LUT 在原「下载 LUT」按钮位置替换/并列显示价格徽章（¥xx）+「前往购买」按钮，点击跳转到 `afdianOrderUrl`（`target="_blank"`）
- [ ] 详情页头部：免费 LUT 渲染原「下载 LUT」按钮，行为零变化
- [ ] 列表页 `/lut-list/` 卡片：付费 LUT 显示价格标签，免费 LUT 不显示
- [ ] 新表 `paid_lut_orders`（字段：`id`、`lut_id`、`order_no`、`sku_id`、`buyer_email`、`amount`、`state`、`created_at`、`email_sent_at`、`email_error`），爱发电 Webhook 写入
- [ ] 新 Edge Function `afdian-webhook`（路径 `POST /functions/v1/afdian-webhook`）：
  - 验签：`x-sign` HMAC-SHA256(payload, secret) 与 `AFDIAN_WEBHOOK_SECRET` 比对
  - 二次校验：调 `https://afdian.com/api/open/query-order` 用 `order_no` 确认订单存在 + `status=2`（已支付）+ `sku_id` 匹配 LUT 标记
  - 写入 `paid_lut_orders`
  - 复用 `request-lut-download` 同款邮箱下发逻辑（生成 `lutId` 对应的 signed URL + 邮件）
  - 返回 `{ ec: 0 }` 给爱发电
- [ ] `request-lut-download` Edge Function 扩展：当 `lutId` 对应付费 LUT 时，新增分支接受 `orderNo` 参数，校验 `paid_lut_orders` 中存在该邮箱匹配的有效订单后下发链接（防绕过）
- [ ] 付费 LUT 的 Edge Function 流程不复用 Turnstile（爱发电已通过付款验证），但保留 5 次/邮箱/24h 限流审计
- [ ] `.env` 新增 `AFDIAN_WEBHOOK_SECRET` / `AFDIAN_USER_ID` / `AFDIAN_TOKEN`（Open API 鉴权），`build-config.sh` 注入到 `assets/js/supabase-config.js`（仅公开值如 `AFDIAN_USER_ID` 用于前端展示可选；secret/token 留在 Edge Function 环境变量，不进前端）
- [ ] `.env.example` 同步更新
- [ ] 现有「免费 LUT 下载」流程（Turnstile + 邮箱下发）回归通过
- [ ] `make build` 退出码 0，无 Liquid 警告
- [ ] 至少 1 个示例付费 LUT 用于冒烟测试

## 风险与边界

- **不在范围内**：退款流程、批量授权码、跨 LUT 套餐、外币支付、订阅制、发票、税务、爱发电之外的支付渠道
- **依赖爱发电 API 可用性**：Open API 调用失败时 Webhook 暂时返回非 0 让爱发电重试，最多重试 N 次由爱发电侧控制
- **爱发电字段变更**：Webhook payload 结构如有变化需调整本变更中的字段映射（`order_no` / `sku_id` / `email` / `amount` / `status`）

## Status

- [x] 提案已确认
