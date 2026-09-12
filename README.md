<div align="center">
  <img src="assets/logo.png" width="76" alt="ContextOS" />
  <h1>A new conversation. The same project memory.</h1>
  <p><strong>Keep architecture, decisions, and progress with your project. Save the context window for the work ahead.</strong></p>
  <p><a href="https://github.com/yubinbin32-ops/ContextOS/releases/latest"><strong>Download macOS App</strong></a> · <a href="#get-started">Get started</a> · <a href="#what-to-say-to-your-ai">Conversation examples</a> · <a href="README_zh.md">中文</a></p>
</div>

![ContextOS architecture and feature walkthrough](assets/contextos-demo.gif)

## Why ContextOS?

As an AI-assisted project grows, so does the conversation.

Start a new chat, and the AI reads files and documents to understand the project again. You repeat the architecture, explain earlier decisions, and reconstruct unfinished work. Long build logs consume context, while plans and notes scattered across Markdown files gradually fall behind the code.

**ContextOS gives your project a memory that lives beyond a conversation.** The AI stores architecture, rules, decisions, and progress in the OS. When work resumes, it retrieves what matters to the task and locates the code it needs. You can inspect the same information in the App: what exists, what is finished, and why things were designed that way.

## How does it reduce context?

### Understand the feature before opening its code

ContextOS organizes modules and their relationships into a visual architecture. For a login feature, the AI can first see how the login screen, authentication service, and session storage fit together, then inspect the relevant implementation.

Bound modules provide **file paths, method names, and line numbers**. The architecture tells the AI where to look; the source tells it what to change.

![Feature chains and module relationships](assets/path-impact.png)

### Keep project knowledge with the project

“All writes go through the service layer,” “why we chose this database,” and “where we stopped last time” can become project rules, design decisions, and progress records. New conversations retrieve the relevant information as needed.

For longer explanations, the AI can write proposals, audits, and internal guides as OS documents. Select one in the App’s sidebar to read its text, images, and tables in the right inspector. **README stays in its repository location, with a read-only preview in the App.**

![Knowledge sidebar and document inspector](assets/knowledge-reader.png)

### Return useful results from noisy commands

Test and build logs are compressed and processed for sensitive information before reaching the AI. Errors and failure clues remain available, while routine output takes up less context.

### Make progress verifiable

The AI registers planned work, connects it to implemented code, links modules into features, and updates progress after verification. Synchronization checks flag source files without bindings, missing verification, and unfinished tasks so the AI can complete the handoff.

A new conversation can continue from recorded progress. You can distinguish planned work, implemented features, and verified results. The AI still defines the feature relationships; the system checks bindings and delivery conditions.

## Get started

**Download the App → Open Settings and install the plugin → Start a conversation.**

1. [Download ContextOS](https://github.com/yubinbin32-ops/ContextOS/releases/latest), unzip it, and open the App.
2. Open **Settings**, find **Codex**, and click its install/sync button. There is no configuration file to write by hand.
3. Confirm **ContextOS** appears in Codex’s installed plugins, then start a new conversation. Open the same code project in the App and Codex.

For your first conversation, say:

> Write this project's architecture into the OS. Organize its features and current development progress.

When you start a new conversation, say:

> Check the OS. Where are we with this project, and what should we continue next?

The initial project map requires reading relevant code and existing notes. Later conversations can build on that stored understanding.

<details>
<summary>Requirements and installation help</summary>

The desktop App currently supports **macOS 14+**. The plugin needs a local **Node.js 22+ runtime with built-in SQLite support**. Install your AI editor first.

- The installation button may be labeled Sync, Update, or Reinstall.
- If the AI cannot find ContextOS, confirm the plugin is installed and start a new conversation. Restart Codex if needed.
- If Node.js is missing, install a compatible version and sync again.
- The App currently uses ad-hoc signing. If macOS blocks the first launch, Control-click the App and choose Open.

</details>

## What to say to your AI

Describe what you want in ordinary language. You do not need to memorize tool names.

| What you want | What you can say |
| :--- | :--- |
| Understand the project | **Check the OS and explain this project's architecture.** |
| Review progress | **Look in the OS. Which features are finished, and what is left?** |
| Build a feature | **Add login. Check the OS first, then update the architecture and progress when done.** |
| Fix a bug | **The page does not redirect after login. Use the OS to help locate and fix it.** |
| Save a rule | **All APIs should handle errors consistently. Save that rule in the OS.** |
| Save a proposal | **Write this proposal into the OS so I can read it in the App. Don't create another Markdown file.** |
| Preserve a decision | **Record why we chose this approach in the OS for future reference.** |
| Finish a task | **Sync these changes, verification results, and next steps to the OS.** |
| Resume in a new chat | **Check project progress in the OS and continue the unfinished work.** |

You can also set a standing project instruction:

> Check the OS before development and update it afterward. Keep architecture, rules, decisions, progress, and internal proposals in the OS. Keep README for users.

## How much can it reduce?

One reproducible measurement on this repository found:

| Measurement | Result |
| :--- | :--- |
| Returning a feature chain's code locators instead of four complete source files | **211,851 → 2,059 characters**, a **99.02%** reduction |
| Compressing a fixed synthetic log | **10,071 → 828 characters**, a **91.78%** reduction, with the key error retained |

These results show that locators and logs can be much smaller. **They do not mean a whole development task uses that percentage fewer tokens.** Reading implementation code afterward still consumes context. [Raw data and full metrics](docs/benchmarks/2026-09-12-v040.json), measured September 12, 2026.

> Author's experience: roughly **60% fewer context compactions** during daily use. This is a personal impression, without a counted comparison between sessions.

<details>
<summary>Development and contributing</summary>

```bash
git clone https://github.com/yubinbin32-ops/ContextOS.git
cd ContextOS
npm ci
npm test
npm run plugin:verify
npm run desktop:build
```

Desktop builds require macOS and Swift/Xcode tools. Project architecture and internal knowledge are stored in `.contextos/graph.json` and versioned alongside the source.

</details>

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT License](LICENSE)
