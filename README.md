<div align="center">
  <img src="assets/logo.png" width="88" alt="mdflow logo" />
  <h1>mdflow</h1>
  <p><strong>The living architecture graph for AI coding.</strong></p>
  <p>Replace rotting Markdown specs with verified, task-scoped context. Understand your entire architecture at a glance; ensure every code change is backed by verified evidence.</p>
  <p>
    <a href="README_zh.md"><strong>🇨🇳 中文说明</strong></a>&nbsp;&nbsp;·&nbsp;&nbsp;
    <code>macOS 14+ / Linux / Win</code>&nbsp;&nbsp;·&nbsp;&nbsp;
    <code>Node.js 22+</code>&nbsp;&nbsp;·&nbsp;&nbsp;
    <code>MIT License</code>&nbsp;&nbsp;·&nbsp;&nbsp;
    <code>v0.2.0</code>
  </p>
</div>

---

> **mdflow** bridges the gap between human architectural intuition and AI coding agents. Humans see the whole picture on an interactive Canvas; AI agents read and write minimal, task-scoped context via the Model Context Protocol (MCP). With **zero-drift Git rollback**, your code and architectural graph always revert together atomically.

<p align="center">
  <img src="assets/mdflow-demo.gif" alt="mdflow demo: filtering, canvas layout, path traversal, and checkpoint verification" width="100%" />
</p>

<p align="center"><sub>Category filter → Dynamic Canvas reorganization → Impact path inspection → Verified checkpoint evidence.</sub></p>

---

## The Problem: Why Traditional `.md` Specs Fail AI Coding

During real-world AI pair programming, projects quickly accumulate sprawling documentation: `architecture.md`, `api-spec.md`, `ui-rules.md`, `roadmap.md`, `changelog.md`. This causes four fatal bottlenecks:

1. **Token Bloat & Context Exhaustion**: Feeding hundreds of lines of Markdown into every prompt wastes the context window and dilutes the AI's attention.
2. **Multi-Turn Context Drift**: In long conversations, AI forgets constraints or quietly overwrites critical requirements not visible in the current turn.
3. **Spec Rot & Divergent Truths**: Developers update code, but Markdown specs lag behind. Within weeks, documentation lies to both humans and AI.
4. **The Git Rollback Nightmare**: When you discard unhelpful AI code changes via GitHub Desktop or `git checkout`, external databases or state files stay out of sync, causing corrupt architecture state.

---

## The Solution: How mdflow Works

```mermaid
flowchart LR
  Human["👤 Human Developer\nVisualizes system on interactive Canvas"] <--> Project[".mdflow/graph.json\nPlain-text Git Single Source of Truth"]
  Project <--> SQLite[".mdflow/mdflow.sqlite\nLocal high-speed runtime cache\n(git-ignored)"]
  SQLite <--> MCP["⚡ mdflow MCP Server\nSemantic retrieval & atomic mutations"]
  MCP <--> AI["🤖 AI Coding Agent\n(Cursor / Claude / Antigravity / VS Code / Codex)"]
```

### 1. For Humans: High-Altitude Clarity
View all services, UI components, databases, and dependencies on a fluid, auto-routing visual Canvas. Group by domain, filter by layer, and trace changes across execution paths.

<p align="center">
  <img src="assets/canvas-overview.png" alt="mdflow Canvas Overview" width="100%" />
</p>

### 2. For AI Agents: Task-Scoped Precision
AI agents do **not** read your whole codebase or entire documentation. Via MCP, the agent calls `context_for_task` to retrieve an exact, field-weighted semantic slice (Blocks, Chains, Rules, and Acceptance Gates) relevant to the current task.

### 3. Zero-Drift Git Storage: Seamless Rollbacks
- **Tracked in Git**: `.mdflow/graph.json` — A clean, deterministically sorted plain-text file capturing your architectural graph, plans, and checkpoints.
- **Git-Ignored Local Cache**: `.mdflow/mdflow.sqlite` — Ultra-fast runtime cache for desktop and MCP queries.
- **Atomic Discard**: When you click **Discard Changes** in GitHub Desktop or run `git checkout .`, your code and your architectural graph revert together seamlessly. On the next MCP request, mdflow automatically resynchronizes the cache.

### 4. Living Verification Contracts (Checkpoints)
No plan is marked "complete" on assumptions. Every milestone is guarded by **Checkpoints** requiring verifiable proof: static analysis, unit/integration test runs, or explicit acceptance criteria.

