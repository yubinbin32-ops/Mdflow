<div align="center">
  <img src="assets/logo.png" width="76" alt="ContextOS" />
  <h1>让 AI 带着项目记忆，开始每一次对话。</h1>
  <p><strong>ContextOS · 项目架构、代码坐标、决策与进度的共同工作台</strong></p>
  <p>先看功能地图，再读需要的代码。把项目知识留在 OS，把对话留给当前任务。</p>
  <p><a href="https://github.com/yubinbin32-ops/ContextOS/releases/latest"><strong>下载 macOS App</strong></a> · <a href="#开始使用">开始使用</a> · <a href="#直接复制这些对话">对话示例</a> · <a href="#实测与边界">实测</a> · <a href="README.md">English</a></p>
</div>

![ContextOS 功能地图与检查点演示](assets/contextos-demo.gif)

| 你现在遇到的事 | ContextOS 的使用方式 |
| :--- | :--- |
| 新对话总要重讲项目 | 读取相关功能、规则、决策和当前进度 |
| 为找一个方法读完整文件 | 返回 `path + symbol + 行号`，再按需打开代码 |
| 构建日志挤满上下文 | 通过 `run_command` 返回脱敏、压缩后的结果 |
| README、计划、架构说明各写一份 | 把开发知识写进 OS，按任务生成上下文 |
| AI 说完成了，却找不到验证 | 用 Checkpoint 关联验证证据，代码变化后提示重测 |

> **0.4.0：** 新增知识阅读器、OS Markdown 文档、持久化源码索引与任务收尾。App 打开项目时定期检查源码；已登记的符号落地后退出蓝图状态，缺少绑定、功能链或验证会进入同步待办。功能语义由 AI 声明，系统核对并阻止未验证的交付。

<a id="开始使用"></a>
## 从下载到第一句话

**下载 App → 打开设置 → 安装/同步插件 → 在 Codex 确认 → 新建对话开始使用。**

### 1 · 下载并打开

