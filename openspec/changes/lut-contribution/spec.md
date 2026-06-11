# Spec: lut-contribution

## ADDED Requirements

### Requirement: admin 登录
系统应通过 Supabase Auth magic link 让 admin 登录审批队列；投稿流程本身不需要登录。

#### Scenario: admin 首次 magic link 登录
- Given admin 邮箱 `admin@example.com` 第一次登录
- When 在 Supabase UI 完成 magic link 验证
- Then `auth.users` 自动创建账号；DB trigger 自动在 `public.users` 插入一行 `{id, email, role='user'}`；admin 提升 role 用 bootstrap SQL

#### Scenario: 退出登录
- Given admin 已登录
- When 点击页头的「退出」按钮
- Then 调用 `supabase.auth.signOut()`，本地存储清空，头像回到「登录」按钮

#### Scenario: 同一邮箱重复登录
- Given admin 邮箱 `admin@example.com` 已存在 `public.users` 且 `role='admin'`
- When 再次 magic link 登录
- Then 不重复插入新行；既有 `role` 保持不变

### Requirement: 匿名投稿
任何访客（无需登录）可在 `/contribute/` 提交 `.cube` 文件；提交记录入库 `submissions`，文件存 private bucket。投稿人邮箱必填，用于限流 + 拒绝通知。

#### Scenario: 合法投稿（匿名）
- Given 访客未登录但浏览器支持 Turnstile
- When 在 `/contribute/` 填写合法字段（email、title 1-80、description 1-500、≤5 tags 各 ≤16 字、.cube ≤10MB）后点「投稿」
- Then Edge Function `submit-lut` 验证通过 → 文件上传到 `lut-submissions/submissions/null/{submission_id}.cube`（anonymous 用 `null/` 段） → `submissions` 表插入 `status='pending'` 行，`user_id = NULL`、 `user_email = 表单填的邮箱` → 所有 admin 5 分钟内收到通知邮件 → 页面提示「已投稿，状态 pending」+ 给出 submissionId

#### Scenario: 文件超 10MB
- Given 用户选择了一个 11MB 的文件
- When 点「投稿」
- Then 前端表单校验拦截，按钮置灰 + 红字提示「文件不能超过 10MB」；不发起请求

#### Scenario: 24h 限流
- Given 邮箱 `a@example.com` 过去 24h 已成功投稿 5 次（无论是否匿名）
- When 第 6 次提交
- Then Edge Function 返回 429 `{ error: 'rate_limited' }`；前端显示「投稿过于频繁，请稍后再试」

#### Scenario: 邮箱缺失
- Given 用户未填邮箱
- When 点「投稿」
- Then 前端校验拦截 + 红字提示「请填写邮箱」；不发起请求

#### Scenario: 字段超长
- Given 用户在 title 输入了 200 字
- When 点「投稿」
- Then Edge Function 400 `{ error: 'invalid_input' }`；前端弹红字提示「标题需 ≤80 字」

#### Scenario: 缺少 Turnstile
- Given `.env` 中 `TURNSTILE_SITE_KEY` 为 `TODO`（无真实配置）
- When 用户打开 `/contribute/`
- Then 表单顶部显示「人机验证未配置」红字 banner；投稿按钮始终 disabled；不发起请求

### Requirement: admin 直接发布
admin 在投稿表单勾选「直接发布」时，跳过审批队列，提交后直接写入 `luts` 表。匿名投稿也能用，但需要 admin 当前已登录（顶导右上角能看到自己头像）。

#### Scenario: admin 匿名勾选直接发布
- Given admin 已登录（JWT 存在）但未填账号资料
- When 在 `/contribute/` 填 email + 字段 + 勾选「直接发布」+ 上传 .cube + 点「投稿」
- Then Edge Function 读到 Authorization header → 验证 role='admin' → 调 publish 链路 → `submissions` 行 status='approved' + `published_lut_id` 指向新 luts 行；`luts` 表新增一行；`luts/{slug}.cube` 存在 public bucket；页面提示「已发布」+ 显示 luts.id

#### Scenario: 匿名用户勾选直接发布（越权）
- Given 浏览器未登录，但手工构造请求带 `direct_publish=true`
- When 提交
- Then Edge Function 无 JWT 头或 role='user' → 403 `{ error: 'forbidden' }`；前端兜底隐藏该开关（仅 admin 登录后才显示）

### Requirement: admin 审批队列
admin 角色用户访问 `/admin/submissions/` 看投稿队列，可批准或拒绝。

#### Scenario: 默认显示 pending
- Given admin 登录
- When 访问 `/admin/submissions/`
- Then 默认 tab=Pending，按时间倒序显示：投稿人邮箱、标题、提交时间（相对）、文件大小、`[详情]`

#### Scenario: 切换 tab
- Given admin 在 Pending tab
- When 点「Approved」tab
- Then 列表显示 status='approved' 的全部历史 + 批准时间 + 批准人邮箱

#### Scenario: 打开详情抽屉
- Given admin 在任一列表
- When 点某行 `[详情]`
- Then 右侧抽屉展开：完整 description、tags、原始文件名、文件下载链接（signed URL, 1h TTL）、「Approve & Publish」按钮、「Reject」按钮

