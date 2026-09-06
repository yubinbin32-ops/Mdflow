# mdflow 架构与状态基线（迁移源）

> 日期：2026-09-05
> 基线 HEAD：`9947ae6`（本文件写作时的仓库状态）
> 用途：这是“先把内容写入 Markdown，再按 Markdown 重建 mdflow”的一次性迁移基线。迁移完成后，本文件应降级为公开发布/历史材料，开发期唯一交接入口回到 `.mdflow`。

> **当前校准（2026-09-06）**：下面的迁移记录和早期数字保留为历史证据，不是当前状态。当前开发事实以 `.mdflow/mdflow.sqlite` 为准（graph revision 601）；最新 MCP 回归为 41/41，Swift desktop package build 通过，`release:verify` 的既有 valid=true、严格 codesign 与 13-file manifest 证据仍有效。300 Block / 599 Link / 6 Chain 全路冲突已加入精确回归；视口级网格改为有界 Canvas 后，隔离大图完成 30 个一分钟采样，最终物理驻留 541.1M、历史峰值 578.8M，进程存活 34m41s 无崩溃，且已获用户验收。开发期 MCP 默认 Markdown，结构化 JSON 仅在显式 `includeStructured=true` 时返回。普通架构 Block 可以暂时没有 checkpoint；只有需求、Plan、Chain/Plan gate 或显式验证请求需要时才创建，coverage 会区分 checkpoint-free 与 required-missing。最终 Todo parity fixture 已稳定为 2,344 vs 3,321 tokens（29.4188% reduction，13/13 facts，0 errors，0 rework proxy turns）；真实 Todo target 的迁移、UI/API、超时恢复、幂等重放和无重复写入也已通过。新增 clean-project deterministic feedback-loop baseline：mdflow-first 880 vs Markdown-first 1,107 首次上下文 tokens、4/4 refs、1 次代码编辑，增量恢复 1 次对完整文档恢复 2 次；明确标注 `llmClaim=false`。UI lens、Plan inspector 与大图已获用户视觉验收。已生成 ad-hoc 本地 App zip、release manifest、SHA256SUMS 与发布/宣传页；尚未宣称 Developer ID/notarization 或 GitHub 公开上传。剩余开放门禁见 mdflow Foundation Plan：真实 LLM/code-edit 对比、validation closure、plugin-release 的 Developer ID/notarization 与 GitHub 上传、最终清理。

## 1. 这份文件要解决什么

### 执行记录（已完成的迁移步骤）

- 2026-09-05：本文档建立并提交为 `3ef3dbd`；旧 `DESIGN_PROPOSAL.md` 标记为历史。
- 2026-09-05：按本文档校准 `.mdflow` 至 graph revision 279：
  - `project-registration` 正文修正为“主库随 Git 跟踪，WAL/SHM/journal 忽略”；
  - 四条问题 Link 改写契约并置为 `healthy`；
  - 五个早期 checkpoint 的证据更新为当前 18/18 Swift 回归；
  - 主迁移 Plan 记录基线来源，并挂接 `docs/architecture.md` source ref。
- 2026-09-05：App 的 Verification 列表增加“目标必须仍存在”过滤，已归档 Plan 的 checkpoint 不再出现在侧栏。
- 2026-09-05：新增 Git checkout 烟雾测试（tracked graph 随 commit/checkout 切换并在对应 revision 重开）；`graph_mutate` 新增 `create_checkpoint`，可在同一 ChangeSet 中创建 Block、原子 checkpoint 与 Direct PlanChange 绑定。
- 2026-09-05：最终回归 MCP 32/32、Swift 18/18；插件 `0.1.0+codex.20260905101443` 已安装启用且与仓库哈希一致。
- 2026-09-05：`plan_context` 与 App Plan 详情开始展示 Ordered steps；只有步骤的 Plan（如公开前发布准备）不再误报“待迁移/变更结构”。
- 未完成：真实 Git watcher 重开、Todo/大型项目等价性、Canvas 人工验收、大图性能、多项目闭环、Foundation Plan 批量初始化和 `.mdflow` 人类可读 diff，见第 14 节。

mdflow 的代码实现一直在推进，但以下地方没有同步，导致当前看起来“混乱”：

1. `DESIGN_PROPOSAL.md` 停留在早期模型，其中很多说法已经被实现否决（例如“SQLite 放在用户目录”“Plan 是 purpose=plan 的 Chain”“七个固定 Lens”“Context Rule”）。
2. `.mdflow` 图谱中部分 Block 正文是旧规则，例如 `project-registration` 仍写“mdflow.sqlite 应保持忽略”，实际实现是主库随 Git 跟踪、只忽略 WAL/SHM。
3. 已归档 Plan（`architecture-canvas-v2`、`city-canvas-rebuild`）仍留有 checkpoint，App 的“独立验证”列表会把这些不可打开的 checkpoint 显示出来。
4. 部分 Block/Link 的 `healthState` 和 evidence 没有按最近一次回归重新校准，例如四个新增 Link 仍为 `unknown`，部分早期 checkpoint 的证据数字停留在“15 tests”。
5. 旧设计文档、真实代码和图谱对“Block 类型筛选”“Plan 与 Chain 的关系”“语言切换是否改变项目内容”的描述互相冲突。

因此，先建立这份以真实代码为准、包含当前所有语义实体状态的 Markdown 基线；之后使用它校准 `.mdflow`。

## 2. 产品定义（当前有效）

