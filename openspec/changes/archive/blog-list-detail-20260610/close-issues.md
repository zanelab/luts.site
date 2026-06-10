# Close: blog-list-detail

## Pull Request
- PR #4 — Add blog list and detail pages with tag filtering
  https://github.com/zanelab/luts.site/pull/4

## 关闭内容
- 博客列表页 `/blog/`
- 博客详情页 `/blog/:slug.html`
- 顶部导航 Blog 入口
- 标签 → `?tag=` 客户端筛选（同步应用于 `/lut-list/`）
- 默认封面占位图（`assets/images/blog/default-cover.svg`）
- 5 篇示例文章

## 关联变更
- 复用 `_layouts/lut.html` 的 prev/next、侧栏模式
- 复用 `_layouts/base.html` 主题样式与 isotope 行为
- 在 `_config.yml` 的 `defaults` 注入 posts 的 layout/permalink
