# Spec：admin 后台 LUT 编辑表单扩付费字段

## ADDED Requirements

### Requirement: 列表显示付费状态角标
/admin/luts/ 列表应显示每条 LUT 是「免费」还是「付费 ¥X」，让 admin 在不打开编辑抽屉的情况下能扫一眼分辨。

#### Scenario: 免费 LUT
- Given DB 中 `luts.paid = false` 的某条 LUT
- When admin 进入 /admin/luts/
- Then 该 LUT 卡片显示灰色「免费」文字角标

#### Scenario: 付费 LUT
- Given DB 中 `luts.paid = true` 且 `luts.price_cents = 500` 的某条 LUT
- When admin 进入 /admin/luts/
- Then 该 LUT 卡片显示金色「付费 ¥5.00」文字角标

#### Scenario: 付费但未设价
- Given DB 中 `luts.paid = true` 但 `luts.price_cents` 为 NULL
- When admin 进入 /admin/luts/
- Then 该 LUT 卡片显示金色「付费」文字角标（不显示价格，避免「¥NaN」）

#### Scenario: 列表未配置付费字段读取
- Given 后端 `manage-lut` 还没合并到 main（PR #9 未合）
- When admin 加载 /admin/luts/
- Then 列表读 `r.paid` / `r.price_cents` 为 `undefined`，角标统一显示「免费」（前端降级，不报错）

### Requirement: 编辑抽屉加载付费字段
编辑抽屉打开时应把 DB 中的 4 个付费字段（paid / price_cents / afdian_sku_id / afdian_order_url）预填到表单，admin 看到的是当前真实值，不是空白。

#### Scenario: 打开付费 LUT 编辑抽屉
- Given DB 中 `paid=true`、`price_cents=500`、`afdian_sku_id='abc123...'`、`afdian_order_url='https://ifdian.net/a/abc'`
- When admin 点该 LUT 卡片上的「编辑」
- Then 抽屉打开，4 个付费字段全部预填：paid 复选框勾上、price 显示 5、sku 显示 abc123...、url 显示 https://ifdian.net/a/abc

#### Scenario: 打开免费 LUT 编辑抽屉
- Given DB 中 `paid=false`、其他付费字段为 NULL
- When admin 点该 LUT 卡片上的「编辑」
- Then 抽屉打开，paid 复选框未勾，price / sku / url 三个 input 显示为空字符串（非 undefined）

### Requirement: 付费字段必填联动
勾上「付费」开关时，price / afdian_sku_id / afdian_order_url 三个字段必须非空才能保存；未勾时三个字段可选。

#### Scenario: 勾上付费但未填价
- Given admin 打开编辑抽屉，paid 复选框初始未勾
- When admin 勾上 paid，但 price 留空
- Then price input 显示红色边框 + 下方红字「付费 LUT 必须填价格」；保存按钮 disabled

#### Scenario: 勾上付费但 SKU 为空
- Given admin 勾上 paid，price 填了 5
- When admin 在 afdian_sku_id 留空
- Then sku input 显示红色边框 + 红字「必须填爱发电 SKU ID」；保存按钮 disabled

#### Scenario: 勾上付费但 URL 为空
- Given admin 勾上 paid，price 填了 5
- When admin 在 afdian_order_url 留空
- Then url input 显示红色边框 + 红字「必须填爱发电商品页 URL」；保存按钮 disabled

#### Scenario: 三个字段都填了
- Given admin 勾上 paid，price / sku / url 三个都填了合法值
- Then 三个 input 红边消失，红字消失，保存按钮启用

#### Scenario: 取消付费勾
- Given admin 已勾 paid 且三个字段都填了
- When admin 取消勾 paid
- Then 三个付费字段的必填标记消失，保存按钮启用（即使三个字段有内容也允许保存为「免费的 LUT」）

### Requirement: 字段格式校验
afdian_sku_id 和 afdian_order_url 在保存前必须满足格式约束，不合法的值不允许发请求。

#### Scenario: SKU 格式非法
- Given admin 在 afdian_sku_id 输入 `not-a-real-sku`
- When admin 尝试点保存
- Then sku input 红边 + 红字「SKU 格式不正确（爱发电 SKU 是 32 位字母数字）」，保存按钮 disabled，请求不发出

#### Scenario: SKU 格式合法
- Given admin 输入 `f1316b08689511f19efc52540025c377`（32 位 hex）
- Then sku input 红边消失，保存按钮在其它条件满足时启用

