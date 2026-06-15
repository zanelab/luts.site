# Spec: LUT 付费购买（爱发电）

> 对应 `proposal.md` + `design.md`。本文件聚焦可执行验收标准。

## 变更概述

为部分 LUT 启用付费购买通道。`_luts/<slug>.md` 新增 `paid` / `price` / `afdianSkuId` / `afdianOrderUrl` 四个 frontmatter 字段。付费 LUT 详情页替换"下载 LUT"按钮为价格徽章 + 购买跳转链接，列表卡片右上角加"付费"角标。爱发电 Webhook 推送时通过 RSA-SHA256 验签（爱发电公钥固定）→ 调 Open API `query-order` 二次校验 → 写 `paid_lut_orders` 表 → 调 `/api/open/send-msg` 私信把下载链接发给买家。Webhook 一律返 `{"ec": 200, "em": ""}` 视为成功（DM 失败也返 200，由 admin 后台重发）。免费 LUT 流程零变化。

## ADDED Requirements

### Requirement: LUT frontmatter 付费字段

`_luts/<slug>.md` 支持标记付费 LUT。字段名与类型固定。

#### Scenario: 完整填写付费字段
- Given 作者在 `_luts/<slug>.md` 写入 `paid: true`、`price: 99`、`afdianSkuId: <sku_id>`、`afdianOrderUrl: https://ifdian.net/...`
- When Jekyll 解析 front matter
- Then 字段全部可被模板 `page.paid` / `page.price` / `page.afdianSkuId` / `page.afdianOrderUrl` 读到

#### Scenario: 缺字段 build-time 报错
- Given 作者写入 `paid: true` 但 `price` / `afdianSkuId` / `afdianOrderUrl` 任一缺失
- When `make build` 执行（包含 `script/validate-luts.sh` 步骤）
- Then Jekyll 构建以非零退出码终止，stderr 输出 `ERROR: lut '<slug>' is paid but missing: [price]`

#### Scenario: 免费 LUT 字段缺省
- Given LUT 不写 `paid` 字段
- When 模板读取
- Then `page.paid` 为 falsy（`nil`），按免费 LUT 渲染原下载按钮

---

### Requirement: 详情页付费 CTA 渲染

详情页侧栏在 LUT 为付费时显示价格徽章 + 购买按钮，免费时显示原"下载 LUT"按钮。

#### Scenario: 付费 LUT 渲染购买 CTA
- Given 用户打开 `luts/<paid-slug>/`（`page.paid == true`）
- When 详情页渲染
- Then 侧栏第一项渲染 `#lut-purchase-cta`：胶囊价格徽章（`¥{{ page.price }}`）+ 购买按钮 `href={{ page.afdianOrderUrl }}` + 提示文案
- And 原 `#lut-download-cta` 不渲染

#### Scenario: 购买按钮外链打开
- Given 用户在 `#lut-purchase-cta` 点击购买按钮
- When 触发
- Then 浏览器跳转到爱发电商品页（`target="_blank"`，`rel="noopener noreferrer"`）

#### Scenario: 免费 LUT 渲染下载 CTA
- Given 用户打开 `luts/<free-slug>/`
- When 详情页渲染
- Then 侧栏渲染原 `#lut-download-cta`，购买 CTA 不渲染

---

### Requirement: 列表卡片付费角标

`/lut-list/` 列表卡片对付费 LUT 显示"付费"角标，免费 LUT 不显示。

#### Scenario: 付费 LUT 卡片角标
- Given LUT `paid: true`
- When 列表页 `/lut-list/` 渲染
- Then 卡片右上角渲染 `<span class="lut-card-paid-badge">付费</span>`，绝对定位不遮挡对比图主体

#### Scenario: 免费 LUT 卡片无角标
- Given LUT `paid: true` 缺省
- When 列表页渲染
- Then 卡片不渲染付费角标

---

### Requirement: Webhook 接收端点

新建 Supabase Edge Function `afdian-webhook`，爱发货平台向其推送订单。

#### Scenario: 端点注册
- Given admin 在爱发电开发者后台配置通知 URL 为 `https://<project>.supabase.co/functions/v1/afdian-webhook`
- When 有订单支付成功
- Then 爱发电流向该 URL 推送 POST 请求