mdflow 是“面向开发 Agent 的可执行项目上下文层”。

- macOS App 是只读投影：浏览网络、查看详情/历史/checkpoint、切换项目、安装插件。
- MCP Server 是唯一语义写入入口：事务、revision、校验、history、检索、上下文预算、checkpoint 证据。
- Skill 约束 Agent 的读取顺序和写入纪律：先 `context_for_task`，再 `plan_context`/`entity_open`，每次写入后回读并 `graph_validate`。
- 项目图只保存一份原文事实。App 语言只切换固定 UI 文案；MCP 的 `locale` 只影响工具生成的固定标题。
- 开发期 Markdown 不是交接入口；本基线是重构过程的一次性对照物。

### 当前核心原则

- Block 表示稳定职责，不是文件、TODO、便利贴或伪节点。
- Link 表示真实关系；关系类型决定线的含义，Chain 成员关系不改变 Link 类型。
- Chain 是全局 Block/Link 网络上的一条有序路径包络，不拥有 Block；一个 Block 可以属于多个 Chain，也可以不属于任何 Chain。
- Plan 既不是 Block 也不是 Chain。Plan 通过直接 `plan_change`、`plan_chain_scope`、步骤、checkpoint gate 和依赖来表达“接下来做什么、改哪里、如何验收”。
- Block 是架构事实，不因创建就自动产生验证义务；建模阶段可以没有 checkpoint。需求、Plan、Chain/Plan gate 或显式验证请求确定验证范围后，相关 Block 才必须有自己的 checkpoint。不属于 Chain 的 Block 仍应在需要实施时由 Plan 的精确工作项覆盖。
- “把某条 Chain 设为 Plan 的 target”不等于“覆盖 Chain 内全部 Block”。严格覆盖只认：直接 Block PlanChange、Plan step 中的 Block 引用、ChainScope 中明确列出的 Block。
- Test Block 只表示可复用测试能力；整个系统/发布验收是 Plan 的 integration checkpoint，不是 Test Block。
- 状态必须有证据；`passed` 需要覆盖完整、evidence level 不低于 required level、且没有被 invalidate。

## 3. 代码架构（当前实现）

### 3.1 仓库布局

```text
apps/desktop/                      SwiftUI macOS App（只读投影）
  Sources/MdflowDesktop/
    MdflowDesktopApp.swift         应用入口
    ContentView.swift              左侧栏 / 工具栏 / 设置 / 图例
    GraphStore.swift               快照、选择、镜头、实时更新、架构覆盖
    ProjectDatabase.swift          只读 SQLite 投影与派生状态
    ProjectLocation.swift          .mdflow/project.json 定位与最近项目
    Models.swift                   投影模型
    CanvasScene.swift              Canvas 场景状态
    GraphCanvasView.swift          手势、绘制、Chain 包络、Block 卡片
    NetworkLayoutEngine.swift      确定性 Chain-first 正交街道布局
    Theme.swift                    视觉 token
    DetailView.swift               唯一右侧详情栏
    PluginInstaller.swift          调用 Codex CLI 安装插件
  Resources/AppIcon.icns           多分辨率图标
  Tests/MdflowDesktopTests/        Swift 回归（当前 30 个测试）

packages/mcp/src/
  service.mjs                      数据模型、查询、写入、派生状态
  database.mjs                     SQLite 打开、schema、事务
  paths.mjs                        .mdflow 路径解析
  project-router.mjs               多项目服务路由
  server.mjs                       MCP stdio 工具面
packages/mcp/test/                 MCP 回归（当前 41 个测试）

benchmarks/todo-target/             真实 Todo 垂直目标（UI/API/SQLite/provider/retry）
docs/launch.md                      发布会式产品宣传页
docs/releases/v0.1.0.md             GitHub Release body
scripts/create-release-assets.sh    macOS .app、manifest、SHA256 发布资产
scripts/upload-release.sh            公证后 GitHub Release 上传入口

plugins/mdflow/
  .codex-plugin/plugin.json        插件清单与版本
  .mcp.json                        MCP 声明
  server/mdflow-mcp.mjs            esbuild 单文件 bundle
  skills/mdflow/SKILL.md           Agent 纪律
  assets/topic-logo*.png           Topic/插件图标

scripts/package-app.sh             本地 .app 打包（ad-hoc / App Store 模式）
.mdflow/project.json               稳定项目 descriptor（可提交）
.mdflow/mdflow.sqlite              规范图主数据库（随 Git 跟踪）
manual.md                          原始产品输入（保留为历史）
DESIGN_PROPOSAL.md                 早期方案（历史；细节已被本基线取代）
```

### 3.2 进程边界

```text
Codex Agent
  │ stdio MCP
  ▼
mdflow-mcp（plugins/mdflow/server/mdflow-mcp.mjs）
  │ project_register / project_map / context_for_task / plan_context
  │ entity_open / graph_search / graph_mutate / checkpoint_record
  │ checkpoint_list / changes_since / change_set_revert / graph_validate
  ▼
.mdflow/mdflow.sqlite（规范事实，MCP 唯一写者）
  │ change_feed / history
  ▼
macOS App（ProjectDatabase 只读快照，250 ms 轮询 + .mdflow 文件事件）
```

### 3.3 MCP 工具面（当前 13 个）

