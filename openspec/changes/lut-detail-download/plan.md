# Implementation Plan: LUT 详情页下载流程 + 浮动侧栏

## Prerequisites
- [x] 确认 Jekyll 仍可用：`bundle exec jekyll --version`
- [x] 当前在 main 分支或新建 `feature/lut-detail-download` 分支
- [x] 工作树干净（`git status` 无未提交变更）

## 构建配置（前置）
- [x] 新建 `.env.example`（committed）：含 `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_EDGE_FUNCTION` / `TURNSTILE_SITE_KEY` 四个占位 + 注释
- [x] 更新 `.gitignore`：忽略 `.env` 与 `assets/js/supabase-config.js`
- [x] 新建 `script/build-config.sh`（POSIX sh）：
  - [x] 解析 `.env` 中的四个变量
  - [x] 写入 `assets/js/supabase-config.js`，每行 `window.LUTSITE_* = '...';`
  - [x] 缺失 `.env` 时每个变量降级为 `'TODO'`
  - [x] `chmod +x` 脚本
- [x] 新建 `Makefile`：
  - [x] `build` 目标：先跑 `script/build-config.sh` 再 `bundle exec jekyll build`
  - [x] `serve` 目标：先跑脚本再 `bundle exec jekyll serve --livereload`
  - [x] `clean` 目标：删除 `_site/` 与 `assets/js/supabase-config.js`

## 资源（CDN 引入）
- [x] 新建 `_includes/head-scripts.html`：
  - [x] 引入 `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`（defer）
  - [x] 引入 `https://challenges.cloudflare.com/turnstile/v0/api.js`（async defer）

## 详情页布局
- [x] 修改 `_layouts/lut.html`：
  - [x] 在 `<head>` 之前 / 合适位置 `{% include head-scripts.html %}`
  - [x] 移除 `#search-3` widget
  - [x] 在 widget 区首位新增 `<button class="lut-download-trigger">` + 隐藏的 `data-lut-id="{{ page.lutId }}"`
  - [x] 在 `</main>` 之前 / 之后新增 `<dialog id="lut-download-modal">` 结构（含 form、email 输入、Turnstile 占位、提交按钮、状态区、关闭按钮）
  - [x] 引入 `assets/js/lut-download.js` 脚本
  - [x] 在底部 `<style>` 中新增侧栏 sticky 规则（仅 `@media (min-width: 992px)`）

## 样式
- [x] 在 `lut.html` 的 `<style>` 块新增：
  - [x] `.s-sidebar > .w { position: sticky; top: 20px; max-height: calc(100vh - 40px); overflow-y: auto; }`（媒体查询内）
  - [x] `.lut-download-trigger` 主按钮样式（高对比背景、大号 padding、圆角、hover 动效）
  - [x] `.lut-modal` 居中、宽度限制、padding、配色
  - [x] `.lut-modal::backdrop` 遮罩半透明黑
  - [x] `.lut-modal-status` 成功/错误两套配色
  - [x] `.lut-modal-error-banner` Turnstile 未配置的红字提示

## 前端逻辑
- [x] 新建 `assets/js/lut-download.js`（IIFE 隔离作用域）：
  - [x] 读 `window.LUTSITE_*` 常量，缺/格式错时把 `lutIdPlaceholder = true` 标记
  - [x] 绑定 `.lut-download-trigger` click → 打开 `<dialog>`、聚焦 email、渲染 Turnstile
  - [x] Turnstile 回调 `onTurnstileSuccess(token)` → 启用 submit
  - [x] Turnstile `data-expired-callback` → 禁用 submit + `turnstile.reset()`
  - [x] submit click → 状态机 `submitting` → 调 `supabase.functions.invoke(...)` → 根据响应进入 `success` / `error`
  - [x] 成功时显示文案、3s 自动 close、允许 × 立即 close
  - [x] 错误时按 error code 映射中文文案、submit 恢复 “重试”、Turnstile reset
  - [x] 拦截 Esc / 遮罩 click（`dialog.addEventListener('cancel'/'click', e => e.preventDefault())`）
  - [x] lutId 以 `TBD-` 开头时，submit 不发请求，直接显示 “该 LUT 暂未提供下载”，并 `console.warn` 一次

