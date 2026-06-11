# Spec: admin OTP 登录

> 取代 magic link，admin 在同一台设备完成登录。

## 已敲定决策

| 决策 | 选择 | 备注 |
|------|------|------|
| JS 拆分 | 拆到 `assets/js/auth-nav.js` | 与 `contribute.js` / `admin-submissions.js` 一致 |
| 重发倒计时 | 60 秒 | Supabase 默认推荐 |
| 新邮箱 | `shouldCreateUser: true` | 无注册概念，首次登录即开通 |
| 错误码 | 一对一映射 | `otp_expired` / `token_invalid` / `email_rate_limit_exceeded` / 其他 |
| 验证码 UI | 6 个独立小框 | mobile 友好、自动跳格、退格回跳 |

## MODIFIED Requirements

### Requirement: admin 登录方式从 magic link 改为 OTP code

顶导登录模态改为**两步流程**：
1. 邮箱页：填邮箱 → 调 `signInWithOtp({ shouldCreateUser: true })` → 切到验证码页
2. 验证码页：6 个独立数字输入框 → 调 `verifyOtp({ email, token, type: 'email' })` → 登录成功关模态

#### Scenario: 首次登录（新邮箱自动注册）
- Given 顶导显示「登录」按钮、admin 未登录
- When 点击「登录」→ 模态弹出 → 填 `new-admin@example.com` → 点「发送验证码」
- Then Supabase 创建该用户、发送 6 位数字邮件
- And 模态切到验证码页，倒计时 60 秒后「重新发送」按钮启用
- And 提示文案「验证码已发送到 new-admin@example.com」

#### Scenario: 输对 6 位数字登录成功
- Given 验证码页、邮箱已收 6 位数字
- When 用户逐位输入数字、自动跳格
- And 输完第 6 位 → 调 `verifyOtp({ email, token: '123456', type: 'email' })`
- Then 模态关闭、顶导切换为头像 + 邮箱首字母
- And `localStorage` 持久化 session、`onAuthStateChange` 触发 `refresh()`

#### Scenario: 验证码错误
- Given 验证码页、用户输入错误数字
- When 6 位填满 → 调 `verifyOtp` → Supabase 返回 `error.code = 'otp_expired'` 或 `'token_invalid'`
- Then 验证码页底部显示「验证码已过期，请重新发送」或「验证码不正确」
- And 6 个输入框清空、聚焦第 1 个
- And 倒计时正常进行，不重置

#### Scenario: 网络异常
- Given 验证码页、用户点「登录」时网络断开
- When `verifyOtp` 抛出 / fetch 失败
- Then 验证码页底部显示「网络异常，请重试」
- And 已输入的 6 位数字保留（不清空）

#### Scenario: 60 秒内反复点「重新发送」
- Given 验证码页、倒计时进行中
- When 用户点「重新发送」按钮
- Then 按钮在 `disabled` 状态，60 秒后启用
- And 倒计时显示「59 秒后重新发送」→ ... → 「重新发送」

#### Scenario: 切回邮箱页
- Given 验证码页
- When 点「换一个邮箱」链接
- Then 回到邮箱页、邮箱输入框保留上次值（不清空）、验证码状态不持久

#### Scenario: Supabase 未配置
- Given `.env` 缺失或 `LUTSITE_SUPABASE_URL` 为 `'TODO'`
- When 顶导加载
- Then 整个 `.auth-nav` 节点隐藏（不显示登录按钮），与现状一致

#### Scenario: 顶导加载时已登录
- Given `localStorage` 有有效 session
- When 顶导脚本执行 `refresh()`
- Then 直接显示头像 + 邮箱首字母、不弹出模态
- And `users.role === 'admin'` 时头像下拉显示「⚙ 审批」入口

### Requirement: 不再从 URL hash 解析 session

由于 OTP code 在表单内 verify，不再需要 Supabase 在 `detectSessionInUrl: true` 时从 URL fragment 读 session。

#### Scenario: 移除 URL hash 处理
- Given 登录成功
- When 模态关闭
- Then `window.location.hash` 不被 Supabase 修改
- And `client.auth` 创建时 `detectSessionInUrl: false`

### Requirement: 错误码 → 中文提示

| 错误码 | 中文 |
|--------|------|
| `otp_expired` | 验证码已过期，请重新发送 |
| `token_invalid` / 401 | 验证码不正确 |
| `email_rate_limit_exceeded` | 请求过于频繁，请稍后再试 |
| 其他 / 异常 | 验证失败，请重试 |
| `fetch` 抛错 | 网络异常，请重试 |

#### Scenario: 错误码映射生效
- Given 验证码页
- When Supabase 返回 `error.code`
- Then 模态底部文案按上表映射
- And 错误样式：`.auth-nav-modal-msg.error`（红色）

## 不变

- `submit-lut` / `moderate-submission` Edge Function 收 `Authorization: Bearer <jwt>`，OTP / magic link 产物一致
- `assets/js/contribute.js` 读 session 的逻辑、`refreshAdmin()`、`direct_publish` toggle 行为不变
- `assets/js/admin-submissions.js` 读 session 的逻辑、`loadRole` 行为不变
- `/admin/submissions/` 审批抽屉 UI、approve / reject 流程不变
- 公开端详情页下载 / 列表 / 博客 / 对比滑块不动
- `users` 表 schema、admin 角色提升 SQL 不变

## 数据流

```
用户                          auth-nav.js                          Supabase Auth
 │                                │                                     │
 │ ① 填邮箱                       │                                     │
 ├───────────────────────────────▶│                                     │
 │                                │ ② signInWithOtp({ shouldCreateUser: true })
 │                                ├────────────────────────────────────▶│
 │                                │ ◀── { data: {}, error: null } ──────┤
 │ ③ 切到验证码页                  │                                     │
 │ ◀──────────────────────────────┤                                     │
 │                                │                                     │
 │ ④ 输 6 位                       │                                     │
 ├───────────────────────────────▶│ ⑤ verifyOtp({ email, token, type: 'email' })
 │                                ├────────────────────────────────────▶│
 │                                │ ◀── { data: { session, user }, error } ─┤
 │ ⑥ 关闭模态, 显示头像            │                                     │
 │ ◀──────────────────────────────┤                                     │
 │                                │ onAuthStateChange → refresh()         │
 │                                │ → loadRole(userId) → users.role       │
```

## 关联变更

- **本变更取代**：`lut-contribution`（已归档）admin 登录用 magic link，本变更是其 UX 升级
- **本变更不影响**：`lut-detail-download` / `blog-list-detail`（公开端） / `configurable-menu`（首页）