| 工具 | 作用 |
|---|---|
| `project_register` | 注册目录，创建 `.mdflow/project.json` |
| `project_map` | 低成本项目总览 + 架构覆盖 |
| `context_for_task` | 按任务和预算生成 Context Pack |
| `plan_context` | 单个 Plan 的分层上下文 |
| `entity_open` | 打开 Block/Chain/Link/Plan |
| `checkpoint_list` | 验证索引（可按 Plan/ChainScope/status/unassigned） |
| `checkpoint_record` | 记录 checkpoint 证据 |
| `graph_mutate` | 原子写入（create/patch/set path/scope/bindings） |
| `graph_search` | 图谱与路径检索 |
| `graph_validate` | 全图引用、覆盖、完成状态校验 |
| `changes_since` | 增量变更恢复（分页） |
| `change_set_revert` | 对可逆 update-only ChangeSet 反向恢复 |
| `project_service_router` 相关 | 已并入项目路由层，按 projectRoot 隔离 |

## 4. 当前数据模型

### Block

- 字段：id、kind、title、summary、body、contract、scope、architectureLayer、localOrder、deliveryState、healthState、priority、confidence、tags、archived、currentRevision。
- kind 枚举：principle、product、requirement、decision、flow、ui、service、function、integration、data、database、risk、test、checkpoint。
- architectureLayer 枚举：client、boundary、application、domain、data、external、quality、infrastructure、unspecified。
- deliveryState：proposed、planned、implementing、verifying、complete、deprecated。
- healthState：unknown、healthy、warning、failing、unstable、disputed。
- scope 只表达语义（如 canvas、codex、graph、projects），不决定 Canvas 空间分带。

### Link

- 字段：id、source、target、kind、label、contract、healthState、archived、currentRevision。
- kind：flows_to、calls、reads、writes、depends_on、implements、validates、constrains、supersedes。
- Link 样式与含义由 kind 决定，与 Chain 无关。

### Chain

- 字段：id、title、purpose、intent、inputContract、outputContract、deliveryState、healthState、priority、archived、currentRevision。
- 由有序 `chain_nodes`（Block）和 `chain_edges`（Link）组成。
- 同一 Block 可以在多条 Chain 中；Chain 不复制 Block。

### Plan（独立实体）

- 字段：title、summary、goal、status、priority、phase、planOrder、proposedDelta、completionPolicy、nextAction、blockers、statusReason、startedAt、completedAt、invalidatedAt、archived、currentRevision。
- 子结构：`plan_steps`、`plan_chain_scopes`、`plan_changes`、`plan_chain_refs`、`plan_dependencies`、`plan_checkpoint_refs`、`plan_chain_change_refs`。
- Plan status：draft、ready、active、verifying、complete、blocked、failed、retest_required、cancelled。
- Plan step status：pending、active、complete、blocked、failed、skipped。
- `plan_change` 是“一个受影响的 Block/Link/Chain 的规范修改”，可被多个 ChainScope 引用，不复制。

### Checkpoint 与证据

- checkpoint 绑定 target：block/chain/link/plan；另可绑定到 plan、plan_change、plan_chain_scope 作为 gate。
- checkpointKind：atomic、aggregate、integration。
- status：pending、running、passed、partial_pass、failed、blocked、not_supported、retest_required。
- evidenceLevel 从弱到强：none、static、simulated、integration、real_target、human_review。
- checkpointDependencies 形成 DAG；required 失败/阻塞/失效会向上传播；aggregate/integration gate 不能手工强推通过。

### History / ChangeSet

- 每次 `graph_mutate` 或 `checkpoint_record` 生成 ChangeSet。
- 记录 actor、reason、task、gitHead、planId、chainScopeId、before/after、changedFields、affectedRefs、evidenceRefs。
- `changes_since` 返回 latestSequence、earliestSequence、hasMore、nextSequence。
- `change_set_revert` 只接受完全可逆的 update-only ChangeSet，保留原始审计链。

## 5. 当前 App 信息架构与交互

### 5.1 布局

```text
┌────────────────┬───────────────────────────────┬──────────────┐
│ 项目标题/计数    │ 类型 checkbox …   100%   设置 │              │
│ 项目规则        ├───────────────────────────────┤ 右侧详情栏    │
│ Plans          │ Canvas                        │（选择后出现）  │
│ Chains         │  · Block 卡片                  │              │
│ 验证（独立检查） │  · Link 正交折线                │              │
│ 图例            │  · Chain 圆角蛇形包络           │              │
└────────────────┴───────────────────────────────┴──────────────┘
```

- 左侧栏可折叠分区：项目规则、Plans、Chains、Verification；折叠状态按 project id 保存在 UserDefaults。
- 顶栏 checkbox 只列当前项目真实存在的 Block.kind；不把 Plan/QA 伪造为 Block 类型。
- 搜索框已被移除；缩放显示为百分比。
- 右侧详情栏只有在选择后出现；Plan 宽度 33% 上限 500pt，其他实体 25% 上限 380pt。
- 详情栏是独立物理滚动列，指针在栏内时由栏内滚动接管；Canvas 交互与详情滚动隔离。

### 5.2 Canvas

- 单一全局 Block/Link 网络；Block 是稳定建筑，Link 是正交街道折线，Chain 是沿真实顺序的圆角蛇形包络。
- 不使用平滑曲线；允许多次 90° 折线；先分配 Chain 主路，再连接普通支路。
- 共享 Block 的多条 Chain 使用稳定分隔的包络 lane；Block 不因 Chain 复制。
- Chain 详情不再作为独立卡片放在起始 Block 旁；选择/侧栏打开详情。
- Block 点击不重排、不移动镜头，只强调完整连通分量；Chain/Plan 选择调整镜头并高亮路径；空白恢复 Overview。
- 缩放 0.25–1.8，双击/捏合/⌘滚轮围绕指针；summary 不随缩放隐藏。
- 实时更新只替换 snapshot，保留仍然存在的 selection、focus、highlighted Chains。

