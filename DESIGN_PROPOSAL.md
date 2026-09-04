# mdflow 产品与系统设计方案

> 状态：可运行首版（语义图已自举）  
> 日期：2026-09-04  
> 依据：`manual.md`、Topic 工程手册、Archify 的可验证空间叙事方法、OpenAI 官方 Codex 插件规范

## 1. 产品结论

mdflow 不是 Markdown 编辑器，也不是另一款架构图工具。它应被定义为：

> **面向开发 Agent 的可执行项目上下文层（Executable Project Context Layer）。**

它用带类型、版本、状态和证据的 Block、Link、Chain 替代分散的产品文档、架构文档、UI 文档、API 文档、Checklist、TODO 与修改历史。Agent 不再通读整个项目文档，而是按当前任务逐层取得一个小而完整的 `Context Pack`；人类通过 macOS App 只读查看同一份事实。

三个产品组成部分的职责必须严格分开：

| 组成 | 职责 |
|---|---|
| macOS App | 项目浏览、空间理解、状态与证据检查、插件配置；不修改项目语义 |
| MCP Server | 唯一的查询和写入通道；负责校验、事务、历史、检索与上下文裁剪 |
| Skill | 约束 Agent 何时读取、何时建模、如何更新、何时允许宣称 checkpoint 通过 |

Markdown 仍可以作为 MCP 返回给模型的临时阅读格式，但不再作为项目事实源，也不作为 App 的输入格式。旧 Markdown 的迁移由 Agent 读取后调用 MCP 完成，App 本身不提供“导入 Markdown”功能。

## 2. 核心设计原则

1. **语义优先于画布**：图不是事实源，图只是底层语义图谱的一种投影。
2. **稳定职责优先于代码细节**：Block 描述“为什么存在、负责什么、合同是什么”；文件、类和函数作为 Evidence 引用，不能把 mdflow 退化为源码 AST。
3. **关系是一等对象**：Link 具有类型、合同、状态、历史和证据，不只是两点之间的一条线。
4. **渐进披露**：项目 → Chain → Block → 合同/历史/证据逐层展开，默认只显示最高价值层级。
5. **上下文有预算**：每次读取都有明确任务、范围和 token 预算；禁止把整个项目图谱返回给 Agent。
6. **修改可追溯**：每次 Agent 修改形成原子 ChangeSet，记录原因、关联任务、Git 状态和前后 revision。
7. **状态必须有证据**：代码存在不等于完成；只有 checkpoint 及其证据能够把对象标记为通过。
8. **投影视图不改变事实**：过滤、折叠、聚合和隐藏节点只改变呈现，不修改原始图谱。

## 3. 信息模型

### 3.1 Project

Project 是顶层容器，包含项目身份、仓库绑定、全局约束、默认视图、当前发布目标和图谱版本。

关键字段：

```text
id / name / repoRoot / graphRevision / activeRelease
defaultView / createdAt / updatedAt
```

### 3.2 Block

Block 是最小的可独立理解、独立更新、独立检索的语义单元。它应保持抽象，例如“接收图片并分析内容”；相关文件和代码位置作为引用附着在 Block 上，不能用“`analyze.ts` 第 42 行”代替 Block 的职责语义。

```text
id
kind
title
summary          一句话职责
body             按需展开的详细说明
contract         输入、输出、不变量、失败条件
deliveryState    proposed / planned / implementing / verifying / complete / deprecated
healthState      unknown / healthy / warning / failing / unstable / disputed
priority         critical / high / normal / low
confidence       confirmed / inferred / uncertain
tags
sourceRefs         相关文件、符号和代码位置
evidenceRefs
currentRevision
```

`sourceRefs` 只保存定位信息，不复制源码，避免同一段代码同时存在于仓库和 mdflow：

```text
path / startLine / endLine / symbol / role / gitCommit
```

- `role` 表示该位置是实现、测试、样式、schema 或配置；
- Inspector 点击后直接在 Codex/编辑器中打开对应文件和行；
- `gitCommit` 用于判断行号是否已经漂移；
- 行号失效时优先用 `symbol` 重新定位，并明确显示 `stale`，不能静默跳到错误代码；
- mdflow 可以按需读取并预览当前源码，但不把预览内容存成 Block 正文。

首版支持的 Block 类型：

