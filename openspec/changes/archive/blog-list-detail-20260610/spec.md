# Spec: 博客列表页与详情页

## 变更概述
为站点新增博客模块。文章以 Markdown 形式存放在 `_posts/`（Jekyll 原生 posts 集合），列表页 `/blog/`，详情页 `/blog/:slug/`，复用 LUTs 列表已经验证过的横向布局 + 加载更多模式。

## ADDED Requirements

### Requirement: 博客文章数据存储
博客文章以 Jekyll Markdown 文件形式存储在 `_posts/` 目录，文件命名 `YYYY-MM-DD-slug.md`。

#### Scenario: Jekyll 构建时读取博客数据
- Given `_posts/` 目录包含若干符合命名规范的 `.md` 文件
- When 执行 `bundle exec jekyll build`
- Then 系统将每篇文章生成静态页面，URL 为 `/blog/:slug/`，并出现在 `site.posts`（默认按 date 倒序）

#### Scenario: front matter 必填字段
- Given 一个 `_posts/YYYY-MM-DD-slug.md`
- When Jekyll 解析 front matter
- Then 必须包含 `title`；`layout` 与 `permalink` 通过 `_config.yml` 的 `defaults` 自动注入，不必每篇重复

#### Scenario: front matter 可选字段
- Given 文章 front matter
- When 包含可选字段
- Then 支持：`tags`（数组）、`excerpt`（摘要文本）、`cover`（封面图路径）；任一字段缺省时使用合理回退（详见各对应需求）

---

### Requirement: 博客列表页
系统应在 `/blog/` 展示所有博客文章，采用横向布局（左图 + 右文），按发布日期倒序。

#### Scenario: 访问列表页
- Given 用户访问 `/blog/`
- When 页面加载完成
- Then 显示按 `date` 倒序的文章列表，初始展示前 4 篇；每篇卡片包含封面（或占位图）、标题、日期、Tags、摘要

#### Scenario: 摘要文本来源
- Given 一篇文章
- When 列表卡片渲染
- Then 优先使用 front matter 中的 `excerpt`；若无，则使用正文 `strip_html | truncate: 200`

#### Scenario: 标题与日期链接
- Given 一篇列表卡片
- When 用户点击标题或封面
- Then 跳转到该篇文章详情页 `/blog/:slug/`

---

### Requirement: 列表页"加载更多"分页
当 `site.posts` 数量超过 4 时，列表页底部出现"加载更多"按钮，每次点击追加 4 篇文章。

#### Scenario: 按钮初始可见性
- Given `site.posts.size > 4`
- When 列表页渲染
- Then 列表下方渲染按钮 `<button class="blog-load-more button-style3">加载更多</button>`

#### Scenario: 文章数 ≤ 4 时按钮隐藏
- Given `site.posts.size ≤ 4`
- When 列表页渲染
- Then 不渲染按钮

#### Scenario: 点击加载下一页
- Given 列表页有待加载文章
- When 用户点击"加载更多"
- Then 按钮文案变为"加载中..."并禁用；约 300ms 后追加最多 4 篇新卡片到列表末尾；按钮恢复"加载更多"

#### Scenario: 新增卡片正确归位
- Given 列表容器已经被主题的 `isotope` 接管
- When 新卡片被 `$container.append(...)` 注入
- Then 代码调用 `$container.isotope('appended', $newItems).isotope('layout')`，新卡片不与已有卡片重叠

#### Scenario: 全部文章加载完成后隐藏按钮
- Given 已加载文章数 ≥ `site.posts.size`
- When 最后一次加载完成
- Then 按钮所在的 `.loadmore-button-block` 被隐藏

#### Scenario: 按钮类名避免主题冲突
- Given 主题 `scripts.js` 会查找 `.loadmore-button` 类名的按钮挂自己的 click 处理器
- When 本变更渲染按钮
- Then 按钮**不**包含 `loadmore-button` 类，避免触发主题的 `JSON.parse(undefined)` 报错

---

### Requirement: 博客详情页
系统应在 `/blog/:slug/` 展示单篇文章完整内容。

#### Scenario: 访问详情页
- Given 用户访问 `/blog/:slug/`
- When 页面加载完成
- Then 显示标题、发布日期、Tags（若有）、顶部封面（若有）、Markdown 渲染后的正文

#### Scenario: 顶部封面渲染
- Given 文章 front matter 含 `cover`
- When 详情页渲染
- Then 顶部显示该图，`<img>` 形式，宽度 100% 自适应

