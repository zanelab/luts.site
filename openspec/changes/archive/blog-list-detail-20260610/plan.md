# Implementation Plan: 博客列表页与详情页

## Prerequisites
- [x] 确认 Jekyll 可用：`bundle exec jekyll --version`
- [x] 当前分支 `feature/blog-list-detail`，工作树干净

## 配置与导航
- [x] `_config.yml` 增加 posts 的 `defaults`：`scope: { path: "", type: posts }`，`values: { layout: post, permalink: /blog/:slug.html }`，确认不影响 `_luts` collection
- [x] `_data/navigation.yml` 新增 Blog 入口（位置位于 LUTs 之后），url 指向 `/blog/`，确认 header 自动呈现

## 资源
- [x] 新建 `assets/images/blog/default-cover.svg`，纯 SVG，体积 < 10KB
- [x] （示例文章配套）准备 ≥3 张实际 cover 图（复用 LUTs 已有 wedding 系列）

## 布局
- [x] 新建 `_layouts/post.html`：
  - 继承 `layout: base`，body class 沿用 LUTs 详情页（site-dark 等）
  - 顶部封面块：`<img src="{{ page.cover | default: '/assets/images/blog/default-cover.svg' }}">`
  - 标题 / 日期 / Tags 区
  - 正文 `{{ content }}` 渲染区（包裹现有 .post-content 样式）
  - 底部 prev/next：参考 `_layouts/lut.html` 的 prev/next 实现，但数据源改为 `site.posts`
  - 不渲染 zilla-likes、pb-comments 元素

## 列表页
- [x] 新建 `blog/index.html`（page，front matter `layout: base`，`permalink: /blog/`）：
  - 容器：`<div class="blog-block">` 内 `<div class="blog-items row blog-type-horizontal blog-posts-list load-wrap" id="blog-list-container">`
  - 初始渲染：`{% for post in site.posts limit: 4 %}` 卡片，结构与 LUTs 列表卡片对齐但替换为单 cover（用 `default` 过滤器兜底占位图）
  - 摘要：`{{ post.excerpt | default: post.content | strip_html | truncate: 200 }}`
  - 加载更多按钮：`<button class="blog-load-more button-style3" id="load-more-posts" data-offset="4">加载更多</button>`，仅 `site.posts.size > 4` 时渲染
  - 内嵌 IIFE script：基于 LUTs 列表的实现裁剪而成，去掉比较滑块初始化，保留 isotope `appended` + `layout` 调用与 idempotent 加载状态

## 示例文章
- [x] `_posts/2026-06-10-welcome-to-the-blog.md`（带 cover，中文）
- [x] `_posts/2026-06-08-lut-tutorial-basics.md`（带 cover）
- [x] `_posts/2026-06-05-color-grading-tips.md`（带 cover）
- [x] `_posts/2026-06-01-release-notes-v1.md`（无 cover）
- [x] `_posts/2026-05-28-team-update.md`（无 cover）
- 每篇至少包含 `title`、`tags`、`excerpt`，正文 ≥ 3 段。

## 验证
- [x] `bundle exec jekyll build` 退出码 0，无 Liquid 警告
- [x] 本地 `python3 -m http.server` 启动 `_site/`，访问验证：
  - [x] `/blog/` 列表渲染 4 篇，加载更多按钮可见
  - [x] 列表加载后卡片不重叠（沿用 LUTs 同款 isotope 通知机制）
  - [x] 任一 `/blog/<slug>.html` 详情页：标题、cover/占位图、tags、正文、prev/next 全部正常
  - [x] 顶部导航出现 Blog，跳转正确
  - [x] `/lut-list/`、`/luts/...`、`/` 回归无问题
- [x] 提交前 `git status` 确认只动了预期文件
