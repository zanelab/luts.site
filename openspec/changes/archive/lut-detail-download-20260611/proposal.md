# Proposal: LUT 详情页下载流程 + 浮动侧栏

## What
改造 `luts/:slug` 详情页的侧栏（Sidebar），从静态布局变为可滚动后停留的浮动面板，并把无用的 Search 控件替换为显著的 Download 入口。点击 Download 弹出邮箱输入模态框，提交后调用已部署的 Supabase Edge Function 发起一次“有时效下载链接”的邮件下发。

每个 LUT 的 Markdown front matter 增加 `lutId` 字段，作为 Edge Function 查询 Supabase 表的关键字（值后续从表里查询后回填到 markdown，本次提交先以占位值上线）。

## Why
- **提高下载转化**：把核心 CTA “下载 LUT” 放在用户任何滚动位置都能看到的位置（sticky 侧栏顶部）。
- **去除噪音**：当前 Search 表单实际并不存在后端支撑，移除后侧栏空间更纯净。
- **追踪与限流**：经 Edge Function 转发下载，运营可对请求计数、限制频率、按邮件渠道留存；纯静态 `<a download>` 做不到。
- **数据闭环**：lutId 把静态站资源 ↔ Supabase 表行关联起来，将来可以做浏览/下载看板、A/B、新 LUT 推送邮件等。

## Scope
- [x] frontend
- [ ] backend（Supabase Edge Function 与表已存在，仅消费其 API）

## Acceptance Criteria
- [ ] 侧栏滚动到距顶部 ≤ 20px 时开始 sticky 跟随（提前触发，CTA 更易触达）
- [ ] 侧栏搜索框（`#search-3` widget）已从 `lut.html` 移除
- [ ] 搜索框原位置渲染明显的 Download 按钮（视觉权重高于侧栏其他 widget）
- [ ] 点击 Download 弹出模态框，包含 email 输入 + Cloudflare Turnstile 人机验证 + “发送到我的邮箱” 主按钮
- [ ] 人机验证未通过时禁止提交
- [ ] 模态框提交后调用 Supabase Edge Function（URL 与 anon key 通过 `.env` 构建时注入），请求体为 `{ lutId, email, turnstile_token }`
- [ ] 成功时显示 “已发送到 <email>” 反馈，3 秒后自动关闭；用户可点关闭按钮立即关闭
- [ ] 失败（网络/4xx/5xx）显示具体错误文案
- [ ] `_luts/boost-shadow.md` 与 `_luts/sun-shine.md` 增加 `lutId: <占位值>` 字段（占位以 `TBD-` 前缀标识等待回填）
- [ ] 详情页其他功能（对比滑块、tags、prev/next、近期 LUT）回归无影响
- [ ] `bundle exec jekyll build` 退出 0，GitHub Pages CI 通过
- [ ] 外部脚本：Supabase JS 与 Turnstile 均通过 CDN 引入，配置 key 从 `window.LUTSITE_*` 读取

## 配置注入方式
- **`.env`**（gitignored）— 用户填写真实值：
  ```
  SUPABASE_URL=https://xxx.supabase.co
  SUPABASE_ANON_KEY=eyJ...
  SUPABASE_EDGE_FUNCTION=request-lut-download
  TURNSTILE_SITE_KEY=0x4AAA...
  ```
- **`.env.example`**（committed）— 同名占位，文档化变量
- **`script/build-config.sh`**（committed）— 读 `.env`，渲染 `assets/js/supabase-config.js`（gitignored）
- **`assets/js/supabase-config.js`**（gitignored，build artifact）— 输出形如：
  ```js
  window.LUTSITE_SUPABASE_URL = 'https://xxx.supabase.co';
  window.LUTSITE_SUPABASE_ANON_KEY = 'eyJ...';
  window.LUTSITE_SUPABASE_EDGE_FUNCTION = 'request-lut-download';
  window.LUTSITE_TURNSTILE_SITE_KEY = '0x4AAA...';
  ```
- **`Makefile`**（committed）提供 `build` / `serve` 复合命令先跑 `build-config.sh` 再 `jekyll build|serve`

## Status
- [x] 提案已确认
