# Proposal 阶段 — 轻量提案

## 阶段目标
快速理解用户需求，收敛为清晰的变更提案，产出一个最小但可评审的 `proposal.md`。

## 输入条件
- 用户提出新需求、功能或修改，且尚未建立活跃变更目录。
- 或者状态检测发现无活跃变更，自动进入本阶段。

## 核心流程

### 1. 创建变更目录
```bash
mkdir -p openspec/changes/<change-name>/
```
`<change-name>` 使用 kebab-case，简要描述变更内容（如 `add-email-login`）。

### 2. 引导用户回答以下问题
向用户提问，并记录答案到 `proposal.md`：

- **What**：具体要做什么？（功能描述、用户故事）
- **Why**：为什么需要这个变更？（业务价值或问题）
- **Scope**：影响哪些模块？（backend / frontend / both）
- **Acceptance Criteria**：验收标准是什么？（可量化的条件，每条以 `- [ ]` 开头）

### 3. 产出 `proposal.md`
模板如下：

```markdown
# Proposal: <变更名称>

## What
[用户回答]

## Why
[用户回答]

## Scope
- [ ] backend
- [ ] frontend

## Acceptance Criteria
- [ ] 条件1
- [ ] 条件2

## Status
- [ ] 提案已确认
```

### 4. 确认闭环
- 将生成的 `proposal.md` 展示给用户，询问“以上内容是否准确？是否有补充？”
- 若用户确认，标记 `Status: - [x] 提案已确认`，然后提示：
  > “提案已确认。接下来请使用 `brainstorming` 进行深度设计，或直接使用 `spec` 制定实现计划。”

## 出口条件
- `openspec/changes/<change-name>/proposal.md` 存在且用户已确认。
- Status 中的“提案已确认”已勾选。

## 禁止行为
- ❌ 创建任何代码文件（`.js`, `.py`, `.go` 等）
- ❌ 修改已有代码或测试文件
- ❌ 生成 `design.md` 或 `plan.md`（那是后续阶段的事）
