# Design: LUT 详情页下载流程 + 浮动侧栏

## 概述
改造 `luts/:slug` 详情页的侧栏为可滚动后停留的浮动面板，移除无后端支撑的 Search 控件并替换为显著的 Download 入口。点击后弹出 Cloudflare Turnstile + 邮箱输入的模态框，提交时通过 `@supabase/supabase-js` 调用已部署的 Edge Function，由其向用户邮箱下发有时效的下载链接。Supabase 项目的 URL / anon key / Edge Function 名 / Turnstile site key 全部通过 `.env` → `build-config.sh` → `assets/js/supabase-config.js` 的方式构建时注入。

## 技术决策

### 1. 侧栏 sticky 实现
**选择：纯 CSS `position: sticky` + `top: 20px`**

- `.s-sidebar > .w` 加 `position: sticky; top: 20px;` 即可，零 JS、零回流。
- 触发点选择 20px 是因为现有顶部 header 占空间大概 50-80px，stuck 状态再下沉 20px 让 CTA 与主内容顶端基本齐平，视觉上更易触达。
- 移动端（`.col-xs-12`）不应用 sticky（侧栏已堆叠到主内容下方），加媒体查询限定 `@media (min-width: 992px)`。

> **不选 JS 监听 scroll** 的原因：原生 sticky 浏览器已高度优化，避免引入滚动事件竞争；JS 方案还要处理窗口尺寸、滚动节流、可访问性等多端差异。

### 2. Download 模态框
**选择：原生 HTML `<dialog>` 元素**

- 用 `dialog.showModal()` 打开，自带顶层渲染、ESC 拦截（与用户要求“只能点关闭按钮”一致——把 ESC 与点击遮罩都禁用即可）。
- 关闭只允许 `<form method="dialog">` 内嵌的关闭按钮 / 提交完成后的 `.close()` 调用，遮罩点击与 Esc 都 `event.preventDefault()` 拦截。
- 焦点管理：模态打开时聚焦到 email 输入；关闭时焦点回到原触发按钮（无障碍要求）。

> **不选自定义 div 模态** 的原因：原生 `<dialog>` 自动处理 ARIA 角色（role="dialog"）、焦点陷阱与 `::backdrop` 伪元素。

### 3. Turnstile 集成
**选择：data 属性 + 隐式渲染**

```html
<div class="cf-turnstile"
     data-sitekey="0x4AAA..."
     data-callback="onTurnstileSuccess"
     data-expired-callback="onTurnstileExpired"
     data-error-callback="onTurnstileError"></div>
```

- 提交按钮默认 disabled；Turnstile 回调 `onTurnstileSuccess(token)` 才解锁。
- 提交时把 `token` 一并 POST 到 Edge Function，由后端再调 `/siteverify` 验证。
- `data-expired-callback` 触发时清空隐藏 token、重新 `turnstile.reset()`。

> **不选显式 `turnstile.render()`** 的原因：data 属性版更声明式，与“少 JS 状态”的总体方向一致。

### 4. Supabase 调用
**选择：`@supabase/supabase-js` v2 + `functions.invoke`**

```js
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});
await supabase.functions.invoke(SUPABASE_EDGE_FUNCTION, {
  body: { lutId, email, turnstileToken }
});
```

- 库本身会处理 auth header、JSON 序列化、错误格式化。
- `persistSession: false` 因为是匿名调用，不需要把 session 写 localStorage。

### 5. API 契约（已与用户对齐）
- **Endpoint**: `POST ${SUPABASE_URL}/functions/v1/${SUPABASE_EDGE_FUNCTION}`
- **Headers**: `Authorization: Bearer ${SUPABASE_ANON_KEY}`（由 supabase-js 自动注入）
- **Body**:
  ```json
  { "lutId": "boost-shadow", "email": "user@example.com", "turnstileToken": "0.ABCD..." }
  ```
- **成功 200**:
  ```json
  { "ok": true, "message": "Download link sent" }
  ```
- **错误 4xx/5xx**:
  ```json
  { "error": "rate_limited|invalid_email|invalid_token|lut_not_found|internal",
    "message": "可选的英文描述" }
  ```
- 前端按 `error` code 映射到中文文案（rate_limited → "请求过于频繁" 等）。

### 6. 错误码到中文文案映射

