# Design: LUT 付费购买（爱发电）

> 状态：brainstorming 阶段产出，已对照爱发电官方文档（TBD-1/2/3 已解决），投递策略=DM 兑号（已确认）。待 spec 阶段。

## 1. 概述

在现有「邮箱 + Turnstile → signed URL → Resend」免费下载链路之外，新增爱发电付费通道。付费 LUT 详情页显示价格徽章 + 购买按钮（跳爱发电），Webhook 推送 → RSA-SHA256 验签（爱发电公钥固定）→ 调爱发电 Open API `query-order` 二次校验 → 写订单表 → 调爱发电 `/api/open/send-msg` 私信兑号（详见第 6 节）。

复用原则：
- Edge Function 单一文件风格（参考 `request-lut-download/index.ts`）
- 付费链路不依赖 Resend，统一走爱发电 `/api/open/send-msg` 私信兑号
- Supabase Storage signed URL（默认 30 分钟，付费与免费链路一致）
- CORS / 限流 / 审计模式（付费链路不要求 Turnstile，保留同 user_id 5/24h 限流防滥用）
- Webhook 不接受浏览器跨域请求，`resend-paid-download` 复用 `SITE_ORIGIN` 模式

## 2. 数据模型

### 2.1 LUT frontmatter 新增字段（`_luts/*.md`）

| 字段 | 类型 | 必填（付费） | 说明 |
|------|------|-----------|------|
| `paid` | bool | 是 | `true` 标记付费 LUT，免费 LUT 字段缺省 |
| `price` | number | 是 | 人民币整数（如 `99`），显示为 `¥99` |
| `afdianSkuId` | string | 是 | 爱发电商品 SKU ID（对应 webhook 的 `data.order.sku_detail[0].sku_id`），与 `luts.afdian_sku_id` 列匹配 |
| `afdianOrderUrl` | string | 是 | 爱发电商品页 URL，详情页"前往购买"按钮跳转目标 |

Jekyll 校验：若 `paid: true` 但其余三字段缺失，build 阶段（`script/build-config.sh` 或新增 `script/validate-luts.sh`）应报错并打印缺失字段名。

### 2.2 新表 `paid_lut_orders`

```sql
create table public.paid_lut_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null,                  -- 爱发电 out_trade_no
  lut_id text references public.luts(id),  -- 解析出 lut_id 后写入（仅当 sku_id 匹配已知 LUT）
  sku_id text not null,                    -- 爱发电 sku_detail[0].sku_id
  plan_id text not null,                   -- 爱发电 plan_id（方案 ID）
  buyer_user_id text not null,             -- 爱发电 user_id（DM 接收人）
  amount_cents int not null,               -- 订单金额（分，total_amount * 100）
  state text not null,                     -- 'paid' | 'pending' | 'refunded'
  remark text,                             -- 爱发电订单备注原文（不解析，留作审计）
  raw_payload jsonb not null,              -- 原始 webhook body 留作审计/排错
  dm_sent_at timestamptz,                  -- DM 下发时间
  dm_message_id text,                      -- 爱发电返回的 message_id（排错用）
  dm_error text,                           -- DM 失败时记录
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_no)                        -- 幂等性约束
);
create index paid_lut_orders_lut_id_idx on public.paid_lut_orders (lut_id);
create index paid_lut_orders_buyer_user_id_idx on public.paid_lut_orders (buyer_user_id);
```

`order_no` UNIQUE 是 Webhook 幂等性的核心。重复推送时 `onConflict DO NOTHING` 不报错，第二次起直接返 200 静默。

### 2.3 扩展 `luts` 表

```sql
alter table public.luts
  add column if not exists paid boolean not null default false,
  add column if not exists price_cents int,
  add column if not exists afdian_sku_id text,
  add column if not exists afdian_order_url text;
```

`manage-lut` 边缘函数 INSERT 时同步填充（admin 端提交付费 LUT 也走这个路径）。

## 3. Edge Function 设计

### 3.1 新建 `afdian-webhook`

**路径**：`POST /functions/v1/afdian-webhook`

**请求体**（爱发电推送，JSON）：
```json
{
  "ec": 200,
  "em": "ok",
  "data": {
    "type": "order",
    "order": {
      "out_trade_no": "202106232138371083454010626",
      "custom_order_id": "",
      "user_id": "adf397fe8374811eaacee52540025c377",
      "user_private_id": "...",
      "plan_id": "a45353328af911eb973052540025c377",
      "month": 1,
      "total_amount": "5.00",
      "show_amount": "5.00",
      "status": 2,
      "remark": "buyer@example.com",
      "redeem_id": "",
      "product_type": 1,
      "discount": "0.00",
      "sku_detail": [{
        "sku_id": "b082342c4aba11ebb5cb52540025c377",
        "count": 1,
        "name": "Art Sharpness LUT",
        "album_id": "",
        "pic": ""
      }],
      "address_person": "",
      "address_phone": "",
      "address_address": ""
    }
  }
}
```