### 5.3 详情栏

- Block 详情：类型、架构层、scope、标题、summary、contract、文件引用、checkpoint、history。
- Link 详情：关系类型、label、contract、health、history。
- Chain 详情：路径、成员、checkpoint、history。
- Plan 详情：架构覆盖、Direct Block Work、ChainScopes、每层修改、checkpoint gate、依赖、history；整行可展开。

### 5.4 视觉

- 数学精密工程风，白/浅灰表面、细发丝线、等宽数字信息。
- 颜色只是状态辅助，不只靠颜色：类型用左侧色条/标签，交付用图标/状态点，Line 用 kind 颜色/虚线，Chain 用外框。
- 支持减少动态效果；动画不参与布局与命中。

## 6. 当前验证基线

- MCP 回归：41/41 通过。
- Swift/Desktop：当前 Swift desktop package build 通过；既有 30/30 回归证据仍包含精确 300 Block / 599 Link / 6 Chain 全路冲突检查、重复刷新和大包络边界回归。
- 真实 Todo target：`npm run benchmark:todo:target` 通过迁移幂等、UI/API 创建、校验错误、provider timeout 恢复、幂等重放和无重复写入；结果写入 `benchmarks/todo-target-results.json`。
- `release:verify`：`valid=true`，严格 codesign、私有数据审计、13-file manifest 通过；清单现在在最终 re-sign 前写入，避免破坏 sealed resources。
- `release:assets`：生成 `.app` zip、release manifest 与 `SHA256SUMS`；`release:upload` 会拒绝 ad-hoc 包，只有 Developer ID/notarized 产物才允许公开上传。
- 本地开发包保持 ad-hoc 签名；`MDFLOW_CODESIGN_IDENTITY` 可注入 Developer ID，`npm run release:notarize` 负责 notarytool/staple/spctl 门禁，不把 ad-hoc 包误称为公证产物。
- 当前插件版本：`0.1.0+codex.20260905101443`；bundle/Skill 与仓库哈希一致。
- 读取工具默认 Markdown；只有显式 `includeStructured=true` 才返回完整 structuredContent；自动回归仍不能替代 real_target/human_review。

## 7. Block 清单（迁移快照 25；当前图谱 27）

约定：`checkpoint` 列给该 Block 自身最重要 checkpoint 的当前派生状态；有多个时按 `passed / partial / retest / pending` 的最高确定性列出。

| id | kind / layer / scope | delivery / health | 职责（summary） | checkpoint |
|---|---|---|---|---|
| in-app-plugin-install | integration / boundary / codex | complete / healthy | Settings 一键安装/更新打包插件并返回诊断 | passed |
| bilingual-content | ui / application / localization | complete / healthy | App 固定界面双语；项目实体单一原文 | passed |
| city-layout | ui / client / canvas | verifying / healthy | 确定性 Chain-first 城市街道布局 | passed（大图 gate passed） |
| chain-route-overlay | ui / client / canvas | verifying / warning | 沿真实正交路线的方向圆角 Chain 包络 | passed + partial |
| codex-plugin | integration / boundary / codex | verifying / warning | 打包 MCP+Skill；安装/升级/回滚可验证 | passed + edge partial |
| sqlite-graph-store | database / data / graph | verifying / healthy | 项目级 SQLite 规范图；主库随 Git 跟踪 | passed |
| large-system-benchmark | test / quality / quality | verifying / warning | Topic/全栈大图与 Todo 双路径基准 | Todo partial；LLM/code-edit open |
| atomic-mutation | service / application / graph | complete / healthy | 原子、带 revision 的 MCP 写入与历史 | passed |
| native-app-package | ui / infrastructure / desktop | complete / healthy | macOS bundle、图标、签名路径 | passed |
| detail-inspector | ui / client / canvas | verifying / healthy | 唯一右侧详情检视器 | passed + human review |
| orthogonal-street-router | function / client / canvas | verifying / healthy | 避障多折线正交街道路由 | passed |
| project-switcher | ui / client / projects | complete / healthy | 最近项目切换，项目状态隔离 | passed |
| view-lenses | ui / client / canvas | implementing / healthy | 只按实际存在的 Block.kind 筛选 | passed + human review |
| product-contract | principle / domain / governance | verifying / healthy | mdflow 是开发期唯一规范交接入口 | passed |
| architecture-classification | data / domain/platform | verifying / healthy | scope/layer/localOrder 是显式语义，不决定位置 | passed |
| live-desktop-reader | service / application / desktop | complete / healthy | 只读 SQLite + 实时 change sequence 投影 | passed |
| plan-workflow | data / domain / planning | complete / healthy | 独立 Plan；Direct Block Work + gates | passed |
| stable-view-state | ui / client / canvas | complete / healthy | 选择/镜头/项目切换不重排 | passed |
| compact-block-card | ui / client / canvas | complete / healthy | 统一卡片，一个 Block 一次 | passed |
| semantic-zoom | ui / client / canvas | complete / healthy | 连续缩放不改变事实/拓扑/summary | passed |
| verification-suite | test / quality / quality | verifying / warning | MCP+Swift+Skill+Plugin 跨层回归 | partial + partial |
| gesture-navigation | ui / client / canvas | verifying / healthy | 平移/缩放/双击聚焦稳定 | passed（physical review open） |
| project-registration | data / domain / projects | complete / healthy | 极简 descriptor 绑定项目 | passed |
| project-service-router | service / application / projects | complete / healthy | 每个调用按 projectRoot 隔离路由 | passed |
| context-retrieval | service / application / agent-context | verifying / warning | 预算化上下文 + 严格覆盖 | partial |