| error code | 中文 |
|---|---|
| `invalid_email` | 邮箱格式不正确 |
| `invalid_token` | 人机验证失败，请重试 |
| `lut_not_found` | 该 LUT 暂未提供下载 |
| `rate_limited` | 请求过于频繁，请稍后再试 |
| `internal` | 服务器异常，请稍后重试 |
| 网络断开 / fetch reject | 网络异常，请检查连接 |

### 7. lutId 占位处理（已与用户对齐）
**选择：按钮始终可见，但 lutId 以 `TBD-` 开头时点击提示“该 LUT 暂未提供下载”**

- 渲染阶段不剔除按钮，保持视觉一致。
- 提交时 JS 检查 `lutId.startsWith('TBD-')` → 直接弹出提示文案，不发请求。
- 顺便在控制台 `console.warn` 一次提示作者回填。

### 8. 构建脚本
**选择：Makefile**

- 仓库目前是纯 Jekyll（无 package.json），引入 Node 工具链不合理。
- `Makefile` 在 macOS / Linux 自带，零依赖。
- 目标：
  - `make build` — 跑 `script/build-config.sh` + `bundle exec jekyll build`
  - `make serve` — 同上 + `--livereload`
  - `make clean` — 删 `_site/` 与生成的 `assets/js/supabase-config.js`

### 9. .env 解析脚本
**选择：纯 POSIX `sh` 解析（不用 jq / yq）**

- `script/build-config.sh` 用 `grep -E '^[A-Z_]+='` 逐行解析，写成一段 `window.LUTSITE_* = '...';`。
- 值含特殊字符时用 `sed "s/'/'\\\\''/g"` 转义单引号。
- `.env` 缺失时输出 `// .env missing` 注释 + `window.LUTSITE_* = 'TODO';`，让 `bundle exec jekyll build` 仍能跑、但前端 console 会醒目标红。

### 10. 文件结构
```
.env                              # gitignored，用户填真实值
.env.example                      # committed，占位 + 注释
Makefile                          # build / serve / clean
script/
  build-config.sh                 # 读 .env → 写 supabase-config.js
assets/js/
  supabase-config.js              # gitignored，build artifact
  lut-download.js                 # committed，模态/Turnstile/调用逻辑
_layouts/lut.html                 # 移除 Search，挂载 Download 按钮与 <script>
_includes/head-scripts.html       # 新建，CDN: supabase-js + turnstile
_luts/boost-shadow.md             # 加 lutId: TBD-boost-shadow
_luts/sun-shine.md                # 加 lutId: TBD-sun-shine
supabase/                         # 后端：Edge Function + 表结构（executing 阶段补全）
  functions/request-lut-download/
    index.ts                      # 单文件：CORS + Turnstile + Resend + 限流 + 审计
  migrations/*.sql                # luts + lut_download_requests
```

### 11. Edge Function 限流策略

**三条规则并存（OR 短路）：**

| 维度 | 窗口 | 上限 | 常量名 |
|------|------|------|--------|
| 邮箱 | `now() - 24 hours` | 5 次 | `RATE_LIMIT_EMAIL_PER_DAY` |
| 邮箱 | `now() - 1 hour`   | 3 次 | `RATE_LIMIT_EMAIL_PER_HOUR` |
| IP   | `now() - 1 hour`   | 10 次 | `RATE_LIMIT_IP_PER_HOUR` |

**关键选择：**

- **滚动窗口而非自然日**：实现一行差异（`'24 hours'` vs `'1 hour'`），与原有小时窗口逻辑完全统一；用户体验上「下一个名额什么时候解锁」预测性更好（24 小时后第一条命中记录退出窗口），不存在跨时区争议。
- **仅统计 `status='success'`**：审计表里同时有 `success` / `rate_limited` / `lut_not_found` / `email_failed` / `invalid_token` 多种状态，限流只看真正下发了链接的那一类；用户被限流后反复点击不会越点越限。
- **Fail-open**：任何一条限流计数查询返回 SQL 错误时，`console.error` + 视为「未触发」放过本次请求。基础设施异常时优先保用户体验，不让 Supabase 数据库抖动放大成整站不可用。
- **IP 缺失时降级**：CDN/代理失常导致请求未带 `x-forwarded-for` / `cf-connecting-ip` 时，IP 维度直接跳过，仅评估邮箱两条规则；不会因此把请求拒掉。
- **短路求值**：邮箱日限 → 邮箱时限 → IP 时限，任一命中立即返回 `rate_limited`，不浪费后续 SQL 往返。
- **前端文案不区分**：三条规则触发都返回同一 `rate_limited` 错误码，文案统一「请求过于频繁，请稍后再试」；避免泄露具体的策略阈值（防探测）。

