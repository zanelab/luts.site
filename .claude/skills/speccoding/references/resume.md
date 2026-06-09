# 中断恢复与状态检测

本文档定义了当对话中断或 AI 重新启动后，如何检测当前 Speccoding 工作流的状态，并正确恢复执行。

## 状态检测流程

当用户调用本技能，或 AI 发现项目中有 Speccoding 痕迹时，执行以下检测：

### 1. 检查是否有活跃变更

```bash
# 查找 openspec/changes/ 下非 archive 的子目录
ls -d openspec/changes/*/ 2>/dev/null | grep -v archive
```

- **结果 A**：没有活跃变更 → 状态为 `no_active_change`
- **结果 B**：有一个或多个活跃变更 → 选择最新的（按修改时间或名称排序），进入下一步。

### 2. 检查活跃变更的状态

对于选定的变更目录 `openspec/changes/<name>/`：

#### 2.1 是否存在 `plan.md`？
- **不存在** → 状态为 `need_spec`（需要进入 spec 阶段生成 plan.md）
- **存在** → 检查 `plan.md` 中的 checkbox 完成情况。

#### 2.2 统计 checkbox 完成比例
- 读取 `plan.md`，统计所有 `- [ ]` 和 `- [x]` 行。
- 如果没有 checkbox（即没有任务列表），则视为无效 plan，建议重新生成。

| 完成比例 | 状态 |
|----------|------|
| 0% | `plan_not_started` |
| 1% – 99% | `plan_in_progress` |
| 100% | `plan_completed` |

#### 2.3 额外检查是否存在 `spec.md`
- 如果 `plan.md` 存在但 `spec.md` 不存在，状态仍为 `need_spec`（因为 plan 应基于 spec）。

### 3. 归档检查

如果 `plan_completed` 但变更目录尚未移到 `archive/`，状态为 `ready_to_archive`。

## 状态映射到阶段

| 检测结果 | 应恢复的阶段 | 下一步动作 |
|----------|--------------|------------|
| `no_active_change` | proposal | 提示用户创建新提案 |
| `need_spec` | spec | 根据现有 proposal/design 生成 spec.md 和 plan.md |
| `plan_not_started` | executing（但需要用户确认开始） | 展示 plan.md 摘要，询问“是否开始执行？” |
| `plan_in_progress` | executing | 从第一个未完成任务继续 |
| `plan_completed` | archive | 提示“实现已完成，是否归档？” |
| `ready_to_archive` | archive | 执行归档流程 |

## 中断恢复的具体操作

当对话中断后重新进入，AI 应该：

1. **执行上述状态检测**。
2. **向用户报告当前状态**：
   > “检测到当前活跃变更为 `[变更名称]`，阶段为 `[阶段名]`，已完成 X/Y 任务。”
3. **询问是否继续**：
   > “是否从中断处继续？回复‘继续’或指定新阶段。”
4. **如果用户回复“继续”**，根据状态映射进入对应阶段，并加载相应的 `references/*.md` 文件。
5. **如果用户指定新阶段**（如“进入 amend”），则切换阶段（需检查前置条件，如 amend 需要已有 plan.md）。

## 恢复时的特殊规则

- **从 proposal/brainstorming/spec/amend 恢复**：禁止直接修改代码，只能继续更新文档。
- **从 executing 恢复**：读取 `plan.md`，找到第一个未勾选的任务，从该任务继续执行（不重复已完成的任务）。
- **如果用户补充了新的需求或修改范围**，即使当前是 executing，也应提示：“检测到需求变更，建议先使用 `amend` 修订计划，然后再继续执行。” 不能直接改代码。

## 处理多个活跃变更

如果存在多个活跃变更（不推荐，但可能发生）：

- 默认选择最近修改的变更。
- 向用户列出所有活跃变更，请用户选择一个：
  > “检测到多个活跃变更：1. add-login, 2. fix-cache。请选择要恢复的变更编号或名称。”

## 示例：状态报告输出格式

```markdown
## 当前工作流状态

- **活跃变更**：`add-email-login`
- **阶段**：executing（进行中）
- **计划进度**：5/8 任务已完成
- **下一个未完成任务**：实现 POST /auth/login 接口

是否继续执行？回复“继续”或输入其他指令。
```

## 无任何 Speccoding 痕迹时

- 检查是否存在 `spec/` 目录或 `openspec/` 目录。
- 如果不存在，视为新项目，进入初始化流程（参考 `workflow.md#init`）。
- 如果存在部分结构（例如只有 `spec/`），提示用户：“检测到项目已部分初始化，是否继续？如需全新初始化，请手动清理目录。”

## 工具不可用时的恢复

如果 OpenSpec 或 Superpowers 不可用，但 `plan.md` 已经存在，AI 仍可以继续 executing。仅当需要生成新 plan 或归档时，才需要后备方案（如手动创建文件）。具体后备操作参考 `SKILL.md` 中的“依赖工具后备方案”。