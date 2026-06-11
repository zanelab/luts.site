# Spec: LUT 详情页下载流程 + 浮动侧栏

## 变更概述
改造 `luts/:slug` 详情页：侧栏在桌面端 sticky 停留，移除无后端支撑的 Search 控件并替换为显著的 Download 入口；点击后弹出带 Cloudflare Turnstile 人机验证 + 邮箱输入的原生 `<dialog>` 模态框，提交时通过 `@supabase/supabase-js@2` 调用已部署的 Supabase Edge Function，由其下发有时效的下载链接。Supabase 项目的 URL / anon key / Edge Function 名 / Turnstile site key 全部通过 `.env` → `build-config.sh` → `assets/js/supabase-config.js` 构建时注入，前端代码不硬编码任何敏感值。

每个 LUT 的 Markdown front matter 增加 `lutId` 字段（首期以 `TBD-` 前缀占位），作为 Edge Function 查询的关键字。

## ADDED Requirements

### Requirement: 详情页侧栏浮动停留
桌面端视口下，侧栏滚动到距顶部 ≤ 20px 时开始 sticky 跟随主内容。

#### Scenario: 桌面端 sticky 生效
- Given 用户在 ≥ 992px 视口下打开 `luts/:slug/`
- When 用户向下滚动主内容
- Then 侧栏在距顶 20px 处开始 sticky 跟随，停止滚动后保持位置

#### Scenario: 移动端不应用 sticky
- Given 用户在 < 992px 视口下打开 `luts/:slug/`
- When 页面渲染
- Then 侧栏堆叠到主内容下方，按自然流布局；不应用 sticky 样式

#### Scenario: 侧栏过高不溢出视口
- Given 侧栏内容总高度 > 视口高度
- When 侧栏处于 sticky 状态
- Then 侧栏内部出现纵向滚动条，最大高度 `calc(100vh - 40px)`，不出现页面级溢出

---

### Requirement: 移除 Search 控件
详情页侧栏不再渲染无后端支撑的 Search 表单。

#### Scenario: Search 表单消失
- Given 用户打开 `luts/:slug/`
- When 详情页渲染
- Then 侧栏中不出现 `#search-3` widget（搜索框与按钮）

---

### Requirement: Download 按钮渲染
Search 控件原位置替换为视觉权重显著高于侧栏其他 widget 的 Download 按钮。

#### Scenario: 按钮位置与样式
- Given 用户打开 `luts/:slug/`
- When 侧栏渲染
- Then 在侧栏第一项（Search 原位置）渲染 `<button class="lut-download-trigger">下载 LUT</button>`，按钮为主色调背景 + 大号字号 + 圆角

#### Scenario: 按钮可访问性
- Given 用户通过键盘 Tab 浏览侧栏
- When 焦点到达 Download 按钮
- Then 按钮有清晰 focus 样式，Enter/Space 触发打开模态框

---

### Requirement: 邮箱下载模态框
点击 Download 按钮弹出原生 `<dialog>` 模态框，包含 email 输入、Cloudflare Turnstile 人机验证、提交按钮与状态提示区。

#### Scenario: 打开模态框
- Given 用户点击 Download 按钮
- When 触发
- Then `<dialog>` 元素 `showModal()`，焦点移到 email 输入框；遮罩覆盖全屏；模态框居中

#### Scenario: 关闭方式（只能点关闭按钮）
- Given 模态框处于打开状态
- When 用户按 Esc / 点击遮罩
- Then 不关闭模态框（事件被 `preventDefault` 拦截）；只能点击右上角 × 按钮关闭

#### Scenario: 关闭后焦点回到触发按钮
- Given 模态框通过关闭按钮关闭
- When `dialog.close()` 触发
- Then 焦点回到原 Download 触发按钮（无障碍要求）

---

### Requirement: Cloudflare Turnstile 人机验证
模态框内嵌 Turnstile 小部件，提交按钮默认禁用，验证通过后启用。

#### Scenario: 验证未通过时禁用提交
- Given 模态框刚打开
- When Turnstile 尚未渲染完成
- Then “发送到我的邮箱” 按钮 disabled

#### Scenario: 验证通过启用提交
- Given Turnstile 小部件已渲染
- When 用户完成验证（`data-callback` 触发）
- Then 提交按钮 enabled，token 暂存为隐藏字段

