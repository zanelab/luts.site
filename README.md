# LUTs.site

> 让每一位手机创作者，都能用最少的步骤，得到最想要的色彩。

基于 Jekyll 的静态站点，包含 LUT 详情/列表、博客模块，以及通过 Supabase Edge Function 派发限时下载链接的能力。

## 前置依赖

| 工具 | 版本要求 | 用途 |
|------|---------|------|
| Ruby | ≥ 3.1（与 GitHub Pages 一致） | Jekyll 运行时 |
| Bundler | ≥ 2.x | Gem 依赖管理 |
| make | 任意现代版本 | 一键脚手架（注入 .env + 构建） |

> Edge Function 调用 / 发邮件 / 人机验证使用 **Supabase + Cloudflare Turnstile**。本地起站不需要它们也能跑（按下文“无 .env 时的降级”说明），但下载流程会被前端拦截。

## 快速开始

```bash
# 1. 安装 gem 依赖
bundle install

# 2. 准备环境变量
cp .env.example .env
# 然后编辑 .env，填入下面四个变量（见下一节）

# 3. 启动本地开发服务（http://127.0.0.1:4000）
make serve

# 或仅构建一次到 _site/
make build

# 清理构建产物 + 自动生成的 supabase-config.js
make clean
```

## 配置 `.env`

复制 `.env.example` 为 `.env`，填入下列四个变量。**`.env` 已被 `.gitignore` 忽略，不会提交**。

| 变量 | 是否必填 | 示例 | 说明 |
|------|---------|------|------|
| `SUPABASE_URL` | 是 | `https://abcd1234.supabase.co` | Supabase 项目 URL（公开值） |
| `SUPABASE_ANON_KEY` | 是 | `eyJhbGciOi...` | 前端使用的 anon key（**严禁填 service_role**） |
| `SUPABASE_EDGE_FUNCTION` | 是 | `request-lut-download` | 已部署的 Edge Function 名称 |
| `TURNSTILE_SITE_KEY` | 是 | `0x4AAAA...` | Cloudflare Turnstile 站点公钥，必须 `0x` 开头 |

### 这些值从哪里取

- **Supabase URL / anon key**：Supabase Dashboard → 项目 → `Settings → API` → `Project URL` 和 `anon public`。
- **Edge Function 名称**：你在 `supabase functions deploy <name>` 时指定的名字。本项目约定接收 `POST { lutId, email, turnstileToken }`，并返回 `{ ok: true, message }` 或 `{ error: '<code>' }`（错误码见下文）。
- **Turnstile site key**：Cloudflare Dashboard → `Turnstile` → 创建 widget，使用 `Managed` 模式，复制 site key。

### 注入机制

`make build` / `make serve` 会先跑 `script/build-config.sh`，把 `.env` 里的四个变量转换为：

```js
// assets/js/supabase-config.js（自动生成，已被 git 忽略，不要手改）
window.LUTSITE_SUPABASE_URL = '...';
window.LUTSITE_SUPABASE_ANON_KEY = '...';
window.LUTSITE_SUPABASE_EDGE_FUNCTION = '...';
window.LUTSITE_TURNSTILE_SITE_KEY = '...';
```

LUT 详情页通过这四个 `window.*` 全局调用 Supabase Edge Function 和渲染 Turnstile。

### 无 `.env` 时的降级

如果根目录没有 `.env`，`script/build-config.sh` 会把每个变量写成 `'TODO'`。站点仍可构建并访问：
- 进入 LUT 详情页 → 点击「下载 LUT」按钮 → 模态弹出时顶部显示「人机验证未配置」，提交按钮始终 disabled。
- 列表页、博客、对比滑块等功能不受影响。

## 项目结构

```
luts.site/
├── _config.yml              # Jekyll 主配置（包含 collection、defaults、permalink）
├── _layouts/                # 页面布局
│   ├── base.html            # 全局 <html>/<head>/<body> 骨架
│   ├── lut.html             # LUT 详情页（带 sticky 侧栏 + 下载弹窗）
│   └── post.html            # 博客详情页
├── _includes/
│   ├── header.html
│   └── head-scripts.html    # Supabase + Turnstile CDN 引入
├── _luts/                   # LUT collection（前缀以 _ 表示 Jekyll collection 源目录）
│   └── *.md                 # 每个 LUT 一个 markdown，front matter 详见下文
├── _posts/                  # 博客文章
├── lut-list/index.html      # LUT 列表 + 标签筛选
├── blog/index.html          # 博客列表
├── assets/
│   ├── css/                 # 主题 CSS
│   ├── js/
│   │   ├── lut-download.js  # 下载弹窗 + Supabase 调用逻辑
│   │   └── supabase-config.js  # 构建时生成（被 gitignore）
│   └── images/luts/<slug>/  # 每个 LUT 的 before/after 对比图
├── script/
│   └── build-config.sh      # .env → supabase-config.js 注入脚本
├── Makefile                 # 一键命令
├── .env.example             # 占位模板（committed）
└── README.md                # 本文件
```

## 添加内容

### 新增一个 LUT

在 `_luts/` 下创建 `<slug>.md`：

