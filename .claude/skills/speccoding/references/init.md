# 项目初始化（init）

当在空目录或没有 `spec/` / `openspec/` 结构时触发。本流程负责创建完整的 SpecCoding 工作目录、动态适配项目架构，并安装强制规则文件 `AGENTS.md`。

以下所有步骤（1–9）**必须全部执行完成后**，才能进入下一阶段。

## 步骤 1：检测 OpenSpec CLI

运行以下命令检查 OpenSpec 是否可用：

```bash
openspec --version
```

- **若成功**（返回版本号）：使用 CLI 初始化，进入 **步骤 2（CLI 模式）**。
- **若失败**（命令未找到）：降级为手动创建，进入 **步骤 3（手动模式）**。

## 步骤 2：使用 OpenSpec CLI 初始化（推荐）

1. 在项目根目录执行：
   ```bash
   openspec init
   ```
   这会自动创建 `openspec/` 目录、`openspec/config.yaml` 以及示例变更结构。

2. 验证并确保 schema 为 `spec-driven`：
   ```bash
   cat openspec/config.yaml | grep schema
   ```
   - 如果输出 `schema: spec-driven`，则继续。
   - 如果输出其他值或没有该字段，手动编辑 `openspec/config.yaml`，设置 `schema: spec-driven`。

3. 跳过后续手动创建步骤，直接进入 **步骤 4**。

## 步骤 3：手动创建 openspec/（降级模式）

如果 OpenSpec CLI 不可用，手动创建目录和基础文件：

```bash
mkdir -p openspec/changes/archive
```

创建 `openspec/config.yaml`：

```yaml
schema: spec-driven
```

## 步骤 4：创建项目级 Spec 目录

```bash
mkdir -p spec/
```

在 `spec/` 下创建以下模板文件（如果不存在）：

| 文件 | 初始内容 |
|------|----------|
| `requirements.md` | `<!-- 请填写项目整体需求 -->` |
| `design.md` | `<!-- 请填写架构设计 -->` |
| `tasks.md` | `<!-- 请填写里程碑任务 -->` |
| `devlog.md` | `# 开发日志\n\n## 初始化\n- 日期：$(date) 初始化 SpecCoding 结构` |
| `structure.md` | `<!-- 项目目录结构说明 -->` |

## 步骤 5：动态创建代码目录（根据项目架构）

**目标**：只创建项目实际需要的代码目录，避免生成无用文件夹。

### 5.1 探测已有目录

检查当前根目录下是否已存在常见代码目录：

```bash
ls -d backend/ frontend/ mobile/ web/ app/ api/ 2>/dev/null
```

记录已存在的目录。

### 5.2 询问用户项目架构

向用户提问（以选择题形式）：

> **请选择本项目的技术架构（可多选）：**
>
> 1. 后端服务 (backend) → 将创建 `backend/` 目录
> 2. 前端 Web (frontend) → 将创建 `frontend/` 目录
> 3. 移动端 App (mobile) → 将创建 `mobile/` 目录
> 4. 全栈 (后端+前端) → 同时创建 `backend/` 和 `frontend/`
> 5. 其他（请说明）→ 根据描述创建自定义目录
>
> 如果某些目录已经存在，我会跳过创建，直接使用现有目录。

### 5.3 根据回答创建目录

```bash
# 示例：若用户选择后端+前端
mkdir -p backend frontend
```

如果用户选择“其他”，追问具体目录名称，然后创建。

### 5.4 记录架构选择到 `spec/structure.md`

将用户选择的架构及目录结构写入 `spec/structure.md`，格式示例：

```markdown
# 项目目录结构说明

project/
├── spec/                     # 项目级 Spec
│   ├── requirements.md       # 整体需求
│   ├── design.md             # 架构设计
│   ├── tasks.md              # 里程碑任务
│   ├── devlog.md             # 开发日志
│   └── structure.md          # 本文档
├── openspec/                 # OpenSpec 配置
│   ├── config.yaml           # OpenSpec 配置
│   ├── specs/                # 长期规格
│   └── changes/
│       └── archive/          # 已归档变更
├── backend/                  # 后端代码
├── frontend/                 # 前端代码
└── AGENTS.md                 # 开发规则
```

## 步骤 6：安装 AGENTS.md（强制工作流入口）

1. 读取当前技能目录下的 `assets/AGENTS.md` 文件（相对路径 `./assets/AGENTS.md`）。
2. 检查项目根目录是否存在 `AGENTS.md`：
   - 若不存在，直接创建并写入模板内容。
   - 若已存在，询问用户：
     > “检测到已有 `AGENTS.md`，是否将 SpecCoding 规则追加到文件末尾？(是/否/覆盖)”
     - **是**：在现有文件末尾追加 `<!-- SpecCoding 强制规则开始 -->` 及模板内容。
     - **覆盖**：用模板内容完全替换原文件。
     - **否**：跳过安装，但记录警告到 `spec/devlog.md`。
3. 告知用户：“AGENTS.md 已就位，后续所有开发将强制遵循 SpecCoding 工作流。”

## 步骤 7：引导用户填写需求与设计

- 询问项目目标、核心功能、技术约束。
- 根据回答协助填充 `spec/requirements.md`、`spec/design.md` 和 `spec/tasks.md`。
- 如果用户明确拒绝填写，在 `devlog.md` 中记录“需求待补充”，但仍可继续。

### 步骤 8. 验证完整性

确认以下文件存在：
- [ ] `spec/requirements.md`
- [ ] `spec/design.md`
- [ ] `spec/tasks.md`
- [ ] `spec/devlog.md`
- [ ] `spec/structure.md`
- [ ] `openspec/config.yaml`
- [ ] `AGENTS.md`

### 步骤 9. 通知并流转

> ”SpecCoding 工作流已初始化完成。目录结构已根据您的架构创建。进入下一阶段。”

**只有完成步骤 1–9 后**，才能进入 proposal 或其他阶段。