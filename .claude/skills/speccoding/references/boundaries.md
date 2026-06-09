# 阶段写入边界规则

本文件定义了每个阶段**允许**和**禁止**的文件写入操作。AI 必须严格遵守，违反将导致流程混乱。

## 通用原则

- 规格文档（proposal.md, design.md, spec.md, plan.md）只能由 **proposal / brainstorming / spec / amend** 阶段修改。
- 代码和测试文件只能由 **executing** 阶段修改。
- `spec/` 项目级文档只能在 **archive** 阶段或 **init** 时更新。

## 各阶段详细边界

### proposal
| 允许写入 | 禁止写入 |
|----------|----------|
| `openspec/changes/<name>/proposal.md` | 任何代码文件（`.js`, `.py`, `.go`, `.java` 等） |
| | 任何测试文件 |
| | `design.md`, `spec.md`, `plan.md` |
| | `spec/` 下的任何文件 |

### brainstorming
| 允许写入 | 禁止写入 |
|----------|----------|
| `openspec/changes/<name>/proposal.md`（补充） | 任何代码或测试文件 |
| `openspec/changes/<name>/design.md` | `spec.md`, `plan.md`（除非同时进行 spec 阶段） |
| | `spec/` 下的任何文件 |

### spec
| 允许写入 | 禁止写入 |
|----------|----------|
| `openspec/changes/<name>/spec.md` | 任何代码或测试文件 |
| `openspec/changes/<name>/plan.md` | `proposal.md`, `design.md`（除非 amend 阶段允许） |
| | `spec/` 下的任何文件 |

> 注意：spec 阶段可以创建或覆盖 `plan.md`，但不能修改已有代码。

### amend
| 允许写入 | 禁止写入 |
|----------|----------|
| 同一变更目录下的 `proposal.md`, `design.md`, `spec.md`, `plan.md` | 任何代码或测试文件 |
| | 其他变更目录的文件 |

### executing
| 允许写入 | 禁止写入 |
|----------|----------|
| 所有代码文件（按 `plan.md` 实现） | `openspec/changes/**` 中的任何规格文档 |
| 所有测试文件 | `spec/` 项目级文档 |
| `plan.md` 中的 checkbox 状态（仅允许将 `- [ ]` 改为 `- [x]`，不得修改任务描述或顺序） | 修改 `plan.md` 的非 checkbox 内容（如需修改，应提示使用 amend） |

### archive
| 允许写入 | 禁止写入 |
|----------|----------|
| 移动变更目录到 `archive/` | 任何代码或测试文件 |
| 更新 `spec/` 下的 `requirements.md`, `design.md`, `tasks.md`, `devlog.md` | 修改已归档的变更文件（只读） |
| 创建 `close-issues.md`（归档目录内） | |

### merge（不属于技能自动执行，但作为边界参考）
| 允许 | 禁止 |
|------|------|
| 执行 `git merge`（需用户确认） | 未经确认自动合并 |
| 解决冲突（仅提示，不自动） | 修改代码逻辑（除冲突标记外） |

## 边界违规处理

如果 AI 检测到自己即将违反边界（例如在 brainstorming 阶段试图修改代码），必须：
1. **立即停止**当前操作。
2. **提示用户**：“当前处于 `<阶段名>` 阶段，不允许修改代码。如需修改，请先使用 `amend` 切换阶段，或确认是否进入 executing。”
3. **不执行**违规写入。

如果用户强制要求“现在就改代码”（忽略阶段），AI 应回复：“遵循 Speccoding 工作流，请先输入 `executing` 进入实现阶段，或使用 `amend` 修订计划。”

## 检查清单（供 AI 自检）

在每个阶段结束前，AI 应默念：
- [ ] 我有没有修改任何不该在该阶段修改的文件？
- [ ] 所有允许的产物是否都已生成？
- [ ] 用户是否确认可以进入下一阶段？