#### Scenario: token 过期
- Given 验证已通过（按钮 enabled）
- When Turnstile 检测到 token 过期（`data-expired-callback` 触发）
- Then 清空 token、提交按钮 disabled、`turnstile.reset()` 重新渲染

#### Scenario: 验证脚本未配置
- Given `.env` 缺失 `TURNSTILE_SITE_KEY` 或值不是 `0x...` 开头
- When 模态框打开
- Then 模态顶部红字提示 “人机验证未配置”，提交按钮始终 disabled

---

### Requirement: 调用 Supabase Edge Function
提交时通过 `@supabase/supabase-js@2` 调用 Edge Function，请求体包含 `lutId`、`email`、`turnstileToken`。

#### Scenario: 请求格式
- Given 用户填写有效邮箱且 Turnstile 已验证
- When 点击 “发送到我的邮箱”
- Then 前端 `POST ${SUPABASE_URL}/functions/v1/${SUPABASE_EDGE_FUNCTION}`，body 为 `{ lutId, email, turnstileToken }`，`Authorization: Bearer ${SUPABASE_ANON_KEY}`

#### Scenario: 成功响应
- Given Edge Function 返回 200 `{ ok: true, message }`
- When 客户端收到响应
- Then 模态状态变为 `success`，显示 “已发送到 <email>，请在邮件中点击下载链接（链接 30 分钟内有效）”，按钮变为 “完成”

#### Scenario: 错误响应分发
- Given Edge Function 返回 4xx/5xx `{ error: '<code>' }`
- When 客户端收到响应
- Then 按 error code 映射中文文案（`invalid_email` → “邮箱格式不正确”，`invalid_token` → “人机验证失败”，`lut_not_found` → “该 LUT 暂未提供下载”，`rate_limited` → “请求过于频繁”，其他 → “服务器异常”），按钮恢复 “重试”，Turnstile `reset()`

#### Scenario: 网络断开
- Given `fetch` 抛异常（DNS / 离线 / CORS）
- When 客户端捕获
- Then 显示 “网络异常，请检查连接”，按钮恢复 “重试”

#### Scenario: 3 秒自动关闭
- Given 模态处于 `success` 状态
- When 用户不操作
- Then 3 秒后自动 `dialog.close()`；用户也可点 × 立即关闭

#### Scenario: lutId 占位时拦截
- Given 当前 LUT 的 `lutId` 以 `TBD-` 开头
- When 用户点击 Download 按钮
- Then 不发请求，模态内显示 “该 LUT 暂未提供下载”，控制台 `console.warn` 提示作者回填

---

### Requirement: Markdown front matter 增加 lutId
`_luts/*.md` 须包含 `lutId` 字段，作为 Edge Function 查询的关键字。

#### Scenario: lutId 字段存在
- Given `_luts/<slug>.md`
- When Jekyll 解析 front matter
- Then 文件包含 `lutId` 字段（占位值以 `TBD-` 开头）

#### Scenario: 占位值运行时拦截
- Given `lutId` 以 `TBD-` 开头
- When 详情页 JS 读取
- Then 拦截请求路径，按 “该 LUT 暂未提供下载” 处理

#### Scenario: 真实值联通
- Given `lutId` 是从 Supabase 表回填的真实 ID（不以 `TBD-` 开头）
- When 用户提交邮箱
- Then Edge Function 根据真实 ID 查询并发送下载链接

---

### Requirement: 构建时 .env 注入
仓库通过 Makefile 复合命令在构建前从 `.env` 读取 Supabase 与 Turnstile 配置，写入 `assets/js/supabase-config.js`。

#### Scenario: .env 存在时正常注入
- Given 仓库根目录存在 `.env`，含 `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_EDGE_FUNCTION` / `TURNSTILE_SITE_KEY`
- When 执行 `make build`（= `script/build-config.sh` + `bundle exec jekyll build`）
- Then 生成 `assets/js/supabase-config.js`，内容形如 `window.LUTSITE_SUPABASE_URL = '...';` 等四个常量

#### Scenario: .env 缺失时优雅降级
- Given 仓库根目录无 `.env`
- When 执行 `make build`
- Then `supabase-config.js` 每个变量为 `window.LUTSITE_* = 'TODO';`，Jekyll 仍能完成构建，前端运行时通过 Turnstile 未配置拦截

#### Scenario: .env.example 提供占位
- Given 仓库根目录
- When 检查
- Then `.env.example` 存在（committed），含四个变量的占位值与说明注释

