# Proposal: admin OTP 登录

## 需求

把 admin 登录从「magic link（邮件链接）」切换为「OTP code（邮件 6 位数字）」。目的是让 admin 在同一台设备完成登录——点击 magic link 邮件、跳回原页面的链路在桌面端体验笨拙；OTP 输 6 位数字更直接，也更接近常见 SaaS 习惯。

## 现状

- admin 用 Supabase Auth 的 `signInWithOtp({ emailRedirectTo })` 发 magic link
- 顶导 `_includes/components/auth-nav.html` 单步表单：填邮箱 → 收邮件 → 点链接
- 登录产物（access_token / refresh_token / JWT）通过 `detectSessionInUrl: true` 从 URL hash 解析
- 登录后能力：访问 `/admin/submissions/` 审批队列；`/contribute/` 显示「直接发布」勾选
- admin 角色在 `public.users.role` 表中（admin / user）

## 目标行为

- 顶导登录流程改为**两步表单**：
  1. 填邮箱 → 收 6 位数字邮件 → 自动切到验证码输入
  2. 输 6 位数字 → 调 `verifyOtp({ email, token, type: 'email' })` → 登录成功，关闭模态
- 倒计时「重新发送」（60 秒）+ 「改邮箱」返回上一步
- 输错提示，明确区分「验证码错误」「已过期」「网络异常」

## 范围

### 改

- `_includes/components/auth-nav.html`
  - 表单 UI：邮箱 + 验证码两段切换
  - 调 `signInWithOtp({ shouldCreateUser: false })`（不带 `emailRedirectTo`）——Supabase Auth v2 默认发 OTP code
  - 调 `verifyOtp({ email, token, type: 'email' })` 验码
  - `createClient` 时 `detectSessionInUrl: false`（OTP 模式不需要从 URL hash 读 session）
- `assets/js/auth-nav.js`（如果决定把 IIFE 从 HTML 抽出到独立文件；详见下）
- `_includes/head-scripts.html`：确认 supabase-js v2 仍 defer 加载，无变化

### 不改

- `submit-lut` / `moderate-submission` Edge Function 不动——它们收的是 `Authorization: Bearer <jwt>`，OTP / magic link 产物一致
- `assets/js/contribute.js` 读 session 的逻辑不动
- `assets/js/admin-submissions.js` 读 session 的逻辑不动
- 投稿表单 / 审批抽屉 UI 不动
- 公开端（详情页下载、列表、博客、对比滑块）**完全不动**
- `lut-contribution` 归档目录、`configurable-menu` proposal 状态不动
- `_luts/*.md` 的 `lutId` 不动

### 决策点（写 proposal 时未定）

下面这几条 spec 阶段再敲定，本提案先列出来：

1. **是否拆 `auth-nav.js`**：当前 IIFE 写在 HTML 末尾的 `<script>` 里（约 150 行）。两段切换 + 倒计时后预计涨到 220 行。spec 阶段决定拆 / 不拆。
2. **重发倒计时长度**：默认 60 秒，行业常见 30 / 60，spec 阶段定。
3. **未注册邮箱的反馈**：Supabase `signInWithOtp({ shouldCreateUser: false })` 不发邮件（不创建用户）。要 UX 友好——但又要避免泄露「邮箱是否已注册」给攻击者。spec 阶段定文案。
4. **错误码映射**：Supabase `verifyOtp` 失败返回 `error.code` 可能是 `otp_expired` / `token_invalid` 等。spec 阶段定中文文案。
5. **验证码输入 UI**：6 个独立小框（mobile 友好）/ 单一输入框（实现简单）/ 单一输入框自动跳格（折中）。spec 阶段定。

## 成功标准

- admin 在桌面端 1 分钟内完成登录（输邮箱 → 收 6 位 → 输码 → 进审批页）
- 输错 3 次验证码不锁账户（Supabase 默认不限次，OTP 5 分钟过期）
- 重新发送倒计时生效，60 秒内点不动
- magic link 时代已经过期的 session 在新模式下仍能用（JWT 通用）
- 未配置 Supabase 时（`.env` 缺失）整个 widget 隐藏，与现状一致
- 构建产物无报错，桌面/移动端浏览器手测通过
- 审批 / 投稿 / 下载三条已有流程不受影响

## 关联

- `lut-contribution`（已归档）admin 登录路径——本变更是其登录 UX 升级，**不引入新功能**
- `lut-detail-download`（已归档）公开端不登录，**完全无关**
- `configurable-menu`（活跃 proposal）首页配置，**完全无关**

## 风险

- **「不创建用户」=未注册邮箱无反馈**：当前 magic link 模式下 Supabase 同样不发；本变更继承此行为。攻击者无法通过「是否收信」来枚举邮箱，反而是安全特性。**仅 UX 风险，非安全风险**。
- **多设备登录**：现有 session 持久化在 localStorage。OTP 在设备 A 登录，session 写入 A；设备 B 不受影响。行为与 magic link 一致。
- **session 过期**：admin 长期不操作后 session 过期，刷新页面会回到登录态。**行为不变**。
- **「直接发布」toggle 依赖 session**：切换登录方式不影响 toggle 显隐逻辑（已 review 现有 `refreshAdmin`）。

## 不做

- ❌ 普通用户登录（仅 admin）
- ❌ 密码登录（Supabase 仍支持，但本变更不做）
- ❌ 社交登录（Google / GitHub / 等）
- ❌ 双因素认证（2FA）
- ❌ 改 Edge Function
- ❌ 改投稿 / 审批 UI
- ❌ 改 `users` 表 schema
- ❌ 把登录入口放到独立页面（仍在顶导模态里）