**Headers**：
- `sign`: base64(RSA-SHA256(sign_str, 爱发电私钥))（**公钥固定，2025-07-01 后所有 webhook 都带签名**）
- `Content-Type: application/json`

**验签**：
```ts
const AFDIAN_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwwdaCg1Bt+UKZKs0R54y
lYnuANma49IpgoOwNmk3a0rhg/PQuhUJ0EOZSowIC44l0K3+fqGns3Ygi4AfmEfS
4EKbdk1ahSxu7Zkp2rHMt+R9GarQFQkwSS/5x1dYiHNVMiR8oIXDgjmvxuNes2Cr
8fw9dEF0xNBKdkKgG2qAawcN1nZrdyaKWtPVT9m2Hl0ddOO9thZmVLFOb9NVzgYf
jEgI+KWX6aY19Ka/ghv/L4t1IXmz9pctablN5S0CRWpJW3Cn0k6zSXgjVdKm4uN7
jRlgSRaf/Ind46vMCm3N2sgwxu/g3bnooW+db0iLo13zzuvyn727Q3UDQ0MmZcEW
MQIDAQAB
-----END PUBLIC KEY-----`;

// 拼接顺序：out_trade_no + user_id + plan_id + total_amount
const signStr = `${out_trade_no}${user_id}${plan_id}${total_amount}`;
const ok = await crypto.subtle.verify(
  "RSASSA-PKCS1-v1_5",
  publicKey,
  base64ToBytes(signature),
  new TextEncoder().encode(signStr),
);
```

**响应**（必须返 `{"ec": 200, "em": ""}` 才算成功，否则爱发电视为失败会重试）：
- 200 `{ ec: 200, em: "" }` — 成功（即使邮件下发失败）
- 400 `{ ec: 400, em: 'invalid signature' }` — 验签失败
- 404 `{ ec: 404, em: 'unknown sku' }` — `sku_id` 在 `luts.afdian_sku_id` 中找不到
- 402 `{ ec: 402, em: 'order not paid' }` — Open API 二次校验发现订单未支付
- 422 `{ ec: 422, em: 'invalid product type' }` — `product_type != 1`（仅售卖类型商品处理）
- 500 `{ ec: 500, em: 'internal' }` — 内部错误

**处理流水线**：
1. 读取 raw body（验签用）
2. 解析 JSON，校验 `ec === 200 && data.type === 'order' && data.order.status === 2`
3. 验签 `sign` 字段（`crypto.subtle.verify`，公钥硬编码在 Edge Function）
4. 幂等：以 `out_trade_no` 查 `paid_lut_orders`，已存在且 `state='paid' AND dm_sent_at IS NOT NULL` → 直接返 200
5. 二次校验：调 `https://ifdian.net/api/open/query-order` 传 `params={"out_trade_no": <out_trade_no>}`：
   - 请求体 JSON：`{ user_id: AFDIAN_USER_ID, params: JSON.stringify({out_trade_no}), ts: <unix>, sign: <md5> }`
   - 签名：`sign = md5(token + "params" + params + "ts" + ts + "user_id" + user_id)`
   - 校验响应 `ec=200` + `data.list[0].status=2` + `data.list[0].sku_detail[0].sku_id` 与 webhook `plan_id`/`sku_id` 一致
6. 查 LUT：`select id, slug, title, storage_path from luts where afdian_sku_id = <sku_id>`，找不到 → 404
7. 解析买家 user_id：从 `data.order.user_id`（DM 接收人）
8. upsert 订单表：`paid_lut_orders` onConflict `order_no` DO UPDATE
9. 生成 signed URL（同 `request-lut-download`）
10. 投递下载链接（DM 策略，见第 6 节）：
    - 调 `https://ifdian.net/api/open/send-msg` 给 `buyer_user_id` 发私信，内容含下载链接
    - 成功 → 写 `dm_sent_at` / `dm_message_id`
    - 失败 → 写 `dm_error`，**Webhook 仍返 200**，admin 后台重发
11. 返回 200

### 3.2 新建 `resend-paid-download`

admin 后台手动重发时使用（不接受前端公开调用）。

**路径**：`POST /functions/v1/resend-paid-download`

**请求头**：`Authorization: Bearer <admin jwt>`（已登录 admin）

**请求体**：`{ orderId: '<paid_lut_orders.id 字符串或 uuid>' }`