#### Scenario: 敏感文件被 git 忽略
- Given `.gitignore`
- When 检查
- Then `.env` 与 `assets/js/supabase-config.js` 均被忽略

---

### Requirement: CDN 引入第三方脚本
Supabase JS 与 Turnstile 通过 CDN 在 `<head>` 引入，前端不打包依赖。

#### Scenario: 脚本加载成功
- Given `_includes/head-scripts.html` 引用 supabase-js 与 turnstile
- When 详情页加载
- Then 两个脚本以 `defer` / `async` 形式加载，不阻塞首屏渲染

#### Scenario: 全局对象可用
- Given 脚本加载完成
- When 前端逻辑执行
- Then `window.supabase`（createClient）与 `window.turnstile`（隐式渲染）均可用

---

### Requirement: 不破坏现有功能
新增的侧栏、按钮、模态、JS 不得影响详情页既有功能。

#### Scenario: 对比滑块、tags、prev/next 回归
- Given 详情页既有元素
- When 用户浏览
- Then 对比滑块拖拽、tags 链接、上一篇/下一篇、近期 LUT 列表均正常工作

#### Scenario: Jekyll 构建无报错
- Given 本变更修改 `_layouts/lut.html`、新增 `assets/js/lut-download.js`、新增 `.env.example` 与 `script/build-config.sh`
- When 运行 `make build`（含 `bundle exec jekyll build`）
- Then 退出码 0，无 Liquid 警告；`_site/luts/<slug>/index.html` 正常生成；GitHub Pages CI 通过

#### Scenario: 列表页与博客模块回归
- Given 本变更只触碰 LUT 详情页
- When 重新构建
- Then `/lut-list/`、`/blog/`、`/blog/<slug>.html` 渲染不变

---

### Requirement: Edge Function 限流策略
Edge Function 对每次成功下发的下载链接计入审计表，并基于审计表对邮箱和 IP 做滚动窗口限流。窗口统一采用 `now() - interval` 的滚动方式，不按自然日重置。

#### Scenario: 邮箱每日上限
- Given 同一邮箱过去 24 小时内（`now() - 24 hours`）已有 5 条 `status='success'` 的审计记录
- When 该邮箱再次发起下载请求并通过前置校验（邮箱格式、Turnstile、lut_id）
- Then Edge Function 返回 `429 { "error": "rate_limited" }`，写入一条 `status='rate_limited'` 的审计记录

#### Scenario: 邮箱小时限流（保留)
- Given 同一邮箱过去 1 小时内（`now() - 1 hour`）已有 3 条 `status='success'` 的审计记录
- When 该邮箱再次发起下载请求并通过前置校验
- Then Edge Function 返回 `429 { "error": "rate_limited" }`，写入一条 `status='rate_limited'` 的审计记录

#### Scenario: IP 小时限流
- Given 同一来源 IP 过去 1 小时内已有 10 条 `status='success'` 的审计记录
- When 该 IP 再次发起下载请求并通过前置校验
- Then Edge Function 返回 `429 { "error": "rate_limited" }`，写入一条 `status='rate_limited'` 的审计记录

#### Scenario: 三条规则并存
- Given 邮箱与 IP 限流同时启用
- When 任一规则触发上限
- Then 立即返回 `rate_limited`，不再继续向下检查其他规则（短路 OR 语义）

#### Scenario: 限流计数仅记成功
- Given 审计表中存在同一邮箱过去 1 小时内 5 条 `status='rate_limited'` 与 0 条 `status='success'`
- When 该邮箱发起请求
- Then 规则视为未触发（计数仅看 `status='success'`），请求继续推进

#### Scenario: 审计查询故障时 fail-open
- Given 限流计数查询返回数据库错误
- When Edge Function 捕获该错误
- Then 写日志（`console.error`）后视为未触发限流，允许请求继续推进（避免基础设施故障误伤合法用户）

#### Scenario: 客户端未携带 IP 头
- Given 请求未带 `x-forwarded-for` 与 `cf-connecting-ip`
- When 进入限流检查
- Then 跳过 IP 维度检查，仅评估邮箱维度的两条规则

#### Scenario: 前端文案统一
- Given Edge Function 返回 `429 { "error": "rate_limited" }`
- When `lut-download.js` 收到响应
- Then 显示固定文案「请求过于频繁，请稍后再试」；不区分触发的是哪条具体规则
