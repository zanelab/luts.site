# 架构设计（累积式）

> 每完成一个模块在 archive 阶段追加一节。

## 总体形态
- Jekyll 静态站点，主题骨架来自 Sansara WordPress 主题（已转成 `_layouts/base.html` + `assets/` 资源）
- 内容驱动：`_luts/`（自定义 collection）+ `_posts/`（原生 posts）+ `_data/*.yml`（导航/首页）
- 列表与详情共享主题的 `.blog-block` / `.blog-items` / isotope 布局
- 客户端 JS：jQuery + isotope 主题脚本 + 自写 IIFE（标签筛选、加载更多、对比滑块）

## 1. LUTs 模块
- 自定义 collection（`_luts/`），front matter 含 beforeImg/afterImg/tags
- 详情页 `_layouts/lut.html` 包含双图对比滑块
- 见 `openspec/changes/luts-list-detail/`

## 2. 博客模块
- 原生 posts 集合（`_posts/`），`defaults` 注入 `layout: post` 与 `permalink: /blog/:slug.html`
- 列表复用 `.blog-block` 容器，去掉双图对比改为单封面
- 标签筛选：`<article data-tags="...">` + URL `?tag=` + JS 客户端过滤
- 筛选机制移植自 LUTs 列表页（统一脚本模式）
- 见 `openspec/changes/archive/blog-list-detail-20260610/`
