import { createService } from "./service.mjs";

const zh = (title, summary, contract = "") => ({ "zh-Hans": { title, summary, contract } });
const zhChain = (title, intent, inputContract = "", outputContract = "") => ({
  "zh-Hans": { title, intent, inputContract, outputContract },
});

export const designBlocks = [
  ["product-context-layer", "product", "Executable project context", "Replace repeated full-document reads with task-scoped graph context.", "Agent reads a bounded Context Pack and expands only referenced entities.", "可执行的项目上下文", "用任务范围内的图上下文替代反复读取完整文档。", "AI 读取有预算的 Context Pack，并只展开被引用实体。", "critical"],
  ["mcp-change-service", "service", "MCP change service", "Allow agents to query and atomically synchronize architecture and progress.", "Mutations are limited, revision-checked, transactional, and appended to change_feed.", "MCP 变更服务", "允许 AI 查询并原子同步架构与进度。", "修改受大小限制、版本校验和事务保护，并追加到 change_feed。", "critical"],
  ["live-graph-viewer", "ui", "Live graph viewer", "Render Block, Chain, Link and state changes without manual refresh.", "Observe change_feed and animate to the newest committed graph revision.", "实时图查看器", "无需手动刷新即可渲染 Block、Chain、Link 和状态变化。", "监听 change_feed，并动画更新到最新已提交图版本。", "critical"],
  ["codex-plugin-delivery", "integration", "Codex plugin delivery", "Package the MCP server and synchronization Skill as one installable plugin.", "Plugin manifest references the bundled stdio MCP server and mdflow Skill.", "Codex 插件交付", "把 MCP 服务和同步 Skill 打包为一个可安装插件。", "插件清单引用已打包的 stdio MCP 服务与 mdflow Skill。", "high"],
  ["single-source-of-truth", "principle", "One fact, one home", "Every fact is authored once and referenced everywhere else.", "Views are projections; they never own architecture or progress data.", "一个事实，一个归属", "每项事实只在一个位置维护，其他位置只引用。", "所有视图都是投影，不拥有架构或进度数据。", "critical"],
  ["semantic-not-ast", "principle", "Semantic graph over code graph", "Model product intent, contracts and decisions rather than mirroring files or AST nodes.", "Source references point to implementation without making the repository tree the information architecture.", "语义图优先于代码图", "建模产品意图、契约和决策，而不是复制文件或 AST。", "源码引用只负责追溯实现，不决定信息架构。", "critical"],
  ["evidence-backed-state", "principle", "Evidence-backed completion", "Complete and healthy are claims that require passed checkpoints and inspectable evidence.", "A state change and its evidence are committed as graph history.", "基于证据的完成状态", "完成与健康必须由通过的检查点和可查看证据支撑。", "状态变化及其证据作为图历史保存。", "critical"],
  ["live-consistency", "decision", "Live consistency without refresh", "MCP writes and App reads converge through a monotonic change feed.", "The App observes sequence changes and renders the newest committed revision automatically.", "无需刷新的实时一致性", "MCP 写入与 App 读取通过单调递增的变更流收敛。", "App 监听序号并自动渲染最新已提交版本。", "critical"],

  ["project-boundary", "data", "Project identity", "A small descriptor binds repository root, stable ID and schema version.", "Resolve the nearest .mdflow/project.json; store runtime data outside the repository.", "项目身份", "轻量描述文件绑定仓库根目录、稳定 ID 与 schema 版本。", "解析最近的 .mdflow/project.json，运行数据保存在仓库之外。"],
  ["block-model", "data", "Block semantic unit", "A Block carries kind, summary, body, contract, state, confidence and source references.", "Block IDs remain stable while revisions advance under optimistic concurrency.", "Block 语义单元", "Block 承载类型、摘要、正文、契约、状态、置信度与源码引用。", "Block ID 保持稳定，修改通过乐观并发推进版本。"],
  ["link-model", "data", "Typed Link", "A Link expresses direction, semantics, label, contract and health between entities.", "Endpoints must exist; operational links such as calls, reads and writes require contracts.", "类型化 Link", "Link 表达实体之间的方向、语义、标签、契约与健康状态。", "端点必须存在；calls、reads、writes 等操作关系必须有契约。"],
  ["chain-model", "data", "Chain overlay over the project graph", "A Chain names and validates a reusable path through existing global Blocks and Links; it owns neither.", "Store explicit node and edge references. The same Block and Link may participate in multiple Chains. Removing a Chain never removes graph entities.", "覆盖项目网络的 Chain", "Chain 命名并验证全局 Block/Link 网络中的可复用路径，但不拥有它们。", "显式保存节点和边引用；同一 Block 与 Link 可参与多条 Chain；删除 Chain 不删除图实体。", "critical"],
  ["global-project-network", "data", "Global project network", "All Blocks and typed Links form one canonical connected project topology before any Chain is considered.", "Every Block has one stable identity and one Canvas position. Cross-domain Links remain visible independently of Chain membership.", "全局项目网络", "先由全部 Block 与类型化 Link 构成唯一项目拓扑，再在其上定义 Chain。", "每个 Block 只有一个稳定身份和画布位置；跨领域 Link 不依赖 Chain 归属而存在。", "critical"],
  ["independent-plan-model", "data", "Independent Plan model", "A Plan is a work-management entity linked to one or more target Chains, never a Block or Chain.", "Plan owns goal, status, priority, graph delta, next action, blockers, checkpoints and history; Todo is derived from unfinished Plan checkpoints.", "独立 Plan 模型", "Plan 是关联一条或多条目标 Chain 的工作管理实体，不是 Block 或 Chain。", "Plan 拥有目标、状态、优先级、图变更、下一步、阻塞、检查点和历史；Todo 由未完成检查点派生。", "critical"],
  ["background-block-scope", "principle", "Scoped Background Block", "Cross-cutting project rules remain special unlinked Blocks and enter context by declared scope.", "A Background Block declares project, lens, Chain or repository scope. It never fabricates a business Link.", "带作用域的 Background Block", "跨领域项目规则保留为不连线的特殊 Block，并按声明作用域进入上下文。", "Background Block 声明项目、视图、Chain 或仓库作用域，绝不伪造业务 Link。", "critical"],
  ["source-reference-model", "data", "Source references", "Blocks point to relevant files, line ranges, symbols and roles for inspection.", "References are secondary evidence and must not duplicate code contents.", "源码引用", "Block 可指向相关文件、行范围、符号与角色，便于查阅。", "引用是辅助证据，不复制代码内容。"],
  ["checkpoint-history-model", "data", "Checkpoint and history", "Checkpoints define acceptance criteria and evidence; history records why each revision changed.", "Entity details show only their own checkpoints, sources and recent history.", "检查点与历史", "检查点定义验收标准和证据；历史记录每个版本为何变化。", "详情栏只显示当前实体自己的检查点、源码与近期历史。"],

  ["task-resolver", "function", "Task resolver", "Convert a natural-language task and optional focus refs into query terms and priority signals.", "Task text is never treated as graph instructions; it only affects relevance scoring.", "任务解析器", "把自然语言任务与可选焦点引用转换为查询词和优先级信号。", "任务文本不作为图指令，仅影响相关性评分。"],
  ["relevance-ranking", "function", "Semantic relevance ranking", "Rank bilingual titles, summaries, contracts, tags and critical constraints.", "Prefer focused refs, task matches and critical principles; cap selected entities.", "语义相关性排序", "对双语标题、摘要、契约、标签与关键约束进行排序。", "优先焦点引用、任务匹配和关键原则，并限制实体数量。"],
  ["bounded-context-pack", "service", "Bounded Context Pack", "Return only task-relevant constraints, Chains, Blocks, Links and open checkpoints.", "Default output is at most 12,000 characters and exposes refs for progressive expansion.", "有预算的 Context Pack", "只返回与任务相关的约束、Chain、Block、Link 和未完成检查点。", "默认最多 12,000 字符，并提供引用用于渐进展开。"],
  ["progressive-entity-open", "service", "Progressive entity expansion", "Open one entity with its contract, sources, checkpoints and recent history.", "Do not reload the whole graph to answer a local question.", "渐进式实体展开", "打开单个实体及其契约、源码、检查点和近期历史。", "回答局部问题时不重新加载整张图。"],

  ["mcp-read-tools", "service", "MCP read surface", "Expose project map, task context, entity detail, search and validation as compact tools.", "Each read returns structured data plus human-readable Markdown.", "MCP 读取接口", "以紧凑工具提供项目地图、任务上下文、实体详情、搜索和验证。", "每次读取同时返回结构化数据与可读 Markdown。"],
  ["atomic-mutation", "service", "Atomic graph mutation", "Apply up to ten small operations in one SQLite transaction with one ChangeSet.", "Any failed operation rolls back the entire mutation and emits no partial feed.", "原子图修改", "在一个 SQLite 事务和 ChangeSet 中执行最多十个小操作。", "任一操作失败即整体回滚，不产生部分变更流。"],
  ["revision-guard", "function", "Revision guard", "Reject stale updates using required expectedRevision values.", "Conflicts report expected and current revisions so the agent can reread and retry.", "版本守卫", "通过必填 expectedRevision 拒绝过期修改。", "冲突返回预期与当前版本，AI 可重新读取后重试。"],
  ["change-feed", "database", "Monotonic change feed", "Append one sequence entry per committed entity operation.", "Readers compare the latest sequence before loading a new snapshot.", "单调变更流", "每个已提交实体操作追加一条有序序号记录。", "读取端先比较最新序号，再决定是否加载新快照。"],

  ["snapshot-reader", "service", "Read-only snapshot reader", "The macOS App loads committed graph state through a read-only SQLite connection.", "The visual client cannot mutate architecture; agents use MCP for writes.", "只读快照读取器", "macOS App 通过只读 SQLite 连接加载已提交图状态。", "可视化客户端不能修改架构；AI 通过 MCP 写入。"],
  ["live-observer", "function", "Live change observer", "Poll only the feed sequence and reload when it advances.", "A changed entity receives a short visual pulse; no refresh control is exposed.", "实时变更观察器", "只轮询变更序号，仅在序号推进时重载。", "变化实体短暂高亮，界面不提供刷新按钮。"],
  ["lens-projection", "ui", "Lens projection", "Top checkboxes select All, UI, Runtime, API, Data, QA or unfinished Plan views.", "Multiple lenses form a union; one fact remains in the graph and is merely projected.", "视图透镜投影", "顶部复选框选择全部、界面、运行时、API、数据、质量或未完成计划视图。", "多个透镜取并集；事实仍只存在图中，界面只是投影。"],
  ["orthogonal-layout", "function", "Deterministic global network layout", "Lay out every Block once in stable semantic zones and route global Links orthogonally.", "Positions derive from stable Block identity and zone; selecting or filtering never rewrites topology.", "确定性的全局网络布局", "每个 Block 只布局一次，放入稳定语义区域，并用直角线连接全局 Link。", "位置由稳定 Block 身份和区域决定；选择或筛选不改写拓扑。"],
  ["zoom-pan-canvas", "ui", "Zoomable infinite-feeling Canvas", "Support 50–180% zoom, pinch gestures and two-axis panning with persistent readable controls.", "Scaling changes presentation only and preserves selection, focus and expansion state.", "可缩放平移画布", "支持 50%–180% 缩放、捏合手势与双轴平移，并提供清晰控件。", "缩放只改变呈现，保留选择、聚焦与展开状态。"],
  ["summary-card", "ui", "Summary-first Block cards", "Every global Block shows identity, concise summary, delivery state and Chain memberships.", "Cards truncate summaries; full contracts, files, checkpoints and history live only in Detail.", "摘要优先 Block 卡片", "每个全局 Block 展示身份、简短摘要、交付状态和所属 Chain。", "卡片截断摘要；完整契约、文件、检查点与历史只在详情栏展示。"],
  ["single-detail-panel", "ui", "Single detail panel", "The right panel is the sole place for complete entity information.", "Selecting another entity replaces the panel; content is never duplicated in overlays or inspectors.", "唯一详情栏", "右侧栏是完整实体信息的唯一位置。", "选择其他实体即替换详情；内容不会复制到浮层或其他检查器。"],
  ["minimal-navigation", "ui", "Minimal information architecture", "The left rail contains project Overview and independent Plans; the Canvas always remains the global network.", "Selecting a Plan highlights target Chains; selecting a Block centers it without resetting zoom or topology.", "极简信息架构", "左侧只保留项目概览与独立 Plan，Canvas 始终呈现全局网络。", "选择 Plan 高亮目标 Chain；选择 Block 居中目标，但不重置缩放或拓扑。"],
  ["stable-camera-focus", "ui", "Stable camera focus", "Selecting an entity centers it smoothly while preserving scale, topology and spatial memory.", "Block selection never scrolls to origin or relayouts unrelated nodes; Plan selection fits only its target Chains.", "稳定相机聚焦", "选择实体时平滑居中，同时保持缩放、拓扑与空间记忆。", "选择 Block 不回到原点，也不重排无关节点；选择 Plan 只适配其目标 Chain。", "high"],

  ["localized-graph-content", "data", "Localized graph content", "Store field-level English and Simplified Chinese variants without duplicating entities.", "Localized text has entity, locale and field keys with canonical fallback.", "图内容本地化", "以字段级英文和简体中文变体实现双语，不复制实体。", "本地化文本由实体、语言与字段唯一定位，并回退到主数据。"],
  ["locale-resolution", "function", "Locale resolution", "Resolve System, 中文 or English preference and apply it to UI and graph content.", "Changing language reprojects the current snapshot instantly and persists the preference.", "语言解析", "解析跟随系统、中文或 English 偏好，并应用于界面和图内容。", "切换语言会立即重投影当前快照并保存偏好。"],
  ["bilingual-retrieval", "service", "Bilingual retrieval", "Search and task context score every localized variant, then render the requested locale.", "Chinese and English queries resolve to the same stable entity refs.", "双语检索", "搜索与任务上下文对所有语言变体评分，再按请求语言渲染。", "中英文查询命中相同的稳定实体引用。"],

  ["plugin-manifest", "integration", "Codex plugin manifest", "Package manifest, MCP declaration, Skill and icon as one versioned plugin folder.", "Plugin paths remain relative and the bundled server has no workspace dependency.", "Codex 插件清单", "把清单、MCP 声明、Skill 与图标组成一个版本化插件目录。", "插件路径保持相对，打包后的服务不依赖工作区。"],
  ["sync-skill", "integration", "Agent synchronization Skill", "Tell an agent when to read context, mutate progress and revise architecture.", "Use MCP after material decisions and implementation milestones, with concise ChangeSet reasons.", "AI 同步 Skill", "规定 AI 何时读取上下文、同步进度以及修改架构。", "在重要决策和实现里程碑后调用 MCP，并写清 ChangeSet 原因。"],
  ["plugin-install-diagnostics", "integration", "Plugin installation diagnostics", "Expose bundle location now and reserve install-state diagnostics as the next integration slice.", "Installation must never be falsely reported; verify manifest, server launch and connected tools.", "插件安装诊断", "当前提供插件包位置，并把安装状态诊断作为下一集成切片。", "不得误报安装成功；必须验证清单、服务启动和工具连接。"],
  ["app-bundle-icon", "ui", "Native App icon", "Package the mdflow mark as a multi-resolution macOS icon instead of leaving the bundle blank.", "Info.plist names AppIcon and the signed bundle contains a valid ICNS resource.", "原生应用图标", "把 mdflow 标记打包为多分辨率 macOS 图标，不再让应用包显示空图标。", "Info.plist 声明 AppIcon，签名后的应用包包含有效 ICNS 资源。"],

  ["graph-validation", "test", "Graph integrity validation", "Detect dangling refs, empty Chains, missing operational contracts and unsupported completion claims.", "Validation returns errors, warnings and the graph revision without mutating state.", "图完整性验证", "检测悬空引用、空 Chain、缺失操作契约和无依据的完成声明。", "验证只返回错误、警告与图版本，不修改状态。"],
  ["golden-context-queries", "test", "Golden context queries", "Exercise UI, mutation, plugin and bilingual tasks against the real design graph.", "Each query must include its target concepts and stay below its context budget.", "黄金上下文查询", "使用真实设计图验证界面、修改、插件和双语任务。", "每个查询必须包含目标概念并保持在上下文预算内。"],
  ["design-graph-bootstrap", "integration", "Design graph bootstrap", "Idempotently migrate the product design into fine-grained Blocks, Chains, Links and translations.", "Reruns create missing data only and preserve runtime progress or agent edits.", "设计图引导迁移", "把产品设计幂等迁移为细粒度 Block、Chain、Link 与翻译。", "重复运行只创建缺失数据，并保留运行进度和 AI 修改。"],
  ["core-workflow-evaluation", "test", "Core workflow evaluation", "Prove that AI and developers can read, change, diagnose and verify the project through mdflow alone.", "Measure context reduction, required-fact recall, mutation safety, live latency, graph comprehension and three document-free tasks.", "核心工作流评估", "证明 AI 与开发者可以只通过 mdflow 读取、修改、诊断并验证项目。", "测量上下文压缩、必要事实召回、写入安全、实时延迟、架构理解以及三个无文档任务。", "critical"],
].map(([id, kind, title, summary, contract, zhTitle, zhSummary, zhContract, priority = "normal"]) => ({
  id,
  fields: {
    kind, title, summary, contract, priority,
    deliveryState: ["zoom-pan-canvas", "summary-card", "localized-graph-content", "locale-resolution", "bilingual-retrieval"].includes(id) ? "implementing" : "planned",
    healthState: "unknown",
    tags: [kind, ...id.split("-").slice(0, 2)],
    localizations: zh(zhTitle, zhSummary, zhContract),
  },
}));

