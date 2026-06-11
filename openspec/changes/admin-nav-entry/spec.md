# Spec: admin 顶导登录入口

> admin-otp-login 的**附加变更**：在所有页面顶导加一个始终可见的「🔒 管理」链接，作为 admin 登录入口。`/admin/submissions/` 检测无 session 时自动弹模态。公开页零额外 JS 开销。

## 已敲定决策

| 决策 | 选择 | 备注 |
|------|------|------|
| 入口位置 | 顶导右侧、主菜单之后、`.auth-nav` 节点之前 | 同一容器（`.fr`）内 |
| 入口形式 | 静态文字链接（`<a>`），无 JS 依赖 | 公开页不加载 supabase 也能看到 |
| 入口 href | `/admin/submissions/` | 与 admin 队列页共用，自动弹模态 |
| 自动弹模态机制 | base.html 检查 `page.layout == 'admin'` | 不污染 layout front matter，避免传染到其他布局 |
| 自动弹模态的页面 | 仅 admin 布局 | base.html 在 `page.layout == 'admin'` 时输出 `data-auth-auto-open="true"` |
| 不自动弹的页面 | contribute / lut 布局 | 投稿匿名、详情页与登录无关 |
| 视觉风格 | 与现有菜单项一致（discreet） | 移动端也显示 |
| 已登录并存 | 头像 + 「🔒 管理」双入口 | 不互斥 |

## MODIFIED Requirements

### Requirement: 顶导始终显示「🔒 管理」链接

在所有页面顶导（主菜单 `<ul id="menu-navigation">` 之后、`.auth-nav` 节点之前）插入一个静态 `<a class="auth-nav-entry" href="/admin/submissions/">🔒 管理</a>`。

#### Scenario: 公开页显示入口
- Given 访客在 `/`、`/lut-list/`、`/blog/`（`base.html` 布局）
- When 顶导加载
- Then 右侧显示「🔒 管理」文字链接
- And `base.html` **不增加**任何 JS 加载（supabase-config / supabase-js CDN 仍只在 admin / contribute / lut 布局加载）
- And `.auth-nav` 节点按现有 fallback 隐藏（supabase 未加载），但 `.auth-nav-entry` **仍可见**

#### Scenario: admin 布局页显示入口
- Given 访客在 `/admin/submissions/`
- When 顶导加载
- Then 右侧同时显示「🔒 管理」和现有 `.auth-nav` 节点（未登录时是「登录」按钮）

#### Scenario: contribute / lut 布局页显示入口
- Given 访客在 `/contribute/` 或 `/luts/:slug/`
- When 顶导加载
- Then 右侧显示「🔒 管理」链接
- And `.auth-nav` 节点按 supabase 配置正常显示

#### Scenario: 移动端显示入口
- Given 屏幕宽度 `<= 480px`
- When 顶导加载
- Then 「🔒 管理」文字仍可见、不被截断、不与汉堡菜单冲突

#### Scenario: 未配置 Supabase 时显示入口
- Given 部署环境无 `.env`（`window.LUTSITE_SUPABASE_URL === undefined`）
- When 顶导加载
- Then 「🔒 管理」链接仍可见（纯静态、不依赖 supabase）
- And 点击后跳转 `/admin/submissions/`，admin 页因 supabase 未配置行为与现状一致

#### Scenario: 已登录 admin 双入口并存
- Given admin 已登录、`localStorage` 有有效 session
- When 顶导加载
- Then 「🔒 管理」链接 + 头像（`.auth-nav-user`）同时可见、互不冲突

### Requirement: admin 布局访问无 session 时自动弹模态

`_layouts/base.html` 的 `<body>` 标签在 `page.layout == 'admin'` 时输出 `data-auth-auto-open="true"`。`assets/js/auth-nav.js` 在 `refresh()` 检测到无 session 时检查该标志、调用 `openModal()`。

`_layouts/contribute.html` / `_layouts/lut.html` 不属于 admin 布局，body 不带此信号，避免投稿页 / 详情页误弹模态。

