---
name: speccoding
description: "SpecCoding 全栈开发工作流 skill。当用户提出任何与项目开发、功能添加、修改、重构、bug修复、优化、设计讨论、需求变更等相关的任务时，必须使用本技能。本技能强制采用八阶段工作流（git branch → proposal → brainstorming → spec → amend → executing → archive → merge），禁止在未激活工作流的情况下直接编写代码。适用于新项目初始化或既有项目工作流规范化。"
version: 1.0.0
author: zanelab
license: MIT
platforms: [linux, macos]
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
metadata:
  hermes:
    tags: [spec-coding, openspec, superpowers, workflow, development]
  homepage: https://github.com/zanelab/speccoding-skill
  template: https://github.com/zanelab/speccoding-skill
---

# speccoding — SpecCoding 全栈开发工作流

## 快速索引

| 内容 | 文件 |
|------|------|
| 项目初始化 | `references/init.md` |
| Git 环境准备与分支创建 | `references/git_setup.md` |
| 八阶段工作流详解 | `references/workflow.md` |
| 阶段写入边界规则 | `references/boundaries.md` |
| 中断恢复与状态检测 | `references/resume.md` |
| proposal 阶段详情 | `references/proposal.md` |
| brainstorming 阶段详情 | `references/brainstorming.md` |
| spec 阶段详情 | `references/spec.md` |
| amend 阶段详情 | `references/amend.md` |
| executing 阶段详情 | `references/executing.md` |
| archive 阶段详情 | `references/archive.md` |

> **重要**：本 `SKILL.md` 仅包含概览和强制规则。执行具体阶段时，请加载对应的 `references/*.md` 文件获取详细指令。

## 核心理念

**设计靠人决策，执行尽量自主。**

| 阶段 | AI 姿态 |
|------|---------|
| 方案制定（proposal/brainstorming/spec/amend） | 多问、列 trade-off、关键判断交给人类 |
| 执行落地（executing） | 尽量自主推进，按 plan 执行 |

## 两级 Spec 体系

| 层级 | 位置 | 回答的问题 | 维护时机 |
|------|------|------|----------|
| **项目级** | `spec/` | 我们做什么产品、为什么做 | 版本 kickoff 和 openspec 归档两界 |
| **需求级** | `openspec/changes/<name>/` | 这次变更做什么、怎么做 | brainstorming / spec 自动生成 |

## 工作目录结构

```
project/
├── spec/                     # 项目级 Spec
│   ├── requirements.md       # 整体需求（累积式）
│   ├── design.md             # 架构设计
│   ├── tasks.md              # 里程碑任务（按版本分块）
│   ├── devlog.md             # 开发日志
│   └── structure.md          # 目录结构说明
├── openspec/                 # 需求级 Spec
│   ├── config.yaml           # OpenSpec 配置（schema: spec-driven）
│   ├── specs/                # 从变更提炼的长期规格
│   └── changes/
│       └── archive/          # 已归档变更
├── backend/                  # 后端代码
├── frontend/                 # 前端代码
├── prototype/                # 原型设计
└── AGENTS.md                 # 代理配置
```

## 八阶段概览

| 阶段 | 触发词示例 | 详细文档 |
|------|-----------|----------|
| **1. git branch** | `git branch`、`创建分支` | `references/workflow.md#git-branch` |
| **2. proposal** | `创建提案`、`添加功能`、`新需求` | `references/proposal.md` |
| **3. brainstorming** | `头脑风暴`、`帮我设计`、`探索方案` | `references/brainstorming.md` |
| **4. spec** | `制定计划`、`生成规格`、`生成 plan.md` | `references/spec.md` |
| **5. amend** | `修改计划`、`变更范围`、`调整验收` | `references/amend.md` |
| **6. executing** | `开始执行`、`实现`、`继续开发` | `references/executing.md` |
| **7. archive** | `归档`、`完成变更` | `references/archive.md` |
| **8. merge** | `git merge`、`合并分支` | `references/workflow.md#merge` |

## 强制规则（不可违反）

### 1. 阶段写入边界

| 阶段 | 允许写入 | 禁止写入 |
|------|----------|----------|
| proposal / brainstorming / spec / amend | `openspec/changes/**` 中的文档 | 任何代码、测试、实现文件 |
| executing | 代码、测试、`plan.md` checkbox | 规格文档（除非另开 amend） |
| archive | 归档记录、`spec/` 更新 | 代码、测试 |

> 详细边界规则见 `references/boundaries.md`

### 2. 中断恢复规则

- 恢复时先执行状态检测（见 `references/resume.md`）
- 若上一阶段是 proposal/brainstorming/spec/amend，禁止直接改代码
- 若 executing 中断，从 `plan.md` 第一个未完成任务继续

### 3. 依赖工具后备方案

| 工具 | 不可用时 |
|------|---------|
| OpenSpec | 手动创建 `openspec/changes/<name>/spec.md`，遵循简单格式（需求 + Scenario） |
| Superpowers | AI 手动根据 `plan.md` 拆解子任务，记录在 `docs/manual_plan.md` |
| Git | 版本控制、分支管理 | 自动安装（Linux/macOS）或提示手动安装 |

## 歧义处理（默认动作）

当用户输入不明确，且无法从上下文判断当前阶段时：

1. **输出状态报告**：
   - 是否有活跃变更？（`openspec/changes/` 下非 archive 目录）
   - 是否有 `plan.md`？checkbox 完成比例？
2. **列出可能的下一步**：
   - 无活跃变更 → `proposal`
   - 有 proposal 无 plan → `spec`
   - 有 plan 未完成 → `executing`
   - 计划完成 → `archive`
3. **要求用户确认**：
   > “请明确指定要进入的阶段，或直接描述您的需求。”

## 初始化新项目

当在空目录或没有 `spec/` 结构时：

> 详细初始化流程见 `references/init.md`

## 需求指令的强制路由规则

当用户提出任何与项目开发、功能变更、问题修复、优化相关的需求时（无论是否明确提到“需求”二字），AI **必须**按照以下逻辑处理：

### 第一步：判断当前是否已有活跃变更
- 通过状态检测（见 `references/resume.md`）确定是否存在非归档的变更目录。
- 若有，且用户没有明确要求“新变更”，则默认继续当前变更的流程（根据当前阶段执行）。
- 若无，或用户明确要求新功能/新需求，则进入 **第二步**。

### 第二步：强制进入 proposal 阶段
- **禁止**在 proposal 阶段完成之前编写任何代码、创建任何实现文件、修改已有代码。
- 即使需求看似“很简单”，也必须先生成 `proposal.md` 并由用户确认。
- 如果用户试图跳过（例如“就按这个做，不用写提案”），AI 应礼貌拒绝并解释工作流规范。

### 第三步：遵循八阶段顺序
- 完成 proposal 后，提示用户进入 brainstorming（复杂需求）或直接 spec（简单明确需求）。
- 任何时候用户提出新的需求变更（非当前变更范围），都应触发 `amend` 阶段或启动新变更（取决于影响范围）。