export const designChains = [
  ["initial-live-slice", "Live MCP → Canvas slice", "Prove that an agent mutation is persisted, observed and rendered without refresh.", ["product-context-layer", "mcp-change-service", "live-graph-viewer", "codex-plugin-delivery"], "MCP → 画布实时切片", "证明 AI 修改可以持久化、被观察，并无需刷新地渲染。"],
  ["semantic-model-chain", "Semantic model", "Define the global topology, reusable Chain overlays, independent Plans and scoped Background Blocks.", ["project-boundary", "block-model", "link-model", "global-project-network", "chain-model", "independent-plan-model", "background-block-scope", "source-reference-model", "checkpoint-history-model"], "架构语义模型", "定义全局拓扑、可复用 Chain 覆盖层、独立 Plan 和带作用域的 Background Block。"],
  ["context-retrieval-chain", "Task context retrieval", "Resolve a task into a bounded context pack, then expand only selected entities.", ["task-resolver", "relevance-ranking", "bounded-context-pack", "progressive-entity-open"], "任务上下文检索", "把任务解析为有预算的上下文包，再只展开选中的实体。"],
  ["mutation-sync-chain", "Safe mutation and synchronization", "Turn an agent decision into an atomic, conflict-safe, observable graph revision.", ["mcp-read-tools", "atomic-mutation", "revision-guard", "change-feed"], "安全修改与同步", "把 AI 决策转化为原子、可处理冲突且可观察的图版本。"],
  ["viewer-experience-chain", "Minimal live viewer", "Read live state and present one non-duplicated path from overview to detail.", ["snapshot-reader", "live-observer", "minimal-navigation", "single-detail-panel"], "极简实时查看器", "读取实时状态，提供从概览到详情且不重复内容的一条路径。"],
  ["canvas-projection-chain", "Canvas projection and navigation", "Project one global graph into stable zones with Chain overlays, focus, filtering, panning and zoom.", ["global-project-network", "lens-projection", "orthogonal-layout", "stable-camera-focus", "zoom-pan-canvas", "summary-card"], "画布投影与导航", "把唯一全局图投影为稳定区域、Chain 覆盖层、聚焦、筛选、平移和缩放。"],
  ["bilingual-experience-chain", "Bilingual experience", "Use one entity graph across Chinese and English UI, search and agent context.", ["localized-graph-content", "locale-resolution", "bilingual-retrieval"], "双语体验", "让同一实体图服务于中英文界面、搜索和 AI 上下文。"],
  ["plugin-delivery-chain", "Codex plugin delivery", "Deliver the MCP server, synchronization protocol and native identity as a verifiable package.", ["plugin-manifest", "sync-skill", "plugin-install-diagnostics", "app-bundle-icon"], "Codex 插件与应用交付", "把 MCP 服务、同步协议与原生应用身份交付为可验证的软件包。"],
  ["developer-change-loop", "AI development feedback loop", "Read bounded context, mutate safely and observe the committed change in the developer Canvas.", ["bounded-context-pack", "mcp-read-tools", "atomic-mutation", "revision-guard", "change-feed", "snapshot-reader", "live-observer", "live-graph-viewer"], "AI 开发反馈闭环", "读取有预算的上下文、安全修改，并在开发者 Canvas 中看到已提交变化。"],
].map(([id, title, intent, members, zhTitle, zhIntent]) => ({
  id, members,
  fields: {
    title, purpose: "architecture", intent,
    inputContract: "A task, decision or implementation change.",
    outputContract: "A traceable graph path with contracts, state and evidence.",
    deliveryState: "implementing", healthState: "unknown", priority: "high",
    localizations: zhChain(zhTitle, zhIntent, "任务、决策或实现变化。", "包含契约、状态和证据的可追溯图路径。"),
  },
}));

