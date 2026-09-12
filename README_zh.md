<div align="center">
  <img src="assets/logo.png" width="76" alt="ContextOS" />
  <h1>项目会记住，每次对话都能从上次停下的地方继续。</h1>
  <p><strong>ContextOS 为 AI 编程项目保存架构、同步进度、压缩命令日志，并提供精确代码位置。</strong></p>
  <p><a href="https://github.com/yubinbin32-ops/ContextOS/releases/latest"><strong>下载 macOS App</strong></a> · <a href="#三分钟开始使用">三分钟开始使用</a> · <a href="README.md">English</a></p>
</div>

![ContextOS 架构与工作流](assets/contextos-demo.gif)

## 它解决什么问题？

AI 编程对话一开始没有项目记忆。换一个对话，AI 要重新读文件、重新理解架构、重新询问设计原因、重新猜测上次做到哪里；一次构建日志还会占掉大量上下文。项目越大，对话越像一套容易过期的第二份文档。

ContextOS 把项目的工作记忆保存在代码旁边。AI 只取得当前任务需要的部分；你则可以在 App 里查看同一份架构、进度、决策和文档。

## 它具体做了什么？

**保存架构。** Block 描述模块和职责，带类型的 Link 描述真实关系，Chain 描述一个可观察的功能路径。新对话可以先理解功能如何连接，再打开实现代码。

**同步进度。** Plan、PlanChange、ChainScope、源码绑定、Checkpoint 和任务交接都保存为结构化记录。AI 不需要扫描文件来猜哪些工作已经完成。

**压缩命令日志。** `run_command` 返回脱敏后的执行回执，保留错误和失败线索，隐藏例行编译输出，减少日志对上下文的占用。

**按 AST 定位代码。** SourceBinding 保存文件、符号、签名和动态行号。`chain_code_stream` 只返回功能链定位信息；需要实现时，`block_code_stream` 只返回单个 Block 的有界 AST 片段，不返回整个文件。

**统一知识入口。** 内部方案、审计和教材写入 OS Documents；`README.md` 和 `README_zh.md` 继续放在仓库原位置，并在 App 中以只读方式预览，图片和相对链接也能显示。

![功能链与精确代码定位](assets/path-impact.png)

![OS 文档和 README 的知识抽屉](assets/knowledge-reader.png)

安装完成后，你只需要正常描述工作，不需要每轮对话反复提到 ContextOS 或记工具名。插件会在后台读取和更新项目记忆。首次建图或查看进度时，说“整理项目架构”或“继续未完成的工作”就够了。

## 三分钟开始使用

### macOS App

1. [下载最新 App](https://github.com/yubinbin32-ops/ContextOS/releases/latest)，解压后打开 **ContextOS**。
2. 打开 **设置**，选择检测到的 AI 编辑器，点击 **安装 / 同步插件**。
3. 在 Codex 或你的编辑器中打开同一个项目，确认已安装 **ContextOS**，然后开始工作。

桌面版支持 macOS 14 及以上。MCP 运行时需要 Node.js 22 或以上。App 会自动写入编辑器配置，不需要手动编辑配置文件。

![一键同步编辑器和 MCP](assets/settings-sync.png)

### 其他操作系统

其他系统不需要 macOS App。请在你使用的 AI 编辑器中安装 ContextOS 插件 / MCP。仓库也提供无界面 CLI：

```bash
npx -y github:yubinbin32-ops/ContextOS init --scan
npx -y github:yubinbin32-ops/ContextOS setup
```

编辑器要求填写 MCP 服务时使用 `serve`。安装后可以用 `status` 和 `sync` 快速检查状态。

## 日常怎么使用？

1. 安装一次并打开项目。
2. 用普通语言描述功能、修复、审查或设计任务。
3. 让 AI 使用已有架构和进度完成工作。
4. 结束时，AI 会保存代码位置、命令回执、验证结果和下一步。

你随时可以问“项目现在做到哪了？”或“展示项目架构”。这只是查看信息，不是一套需要背诵的对话流程。

![项目地图和右侧详情抽屉](assets/readme-reader.png)

## 可复现 benchmark

下面的数据来自 2026 年 9 月 12 日对本仓库隔离副本的测量。单位是 JavaScript UTF-16 字符，不是模型 token，也不是会话压缩次数。

| 测量内容 | 结果 |
|---|---:|
| 完整图谱参考大小 | 835,443 字符 |
| 单次任务上下文预算 | 4,000 字符 |
| 上下文缩减 | **99.52%**（835,443 → 4,000） |
| 4 个完整源码文件 → Chain 定位流 | **99.07%**（223,360 → 2,071） |
| 固定模拟构建日志 | **91.78%**（10,071 → 828），错误和失败信息保留 |
| 查询样本 | 12 次本地调用 |
| 查询延迟 p50 / p95 | **724.01 ms / 841.22 ms** |

四个任务查询都在 4,000 字符预算内返回了预期 Block 和可见定位信息：

| 查询 | 预期 Block | 延迟（ms） | 缩减 |
|---|---|---:|---:|
| OpenCode 平台支持与 MCP 注入 | `in-app-plugin-install` | 841.22 · 728.69 · 724.01 | 99.52% |
| Git Discard 撤回与 SQLite 热重载 | `sqlite-graph-store` | 725.79 · 735.94 · 786.38 | 99.52% |
| CJK 分词与 BM25 字段加权检索 | `context-retrieval` | 753.19 · 719.37 · 720.33 | 99.52% |
| SourceBinding 路径与符号同步 | `live-binding-refresh` | 707.91 · 717.94 · 715.26 | 99.52% |

Chain 测量使用 `chain-context-os`，返回了 4 个已锚定定位：`ast-facade-engine/extractSymbols`、`progressive-materializer/addSourceRef`、`terminal-sanitizer/sanitizeTerminalOutput`、`desktop-context-console/chainCodeStreamSection`。完整原始数据见 [`docs/benchmarks/2026-09-12-v040.json`](docs/benchmarks/2026-09-12-v040.json)。

日常使用体感是上下文压缩频率大约减少 60%，这是个人体验，不是受控对照实验。benchmark 不包含 MCP 外壳、工具说明、skill、后续源码读取、推理、模型 token、成本或任务成功率；完整图谱和完整文件大小只是参考值。12 次调用混合了首次和热读取，延迟不能视为生产环境百分位。

修改服务或图谱后，可以重新测量：

```bash
npm run benchmark -- --output docs/benchmarks/2026-09-12-v040.json
```

## 开发者

```bash
git clone https://github.com/yubinbin32-ops/ContextOS.git
cd ContextOS
npm ci
npm test
npm run plugin:verify
npm run desktop:build       # macOS + Swift/Xcode
```

版本化的 `.contextos/graph.json` 是项目可移植的图谱投影。内部叙述文档属于 OS；benchmark JSON 和公开 README 保留在仓库中。

[参与贡献](CONTRIBUTING.md) · [安全政策](SECURITY.md) · [MIT License](LICENSE)