| 类别 | 类型 | 用途 |
|---|---|---|
| 意图 | principle、product、requirement、decision | 价值、约束、需求和已确认决策 |
| 体验 | flow、ui | 用户流程与界面职责 |
| 系统 | service、function、integration | 系统能力和外部依赖 |
| 数据 | data、database | 数据合同、存储与生命周期 |
| 执行 | risk | 风险和阻塞；待办由 Plan Chain 中未完成 Block 的状态表达 |
| 质量 | test、checkpoint | 验收条件和执行证据 |

类型允许后续扩展，但不能允许 Agent 自由创造近义类型；新增类型必须经过 schema migration。

### 3.3 Link

Link 连接两个 Block 或 Chain，并且本身可被选中和查看。

```text
id / sourceRef / targetRef / kind / label
contract / healthState / evidenceRefs / currentRevision
```

首版关系类型：

```text
flows_to      执行或信息顺序
calls         运行时调用
reads         读取数据
writes        写入数据
depends_on    前置依赖
implements    对需求或决策的实现
validates     测试或 checkpoint 验证对象
constrains    规则约束对象
supersedes    新对象替代旧对象
```

API 不默认建成一个“假节点”。当前端和后端之间存在 API 时，在 Link 上附加 `interface contract`，画布在线中部显示可点击的 API Badge。只有当 API 本身具有独立生命周期、多个消费者或独立负责人时，才提升为 Block。

### 3.4 Chain

Chain 是高阶 Block：它拥有自己的目标、输入、输出、状态与 revision，同时由若干 Block、Link 或子 Chain 组成。Plan 不再是一套独立内容模型，而是 `purpose: plan` 的 Chain；左侧 Plan 只是这些 Chain 的导航索引。

```text
id / title / purpose / intent / inputContract / outputContract
entryRefs / exitRefs / memberRefs / checkpointPolicy
rollupState / currentRevision
```

同一 Block 可以被多个 Chain 引用，但只有一个稳定身份。Chain 折叠时表现为一个聚合块；展开后保持原位置中心和相邻关系，避免用户失去空间记忆。

### 3.5 Context Rule（前置块）

技术规范、UI 原则、安全要求等“无连线前置内容”不应伪造业务关系。它们使用 Context Rule 绑定适用范围：

```text
targetKinds / targetTags / targetChains / repoPaths / priority
```

当 Agent 查询 UI 相关任务时，所有匹配的 critical Context Rule 会自动进入 Context Pack；用户无需手工连线。

### 3.6 Checkpoint、Evidence 与 ChangeSet

- **Checkpoint**：绑定 Block、Link 或 Chain，保存验收条件、结果、状态与最近一次运行。
- **Evidence**：代码路径、Git commit、测试命令与结果、截图或外部引用；证据和结论分开保存。
- **ChangeSet**：一次原子修改，包含 actor、reason、task、Git HEAD、工作树、所有受影响对象及 revision diff。

修改历史只在查询目标相关对象时返回，默认只给最近的结论性变更，不返回流水账。

## 4. 图谱投影与视图

### 4.1 默认视图

首版内置七个 Lens，可以多选组合：

```text
Product / UX & UI / Runtime / API / Data / Quality / Plan
```

用户也可以按状态、优先级、Chain 和关键词临时过滤。用户的筛选、缩放、展开状态属于本地 Viewer State，不修改项目事实。

### 4.2 隐藏节点后的正确连线

当原始路径为：

```text
A → API B → C
```

而 API Lens 被关闭时，投影引擎生成只读虚拟边：

```text
A → C    [via 1 hidden]
```

规则：

1. 虚拟边永不写入数据库；
2. 保留方向，不跨越冲突或无法判定的分支；
3. 状态采用整条隐藏路径中最严重的状态；
4. 边中部显示隐藏数量和最重要的关系类型；
5. 点击虚拟边可临时展开完整路径；
6. 多条路径不得被伪装成一条确定路径，而应显示 `3 routes` 聚合。

### 4.3 优先级呈现

画布默认不是展示所有节点，而是按以下顺序聚合：

```text
当前阻塞/失败
→ 正在实现或即将验证
→ 高优先级 Chain
→ 其余已完成区域
→ 归档内容
```

当可见对象超过约 120 个时，必须继续按 Chain 聚合，而不是缩小成无法阅读的“毛线团”。

## 5. Agent 上下文协议

### 5.1 Context Pack

`context_for_task` 根据任务描述、当前目录、选定对象和预算，返回临时 Markdown：

```text
# Task Context
## Must-follow constraints
## Target chain and current state
## Relevant blocks
## Interface and data contracts
## Open risks and failing checkpoints
## Relevant recent decisions
## Evidence anchors
## Available expansions
```

