# Close: admin-otp-login

**PR**: https://github.com/zanelab/luts.site/pull/7
**Merged**: pending
**Date**: 2026-06-11

## 关闭内容

- ✅ Magic link → 6 位数字 OTP code（同一台设备完成登录）
- ✅ `assets/js/auth-nav.js` 拆分（与 `contribute.js` / `admin-submissions.js` 一致）
- ✅ `_includes/components/auth-nav.html` 改为 markup only，无 inline IIFE
- ✅ `shouldCreateUser: true` 兼容首次登录（新邮箱自动注册）
- ✅ 60 秒重发倒计时
- ✅ 6 个独立小框 + auto-advance / Backspace 回跳 / 黏贴 6 位拆分
- ✅ 错误码 → 中文映射（`otp_expired` / `token_invalid` / `email_rate_limit_exceeded` / 网络异常）
- ✅ `detectSessionInUrl: false`（URL hash 不再带 session）
- ✅ 保留 fallback：未配置 Supabase 时整个 `.auth-nav` 节点隐藏

## 不变量（已验证）

- Edge Function `submit-lut` / `moderate-submission` 行为不变（同一 JWT）
- `contribute.js` / `admin-submissions.js` 读 session 的逻辑、role 加载行为不变
- `/admin/submissions/` 审批抽屉 UI、approve / reject 流程不变
- 公开端（`/lut-list/`、`/blog/`、详情页下载模态、对比滑块）**完全不动**
- `users` 表 schema、admin 角色提升 SQL 不变

## 留给 staging 手测

10 项浏览器手测已在 PR body 列出，部署到 staging 后由 admin 执行。

## 关联

- **取代**：`lut-contribution`（已归档）admin 登录用 magic link，本变更是其 UX 升级
- **不影响**：`lut-detail-download` / `blog-list-detail`（公开端） / `configurable-menu`（首页）