### 7.1 需要在重建时修正的 Block 内容

1. `project-registration`：正文必须改为“主数据库随 Git 版本化，WAL/SHM/journal 忽略”，删除“mdflow.sqlite 保持忽略”的旧句。
2. 该项已在当前图谱校准：`verification-suite`、`context-retrieval`、`codex-plugin`、`plan-workflow`、`sqlite-graph-store` 的当前正文/证据以 MCP 41/41、Swift desktop package build、插件 `0.1.0+codex.20260905101443` 为准；旧“32/32”“18/18”“25/25”“15 tests”“22 tests”等数字只保留在历史回放中。
3. 所有 Block 的 `healthState` 应由当前 checkpoint 状态推导呈现，不再保留与 evidence 冲突的手工“healthy”表达。
4. 不创建“全部/All/QA/Plan”伪 Block kind。

## 8. Chain 清单（6）

| id | 状态 | 意图 | 成员路径 |
|---|---|---|---|
| agent-feedback-loop | implementing / healthy | AI 先读范围化上下文，经 MCP 写入并增量恢复 | project-registration → project-service-router → context-retrieval → codex-plugin → atomic-mutation → sqlite-graph-store → live-desktop-reader → verification-suite |
| project-lifecycle | complete / healthy | 项目注册、隔离、实时打开 | project-switcher → project-registration → sqlite-graph-store → live-desktop-reader |
| city-canvas-projection | complete / healthy | Chain 主路城市画布投影 | sqlite-graph-store → view-lenses → city-layout → orthogonal-street-router → chain-route-overlay → compact-block-card → detail-inspector |
| continuous-navigation | complete / healthy | 连续导航、聚焦稳定 | gesture-navigation → city-layout → chain-route-overlay → detail-inspector |
| plugin-release | verifying / warning | 插件与 App 发布 | codex-plugin → in-app-plugin-install → native-app-package → verification-suite |
| bilingual-flow | complete / healthy | 界面语言只投影 UI chrome | bilingual-content → context-retrieval → codex-plugin |

重建时不创建“Plan Chain”。已归档的旧 Plan 对应的 Chain 不需要复活。

## 9. Link 清单（30）

按语义分组合并列出；重建时逐条写入 id、source、target、kind、label、contract、healthState。

### 9.1 项目生命周期

| id | kind | 路径 | 含义 | contract |
|---|---|---|---|---|
| switcher-registration | calls | project-switcher → project-registration | opens project | 选中目录必须解析出唯一 descriptor |
| registration-store | writes | project-registration → sqlite-graph-store | binds graph store | descriptor identity 限定所有运行表 |
| store-reader | flows_to | sqlite-graph-store → live-desktop-reader | publishes committed snapshot | 只读完整 SQLite 事务 |
| reader-switcher | flows_to | live-desktop-reader → project-switcher | renders selected project | 侧栏和 Canvas 必须指向同一活跃根目录 |

### 9.2 AI 上下文反馈闭环

| id | kind | 路径 | 含义 | contract |
|---|---|---|---|---|
| registration-router | flows_to | project-registration → project-service-router | resolves MCP project | 每个 MCP 服务使用注册身份 |
| router-context | calls | project-service-router → context-retrieval | reads task slice | 上下文只从一个显式路由图生成 |
| context-codex | flows_to | context-retrieval → codex-plugin | feeds agent | 插件获得 Markdown 投影 + 稳定 refs |
| codex-mutation | calls | codex-plugin → atomic-mutation | syncs work | 架构/进度修改使用小 MCP 操作 |
| mutation-store | writes | atomic-mutation → sqlite-graph-store | commits changeset | 一次成功调用推进一个 graph revision |
| reader-verification | validates | live-desktop-reader → verification-suite | proves live refresh | 原生 UI 观察到 MCP 写入无需刷新 |

### 9.3 城市画布投影

| id | kind | 路径 | 含义 | contract |
|---|---|---|---|---|
| store-lenses | flows_to | sqlite-graph-store → view-lenses | projects entities | Lens 过滤同一规范快照 |
| lenses-city | flows_to | view-lenses → city-layout | selects city lots | 可见 Block 通过虚拟关系保持拓扑 |
| city-streets | flows_to | city-layout → orthogonal-street-router | reserves street gutters | 路由复用同一确定性几何 |
| streets-chain | flows_to | orthogonal-street-router → chain-route-overlay | draws reusable routes | Chain 路由复用正交 corridor |
| chain-buildings | constrains | chain-route-overlay → compact-block-card | frames member buildings | 包络包围共享卡片但不拥有 |
| buildings-inspector | flows_to | compact-block-card → detail-inspector | opens details | 选择建筑打开唯一详情视图 |

### 9.4 导航与稳定状态

