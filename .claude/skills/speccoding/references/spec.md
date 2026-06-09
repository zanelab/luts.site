# Spec 阶段 — 生成规格与实现计划

## 阶段目标
将 proposal 和 design（如有）转化为：
1. OpenSpec 标准规格文档（可被 openspec 工具校验）
2. 可执行的实现计划 `plan.md`（checkbox 列表）

## 输入条件
- 已有活跃变更目录，且至少包含 `proposal.md`（可选包含 `design.md`）
- 用户明确要求“制定计划”或状态检测显示有 proposal 无 plan。

## 核心流程

### 1. 生成 OpenSpec 规格
在变更目录下创建 `spec.md`（若 openspec 工具可用则用其命令生成，否则手动）。内容应包含：

- **ADDED Requirements** / **MODIFIED Requirements** / **REMOVED Requirements**
- 每个需求带 Scenario（Given-When-Then）

示例：
```markdown
## ADDED Requirements

### Requirement: 用户邮箱登录
系统应支持使用邮箱和密码登录。

#### Scenario: 正确凭证
- Given 用户注册了邮箱 a@b.com 且密码正确
- When 用户提交邮箱 a@b.com 和对应密码
- Then 返回 JWT token 并跳转到主页
```

如果存在 `design.md`，将技术决策转化为需求条目。

### 2. 生成 `plan.md`（checkbox 实现清单）
将规格中的场景和任务拆解为可执行的步骤，使用 Markdown 任务列表。

模板：
```markdown
# Implementation Plan: <变更名称>

## Prerequisites
- [ ] 环境检查（Node.js >= 18, PostgreSQL 等）

## Backend
- [ ] 创建数据库迁移：用户表增加 `email` 和 `password_hash` 字段
- [ ] 实现 POST /auth/login 接口
- [ ] 添加邮箱密码验证逻辑
- [ ] 生成并返回 JWT

## Frontend
- [ ] 登录页面添加邮箱/密码输入框
- [ ] 调用登录 API 并存储 token
- [ ] 错误提示处理

## Testing
- [ ] 单元测试：密码验证函数
- [ ] 集成测试：登录流程
```

### 3. 调用 OpenSpec 校验（可选）
如果 `openspec` 命令可用：
```bash
openspec change validate <change-name>
```
若不可用，提示用户手动检查格式。

### 4. 展示并确认
- 将生成的 `spec.md` 和 `plan.md` 呈现给用户。
- 询问“计划是否完整？是否需要调整？”
- 根据反馈修改后，征得用户同意进入下一阶段。

### 5. 出口提示
> “规格和计划已就绪。请使用 `executing` 开始执行实现。”

## 出口条件
- `spec.md` 和 `plan.md` 均存在。
- 用户明确表示可以开始执行。

## 禁止行为
- ❌ 修改任何代码文件（`.js`, `.py`, 测试文件等）
- ❌ 执行 `plan.md` 中的任何实现步骤