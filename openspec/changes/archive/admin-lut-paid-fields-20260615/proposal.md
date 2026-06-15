# Proposal：admin 后台 LUT 编辑表单扩付费字段

## What

在 `/admin/luts/` 编辑抽屉里新增 4 个付费字段（`paid` 开关 + `price` 元 + `afdian_sku_id` + `afdian_order_url`），admin 可以在不改 SQL 的情况下把任意 LUT 标成付费。列表卡片增加「免费 / 付费」角标。保存路径走现有的 `manage-lut` Edge Function（PR #9 已扩展支持这 4 个字段）。

## Why

- PR #9 把 `manage-lut` 的后端扩好了，但**没有任何 UI 让 admin 触发**——这是上一轮 archive 时漏掉的差距
- 现状：标 paid LUT 必须手工进 Supabase Dashboard 跑 SQL，无法走运营流程
- 后果：实际运营侧标付费 LUT 卡在工具链缺口，付费流程跑不起来
- 此外 `_luts/*.md` frontmatter 的 `paid: true` 跟 DB `luts.paid` 是**两个独立数据源**，运营改了 .md 还要再去后台改一遍 DB，容易漂移

## Scope

**In scope**:
- `admin/luts.html` 编辑表单：4 个付费字段（`paid` 复选框 + `price` 数字 input + `afdian_sku_id` 文本 + `afdian_order_url` URL）
- `assets/js/admin-luts.js`：列表渲染时读 `paid` / `price_cents` / `afdian_sku_id` 显示角标；编辑抽屉加载时填 4 个字段；保存时把 4 个字段加进 PUT body
- 校验：勾 paid 时要求 price / sku / url 必填
- 列表角标：免费显示「免费」灰字，付费显示「付费 ¥X」金底（跟列表卡片 `.lut-card-paid-badge` 风格对齐）
- 复用 `manage-lut` 现有 PATCH 路径（不新建 function）

**Out of scope**:
- 不动 `lut-contribution` 投稿流程（已经写表，但默认 `paid=false`）
- 不做 `_luts/*.md` frontmatter → DB 反向同步（保持两套数据源独立，运营必须显式改两边）
- 不做付费 LUT 列表筛选 / 批量改价
- 不做付费状态变更历史 / 审计日志
- 不动 PR #9 已经写好的后端

## Dependency

**硬依赖 PR #9 先合并到 main**。本分支从 main 拉，main 当前没有 `luts.paid` / `luts.price_cents` / `luts.afdian_sku_id` / `luts.afdian_order_url` 列，也没有 `manage-lut` 对这些字段的处理。本分支可以写代码，但**只有在 PR #9 合到 main 之后**才能 build 验证 / 部署到 Supabase 跑端到端。提议的合并顺序：先合 PR #9，再合本 PR。

## Acceptance Criteria

1. 进入 `/admin/luts/`，已登录 admin 看到每条 LUT 卡片，付费 LUT 右上角显示「付费 ¥X」金色角标，免费 LUT 显示「免费」灰色文字
2. 点「编辑」打开抽屉，4 个原字段（title / slug / desc / tags）+ 4 个付费字段（paid 开关、price 元、afdian_sku_id、afdian_order_url）都能看到
3. 抽屉加载时所有 8 个字段都用 DB 当前值预填
4. 勾上「付费」开关时，`price` / `afdian_sku_id` / `afdian_order_url` 三个 input 标记为必填，未填时保存按钮禁用 + 字段下方红字提示
5. 保存：把 8 个字段一起 PUT 到 `manage-lut`，DB 更新成功后抽屉顶部显示「已保存」绿色提示
6. 列表「付费 / 免费」角标在卡片显示和数据一致（保存后列表自动刷新当前行）
7. afdian_sku_id 校验：32 位 hex / 32 位含数字字母混排的 Afdian 标准 SKU 格式，不符合时 input 红边 + 拒绝保存
8. afdian_order_url 校验：必须以 `https://ifdian.net/` 开头，不符合时 input 红边 + 拒绝保存
9. 取消付费（uncheck `paid`）：允许把 4 个付费字段全部清空（DB 端置 NULL），前端不强制保留历史值
10. 未登录 / 非 admin 看到「此页面仅对管理员开放」提示（与现状一致）
11. `make build` 通过；Supabase 端到端（PR #9 合后）：在 admin UI 标 paid → DB 字段更新 → 爱发电 webhook 推单能查到该 LUT