#### Scenario: URL 域名不对
- Given admin 在 afdian_order_url 输入 `https://example.com/something`
- When admin 尝试点保存
- Then url input 红边 + 红字「必须是 https://ifdian.net/ 开头的链接」，保存按钮 disabled

#### Scenario: URL 域名对但路径奇怪
- Given admin 输入 `https://ifdian.net/random`
- Then url 红边消失（只校验域名前缀，不校验具体路径）

### Requirement: 保存调 manage-lut 并刷新
保存时把 8 个字段一起 PUT 到 manage-lut，DB 更新成功后抽屉顶部显示「已保存」绿色提示，列表对应行角标同步更新。

#### Scenario: 成功保存
- Given admin 在抽屉里把 paid 改成 true、price 改成 5
- When admin 点保存
- Then PUT 请求 body 含 paid=true、priceCents=500、afdianSkuId=...、afdianOrderUrl=...；返回 200 后抽屉顶部显示绿色「已保存」；列表该行角标从「免费」变成「付费 ¥5.00」

#### Scenario: 后端报错（如 SKU 已被其他 LUT 占用）
- Given 后端返回 4xx 错误（如 afdian_sku_id 重复）
- When admin 点保存
- Then 抽屉顶部显示红色错误信息（来自后端 `error` 字段），表单不清空，admin 可改完再提交

#### Scenario: 网络异常
- Given fetch 抛 TypeError（如断网）
- When admin 点保存
- Then 抽屉顶部显示红色「网络异常，请重试」，保存按钮重新启用

### Requirement: 取消付费允许清空
admin 把 paid 从 true 改成 false 时，price / sku / url 三个字段的值在保存后**可以**一并清空（DB 端置 NULL），不强制保留历史值。

#### Scenario: 取消付费并清空
- Given paid=true、price=5、sku=xxx、url=yyy
- When admin 取消勾 paid，点保存
- Then DB 端：`paid=false`、`price_cents=NULL`、`afdian_sku_id=NULL`、`afdian_order_url=NULL`
- 解释：4 个字段语义耦合，paid=false 时其他三个没意义；保留会误导未来的 admin

### Requirement: 非 admin 访问拦截
未登录或非 admin 角色访问 /admin/luts/ 时应看到拦截提示，与现有 /admin/submissions/、/admin/orders/ 行为一致。

#### Scenario: 未登录
- Given 访客无 Supabase session
- When 访客访问 /admin/luts/
- Then 显示「请先登录管理员账号。」，表单不渲染

#### Scenario: 已登录但非 admin
- Given 用户已登录但 `users.role != 'admin'`
- When 用户访问 /admin/luts/
- Then 显示「此页面仅对管理员开放。」，并附带 SQL 提升提示（与现有逻辑一致）

### Requirement: 部署依赖顺序
本变更的代码可以合到 main，但**端到端跑通需要 PR #9 先合**（后端 paid 列 / manage-lut 付费字段扩展）。在 PR #9 之前，前端列表会把所有 LUT 都显示成「免费」（因为 `r.paid` 是 undefined），这是预期降级行为。

#### Scenario: PR #9 未合
- Given PR #9 未合并，DB 没有 paid 列，manage-lut 不知 paid 字段
- When 本 PR 部署到 production
- Then 列表全部显示「免费」（数据降级），点保存时 PUT 请求 body 含 paid 字段被后端忽略（不报错，但 DB 不会更新 paid）—— admin 应等到 PR #9 合后再用此功能
- 解释：文档中明确提示「需 PR #9 先合」，本 PR 不强加技术手段阻止误用

### Requirement: Build 验证
`make build` 必须通过；`script/validate-luts.sh` 必须继续认 paid LUT 的 frontmatter 校验（这是 PR #9 加的，跟本 PR 独立）。

#### Scenario: smoke LUT frontmatter 仍合法
- Given `_luts/paid-smoke-test.md` 含 `paid: true / price: 1 / afdianSkuId: ... / afdianOrderUrl: ...`
- When 运行 `make build`
- Then `validate-luts: all paid LUTs have price/afdianSkuId/afdianOrderUrl ✓` 输出，build 退出 0

#### Scenario: 详情页未受影响
- Given 已有的 `_layouts/lut.html` 付费 CTA 渲染逻辑
- When 运行 `make build`
- Then 付费 LUT 详情页仍渲染 `#lut-purchase-cta` + 价格徽章 + 购买按钮（与 PR #9 行为一致，未被本 PR 改动）
