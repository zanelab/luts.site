# Design: 博客列表页与详情页

## 概述
为站点新增博客模块。文章源使用 Jekyll 原生 `_posts/` 集合，列表 `/blog/`、详情 `/blog/:slug/`，复用 LUTs 已经验证过的横向布局与"加载更多"模式。

## 技术方案

### 数据来源
**选择：Jekyll 原生 `_posts/` 集合**（用户指定）。
- 文件命名遵循 `YYYY-MM-DD-slug.md`，Jekyll 自动解析 `date` 与 `slug`。
- 通过 `site.posts` 访问，默认按 date 倒序。
- 在 `_config.yml` 用 `defaults` 设置 `permalink: /blog/:slug/` 与 `layout: post`，避免每篇文章重复写 front matter。

> **不选自定义 collection（如 `_blogs/`）的原因**：Jekyll 已经为 posts 提供了日期解析、排序、`site.posts`、内置 `excerpt` 等便利，没有引入自定义集合的必要。

### 加载更多分页
**选择：复用 LUTs 模式**。
- 服务端 Liquid 限制初始渲染 `site.posts | limit: 4`。
- "加载更多"按钮内嵌一段 Liquid for 循环，把第 5 篇及以后的文章 HTML 拼成 JS 字符串，按 4 篇/页通过 jQuery `append()` 注入。
- isotope 已通过 `scripts-pt.js` 自动绑定到 `.blog-items`；append 后调用 `isotope('appended', $items).isotope('layout')` 让新卡片归位。
- `<button>` 用 `lut-load-more` 兄弟类名 `blog-load-more`，避免被主题的 `YPRMLoadMore` 插件二次绑定。

> **不选 jekyll-paginate / JSON+fetch 的原因**：LUTs 已验证此模式，无需引入新依赖；且文章总量近期不会大到需要真正分页。

### Cover 字段策略
**选择：cover 可选，缺省用占位图**。
- front matter 增加可选 `cover: /assets/images/blog/...jpg`。
- 列表卡片与详情页顶图统一通过 Liquid `{{ post.cover | default: '/assets/images/blog/default-cover.svg' }}` 取值，保证 DOM 结构稳定（不需要两套卡片模板，简化 JS 字符串拼接）。
- 准备一张轻量的 SVG 占位图，文字为博客标题首字母或通用图案。

### 详情页底部
**选择：仅 prev / next 导航**。
- 不渲染 LUTs 那套点赞/评论占位 UI。
- prev/next 通过 `site.posts` 的索引获取（与 `_layouts/lut.html` 同样写法）。

### 列表与详情共享样式
- 列表页和 LUTs 列表共用主题 `.blog-block / .blog-items / .blog-type-horizontal` 的 CSS，无需新增样式。
- 详情页用现有 `_layouts/lut.html` 中通用的 `post-bottom .post-nav` 样式。
- 不复用 `.lut-comparison-slider`（博客不需要双图对比）；详情页顶图就是单张 `<img>`。

## 文件结构（计划）
```
_config.yml                          # 增加 collections/defaults for posts
_data/navigation.yml                 # 新增 Blog 导航项
_includes/header.html                # 受 navigation.yml 驱动，无需直接改
_layouts/post.html                   # 新建：博客详情布局
_posts/
  2026-06-10-welcome.md              # 示例（带 cover）
  2026-06-08-lut-tutorial-basics.md  # 示例（带 cover）
  2026-06-05-color-grading-tips.md   # 示例（带 cover）
  2026-06-01-release-notes-v1.md     # 示例（无 cover）
  2026-05-28-team-update.md          # 示例（无 cover）
blog/
  index.html                         # 列表页（page，layout: base）
assets/images/blog/
  default-cover.svg                  # 默认占位图
  ...                                # 示例文章封面
```

## 关键决策摘要

| 决策点 | 选择 | 备选 | 取舍理由 |
|--------|------|------|----------|
| 数据集合 | `_posts/` 原生 | 自定义 `_blogs/` | 复用 Jekyll 内置功能，零额外配置 |
| 分页 | 加载更多 + isotope | jekyll-paginate / JSON | 已有可工作的模式，避免引入新依赖 |
| cover | 可选 + 占位图 | 必填 / 无图变体 | 卡片 DOM 一致，最简实现 |
| 详情底部 | prev/next | 含点赞/评论占位 | 用户决策，保持简洁 |
| 导航 | 主导航加 Blog | 仅 footer 链接 | 用户决策，主入口可发现 |

## 风险与应对
1. **`_posts/` 日期文件名约束**：文件名必须形如 `YYYY-MM-DD-slug.md`，否则 Jekyll 跳过。  
   → 文档里在示例文章中说明命名规范，并在 `proposal/spec` 验收里做检查。
2. **isotope 与 .blog-items 复用**：博客列表与 LUTs 列表都是 `.blog-items`，但分处不同页面（不会冲突），且加载更多的兼容代码已经在 LUTs 里实现过，照搬即可。
3. **占位 SVG 资源**：需要一张轻量的 SVG，避免引入第三方图片；用纯 SVG 渐变 + 标题字母即可。
4. **`_config.yml` 修改影响范围**：要确保新加的 posts defaults 不覆盖 `_luts/` 的 layout/permalink。会通过 `scope.type: posts` 限定。

## 不在范围
- RSS feed、评论、订阅、搜索专属页。
- 标签筛选 UI（仅展示标签文字）。
- 项目级 `spec/` 初始化（仍按"未来再做"处理）。
