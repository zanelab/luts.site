# Plan: 首页全配置化

## 阶段状态
- [x] git branch: `feature/jekyll-setup`
- [x] proposal: 确认使用 YAML 数据文件
- [x] brainstorming: 确定 B+C 方案（扩展字段 + 多级菜单）
- [x] spec: 更新规格文档（首页全配置化）
- [ ] executing: 实现中
- [ ] archive: 待完成

## 实现任务

### Task 1: 创建首页数据文件
- [x] 创建 `_data/homepage.yml`
- [x] 从 index.html 提取 hero slides 内容
- [x] 从 index.html 提取 sections 内容

### Task 2: 创建组件目录和文件
- [x] 创建 `/_includes/components/` 目录
- [x] 创建 `hero.html` 组件
- [x] 创建 `section-vision.html` 组件
- [x] 创建 `section-portfolio.html` 组件
- [x] 创建 `section-testimonials.html` 组件
- [x] 创建 `section-about.html` 组件

### Task 3: 修改 index.html
- [x] 添加 front matter（layout: base）
- [x] 遍历 `site.data.homepage` 渲染各组件
- [x] 保留原有 CSS class 名称确保样式兼容

### Task 4: 验证
- [x] `bundle exec jekyll build` 无错误
- [x] 本地预览确认所有 section 正常显示