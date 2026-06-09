# Proposal: 菜单可配置化

## 需求
将网站导航菜单从硬编码改为可配置的 YAML 数据文件管理。

## 技术方案
- 使用 `_data/navigation.yml` 存储菜单结构
- 修改 `/_includes/header.html` 从数据文件读取菜单
- 保持现有 HTML/CSS 结构不变

## 优势
- 内容与代码分离，非开发者可修改菜单
- Jekyll 原生支持，数据文件热重载无需重启
- 可扩展性强，未来可加图标、描述等字段

## 待确认
- 菜单层级需求（是否需要多级下拉）
- 当前菜单具体内容（需先查看现有实现）
- 是否需要特殊菜单项（如登录、语言切换）

## 影响范围
- 新增：`_data/navigation.yml`
- 修改：`/_includes/header.html`

## 下一步
brainstorming 阶段细化数据结构设计