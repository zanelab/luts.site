---
layout: lut
title: 付费 LUT 冒烟测试
date: 2026-06-15 16:00:00 +0800
lutId: TBD-paid-smoke-test
paid: true
price: 1
afdianSkuId: f1316b08689511f19efc52540025c377
afdianOrderUrl: https://ifdian.net/item/f1316b08689511f19efc52540025c377
excerpt: "用于验证爱发电付费 LUT 流程的冒烟测试 LUT。正式部署前需要将 afdianSkuId 和 afdianOrderUrl 替换为爱发电后台真实值。"
beforeImg: /assets/images/luts/paid-smoke-test/before.jpg
afterImg: /assets/images/luts/paid-smoke-test/after.jpg
tags:
  - 冒烟测试
---

## 作用

这是一个用于端到端冒烟测试的付费 LUT 样例：

- 验证 build-time 校验通过
- 验证详情页头部渲染价格徽章 + 购买按钮（不渲染下载按钮）
- 验证列表卡片渲染"付费"角标
- 验证爱发电 Webhook 推送 → 验签 → 二次校验 → 写订单 → DM 兑号 全链路

## 正式部署前

把 `afdianSkuId` 改为爱发电后台创建的售卖类型商品（`product_type=1`）的真实 SKU ID，把 `afdianOrderUrl` 改为真实商品页 URL。
