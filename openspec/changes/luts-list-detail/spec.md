# Spec: LUTs 列表页和详情页

## 变更概述
实现 LUTs（Look-Up Table，颜色预设）产品的列表页和详情页，参考 WordPress 主题的 Blog Horizontal 布局。

## ADDED Requirements

### Requirement: LUTs 列表页
系统应展示 LUTs 产品的列表页，采用横向布局（图片左 + 内容右），包含标题、日期/分类、描述、交互按钮。

#### Scenario: 访问 LUTs 列表页
- Given 用户访问 `/luts/` 路径
- When页面加载完成
- Then 显示 LUTs 列表，每项包含：缩略图、标题、发布日期、分类、描述、点赞数、评论数

#### Scenario: LUTs 列表分页/加载更多
- Given LUTs 列表包含多项
- When 用户点击 "Load more" 按钮
- Then 异步加载更多 LUTs 条目

---

### Requirement: LUTs 详情页
系统应展示单个 LUT产品的完整信息，包含预览图/视频、说明文字、下载按钮。

#### Scenario: 访问 LUT 详情页
- Given 用户在列表页点击某个 LUT 条目
- When 页面加载完成
- Then 显示该 LUT 的完整内容：主图、发布日期、分类、正文描述、媒体（图片/视频画廊）、下载按钮

#### Scenario: 下载 LUT 文件
- Given 用户在 LUT 详情页
- When 用户点击 "Download" 下载按钮
- Then触发文件下载（指向 `/assets/luts/{{slug}}.cube` 或类似路径）

---

### Requirement: LUTs 数据存储
LUTs 数据以 Jekyll Markdown 文件形式存储在 `_luts/` 目录，每文件对应一个 LUT 条目。

#### Scenario: Jekyll 构建时读取 LUTs 数据
- Given `_luts/` 目录包含多个 `.md` 文件
- When 执行 `jekyll build` 或 `jekyll serve`
- Then 系统解析每个 Markdown 文件的 front matter 作为 LUT 数据，生成对应的列表页和详情页

---

### Requirement: LUTs front matter 结构
每个 LUT Markdown 文件应包含特定 front matter 字段。

#### Scenario: LUT front matter 字段
- Given 一个 LUT Markdown 文件
- When 文件包含 front matter
- Then 必须包含以下字段：
  - `title`: LUT名称
  - `date`: 发布日期（YYYY-MM-DD 格式）
  - `category`: 分类（如 "Cinematic", "Wedding", "Street"）
  - `thumbnail`: 缩略图路径
  - `image`: 主图路径
  - `description`: 描述文字
  - `download`: 下载文件路径（可选）
  - `gallery`: 图片画廊路径数组（可选）
  - `video`:视频 URL（可选）
  - `likes`: 点赞数（默认 0）

---

### Requirement: 列表页与详情页样式兼容
列表页和详情页应复用主题已有样式类，确保与首页/其他页面视觉一致。

#### Scenario: 样式复用
- Given 列表页使用 `.blog-type-horizontal` 布局
- When 页面渲染
- Then 所有 CSS 类名与参考页面（index.html?p=682.html）一致

#### Scenario: 详情页样式复用
- Given 详情页使用 `.post-content` 和 `.site-content` 结构
- When 页面渲染
- Then 所有 CSS 类名与参考页面（index.html?p=203.html）一致