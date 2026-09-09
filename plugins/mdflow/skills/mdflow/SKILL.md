---
name: mdflow
description: Context operating system for AI coding agents. Call context_for_task at task start, and use graph_patch / graph_mutate to build and evolve architecture from 0.
---

# mdflow: Context Operating System for AI Coding

Use mdflow as the canonical development operating system for projects. Public user documentation (README, release notes, landing pages) can remain Markdown; all development architecture, planning, live progress, checkpoints, and code locations belong naturally in mdflow.

AI-facing development context is projected as clean, readable Markdown automatically. Map development intents directly to the corresponding mdflow records; use external Markdown files only when mdflow cannot express the content.

## Cold-Start & Building Architecture from 0

mdflow empowers AI coding agents to autonomously design, express, and evolve software architecture:

1. **Task Start**: Call `context_for_task(task="...")` at task start. On any project (new or existing), mdflow auto-registers cleanly with zero manual configuration.
2. **AI-Authored Architecture**: Inspect local codebase files as needed, formulate your design, and write architecture entities directly into mdflow using `graph_patch` (compact human/AI directives like `create block:<id>`, `flow: A -> B`) or `graph_mutate`.
3. **Transparent Persistence**: All mutations automatically synchronize SQLite and `.mdflow/graph.json` with transactional integrity, versioning, and rollback safety.

## The 6 Core Pillars

1. **Block (Architecture)**: Coarse-grained software responsibilities (`ui`, `service`, `function`, `data`, `database`, `api`, `integration`, `risk`). Independent blocks are valid; verification belongs to Checkpoints, not as architecture Blocks.
2. **Chain & Flow (Pipelines)**: Ordered execution paths across Blocks. Declare flows with natural arrow syntax (`A -> B -> C`).
3. **Plan (Work Packages)**: Grouped into Phases (`foundation`, `core`, `release`) and Priorities (`P0` > `P1` > `P2`).
4. **Timeline (Execution Axis)**: Anchors development across conversation boundaries with an active cursor (`activePlanId`, `activeStepId`, `nowDoing`, `nextUp`, `lastFinished`).
5. **Rule & Decision (Project Memory)**: Scoped background constraints and architectural decisions kept outside the Canvas graph.
6. **Checkpoint (Evidence Gates)**: Objective proofs (`passed`, `failed`) with evidence levels backing health and delivery states.

## Progressive Reading Workflow

1. **Task Start (Cold or Warm)**: Call `context_for_task` with your current task and optional `projectRoot`. If the project is brand new, mdflow auto-registers it immediately with zero manual setup. Never run `cat` or `ls` on `.mdflow`.
2. **Plan Implementation**: Call `plan_context` before touching code to review ordered steps, ChainScopes, direct entity changes, and gates.
3. **Targeted Details**: Call `entity_open` for a single Block, Chain, Link, or Decision.
4. **Synchronization**: Call `changes_since` after a known change sequence to sync incremental mutations.

## Concise AI Writing Protocol

Write the canonical record at the exact boundary where the fact becomes true:

| What to record | Best tool call | Example / Syntax |
| --- | --- | --- |
| **Live Progress** | `timeline_sync` | `timeline_sync(nowDoing="Implementing X", nextUp="Verify Y")` |
| **Step Completion** | `step_advance` | `step_advance(summary="Step X completed")` |
| **Pipeline Flow** | `graph_flow` | `graph_flow(flow="Reader -> Analyzer -[writes]-> Database")` |
| **Quick Connect** | `architecture_connect` | `architecture_connect(sourceId="A", targetId="B", kind="calls")` |
| **Link Suggestion** | `architecture_link_suggest` | `architecture_link_suggest(blockId="A")` (AST import analysis) |
| **Full CRUD Mutation**| `graph_patch` | Compact patch: `create`, `update`, `delete <type>:<id>` |
| **Verification Gate** | `checkpoint_record` | `checkpoint_record(targetId="B", status="passed", evidenceLevel="integration")` |

## On-Demand References

For detailed syntax specifications, read on-demand:
- **Patch Syntax & Directives**: [references/patch-syntax.md](references/patch-syntax.md)
- **Checkpoint Evidence Hierarchy**: [references/verification-gates.md](references/verification-gates.md)

