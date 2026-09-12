<div align="center">
  <img src="assets/logo.png" width="76" alt="ContextOS" />
  <h1>Start every conversation with project memory.</h1>
  <p><strong>ContextOS · Architecture, source locators, decisions, and progress in one workspace</strong></p>
  <p>Understand the feature map. Open the code you need. Keep project knowledge across conversations.</p>
  <p><a href="https://github.com/yubinbin32-ops/ContextOS/releases/latest"><strong>Download macOS App</strong></a> · <a href="#get-started">Get started</a> · <a href="#copy-a-prompt">Copy a prompt</a> · <a href="#measurements">Measurements</a> · <a href="README_zh.md">中文教程</a></p>
</div>

![ContextOS architecture and verification walkthrough](assets/contextos-demo.gif)

| When you need to… | ContextOS helps you… |
| :--- | :--- |
| Start a fresh conversation | Retrieve relevant architecture, rules, decisions, and progress |
| Find a method | Use file + symbol locators, then read the implementation you need |
| Run a noisy build | Receive redacted, compressed output through `run_command` |
| Keep project knowledge current | Store development knowledge in the OS |
| Check whether work is finished | Review checkpoints and source freshness |

> **0.4.0:** a knowledge reader, OS Markdown documents, a persistent source index and verified task completion. The App periodically checks source changes while the project is open. Agents declare feature intent; reconciliation checks bindings, feature membership and evidence before delivery.

## Get started

**Download → Settings → Install/sync → Confirm in Codex → Start a new conversation.**

