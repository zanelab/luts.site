# Close: admin-nav-entry

**PR**: https://github.com/zanelab/luts.site/pull/8
**Merged**: pending
**Date**: 2026-06-11

## 关闭内容

- ✅ 顶导加「🔒 管理」文字链接（所有页面始终可见，公开页零额外 JS 开销）
- ✅ 链接 href = `/admin/submissions/`，点击跳转
- ✅ base.html 在 `page.layout == 'admin'` 时输出 `data-auth-auto-open="true"`
- ✅ auth-nav.js 新增 `autoOpenIfEligible()`，admin 布局无 session 时自动弹模态
- ✅ contribute / lut 布局不弹模态（投稿匿名、详情页与登录无关）
- ✅ admin 布局中退出登录 → 模态弹出引导重新登录
- ✅ contribute / lut 布局中退出登录 → 不弹模态
- ✅ `.auth-nav-entry` CSS：discreet 风格、hover 下划线、focus-visible 描边

## 设计决策与机制说明

**原计划**：`_layouts/admin.html` front matter 加 `body_data: data-auth-auto-open="true"`，base.html 用 `{% if page.body_data %}` 渲染。

**实际采用**：base.html 直接用 `{% if page.layout == 'admin' %}` 判定。原因：Jekyll 嵌套 layout 的 front matter 不向父 layout 传播（base.html 是 admin.html 的父 layout，admin.html 的 front matter 在 base.html 模板里不可见），用 layout 名作为合约更直接，也无需在 admin.html 上加冗余字段。spec.md 与 plan.md 同步更新。

## 不变量（已验证）

- `admin-otp-login` OTP 流程**完全不动**（6 位码、60s 倒计时、错误码映射、auto-advance、黏贴拆分、session 持久化）
- 公开页 `base.html` 不加载 supabase-config / supabase-js CDN 的设计**不变**
- Edge Function JWT、role 加载行为**不变**
- 公开端（`/lut-list/`、`/blog/`、详情页下载、对比滑块）**完全不动**

## 留给 staging 手测

10 项浏览器手测已在 PR body 列出，部署到 staging 后由 admin 执行。

## 关联

- **本变更是 admin-otp-login 的 UX 补充**：OT-OTP 让 admin 在登录页能完成登录，本变更让 admin 在任何页面都能找到登录入口
- **本变更不影响**：所有其他公开端 / 投稿 / 审批 / 下载流程
