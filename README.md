<div align="center">
  <img src="assets/logo.png" width="88" alt="mdflow logo" />
  <h1>mdflow</h1>
  <p><strong>让复杂项目，一眼看清；让每次修改，都有依据。</strong></p>
  <p><code>macOS 14+</code>&nbsp;&nbsp;·&nbsp;&nbsp;<code>开源</code>&nbsp;&nbsp;·&nbsp;&nbsp;<code>v0.1.0</code></p>
</div>

> mdflow 不是再写一份更长的 Markdown。它把项目结构、进度、任务上下文与验证依据放进一个实时同步的工作图谱：人看全局，AI 按任务读取，开发过程可回溯。

## 先看一段真实操作

<p align="center">
  <img src="assets/mdflow-demo.gif" alt="mdflow 操作演示：筛选、重排、查看路径与验证" width="100%" />
</p>

<p align="center"><sub>顶部筛选 → Canvas 自动重排 → 选择影响路径 → 查看验证依据。GIF 为用户提供的真实 App 录屏。</sub></p>

## 三个痛点，三组功能

### 1. 项目变大后，没人能一眼说清现在发生了什么

mdflow 把功能、依赖、状态和进度放进同一个 Canvas。顶部勾选类别时，视图会根据当前内容动态重排，而不是留下大片空白或让信息互相遮挡；打开项目就能看到全局，不必在几十份文档之间来回寻找。

<p align="center">
  <img src="assets/canvas-overview.png" alt="全局 Canvas：项目结构、进度和依赖一览" width="100%" />
</p>

<p align="center"><sub>全局视图：左侧是当前工作与进度，中间是可缩放的项目关系图，顶部筛选器控制可见范围。</sub></p>

### 2. AI 不应该每次都重新读完整个项目

mdflow 内置 MCP。AI 只请求当前任务需要的上下文：相关规则、工作项、依赖、最近变化和验证依据；默认返回短而有顺序的 Markdown，需要精确字段时才请求 JSON。上下文更短，重复阅读更少，也更不容易把别的项目或旧说明带进来。

<table>
  <tr>
    <td width="55%" valign="top">
      <img src="assets/mcp-integration.png" alt="MCP 插件入口与安装" width="100%" />
      <p align="center"><sub>内置 MCP：从工具入口直接接入当前项目。</sub></p>
    </td>
    <td width="45%" valign="top">
      <img src="assets/settings-sync.png" alt="设置中的实时数据与项目切换" width="100%" />
      <p align="center"><sub>实时数据绑定当前项目，变化自动同步，无需刷新。</sub></p>
    </td>
  </tr>
</table>

### 3. 开发几轮以后，说明与代码不能越走越偏

每次重要修改都留下变更、原因和验证结果。路径视图能说明一次改动会影响哪里；验证详情能说明标准是什么、证据在哪里。没有依据的工作不会被悄悄算作完成，项目始终能回到“改了什么、为什么改、是否可以交付”。

<p align="center">
  <img src="assets/path-impact.png" alt="路径视图：查看一组改动的影响范围" width="100%" />
</p>

<p align="center"><sub>沿路径查看影响范围：相关功能和交付边界被放在同一条可追溯的关系线上。</sub></p>

<p align="center">
  <img src="assets/checkpoint-detail.png" alt="验证详情：状态、标准和证据" width="62%" />
</p>

<p align="center"><sub>验证详情：状态、验收标准、命令结果和历史记录集中展示。</sub></p>

## 从打开项目到交付

```text
打开项目  →  看清全局  →  选择当前任务  →  AI 读取精准上下文
    ↑                                              ↓
    └──────────── 修改、回写、验证、实时同步 ────────┘
```

| 你要做什么 | mdflow 如何帮助你 |
| --- | --- |
| 了解项目 | 一个 Canvas 看结构、进度和影响范围 |
| 让 AI 开始工作 | MCP 只返回当前任务需要的上下文 |
| 持续开发 | 变更、历史和验证结果跟着项目一起更新 |
| 准备交付 | 未安排、未验证或缺少依据的部分仍然可见 |

## 一个可复核的对比

同一任务、同一组事实的确定性基线（`llmClaim=false`）：

| 上下文方式 | 读取量 | 事实回忆 |
| --- | ---: | --- |
| **mdflow 任务切片** | **2,344 tokens** | **13 / 13 · 0 errors** |
| 只读完整 Markdown | 3,321 tokens | 13 / 13 · 0 errors |
| **差异** | **−29.4%** | — |

这是一组记录过的受控 fixture，用来展示“只读需要的内容”的方向，不是对所有模型、项目或网络环境的速度承诺。

## 给开发者

- **Local-first**：项目事实保存在自己的 `.mdflow` GraphStore，不依赖云端账户。
- **MCP 原生接入**：按任务读取、按小变更写入、写入后可回读并校验。
- **Markdown 仍然自由**：README、发布说明和长篇设计稿继续使用 Markdown；开发上下文由 mdflow 负责定位和同步。
- **开源可审查**：图谱快照、插件和桌面端代码都在本仓库中，方便二次开发。

### 本地运行

```bash
swift build --package-path apps/desktop
swift run --package-path apps/desktop mdflow-desktop

npm install
npm run mcp
```

打开一个包含 `.mdflow/project.json` 的项目目录即可开始。MCP 插件会把请求路由到当前项目，而不是另一个工作区。

## 当前演示项目

`27` 项工作 · `6` 条路径 · `26 / 27` 已验证。数字来自录屏中的真实项目状态，用于展示 mdflow 如何把“进行中、已完成、待验证”同时留在视图里。

### 媒体素材

- [功能演示 GIF](assets/mdflow-demo.gif)
- [高清原始录屏 MOV](assets/mdflow-demo.mov)

<div align="center"><sub>看全局 · 少读取 · 不漂移</sub></div>