排序原则是“不变量 → 当前目标 → 直接依赖 → 风险 → 相关历史”。每个段落保留稳定 ID，Agent 需要更多信息时按 ID 展开，而不是重新读取整个项目。

首版检索采用确定性策略：Chain 成员关系、图遍历、类型/标签、仓库路径和 SQLite FTS5。向量检索可作为后续补充，不能在首版替代可解释的图关系。

### 5.2 MCP 工具面

工具数量保持小而明确：

| 工具 | 作用 |
|---|---|
| `project_map` | 返回项目/Chain 的低成本总览，不返回正文 |
| `context_for_task` | 按任务与预算生成 Context Pack |
| `entity_open` | 展开指定 Block、Link、Chain 或 Checkpoint |
| `graph_search` | 按文本、类型、状态、标签和路径检索 |
| `graph_mutate` | 原子执行少量 create/patch/link/compose 操作 |
| `checkpoint_record` | 记录验收结果与证据 |
| `graph_validate` | 检查悬空关系、合同缺失、非法状态与 Chain 入口/出口 |
| `migration_status` | 检查旧文档迁移覆盖率和自举门禁 |

写入约束：

- 单次 `graph_mutate` 最多 10 个操作、8 KB 输入；超过时拆分 ChangeSet。
- 更新必须携带 `expectedRevision`，冲突时返回差异摘要，不允许静默覆盖。
- 返回值只包含受影响 ID、新 revision、警告和下一步，不回显完整对象。
- 删除默认是 archive；硬删除只允许无引用草稿。
- 所有写入先通过 schema 与图不变量校验，再原子提交。

### 5.3 Skill 工作纪律

Skill 应强制 Agent 遵守以下工作流：

1. 开始实现前调用 `context_for_task`；
2. 新功能在编码前必须已有对应 Block/Chain，没有则先创建最小架构；
3. 只展开当前任务需要的对象；
4. 架构或合同改变时，先更新图谱再继续实现；
5. 完成代码后附加 Evidence，并把状态推进到 `verifying`；
6. 只有 checkpoint 有通过证据后才能标记 `complete/healthy`；
7. 失败必须记录分类、原因、尝试次数和下一步；
8. 禁止为了“清理上下文”重写或丢弃历史，历史由检索层裁剪。

## 6. macOS App 交互设计

### 6.1 信息架构

主窗口只保留四个区域：左侧索引、Canvas 顶栏、Canvas、右侧详情。没有第二导航层、底部面板、Dashboard 或独立 Plan 页面。

```text
┌─────────────┬──────────────────────────────────────┬──────────────┐
│ Overview    │ □All □UI □Runtime □API □Data □QA □Plan  Search  ⚙ │ Detail │
│             ├──────────────────────────────────────┤              │
│ Plan        │                                      │ History      │
│ · Chain A   │                                      │              │
│ · Chain B   │                                      │              │
└─────────────┴──────────────────────────────────────┴──────────────┘
```

- **左侧索引**只有 `Overview / Plan`。Overview 是项目根入口；Plan 是 `purpose: plan` 的 Chain 引用。待办就是 Plan Chain 中尚未完成的成员，不建立第二套 Todo 模型。侧栏不显示正文、checkpoint、历史、合同或重复的进度卡片。
- **Canvas 顶栏**左侧只有 View checkboxes，右侧只有 Search 和 Settings。没有 Focus、History、Fit、返回层级等常驻按钮。
- **Canvas**显示 Block、Chain、Link、名称、类型、状态和截断摘要，是结构与摘要的唯一呈现位置。
- **右侧 Detail**是说明性内容的唯一位置。未选中对象时收起；选中 Block、Chain 或 Link 时使用同一个滚动面板显示详情。
- **Settings**使用 sheet/modal，只包含 Codex 插件安装、更新、诊断、数据位置、备份和动效偏好，不占据主界面。

用户不能在 Canvas 拖动并保存节点、修改文字、连线或改状态。允许的操作只有阅读、筛选、搜索、折叠、聚焦、复制引用以及插件配置。

### 6.2 单一内容归属

“同一内容只在一个地方出现”按下面的归属执行：

| 内容 | 唯一位置 |
|---|---|
| 项目、Plan 的入口 | 左侧索引 |
| Block/Chain/Link 的结构、方向和状态 | Canvas |
| Block/Chain 的摘要 | Canvas 卡片 |
| View 开关 | Canvas 顶部 checkbox |
| 搜索与搜索结果 | Canvas 顶部 Search 下方临时结果层 |
| 合同、文件位置、checkpoint、修改历史 | 右侧 Detail |
| 插件和应用配置 | Settings sheet |

