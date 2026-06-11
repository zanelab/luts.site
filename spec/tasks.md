# 任务里程碑

## v0 — 站点主题移植
- [x] 移植 Sansara 主题骨架（`base.html` / assets）
- [x] 顶部导航数据化

## v1 — LUTs 模块
- [x] LUT 列表与详情
- [x] 加载更多分页
- [x] Before/After 对比滑块
- [x] 详情页下载流程（Supabase Edge Function + Turnstile + 浮动侧栏）

## v2 — 博客模块
- [x] `_posts/` 数据源
- [x] 列表 + 详情页
- [x] 标签筛选（`?tag=` 客户端 JS）
- [x] LUTs 列表复用同一筛选机制

## v3 — 投稿与审核
- [x] Supabase 表 / RLS / 存储桶
- [x] Edge Function `submit-lut`（匿名投稿）
- [x] Edge Function `moderate-submission`（admin 审批）
- [x] `/contribute/` 投稿页（drag-drop 上传）
- [x] `/admin/submissions/` 审批队列