1. Download **ContextOS-macos.zip** from [Releases](https://github.com/yubinbin32-ops/ContextOS/releases/latest), unzip it, and move **ContextOS.app** into Applications. Requires macOS 14+, Codex, and Node.js 22+ with built-in SQLite available. The current release workflow uses ad-hoc signing; Control-click → Open if macOS blocks the first launch.
2. Open the **gear / Settings** in ContextOS. Find **Codex** under **AI EDITOR MCP BRIDGES**. Use that row’s install/sync action: the current source UI labels first-time setup **Sync**, with **Re-sync**, **Update**, or **Reinstall** for existing configurations.
3. Open Codex **Plugins**, find **ContextOS** in the installed list (the local source may appear under Personal), and start a **new conversation**. Installed skills become available in new sessions; see the [official plugin guide](https://learn.chatgpt.com/docs/plugins).
4. Open the **same repository directory** in Codex and ContextOS. Use your code repository, not the application installation directory.
5. Send the first prompt below. Success means an actual ContextOS tool call returns the correct project. An empty graph is a starting point, not proof of complete architecture coverage.

```text
Use ContextOS for this project. Check that its tools and skill are available.
Call context_for_task with this repository’s absolute path; register it first if needed.
Show the project name, relevant features, current progress, and synchronization issues.
Use source locators before opening implementation files.
```

If the App says Connected but the complete plugin is absent in Codex, installation may have fallen back to MCP configuration only. Reinstall from Settings, restart Codex, and verify a real tool call in a new conversation.

## Read project knowledge in the App

Expand **Knowledge** in the sidebar and select a README or OS Document to read it in the **right inspector**. The architecture canvas stays visible. README stays at its original path and is read-only in the App. Internal audits, designs and guides live in OS Documents, with chapters, images, tables and links back to architecture entities.

![ContextOS knowledge reader](assets/knowledge-reader.png)

![Read-only README and installation guide](assets/readme-reader.png)

```text
Write this proposal as a ContextOS Document, not a new docs/*.md file.
Keep the full explanation, images and acceptance criteria. Relate it to the
relevant Blocks, Chains and Decisions. Store the concise choice as a Decision.
Return the App document link; use chapter updates for future revisions.
```

This repository’s [sync audit](contextos://knowledge?document=sync-redesign), [reader design](contextos://knowledge?document=knowledge-reader-design) and [measurement methodology](contextos://knowledge?document=benchmark-methodology) are stored in the OS. Open this repository in ContextOS before following those links. Raw benchmark JSON remains versioned in Git.

![Feature chain and module relationships](assets/path-impact.png)

Follow a feature Chain to the modules and code locators involved.

![Checkpoint evidence](assets/checkpoint-detail.png)

Checkpoints connect delivery to verification evidence. These two screenshots illustrate existing features; current styling may differ.

## Copy a prompt

<details open>
<summary><strong>Bring an existing project into the OS</strong></summary>

```text
Use ContextOS to map this project. During this initial migration, inspect existing
README, architecture notes, rules, and code entry points as needed. Create Blocks
for modules, Chains for actual feature flows, and file + symbol source bindings.
Store scoped rules, Decisions, and unfinished Plans. Separate facts from assumptions.
After migration, maintain development knowledge in the OS instead of new architecture,
TODO, or decision-log Markdown files. Keep public onboarding and license documents.
Show the migration mapping before deleting any old documents.
```

</details>

<details>
<summary><strong>Build a feature</strong></summary>

```text
Implement [feature]. Retrieve ContextOS context and applicable rules first.
Record design decisions and planned Blocks before implementation; draft the feature Chain.
Open code using locators, verify through run_command, synchronize bindings, and record
real checkpoint evidence. Use task_begin to declare scope, task_reconcile after edits, and task_finish to complete verified Blocks and the feature
Chain, update progress, and validate the graph before reporting completion.
```

</details>

<details>
<summary><strong>Fix a bug</strong></summary>

```text
[Describe actual behavior, expected behavior, and reproduction steps.]
Locate the relevant Chain and Blocks in ContextOS, expand required rules and decisions,
then inspect the indicated methods. Use run_command for tests and concise logs.
Synchronize source bindings and record verification afterward; leave uncertain work unverified.
```

</details>

<details>
<summary><strong>Record a rule or decision</strong></summary>

```text
Record [project rule] as a scoped ContextOS constraint, not a new Markdown file.
Record [choice, rationale, rejected alternatives] as a Decision with the relevant scope,
so the next conversation can retrieve it when needed.
```

</details>

<details>
<summary><strong>Close work and resume in a new conversation</strong></summary>

```text
Close this task in ContextOS: reconcile source bindings, verify implemented Blocks,
record evidence, check the feature Chain, and update progress and next steps.
Run graph_validate and report unresolved issues. Independent Blocks may remain standalone.
```

In the next conversation:

```text
Resume this project from ContextOS. My task is [task]. Retrieve relevant features,
mandatory rules, recent decisions, and unfinished work, then continue.
Expand referenced details if the context is truncated instead of rereading the entire repository.
```

</details>

## What belongs in the OS?

| Knowledge | OS entity |
| :--- | :--- |
| Module responsibilities and contracts | Block |
| Feature flows and relationships | Chain + Link |
| Implementation locations | SourceBinding |
| Project conventions | Scoped rule |
| Design rationale | Decision |
| Work scope, progress, handoff | Plan + Timeline |
| Verification evidence | Checkpoint |
| Internal audits, designs and guides | Document |
| Resumable task and verified completion | TaskSession |

Ghost means planned architecture. An implementation exists when its source is bound; delivery requires appropriate verification. A file’s existence alone does not prove completion. Standalone modules do not need artificial Chains.

ContextOS aims to replace **development knowledge documents**. Public tutorials remain useful. Code remains the authority for behavior; locators reduce unnecessary reads rather than eliminating implementation inspection.

## Measurements

Measured 2026-09-12 on an isolated snapshot of this repository: Apple M1, Node v22.22.1, 59 Blocks / 10 Chains / 85 Links. [Raw JSON and input hashes](docs/benchmarks/2026-09-12-v040.json) · [Methodology](contextos://knowledge?document=benchmark-methodology).

| Metric | Observed result | Boundary |
| :--- | :--- | :--- |
| Chain locator size | 211,851 → 2,059 characters; **99.02% smaller** | Compared with the four actual bound files; later source reads excluded |
| Synthetic log size | 10,071 → 828 characters; **91.78% smaller** | Deterministic fixture, not a real build; key error retained |
| Task response | 4,000 characters | 4,000-character budget; all four queries truncated |
| Expected target visible in response | **4/4 queries** | Diagnostic cases, not general retrieval accuracy |
| Local retrieval latency | P50 **394.15 ms**, P95 **465.35 ms** | 12 service calls; not a production performance guarantee |

The same four queries returned 1/4 expected refs in the [earlier snapshot](docs/benchmarks/2026-09-12.json). This run includes both ranking changes and corrected architecture descriptions, so it is not an algorithm-only controlled comparison. All four summaries still truncate at 4,000 characters and require focused expansion.

**Author’s personal impression: roughly 60% fewer session compactions during use. This is subjective experience, not a counted comparison, benchmark or guarantee.** Response characters, model tokens, and session compaction events are different measurements. We do not claim zero drift, perfect recall, or 99% task-level token savings from these numbers.

## Troubleshooting

| Symptom | Next action |
| :--- | :--- |
| Tools unavailable | Check the installed plugin, start a new conversation, then re-sync/restart if needed |
| Node or SQLite missing | Install a compatible Node.js 22+ runtime and make `node` discoverable by the client |
| Wrong project returned | Pass the current repository/worktree’s absolute path explicitly |
| Stale plugin warning | Update/re-sync in Settings, restart Codex, verify the running build |
| Implemented code still a Ghost | Check symbol bindings and verification, then seal the Block |
| Blocks without a feature Chain | Explicitly reconcile the feature’s entry point, steps, and outcome |
| Truncated context or rules listed only by title | Expand relevant references before implementation; increase budget if necessary |
| Checkpoint requires retesting | Rerun affected verification and record fresh evidence |

## Development and headless use

```bash
git clone https://github.com/yubinbin32-ops/ContextOS.git
cd ContextOS
npm ci
npm test
npm run benchmark -- --output /tmp/contextos-benchmark.json
npm run plugin:verify
npm run desktop:build
```

Desktop builds require macOS and Swift/Xcode tools. For headless use, run these in your repository with Node.js 22+. Initial scanning seeds a map; review its feature semantics.

```bash
npx -y github:yubinbin32-ops/ContextOS init --scan
npx -y github:yubinbin32-ops/ContextOS status
npx -y github:yubinbin32-ops/ContextOS serve
```

Architecture intent lives in `.contextos/graph.json`; SQLite supports local queries and runtime evidence. Commit the graph with related source changes, then recheck bindings and evidence after a Git restore. Keep project rules and decisions canonical in the OS.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT License](LICENSE)
