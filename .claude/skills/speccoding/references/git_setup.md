# Git 环境准备与分支创建

本文件定义了 `git branch` 阶段的完整流程，包括 Git 安装检测、仓库初始化、分支创建。

## 目标
确保项目具有可用的 Git 仓库，并为当前变更创建隔离的特性分支。

## 流程概览
1. 检测 Git 是否安装 → 未安装则引导安装
2. 检查是否为 Git 仓库 → 不是则执行 `git init`
3. 创建特性分支 `feature/<change-name>`
4. 记录父分支信息

---

## 步骤 1：检测 Git 是否可用

执行命令：
```bash
git --version
```

- **成功**（返回版本号，如 `git version 2.34.0`）：进入 **步骤 2**。
- **失败**（`command not found`）：进入 **步骤 1.1（安装引导）**。

### 步骤 1.1：Git 未安装时的处理

向用户展示以下选项：

> **检测到当前环境未安装 Git，这是本工作流的必需工具。请选择安装方式：**
>
> - **A. 自动安装**（需要 sudo 权限，仅支持 Linux/macOS）
> - **B. 手动安装**（我会提供安装指引）
> - **C. 放弃**（终止工作流）

#### 选项 A：自动安装（仅限 Linux/macOS）

根据操作系统执行对应命令：

| 系统 | 命令 |
|------|------|
| macOS (Homebrew) | `brew install git` |
| Ubuntu/Debian | `sudo apt update && sudo apt install git -y` |
| CentOS/RHEL | `sudo yum install git -y` |
| Fedora | `sudo dnf install git -y` |
| Arch Linux | `sudo pacman -S git` |

执行后重新检查 `git --version`：
- 若成功，进入 **步骤 2**。
- 若仍失败，提示用户手动安装（降级到选项 B）。

#### 选项 B：手动安装

提供官方下载链接：https://git-scm.com/downloads

告知用户：“请根据您的操作系统下载并安装 Git。安装完成后，请回复‘已安装’。”

用户回复“已安装”后，重新执行 **步骤 1**。

#### 选项 C：放弃

停止所有开发工作，输出：“本工作流依赖 Git，无法继续。”

---

## 步骤 2：检查是否为 Git 仓库

在项目根目录执行：
```bash
git rev-parse --git-dir 2>/dev/null
```

- **成功**（输出 `.git` 路径）：已是 Git 仓库，进入 **步骤 4**。
- **失败**（非零退出码）：不是 Git 仓库，进入 **步骤 3（初始化仓库）**。

---

## 步骤 3：初始化 Git 仓库

执行：
```bash
git init
```

输出：“Git 仓库已初始化（空仓库）。”

### 可选：创建初始提交

询问用户：“建议先进行一次初始提交（如 `git commit --allow-empty -m "Initial empty commit"` 或添加 README）。是否现在创建初始提交？(是/否)”

- **是**：执行 `git commit --allow-empty -m "Initial empty commit"`
- **否**：记录到 `spec/devlog.md` 中，说明“用户选择稍后提交”

进入 **步骤 4**。

---

## 步骤 4：创建特性分支

### 4.1 确定父分支

获取当前分支名：
```bash
git branch --show-current
```

- 如果输出 `main` 或 `master`，父分支即为此名称。
- 如果输出为空（空仓库尚无分支），则：
  - 先创建 `main` 分支：`git checkout -b main`
  - 父分支设为 `main`

### 4.2 创建并切换到新分支

分支命名规范：`feature/<change-name>`（kebab-case，与 proposal 阶段名称一致）

```bash
git checkout -b feature/<change-name>
```

### 4.3 记录父分支信息

将父分支名保存到以下位置之一（推荐第一种）：

- **方案 A**：写入变更目录下的 `proposal.md` 元数据：
  ```markdown
  ---
  parent_branch: main
  ---
  ```

- **方案 B**：保存在 `.git/.speccoding_parent_branch` 文件中：
  ```bash
  echo "main" > .git/.speccoding_parent_branch
  ```

---

## 步骤 5：验证分支创建成功

执行：
```bash
git branch --show-current
```

输出应为 `feature/<change-name>`。若不一致，报错并停止。

---

## 完成提示

> “分支 `feature/<change-name>` 已创建并切换。请继续进入 proposal 阶段。”
