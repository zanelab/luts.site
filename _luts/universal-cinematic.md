---
layout: lut
title: Blackmagic Camera 通用电影胶片感的 LUT
date: 2026-06-15 20:00:00 +0800
lutId: 02d1fd01-1d69-4d25-9a5e-14b8d2b287d4
paid: true
price: 1
afdianSkuId: f1316b08689511f19efc52540025c377
afdianOrderUrl: https://ifdian.net/item/f1316b08689511f19efc52540025c377
excerpt: "将视频素材从一种色彩空间（如 Log、Rec.709）映射到另一种风格化色彩（如电影胶片感、复古调等）。为影片统一视觉风格，模拟特定电影质感或创意色调。"
beforeImg: /assets/images/luts/universal-cinematic/before.png
afterImg: /assets/images/luts/universal-cinematic/after.png
tags:
  - 电影风格
---

## 作用

这是一个 65×65×65 的三维色彩映射表，后面跟着大量 RGB 浮点数值（共 65³ = 274625 行数据），用于将输入色彩空间中的每个颜色转换为输出色彩空间中的目标颜色。将视频素材从一种色彩空间（如 Log、Rec.709）映射到另一种风格化色彩（如电影胶片感、复古调等）。为影片统一视觉风格，模拟特定电影质感或创意色调。在 DaVinci Resolve、Premiere Pro、Final Cut Pro、 Blackmagic Camera 等软件中加载此 LUT，快速应用预设的色彩分级效果。

## 适用场景

- 视频后期调色：在专业剪辑/调色软件中套用该 LUT，快速实现特定色彩风格。

- 电影或短片制作：统一不同机位素材的色调，或营造整体的电影感。

- 色彩空间转换：例如将 Log 素材转换为 Rec.709 或 DCI-P3 时使用。

- 实时预览：在支持 LUT 的监视器或摄影机中实时加载，用于拍摄现场监看。

## 不适用场景

- 动态色彩调整：LUT 是静态映射，无法根据画面内容自适应调整（如自动白平衡、曝光补偿）。

- 非 RGB 色彩空间：若素材为 YUV、CMYK 等非 RGB 线性色彩空间，直接应用可能导致色彩异常，需先转换。

- 交互式调色：LUT 只能整体应用，不能单独调节色相、饱和度、亮度等参数。

- 低端或移动端软件：部分简易视频编辑软件（如手机版剪映）不支持加载 3D LUT。

- 性能受限设备：3D LUT 对运算有一定要求，极低端设备可能处理缓慢。

> 注意：该文件是完整的 65 级 LUT，可直接在 Blackmagic Camera 中通过“LUT 导入”功能使用。

