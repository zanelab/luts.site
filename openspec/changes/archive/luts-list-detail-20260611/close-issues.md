# Close: luts-list-detail

## Pull Request
- PR #3 — Add LUTs list and detail pages
  https://github.com/zanelab/luts.site/pull/3

## 关闭内容
- LUT 列表页 `/lut-list/`，横向卡片 + 加载更多分页
- LUT 详情页 `/luts/:slug/`，含 before/after 对比图
- 每张卡片的拖拽式 before/after 滑块（`lut-list/index.html`）
- 5 张示例 LUT（boost_shadow / sun_shine 等）连同 before/after 配图

## 关联变更
- 引入 `_layouts/lut.html` 详情布局
- 引入 `_luts/` collection + `_config.yml` 的 `permalink: /luts/:slug/`
- 后续 `lut-detail-download` 在此布局上叠加 sticky 侧栏 + 下载 modal
