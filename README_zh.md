<div align="center">
  <img src="assets/logo.png" width="96" alt="ContextOS Logo" />
  <h1>ContextOS</h1>
  <p><strong>面向 AI 编码 Agent 的空间架构画布与上下文优化操作系统</strong></p>
  <p>
    AST 任务级精准切片（降低 99.4% Token）· 跨会话 Git 架构持久化 · 确定性测试门禁闭环
  </p>
  <p>
    <a href="README.md">English</a> ·
    <a href="https://github.com/yubinbin32-ops/ContextOS/releases/latest"><strong>下载 macOS 原生客户端</strong></a> ·
    <a href="#无头模式与跨平台-cli--windows--linux">无头模式 CLI / Windows</a> ·
    <a href="#实测基准数据-empirical-benchmarks">实测基准数据</a> ·
    <a href="https://glama.ai/mcp/servers/yubinbin32-ops/ContextOS">MCP 目录</a>
  </p>
  <p>
    <a href="https://github.com/yubinbin32-ops/ContextOS/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/yubinbin32-ops/ContextOS?style=flat-square&color=111111" /></a>
    <a href="https://github.com/yubinbin32-ops/ContextOS/actions/workflows/release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/yubinbin32-ops/ContextOS/release.yml?style=flat-square&label=build" /></a>
    <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/yubinbin32-ops/ContextOS?style=flat-square" /></a>
    <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js-22%2B-43853d?style=flat-square" />
    <img alt="MCP compatible" src="https://img.shields.io/badge/MCP-compatible-7c3aed?style=flat-square" />
    <img alt="Zero Runtime Deps" src="https://img.shields.io/badge/Runtime%20NPM%20Deps-0-brightgreen?style=flat-square" />
  </p>
</div>

<p align="center">
  <img src="assets/contextos-demo.gif" alt="ContextOS 空间画布演示：筛选架构块、追踪影响路径并查看验证凭据" width="100%" />
</p>

<p align="center"><sub>探索空间架构 → 追踪执行链路 → 向 Agent 传递符号级坐标 → 固化确定性验证凭据。</sub></p>

---

## 1. 摘要与问题建模 (Abstract & Problem Statement)

现代 AI 编码 Agent（如 Claude Code, Cursor, Windsurf, Codex, Devin）在扩展到中大型代码仓库时，普遍面临着一个根本性的结构性瓶颈：**上下文窗口饱和与架构熵增（Context Saturation & Architectural Entropy）**。

1. **扁平上下文的低效性（Flat Context Inefficiency）**：传统 Agent 为理解某一个具体方法，会无差别地读取数千行的完整源码文件。注意力预算的 85%–95% 被浪费在样板代码、冗长 imports 以及无关辅助函数上。
2. **跨会话架构失忆与拓扑漂移（Cross-Session Topological Drift）**：随着会话之间上下文窗口的刷新，Agent 会丢失系统的全局架构不变式（Invariants）。会话 A 做出的设计决策在会话 B 被推翻，引发循环修改与深层架构腐化。
3. **缺乏事实闭环的不可靠修改（Unverified Mutations）**：Agent 往往依赖概率性的自我评估输出“已完成”，缺乏系统性的凭据闭环，常常在无感知状态下破坏了系统集成契约。

**ContextOS** 通过构建双平面（Dual-Plane）系统从底层解决此问题：
- **空间画布平面（开发者操作台）**：基于 macOS SwiftUI 构建的原生工作空间，将软件系统映射为直观的架构块、有向依赖链以及验证门禁网络。
- **认知操作系统平面（Agent 交互总线）**：通过 Model Context Protocol (MCP) 向 Agent 精准投递 AST 符号门面（`path::symbol`）、强制执行任务级 Token 预算，并管理确定性的测试执行凭据账本。

---

## 2. 核心分发形式：macOS 原生空间工作空间

> **ContextOS 首要采用原生 macOS 桌面应用程序形式发布**，采用 SwiftUI 与 Metal 渲染，内置嵌入式 SQLite 高性能缓存，零外部运行时依赖。

<p align="center">
  <img src="assets/canvas-overview.png" alt="ContextOS 原生画布：展示架构模块、正交依赖路径、分层分组与检查器" width="100%" />
</p>

### 原生工作空间核心特性：
- **空间拓扑引擎**：紧凑的正交依赖布线算法，使包含 50+ 复杂模块的大型项目依然清晰可读、自由拖拽缩放。
- **虚实渐进物化状态机（Ghost-to-Solid Lifecycle）**：可在写代码前将功能构想建立为 *虚蓝图（Ghost Blueprint）*；随着源码落地，无缝锚定到真实 AST 符号，演化为 *实实体（Solid Anchor）*。
- **实时验证凭据账本**：在画布直观查看检查点状态（如 `13/13 100% 通过`），底层关联具体的自动化测试用例与编译器产物。
- **双向影响路径追踪**：双击任意模块或链路，一键高亮上游调用方、下游依赖方及潜在副作用范围。
- **内置协议注入器**：在图形界面一键为 Codex、Cursor、Windsurf 与 Claude Desktop 注册与热重载 MCP 插件。

<table>
  <tr>
    <td width="50%"><img src="assets/path-impact.png" alt="选中影响路径" /></td>
    <td width="50%"><img src="assets/checkpoint-detail.png" alt="检查点证据详情" /></td>
  </tr>
  <tr>
    <td align="center"><sub>在编写代码前先追踪上下游影响路径。</sub></td>
    <td align="center"><sub>查验每项完成状态背后的可重现测试凭据。</sub></td>
  </tr>
</table>

