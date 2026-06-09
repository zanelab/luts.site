# Archive 阶段 — 归档变更

## 阶段目标
将完成的变更归档到 OpenSpec 归档目录，更新项目级规格（`spec/`），并清理工作目录。

## 输入条件
- `plan.md` 中所有 checkbox 均为 `- [x]`
- 代码已合并到父分支（或者本地确认实现完成）
- 用户同意归档

## 核心流程

### 1. 验证一致性
- 检查 `plan.md` 是否全部完成。
- 运行测试套件（如果有）确保所有测试通过。
- 若有 `openspec` 工具，运行：
  ```bash
  openspec change validate <change-name>
  ```

### 2. 归档变更
将变更目录移动到 `openspec/changes/archive/` 下：
```bash
mv openspec/changes/<change-name> openspec/changes/archive/<change-name>-$(date +%Y%m%d)
```
如果使用 `openspec archive` 命令，则运行：
```bash
openspec change archive <change-name>
```

### 3. 更新项目级 Spec（`spec/`）
根据本次变更的内容，更新以下项目级文档：

- **`spec/requirements.md`**：添加或修改整体需求描述（如有新增用户故事）。
- **`spec/design.md`**：如果架构有重大调整，更新对应章节。
- **`spec/tasks.md`**：标记对应里程碑任务为已完成。
- **`spec/devlog.md`**：记录本次变更的摘要、日期和产出。

注意：项目级文档是累积式维护，不要删除历史内容。

### 4. 创建 `close-issues.md`（可选）
在归档目录中创建一个 `close-issues.md`，列出本次变更关闭的问题或 PR 引用。

### 5. 清理 Git 分支（可选）
```bash
git checkout <parent-branch>
git branch -d feature/<change-name>
```

### 6. 完成通知
> “变更已归档。项目级规格已同步更新。可以开始新的变更了。”

## 出口条件
- 变更目录已移入 `archive/`。
- `spec/` 下相关文件已更新。

## 禁止行为
- ❌ 在实现未完成时归档。
- ❌ 删除未合并的代码分支而不询问用户。