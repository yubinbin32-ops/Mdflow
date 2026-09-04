---
name: mdflow
description: Use the local mdflow project graph to retrieve task-scoped development context and synchronize durable architecture, contracts, code references, progress, risks, and checkpoint evidence. Applies when a project contains .mdflow/project.json or the user asks to use mdflow.
---

# mdflow

Use mdflow as the project's context source, not as a ceremony performed only at task boundaries.

## Read progressively

- Determine the absolute repository root for the project being changed. Pass it as `projectRoot` to every mdflow tool call; when the user switches projects, change `projectRoot` deliberately and never reuse entities across roots.
- If the root has no `.mdflow/project.json`, call `project_register` once before any other mdflow tool.
- At the start of relevant project work, call `context_for_task` with `projectRoot`, the actual task, and a modest budget. This happens before listing repository files, opening development Markdown, broad source search, or reading implementation files for orientation.
- Use `project_map` to understand the whole architecture, then `entity_open` or `graph_search` only when the task context does not answer the next decision.
- Open only source references returned by mdflow and the smallest immediately related code neighborhood needed to make the change. Do not use directory traversal, broad `rg --files`, or read every document to learn a registered project.
- If mdflow lacks a required fact, record the gap or risk, perform a targeted source investigation, and write the confirmed result and source references back before relying on it later.
- Broad file or Markdown reading is allowed only when the user explicitly requests that file, when producing public release documentation, or when mdflow is unavailable or being repaired.
- Do not request or reconstruct the entire graph when a Block, Link, or Chain is sufficient.

## Synchronize when the project meaning changes

Use `graph_mutate` whenever work creates or changes a durable responsibility, flow, interface, data contract, implementation location, risk, plan, or delivery state. Do not emit graph writes for inconsequential code formatting or every intermediate thought.

- A Plan is an independent work-management entity that targets one or more Chains. A Chain is only a reusable path overlay through global Blocks and Links; neither owns or duplicates those graph entities.
- Todo is derived from unfinished Plan checkpoints and next actions. Do not create a Todo Block, Plan Block, or Plan Chain.
- Before implementing a new capability, ensure the smallest accurate Block/Chain structure exists.
- Keep Blocks semantic and stable. Attach implementation, test, schema, style, or configuration locations with `add_source_ref`; remove stale or duplicate locations with `remove_source_ref`. Never replace a responsibility with a file path.
- Update existing entities with their latest `expectedRevision`. If a revision conflicts, reopen the entity and reconcile instead of overwriting it.
- Keep each mutation small, cohesive, and truthful. Record the reason the graph changed.
- When updating a localized title, summary, body, contract, goal, or next action, update every supported locale in the same mutation. If a translation is omitted, mdflow removes the stale localized value and falls back to the canonical fact.
- When implementation reveals that the architecture was wrong, update the architecture immediately; do not preserve a knowingly false plan until the end.

### Mutation vocabulary

Use the storage vocabulary directly so a mutation does not require a discovery retry:

- Block `kind`: `principle`, `product`, `requirement`, `decision`, `flow`, `ui`, `service`, `function`, `integration`, `data`, `database`, `risk`, `test`, or `checkpoint`.
- Block `architectureLayer`: `client`, `boundary`, `application`, `domain`, `data`, `external`, `quality`, `infrastructure`, or `unspecified`. Set it explicitly for product Blocks; reserve `unspecified` for migration or a recorded classification gap.
- Block `scope` names the bounded product/domain area shared across frontend, backend, database, and external integration components. `localOrder` is an integer used only to stabilize order within one scope and architecture layer.
- Link `kind`: `flows_to`, `calls`, `reads`, `writes`, `depends_on`, `implements`, `validates`, `constrains`, or `supersedes`.
- Block/Chain `deliveryState`: `proposed`, `planned`, `implementing`, `verifying`, `complete`, or `deprecated`.
- `healthState`: `unknown`, `healthy`, `warning`, `failing`, `unstable`, or `disputed`.
- Plan `status`: `draft`, `ready`, `active`, `verifying`, `complete`, `blocked`, or `cancelled`.

For `create_link`, set `sourceType`, `sourceId`, `targetType`, `targetId`, and `kind`. For `set_chain_path`, pass ordered `nodeIds` and the existing ordered `linkIds` that connect them. For `set_plan_chains`, pass ordered existing `chainIds`.

## Progress and evidence

- Use delivery state for lifecycle progress and health state for correctness/risk. Do not encode both meanings in one status.
- Move work to `verifying` when implementation exists but evidence is incomplete.
- Record failures with a specific checkpoint or risk and keep them visible while investigating.
- Use `checkpoint_record` for tests and observable acceptance evidence. Only mark a Block or Chain complete/healthy when the relevant checkpoint evidence actually passed.
- After meaningful updates, run `graph_validate` when links, Chain membership, completion state, or contracts may have become inconsistent.

The App is a live read-only projection. MCP mutations commit to a change feed, so keep the graph current enough that a person watching the Canvas sees the real implementation state without needing a refresh.
