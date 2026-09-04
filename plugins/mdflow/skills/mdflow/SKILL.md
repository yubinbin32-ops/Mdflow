---
name: mdflow
description: Use the local mdflow project graph to retrieve task-scoped development context and synchronize durable architecture, contracts, code references, progress, risks, and checkpoint evidence. Applies when a project contains .mdflow/project.json or the user asks to use mdflow.
---

# mdflow

Use mdflow as the project's context source, not as a ceremony performed only at task boundaries.

## Read progressively

- At the start of relevant project work, call `context_for_task` with the actual task and a modest budget.
- Use `entity_open` or `graph_search` only when the returned references do not answer the next decision.
- Do not request or reconstruct the entire graph when a Block, Link, or Chain is sufficient.

## Synchronize when the project meaning changes

Use `graph_mutate` whenever work creates or changes a durable responsibility, flow, interface, data contract, implementation location, risk, plan, or delivery state. Do not emit graph writes for inconsequential code formatting or every intermediate thought.

- A Plan is a Chain. Planned work is represented by its unfinished member Blocks, not a separate Todo list.
- Before implementing a new capability, ensure the smallest accurate Block/Chain structure exists.
- Keep Blocks semantic and stable. Attach implementation, test, schema, style, or configuration locations with `add_source_ref`; remove stale or duplicate locations with `remove_source_ref`. Never replace a responsibility with a file path.
- Update existing entities with their latest `expectedRevision`. If a revision conflicts, reopen the entity and reconcile instead of overwriting it.
- Keep each mutation small, cohesive, and truthful. Record the reason the graph changed.
- When implementation reveals that the architecture was wrong, update the architecture immediately; do not preserve a knowingly false plan until the end.

## Progress and evidence

- Use delivery state for lifecycle progress and health state for correctness/risk. Do not encode both meanings in one status.
- Move work to `verifying` when implementation exists but evidence is incomplete.
- Record failures with a specific checkpoint or risk and keep them visible while investigating.
- Use `checkpoint_record` for tests and observable acceptance evidence. Only mark a Block or Chain complete/healthy when the relevant checkpoint evidence actually passed.
- After meaningful updates, run `graph_validate` when links, Chain membership, completion state, or contracts may have become inconsistent.

The App is a live read-only projection. MCP mutations commit to a change feed, so keep the graph current enough that a person watching the Canvas sees the real implementation state without needing a refresh.