#### Scenario: 无封面时使用占位图
- Given 文章 front matter 不含 `cover`
- When 列表卡片或详情页顶部渲染
- Then 使用 `/assets/images/blog/default-cover.svg` 作为占位图

#### Scenario: 详情页 prev/next 导航
- Given 当前文章在 `site.posts` 中的索引为 i
- When 详情页渲染底部
- Then 当 i > 0 时显示"previous post"链接到 `site.posts[i-1]`；当 i+1 < size 时显示"next post"链接到 `site.posts[i+1]`

#### Scenario: 详情页不渲染点赞/评论占位
- Given 详情页布局
- When 页面渲染底部
- Then 不出现 zilla-likes / pb-comments 模块（与 LUTs 详情页保持差异）

---

### Requirement: 顶部主导航增加 Blog 入口
站点主导航应同时呈现 LUTs 与 Blog 入口。

#### Scenario: 导航项渲染
- Given 任意页面加载
- When 顶部 header 渲染
- Then 导航中出现 "Blog" 项，链接为 `/blog/`，且原 "LUTs" 项保留不变

#### Scenario: 当前页高亮（若主题已支持）
- Given 用户当前位于 `/blog/` 或 `/blog/:slug/`
- When 顶部导航渲染
- Then "Blog" 项应用 active 状态（沿用主题已有机制；无机制可暂留视觉一致）

---

### Requirement: 默认封面图资源
仓库须包含一张轻量 SVG 占位图，避免使用第三方资源。

#### Scenario: 占位图存在
- Given 仓库
- When 检查 `assets/images/blog/default-cover.svg`
- Then 文件存在，体积 < 10KB，纯 SVG 渲染（无外链字体或位图）

---

### Requirement: 初始示例文章
为验证模块功能，仓库需要 5 篇示例文章。

#### Scenario: 示例集合
- Given 仓库 `_posts/` 目录
- When 检查内容
- Then 至少存在 5 篇示例文章；其中 ≥3 篇包含 `cover` 字段，≤2 篇不包含；日期跨度覆盖近期，便于验证排序

---

### Requirement: 构建无报错
本变更不应破坏现有页面。

#### Scenario: Jekyll 构建成功
- Given 当前仓库状态
- When 运行 `bundle exec jekyll build`
- Then 构建过程无 Liquid 错误，退出码 0；`_site/blog/index.html` 与 `_site/blog/<slug>/index.html` 均生成

#### Scenario: 现有 LUTs 与 Home 不受影响
- Given 本变更修改 `_config.yml` 与 `_data/navigation.yml`
- When 重新构建
- Then `/lut-list/`、`/luts/<slug>/`、`/` 仍能正常渲染，无 JS 控制台报错

---

### Requirement: 文章路径使用 .html 后缀
为避免历史实践中的目录式 URL，博客文章详情页路径须以 `.html` 结尾。

#### Scenario: 详情页生成 .html 文件
- Given `_posts/2026-06-10-welcome-to-the-blog.md`
- When Jekyll 构建完成
- Then 生成文件 `_site/blog/welcome-to-the-blog.html`（不是目录）

#### Scenario: 列表与导航链接使用 .html
- Given `/blog/` 列表或任一文章顶部/侧栏的 tag 链接
- When 渲染
- Then href 形如 `/blog/<slug>.html`

---

### Requirement: 标签筛选（按 ?tag= 查询字符串）
文章与 LUTs 的标签可点击，点击后跳转至列表页并按该标签筛选卡片。

#### Scenario: 标签渲染为链接
- Given 列表页卡片或详情页正文旁的标签
- When 渲染
- Then 标签以 `<a class="tag-link" href="<list-page>?tag=<tag>">` 形式呈现

#### Scenario: 列表页读取 ?tag 筛选
- Given 用户访问 `/blog/?tag=教程`（或 `/lut-list/?tag=Wedding`）
- When 列表页加载
- Then 不含该标签的卡片被隐藏（基于 `data-tags` 属性），页面顶部显示 `tag-filter-banner`，提示当前筛选标签与匹配数

#### Scenario: 清除筛选
- Given 列表页处于筛选激活状态
- When 用户点击 banner 中的"清除筛选"链接
- Then 跳转到无 query 的列表页，所有卡片重新显示

#### Scenario: 标签筛选应用于"加载更多"
- Given 列表页已激活筛选，且点击"加载更多"
- When 新卡片被追加
- Then 新卡片同样按 `data-tags` 过滤，不匹配的隐藏

#### Scenario: 无匹配结果
- Given 当前 ?tag 没有对应文章
- When 列表页渲染
- Then 显示 `tag-filter-empty` 空状态文案与返回链接
