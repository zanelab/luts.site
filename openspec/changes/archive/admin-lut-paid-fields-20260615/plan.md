# Implementation Plan：admin 后台 LUT 编辑表单扩付费字段

> 阶段：executing 前置
> 依赖：**PR #9（feat: paid LUT purchase via Afdian with DM delivery）必须先合到 main**——本分支基于 main，main 当前没有 `luts.paid` 等列和 `manage-lut` 付费字段扩展，端到端 build 验证需等 PR #9 合并。

## Prerequisites
- [ ] PR #9 已合到 main（或确认管理员在 Supabase 上手工加了 `luts.paid` / `luts.price_cents` / `luts.afdian_sku_id` / `luts.afdian_order_url` 四列 + 重新部署 `manage-lut`）
- [x] 分支 `feature/admin-lut-paid-fields-20260615` 已是当前 checkout

## Frontend — admin/luts.html
- [x] 在编辑表单 `lut-admin-edit-form` 内追加 4 个付费字段（保持原 4 个字段顺序）
  - [ ] `<label><input type="checkbox" id="lut-admin-edit-paid" /> 付费 LUT</label>` + 帮助文字「勾选后下方三个字段必填」
  - [ ] `<label for="lut-admin-edit-price">价格（元）</label>` + `<input type="number" id="lut-admin-edit-price" min="0.01" max="9999" step="0.01" />`
  - [ ] `<label for="lut-admin-edit-sku">爱发电 SKU ID</label>` + `<input type="text" id="lut-admin-edit-sku" maxlength="64" pattern="[a-zA-Z0-9]{8,64}" />`
  - [ ] `<label for="lut-admin-edit-url">爱发电商品页 URL</label>` + `<input type="url" id="lut-admin-edit-url" maxlength="500" />`
  - [ ] 每个字段下方加 `<p class="lut-admin-form-help" id="lut-admin-edit-XXX-hint">` 槽位（用于红字错误提示，默认空）
- [x] CSS：角标样式（与现有 `lut-card-paid-badge` 对齐）
  - [ ] `.lut-admin-list--luts .paid-badge` 通用样式
  - [ ] `.lut-admin-list--luts .paid-badge--free` 灰色
  - [ ] `.lut-admin-list--luts .paid-badge--paid` 金色（与详情页 `.lut-price-badge` 同色 `#ebb85e`）
- [x] CSS：付费字段在未勾时变灰
  - [ ] `.lut-admin-edit-form .paid-section--disabled input` 透明度 0.5 + 不可编辑
  - [ ] `.lut-admin-edit-form input.is-invalid` 红色边框

## Frontend — assets/js/admin-luts.js
- [x] 在 `state` 加 `currentPaid: false`
- [x] 在 `renderList()` 给每行 li 追加 `paidBadge` 节点（luts 行内显示，免费/付费）
  - [ ] 数据降级：`r.paid` 是 undefined → 显示「免费」（不抛错）
  - [ ] 付费且有 price_cents → 显示「付费 ¥X.XX」
  - [ ] 付费但 price_cents 缺失 → 显示「付费」（无金额）
- [x] 在 `openDrawer()`（或等价函数）里读 4 个付费字段
  - [ ] 读 `r.paid` → checkbox.checked
  - [ ] 读 `r.price_cents` → 数字 input.value = cents/100
  - [ ] 读 `r.afdian_sku_id` → sku input.value
  - [ ] 读 `r.afdian_order_url` → url input.value
- [x] 在 `closeDrawer()` 清空 4 个付费字段
- [x] 写 `validatePaidFields()` 函数，返回 `{ ok: boolean, errors: { price?: string, sku?: string, url?: string } }`
  - [ ] paid=false → 永远 ok
  - [ ] paid=true 但 price 缺失或 ≤0 → errors.price
  - [ ] SKU 不匹配 `/^[a-zA-Z0-9]{8,64}$/` → errors.sku
  - [ ] URL 不以 `https://ifdian.net/` 开头 → errors.url
- [x] 写 `updateValidationUi()` 函数：遍历 errors 对象，写红字到对应 hint，is-invalid class 切到 input，启用 / 禁用保存按钮
- [x] 给 4 个付费字段加 input 事件监听，每次输入调 `updateValidationUi()`
  - [ ] paid checkbox 改变时：切换 `.paid-section--disabled` 类 + 重跑 validation
- [x] 改 `submitForm()`：从表单读 8 个字段（含新增 4 个）拼 body，调 `manage-lut`
  - [ ] body 增加：`paid: boolean`、`priceCents: number | null`、`afdianSkuId: string | null`、`afdianOrderUrl: string | null`
  - [ ] 后端 `manage-lut` 已支持这些字段（PR #9），前端只需 wire-up
- [x] 改成功回调：成功保存后 `state.list` 里对应行 `r.paid` / `r.price_cents` / `r.afdian_sku_id` / `r.afdian_order_url` 同步更新（避免列表角标 stale），但**不重渲染整个列表**（避免分页 / 滚动状态丢失），只 patch 一行的 innerHTML

## Validation
- [x] `make build` 通过（PR #9 合后）
- [x] `script/validate-luts.sh` 通过（_luts/paid-smoke-test.md 仍合法）
- [x] 端到端（需 PR #9 合后人工跑）：
  - [ ] 打开 /admin/luts/，看到现有 LUT 列表，付费 LUT 显示「付费 ¥X」角标
  - [ ] 点编辑 → 抽屉加载，预填 4 个付费字段
  - [ ] 勾上 paid 但 price 留空 → 红字 + 保存禁用
  - [ ] 三个字段填齐 → 保存启用 → 点保存 → 抽屉顶部绿色「已保存」+ 列表该行角标变化
  - [ ] 把 paid 取消勾，price/sku/url 留空 → 保存允许 → DB 4 字段全 NULL
  - [ ] SKU 输入 `not-a-sku` → 红边 + 红字
  - [ ] URL 输入 `https://example.com` → 红边 + 红字
  - [ ] 未登录访问 → 「请先登录管理员账号」

## Deploy
- [x] PR 推上去后 admin 端无需重新部署 Edge Function（依赖的 manage-lut 已在 PR #9 部署过）
- [x] 重新 build Jekyll 静态站即可（`make build` 输出到 _site/，或部署到 CDN）

## Out of scope（不在本 PR）
- 投稿流程里默认 paid=false 的逻辑（已经在 PR #9 落地，本 PR 不动）
- 付费 LUT 列表筛选 / 批量改价 / 历史审计
- _luts/*.md frontmatter → DB 反向同步脚本
- 重新部署 `manage-lut`（PR #9 已部署）
- 重新部署数据库迁移（PR #9 已 apply）
