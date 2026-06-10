# 目录结构说明

> 项目级目录结构累积式记录，每次新模块在 archive 阶段补一份章节。

## 顶层
- `_config.yml` — Jekyll 配置：plugins、collections、defaults（posts 注入 layout/permalink）
- `_data/` — YAML 数据文件（导航、首页内容等）
- `_includes/` — 可复用片段（`header.html` 等）
- `_layouts/` — 页面布局（`base.html` 主题壳，`lut.html`、`post.html` 详情壳）
- `_luts/` — LUTs 集合（自定义 collection）
- `_posts/` — 博客文章（Jekyll 原生 posts 集合）
- `_sass/` — 局部 SCSS
- `assets/` — 静态资源（图片、webfonts）
- `blog/` — 博客列表页（page，permalink `/blog/`）
- `lut-list/` — LUTs 列表页（page，permalink `/lut-list/`）
- `luts/` — LUTs 详情页生成目录（collection `output: true` + `permalink: /luts/:slug/`）
- `openspec/` — 变更规格（proposal/spec/design/plan/close-issues）
- `spec/` — 项目级累积式规格

## 关键约定
- 列表页通用：`.blog-block > .blog-items.blog-type-horizontal` + isotope 接管
- 加载更多：每页 4 项，类名带前缀（`lut-load-more` / `blog-load-more`）避开主题 `YPRMLoadMore` 插件
- 标签筛选：`<article data-tags="...">` + `?tag=` 客户端 JS 过滤
- 文章 URL：`_posts` 用 `.html` 后缀，`_luts` 用目录式
