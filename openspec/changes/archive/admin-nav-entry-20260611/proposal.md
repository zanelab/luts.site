---
parent_branch: main
---

# Proposal: admin-nav-entry

## What
在顶导右侧（主菜单之后、`.auth-nav` 节点之前）加一个**始终可见**的「🔒 管理」文字链接。点击跳转到 `/admin/submissions/`，该页加载时检测无 session → 自动弹出登录模态。已登录 admin 进入则不弹模态、直接显示队列。

布局上的差异：
- `_layouts/admin.html` 加 `<body data-auth-auto-open="true">` 作为信号
- `_layouts/contribute.html` / `_layouts/lut.html` **不**加，避免投稿/详情页误弹模态
- `assets/js/auth-nav.js` 在 `init()` 末尾检查 `document.body.dataset.authAutoOpen === 'true' && !session` → 调 `openModal()`

## Why
公开页（`/`、`/lut-list/`、`/blog/`）的 `base.html` 不加载 supabase-config.js / supabase-js CDN，`.auth-nav` 节点被 auth-nav.js 的 fallback 逻辑隐藏（`supabaseUrl === undefined` 时整节点 `display: none`）。结果是：纯访客在任何公开页都看不到登录入口，admin 想知道"去哪儿登录"无迹可寻。

新增一个**与 supabase 加载状态无关的纯静态链接**作为入口，公开页零额外 JS 开销。

## Scope
- [ ] backend
- [x] frontend

涉及文件：
- `_includes/header.html`（加 `.auth-nav-entry` 链接）
- `_layouts/admin.html`（加 `data-auth-auto-open` 标志）
- `assets/js/auth-nav.js`（init 末尾自动弹模态逻辑）
- `_includes/components/auth-nav.html`（加 `.auth-nav-entry` CSS，discreet 风格）

## Acceptance Criteria
- [ ] 所有页面（`/`、`/lut-list/`、`/blog/`、`/admin/submissions/`、`/contribute/`、`/luts/:slug/`）顶导右侧显示「🔒 管理」文字链接
- [ ] 链接 href = `/admin/submissions/`，新窗口打开行为不强制（用 `_self`）
- [ ] 「🔒 管理」链接的可见性**与 supabase 是否加载无关**——公开页 supabase 未加载时仍能看到链接
- [ ] 公开页（`base.html`）**不增加**任何 JS 加载，supabase-config / supabase-js CDN 仍只在 admin / contribute / lut 布局加载
- [ ] 访问 `/admin/submissions/` 时：未登录 → 模态自动弹出；已登录 → 模态不弹、显示队列
- [ ] 访问 `/contribute/` 或 `/luts/:slug/` 时：未登录 → **不**弹模态（避免干扰）
- [ ] 「🔒 管理」移动端也显示（不隐藏）
- [ ] 视觉风格与现有菜单项一致（discreet），不抢眼
- [ ] `assets/js/auth-nav.js` 的 fallback 行为不变（未配置 Supabase 时 `.auth-nav` 节点仍隐藏）
- [ ] 已登录 admin 同时看到「🔒 管理」和头像入口，两者并存

## Status
- [ ] 提案已确认
