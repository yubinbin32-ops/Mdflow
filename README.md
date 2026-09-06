# mdflow

## Architecture memory for coding agents

mdflow turns a changing codebase into a small, verifiable context:

```text
context → plan → edit → verify → handoff
```

Markdown is still useful for a README, a release note, or a benchmark handoff. It is not a second development truth. During development, the canonical architecture, relationships, progress, and evidence live in the project `.mdflow` graph; MCP returns a bounded Markdown projection by default.

![mdflow overview to release Plan](benchmarks/open-source/express/mdflow-release-walkthrough.gif)

## The problem

Long design notes explain intent but lose ownership, dependency order, and proof. Short notes save tokens but make it easy for an AI to miss a standalone component, an unplanned change, or a failed verification.

mdflow keeps the smallest useful model explicit:

| Object | Role |
| --- | --- |
| Block | A durable responsibility or architecture unit |
| Link | A typed relationship between Blocks |
| Chain | An ordered path; it never owns the Blocks it traverses |
| Plan | Direct Block work, Chain integration, ordered steps, and acceptance |
| Checkpoint | A criterion plus evidence; created when verification is required |
| Rule | Scoped background context, indexed and expanded only when relevant |

## Why the context stays readable

Every task starts with a coverage summary, then expands only the relevant Plan, Block, Chain, Link, Rule, source ref, or checkpoint. The normal MCP response is Markdown. Structured JSON is opt-in with `includeStructured=true`, so the default handoff is easy for an AI to scan and cheap to carry forward.

The Plan view is intentionally ordered:

1. Direct Block work
2. Chain paths and integration gates
3. Link changes
4. Block checkpoints and evidence
5. Plan acceptance

That order prevents a Chain from becoming a hidden owner and makes missing architecture visible.

## A real-project check

We built a public `.mdflow` graph for [Express 5.2.1](https://github.com/expressjs/express) at commit `023767fe9872e029271df1418f73401bff20ff40`. The sample has 11 Blocks, 12 Links, 3 Chains, 11 atomic Block checkpoints, 3 Chain gates, and one Plan acceptance gate. Express's full `npm test` run passed 1260 tests.

The same three task prompts were run through two deterministic context assemblers. Markdown-first rereads a complete handoff on every task; mdflow-first reads the task-scoped graph and opens only the required Blocks.

| Measure | mdflow-first | Markdown-first | Difference |
| --- | ---: | ---: | --- |
| Context tokens (`cl100k_base`) | **7,788** | 10,029 | **22.35% fewer** |
| Characters | **21,283** | 43,899 | **51.52% fewer** |
| Fact recall | 12 / 12 | 12 / 12 | equal |
| Local context assembly | 64.43 ms | 11.09 ms | graph query overhead is visible |

This is a reproducible context baseline, not an LLM latency claim (`llmClaim=false`). A real model/code-edit/recovery run remains a release gate. Read the [full result table](benchmarks/open-source/express/results.md), [Markdown control](benchmarks/open-source/express/markdown-baseline.md), or [sample graph](benchmarks/open-source/express/README.md).

## Try it

For contributors:

```sh
npm install
npm test
swift test --package-path apps/desktop
```

The MCP server and the macOS app read the same project-scoped SQLite graph. The app is a readable Canvas and inspector; MCP is the semantic read/write path.

## Public versus development material

- `README.md`, `docs/launch.md`, release notes, and benchmark pages are for people.
- `.mdflow` is the canonical development graph and is safe to open through MCP.
- The bundled Skill explains when an AI should call `context_for_task`, `plan_context`, `entity_open`, `changes_since`, and `graph_validate`.
- Passed checkpoints disappear from the default inbox but remain in Plan detail and History.
- Historical Plans and History are retained for audit; they are not current work instructions.

## Status

The local candidate has passing MCP (42/42) and Swift (30/30) regression suites, a verified large-graph App path, a public Express sample, and reproducible benchmark assets. Developer ID signing, notarization, the final external-model study, App Store submission, and GitHub Release upload are intentionally left for the guided release phase.
