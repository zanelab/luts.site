# Implementation Plan: admin 顶导登录入口

## Prerequisites
- [x] 已有活跃变更 `admin-nav-entry`，proposal 已 review
- [x] 当前分支 `feature/admin-nav-entry`，基于 `feature/admin-otp-login`（PR #7，依赖其 auth-nav.js 实现）
- [x] 读 `_includes/header.html` 找菜单 `<ul id="menu-navigation">` 位置，规划 `.auth-nav-entry` 插入点（line 30 `</ul>` 之后、line 35 `{% include components/auth-nav.html %}` 之前）
- [x] 读 `_layouts/base.html` line 53 找到 `<body class="...">` 标签，规划 `page.body_data` 渲染点
- [x] 读 `_layouts/admin.html` / `contribute.html` / `lut.html` front matter 找 `body_class` 字段
- [x] 读 `assets/js/auth-nav.js` `init()` / `refresh()` 找自动弹模态的插入点（`refresh()` 检测到无 session 时）

## 准备：布局信号机制
- [ ] `_layouts/base.html` 的 `<body>` 标签加 `{% if page.body_data %} {{ page.body_data }}{% endif %}`，把 front matter 字段透传到 body data attribute
- [ ] `_layouts/admin.html` front matter 加 `body_data: data-auth-auto-open="true"`
- [ ] `_layouts/contribute.html` front matter **不**加
- [ ] `_layouts/lut.html` front matter **不**加

## Header 改动
- [ ] `_includes/header.html` line 30 `</ul>` 之后、line 32 `<div class="butter-button ...">` 之前插入：
      `<a class="auth-nav-entry" href="{{ site.baseurl }}/admin/submissions/">🔒 管理</a>`
- [ ] 链接放在 `.fr` 容器内、与 `.auth-nav` 节点同级，确保顶导布局统一

## auth-nav.js 自动弹模态
- [ ] 在 `refresh()` 检测到 `!session` 时，新增 `autoOpenIfEligible()` 调用
- [ ] 实现 `autoOpenIfEligible()`：
      - 检查 `document.body.dataset.authAutoOpen === 'true'`
      - 是 → 调 `openModal()`（已有 public 函数）
- [ ] `setSignedOut()` 路径同样调 `autoOpenIfEligible()`（admin 页 signOut 后弹模态）
- [ ] `setSignedIn()` 路径**不**调，避免登录成功后被弹模态
- [ ] `autoOpenIfEligible()` 用 `try/catch` 包裹，openModal 出错不影响主流程
- [ ] `autoOpenIfEligible()` 暴露为 public（`window.LUTSITE_AUTH_AUTO_OPEN` 不需要，body data attr 即合约）

## CSS
- [ ] 在 `_includes/components/auth-nav.html` 末尾 `<style>` 块内加 `.auth-nav-entry` 规则
- [ ] 视觉风格：display inline-block / vertical-align middle / 与菜单项字号一致 / 颜色与菜单文字一致 / 间距 12-16px
- [ ] hover 态：与菜单 hover 风格一致（如变色或下划线）
- [ ] 移动端（`<= 480px`）规则：不被截断、不影响汉堡菜单位置
- [ ] 与 `.auth-nav-signin.btn` / `.auth-nav-user` 视觉协调

## 验证
- [ ] `make build` 退出 0
- [ ] `_site/index.html`、`_site/lut-list/index.html`、`_site/blog/index.html` 顶导包含 `<a class="auth-nav-entry" href="/admin/submissions/">🔒 管理</a>`
- [ ] `_site/admin/submissions/index.html` 的 `<body>` 包含 `data-auth-auto-open="true"`
- [ ] `_site/contribute/index.html` / `_site/luts/.../index.html` 的 `<body>` **不**包含该属性
- [ ] 浏览器手测（需 staging `.env`）：
  - [ ] 公开页（`/`）点击「🔒 管理」→ 跳 `/admin/submissions/` → 模态自动弹出
  - [ ] 公开页（`/lut-list/`、`/blog/`）同样工作
  - [ ] 详情页（`/luts/:slug/`）未登录进入 → 不弹模态
  - [ ] `/contribute/` 未登录进入 → 不弹模态
  - [ ] `/admin/submissions/` 已登录 → 不弹模态、显示队列
  - [ ] 已登录访问任何页 → 「🔒 管理」+ 头像双入口并存
  - [ ] admin 布局中退出登录 → 模态弹出
  - [ ] contribute / lut 布局中退出登录 → 不弹模态
  - [ ] 移动端（`<= 480px`）「🔒 管理」可见、不被截断
  - [ ] 未配置 Supabase 时「🔒 管理」仍可见
- [ ] 回归：现有 admin-otp-login OTP 流程**完全不受影响**（6 位码、倒计时、错误码、退出、reload 持久化）
- [ ] 回归：`/lut-list/`、`/blog/`、详情页下载模态、对比滑块**完全不受影响**
- [ ] `git status` 确认只动了预期文件（`_includes/header.html` / `_layouts/base.html` / `_layouts/admin.html` / `assets/js/auth-nav.js` / `_includes/components/auth-nav.html`）

## 收尾
- [ ] `git diff` review，commit message 描述范围
- [ ] 推 PR，目标分支 `main`
- [ ] PR 标题：「Top nav: add always-visible 「🔒 管理」 entry to /admin/submissions/」
- [ ] PR body 列出范围、不变量、手测 checklist
- [ ] merge 后把 `openspec/changes/admin-nav-entry` 移到 `archive/admin-nav-entry-<date>/`
- [ ] 写 `close-issues.md` 记录 PR + 关闭内容
- [ ] 更新 `spec/requirements.md`、`spec/tasks.md`、`spec/devlog.md`
