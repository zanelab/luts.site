---
layout: lut
title: 电影级视觉风格的 LUT
date: 2026-06-15 10:00:00 +0800
lutId: 429d21e2-046b-4679-bc40-ebf29457eb11
excerpt: "将原始或 Log 视频/图像色彩转换为具有胶片质感的色调：提升暗部细节、压制高光、增加色彩密度和氛围感。"
beforeImg: /assets/images/luts/filmic-style/before.jpg
afterImg: /assets/images/luts/filmic-style/after.jpg
tags:
  - 胶片模拟
  - 电影风格
  - 佳能
  - 色彩分级
  - 风格化调色
---

## 作用

将原始或 Log 视频/图像色彩转换为具有胶片质感的色调：提升暗部细节、压制高光、增加色彩密度和氛围感。

## 适用场景

- 佳能相机拍摄的 Log 素材（如 Canon Log 2/3）的快速一级调色。

- 影视剧、短视频、广告、MV、宣传片中需要电影感氛围的片段。

- 作为创意 Look 叠加在 Rec.709 素材上（需适当调节强度）。

- 使用 DaVinci Resolve、Premiere Pro、Final Cut Pro 等支持 3D LUT 的软件。

## 不适用场景

- 要求色彩精确还原的工作（如产品拍摄、医学影像、色彩科学测试）。

- 非 Log 且已正常曝光的 Rec.709 素材直接套用（可能出现色偏、过暗或高光细节丢失）。

- HDR 制作（该 LUT 未针对 PQ/HLG 曲线优化）。

- 其他品牌相机（如索尼、松下）的原始素材，因色彩科学差异可能导致不可预测的结果。

> 建议在使用前先通过示波器（波形/矢量）检查输出范围，避免裁切。最佳实践是将其放在节点流程的 Log 转线性或 Log 转 Rec.709 转换之后，或者作为风格化 LUT 混合使用。