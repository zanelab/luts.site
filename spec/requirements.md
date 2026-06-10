# 需求（累积式）

> 每完成一个模块在 archive 阶段追加一节。

## 1. LUTs 列表与详情（luts-list-detail）
- 用户可在 `/lut-list/` 浏览所有 LUT 资源，每张卡片支持前后对比拖拽预览
- 详情页 `/luts/:slug/` 提供完整 before/after 对比图
- 列表支持"加载更多"分页
- 见 `openspec/changes/luts-list-detail/`

## 2. 首页全配置化（configurable-menu）
- 首页 hero、section 等内容由 `_data/homepage.yml` 驱动
- 菜单项由 `_data/navigation.yml` 配置
- 见 `openspec/changes/configurable-menu/`

## 3. 博客列表与详情（blog-list-detail）
- 文章以 Markdown 存放在 `_posts/`，URL 形如 `/blog/:slug.html`
- 列表页 `/blog/` 横向卡片 + 加载更多
- 详情页含封面、标题、日期、标签、正文、prev/next
- 标签可点击，跳转 `?tag=...` 在列表页筛选
- 标签筛选机制同样适用于 `/lut-list/`
- 见 `openspec/changes/archive/blog-list-detail-20260610/`