名称可以作为导航身份同时出现在侧栏条目、Canvas 节点和 Detail 标题中；除此以外不复制描述性内容。侧栏不做“小型详情卡”，Canvas 节点不塞正文，Detail 不再重复绘制成员关系。

Detail 不使用多个页面或永久 Tab，而是一个滚动栏，只渲染当前对象实际拥有的 section：

```text
Contract
Files & Code
Checkpoints
History
```

- Chain 的成员关系只在 Canvas 中看，Detail 不再列一次成员清单；
- checkpoint 点击后在原位置展开证据，不打开新页面；
- history 点击后在原位置展开 revision diff；
- Files & Code 点击后打开真实源码位置，不在 mdflow 中保存第二份代码；
- 没有内容的 section 完全不出现，不显示空卡片。

### 6.3 核心交互

1. 点击左侧 Plan：Canvas 自动居中并高亮对应 Chain，其余内容降低对比度；不打开独立 Plan 页面。
2. 点击高亮 Chain：Chain 在 Canvas 原位展开，同时打开右侧 Detail；checkpoint 和相关修改历史只在 Detail 中呈现。
3. 再次点击 Chain 标题或点击 Canvas 空白处：折叠/取消选择，Detail 收起。
4. 点击 Block：Detail 显示合同、相关文件/代码位置、checkpoint 和相关 history；摘要只留在 Canvas 卡片。
5. 点击 Link/API Badge：Detail 显示接口或关系合同、失败状态、证据和相关 history。
6. Search 选中结果：定位对象、短暂高亮并打开同一个 Detail，不生成搜索结果页面。

Chain 始终原位展开，不进入新的层级页面，因此不需要 breadcrumb 或返回按钮。Canvas 支持触控板缩放、双轴平移和右下角 `− / 百分比 / +` 控件，范围为 50%–180%；控件不占用顶部信息架构。

### 6.4 空间与连线

- 布局采用从左到右的分层网格。
- 所有业务边使用直线和严格的 90° 折线，不使用贝塞尔曲线。
- 节点先测量真实尺寸，再进行布局；不允许互相遮挡。
- 交叉处使用线桥或留白断点，方向使用小型箭头。
- 展开 Chain 时只重排受影响子图，并保持父 Chain 中心与相邻节点稳定。
- 语义缩放分为项目、Chain、Block、Detail 四级；文字不会无限缩小。

### 6.5 视觉语言

关键词：**精密、数学、工程、艺术、克制的 iOS 质感**。

基础色：

```text
Canvas       #F6F7F9
Surface      #FFFFFF
Primary Ink  #111318
Muted Ink    #737982
Hairline     #DDE1E7
Focus Blue   #2F6BFF
Success      #198754
Pending      #C47A00
Failure      #D13F3F
Unstable     #8B4ACB
```

颜色主要表达状态，不承担全部含义；状态同时用图形、标签或边框模式表达：

- planned：灰色细边 + 空心状态点；
- implementing：蓝色实心点 + 左侧进度轨；
- verifying：琥珀色环 + `VERIFY` 标签；
- healthy：绿色勾形状态点；
- failing：红色粗边 + 错误符号；
- unstable：紫色双边 + 重复次数；
- disputed：斜线纹理 + `?`，避免与失败混淆。

Block 类型用几何符号和标题旁的小标签区分，不为每个类型创造一套高饱和颜色。当前 Logo 的“圆轨道、穿越线和端点”很适合表达 Block 与 Flow；建议保留黑色几何主体，只让端点在运行状态使用 Focus Blue。发布前应将现有 `topic-logo-mark-black.png` 的文件命名和品牌归属统一为 mdflow。

### 6.6 动效规则

- 普通 hover/focus：140–180 ms；
- Chain 展开/折叠：220–280 ms，位置与尺寸同步插值；
- Agent 写入：受影响对象出现一次扫描波纹，然后静止；
- 正在执行：当前路径可显示有限的信号点流动；
- 状态变更：颜色沿节点边框传播一次；
- 失败：一次轻微位移和红色收束，不持续抖动；
- 所有信息在静态画面中仍完整，并支持 `prefers-reduced-motion`。

动效不能凭空暗示代码正在运行；只有 MCP 记录了相应活动状态时才出现。

