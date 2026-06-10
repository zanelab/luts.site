# Proposal: 博客列表页与详情页

## 背景
当前站点已经有 LUTs 收藏（`/lut-list/` 列表 + `/luts/:slug/` 详情），但还没有传统意义上的"博客"。需要一套独立的文章发布通道用于教程、版本说明、行业心得等长文内容。

## 需求概述
在 Jekyll 站点中实现博客模块：
- 文章源：Markdown 文件，存放于 `_posts/` 目录（Jekyll 原生 posts 集合）。
- 列表页：`/blog/` 路径，复用 LUTs 列表的 `blog-type-horizontal` 横向布局，封面图（若存在）+ 标题 + 日期 + 标签 + 摘要。
- 详情页：`/blog/:slug/` 路径，含标题、日期、标签、可选封面图、正文（由 Markdown 渲染）、上一篇 / 下一篇导航。
- 顶部导航增加 "Blog" 入口。

## 已确认设计决策（2026-06-10 用户确认）
1. **数据存储**：Markdown 文件位于 `_posts/`，使用 Jekyll 原生 posts 集合（文件名包含日期：`YYYY-MM-DD-slug.md`）。
2. **列表布局**：横向布局（同 LUTs，`blog-type-horizontal`）。
3. **封面图**：`cover` 字段可选。无 cover 时列表卡片不渲染左侧图片区，详情页不渲染顶部封面。
4. **分页方式**：加载更多按钮（复用 LUTs 列表已经验证过的 isotope + 加载更多模式）。
5. **URL 与导航**：列表 `/blog/`，详情 `/blog/:slug/`，顶部主导航新增 "Blog" 入口（保留 "LUTs"）。

## 与 LUTs 模块的关键差异
| 维度 | LUTs | Blog |
|------|------|------|
| 集合 | 自定义 `_luts/` | Jekyll 原生 `_posts/` |
| URL | `/luts/:slug/` | `/blog/:slug/` |
| 列表路径 | `/lut-list/` | `/blog/` |
| 卡片图 | beforeImg + afterImg 双图叠加滑块 | 单张 cover（可选） |
| 详情图 | 比较滑块 | 顶部单图（可选） |
| 必填字段 | `beforeImg` + `afterImg` | 仅 `title` + `date`，cover 可选 |

## 范围之外（明确不做）
- 评论系统、点赞、订阅、RSS（保持简单，后续可再开变更）。
- 分类（categories）/ 多级标签筛选 UI（标签仅做展示）。
- 全文搜索（沿用顶部 search 组件即可，不在本变更内做）。
- 站点级 `spec/` 项目级文档（当前项目还未初始化项目级 spec；本变更只产出需求级 spec）。

## 验收
- 访问 `/blog/`：渲染所有 `_posts/` 下的 Markdown，按日期倒序，初始 4 篇，多余文章可通过加载更多展开，无控制台报错。
- 访问任意 `/blog/:slug/`：标题、日期、标签、正文、上一篇/下一篇按预期渲染；有 cover 时显示，无 cover 时占位结构隐藏。
- 顶部导航出现 "Blog" 入口，路径指向 `/blog/`。
- `bundle exec jekyll build` 成功，无 Liquid 渲染错误。