```markdown
---
layout: lut
title: 你的 LUT 名称
date: 2026-06-10
lutId: TBD-<slug>           # 真实部署后回填 Supabase 表的 ID；以 `TBD-` 开头时前端会拦截下载请求
beforeImg: /assets/images/luts/<slug>/before.jpg
afterImg: /assets/images/luts/<slug>/after.jpg
excerpt: "一句话简介，用于列表卡片。"
tags:
  - 暖色调
  - 电影感
---

正文 markdown……
```

把对应的 before/after 图放到 `assets/images/luts/<slug>/`。

### 新增一篇博客

在 `_posts/` 下创建 `YYYY-MM-DD-<slug>.md`：

```markdown
---
title: 文章标题
date: 2026-06-10 11:00:00 +0800
tags: [教程, Premiere]
cover: /assets/images/2026/06/cover.webp
excerpt: "摘要"
---

正文……
```

文章会被 Jekyll 输出到 `/blog/<slug>.html`。

## 下载流程的接口约定

前端通过 `@supabase/supabase-js` 调用：

```
POST {SUPABASE_URL}/functions/v1/{SUPABASE_EDGE_FUNCTION}
Authorization: Bearer {SUPABASE_ANON_KEY}
Content-Type: application/json

{ "lutId": "...", "email": "...", "turnstileToken": "..." }
```

后端期望响应：

| 状态 | Body | 前端表现 |
|------|------|---------|
| 200 | `{ "ok": true, "message": "..." }` | 模态显示成功文案，3 秒自动关闭 |
| 4xx/5xx | `{ "error": "<code>" }` | 按错误码映射中文 |

错误码映射（详见 `assets/js/lut-download.js`）：

| 错误码 | 中文提示 |
|--------|---------|
| `invalid_email` | 邮箱格式不正确 |
| `invalid_token` | 人机验证失败，请重试 |
| `lut_not_found` | 该 LUT 暂未提供下载 |
| `rate_limited` | 请求过于频繁，请稍后再试 |
| `internal` / 其他 | 服务器异常，请稍后再试 |

网络异常（fetch 抛出）会兜底为「网络异常，请检查连接」。

## 部署到 GitHub Pages

仓库已配置 GitHub Actions（`.github/workflows/jekyll-gh-pages.yml`）：每次 push 到 `main` 时自动 `bundle install` → `make build`（先跑 `script/build-config.sh` 生成 `supabase-config.js`，再 `bundle exec jekyll build`）→ 部署到 GitHub Pages。

### 必需的 GitHub Secrets

在 repo `Settings → Secrets and variables → Actions → Repository secrets` 添加以下四个 secrets（**和 `.env` 同名**，workflow 已配置好映射）：

| Secret 名 | 对应 `.env` 字段 | 备注 |
|-----------|-----------------|------|
| `SUPABASE_URL` | `SUPABASE_URL` | 必填 |
| `SUPABASE_ANON_KEY` | `SUPABASE_ANON_KEY` | 必填，**仍是 anon key**，不要填 service_role |
| `SUPABASE_EDGE_FUNCTION` | `SUPABASE_EDGE_FUNCTION` | 必填，通常是 `request-lut-download` |
| `TURNSTILE_SITE_KEY` | `TURNSTILE_SITE_KEY` | 必填，`0x` 开头 |

workflow 中通过 `env:` 注入到 `make build`，由 `script/build-config.sh` 优先读取 `printenv`、缺失时回退到 `.env`、再缺失则写 `'TODO'`。也就是说：

- **CI**：靠 GitHub Secrets，无需 `.env`
- **本地**：靠 `.env`，无需设环境变量
- **任意环境临时覆盖**：`SUPABASE_URL=... make build` 走 env 即可

### Pages 的非必需事项

- CDN 上的 `@supabase/supabase-js` 与 Turnstile 是在浏览器侧加载，不影响构建。
- 后端的 Edge Function 与 Supabase 表结构由 `supabase/` 目录管理，**和 GitHub Pages 部署完全解耦**，单独靠 `supabase` CLI 部署（见 `supabase/README.md`）。

## 常见问题

**Q: 改了 `.env` 后没生效？**
A: `make serve` 启动后 `.env` 不会热重载。修改后请 `Ctrl-C` 停掉服务，重新 `make serve`。

**Q: 侧栏没有浮动效果？**
A: 仅在 ≥ 992px 视口生效（移动端按自然流堆叠）。如已在桌面端仍无效果，请清浏览器缓存或硬刷新（macOS：⌘⇧R）。

**Q: 详情页点击下载按钮但 Turnstile 没出现？**
A: 检查 `.env` 中 `TURNSTILE_SITE_KEY` 是否以 `0x` 开头；浏览器 console 也会有 Turnstile 网络请求失败的提示。

**Q: GitHub Actions 报 Liquid 语法错误？**
A: `openspec/`、`spec/`、`AGENTS.md`、`.claude/` 已在 `_config.yml` 的 `exclude` 中排除（这些目录的 markdown 含 `{% %}` 片段会被 Jekyll 当 Liquid 解析）。新增文档目录时记得加进去。

## 许可证

未定义。