#### Scenario: Approve & Publish
- Given admin 打开 pending 投稿详情
- When 点「Approve & Publish」+ 确认对话框
- Then Edge Function `moderate-submission` 校验：submission 存在且 status=pending；slug 唯一（碰撞加 -2/-3）；从 `lut-submissions` 下载文件再上传到 `luts/{slug}.cube`；`luts` 表插入新行；`submissions` 更新 status='approved' + reviewed_by/at + published_lut_id；抽屉显示成功 toast + luts.id（admin 复制去手动写 markdown）

#### Scenario: Reject
- Given admin 打开 pending 投稿详情
- When 在「Reject」表单填入 ≥10 字符的原因 + 点「确认拒绝」
- Then Edge Function 校验 → `submissions` 更新 status='rejected' + reject_reason + reviewed_by/at；删除 `lut-submissions` 里的文件；给投稿人发邮件（subject=「你的投稿未通过审核」，正文含标题和原因）；抽屉显示成功 toast

#### Scenario: 拒绝原因过短
- Given admin 在 reject 表单填了 5 字
- When 点「确认拒绝」
- Then 前端拦截，按钮 disabled + 红字提示「原因至少 10 字」

#### Scenario: 非 admin 访问
- Given 浏览器 anon 身份直接访问 `/admin/submissions/`
- When 页面加载
- Then 前端读 `users.role` 后发现未登录 → 跳 404 或 `/`

#### Scenario: Edge Function 鉴权
- Given 攻击者绕过前端直接 POST `moderate-submission` 带普通用户 JWT
- When Edge Function 收到请求
- Then JWT 验证通过后查 `users.role`，发现非 admin → 返回 403 `{ error: 'forbidden' }`

### Requirement: admin 通知邮件
新投稿到来时，所有 admin 5 分钟内收到一封 Resend 发出的邮件。

#### Scenario: 普通用户投稿触发通知
- Given `users` 表里有 2 个 admin（`admin1@example.com`、`admin2@example.com`）
- When 普通用户完成一次合法投稿
- Then `submit-lut` 查 users WHERE role='admin' → 拿到 2 个邮箱 → 用 Resend 发 2 封相同邮件（每收件人一封），subject「New LUT submission: {title}」，正文含投稿人邮箱、标题、提交时间、详情页 URL

#### Scenario: 没有任何 admin
- Given `users` 表 role='admin' 计数为 0
- When 投稿到来
- Then `submit-lut` 记 `console.warn('no admin to notify')`，不报错；投稿本身仍然成功

### Requirement: 存储与发布衔接
Approve 时 Edge Function 自动把文件从 `lut-submissions` 复制到 `luts/` public bucket；reject 时删除 private 副本。

#### Scenario: Approve 复制成功
- Given 投稿在 `lut-submissions/submissions/{user_id}/{submission_id}.cube`
- When admin Approve
- Then Edge Function 用 service_role 下载该文件 + 上传到 `luts/{slug}.cube` + 插入 luts 表 + 更新 submissions 表；任一步失败时补偿删除已上传副本

#### Scenario: Reject 清理 private
- Given 投稿在 `lut-submissions`
- When admin Reject
- Then Edge Function 删除该文件 + 更新 submissions 表为 rejected + 发邮件

### Requirement: 数据模型与 RLS
新增 3 张表（`users` / `submissions` / `luts`），全开 RLS，anon 仅能读 `luts`，所有写操作走 service_role Edge Function。`submissions.user_id` 可空（匿名投稿用 NULL，靠 `user_email` 限流 + 通知）。

#### Scenario: anon 读 luts
- Given 浏览器 anon 身份
- When 查询 `luts` 表全部
- Then 返回全部已发布 LUT

#### Scenario: anon 读 submissions
- Given 浏览器 anon 身份
- When 查询 `submissions` 表
- Then 返回空（RLS 拒）

#### Scenario: admin 读全部
- Given admin JWT
- When 查询 submissions
- Then 返回全部（含他人匿名投稿）

### Requirement: CI 与现有流程不冲突
新增代码不修改 `request-lut-download` 任何文件；CI 流程跑通；GH Pages 部署成功。

#### Scenario: 下载回归
- Given LUT 详情页（luts/boost-shadow.html）由 `_luts/boost-shadow.md` 渲染
- When 浏览器访问该页 + 点「下载 LUT」+ 提交
- Then 现有 `request-lut-download` 0 改动可正常工作（既有 5/24h + 3/1h + 10/h 限流不变）

#### Scenario: CI 部署
- Given 仓库 main 分支
- When push 含 lut-contribution 改动的 commit
- Then GitHub Actions 跑 `make build` 退出 0；`_site/assets/js/supabase-config.js` 含 4 个非 TODO 值；部署到 GH Pages 成功

### Requirement: 复用与单文件
两个新 Edge Function 各自单文件，不引入 `_shared/`；helper 函数（verifyTurnstile / sendEmail / corsHeaders / isRateLimited）从 `request-lut-download/index.ts` 复制并微调。

#### Scenario: 目录结构
- Given supabase 仓库
- When 部署
- Then `supabase/functions/submit-lut/index.ts` 和 `supabase/functions/moderate-submission/index.ts` 各自单文件；不创建 `_shared/` 目录

#### Scenario: 限流常量
- Given `RATE_LIMIT_EMAIL_PER_DAY = 5`
- When 部署
- Then `submit-lut/index.ts` 顶部有同名常量；`request-lut-download/index.ts` 不受影响
