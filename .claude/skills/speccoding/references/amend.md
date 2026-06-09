# Amend 阶段 — 修订规格或计划

## 阶段目标
当需求、设计或实现计划需要变更时，安全地更新 `proposal.md` / `design.md` / `spec.md` / `plan.md`，并重新生成 `plan.md`（必要时）。

## 输入条件
- 已有活跃变更目录，且至少包含 `plan.md`（或 `spec.md`）
- 用户提出修改请求：“我想改一下……”，“范围增加……”，“验收条件变了……”

## 核心流程

### 1. 识别修改范围
询问用户具体要修改哪一部分：
- 需求（proposal.md 中的 What/Why/Acceptance Criteria）
- 设计（design.md 中的技术方案）
- 规格（spec.md 中的 Requirement/Scenario）
- 实现计划（plan.md 中的任务项）

### 2. 应用修改
- 直接编辑对应的 Markdown 文件。
- 保持文档结构完整，对于 `plan.md` 的修改，如果影响任务依赖关系，需要重新排序。

### 3. 重新生成详细计划（可选但推荐）
如果修改较大（如新增后端接口），可以调用 Superpowers `writing-plans` 重新生成更细粒度的 `plan.md`。  
**如果 Superpowers 不可用**：手动更新 `plan.md` 中的 checkbox 列表，确保所有新增步骤都被列出。

### 4. 验证规格一致性
- 如果修改了 `spec.md`，检查 `plan.md` 是否覆盖了新需求。
- 如果不匹配，主动调整 `plan.md`。

### 5. 确认并提示
- 将修改后的文件展示给用户。
- 询问“修改完成，是否继续执行？”
- 若用户同意，回到 `executing` 阶段（如果已有部分完成，注意标记已完成项）。

## 出口条件
- 修改后的文档已保存，用户确认。
- 如果需要继续执行，技能状态应切回 `executing` 且保留原有进度。

## 禁止行为
- ❌ 直接修改代码（即使在 executing 中中断，也要先完成 amend 再回到 executing）
- ❌ 删除用户明确要求的验收条件