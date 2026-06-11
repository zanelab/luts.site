# Close: lut-detail-download

## Pull Request
- PR #5 — Add LUT detail page download flow
  https://github.com/zanelab/luts.site/pull/5

## 关闭内容
- 详情页"下载 LUT"按钮 + 模态（邮箱 + Turnstile token + 提交）
- 桌面端 sticky 侧栏（≥992px），移动端自然流
- Supabase Edge Function `request-lut-download` 调用（30 分钟有效链接）
- `lutId: TBD-` 占位时前端拦截（`lut_not_found` 文案）
- 错误码 → 中文提示映射（`invalid_email` / `invalid_token` / `rate_limited` 等）
- build-time 注入：`script/build-config.sh` 把 `.env` → `assets/js/supabase-config.js`
- 无 `.env` 时的降级（`'TODO'` 检测 + 提交按钮禁用 + banner 提示）
- `README.md` 改写：快速开始 / 配置 / 接口约定 / FAQ

## 关联变更
- 在 `luts-list-detail` 的 `_layouts/lut.html` 之上叠加（不重写）
- Edge Function 名称后来从 `.env` 改硬编码为 JS 顶部常量（`lut-contribution` amend 2 阶段）

## 配置依赖
- 本地：`.env` 含 `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `TURNSTILE_SITE_KEY`
- CI：GitHub `github-pages` Environment 三个 secrets