#### Scenario: 验签失败
- Given Webhook 请求头 `sign` 字段缺失或与 RSA-SHA256(sign_str, 爱发电公钥) 不匹配
- When Edge Function 处理
- Then 返 `{"ec": 400, "em": "invalid signature"}`，不写 `paid_lut_orders`，不调 send-msg

#### Scenario: 验签成功 + 二次校验失败
- Given 验签通过，但 Open API `query-order` 返 `ec != 200` 或 `data.list[0].status != 2`
- When Edge Function 处理
- Then 返 `{"ec": 402, "em": "order not paid"}`，不写订单，不调 send-msg

#### Scenario: sku_id 找不到 LUT
- Given 二次校验通过，但 `luts.afdian_sku_id` 中无匹配
- When Edge Function 处理
- Then 返 `{"ec": 404, "em": "unknown sku"}`，不写订单，不调 send-msg

#### Scenario: 完整成功
- Given 验签通过 + 二次校验通过 + sku_id 匹配 + send-msg 成功
- When Edge Function 处理
- Then 写 `paid_lut_orders` 一行（`state='paid'`, `dm_sent_at=now()`, `dm_message_id=<id>`）并返 `{"ec": 200, "em": ""}`

#### Scenario: DM 失败仍返 200
- Given 验签 + 二次校验 + sku 匹配均通过，但 `/api/open/send-msg` 返 5xx 或 ec != 200
- When Edge Function 处理
- Then 仍写订单（`state='paid'`, `dm_error='send-msg <status>: <body>'`, `dm_sent_at=NULL`）并返 `{"ec": 200, "em": ""}`
- And admin 后台可见该订单需要重发

#### Scenario: Webhook 重复推送幂等
- Given 同一 `out_trade_no` 的 Webhook 已被处理（`paid_lut_orders.order_no` 已存在且 `state='paid' AND dm_sent_at IS NOT NULL`）
- When 爱发电因异常重发同一 Webhook
- Then Edge Function 跳过 send-msg 直接返 `{"ec": 200, "em": ""}`，不重复发 DM

#### Scenario: Webhook 重复推送但上次 DM 失败
- Given `paid_lut_orders.order_no` 存在且 `dm_sent_at IS NULL`（上次 DM 失败）
- When 重发到达
- Then Edge Function 重新调 send-msg，更新 `dm_sent_at` / `dm_error` 字段

#### Scenario: product_type 校验
- Given Webhook payload `data.order.product_type != 1`（如订阅方案 `product_type=0`）
- When Edge Function 处理
- Then 返 `{"ec": 422, "em": "invalid product type"}`，不写订单（仅处理售卖类型商品）

#### Scenario: 限速 10/s 触发
- Given 1 秒内已发 10 个 send-msg 请求
- When 第 11 个 send-msg 到达
- Then send-msg 返 429，写 `dm_error='rate_limited'`，Edge Function 仍返 `{"ec": 200, "em": ""}`

---

### Requirement: Open API 二次校验

Edge Function 在 Webhook 验签通过后必须调 `https://ifdian.net/api/open/query-order` 二次校验订单状态。

#### Scenario: 签名生成
- Given `user_id=ABC`, `params='{"out_trade_no":"<no>"}'`, `ts=<unix>`, `token=XYZ`
- When Edge Function 计算签名
- Then `sign = md5("XYZparams{params}ts{ts}user_idABC")`（顺序：`token` + `params` + 值 + `ts` + 值 + `user_id` + 值，无连接字符）

#### Scenario: ts 过期
- Given `ts` 与服务器时间差超过 3600 秒
- When 调用 query-order
- Then 返 `{"ec": 400002, ...}`，Edge Function 视为校验失败，返 402

#### Scenario: 二次校验成功
- Given query-order 返 `{"ec": 200, "data": {"list": [{"out_trade_no": "<no>", "status": 2, "sku_detail": [{"sku_id": "<sku>"}]}]}}`
- When Edge Function 解析
- Then 校验 `status=2` 与 `sku_id` 与 Webhook 一致，通过后继续

---

### Requirement: paid_lut_orders 表

新建表记录每个付费订单及其下发状态。