**处理**：
1. JWT 校验（admin role 检查，复用现有 admin OTP 体系）
2. 查 `paid_lut_orders` by `id`
3. 校验 `state='paid'`
4. 重新生成 signed URL + 调 `/api/open/send-msg` 给 `buyer_user_id` 重发 DM
5. 更新 `dm_sent_at` / `dm_error` / `dm_message_id`

**限流**：同 user_id 5/24h，写 `lut_download_requests.status='paid_resent'`

### 3.3 复用与不扩展

- **复用** `request-lut-download` 的 Resend 调用方式（`sendEmail()`），本次新 Edge Function 内复制 `sendEmail` 包装为 `sendDm` 调 `/api/open/send-msg`，文案与邮件同结构（"感谢支持"段），不依赖邮件模板（DM 是纯文本）
- **不扩展** `request-lut-download`：付费链路单独走，避免单一函数过于复杂

## 4. Open API 鉴权细节

请求格式（参考爱发电官方文档）：
```json
{
  "user_id": "<creator's user_id>",
  "params": "{\"out_trade_no\":\"<order_no>\"}",
  "ts": 1624339905,
  "sign": "<md5(...)>"
}
```

签名：
```ts
const kv_string = `params${params}ts${ts}user_id${user_id}`;
const sign = md5(`${token}${kv_string}`);
// 例：md5("123params{\"out_trade_no\":\"xxx\"}ts1624339905user_idabc")
```

ts 校验窗口：3600 秒。

错误码：
- 400001 params incomplete
- 400002 time was expired（ts 超过 3600s）
- 400003 params not valid JSON
- 400004 no valid token found
- 400005 sign validation failed（响应里会带 `debug.kv_string` 方便排错）

`query-order` 响应：
```json
{
  "ec": 200,
  "em": "",
  "data": {
    "list": [{ "out_trade_no": "...", "status": 2, "sku_detail": [...], "total_amount": "5.00", ... }],
    "total_count": 1,
    "total_page": 1
  }
}
```

## 5. 二次校验策略

**始终调用 `query-order` 二次校验**（不只是 webhook 签名通过就放过）：
- 防止 webhook 签名私钥泄露时被恶意伪造
- 校验 `status=2`、`sku_id` 与 webhook 一致
- 调用失败时（爱发电 API 不可用）→ Webhook 返 5xx 让爱发电重试（订单未写入，二次推送时仍可恢复）

## 6. 投递策略：DM 兑号（已确认）

Webhook payload **没有 `email` 字段**。买家通过爱发电私信（DM）接收下载链接：

- Webhook 处理时调 `https://ifdian.net/api/open/send-msg`
- 接收者：`data.order.user_id`
- 消息内容：`你的 LUT「{title}」下载链接：{signedUrl} （30 分钟内有效）`
- 限速：10/s, 1000/h（爱发电 API 限制，Webhook 处理需串行化或加队列）

**优点**：
- 零买家操作，自动化
- 不依赖买家填邮箱/备注
- DM 始终可达（只要买家登录爱发电）

**缺点与应对**：
- 链接 30 分钟有效 → 买家可能错过 → admin 后台一键重发（重新调 send-msg）
- 买家用爱发电 App 才收到推送 → 爱发电 App 默认推送开启

**`paid_lut_orders` 简化**：
- 删除 `buyer_email` / `delivery_method` 字段（不再需要）
- 保留 `dm_sent_at` / `dm_error` / `dm_message_id`
- 保留 `remark` 字段原样存（审计用，不解析）

**前端文案**（详情页 `lut-purchase-hint`）：
> 购买后请到爱发电「我的私信」查收下载链接，链接 30 分钟内有效。如未收到请联系客服或重新发起订单。

## 7. 前端设计

### 7.1 详情页 `/_layouts/lut.html`

侧栏 `#lut-download-cta` 改为条件渲染：

```liquid
{% if page.paid %}
  <div id="lut-purchase-cta" class="widget widget-lut-purchase">
    <span class="lut-price-badge">¥{{ page.price }}</span>
    <a class="lut-purchase-trigger" href="{{ page.afdianOrderUrl }}"
       target="_blank" rel="noopener noreferrer">
      <i class="solid-icon-shopping-cart"></i>
      <span>前往购买</span>
    </a>
    <p class="lut-purchase-hint">
      购买后请到爱发电「我的私信」查收下载链接，链接 30 分钟内有效。
    </p>
  </div>
{% else %}
  <!-- 现有 #lut-download-cta 不变 -->
{% endif %}
```

CSS：
- 价格徽章：胶囊状，背景 `#ebb85e`，字色 `#95680d`，字号 18-20px
- 购买按钮：与下载按钮同款（hover 翻转效果）
- 提示文案：12-13px 灰字

**A11y**：购买按钮是 `<a target="_blank">`，已带 `rel="noopener noreferrer"`。

### 7.2 列表卡片

卡片右上角增加条件徽章：

