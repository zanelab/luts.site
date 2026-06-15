# Close issues

本次变更未关闭任何外部 issue（仓库无独立 issue tracker）。

## 关联引用

- 提案 / 规格：`./proposal.md` / `./spec.md`
- 架构设计：`./design.md`
- 实施计划：`./plan.md`
- Git 分支：`feature/lut-paid-afdian-20260615`
- 提交：
  - `3baf7bc` — feat: paid LUT purchase via Afdian with DM delivery
  - `0e8ef06` — fix(afdian-webhook): read sign from body, swap MD5 to pure JS
- 部署命令（外站 / 非仓库内）：

  ```bash
  supabase functions deploy afdian-webhook --no-verify-jwt
  supabase functions deploy resend-paid-download
  supabase functions deploy manage-lut
  supabase db push   # 20260615000000_paid_lut_orders.sql
  supabase secrets set AFDIAN_USER_ID=... AFDIAN_TOKEN=...
  ```

## 已知遗留（归档时未完成）

- 真实爱发电 SKU / 商品页：`_luts/paid-smoke-test.md` 已用真实 SKU `f1316b08689511f19efc52540025c377` 替换占位，其余正式付费 LUT 由运营侧补
- 第一次真实订单的 DM 兑号 + 二次校验 e2e：dev 阶段只走到 Open API 调用前（MD5 修复后未继续跑通 query-order / send-msg），首次真实购买时需要人工盯一次日志
- 爱发电 webhook URL 在爱发电开发者后台的注册操作（一次性，手动完成）