#### Scenario: 表结构
- Given migration `supabase/migrations/<ts>_paid_lut_orders.sql` 执行
- When 数据库 schema 更新
- Then 表存在，列：`id`, `order_no` (UNIQUE), `lut_id` (FK to luts), `sku_id`, `plan_id`, `buyer_user_id`, `amount_cents`, `state`, `remark`, `raw_payload`, `dm_sent_at`, `dm_message_id`, `dm_error`, `created_at`, `updated_at`
- And 索引：`paid_lut_orders_lut_id_idx`, `paid_lut_orders_buyer_user_id_idx`

#### Scenario: RLS 策略
- Given anon 用户查询 `paid_lut_orders`
- When Supabase 鉴权
- Then 返 403 / 空集（anon 无权读）
- And admin 角色可 SELECT/INSERT/UPDATE 全部行

#### Scenario: upsert 写入
- Given Webhook 处理到达
- When Edge Function 调 `admin.from('paid_lut_orders').upsert(row, { onConflict: 'order_no' })`
- Then 新订单插入；同 order_no 已存在则更新 `state`, `amount_cents`, `raw_payload`, `dm_*` 字段

---

### Requirement: luts 表扩展

`public.luts` 表加列以支持付费 LUT 标识（admin 后台发布付费 LUT 也走此表）。

#### Scenario: 加列
- Given migration 执行
- Then `luts` 表新增列：`paid` (boolean default false), `price_cents` (int), `afdian_sku_id` (text), `afdian_order_url` (text)
- And 所有列 nullable（不影响现有免费 LUT）

#### Scenario: manage-lut 扩展
- Given admin 在 `manage-lut` Edge Function 中提交 LUT 包含付费字段
- When INSERT 执行
- Then `paid` / `price_cents` / `afdian_sku_id` / `afdian_order_url` 写入对应列

---

### Requirement: admin 重发端点

新建 Supabase Edge Function `resend-paid-download`，admin 可触发对失败订单的 DM 重发。

#### Scenario: 端点注册
- Given admin 登录后访问 `/admin/orders/`
- When 点击某失败订单的"重新发送"按钮
- Then 前端 POST `https://<project>.supabase.co/functions/v1/resend-paid-download`，body `{ orderId: '<uuid>' }`，带 admin JWT

#### Scenario: 重发成功
- Given Edge Function 收到合法 admin JWT + 存在的 orderId + `state='paid'` + `dm_sent_at IS NULL`
- When 处理
- Then 重新生成 signed URL，调 send-msg，更新 `dm_sent_at` / `dm_error`，返 `{ ok: true }`

#### Scenario: 非 admin 调用
- Given 请求无 JWT 或 JWT role != admin
- When Edge Function 处理
- Then 返 401 / 403

#### Scenario: 限流
- Given 同一 `buyer_user_id` 过去 24h 内已重发 5 次（`lut_download_requests.status='paid_resent'` 计数）
- When 再次重发
- Then 返 429 `{ error: 'rate_limited' }`，不调 send-msg

---

### Requirement: 配置与 .env

仓库 `.env` 与 `.env.example` 同步更新；Edge Function secrets 包含 Afdian 鉴权信息。

#### Scenario: .env.example 占位
- Given `.env.example` 存在
- When 检查
- Then 含 `AFDIAN_USER_ID` / `AFDIAN_TOKEN` 占位值 + 注释说明公钥硬编码在 `afdian-webhook/index.ts`，不进 secrets

#### Scenario: secrets 配置
- Given `supabase secrets set AFDIAN_USER_ID=... AFDIAN_TOKEN=...`
- When Edge Function 启动
- Then `Deno.env.get('AFDIAN_USER_ID')` 与 `Deno.env.get('AFDIAN_TOKEN')` 返回非空

#### Scenario: build-config.sh 不注入 Afdian 变量
- Given `.env` 包含 `AFDIAN_*` 变量
- When `script/build-config.sh` 执行
- Then `assets/js/supabase-config.js` 中**不**含 `AFDIAN_*` 全局变量（前端零 Afdian 依赖）

#### Scenario: 敏感文件被忽略
- Given `.gitignore`
- When 检查
- Then `.env` 与 `assets/js/supabase-config.js` 已被忽略

---

### Requirement: 限流策略