| id | kind | 路径 | 含义 | contract |
|---|---|---|---|---|
| gesture-city | calls | gesture-navigation → city-layout | changes camera | 手势只改变尺度/偏移，不改语义位置 |
| city-chain-focus | flows_to | city-layout → chain-route-overlay | lays out selected path | Plan/Chain 选择产生有序聚焦街道 |
| chain-inspector | flows_to | chain-route-overlay → detail-inspector | opens route details | Chain 标签打开契约/成员/checkpoint/history |
| plan-chain | flows_to | plan-workflow → chain-route-overlay | targets routes | Plan 引用选择高亮 Chain，不创建节点 |

### 9.5 双语

| id | kind | 路径 | 含义 | contract |
|---|---|---|---|---|
| locale-context | constrains | bilingual-content → context-retrieval | constrains canonical context | locale 只影响固定标题，不改实体与检索索引 |
| locale-lenses | constrains | bilingual-content → view-lenses | localizes interface | 语言只改 chrome；Canvas 事实、选择、布局稳定 |

### 9.6 插件与发布

| id | kind | 路径 | 含义 | contract |
|---|---|---|---|---|
| plugin-install | flows_to | codex-plugin → in-app-plugin-install | exposes supported setup | App 操作使用同一插件身份和版本 |
| install-package | depends_on | in-app-plugin-install → native-app-package | ships setup surface | 发布包包含可诊断安装路径 |
| package-verify | validates | native-app-package → verification-suite | verifies signed bundle | 发布 App 必须通过包、图标、签名、启动检查 |
| atomic-verify | validates | atomic-mutation → verification-suite | tests graph safety | 自动化覆盖 stale revision、路径、隔离 |

### 9.7 语义与空间（当前 health=unknown，需校准）

| id | kind | 路径 | 含义 | 问题 |
|---|---|---|---|---|
| architecture-guides-layout | constrains | architecture-classification → city-layout | 提供稳定层级语义 | 原 label/contract 写“layout consumes layer/scope”，代码实际是“scope/layer 绝不分区，只保留语义；localOrder 参与顺序”；需要改写并验证 |
| layout-drives-semantic-zoom | flows_to | city-layout → semantic-zoom | 每个语义层级来自同一位置模型 | 需要确认语义层级是否仍指缩放；按当前实现改为“同一位置模型驱动缩放与选择” |
| semantic-zoom-preserves-space | constrains | semantic-zoom → stable-view-state | 保持空间记忆 | 已由实现证明，可设置 healthy 并记录 source ref |
| stable-view-frames-routes | constrains | stable-view-state → chain-route-overlay | 稳定 route 交互 | 已由实现证明，可设置 healthy |

## 10. Plan 清单（当前 2 个活动 Plan；旧 Plan 归档不复活）

### 10.1 mdflow-native-migration（活动，critical，foundation #1）

- 状态：`active`；23/27 direct changes、28/35 required gates；typed progress 为 3/5 Chain gates、6/10 Plan gates。
- 角色：mdflow 自身自举迁移与产品级验证的唯一活动入口。
- 目标：证明 mdflow 能替代开发期 Markdown 且在真实项目里无损、省 token、可恢复。
- 下一步：
  1. agent-feedback-loop 的 clean-project LLM/code-edit/recovery 实验；
  2. Developer ID/notarization、干净升级/禁用/回滚和 GitHub 公开上传；
  3. validation-closure、Plan acceptance 与最终 entity_open → graph_validate → Git commit 收口。
- 步骤状态：step-history、step-chain、step-ui、step-large-graph complete；step-versioning、step-reconcile active；step-context、step-projects、step-release、step-cleanup pending。
- ChainScopes：context(partial)、canvas(complete)、navigation(complete)、bilingual(complete)、release(partial)。

### 10.2 open-source-release（ready/blocked，high，delivery #2）

- 状态：`ready`，derived `blocked`；等待主迁移 Plan。
- 4 个步骤全部 pending：发布包 → App 内安装 → 干净环境安装/升级/回滚 → 公开发布审计。
- 禁止把 ad-hoc 签名称作公证；禁止在发布包携带开发期数据。

### 10.3 已归档 Plan（不再作为活动实体）

- `architecture-canvas-v2`
- `city-canvas-rebuild`

归档后仍残留的 checkpoint 需要处理，不能让它们在 App “独立验证”中显示为可点击但不可打开的对象。

## 11. Checkpoint 清单（当前活动摘要）

### 11.1 活动 Block/Chain 的 atomic/integration checkpoint