#### Scenario: 未登录访问 /admin/submissions/ 自动弹模态
- Given admin 访客未登录
- When 浏览器跳转到 `/admin/submissions/`
- Then 顶导 `.auth-nav` 脚本 `init()` → `refresh()` → `getSession()` 返回 null
- And `document.body.dataset.authAutoOpen === 'true'` → 调 `openModal()`
- And 验证码页 / 邮箱页（按 admin-otp-login 已实现的 UI）正常显示

#### Scenario: 已登录访问 /admin/submissions/ 不弹模态
- Given admin 已登录、`localStorage` 有有效 session
- When 浏览器跳转到 `/admin/submissions/`
- Then `refresh()` 检测到 session → `setSignedIn()`、**不**调 `openModal()`
- And admin 队列正常加载

#### Scenario: 未登录访问 /contribute/ 不弹模态
- Given 访客未登录
- When 浏览器跳转到 `/contribute/`
- Then 顶导 `.auth-nav` 脚本检测 `document.body.dataset.authAutoOpen !== 'true'`
- And **不**调 `openModal()`，投稿页正常显示（投稿匿名）

#### Scenario: 未登录访问 /luts/:slug/ 不弹模态
- Given 访客未登录、想下载 LUT
- When 浏览器跳转到 `/luts/:slug/`
- Then 顶导 `.auth-nav` 脚本检测 `document.body.dataset.authAutoOpen !== 'true'`
- And **不**调 `openModal()`，详情页正常显示

#### Scenario: admin 布局中退出登录 → 弹模态
- Given admin 已登录、在 `/admin/submissions/` 操作
- When 点击「退出」→ `client.auth.signOut()` → `onAuthStateChange` → `refresh()`
- Then `getSession()` 返回 null、`setSignedOut()` + `autoOpenIfEligible()` 调 `openModal()`
- And 模态弹出，引导重新登录

#### Scenario: contribute / lut 布局中退出登录 → 不弹模态
- Given 已登录用户在 `/contribute/` 或 `/luts/:slug/`
- When 点击「退出」
- Then `refresh()` 检测到无 session → `setSignedOut()`，**不**调 `openModal()`
- And 「登录」按钮显示、模态不弹

## 不变

- admin-otp-login 已实现的全部逻辑（6 位 OTP / 60s 倒计时 / 错误码映射 / auto-advance / 黏贴拆分 / session 持久化）**完全不动**
- 公开页 `base.html` 不加载 supabase-config / supabase-js CDN 的设计**不变**
- `submit-lut` / `moderate-submission` Edge Function、JWT、role 加载行为**不变**
- `/admin/submissions/` 审批抽屉 UI、`/contribute/` 投稿表单、详情页下载模态**完全不受影响**
- 公开端（`/lut-list/`、`/blog/`、详情页下载、对比滑块）**完全不动**

## 数据流

```
访客（未登录）                     HTML / JS                              Supabase
 │                                  │                                       │
 │ ① 浏览 /lut-list/                  │                                       │
 │                                  │ ② 顶导渲染「🔒 管理」链接 (静态)         │
 │                                  │    .auth-nav 节点被 fallback 隐藏       │
 │ ◀────────────────────────────────┤                                       │
 │ ③ 点「🔒 管理」                    │                                       │
 ├──────────────────────────────────▶│                                       │
 │                                  │ ④ 浏览器导航到 /admin/submissions/      │
 │                                  │ ⑤ <body data-auth-auto-open="true">    │
 │                                  │ ⑥ auth-nav.js init() → refresh()       │
 │                                  │ ⑦ getSession() → null                   │
 │                                  │ ⑧ autoOpenIfEligible() → openModal()   │
 │ ◀────────────────────────────────┤                                       │
 │ ⑨ 模态弹出                          │                                       │
 │                                  │                                       │
 │ ⑩ 填邮箱 → 6 位码                  │                                       │
 ├──────────────────────────────────▶│ ⑪ signInWithOtp / verifyOtp             │
 │                                  ├──────────────────────────────────────▶│
 │                                  │ ◀── session ──────────────────────────┤
 │ ⑫ 模态关闭、admin 队列加载         │                                       │
 │ ◀────────────────────────────────┤                                       │
```

## 关联变更

- **本变更不修改 admin-otp-login 的逻辑**：只新增自动弹模态的触发点和顶导入口
- **本变更不影响**：lut-list / blog 列表、对比滑块、下载模态、contribute 投稿、admin 审批队列
