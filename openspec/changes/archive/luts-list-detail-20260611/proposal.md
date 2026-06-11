# Proposal: LUTs 列表页和详情页

## 需求概述
实现 LUTs（Look-Up Table，颜色预设）产品的列表页和详情页，参考 `~/Workspace/aigocy/ashade-download/ashade/index.html?p=682.html` 的 Blog Horizontal 布局风格。

## 参考分析
- 参考页面是 **Blog Horizontal** 布局
- 列表页结构：图片 + 标题 + 日期/分类 + 描述 + 交互（点赞/评论）+ Load More
- 详情页：单文章完整内容展示

## 已确认需求
- **数据存储**：方案 B - Markdown 文件在 `_luts/` 目录
- **列表布局**：横向布局（blog-type-horizontal），无电商功能
- **详情页**：Blog post 布局 + Download 下载按钮

## 用户确认（2026-06-09）
1. ✓ LUTs 数据：需创建示例 Markdown 文件
2. ✓ 列表页：无电商功能，纯展示
3. ✓ 详情页：需要 Download 下载按钮
4. ✓ 列表页样式：参考 index.html?p=682.html 的 horizontal布局
5. ✓ 详情页样式：参考 index.html?p=203.html 布局