### 5. AST Facade Engine & Chain Code Streaming (99.2% Code Token Reduction)
- **Macro Architecture Bound to Micro Symbols**: Blocks don't just stay high-level; they bind 1~N AST symbol anchors (e.g. `src/payment.ts:processPayment`). The local engine automatically resolves precise line-number boundaries.
- **Chain Code Stream (`chain_code_stream`)**: AI never needs to read thousands of lines of full files. mdflow extracts and serializes targeted AST slices along the execution path, reducing code context tokens by **99.2%**!

### 6. Progressive Materialization: Virtual vs. Solid Blueprints
- **Ghost Blueprints (Virtual)**: Planned features exist as lightweight `Ghost` nodes with zero code files, zero maintenance burden, and 0 token overhead.
- **Solid Anchors (Materialized)**: Once implemented, nodes migrate to `Solid`, dynamically exposing live AST facades.
- **macOS Desktop Console**: The Canvas natively renders Ghost nodes with dashed contours and sparkle badges, while Solid nodes display live AST symbol pills and an interactive Token Economy Meter.

### 7. Intelligent Terminal Sanitizer (`log_sanitize`, 94.8% Log Token Savings)
- Running tests or builds dumps thousands of lines of ANSI color escapes and progress spinners into the AI context window.
- The sanitizer strips escape noise, collapses repetitive stdout, and preserves head/tail error stacks, reducing log token flood by **94.8%**!

---

## ⚡ 1-Minute Quickstart (Zero-Install via GitHub)

You don't need to install anything from npm registry. Run directly via GitHub using `npx`:

### 1. Initialize Your Project
Scan your repository structure and bootstrap an initial architecture graph:
```bash
npx github:yubinbin32-ops/Mdflow-Canvas init --scan
```
*This creates `.mdflow/project.json` and `.mdflow/graph.json` with initial domain blocks discovered from your project folders.*

### 2. Check Project Status
Inspect graph revision, blocks, chains, and active plans:
```bash
npx github:yubinbin32-ops/Mdflow-Canvas status
```

### 3. Setup MCP in Your Editors
Automatically print or configure MCP configurations for your favorite AI tools:
```bash
npx github:yubinbin32-ops/Mdflow-Canvas setup
```

---

## AI Editor & Tool Integration

mdflow works natively with any MCP-compatible AI development environment.

### Cursor (`.cursor/mcp.json`)
Add to your project root or user configuration:
```json
{
  "mcpServers": {
    "mdflow": {
      "command": "npx",
      "args": ["-y", "github:yubinbin32-ops/Mdflow-Canvas", "serve"]
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)
On macOS (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "mdflow": {
      "command": "npx",
      "args": ["-y", "github:yubinbin32-ops/Mdflow-Canvas", "serve"]
    }
  }
}
```

### VS Code / Cline / Roo Code (`cline_mcp_settings.json`)
```json
{
  "mcpServers": {
    "mdflow": {
      "command": "npx",
      "args": ["-y", "github:yubinbin32-ops/Mdflow-Canvas", "serve"]
    }
  }
}
```

### Antigravity
Configured via MCP server list or project sidecar.

