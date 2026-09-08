# mdflow 发布包

这份文件把 mdflow 的公开分发拆成三个漏斗：先让高意向用户找到可安装入口，再让搜索引擎长期收录，最后用少量有技术含量的社区发布换取首批反馈。

## 一句话定位

> mdflow is a context operating system for AI coding agents: map the architecture, stream only the code a task needs, and apply verified changes with automatic rollback.

中文：mdflow 是面向 AI 编码 Agent 的 Context 操作系统：把架构变成可查询的图谱，只提供当前任务需要的代码，并在验证边界内修改、失败自动回滚。

## 当前入口

| 入口 | 作用 | 状态 | 链接 |
| --- | --- | --- | --- |
| GitHub 仓库 | 源码、Issue、Star、Fork | 已上线 | https://github.com/yubinbin32-ops/Mdflow-Canvas |
| GitHub Release | macOS 下载与 MCP bundle | v0.3.1 已上线 | https://github.com/yubinbin32-ops/Mdflow-Canvas/releases/tag/v0.3.1 |
| 官网 | 搜索落地页与快速开始 | 已上线 | https://dashend.cn |
| Glama | MCP 目录搜索与安装入口 | 已收录，资料待完善 | https://glama.ai/mcp/servers/yubinbin32-ops/Mdflow-Canvas |
| TensorBlock | Awesome MCP Servers 社区目录 | PR #2243 草稿，等待审核 | https://github.com/TensorBlock/awesome-mcp-servers/pull/2243 |
| 官方 MCP Registry | MCP 客户端和下游目录的规范元数据 | 工作流已验证，待 GHCR 包设为 Public 后重跑 | https://registry.modelcontextprotocol.io/ |

## 渠道优先级

### 第一层：高意向分发

1. **官方 MCP Registry**：发布 `server.json` 和 GHCR 镜像，让下游客户端与目录可以按规范发现 mdflow。仓库已经包含 `Dockerfile`、OCI ownership label 和 `.github/workflows/mcp-registry.yml`。
2. **Glama**：完成名称、描述、Code Analysis 分类和 Dockerfile 构建；Build 成功后，用户才能从目录直接理解安装方式。
3. **TensorBlock / Awesome MCP Servers**：维护 PR #2243，补充真实安装命令、截图和版本链接，等维护者合并。
4. **mcp.so、MCP.Directory、LobeHub MCP、Cursor Directory**：按各站表单逐个提交，统一使用下面的短描述。不要一天内复制粘贴到所有站点。
5. **Smithery**：mdflow 当前是本地 stdio 服务，先确认其 manifest/托管要求；只有能保留本地项目目录语义时再提交。

### 第二层：可持续搜索

- GitHub 仓库保持英文首屏、中文入口、`mcp` / `ai-coding` / `context-engineering` 等主题和 Social Preview。
- 官网保留可抓取的文字内容、OG 图片、canonical、sitemap 和 JSON-LD；后续增加三个独立落地页：`/quickstart`、`/mcp`、`/benchmark`。
- 每次 release 同时更新一篇可搜索的变更说明，标题使用问题词：`How to stop coding agents from scanning the whole repository`。
- 用 GitHub Discussions 收集真实案例；每个案例只回答一个具体问题，并链接回 README 的可复现命令。

### 第三层：技术社区扩散

| 渠道 | 适合内容 | 目标 |
| --- | --- | --- |
| Hacker News / Show HN | 英文技术原理、benchmark、可运行命令 | 一次高峰流量和高质量反馈 |
| Reddit（r/MCP、r/ClaudeAI、r/Cursor、r/LocalLLaMA、r/opensource） | 一个真实痛点 + GIF + 安装命令 | 找到早期使用者 |
| V2EX、掘金、知乎 | 中文架构文章和实测过程 | 长尾搜索与中文开发者反馈 |
| Dev.to / Hashnode | 英文教程、MCP 配置、AST mutation 案例 | 长尾 SEO 与外链 |
| Product Hunt、Indie Hackers、DevHunt | 产品故事和下载入口 | 发布日额外曝光 |

社区发帖要按受众重写标题和开头；同一段文案只发一次，后续用评论回答问题，不刷屏。

## 目录短描述