付费 LUT 重发与免费 LUT 下载共用 `lut_download_requests` 审计表，但计数维度按 user_id（爱发电 user_id）而非邮箱。

#### Scenario: 重发限流
- Given `lut_download_requests` 中存在同一 `email='<afdian_user_id>'` 过去 24h 内 5 条 `status='paid_resent'`
- When `resend-paid-download` 收到第 6 次请求
- Then 返 429 `rate_limited`

#### Scenario: 限流计数仅记成功
- Given 同一 user_id 24h 内 5 条 `status='paid_resent_rate_limited'`
- When 重发请求
- Then 限流未触发（仅 `status='paid_resent'` 计入）

---

### Requirement: 不破坏现有功能

付费 LUT 流程的引入不影响免费 LUT 下载、列表页、博客模块、admin OTP 登录、admin 投稿审核等既有功能。

#### Scenario: 回归免费 LUT
- Given 一篇 `paid` 缺省的 LUT
- When 详情页 / 列表页 / 下载流程执行
- Then 行为与变更前一致（下载按钮、Turnstile、邮箱下发链路不受影响）

#### Scenario: 回归其他模块
- Given 列表页 / 博客 / 投稿 / admin 后台任一模块
- When `make build` + `bundle exec jekyll build`
- Then 退出码 0，无 Liquid 警告，回归通过

#### Scenario: luts 表加列不破坏
- Given 现有 `luts` 行 `paid` / `price_cents` / `afdian_sku_id` / `afdian_order_url` 全为 NULL
- When 现有 `request-lut-download` 读 `luts` 表
- Then 不读这些新列，行为不变

---

### Requirement: Admin 后台订单列表

`/admin/orders/` 页面展示 `paid_lut_orders` 中需关注的订单（DM 失败 / 待重发）并提供重发按钮。

#### Scenario: 页面渲染
- Given admin 已登录并访问 `/admin/orders/`
- When 页面加载
- Then 列出 `state='paid' AND dm_sent_at IS NULL` 的订单（最新 50 条），每行含订单号 / LUT 标题 / 买家 user_id / 金额 / DM 错误 / 「重新发送」按钮

#### Scenario: 重发按钮调用 Edge Function
- Given admin 点击某行「重新发送」按钮
- When 触发
- Then JS 调 `resend-paid-download` Edge Function，成功后刷新列表，失败时弹错误提示

#### Scenario: 公开访问拒绝
- Given 未登录用户访问 `/admin/orders/`
- When 检查
- Then 跳 admin 登录模态（与 `/admin/submissions/` 行为一致）

---

### Requirement: Build-time frontmatter 校验

Jekyll 构建时验证付费 LUT frontmatter 完整性。

#### Scenario: 校验通过
- Given 所有 `paid: true` 的 LUT 都有 `price` / `afdianSkuId` / `afdianOrderUrl`
- When `script/validate-luts.sh` 在 `make build` 中执行
- Then 退出码 0，不输出错误

#### Scenario: 校验失败
- Given 任一付费 LUT 缺字段
- When 脚本执行
- Then 退出码非 0，stderr 列出每个问题 LUT 与缺失字段，构建中断

#### Scenario: 免费 LUT 不校验
- Given LUT `paid` 缺省
- When 脚本执行
- Then 不校验其付费字段（无所谓填不填）

---

### Requirement: Edge Function 单一文件风格

`afdian-webhook` 与 `resend-paid-download` 与现有 Edge Function 保持单文件风格，不引入 `_shared/` 共享模块。

#### Scenario: 目录结构
- Given Edge Function 部署
- Then 目录结构：
  - `supabase/functions/afdian-webhook/index.ts`（自包含：CORS、验签、二次校验、send-msg 客户端、订单 upsert）
  - `supabase/functions/resend-paid-download/index.ts`（自包含：JWT 校验、send-msg 客户端、限流）

#### Scenario: 公钥硬编码
- Given 爱发电公钥在文档中固定
- When Edge Function 验签
- Then 公钥以 `const AFDIAN_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"` 形式硬编码在 `afdian-webhook/index.ts` 顶部，**不**通过 secrets / .env 传入

---

## REMOVED Requirements

无（本变更纯增量）。

## MODIFIED Requirements

无（本变更不修改任何已存在的需求项；新表 / 新列均为新增）。