从 [GitHub Releases](https://github.com/yubinbin32-ops/ContextOS/releases/latest) 下载 **ContextOS-macos.zip**，解压，将 **ContextOS.app** 放入“应用程序”，然后打开。

需要 macOS 14+。插件运行还需要 **Node.js 22+**（本地 SQLite 能力需可用），以及已安装的 Codex。当前发布流程使用临时签名；若系统阻止首次打开，可按住 Control 点击 App，选择“打开”。

### 2 · 打开设置，找到 Codex

点击 ContextOS 的**齿轮设置**，找到“**多平台 AI 编辑器同步**”中的 **Codex**。

点击该行的安装/同步按钮。当前源码界面首次配置显示“**同步配置**”；已有配置时可能显示“重新同步”“更新”或“重新安装”。这是安装插件的入口，不需要自己复制 MCP JSON。

看到“**已就绪**”后继续。若显示“未检测到客户端”，先安装并打开 Codex，再回到设置重试。

### 3 · 在 Codex 确认插件

打开 Codex 的 **Plugins / 插件** 页面，在已安装列表中找 **ContextOS**（本地安装来源可能为 Personal）。确认插件可用，再**新建一个对话**。安装后的 skill 在新会话中加载，官方说明见 [OpenAI 插件指南](https://learn.chatgpt.com/docs/plugins)。

0.4.0 的“已就绪”会同时检查插件与 skill 文件。再让 AI 调用 `runtime_info`，应返回 `0.4.0` 和协议版本 `2`；设置中也能看到最近一次运行握手。旧对话可能仍使用旧插件，需新建对话或重启 Codex。**以新对话能实际调用工具为准。**

### 4 · 选择同一个项目

在 Codex 打开你的代码项目，在 ContextOS 打开同一个项目目录。它应是仓库根目录，例如 `/Users/你的名字/Projects/my-app`，而不是 App 的安装目录。

### 5 · 复制下面这句话

```text
请使用 ContextOS 管理当前项目。先确认 ContextOS 工具和 skill 可用，
用当前项目的绝对路径调用 context_for_task；若项目未注册，先注册。
告诉我项目名称、相关功能、当前进度和同步问题。
不要为了了解架构先通读所有文件；只在实现需要时读取返回坐标对应的代码。
```

**成功标志：** 对话里有真实的 ContextOS 工具调用，结果对应你的项目；ContextOS 能显示该项目的架构。新项目图为空时，让 AI 建立功能地图，不能把“空图无告警”当成已完整接管。

<a id="直接复制这些对话"></a>
## 直接复制这些对话

你只需描述目的，工具调用交给 AI。

<details open>
<summary><strong>第一次接管已有项目：把开发知识搬进 OS</strong></summary>

```text
请用 ContextOS 接管这个项目。首次迁移时，按需检查现有 README、架构说明、
项目规则和代码入口，把功能整理为 Block，把真实业务流程整理为 Chain，
绑定代码的文件路径与符号。项目规则写为带范围的约束，长期取舍写为 Decision，
未完成工作写入 Plan。区分已确认事实、推断和未完成蓝图。
之后开发知识以 OS 为准，不再另建 architecture.md、TODO.md 或决策日志。
保留面向用户的 README、安装教程和许可证；先给出迁移映射，不要直接删除旧文档。
```

首次接管仍需阅读资料；有了可信地图，后续对话才可以减少重复读取。

</details>

<details>
<summary><strong>开发一个新功能：先画蓝图，再写代码</strong></summary>

```text
请增加【你的功能】。先从 ContextOS 读取相关功能与规则，记录必要的 Decision，
在写代码前登记 Block、预期源码位置和功能 Chain 的草稿。
按返回的代码坐标实施，通过 run_command 运行验证。
登记后用 task_begin 声明本次范围和功能链；按阶段调用 task_reconcile。
结束前记录真实检查点，再用 task_finish 完成 Block、Chain 和交接，
如果返回 needs_work 或 projection_pending，继续解决，不要只在对话里说“已完成”。
```

</details>

<details>
<summary><strong>修复问题：只展开相关模块</strong></summary>

```text
【描述现象、期望行为和复现步骤】。请先用 ContextOS 定位对应 Chain 和 Block，
读取适用规则、决策与源码坐标，再打开需要的方法排查。
测试和构建走 run_command，避免粘贴完整日志。
修复后同步绑定并记录验证；无法确认的部分留为待验证，不要直接标为健康完成。
```

</details>

<details>
<summary><strong>写入规则与决策：不用再维护一份项目 MD</strong></summary>

```text
以后【项目规则，例如所有写操作必须经过统一服务层】。
请写入 ContextOS 的项目约束并指定适用范围，不要新建规则 MD。
把【选择方案 A 的原因、放弃方案 B 的原因】记录为 Decision，
关联相关功能范围，让新对话按需读取。
```

</details>

<details>
<summary><strong>准备结束：补齐同步和交接</strong></summary>

```text
请收尾本次任务：检查实际变动是否都有合理的源码绑定；同步已绑定代码，
为新符号确认绑定；记录测试证据，完成已验证 Block。
核对本功能的 Chain 是否包含正确入口、步骤和结果，独立模块说明独立原因。
更新任务进度与下一步，执行 graph_validate，列出本次仍未解决的问题。
```

</details>

<details>
<summary><strong>换一个新对话：从 OS 接着做</strong></summary>

```text
请从 ContextOS 恢复当前项目，先读取任务上下文和进度。
本次要做【任务】。告诉我相关功能、必须遵守的规则、最近决策、未完成项，
然后继续；不要把整个项目的历史、MD 和源码重新读一遍。
若上下文被截断，按相关引用定向展开，并报告还缺少什么。
```

</details>

## 在 App 里读 README，也读 AI 的方案

展开左侧 **知识** 栏目，点击 README 或 OS 文档，在**右侧详情栏**阅读；中间架构画布保持显示。README 只读，修改仍在仓库原文件完成。审计、设计、内部指南由 AI 写进 OS，保留 Markdown 的连贯正文、图片、表格和章节目录；关联按钮可以回到架构里的 Block、Chain 和 Decision。

![知识抽屉与右侧文档详情](assets/knowledge-reader.png)

![README 原位只读与安装教程](assets/readme-reader.png)

```text
请把这次方案写成 ContextOS Document，而不是新建 docs/*.md。
正文保留完整说明、示意图片和验收条件，关联对应的 Block、Chain、Decision。
把简短结论记录为 Decision，返回可在 App 打开的文档链接。
以后更新时按章节修改，避免重复维护两份。
```

本仓库的[同步审计](contextos://knowledge?document=sync-redesign)、[知识阅读设计](contextos://knowledge?document=knowledge-reader-design)和[测量方法](contextos://knowledge?document=benchmark-methodology)已在 OS 中。先在 App 打开本仓库，再点击链接；未安装 App 时可先查看本文教程。机器可读的测量原始数据继续随 Git 保存。

## 看看功能怎样协作

![功能链和代码模块关系演示](assets/path-impact.png)

从 Chain 查看模块之间的关系，AI 按返回的代码坐标展开实现。

![检查点与证据演示](assets/checkpoint-detail.png)

检查点把“完成”与实际验证关联起来。以上两张为已有功能演示图，具体界面以当前版本为准。

## 不用记术语，也能看懂工作台

| OS 中的内容 | 相当于原来的什么 | 什么时候写 |
| :--- | :--- | :--- |
| Block | 一个功能模块及其职责、接口 | 实现之前先登记 |
| Chain + Link | 业务流程及模块关系 | 功能规划时建立草稿，完成时核对 |
| SourceBinding | 文件和方法的目录 | 实现、重命名、移动后同步 |
| 带范围的规则 | 项目约定、编码规范 | 约定确定或改变时 |
| Decision | 为什么这样设计 | 作出重要取舍时 |
| Plan / Timeline | 待办、进度、交接 | 开工、暂停、完成时 |
| Checkpoint | 验证结果 | 实际检查之后 |
| Document | 审计、设计说明、内部指南 | 需要完整文字说明时 |
| TaskSession | 本次开发范围与同步收尾 | 开工登记，验证后完成 |

**Ghost 是蓝图，源码落地是实现，验证通过才是交付。** 有文件不代表功能已经完成；独立 Block 也不必为了消除告警被塞入一条无意义的链。

OS 的目标是替代**开发期项目知识文档**。面向使用者的教程仍保留在 README；源码依然是行为依据，OS 返回的定位索引帮助 AI 少读、准确读，不保证完全不用读代码。

<a id="实测与边界"></a>
## 实测：少返回多少，也看有没有遗漏

2026-09-12，本仓库隔离快照，Apple M1 / Node v22.22.1，59 Blocks、10 Chains、85 Links。原始结果与输入哈希见 [JSON](docs/benchmarks/2026-09-12-v040.json)，方法见[测量说明](contextos://knowledge?document=benchmark-methodology)。

| 指标 | 本次结果 | 如何理解 |
| :--- | :--- | :--- |
| 功能链定位索引 | 211,851 → 2,059 字符，减少 **99.02%** | 对比链中对应的 4 个完整文件；后续读代码另计 |
| 合成日志压缩 | 10,071 → 828 字符，减少 **91.78%** | 固定模拟日志，保留模块错误与失败退出信息 |
| 单次任务摘要 | 4,000 字符 | 预算 4,000；4 个查询全部截断 |
| 目标模块可见命中 | **4/4** | 固定查询预设目标出现在正文；非普遍召回率 |
| 本地检索耗时 | P50 **394.15 ms** / P95 **465.35 ms** | 12 次服务层调用，非生产性能承诺 |

相同四个查询的[修改前快照](docs/benchmarks/2026-09-12.json)命中 1/4。本次同时调整了排序与过时的功能说明，语料和源码都已变化，因此不是只替换检索算法的控制实验。4,000 字符仍不足以容纳所有细节，需按章节或实体引用继续展开。

**作者个人体验：使用后感觉上下文压缩触发频率约减少 60%。这是主观体感，没有进行会话对照计数，不能作为实测效果或收益保证。** 文本体积、模型 token、会话压缩次数是不同指标；需要同模型、同任务的对照会话才能证明。我们也不以全量图谱与小摘要的尺寸差，宣称实际任务节省 99% token。

## 遇到问题

| 现象 | 处理 |
| :--- | :--- |
| AI 找不到工具 | 在 Codex 确认插件，新建对话；必要时重新同步并重启 |
| 提示找不到 Node / SQLite | 安装支持内置 SQLite 的 Node.js 22+；确认客户端能找到 `node` |
| 工具读到另一个项目 | 显式传当前仓库绝对路径；worktree 要使用自己的路径 |
| App 与插件版本不一致 | 设置里更新/重新同步，重启 Codex，检查运行版本 |
| 写了代码还是 Ghost | 让 AI 检查目标符号、绑定、检查点，再完成；不要仅根据文件存在改状态 |
| 有 Block 没有功能链 | 让 AI 核对该功能入口、结果和模块关系，显式建立/更新 Chain |
| 摘要截断或规则只有标题 | 按引用展开必要规则/决策，再做实现；必要时扩大预算 |
| 修改代码后检查点过期 | 重跑受影响验证并记录，不要用旧通过结果覆盖 |

## 给开发者

```bash
git clone https://github.com/yubinbin32-ops/ContextOS.git
cd ContextOS
npm ci
npm test
npm run benchmark -- --output /tmp/contextos-benchmark.json
npm run plugin:verify
npm run desktop:build
```

桌面构建需要 macOS 与 Swift/Xcode 工具链。无桌面使用：在项目根目录执行下面命令（Node.js 22+）。`init --scan` 只生成初始地图，仍需核对业务语义。

```bash
npx -y github:yubinbin32-ops/ContextOS init --scan
npx -y github:yubinbin32-ops/ContextOS status
npx -y github:yubinbin32-ops/ContextOS serve
```

架构意图存放在 `.contextos/graph.json`，SQLite 服务本地查询与运行证据。将图谱与相关源码一起提交；Git 恢复文件后仍需检查绑定与证据状态。规则、决策在 OS 维护，公开文档作为人类入口。

[参与贡献](CONTRIBUTING.md) · [安全政策](SECURITY.md) · [MIT License](LICENSE)
