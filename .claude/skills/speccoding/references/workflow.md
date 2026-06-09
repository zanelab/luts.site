# 八阶段工作流详解

本文档详细描述 Speccoding 技能的核心工作流。每个阶段的具体交互和产物要求请参考对应的独立文件（如 `proposal.md`）。

## 阶段顺序

```
git branch → proposal → brainstorming → spec → amend → executing → archive → merge
```

> `amend` 可以在任意阶段之后插入（除 `archive`/`merge` 外），用于修订已有产出。

## 1. git branch（创建分支）

**目的**：为当前变更创建工作分支，确保隔离。

**详细流程**：请参考 **`references/git_setup.md`**。

执行该文件中的完整流程后，返回本工作流继续进入 proposal 阶段。

## 2. proposal（创建提案）

**目的**：快速收敛需求，产出轻量级提案文档。

**详细文档**：`references/proposal.md`

**核心产物**：`openspec/changes/<change-name>/proposal.md`

## 3. brainstorming（头脑风暴）

**目的**：对复杂需求进行深度设计探索，产出技术方案与权衡分析。

**详细文档**：`references/brainstorming.md`

**核心产物**：`openspec/changes/<change-name>/design.md`（可选更新 proposal.md）

## 4. spec（制定规范）

**目的**：将提案和设计转化为 OpenSpec 标准规格和可执行的实现计划。

**详细文档**：`references/spec.md`

**核心产物**：
- `openspec/changes/<change-name>/spec.md`（需求规格）
- `openspec/changes/<change-name>/plan.md`（checkbox 实现计划）

## 5. amend（修订规范）

**目的**：在实现前或实现中修改需求、设计、规格或计划。

**详细文档**：`references/amend.md`

**核心动作**：更新已有文档，必要时重新生成 `plan.md`。

## 6. executing（执行）

**目的**：严格按照 `plan.md` 实现代码，遵循 TDD。

**详细文档**：`references/executing.md`

**核心动作**：循环：测试→实现→重构→标记 checkbox。

## 7. archive（归档）

**目的**：将完成的变更归档，更新项目级规格。

**详细文档**：`references/archive.md`

**核心动作**：移动变更到 `archive/`，更新 `spec/` 下的项目级文档。

## 8. merge（合并分支）

**目的**：将特性分支合并回父分支。

**触发**：用户明确输入“merge”或“合并分支”。

**步骤**：
1. 确保所有测试通过，`plan.md` 全部勾选。
2. 切换到父分支并拉取最新代码：
   ```bash
   git checkout <parent-branch>
   git pull
   ```
3. 合并特性分支：
   ```bash
   git merge --no-ff feature/<change-name>
   ```
4. 如果有冲突，提示用户解决，不自动解决。
5. 删除本地特性分支（可选）：
   ```bash
   git branch -d feature/<change-name>
   ```

**注意**：AI 不能自动执行 `git merge` 而不经用户明确确认。


## 阶段间流转

- 每个阶段完成后，AI 应主动提示用户可以进入的下一个阶段（例如：“proposal 已完成，是否进入 brainstorming 或直接 spec？”）。
- 用户可以直接说“进入 spec”或“开始执行”，技能应根据当前状态切换到对应阶段。
