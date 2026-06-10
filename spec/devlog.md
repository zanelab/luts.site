# 开发日志

> 按时间倒序记录，每次 archive 追加一节。

## 2026-06-10 — 博客列表与详情（blog-list-detail）

### 摘要
新增博客模块，复用 LUTs 已验证的横向卡片 + 加载更多 + isotope 模式。引入按 `?tag=` 客户端筛选机制，并同步应用到 `/lut-list/`，统一两个列表的标签体验。

### 变更
- `_config.yml` — 新增 posts 的 `defaults`（`layout: post`，`permalink: /blog/:slug.html`）
- `_data/navigation.yml` — 加 "博客" 入口
- `_layouts/post.html` — 博客详情布局（封面/标题/日期/标签/正文/prev/next/侧栏）
- `blog/index.html` — 列表页 + 加载更多 + 标签筛选
- `lut-list/index.html` — 增加 `data-tags` 与同款标签筛选
- `_layouts/lut.html` — 标签改为链接
- `assets/images/blog/default-cover.svg` — 1.2KB 默认封面
- `_posts/2026-06-10-welcome-to-the-blog.md` — 欢迎（带 cover，标签：公告、介绍）
- `_posts/2026-06-08-lut-tutorial-basics.md` — LUT 基础（带 cover，标签：教程、基础）
- `_posts/2026-06-05-color-grading-tips.md` — 婚礼调色技巧（带 cover，标签：技巧、婚礼、调色）
- `_posts/2026-06-01-release-notes-v1.md` — v1 发布说明（无 cover，标签：发布、更新）
- `_posts/2026-05-28-team-update.md` — 团队动态（无 cover，标签：团队）

### 关键决策
- 文章 URL 使用 `.html` 后缀（用户后续要求）
- 标签筛选走客户端 JS（静态站无服务端能力）
- LUTs 与博客列表共用同一筛选模式

### 验证
- `jekyll build` 退出 0，无 Liquid 警告
- `/blog/` 渲染 4 篇 + 加载更多
- `/blog/:slug.html` 详情页 prev/next 正确
- 标签链接跳转 `?tag=...` 工作正常，banner / empty state 正常
- `/lut-list/` 与 `/luts/...` 回归无影响

### 链接
- PR: https://github.com/zanelab/luts.site/pull/4
- Commit: 1d626a0