| checkpoint | target | 状态 | evidence/required | 含义 |
|---|---|---|---|---|
| proof-in-app-plugin-install | block:in-app-plugin-install | passed | static/static | 打包 MarketplaceRoot 与 manifest 校验 |
| bilingual-acceptance | block:bilingual-content | passed | real_target/integration | 界面语言与项目原文隔离 |
| proof-bilingual-content | block:bilingual-content | passed | integration/integration | 默认不写 localizations |
| proof-city-layout | block:city-layout | passed | integration/static | 确定性无重叠布局 |
| large-canvas-acceptance | block:city-layout | passed | real_target/real_target | 大图密度/性能人工门禁；用户已验收 |
| chain-arrow-separation | block:chain-route-overlay | partial_pass | real_target/real_target | 共享路段隔离/箭头单一 |
| proof-chain-route-overlay | block:chain-route-overlay | passed | real_target/static | 蛇形包络基础不变量 |
| proof-codex-plugin | block:codex-plugin | passed | integration/static | 插件安装/MCP 启动 |
| edge-release-acceptance | block:codex-plugin | partial_pass | real_target/real_target | 本地包、manifest、checksum 已过；公证/公开上传仍开放 |
| proof-sqlite-graph-store | block:sqlite-graph-store | passed | integration/static | byte-stable、项目隔离 |
| topic-chain-first-product-scale | block:large-system-benchmark | retest_required | none/static | 真实多层项目适配 |
| todo-mdflow-parity | block:large-system-benchmark | partial_pass | real_target/real_target | 2,344 vs 3,321 tokens；真实 target 通过；LLM/code-edit 仍开放 |
| mdflow-history-diff-complete | block:atomic-mutation | passed | real_target/integration | 历史差异闭环 |
| proof-atomic-mutation | block:atomic-mutation | passed | integration/static | 原子写入与安全回退 |
| proof-native-app-package | block:native-app-package | passed | static/static | bundle/Info.plist/icon/签名 |
| proof-detail-inspector | block:detail-inspector | passed | real_target/static | 独立滚动详情列 |
| detail-inspector-acceptance | block:detail-inspector | passed | real_target/human_review | 用户已确认详情 UI 合格 |
| proof-orthogonal-street-router | block:orthogonal-street-router | passed | static/static | 正交安全 |
| proof-project-switcher | block:project-switcher | passed | integration/static | 原生切换最终人工仍开放 |
| proof-view-lenses | block:view-lenses | passed | real_target/human_review | 用户已确认 Lens UI 合格 |
| proof-product-contract | block:product-contract | passed | static/static | 干净图重建契约 |
| architecture-classification-contract | block:architecture-classification | passed | integration/integration | 显式 scope/layer/order 一致读取 |
| proof-live-desktop-reader | block:live-desktop-reader | passed | real_target/static | 实时刷新无崩溃 |
| proof-plan-workflow | block:plan-workflow | passed | integration/static | Direct Block Work + gates |
| stable-view-navigation-evidence | block:stable-view-state | passed | real_target/static | 选择不重排 |
| proof-compact-block-card | block:compact-block-card | passed | real_target/static | 卡片全缩放保留 summary |
| semantic-zoom-topic-evidence | block:semantic-zoom | passed | real_target/static | 缩放不改事实 |
| proof-verification-suite | block:verification-suite | partial_pass | integration/static | 自动回归基线 |
| validation-closure | block:verification-suite | partial_pass | real_target/human_review | 自动、真实目标与用户验收已部分闭合；发布/LLM/最终 Git 收口仍开放 |
| proof-gesture-navigation | block:gesture-navigation | passed | static/static | 导航几何；physical review open |
| proof-project-registration | block:project-registration | passed | integration/static | 注册与 sidecar 规则（内容需校准） |
| proof-project-service-router | block:project-service-router | passed | integration/static | 多项目隔离路由 |
| proof-context-retrieval | block:context-retrieval | partial_pass | integration/static | 上下文范围化；真实等价性 open |
| proof-agent-feedback-loop | chain:agent-feedback-loop | passed | integration/static | AI↔MCP↔校验闭环 |
| proof-project-lifecycle | chain:project-lifecycle | passed | integration/static | 多项目生命周期 |
| proof-city-canvas-projection | chain:city-canvas-projection | passed | integration/integration | 300 Block/599 Link/6 Chain 路由与用户大图验收 |
| proof-continuous-navigation | chain:continuous-navigation | passed | static/static | 连续导航路径 |
| proof-plugin-release-product | chain:plugin-release | passed | static/static | Topic 品牌发布路径 |
| proof-bilingual-flow | chain:bilingual-flow | passed | real_target/integration | 双语只投影 chrome |

### 11.2 归档/失效 checkpoint（重建时不得进入活动验证）

| checkpoint | 原 target | 状态 | 处理 |
|---|---|---|---|
| product-network-mdflow-native | plan:city-canvas-rebuild | pending | 归档；逻辑并入主 Plan 最终 acceptance gate |
| proof-city-canvas-rebuild | plan:city-canvas-rebuild | retest_required | 归档；重测以主 Plan scope 为准 |
| chain-first-grid-and-routing | plan:architecture-canvas-v2 | retest_required | 归档；其内容由 chain-arrow-separation/large-canvas-acceptance 承接 |

### 11.3 当前活动 Plan gate

| checkpoint | target | 状态 | 说明 |
|---|---|---|---|
| mdflow-self-graph-migrated | plan:mdflow-native-migration | passed | 图谱迁移、覆盖和校验已完成 |
| public-release-closure | plan:mdflow-native-migration | partial_pass | 本地发布包和宣传材料已完成；公证/公开上传仍开放 |
| open-source-release-gate | plan:open-source-release | pending | 发布 Plan gate |
| validation-closure | block:verification-suite | partial_pass | 自动、真实目标与 UI 已部分闭合；LLM、发布和最终 Git 收口仍开放 |

## 12. 已发现并必须在迁移中处理的图谱缺陷

1. 旧 Block 正文失真：
   - `project-registration` 的“SQLite 忽略”描述与实现相反。
   - 多个 Block 的证据文本仍写早期测试数字（15/22/25）。
2. 已归档 Plan 的 checkpoint 仍可被 App 当作独立验证显示，点击后目标不存在：
   - `product-network-mdflow-native`（plan:city-canvas-rebuild）
   - `proof-city-canvas-rebuild`（plan:city-canvas-rebuild）
   - `chain-first-grid-and-routing`（plan:architecture-canvas-v2）
   - 修复方向：MCP/App 的验证索引只暴露“target 当前存在”的 checkpoint，归档目标即使保留历史也不再出现在 inbox。