## Markdown
- [x] 修改 `_luts/boost-shadow.md`：front matter 加 `lutId: TBD-boost-shadow`
- [x] 修改 `_luts/sun-shine.md`：front matter 加 `lutId: TBD-sun-shine`

## 验证
- [x] `make build` 退出码 0，无 Liquid 警告
- [x] `.env` 缺失时 `assets/js/supabase-config.js` 含四个 `'TODO'`
- [x] 构建产物含 `data-lut-id="TBD-boost-shadow"` / `TBD-sun-shine`、Search widget 已移除、Sticky CSS 和 CDN 脚本均到位
- [x] `/lut-list/`、`/blog/`、`/blog/<slug>.html` 构建正常（非详情页未受影响）
- [ ] 浏览器手测：桌面端 sticky / 移动端不 sticky / 模态 open-close / Turnstile / TBD- 拦截（需配置真实 `.env`）
- [ ] GitHub Pages CI（push 后）通过
- [ ] 提交前 `git status` 确认只动了预期文件（`.env` 与 `supabase-config.js` 应被忽略）

> **说明**：浏览器交互（Turnstile 渲染、真实 Supabase 调用）需要在配置好 `.env` 后由用户在本地或线上手测；自动化层面已通过构建产物验证 markup / CSS / 脚本引用、TBD 占位、回归页未受影响。

---

## Amend: 邮箱每日限流（2026-06-10）

**触发**：用户在 executing 阶段提出新需求「每天只能下载 5 次」。
**决策**：邮箱维度叠加每日 5 次（滚动 24h），保留原有 3 次/小时；IP 不动；触发后统一返回 `rate_limited`。
**详细规范**：见 `spec.md` 的 “Edge Function 限流策略” Requirement，以及 `design.md` 第 11 节。

### 代码改动
- [x] `supabase/functions/request-lut-download/index.ts`
  - [x] 顶部新增常量 `RATE_LIMIT_EMAIL_PER_DAY = 5`
  - [x] `isRateLimited()` 内新增一段 24h 窗口邮箱计数查询，命中即 `return true`
  - [x] 三条规则按 `邮箱日 → 邮箱时 → IP 时` 的顺序短路求值
  - [x] 24h 窗口查询失败时同样 fail-open（与现有两条一致）

### 文档同步
- [x] `supabase/README.md` 的「限流默认」一行改为「单邮箱 5 次/24h 且 3 次/小时；单 IP 10 次/小时」
- [x] `supabase/README.md` 在「调整阈值」处指明三个常量名，方便后续调参

### 验证
- [x] 人工 review `index.ts`：常量正确、查询 since 计算正确、`status='success'` 过滤未漏
- [x] 函数签名 / 类型：`isRateLimited` 仍返回 `Promise<boolean>`，无新增参数
- [x] 前端无需改动（错误码 `rate_limited` 已映射「请求过于频繁，请稍后再试」）
- [x] 数据库无需迁移（`lut_download_requests_email_created_at_idx` 同时服务 1h 与 24h 查询）

---

## Amend: Edge Function 改为单文件（2026-06-10）

**触发**：用户要求 functions 写单文件，避免 `_shared/` 跨目录相对路径带来的部署/分发摩擦。
**决策**：把 `_shared/cors.ts` / `_shared/turnstile.ts` / `_shared/email.ts` 全部合并进 `request-lut-download/index.ts`，删除 `_shared/` 目录。纯重构，不改任何行为。

### 改动
- [x] `supabase/functions/request-lut-download/index.ts` 重写为单文件，分块（Constants / Types / Main handler / CORS / Turnstile / Email / Internal helpers）
- [x] `rm -rf supabase/functions/_shared/`
- [x] `supabase/README.md` 顶部目录树更新
- [x] `design.md` 第 10 节文件结构同步
