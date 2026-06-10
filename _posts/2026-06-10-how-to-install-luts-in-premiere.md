---
title: 如何在 Premiere 中安装 LUT
date: 2026-06-10 11:00:00 +0800
tags: [教程,Premiere]
cover: /assets/images/2026/06/LUT-Lumetri-cover.webp
excerpt: 了解更多关于如何在 Premiere 中安装 LUT 以及只需几次点击就能完成专业视频调色的方法。让您的剪辑轻松快速地获得胶片感或电影级色彩校正。
---

## 如何在 Premiere Pro 中安装 LUT？

在 Premiere Pro 中安装 LUT 有多种方法，但我发现以下方法最简单。

### 在 Mac 上安装 LUT

- 步骤 1： 打开一个新的搜索窗口，进入 Library / Application Support / Adobe / Common / LUT
- 步骤 2： 找到名为“Creative”的文件夹并打开。如果该文件夹不存在，需要创建它。
- 步骤 3： 将 LUT 文件复制到这里。注意：您需要复制单个文件，而不是整个文件夹。
- 步骤 4： 重启 Premiere Pro。现在，LUT 应该会在 Lumetri 界面的“创意”(Creative) 选项卡的下拉列表中出现了。

### 在 Windows 上安装 LUT

- 步骤 1： 要安装 LUT，您需要将 LUT 文件移动到 Premiere Pro 的对应文件夹。默认路径为：C:\Program Files\Adobe\Adobe Premiere Pro CC [版本号]\Lumetri\LUTs\Creative
- 步骤 2： 重启 Premiere Pro（如果已打开），然后打开“颜色”面板 → Lumetri Color → “创意”(Creative) 选项卡，在下拉列表中找到您添加的 LUT。

## 如何在不安装的情况下直接使用 LUT？

![如何在不安装的情况下直接使用 LUT](/assets/images/2026/06/browse-luts-in-adobe-premiere.jpg)

如果您只需要临时使用一次 LUT，可以跳过安装步骤，直接使用。

- 步骤 1： 打开 Premiere Pro，点击“颜色”(Color) 选项卡 → Lumetri Color → “基本校正”(Basic Correction)。
- 步骤 2： 您会看到“输入 LUT”(Input LUT) 按钮，旁边有一个可点击的“无”(None) 字样。
- 步骤 3： 在电脑中找到所需的 LUT 文件并打开。如果需要，您可以在此处调整白平衡、色调、高光/阴影等参数。

> 注意：这样每次只能加载一个 LUT，当您加载另一个 LUT 时，前一个 LUT 会被替换掉。

## 如何创建 LUT？

有时网上找到的 LUT 并不能满足您对视频画面的需求和设想。在这种情况下，我建议您自己动手创建 LUT。这里有三种方法。

### 方法 1 – 使用 Adobe Premiere Pro

- 步骤 1： 打开 Premiere Pro，加载任意视频，进入“颜色”(Color) 选项卡 → Lumetri Color。
- 步骤 2： 进行视频色彩校正，先调整基本设置，然后是创意和曲线。
- 步骤 3： 找到顶部的“Lumetri Color”面板标题，标题旁边会有四条横线（菜单图标），点击它。
- 步骤 4： 选择“导出 .cube”(Export .cube) 按钮。选择保存文件的位置。您可以直接保存到 LUT 文件夹中以备长期使用：

![导出 LUT 文件](/assets/images/2026/06/export-cube-in-adobe-premiere.jpg)

**Windows 路径：**`C:\Program Files\Adobe\Adobe Premiere Pro CC [版本号]\Lumetri\LUTs\Creative`

**MacOS 路径：**`Library / Application Support / Adobe / Common / LUT`

这样您就得到了一个 Premiere 的 LUT 文件。您可以将其导入任何支持 .cube 文件的软件。

### 方法 2 – 使用 Adobe Lightroom

这种方法适合那些除了剪辑视频还从事摄影并已安装 Lightroom 的用户。在我看来，这是最长也最复杂的方法，但它提供了更多的色彩校正可能性。

- 步骤 1： 下载并安装免费的 IWLTBAP LUT Generator 软件。

- 步骤 2： 解压压缩包，并根据您的操作系统运行相应程序。同时，下载 [Neutral-125.png](/assets/images/2026/06/Neutral-125.png) 图片，该图片将用于后续操作。

- 步骤 3： 打开 Premiere Pro，在时间轴上选择需要的帧，截图保存。

![帧截图](/assets/images/2026/06/take-a-screenshot-in-adobe-premiere.jpg)

- 步骤 4： 打开 Lightroom，将截图以及 Neutral-125.png 导入图库。

- 步骤 5： 点击截图，对该帧进行色彩校正。注意：不要在这张图片上调整清晰度、细节、镜头校正、变换和特效，因为这些调整不会被应用到 LUT 中——LUT 文件仅记录颜色信息及其相关操作。

![颜色信息及其相关操作](/assets/images/2026/06/color-correction-in-lightroom.jpg)

- 步骤 6： 接下来，按 Ctrl (Cmd) + Shift + C，复制处理过的图像的所有设置，然后选中 Neutral-125.png，按 Ctrl (Cmd) + Shift + V 粘贴这些设置。

- 步骤 7： 导出得到的图片，PPI（每英寸像素）值设为 72。

- 步骤 8： 打开 IWLBTAP LUT Generator，点击“Convert to CUBE”，找到刚才导出的 Neutral-125.png 文件。

- 步骤 9： 回到 Premiere Pro，新建一个调整图层(Adjustment Layer)。将其移动到时间轴上，拉伸覆盖需要的素材片段，然后进入“颜色”(Color) 工作区。

![调整图层](/assets/images/2026/06/create-a-new-adjustment-layer.jpg)

- 步骤 10： 在时间轴上选中调整图层，打开“创意”(Creative) 选项卡，点击“浏览...”(Browse...)，找到生成的 .cube 文件并应用。完成！

### 方法 3 – 使用 Adobe Photoshop

如果上述创建 LUT 的方法对您来说略显困难，那么使用 Photoshop 的方法会快一倍。

- 步骤 1： 截取您想要制作 LUT 的视频的一帧，在 Photoshop 中打开这张截图。

- 步骤 2： 您只能在“调整图层”(Adjustment Layer) 上对图像进行处理（窗口 → 调整），其他任何对图片的直接修改都不会被应用到 LUT 中。

![Photoshop lut](/assets/images/2026/06/create-luts-in-photoshop.jpg)

- 步骤 3： 完成色彩校正后，导出文件：文件 → 导出 → 颜色查找表 (File → Export → Look Up Table)。选择 .cube 格式，这样您就可以将 LUT 添加到 Premiere 并在该软件中使用。

- 步骤 4： 选择质量。如果您的电脑性能足够，我推荐选择 256 格，否则导出会花费很长时间。

- 步骤 5： 选择保存文件的文件夹。您可以直接选择 Premiere Pro 的 LUT 文件夹：

**Windows 路径**：`C:\Program Files\Adobe\Adobe Premiere Pro CC [版本号]\Lumetri\LUTs\Creative`

**MacOS 路径**：`Library / Application Support / Adobe / Common / LUT`