# Implementation Plan: LUTs 列表页和详情页

## PR
https://github.com/zanelab/luts.site/pull/2

## 前置检查
- [x] 确认 `_luts/` 目录不存在（避免与现有文件冲突）

## 数据层
- [x] 创建 `_luts/` 目录
- [x] 创建 3-5 个示例 LUT Markdown 文件，包含完整 front matter
- [x] 在 `_config.yml` 中添加 `lut` collection 配置

## 列表页
- [x] 创建 `lut-list/index.html` 页面（原 `luts/index.html`，因命名冲突改名）
- [x] 使用 `{% for lut in site.luts %}` 遍历数据
- [x] 实现 `.blog-type-horizontal` 横向布局结构
- [x] 复用参考页面的 HTML 结构（`.blog-item`, `.wrap`, `.img`, `.content` 等）
- [x] 添加 "Load more" 按钮（静态版本，无需 AJAX）

## 详情页
- [x] 创建 `_layouts/lut.html` 详情页布局
- [x] 实现 `.post-content` 结构（参考 index.html?p=203.html）
- [x] 添加主图、日期、分类、描述
- [x] 添加图片/视频画廊区域（可选）
- [x] 添加 "Download" 下载按钮
- [x] 添加上下篇导航（prev/next post）
- [x] 添加侧边栏组件（Recent Posts, Categories, Tags）

## 导航
- [x] 在 `_data/navigation.yml` 中添加 LUTs 入口

## 样式与脚本
- [x] 检查是否需要额外 CSS 适配（复用主题已有样式）
- [x] 确认已有 JS 脚本（如 zilla-likes）正常工作

## 验证
- [x] `bundle exec jekyll build` 无错误
- [x] 本地预览 `/lut-list/` 列表页正常显示
- [x] 本地预览单个 LUT 详情页正常显示
- [x] 点击列表项能正常跳转详情页
- [x] 下载按钮链接有效