## 7. 技术架构

### 7.1 首版实现技术栈

首版已经采用：

```text
SwiftUI + Swift 6
SwiftUI Canvas / native controls
Node.js 22 + official MCP SDK
SQLite WAL + deterministic text/path search
Swift Package Manager
esbuild single-file plugin bundle
```

原因：产品首发目标是 macOS，原生 SwiftUI 能直接获得正确的字体、checkbox、sheet、窗口与辅助功能行为；Node MCP 可以使用当前 Codex/MCP 生态，并打包成插件内的单文件服务。两端通过同一个 SQLite schema 交接，MCP 是唯一语义写入者，SwiftUI 只读投影。

首版布局器使用确定性的分层网格和 90° Link routing。图规模与嵌套 Chain 增长后，再把布局算法抽成独立模块；在当前数据模型尚未验证前不引入另一套跨语言布局运行时。

### 7.2 进程边界

```text
Codex Agent
   │ stdio MCP
   ▼
mdflow-mcp (Node, bundled)
   │ transaction / revision / validation
   ▼
SQLite WAL  ───── change_feed ─────▶ SwiftUI GraphStore ─────▶ Canvas
```

- MCP 是唯一项目语义写入者；App 对图谱只读。
- App 前台监听递增的 `change_feed.sequence`；只有序号变化时才重载 snapshot，并对受影响对象执行一次状态动画。
- 当前监听周期为 350ms，界面不提供刷新按钮。
- MCP 在 App 未运行时仍可工作。
- schema 由 MCP 负责迁移和校验；App 只读取向后兼容的投影字段。

### 7.3 双语数据与呈现

- 实体 ID 与主记录只有一份；`localized_text(entityType, entityId, locale, field)` 保存英文和简体中文字段变体。
- UI 支持跟随系统、中文和 English；切换后当前快照立即重投影，不复制 Block 或 Chain。
- Search 与 `context_for_task` 同时对所有语言变体评分，再按请求语言输出，保证中英文命中相同稳定引用。
- 未翻译字段回退到主记录，不显示空白，也不创建两套架构。

### 7.4 存储位置与 Git 关联

- 仓库内只保存一个很小的 `.mdflow/project.json`，包含稳定 project ID 与 schema version，可进入 Git。
- 实际 SQLite 位于 `~/Library/Application Support/mdflow/projects/<project-id>/mdflow.sqlite`，避免提交二进制数据库。
- ChangeSet 记录 Git HEAD、branch、worktree path 和 dirty 状态；因此可以判断架构事实与代码证据是否漂移。
- 首版是 local-first 单用户；云同步、团队合并和跨机器共享不进入 MVP。
- 提供确定性导出/备份包，但导出包不是 Agent 的日常读取入口。

### 7.5 目录建议

```text
apps/desktop/                 SwiftUI macOS App
packages/mcp/                 schema、事务、检索和 stdio MCP
plugins/mdflow/
  .codex-plugin/plugin.json
  .mcp.json
  skills/mdflow/SKILL.md
  server/mdflow-mcp.mjs
  assets/
scripts/package-app.sh        本地 .app 打包
```

根据 OpenAI 官方规范，插件以 `.codex-plugin/plugin.json` 为入口，Skill 放在 `skills/`，本地 MCP 配置放在插件根目录的 `.mcp.json`。App 中的“安装到 Codex”应把签名后的插件包复制到稳定目录，注册本地 marketplace，执行版本/连通性检查；如果 Codex 仍要求安装确认，则直接打开对应插件安装页完成最后确认，不应静默篡改未知配置。

## 8. MVP 边界

### 必须包含

- 单机、单用户、多个本地项目；
- Block、Link、Chain、Context Rule、Checkpoint、Evidence、ChangeSet；
- 七种 Lens 与隐藏节点路径收缩；
- MCP 渐进读取与原子写入；
- Skill 工作纪律；
- 只读 Canvas、Inspector、搜索和历史；
- Codex 插件安装、更新、诊断；
- mdflow 项目的自举迁移与质量评估。

### 首版不做

- 人工可视化编辑器；
- Markdown 导入按钮；
- 云同步、多人协作与权限系统；
- 自动从源码生成完整图谱；
- 复杂分支合并和 CRDT；
- 任意插件市场或模板市场；
- 用向量数据库代替确定性关系检索；
- 让用户在 App 中直接与 Agent 聊天。

## 9. 实施顺序