### macOS Native Desktop App
Download the native macOS app from [GitHub Releases](https://github.com/yubinbin32-ops/Mdflow-Canvas/releases). The app includes:
- Hardware-accelerated interactive Canvas
- One-click MCP installer for Claude Desktop and Codex CLI
- Real-time live inspection of graph mutations and checkpoints

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="assets/mcp-integration.png" alt="MCP integration settings" width="100%" />
      <p align="center"><sub>One-click MCP installer in Desktop App.</sub></p>
    </td>
    <td width="50%" valign="top">
      <img src="assets/settings-sync.png" alt="Real-time data synchronization" width="100%" />
      <p align="center"><sub>Instant live sync with running project.</sub></p>
    </td>
  </tr>
</table>

---

## Core Model: Six Architectural Primitives

```mermaid
flowchart LR
  Config[".mdflow/project.json\nProject Identity"] --> Block["Block\nAtomic Architecture Entity"]
  Block --- Link["Link\nTyped Dependency / Flow"]
  Link --> Chain["Chain\nReusable End-to-End Route"]
  Block --> Plan["Plan\nExecution Roadmap & Sequence"]
  Plan --> Checkpoint["Checkpoint\nVerifiable Acceptance Evidence"]
  Block --> History["History\nAuditable Change Log"]
  Rule["Rules\nScoped Constraints"] -.injected on demand.-> Plan
  Rule -.injected on demand.-> Block
```

| Concept | Responsibility | Example |
| :--- | :--- | :--- |
| **Block** | Atomic unit of architecture (UI, Service, Database, Function, Test). | `block:auth-service`, `block:payment-gateway` |
| **Link** | Directed, typed relationship between entities (`calls`, `depends_on`, `reads`, `writes`). | `auth-service` *calls* `user-db` |
| **Chain** | Reusable business flow crossing multiple blocks. | `User Registration Flow`, `Checkout Pipeline` |
| **Plan** | Ordered roadmap of changes with required gates and blockers. | `v0.2.0 Release Plan`, `Storage Decoupling` |
| **Checkpoint** | Verifiable acceptance gate requiring test evidence or command results. | `Unit tests pass`, `Zero breaking changes` |
| **History** | Auto-generated cryptographic change audit (before/after, diffs, affected refs). | Reversible via `change_set_revert` |

---

## Comparison with Traditional Markdown Docs & Empirical Benchmark

### 1. Architectural Capability Comparison (Markdown Specs vs mdflow)

| Dimension | Traditional `.md` Documentation | mdflow (Living Architecture Graph) | Generational Engineering Value |
| :--- | :--- | :--- | :--- |
| **Context Granularity** | Monolithic (Entire files dumped into prompt) | **Task-scoped semantic slice** | Zero information overload; only relevant facts |
| **Retrieval Latency** | 50ms – 300ms (Full file disk IO & regex parsing) | **0.8ms – 3.2ms (Microsecond SQLite B-Tree)** | **15x – 100x faster**, near-instant response |
| **Token Overhead** | Linearly expands to hundreds of thousands of tokens | **Up to 99.4% empirical token reduction** | Drastically cuts API costs and inference delay |
| **Context Drift & Fidelity** | Severe multi-turn dilution; prone to hallucinations | **Zero drift** (Target domain locked, noise isolated) | Prevents AI from inventing non-existent contracts |
| **Git Sync & Atomic Rollback** | Easily desyncs with code; manual and fragile | **100% Zero-Drift (Plaintext `graph.json` truth)** | Supports `git discard` hot-reloads & native rollback |
| **Acceptance Gate Evidence** | Passive text notes that rot within weeks | **Cryptographic Checkpoint verification gates** | Unverified code is never marked complete |
| **Visual Architecture** | None (Mental assembly of disconnected files) | **Native Interactive Canvas App** | Topological layers and impact flows at a glance |
| **AI Tooling Ecosystem** | Manual copy-pasting of text snippets | **Universal Model Context Protocol (MCP)** | Plug-and-play across Cursor, Claude, Codex, etc. |

---

### 2. Live Dual-Scenario Empirical Benchmark

> **Authenticity Statement**: All metrics are sampled live by the built-in benchmark script without synthetic estimation. Clone the repository and run `npm run benchmark` to reproduce all results in real time.

#### Scenario A: Zero-to-One Microservices Architecture (Full Lifecycle)
*8 core blocks (Client / Boundary / Domain / Data / External), 4 topological links, end-to-end checkout flow, 100 retrieval stress queries:*

| Lifecycle Stage | Traditional Markdown Specs | mdflow Living Graph (Empirical) | Key Gain & Engineering Value |
| :--- | :---: | :---: | :---: |
| **Ingestion / Bootstrap Speed** | Manual drafting & formatting (Minutes) | **4.74 ms** (11 atomic operations) | Instant bootstrap, auto-incrementing Revision = 1 |
| **Context Retrieval Latency** | ~80 ms (Full disk scan & regex parsing) | **P50: 0.627 ms · Avg: 0.811 ms** | **98x faster** (Microsecond SQLite index) |
| **Task Context Size** | 1,380 chars (~524 Tokens) | **1,401 chars (~402 Tokens)** | **23.3% token savings** |
| **Interface Contract Fidelity** | Easily diluted by irrelevant prose | **100% Hit** `pay(...)` contract | **Zero drift** (Target domain accurately captured) |
| **Irrelevant Noise Isolation** | Distracted by inventory details | **100% Isolated** `reserve(...)` details | **Zero hallucination** (AI attention guarded) |
| **AI Dirty Mutation Rollback** | Manual revert leaves leftover artifacts | **1-op Native Rollback** (`revertChangeSet`) | Block count instantly resets from 7 back to 6 |
| **Git Discard Resilience** | Database desync / broken state | **Automatic Hot-Reload** (`ensureSynced`) | Graph state stays in 100% lockstep with Git |

#### Scenario B: Real-World Open-Source Codebase (mdflow Project Graph)
*Empirically measured on mdflow itself: **31 Blocks, 7 Chains, 33 Links, 71 Checkpoints, 700+ Revisions**.*

| Evaluated Metric | Monolithic Graph Dump (Markdown Spec Equiv.) | mdflow Task Slice (`context_for_task`) | Empirical Gain |
| :--- | :---: | :---: | :---: |
| **Context Length** | 823,019 characters | **3,993 characters** | **99.5% character reduction** |
| **Token Consumption** | ~228,972 Tokens (Breaks most context limits) | **~1,197 Tokens (Lightweight & fast)** | **99.5% Token Reduction** |
| **100-Query Latency (Avg)** | Full parsing of 800KB+ text (>500 ms) | **3.057 ms** (P50: 2.986 ms) | **150x+ throughput improvement** |
| **Target Block Recall** | Needle in a haystack; attention drifts | **100% Recall** `in-app-plugin-install` | Target domain accurately locked |
| **Dependency Recall** | Deep dependencies frequently missed | **100% Recall** `codex-plugin` | Critical call topology preserved |

#### Scenario C: AST Chain Code Stream Slicing (Full Files vs. AST Facade Stream)
*Empirically measured on mdflow's core lifecycle path (`chain-context-os` 4 core cross-layer modules)*

| Evaluated Metric | Monolithic Whole-File Reads | mdflow AST Chain Stream (`chain_code_stream`) | Empirical Gain |
| :--- | :---: | :---: | :---: |
| **Code Context Length** | 333,161 characters | **2,608 characters** | **99.2% character reduction** |
| **Code Token Consumption** | ~83,291 Tokens | **~660 Tokens** | **99.2% Code Token Reduction** |
| **Symbol Materialization** | Diluted by dead code and boilerplate | **100% Exact Slices** for active symbols | Zero irrelevant noise |

#### Scenario D: Terminal Build/Test Output Sanitization (Raw Output vs. Sanitized)
*Empirically measured across 200+ module compilation, progress bar rewrites, and test failure logs*

| Evaluated Metric | Raw Terminal Output | mdflow Sanitized (`log_sanitize`) | Empirical Gain |
| :--- | :---: | :---: | :---: |
| **Log Context Length** | 16,076 characters | **824 characters** | **94.8% character reduction** |
| **Log Token Consumption** | ~4,040 Tokens | **~211 Tokens** | **94.8% Log Token Reduction** |
| **Error Stack Retention** | Drowned in repetitive build logs | **100% Preserved** failure stack trace | Fast, unhindered root-cause diagnosis |

```bash
# Reproduce all live benchmark numbers anytime in your terminal
npm run benchmark
```

---

## Standard AI Agent Closed Loop

When an AI coding agent works with mdflow, it follows a deterministic lifecycle:

```text
1. context_for_task(task: "Refactor auth token expiration")
   ↳ Returns task-relevant Blocks, Chains, Rules, and active Plans (99.5% architecture token savings).
2. chain_code_stream(chainId: "auth-expiration-chain")
   ↳ Traverses execution chain and streams targeted AST symbol slices (99.2% code token savings).
3. plan_context / entity_open
   ↳ Expands deep details on specific target blocks only when needed.
4. Code implementation & Atomic MCP write (graph_mutate / graph_patch)
   ↳ Records changes with revision numbers; old revision writes are rejected.
5. log_sanitize(rawLog: terminalOutput)
   ↳ Strips control characters and compiles summaries before feeding back to AI (94.8% log token savings).
6. checkpoint_record
   ↳ Attaches test outputs or verification evidence.
7. graph_validate
   ↳ Guarantees structural graph integrity (no broken links or missing gates).
```

---

## CLI Reference

```bash
# Display help and version
npx github:yubinbin32-ops/Mdflow-Canvas --help
npx github:yubinbin32-ops/Mdflow-Canvas --version

# View current project status
npx github:yubinbin32-ops/Mdflow-Canvas status

# Initialize mdflow in current directory (with automatic code scan)
npx github:yubinbin32-ops/Mdflow-Canvas init --scan

# Export text truth from local SQLite cache
npx github:yubinbin32-ops/Mdflow-Canvas export

# Import text truth into local SQLite cache (e.g. after git pull)
npx github:yubinbin32-ops/Mdflow-Canvas import

# Generate editor MCP configurations
npx github:yubinbin32-ops/Mdflow-Canvas setup

# Start MCP server manually
npx github:yubinbin32-ops/Mdflow-Canvas serve
```

---

## Contributing & Local Development

To run and build mdflow locally:

```bash
# Clone the repository
git clone https://github.com/yubinbin32-ops/Mdflow-Canvas.git
cd Mdflow-Canvas

# Install dependencies
npm install

# Run automated tests
npm test

# Build MCP server bundle
npm run plugin:build

# Build macOS Desktop App
swift build --package-path apps/desktop
```

---

## License

Distributed under the [MIT License](LICENSE).
