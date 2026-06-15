# Implementation Plan: LUT 付费购买（爱发电）

> 对应 `proposal.md` / `design.md` / `spec.md`。本清单按"先数据层、再后端、最后前端"的依赖顺序排列。

## 阶段状态
- [x] git branch: `feature/lut-paid-afdian-20260615`
- [x] proposal: 已确认
- [x] brainstorming: 已生成 `design.md`，TBD-1/2/3 已解决（爱发电官方文档已对照），投递策略=DM 兑号
- [x] spec: `spec.md` 已生成
- [ ] executing: 待开始
- [ ] archive: 待完成

---

## Prerequisites

- [ ] Supabase 项目可访问（沿用 `request-lut-download` 同项目）
- [ ] 爱发电开发者后台账号就绪（用于配置 Webhook URL + 获取 user_id / token）
- [ ] 爱发电「按商品售卖类型」方案至少创建 1 个（`product_type=1`），用于冒烟测试
- [ ] 本地 Jekyll 工具链就绪（`bundle exec jekyll build` 可跑通）

---

## Backend — 数据库迁移

### Task 1: 新增 `paid_lut_orders` 表
- [ ] 新建 `supabase/migrations/<timestamp>_paid_lut_orders.sql`
- [ ] 表 + UNIQUE 约束 + 两条索引（按 `lut_id`、`buyer_user_id`）
- [ ] RLS 策略：anon 无访问，authenticated admin role 可全权
- [ ] 本地跑迁移验证不报错（`supabase db reset` 或 psql 直连）

### Task 2: 扩展 `luts` 表
- [ ] 同 migration 文件追加 `alter table public.luts add column if not exists paid boolean not null default false, ...`
- [ ] 四列全 nullable（default false / NULL），不影响现有数据
- [ ] 验证现有 `manage-lut` Edge Function 不受影响

---

## Backend — Edge Functions

### Task 3: 实现 `afdian-webhook`
- [ ] 新建 `supabase/functions/afdian-webhook/index.ts`
- [ ] 顶部硬编码爱发电公钥（`const AFDIAN_PUBLIC_KEY = ...`）
- [ ] CORS：仅 server→server，忽略 CORS 头（`OPTIONS` 直接 204）
- [ ] 验签函数：`verifyAfdianSign(rawBody, signHeader, publicKey)` 用 `crypto.subtle.verify('RSASSA-PKCS1-v1_5', ...)`
- [ ] 解析 payload + 校验 `ec === 200 && data.type === 'order' && data.order.status === 2 && data.order.product_type === 1`
- [ ] 二次校验函数 `queryOrder(orderNo)`：调 `https://ifdian.net/api/open/query-order`，签名 `md5(token + params_kv + ts_kv + user_id_kv)`
- [ ] 查 LUT：`select id, slug, title, storage_path from luts where afdian_sku_id = $skuId`
- [ ] 限流检查（10/s 队列化 + 1000/h）：用 `lut_download_requests` 表或内存令牌桶
- [ ] send-msg 函数 `sendDm(userId, content)`：调 `https://ifdian.net/api/open/send-msg`，签名同上
- [ ] upsert `paid_lut_orders`
- [ ] 错误码映射：`invalid_signature → 400`, `order_not_paid → 402`, `unknown_sku → 404`, `invalid_product_type → 422`, `internal → 500`
- [ ] 成功路径返 `{"ec": 200, "em": ""}`，DM 失败也返 200（写 dm_error）

### Task 4: 实现 `resend-paid-download`
- [ ] 新建 `supabase/functions/resend-paid-download/index.ts`
- [ ] 复用 `SITE_ORIGIN` 模式 CORS
- [ ] JWT 校验：admin role 必须（`createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })` + `getUser(jwt)`）
- [ ] 接收 `{ orderId: string }`
- [ ] 查 `paid_lut_orders by id`，校验 `state='paid'`
- [ ] 限流：同 `buyer_user_id` 5/24h（`lut_download_requests.status='paid_resent'`）
- [ ] 重新生成 signed URL + 调 send-msg
- [ ] 更新 `dm_sent_at` / `dm_error` / `dm_message_id`
- [ ] 写一条 `lut_download_requests` 审计（`status='paid_resent'` 或 `'paid_resent_rate_limited'`）

### Task 5: 扩展 `manage-lut`
- [ ] 在 `supabase/functions/manage-lut/index.ts` 的 INSERT 部分加 `paid` / `price_cents` / `afdian_sku_id` / `afdian_order_url` 字段
- [ ] 仅在提交时含这些字段时写入（向后兼容）

### Task 6: Edge Function secrets
- [ ] `supabase secrets set AFDIAN_USER_ID=<id> AFDIAN_TOKEN=<token>`
- [ ] 验证 secrets 设置后 `Deno.env.get` 返回非空
- [ ] 爱发电开发者后台配置 Webhook URL：`https://<project>.supabase.co/functions/v1/afdian-webhook`

---

## Backend — 配置

### Task 7: `.env` 与 `.env.example`
- [ ] 在仓库根 `.env` 加 `AFDIAN_USER_ID=` / `AFDIAN_TOKEN=`（本地开发用）
- [ ] `.env.example` 同步加占位 + 注释说明「公钥硬编码在 `afdian-webhook/index.ts`，不进 secrets」
- [ ] 确认 `.env` 已在 `.gitignore`

### Task 8: `build-config.sh` 验证
- [ ] 确认 `script/build-config.sh` 不注入 `AFDIAN_*` 变量
- [ ] 跑一次 `make build` 验证 `assets/js/supabase-config.js` 中**无** `AFDIAN_*`

---

## Frontend — 详情页