**调整阈值**：改 `supabase/functions/request-lut-download/index.ts` 顶部常量后 `supabase functions deploy request-lut-download` 即生效，不涉及 schema 变更。

## 详细设计

### 侧栏 sticky 行为
- `.s-sidebar > .w { position: sticky; top: 20px; max-height: calc(100vh - 40px); overflow-y: auto; }`
- 仅在 `@media (min-width: 992px)` 生效（侧栏在桌面端才与主内容并排）。
- 滚动到 sidebar 自然顶部的 0px 即开始 sticky 跟随，**实际呈现就是“到顶 20px 后停住”**——比原 proposal 的 50px 更早触发。

### Download 模态框
- 结构：
  ```html
  <dialog id="lut-download-modal" class="lut-modal">
    <form method="dialog">
      <header>
        <h3>下载 {{ page.title }}</h3>
        <button type="submit" class="lut-modal-close" aria-label="关闭">×</button>
      </header>
      <label>
        邮箱地址
        <input type="email" name="email" required placeholder="you@example.com">
      </label>
      <div class="cf-turnstile" data-sitekey="..." ...></div>
      <button type="button" id="lut-submit" disabled>发送到我的邮箱</button>
      <div class="lut-modal-status" hidden></div>
    </form>
  </dialog>
  ```
- 关闭拦截：`dialog.addEventListener('cancel', e => e.preventDefault())` 屏蔽 Esc；`dialog.addEventListener('click', e => { if (e.target === dialog) e.preventDefault() })` 屏蔽点击遮罩。
- 提交状态机：`idle` → `submitting` → (`success` | `error`)。
  - `submitting`：按钮 disabled + 文案 “发送中…”。
  - `success`：status div 显示 “已发送到 <email>”，按钮变 “完成”，3 秒后自动 `dialog.close()`，用户也可立即点关闭。
  - `error`：status div 显示中文错误，按钮恢复 “重试”，Turnstile 重新 `reset()`。

### 响应文案分发
按 error code 显示：
- `success`：`已发送到 <email>，请在邮件中点击下载链接（链接 30 分钟内有效）。`
- `invalid_email`：`邮箱格式不正确，请检查后重试。`
- `invalid_token`：`人机验证失败，请刷新后重试。`
- `lut_not_found`：`该 LUT 暂未提供下载。`
- `rate_limited`：`请求过于频繁，请稍后再试。`
- `internal` / 其他：`服务器异常，请稍后重试。`
- 网络断开：`网络异常，请检查连接。`

### CDN 引入
- `_includes/head-scripts.html`：
  ```html
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  ```
- 在 `lut.html` 的 `<head>` 引入该 include。
- 两个脚本都是异步、defer，不阻塞页面渲染。

## 风险与应对

| 风险 | 应对 |
|---|---|
| Turnstile site key 未配置（`.env` 缺失）时人机验证小部件不渲染 | `lut-download.js` 检测 `window.LUTSITE_TURNSTILE_SITE_KEY` 是否以 `0x` 开头，否则 modal 顶部红字提示“人机验证未配置”并 disable 提交按钮 |
| 用户长时间停留在 modal 中，token 过期 | `data-expired-callback` 触发 → 隐藏 submit 按钮 + Turnstile.reset() |
| Edge Function 改响应格式 | 失败响应统一落到 “服务器异常” 文案；同时 README/CLAUDE.md 写明契约 |
| `.env` 不小心 commit | `.gitignore` 已忽略；同时 CI 跑 `! git ls-files .env \| grep -q .` 失败即报错（**本次不实现，仅在 design 中点出**） |
| CDN 被墙 | supabase-js 与 turnstile 国内可达性已知良好；若仍出问题，fallback 走国内 CDN（未来再处理）|
| 侧栏内容高度超过视口 | `max-height: calc(100vh - 40px); overflow-y: auto;` 让 sidebar 自身可滚 |

## 不在范围
- lutId 真实值回填脚本（用户后续手动跑）
- 邮件模板的 i18n / 多版本（当前只发中文模板）
- 国际化（中英文版本切换）
- Supabase Dashboard 操作（Storage bucket 创建、Resend 域名验证、Turnstile site 配置）— 由用户按 `supabase/README.md` 步骤手动完成