```text
mdflow is a local-first Context OS for AI coding agents. It keeps a Git-tracked architecture graph, returns task-scoped AST code streams, applies symbol-level mutations behind a verification boundary, and rolls back failed changes automatically. Works with stdio MCP clients on Node.js 22+; macOS users also get a native Canvas.
```

## Hacker News / Show HN 文案

标题：

```text
Show HN: mdflow – a Context OS that gives coding agents a task-scoped code stream
```

正文：

```text
Coding agents repeatedly scan the same repository, read whole files to understand one function, and lose architectural decisions between sessions.

I built mdflow to keep a Git-tracked architecture graph beside the source. An agent can call context_for_task for a narrow project slice, chain_code_stream for AST symbols across an execution path, and block_code_mutate for an atomic change that runs verification and rolls back on failure.

The included benchmark on mdflow itself reduces one task context from 112,738 to 1,197 estimated tokens and a four-module code chain from 84,227 to 654. The script is in the repository so the numbers can be reproduced.

Try it without a global install:
npx -y github:yubinbin32-ops/Mdflow-Canvas init --scan

GitHub: https://github.com/yubinbin32-ops/Mdflow-Canvas
Docs and screenshots: https://dashend.cn

I am looking for repositories where the graph model or rollback boundary is useful, and for cases where the context slice is too narrow or too broad.
```

## 中文技术社区文案

标题：

```text
AI Agent 总扫全仓库？我做了一个能查询、验证、回滚的项目 Context OS
```

正文：

```text
现在的编码 Agent 经常为了改一个函数反复读取整个仓库：上下文窗口被扫描噪声占满，架构决策也会在新会话里丢失。

mdflow 把架构图谱和源码放在同一个 Git 项目里：
- context_for_task：按任务返回最小项目切片
- chain_code_stream：沿执行链提取跨文件 AST 符号
- block_code_mutate：只改绑定的符号，验证失败自动回滚
- Checkpoint：把测试结果和交付状态写回项目事实

在 mdflow 自身的可复现实测里，单任务上下文从 112,738 降到 1,197 tokens，四模块代码链从 84,227 降到 654 tokens。

Node.js 22+ 直接试用：
npx -y github:yubinbin32-ops/Mdflow-Canvas init --scan

项目：https://github.com/yubinbin32-ops/Mdflow-Canvas
官网：https://dashend.cn

欢迎用真实仓库跑一下，尤其想听到上下文切片过窄、架构图难维护或回滚边界不符合预期的案例。
```

## 30 天节奏

| 时间 | 动作 | 可量化信号 |
| --- | --- | --- |
| 第 0 天 | 发布 v0.3.1、GHCR 镜像和官方 MCP Registry 元数据 | Registry 可搜索，镜像可拉取 |
| 第 1 天 | Show HN；回复每个技术问题 | HN 访问、GitHub unique visitors |
| 第 3 天 | 在 1 个英文社区和 1 个中文社区发不同版本 | 试用 Issue、Discussion |
| 第 7 天 | 发布 benchmark/case study，附完整复现命令 | 搜索访问、外部引用 |
| 第 14 天 | 更新 Glama、目录条目和截图 | 目录使用数、安装点击 |
| 第 21 天 | 发布一个小而真实的用户案例或失败复盘 | 新贡献者、复现 PR |
| 第 30 天 | 汇总指标，决定继续 SEO 还是做第二次发布 | 下载、激活、留存 |

## 每周记录的指标

- GitHub：unique visitors、clones、release downloads、Star、Fork、Issue/Discussion 新增。
- Glama：uses、profile views、tool calls、安装失败原因。
- 官网：Search Console impressions、organic clicks、外部 referral、快速开始点击。
- Registry/镜像：查询结果、镜像拉取量、版本分布。
- 用户质量：第一次成功 `init --scan` 的仓库数量、复现 benchmark 的用户数量、首次贡献时间。

## 发布前检查

- [ ] `npm test`、`npm run benchmark`、`npm run plugin:build`、`npm run desktop:build` 通过。
- [ ] `server.json` 的版本、GHCR tag、OCI ownership label 一致。
- [ ] GHCR 包设为 Public 后重跑 v0.3.1 的 MCP Registry workflow。
- [ ] Glama profile 使用 `mdflow — Context OS for AI Coding` 和 Code Analysis 分类。
- [ ] TensorBlock PR #2243 没有过期链接或未解释的安装路径。
- [ ] 每个社区链接使用独立 UTM 参数，方便判断真实来源。