3. 4 条 Link 健康状态 unknown 且契约与实现不完全一致：
   - `architecture-guides-layout`、`layout-drives-semantic-zoom`、`semantic-zoom-preserves-space`、`stable-view-frames-routes`。
   - 迁移时改写为当前真实语义，能证明的置为 healthy，无法证明的归档。
4. `view-lenses` 与 `city-canvas-projection` 的 checkpoint 是 retest_required：它们证明“默认 Lens 已按当前实现重测”，重建后应在当前 HEAD 重跑并记录证据，不能只改状态。
5. 活动 Plan 的进度为 2/10，但 step 状态与 ChainScope 状态混在一起；重建时 step 作为“执行顺序”，scope/change/gate 作为“任务结构”，不再用两种来源重复表达同一进度。

## 13. 从本 Markdown 迁移到 mdflow 的执行顺序

1. 用 Git 保存当前状态（提交或 tag），确保旧 `.mdflow` 可回退。
2. 按第 4–11 节校准：
   - 修正每个 Block 的正文/contract/status；
   - 修正或归档 4 条问题 Link；
   - 保留 6 条活动 Chain；
   - 保留 2 个活动 Plan 及其 scopes/steps/changes；
   - 归档已失效 checkpoint，保持证据在 history 中可查。
3. 重新整理 checkpoint 归属：
   - 对已进入需求、Plan、Chain/Plan gate 或显式验证范围的 Block 建立自身 atomic/integration checkpoint；架构发现阶段的 checkpoint-free Block 保留为可见 coverage 状态；
   - 每个活动 Chain 有路径级 checkpoint；
   - 每个 Plan 有最终 gate；计划 gate 的 required 子项只来自真实依赖。
4. 逐实体写入并回读；写入后运行 `graph_validate`，必须 0 error、0 warning。
5. 对 retest_required/pending 项只记录自动化证据，不得伪称 real_target/human_review。
6. 校验 App 侧栏不再显示不可打开的归档 checkpoint；实时刷新仍工作。
7. 迁移完成后把 `mdflow-self-graph-migrated` 推进到下一阶段（真实任务验证），不能直接标 passed。

## 14. 迁移后的执行路线（继续开发）

### 14.1 开发功能缺口（尚未实现）

1. ~~新建 Block 时缺少便捷的按需 checkpoint 初始化 mutation~~：已实现 `graph_mutate` 操作 `create_checkpoint`；普通 `create_block` 只记录架构，compact `checkpoint=auto` 或同一 ChangeSet 的 `create_checkpoint` 才明确创建验证义务。
2. ~~从零项目缺少 Foundation Plan 批量初始化~~：`foundation_plan_create` 会在显式实施计划中为未实现 Block 建立 atomic checkpoint、Direct PlanChange、依赖顺序、Chain integration gate 与 Plan acceptance gate；架构-only Block 不会被普通创建隐式验证。
3. `.mdflow` 的人类可读 Git diff 已提供为可重建的 `npm run graph:export` / `docs/graph.snapshot.md`；它是审阅投影，不是第二事实源，二进制 SQLite 仍是唯一规范状态。
4. ~~App 的 Verification inbox 需要过滤归档 target~~：已修复，见第 1 节执行记录。
5. 新建/校准 Block 与 Link 时，healthState 与 checkpoint 应尽量派生，避免手工不一致。

### 14.2 真实验收门禁（不能由自动测试替代）

1. Git checkout/reset/revert/branch switch 后，`.mdflow` 与源码一起恢复且 watcher 正常重开；主要 real-target 路径已通过，仍需最终跨层收口。
2. Todo target 垂直实现已通过；确定性 clean-project 回放已记录 mdflow-first 880 vs Markdown-first 1,107 首次上下文 tokens，以及 1 次增量恢复对 2 次完整文档恢复，但它明确不是 LLM 结果；仍需真实 LLM/code-edit 双路径记录时间、返工次数和恢复差异。
3. 大型真实项目（有前后端/数据库/外部接口）使用 mdflow 完成理解、定位、修改与交接。
4. Canvas 大图自动安全与 30 分钟 real-target 稳定性已通过；city-canvas-projection 与 continuous-navigation gate 已通过，agent-feedback-loop/ plugin-release 仍为 partial。
5. UI lens、Plan inspector 和大图视觉/交互人工验收已由用户确认通过。
6. 多项目并发开发闭环的主要 real-target 路径已通过，仍需与发布/跨层 gate 合并收口。
7. 干净环境插件安装/升级/禁用/回滚、Developer ID 签名、公证与 GitHub 公开上传仍待外部凭据和 repository remote。

## 15. 最终状态定义

- `mdflow-self-graph-migrated` passed 的条件：本基线全部写入并回读、graph_validate 干净、App 无失效验证项、真实任务可以从 `.mdflow` 独立恢复。
- `todo-mdflow-parity` passed 的条件：Todo 双路径完成且结论记录可复现；当前真实 target 垂直实现已通过，LLM/code-edit 双路径仍是剩余实验。
- `validation-closure` passed 的条件：自动 + real_target + human_review 证据链闭合。
- `edge-release-acceptance` / `public-release-closure` passed 的条件：发布产物与源码一致、干净环境可安装、无私有数据、签名/公证说明准确。
- 这些门禁全部通过前，不得宣称“mdflow 已完全替代 Markdown”。
