# Spec: LUTs 列表页和详情页

## 变更概述
实现 LUTs（Look-Up Table，颜色预设）产品的列表页和详情页，参考 WordPress 主题的 Blog Horizontal 布局。

## ADDED Requirements

### Requirement: LUTs 列表页
系统应展示 LUTs 产品的列表页，采用横向布局（图片左 + 内容右），包含标题、日期/Tags。

#### Scenario: 访问 LUTs 列表页
- Given 用户访问 `/lut-list/` 路径
- When页面加载完成
- Then 显示 LUTs 列表，每项包含：缩略图、标题、发布日期、Tags

---

### Requirement: LUTs 详情页
系统应展示单个 LUT产品的完整信息，包含 Before/After 对比图、说明文字、Tags。

#### Scenario: 访问 LUT 详情页
- Given 用户在列表页点击某个 LUT 条目
- When 页面加载完成
- Then 显示该 LUT 的完整内容：Before/After 对比图、发布日期、Tags、正文描述

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
  - `layout`: lut
  - `title`: LUT名称
  - `date`: 发布日期（YYYY-MM-DD 格式）
  - `beforeImg`: 使用前图片路径
  - `afterImg`: 使用后图片路径
  - `tags`: 标签数组

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

#### Scenario: 主题色保持一致
- Given 详情页加载
- When 页面渲染
- Then body class 包含 `site-dark`（暗色主题）