```liquid
{% if lut.paid %}
  <span class="lut-card-paid-badge">付费</span>
{% endif %}
```

CSS：绝对定位 `top: 12px; right: 12px;`、深色半透明背景 + 浅色字、轻投影。

## 8. Webhook 幂等性

- DB 层：`paid_lut_orders.order_no` UNIQUE 约束
- 应用层：先 `select` 检查 `state='paid' AND dm_sent_at IS NOT NULL`；命中 → 直接返 200
- 应用层：未命中 → `upsert ... onConflict: 'order_no'`，已存在时 DO NOTHING 不重新触发邮件
- 不依赖爱发电重试：Webhook 一旦返 200 即视为完成，重发走 admin 路径

## 9. DM 容错

| 失败点 | 处理 |
|--------|------|
| send-msg 5xx | `dm_error='send-msg 5xx: ...'`，Webhook 仍返 200，admin 后台重发 |
| send-msg 网络断开 | 同上 |
| send-msg 限速 10/s, 1000/h 触发 | `dm_error='rate_limited'`，Webhook 仍返 200，admin 重发 |
| send-msg 返回 ec != 200 | `dm_error=响应 em 字段`，Webhook 仍返 200 |
| 买家 App 未开启推送 | 链接已落库，admin 可重发；或买家自查爱发电站内私信 |
| 30 分钟链接过期 | 买家可在详情页重新发起订单，或 admin 手动重发 |

## 10. 配置

### 10.1 Edge Function 环境变量（`supabase secrets set`）

| 名称 | 说明 | 是否进前端 |
|------|------|-----------|
| `AFDIAN_WEBHOOK_PUBLIC_KEY` | 爱发电公钥（硬编码也行，无需 secrets） | 否（硬编码） |
| `AFDIAN_USER_ID` | 创作者 user_id | 否（仅 server 用） |
| `AFDIAN_TOKEN` | Open API token | 否 |
| `RESEND_API_KEY` / `EMAIL_FROM` | 现有 | 否 |

**注**：爱发电公钥是固定的（来自官方文档），可以硬编码在 Edge Function 中，**不**用存 secrets。

### 10.2 `.env` 文件（仓库根）

```
AFDIAN_USER_ID=
AFDIAN_TOKEN=
```

公钥不进 .env（硬编码在 Edge Function）。

### 10.3 `.env.example` 同步

加占位 + 注释说明公钥不存 secrets。

### 10.4 `script/build-config.sh` 注入

**不注入**任何 Afdian 变量。前端零 Afdian 配置依赖。

### 10.5 CORS

- `afdian-webhook` 忽略 CORS（server→server）
- `resend-paid-download` 复用现有 `SITE_ORIGIN` 模式（admin 后台调用）

## 11. 数据库迁移

新增 `supabase/migrations/<timestamp>_paid_lut_orders.sql`：
- 建表 + UNIQUE + 索引
- `luts` 表加列：`paid`, `price_cents`, `afdian_sku_id`, `afdian_order_url`
- 更新 `manage-lut` 边缘函数 INSERT 字段
- 加 RLS：admin 可 SELECT/INSERT/UPDATE 全部，anon 不可见

## 12. 风险与已确认事项

| 项 | 状态 |
|----|------|
| Webhook payload 结构 | ✅ 已确认（来自官方文档） |
| Webhook 验签算法 | ✅ RSA-SHA256（公钥固定） |
| Open API 鉴权 | ✅ md5(token + kv_string) |
| Webhook 邮箱字段 | ❌ 不存在 → 改用 DM 兑号（第 6 节） |
| Webhook 重复推送 | 爱发电建议做幂等（已设计） |
| 限流策略 | 同 user_id 5/24h（与免费下载对齐，写入 `lut_download_requests`） |

## 13. 不在范围内

- 退款流程 / 客服 / 工单
- 跨 LUT 套餐
- 爱发电之外的支付渠道（Stripe / 微信 / 支付宝）
- 发票 / 税务
- 订阅制 / 自动续费
- 货币换算 / 多币种
- OAuth2 授权（暂用 Webhook + API 足够）

## 14. 验收标准（同 proposal）

详见 `proposal.md` 11 项验收标准。实施期需补：
- Webhook 重复推送 5 次 → 只发 1 次 DM
- 二次校验发现订单未支付 → Webhook 返 402
- 二次校验发现订单已退款 → 标记 `state='refunded'`，不发链接
- 验签失败 → Webhook 返 400，不写订单
- DM 失败 → `dm_error` 写库，admin 端可见
- 至少 1 个示例付费 LUT 用于冒烟测试
- 限速 10/s, 1000/h 测试：并发 11 个 send-msg 请求 → 第 11 个被爱发电拒，返回 `dm_error='rate_limited'`，admin 可重发
