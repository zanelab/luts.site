# Implementation Plan: LUTs 列表页和详情页

## 数据层
- [x] 创建 `_luts/` 目录
- [x] 创建 5 个示例 LUT Markdown 文件（front matter 简化：layout, title, date, beforeImg, afterImg, tags）
- [x] 在 `_config.yml` 中添加 `luts` collection 配置

## 列表页
- [x] 创建 `lut-list/index.html` 页面
- [x] 使用 `{% for lut in site.luts %}` 遍历数据
- [x] 实现 `.blog-type-horizontal` 横向布局结构

## 详情页
- [x] 创建 `_layouts/lut.html` 详情页布局
- [x] 实现 `.site-content` 结构（参考 index.html?p=203.html）
- [x] 添加 Before/After 对比图
- [x] 添加 Tags 显示
- [x] 添加上下篇导航（prev/next post）
- [x] 添加侧边栏组件（Recent LUTs, Tags）

## 导航
- [x] 在 `_data/navigation.yml` 中添加 LUTs 入口（/lut-list/）

## 样式修复
- [x] 在 `_layouts/base.html` 中添加 `body_class` 默认值 `site-dark` 确保主题色一致

## 验证
- [x] `bundle exec jekyll build` 无错误
- [x] 详情页 body class 包含 `site-dark`

## PR
待用户确认后创建