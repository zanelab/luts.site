# Spec: 首页全配置化

## 1. 数据文件结构

创建 `_data/homepage.yml`，存储首页所有可配置内容：

```yaml
hero:
  slides:
    - title: "从拍摄到后期轻松实现"
      subtitle: "胶片/电影质感"
      image: /assets/images/slide1.jpg
      overlay: true
    - title: "你拍下的瞬间"
      subtitle: "值得更好的色彩"
      image: /assets/images/slide2.jpg
      overlay: true
    - title: "一个LUT"
      subtitle: "让日常变成电影截图"
      image: /assets/images/slide3.jpg
      overlay: true

sections:
  - type: vision
    title: "my vision"
    camera_image: /assets/images/2018/06/camera-img.png
    content: "让每一位手机创作者，都能用最少的步骤，得到最想要的色彩。"
    button_text: "跟我一起玩"
    button_url: "#"

  - type: portfolio
    title: "portfolio"
    items:
      - title: "Being in Your Control"
        categories: ["Creative", "Portrait"]
        images: ["/assets/images/2018/06/img8-1024x686.jpg", ...]
      - title: "Wondering How To Make Your work Rock?"
        categories: ["Nature"]
        images: [...]
      # ... 可排序

  - type: testimonials
    title: "testimonials"
    items:
      - quote: "..."
        author: "mark wallberg"
        role: "fashion designer"
        avatar: "/assets/images/2018/06/portrait5-262x300.jpg"
      # ... 可排序

  - type: about
    title: "about me"
    background_image: /assets/images/2018/06/bg-about-me.jpg
    greeting: "nice to meet you"
    name: "John Sallivan"
    bio: "..."
    stats:
      - icon: "camera"
        count: "132"
        label: "pounds of equipment"
      - icon: "photo"
        count: "280"
        label: "finished photosessions"
      # ...
    signature_image: /assets/images/2018/06/signature.png
```

## 2. 模板修改

### index.html → Jekyll 模板

```html
---
layout: base
---
<!-- 读取 site.data.homepage 渲染 hero 和 sections -->
```

### 创建组件

- `/_includes/components/hero.html` — 轮播区域
- `/_includes/components/section-vision.html`
- `/_includes/components/section-portfolio.html`
- `/_includes/components/section-testimonials.html`
- `/_includes/components/section-about.html`

## 3. 实现步骤

1. 创建 `_data/homepage.yml`
2. 创建 `/_includes/components/` 目录和各组件
3. 修改 `index.html` 为 Jekyll 模板，遍历 `homepage.sections` 渲染
4. 保留原有 CSS/JS 兼容性

## 4. 验收标准

- [ ] `index.html` 使用 `layout: base`
- [ ] `_data/homepage.yml` 包含所有首页内容
- [ ] hero slides 可配置、可排序
- [ ] sections 顺序可通过 YAML 调整
- [ ] 保留原有视觉效果