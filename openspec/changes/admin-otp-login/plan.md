# Implementation Plan: admin OTP 登录

## Prerequisites
- [x] 已有活跃变更 `admin-otp-login`，proposal + spec 已 review
- [x] 当前分支 `feature/admin-otp-login`，工作树干净
- [x] 确认 Supabase 项目 OTP 功能已开启（默认开启；`supabase/config.toml` 里 `[auth.email.enabled] = true`）

## 准备
- [ ] 读现有 `_includes/components/auth-nav.html` 全部 IIFE（约 150 行），把要保留的逻辑（signOut / onAuthStateChange / 头像渲染 / dropdown）拆出来
- [ ] 读 `_includes/head-scripts.html` 确认 supabase-js v2 defer 加载，无变化
- [ ] 读 `_layouts/base.html` 找 `{% include components/auth-nav.html %}` 插入点，规划 `<script src=auth-nav.js>` 的位置

## 资产迁移：HTML → 独立 JS
- [ ] 新建 `assets/js/auth-nav.js`：把 IIFE 从 `auth-nav.html` 末尾 `<script>` 移到独立文件
- [ ] HTML 只保留 markup（按钮 / 模态 / 表单字段），删去 `<script>` 块
- [ ] 在 `auth-nav.html` 末尾用 `<script src="{{ site.baseurl }}/assets/js/auth-nav.js" defer></script>` 引用
- [ ] `defer` 保证在 `supabase-config.js` + supabase-js 之后执行

## HTML 重构
- [ ] 模态标题改：保持「登录」（不再写「登录 / 注册」）
- [ ] 帮助文案改：输入邮箱，我们会发一封 6 位数字验证码
- [ ] 表单分两段：
  - `.auth-nav-step-email`（默认显示）
  - `.auth-nav-step-code`（默认 `hidden`，发码后切出）
- [ ] 邮箱页：保留 email input + 发送按钮
- [ ] 验证码页：6 个 `<input type="text" inputmode="numeric" maxlength="1" pattern="[0-9]*">` + 「重新发送 (60)」「换一个邮箱」链接
- [ ] 验证码页底部加倒计时 / 重新发送按钮
- [ ] 模态消息 `.auth-nav-modal-msg` 文案统一，错误/成功 class 复用

## JS 状态机
- [ ] `state.step = 'idle' | 'email-sent' | 'code-entered' | 'verifying'`
- [ ] `state.email` 暂存
- [ ] `state.cooldown = 0` 倒计时剩余秒数
- [ ] 邮箱页 submit handler：
  - 校验 email 非空 + 格式
  - `client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`
  - 成功 → 切到验证码页、启动 60s 倒计时
  - 失败 → 模态消息区显示错误
- [ ] 验证码页 6 个 input 联动：
  - 输入数字 → 自动 focus 下一个
  - 退格到空 → focus 上一个
  - 黏贴 6 位 → 拆分填入
  - 6 位填满 → 自动触发 verify
- [ ] verify handler：
  - 拼接 6 位 → `client.auth.verifyOtp({ email, token, type: 'email' })`
  - 成功 → 关模态、`refresh()`、`state` 重置
  - 失败 → 错误码 → 中文映射 → 清空 6 个 input、focus 第 1 个
  - 网络异常 → 保留输入
- [ ] 倒计时：
  - `setInterval` 1 秒、显示「重新发送 (Ns)」
  - 0 秒后按钮启用、文案改「重新发送」
  - 点击重新发送 → 重发码、重置 60s
- [ ] 「换一个邮箱」→ 回到邮箱页、`state.email` 保留以便用户修改

## Supabase client 配置
- [ ] `createClient` 时 `detectSessionInUrl: false`（OTP 不需要 URL hash）
- [ ] 保留 `persistSession: true, autoRefreshToken: true`

## 错误码 → 文案
- [ ] 定义 `ERROR_MESSAGES` 常量
- [ ] `otp_expired` → 「验证码已过期，请重新发送」
- [ ] `token_invalid` / 401 / `403` → 「验证码不正确」
- [ ] `email_rate_limit_exceeded` → 「请求过于频繁，请稍后再试」
- [ ] 其他 / `fetch` 抛错 → 「网络异常，请重试」

## 样式
- [ ] 6 个 input 横向排列、`flex` + 固定宽度（如 40px）、居中对齐
- [ ] input 边框、聚焦态（沿用原 `.auth-nav-modal-card input` 风格）
- [ ] 倒计时按钮 disabled 态
- [ ] 移动端：input 宽度自适应

## 验证
- [ ] `make build` 退出 0
- [ ] `_site/assets/js/auth-nav.js` 与 `_site/_includes/components/auth-nav.html` 都生成
- [ ] `_site/index.html` 等页面同时引用 supabase-config.js + auth-nav.js
- [ ] 浏览器手测（需配置真实 `.env`）：
  - [ ] 输入未注册邮箱 → 收到 Supabase 创建用户 + 发码邮件
  - [ ] 输对 6 位 → 头像显示
  - [ ] 输错 → 错误码文案、清空、可重输
  - [ ] 倒计时 60s 内点不动「重新发送」、60s 后可点
  - [ ] 点「换一个邮箱」→ 回到邮箱页、上次值保留
  - [ ] 登录后访问 `/admin/submissions/` → pending tab 正常加载
  - [ ] 登录后访问 `/contribute/` → 「直接发布」toggle 显示
  - [ ] 退出 → 头像消失、登录按钮回来
  - [ ] 顶导 reload 仍保持登录态
  - [ ] 移动端：6 个 input 不溢出、键盘弹数字键盘
- [ ] 回归：`/lut-list/`、`/blog/`、详情页下载模态、对比滑块**完全不受影响**
- [ ] `git status` 确认只动了预期文件（`auth-nav.html` / `auth-nav.js` 新建；其它 0 改动）

## 收尾
- [ ] `git diff` review，commit message 描述范围（HTML / JS / 配置 三处）
- [ ] 推 PR，目标分支 `main`
- [ ] PR 标题：「Admin OTP login: switch from magic link to 6-digit code」
- [ ] PR body 列出范围、不变量、手测 checklist
- [ ] merge 后把 `openspec/changes/admin-otp-login` 移到 `openspec/changes/archive/admin-otp-login-<date>/`
- [ ] 写 `close-issues.md` 记录 PR + 关闭内容
- [ ] 更新 `spec/requirements.md`、`spec/tasks.md`、`spec/devlog.md`