### Task 9: `_layouts/lut.html` 条件渲染
- [ ] 侧栏 `#lut-download-cta` 替换为条件块：
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

### Task 10: 详情页 CSS
- [ ] `.widget-lut-purchase` 容器样式（与 `.widget-lut-download` 对齐）
- [ ] `.lut-price-badge` 胶囊样式（`#ebb85e` 背景，`#95680d` 字色）
- [ ] `.lut-purchase-trigger` 按钮样式（与下载按钮同款 hover 翻转）
- [ ] `.lut-purchase-hint` 提示文案（12-13px 灰字）

---

## Frontend — 列表卡片

### Task 11: 列表卡片付费角标
- [ ] 在卡片模板（`lut-list/index.html` 或卡片 include）加条件：
  ```liquid
  {% if lut.paid %}
    <span class="lut-card-paid-badge">付费</span>
  {% endif %}
  ```
- [ ] CSS：绝对定位 `top: 12px; right: 12px;`，深色半透明背景 + 浅色字 + 轻投影
- [ ] 验证不影响 `comparison-slider` 拖拽交互

---

## Frontend — Build-time 校验

### Task 12: 校验脚本
- [ ] 新建 `script/validate-luts.sh`，遍历 `_luts/*.md`，提取 frontmatter（用 `awk` / `sed` 或 Ruby `safe_yaml`）
- [ ] 校验规则：`paid: true` 的文件必须有 `price` / `afdianSkuId` / `afdianOrderUrl`
- [ ] 缺字段时 stderr 输出 `ERROR: lut '<slug>' is paid but missing: [<fields>]`，退出码非 0
- [ ] 集成进 `Makefile` 的 `build` 目标（在 `bundle exec jekyll build` 之前）

---

## Frontend — Admin 后台

### Task 13: `/admin/orders/` 页面
- [ ] 新建 `admin/orders.html`（layout = `admin`）
- [ ] admin 已登录校验（沿用 `/admin/submissions/` 同样的 OTP 跳转模式）
- [ ] 调 Supabase 查询 `paid_lut_orders where state='paid' and dm_sent_at is null` 排序 `created_at desc limit 50`
- [ ] 表格列：订单号 / LUT 标题（join luts.title）/ 买家 user_id / 金额（amount_cents / 100）/ DM 错误 / 重发按钮
- [ ] 重发按钮：JS 调 `resend-paid-download`，成功后 reload 列表

---

## Testing / 冒烟

### Task 14: 冒烟测试 LUT
- [ ] 新建 `_luts/<paid-test-slug>.md`，写完整 `paid: true` + `price: 1` + `afdianSkuId: <沙箱 sku_id>` + `afdianOrderUrl: <沙箱 URL>`
- [ ] 占位 `lutId: TBD-paid-test`
- [ ] `make build` 通过（脚本校验通过）

### Task 15: 端到端冒烟（爱发电沙箱）
- [ ] 部署 Edge Function（`supabase functions deploy afdian-webhook resend-paid-download`）
- [ ] 在沙箱爱发电下单 1 次
- [ ] 验证：DB 中 `paid_lut_orders` 多一行 `state='paid'`, `dm_sent_at` 非空
- [ ] 沙箱账号的爱发电私信收到 DM 含下载链接
- [ ] 验证：点击链接可下载 `.cube` 文件

### Task 16: 失败路径
- [ ] 故意把 webhook 头 `sign` 改成无效值 → 验签失败，DB 不写
- [ ] 故意用未支付订单（`status=1`）→ 二次校验失败，DB 不写
- [ ] send-msg 失败（mock 5xx）→ DB 写 `dm_error`，Webhook 仍返 200，admin 端可见
- [ ] 重复推送同一订单 5 次 → DB 只 1 行，DM 只发 1 次
- [ ] `resend-paid-download` 无 admin JWT → 401
- [ ] `resend-paid-download` 同一 user_id 24h 内第 6 次 → 429

### Task 17: 回归
- [ ] 免费 LUT 详情页下载流程端到端（不破现有）
- [ ] `/lut-list/` 列表加载更多 / 标签筛选回归
- [ ] `/blog/` 列表 / 详情回归
- [ ] `/admin/submissions/` 投稿审核回归
- [ ] Admin OTP 登录回归
- [ ] `make build` 退出码 0，无 Liquid 警告

---

## Archive

### Task 18: archive
- [ ] 全部 Task 完成后，按 `references/archive.md` 把本变更归档到 `openspec/changes/archive/lut-paid-afdian-20260615/`
- [ ] 在 `spec/requirements.md` 追加新章节（编号 8：LUT 付费购买）
- [ ] 在 `spec/structure.md` 追加新章节（如有新目录约定）
- [ ] 在 `spec/devlog.md` 追加变更日志
- [ ] 在 `spec/tasks.md` 追加本次里程碑条目

---

## 验收对照（spec.md → plan.md）

| Spec Requirement | 对应 Task |
|------|------|
| LUT frontmatter 付费字段 | Task 9, 12, 14 |
| 详情页付费 CTA 渲染 | Task 9, 10 |
| 列表卡片付费角标 | Task 11 |
| Webhook 接收端点 | Task 3 |
| Open API 二次校验 | Task 3 |
| `paid_lut_orders` 表 | Task 1 |
| `luts` 表扩展 | Task 2, 5 |
| admin 重发端点 | Task 4 |
| 配置与 .env | Task 6, 7, 8 |
| 限流策略 | Task 4 |
| 不破坏现有功能 | Task 17 |
| Admin 后台订单列表 | Task 13 |
| Build-time 校验 | Task 12 |
| Edge Function 单一文件风格 | Task 3, 4 |