### 📥 下载原生客户端
从 GitHub Releases 直接下载独立免安装应用包：
- **[ContextOS for macOS (ContextOS-macos.zip)](https://github.com/yubinbin32-ops/ContextOS/releases/latest)**  
*(支持 macOS 14.0+，解压即可运行 `contextos.app`。纯净 ZIP 打包，完全规避 DMG 挂载易读写冲突与 Gatekeeper 转译问题)。*

---

## 3. 实测基准数据 (Empirical Benchmarks)

以下数据来源于真实复杂工程（**54 个架构 Block、8 条业务 Chain、80 条有向边 Link、19 个 Checkpoint 凭据**），由自动化压测套件（`npm run benchmark`）实测生成：

| 评测维度 | 传统基线（全量文件盲扫） | ContextOS（AST 任务切片） | 实测提升幅度 |
| :--- | :---: | :---: | :---: |
| **单任务上下文体积** | 689,403 字符 (~183,571 tokens) | 3,993 字符 (~1,125 tokens) | **Token 消耗降低 99.4%** |
| **4 模块跨层执行链** | 139,247 字符 (~34,812 tokens) | 2,056 字符 (~530 tokens) | **Token 消耗降低 98.5%** |
| **终端构建与诊断日志** | 16,083 字符 (~4,042 tokens) | 826 字符 (~211 tokens) | **日志体积压缩 94.8%** |
| **上下文检索时延** | 遍历全仓磁盘文件扫描 | 29.68 ms (P50) | **毫秒级极速响应** |
| **拓扑漂移与召回率** | 高概率发生幻觉与越界 | 100% 精准捕获目标模块 | **零拓扑架构漂移** |

本地复现基准测试命令：
```bash
npm run benchmark
```

---

## 4. 无头模式与跨平台 CLI (Windows / Linux)

对于无桌面环境的 CI/CD 流水线、远程服务器、Windows、Linux 或不需要图形界面的极客用户，ContextOS 提供基于 Node.js (≥22) 的无头命令行运行时：

```bash
# 1. 初始化并自动扫描已有工程拓扑
npx -y github:yubinbin32-ops/ContextOS init --scan

# 2. 检查工程架构健康度、同步状态与验证门禁
npx -y github:yubinbin32-ops/ContextOS status

# 3. 自动配置本地各大 IDE 的 MCP 插件集成
npx -y github:yubinbin32-ops/ContextOS setup
```

---

## 5. 架构原理与运行闭环

```mermaid
flowchart LR
  Human["开发者\n原生空间画布"] <--> Plaintext[".contextos/graph.json\nGit 追踪的真理源"]
  Plaintext <--> Engine["本地 SQLite 缓存\n上下文引擎"]
  Engine --> Slice["AST 任务切片\n(path::symbol 坐标)"]
  Slice --> Agent["AI 编码 Agent\n(通过 MCP)"]
  Agent --> Evidence["测试执行凭据"]
  Evidence --> Gate{"验证门禁"}
  Gate -->|通过| Plaintext
  Gate -->|失败| Alert["发出告警并触发重检"]
```

### 1. AST 符号定位坐标（`path::symbol`）
ContextOS 不向 LLM 输出整段整段的代码全文，而是输出高度凝练的坐标门面：文件相对路径、符号签名、推导行号范围及接口契约。宿主编辑器只需直接打开该目标方法。

### 2. Git 原生纯文本真理源（`graph.json`）
系统架构不保存在任何私有云端数据库，而是作为格式确定、键序稳定的纯文本 JSON（`.contextos/graph.json`）与业务源码一同纳入 Git 版本管理。`git checkout` 或 `git revert` 会协同重置代码与架构状态。本地 SQLite 仅作为内存映射级缓存，全周期零外部 npm 运行时依赖。

### 3. 凭据驱动的检查点与新鲜度门禁
模块完成状态绝不接受 AI 口头声明。所有完成状态均需通过 `run_command` 记录真实执行产物（如测试套件通过用例数、构建结果），并通过 `checkpoint_record` 固化。绑定的源码一旦变动，对应检查点即刻自动转入 `retest_required`。

### 4. 智能终端日志脱敏压缩
内置终端命令网关自动过滤 ANSI 控制字符与进度条，脱敏敏感凭据与本地路径，并将冗长无用的构建日志智能提炼为结构化诊断摘要（实测压缩率 94.8%）。

---

## 6. IDE 与 Agent 接入配置

ContextOS 通过标准 Stdio MCP 与主流 AI 编码环境无缝对接。

### Cursor, Windsurf, Claude Code 与 Codex 配置示例

在对应客户端的 MCP 配置文件（如 `~/.cursor/mcp.json` 或 `claude_desktop_config.json`）中添加：

```json
{
  "mcpServers": {
    "contextos": {
      "command": "npx",
      "args": ["-y", "github:yubinbin32-ops/ContextOS", "serve"]
    }
  }
}
```

或直接指向本地独立服务脚本：

```json
{
  "mcpServers": {
    "contextos": {
      "command": "node",
      "args": ["/绝对路径/contextos-mcp.mjs"],
      "env": {
        "CONTEXTOS_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

---

## 7. 本地构建与测试

本项目遵循严格的零外部 npm 运行时依赖设计：

```bash
# 克隆仓库
git clone https://github.com/yubinbin32-ops/ContextOS.git && cd ContextOS

# 安装构建依赖
npm ci

# 运行全套 55 项单元与集成测试
npm test

# 运行完整基准性能测试
npm run benchmark

# 编译打包单文件 MCP 服务
npm run plugin:build

# 校验 MCP 协议握手与工具集完整性
npm run plugin:verify

# 编译 macOS 原生桌面客户端
npm run desktop:build
```

---

## 8. 开源协议与项目状态

ContextOS 遵循 [MIT 开源协议](LICENSE)。欢迎提交 Issue、复现基准测试或发起 Pull Request。

© 2026 ContextOS Contributors.
