---
name: contextos
description: Keep project architecture, Markdown knowledge, source locators and verified task handoffs synchronized with ContextOS. Retrieve task context before broad file reads; write internal reports to OS documents.
---

# ContextOS project workflow

The graph stores architecture and intent. Source files define implementation behavior.
OS Documents store project narratives. README stays in its repository location and is read-only in the App.

## Start

1. Call `context_for_task` with the repository/worktree's absolute `projectRoot`. Register with `project_register` if needed. Preserve `taskContextId` for budgeted reads.
2. Read task-relevant rules and decisions. If `requiredContextIncomplete` or a REQUIRED expansion notice appears, expand those references before implementation. Use `document_list` / `document_open` for project narratives; read only relevant chapters. Do not reread all files to rediscover an existing architecture.
3. Register new Blocks and design Decisions before implementation. Declare feature links and a draft Chain using `graph_mutate` / `graph_flow`.
4. Read resumable tasks from `context_for_task` / `sync_issues`. Resume a matching unfinished task instead of creating a duplicate. Otherwise call `task_begin` with relevant Block IDs and a feature Chain. A genuinely independent Block may use `standaloneReason`. A review-only task can use `readOnly: true` and no Blocks.

## Implement and synchronize

- Use `chain_code_stream` / `entity_open` locators: path + symbol, derived line range and contract. Open only the necessary implementation in the host editor.
- Missing/ambiguous/unreadable bindings require resolution. Use `source_binding_suggest` and `source_binding_accept`; never substitute stale code.
- Use `run_command` for tests/builds so raw terminal output stays out of context. Use `log_sanitize` only for logs supplied externally.
- Call `task_reconcile` after edits. It indexes new/changed/deleted files, records issues, checks feature membership and moves actually anchored blueprints into implementation. Source existence does not mean verified delivery.
- Resolve issues by updating bindings, feature Chain, or explicit task scope with `task_scope`. Do not invent meaningless links to clear an alert.
- To inspect project-wide unbound files use `source_index`; `sync_issues` shows durable issues and unfinished sessions. No fixed 600-file discovery assumption.

## Write project knowledge in the OS

- Reports, designs and internal guides: `document_write`, not a new `docs/*.md` file. Return its `openURL` so the user can read it in ContextOS.
- Use `document_patch` with `expectedRevision` for a chapter update. Refresh on conflicts; do not overwrite another writer's document.
- A Decision records a choice, rationale and alternatives; it is not a container for an entire report. Link Documents to Blocks/Chains/Decisions with typed refs.
- Existing internal Markdown: `document_import` records source path/hash. Verify content, images and links before deleting or replacing the old editable source. Public docs and machine-readable evidence may stay in files.
- README remains a repository file. Its local relative images remain relative to that file. The App previews it without maintaining a second editable copy.
- Keep reported measurements distinct from personal experience. The author's “about 60% fewer compactions” is a subjective usage impression, not a benchmark.

## Finish or hand off

1. Run relevant verification through `run_command`.
2. Record `checkpoint_record` with successful execution receipts for required targets. A fresh direct Block checkpoint verifies that Block; a declared Chain checkpoint verifies integration independently. Do not create artificial Plan gates.
3. Call `task_reconcile` again, then `task_finish` with its `sourceRevision`, `graphRevision` as `expectedGraphRevision`, a stable `idempotencyKey`, and a concise handoff summary. The finish transaction checks current evidence and the declared feature network. Retry the same key after an uncertain response.
4. If finishing without a TaskSession, use `block_seal` for verified Blocks and explicitly update the relevant Chain and handoff. Plain `deliveryState: complete` updates cannot bypass required verification.
5. Call `graph_validate`. Report unresolved legacy issues separately; never claim the entire graph healthy if validation failed. If a projection is pending/conflicted, surface it and recover before declaring persistence complete.
6. Advance a Plan step only when this task belongs to that Plan. Do not advance an old active Plan during unrelated work. Paused work remains resumable; use `task_scope` with a summary/next action rather than claiming completion.

## Small tool reference

| Purpose | Tools |
|---|---|
| Orient | `context_for_task`, `project_map`, `entity_open`, `graph_search` |
| Knowledge | `document_list`, `document_open`, `document_write`, `document_patch`, `document_import` |
| Architecture | `graph_mutate`, `graph_patch`, `graph_flow`, `decision_list` |
| Source | `source_sync`, `source_index`, `source_binding_suggest`, `source_binding_accept`, `chain_code_stream` |
| Task lifecycle | `task_begin`, `task_scope`, `task_reconcile`, `task_finish`, `sync_issues` |
| Verify | `run_command`, `checkpoint_record`, `block_seal`, `graph_validate` |
| Runtime | `runtime_info` in a new conversation after installation/update |

Current parser adapters are syntax-based locators, not a complete semantic compiler. Unsupported/ambiguous symbols must remain explicit. Feature intent is declared by the agent/user; import graphs alone do not prove business flows.
