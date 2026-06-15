# Close issues

本次变更未关闭任何外部 issue（仓库无独立 issue tracker）。

## 关联引用

- 提案 / 规格：`./proposal.md` / `./spec.md`
- 实施计划：`./plan.md`
- Git 分支：`feature/admin-lut-paid-fields-20260615`
- 提交：
  - `6adea19` — feat(admin): LUT edit drawer exposes paid fields (Afdian)
  - `f83d48c` — style(admin): polish paid LUT edit controls
  - `9cfc5f0` — fix(admin-luts): trust server response after save
  - `c287da8` — style(contribute): beautify admin direct-publish toggle
  - `3313f3c` — style(contribute): tone down switch + label contrast
- 部署命令（外站 / 非仓库内）：

  ```bash
  supabase functions deploy manage-lut   # 必须包含 PR #9 的付费字段扩展
  ```

## 已知遗留（归档时未完成）

- PR #9 的 `manage-lut` Edge Function 是否已部署到生产 Supabase 未确认；端到端跑通前需 `supabase functions deploy manage-lut`
- 真实端到端验收（PR #9 合 + 函数部署后人工跑）：抽屉加载 4 字段、勾 paid 但 price 留空 → 红字、SKU/URL 格式校验、保存后 DB 落库 + 列表角标同步
- `_luts/*.md` frontmatter `paid` 跟 DB `luts.paid` 仍是两套数据源，运营必须显式改两边