| Checkpoint | 交付内容 | 通过标准 |
|---|---|---|
| MF-00 | 产品合同、schema、状态机、设计 tokens | 所有示例能用统一模型表达 |
| MF-01 | Node Domain + SQLite + revision/ChangeSet | 原子写、冲突和迁移测试通过 |
| MF-02 | Headless MCP 读写与 graph validation | 无 UI 时可完整维护示例项目 |
| MF-03 | Context Pack + Skill | golden queries 在预算内返回正确约束 |
| MF-04 | Canvas、Chain 展开、orthogonal layout、缩放与摘要卡片 | 无遮挡、路径正确、空间稳定、50%–180% 可缩放 |
| MF-05 | Lens、虚拟边、Inspector、历史 | 过滤不破坏方向和合同可达性 |
| MF-06 | 插件打包、App 图标与安装诊断 | 插件/Skill 校验通过，签名 App 包含有效 ICNS；一键安装仍为后续切片 |
| MF-07 | 双语自举迁移 | 40 个 Block、9 条 Chain 与双语检索已建立；继续完成真实任务门禁 |
| MF-08 | 性能、备份、恢复、签名和发布 | 崩溃恢复、数据库迁移和大图压力测试通过 |

优先级必须是 **内核 → MCP → 上下文质量 → App**。Canvas 可以使用手工 fixture 并行验证视觉，但不能在语义模型未稳定前成为主开发方向。

## 10. 自举方案

不要直接删除 `manual.md`。自举采用可回退的五步门禁：

1. Agent 阅读现有文档，通过 MCP 将其拆为 Block、Link、Chain、Context Rule 和 Checkpoint；
2. 为原文每个需求段落保存 migration coverage，确保没有静默遗漏；
3. 建立至少 20 个 golden questions，例如“UI 相关任务必须继承哪些规范”“隐藏 API 后链路如何显示”；
4. 连续完成至少 3 个真实 checkpoint，只允许通过 mdflow 获取项目上下文；
5. 覆盖率、检索正确率和开发结果全部通过后，把 `manual.md` 从活跃事实源移除；原文件由 Git 历史保留，并生成只读迁移收据。

自举期间发现 Block 过大、关系不明确、Context Pack 漏规则或历史噪声过多时，应先修正模型和 MCP，再继续迁移，而不是给 Skill 增加越来越长的补丁说明。

## 11. 首版验收指标

1. 相比通读现有 Topic 手册，典型任务的 Context Pack token 减少至少 70%。
2. 所有 golden queries 都自动包含匹配的 critical Context Rule。
3. 任何隐藏 Lens 组合都不产生方向错误、悬空虚拟边或伪造单一路径。
4. `graph_mutate` 响应不回显大对象；典型回执控制在约 300 tokens 内。
5. 120 个可见对象下布局无重叠，缩放和选择保持流畅。
6. 状态为 healthy/complete 的对象都有可追溯 checkpoint 与 Evidence。
7. revision 冲突不会覆盖另一个 Agent 的修改。
8. mdflow 自身连续三个真实开发任务不需要重新通读 `manual.md`。

## 12. 最重要的风险

| 风险 | 控制方式 |
|---|---|
| 图谱变成另一种冗长文档 | 限制 Block 职责、正文字数和 Context Pack 预算 |
| 图谱变成源码 AST | 代码只作 Evidence，Block 保持稳定责任边界 |
| 类型越来越混乱 | 固定首版 taxonomy，新增类型必须 migration |
| Agent 为完成任务伪造状态 | checkpoint 与 evidence 是唯一通过依据 |
| Canvas 漂亮但检索无效 | MF-03 在 UI 前验收，并以 golden queries 测量 |
| 过滤后关系失真 | 虚拟边可追溯到原始路径，不能写回数据库 |
| 多 Agent 相互覆盖 | expectedRevision + ChangeSet + 原子事务 |
| 自举时丢失原需求 | coverage map、golden questions、Git 可回退 |

## 13. 最终产品体验

理想状态下，用户打开 mdflow 看到的不是“文档目录”，而是项目此刻的认知结构：哪些能力存在、它们如何连接、什么正在实现、哪里失败、哪个合同被谁依赖、为什么做过某次修改。

Agent 开始任务时也不会请求“把所有文档给我”，而是获得一份几千 token 内的、带全局约束和局部证据的任务上下文；需要更多时才沿 Block、Link、Chain 继续展开。这样 mdflow 替代的不是 `.md` 文件扩展名，而是“靠反复通读长文来维持项目一致性”的工作方式。