function chunks(items, count) {
  const output = [];
  for (let index = 0; index < items.length; index += count) output.push(items.slice(index, index + count));
  return output;
}

export function populateDesignGraph(service) {
  let snapshot = service.snapshot();
  const existingBlocks = new Map(snapshot.blocks.map((item) => [item.id, item]));
  const existingChains = new Map(snapshot.chains.map((item) => [item.id, item]));
  const localizedEntities = new Set(snapshot.localizations.map((item) => `${item.entityType}:${item.entityId}`));
  const createOps = [];
  for (const block of designBlocks) {
    const existing = existingBlocks.get(block.id);
    if (!existing) createOps.push({ action: "create_block", id: block.id, fields: block.fields });
    else if (!localizedEntities.has(`block:${block.id}`)) createOps.push({ action: "update_block", id: block.id, expectedRevision: existing.currentRevision, fields: { localizations: block.fields.localizations }, summary: "Add Chinese localization" });
  }
  for (const chain of designChains) {
    const existing = existingChains.get(chain.id);
    if (!existing) createOps.push({ action: "create_chain", id: chain.id, fields: chain.fields });
    else if (!localizedEntities.has(`chain:${chain.id}`)) createOps.push({ action: "update_chain", id: chain.id, expectedRevision: existing.currentRevision, fields: { localizations: chain.fields.localizations }, summary: "Add Chinese localization" });
  }
  for (const operations of chunks(createOps, 3)) service.mutate({ actor: "design-bootstrap", reason: "Migrate bilingual product design into the semantic graph", operations });

  snapshot = service.snapshot();
  const membershipOps = [];
  for (const chain of designChains) {
    const existing = snapshot.chains.find((item) => item.id === chain.id);
    const current = snapshot.members.filter((item) => item.chainId === chain.id).sort((a, b) => a.position - b.position).map((item) => item.memberId);
    if (current.join("|") !== chain.members.join("|")) membershipOps.push({ action: "set_chain_members", id: chain.id, expectedRevision: existing.currentRevision, members: chain.members.map((id) => ({ type: "block", id })) });
  }
  for (const operations of chunks(membershipOps, 5)) service.mutate({ actor: "design-bootstrap", reason: "Compose design Chains from ordered Blocks", operations });

  snapshot = service.snapshot();
  const existingLinks = new Set(snapshot.links.map((item) => item.id));
  const linkOps = [];
  for (const chain of designChains) {
    for (let index = 0; index < chain.members.length - 1; index += 1) {
      const sourceId = chain.members[index];
      const targetId = chain.members[index + 1];
      const id = `link-${sourceId}-to-${targetId}`;
      if (!existingLinks.has(id)) linkOps.push({ action: "create_link", id, fields: { sourceType: "block", sourceId, targetType: "block", targetId, kind: "flows_to", label: "next", contract: "The target consumes the source outcome while preserving stable entity references.", healthState: "unknown", localizations: { "zh-Hans": { label: "下一步", contract: "下游消费上游结果，并保留稳定实体引用。" } } } });
    }
  }
  for (const operations of chunks(linkOps, 4)) service.mutate({ actor: "design-bootstrap", reason: "Connect ordered design paths", operations });

  snapshot = service.snapshot();
  const sourceSpecs = [
    ["localized-graph-content", "packages/mcp/src/database.mjs", "localized_text"],
    ["bilingual-retrieval", "packages/mcp/src/service.mjs", "contextForTask"],
    ["zoom-pan-canvas", "apps/desktop/Sources/MdflowDesktop/GraphCanvasView.swift", "GraphCanvasView"],
    ["summary-card", "apps/desktop/Sources/MdflowDesktop/GraphCanvasView.swift", "blockCard"],
    ["lens-projection", "apps/desktop/Sources/MdflowDesktop/GraphCanvasView.swift", "projectedLinks"],
    ["single-detail-panel", "apps/desktop/Sources/MdflowDesktop/DetailView.swift", "DetailView"],
    ["minimal-navigation", "apps/desktop/Sources/MdflowDesktop/ContentView.swift", "ContentView"],
    ["locale-resolution", "apps/desktop/Sources/MdflowDesktop/GraphStore.swift", "activeLocale"],
    ["design-graph-bootstrap", "packages/mcp/src/design-graph.mjs", "populateDesignGraph"],
    ["app-bundle-icon", "apps/desktop/Resources/Info.plist", "CFBundleIconFile"],
    ["app-bundle-icon", "apps/desktop/Resources/AppIcon.icns", "AppIcon"],
  ];
  const sourceOps = sourceSpecs.filter(([blockId, path]) => !snapshot.sourceRefs.some((item) => item.blockId === blockId && item.path === path)).map(([id, path, symbol]) => ({ action: "add_source_ref", id, fields: { path, symbol, role: "implementation" } }));
  for (const operations of chunks(sourceOps, 8)) service.mutate({ actor: "design-bootstrap", reason: "Attach implementation evidence to design Blocks", operations });
  return service.snapshot();
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const service = createService();
  const snapshot = populateDesignGraph(service);
  console.log(`Design graph ready: ${snapshot.blocks.length} Blocks, ${snapshot.chains.length} Chains, ${snapshot.links.length} Links, revision ${snapshot.project.graphRevision}.`);
  service.close();
}
