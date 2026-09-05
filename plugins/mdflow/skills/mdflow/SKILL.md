---
name: mdflow
description: Use a verified local mdflow project graph to retrieve task-scoped development context and synchronize architecture, contracts, code locations, ordered Plans, progress, risks, and checkpoint evidence. Applies when a project contains .mdflow/project.json or the user asks to use mdflow.
---

# mdflow

Use mdflow as the canonical development-context system after its graph has passed validation. Public/release documentation may remain Markdown; ordinary development architecture, planning, progress, evidence, and implementation locations belong in mdflow.

## Trust gate

- Resolve the absolute repository root and pass it as `projectRoot` to every tool call. Never reuse entity IDs across project roots.
- If `.mdflow/project.json` is absent, register the project, then build its graph from verified source facts. Do not claim Markdown replacement until the graph can reconstruct the project's essential architecture, contracts, decisions, Plans, checkpoints, and code locations.
- If the graph is known to be incomplete, stale, under migration, or under repair, treat it as untrusted. Read the smallest explicitly relevant source/document set, repair and validate the graph, then switch back to mdflow-first use.
- Never copy examples, test-project facts, or another repository's graph into the active project.

## Read progressively

For a trusted graph, call `context_for_task` before broad file discovery, opening development Markdown, or reading implementation files for orientation. Use this order:

1. `context_for_task` with the actual task and a modest character budget.
2. `plan_context` when implementing or reviewing a Plan. Read its ChainScopes, inline entity changes, prohibitions, code locations, and gates before opening files.
3. `project_map` when whole-project order or active Plan sequencing matters.
4. `entity_open` for exact Block, Chain, Link, or non-Plan details.
5. `changes_since` after a known change sequence to synchronize only incremental mutations.
6. `graph_search` only when the returned references are insufficient.
7. Open source references returned by mdflow and the smallest immediately related code neighborhood.

Read-tool response budget:

- `context_for_task`, `plan_context`, and `entity_open` return bounded Markdown as the default human/agent projection plus a compact structured index (refs, status, coverage, and checkpoint metadata).
- Do not request or repeat full structured payloads during ordinary reasoning. Pass `includeStructured: true` only when a client must programmatically inspect full entity bodies; otherwise follow the Markdown links and use `entity_open` for one exact entity.
- Keep the Markdown `maxChars` budget modest. The structured index must not duplicate complete Block, Chain, Plan, evidence, or History bodies already present in the Markdown projection.

The context must cover the facts needed for the task: positive requirements, prohibitions, state transitions, architecture, interfaces/contracts, current progress, decisions, risks, code locations, ordered steps, checkpoint gates, and relevant history. If a required fact is missing, record the gap, investigate narrowly, and repair it before relying on mdflow later.

## Build and maintain the graph in semantic order

1. Create stable global Blocks for durable responsibilities. A Block is not a file, Todo, Plan, or arbitrary note. Every non-deprecated Block must have at least one checkpoint that verifies that Block itself at an appropriate evidence level. When the verification intent is already known, create the Block and its atomic checkpoint in the same `graph_mutate` ChangeSet with `create_block` plus `create_checkpoint`; do not leave the graph in a state where a Block exists without its own check.
2. Create typed global Links for real relationships. Link style and meaning come from `kind`, never Chain membership.
3. Define ordered Chains as reusable paths over existing Block and Link IDs. A Block may be in multiple Chains; Chains never own or duplicate Blocks.
4. Create ordered Plans that cover all intended work. A Plan may directly change a Block or Link even when it belongs to no Chain; do not require a Chain merely to make work visible. Add `plan_chain_scopes` only for exact reusable paths that the Plan changes or integrates.
5. Define one canonical `plan_change` per affected Block, Link, or Chain. Bind the affected Block's checkpoint to its PlanChange when that verification is required for the Plan. Record current behavior, proposed behavior, reason, prohibitions, expected effects, and exact source locations. Reuse that same change from multiple ChainScopes through references; never duplicate it.
6. Build checkpoint bindings and a dependency DAG. Atomic checks bind to the affected change/entity; aggregate Chain gates derive from required children; integration gates become eligible only after their children pass; Plan gates aggregate Chain and cross-Chain acceptance.
7. Attach implementation/test/schema/configuration locations to Blocks using source references. Keep one canonical fact in one storage location and derive other views from it.

Plan phase/order should make a new project readable from foundation through delivery. Todo is derived from unfinished Plan steps, gates, blockers, and next actions; do not create Todo Blocks or Plan Chains.

## Initialize a project before implementation

When requirements describe a system that has not been implemented yet:

1. Build the complete Block/Link architecture first. Mark unimplemented Blocks `proposed` or `planned`; do not omit Blocks simply because no Chain exists yet.
2. Give every Block an atomic checkpoint with explicit criteria for that Block's own responsibility. Create it with `graph_mutate` operation `create_checkpoint` in the same ChangeSet that creates the Block, or with `checkpoint_record` immediately afterward. A reusable Test Block verifies the test capability itself; whole-system acceptance is a Plan integration checkpoint, not a Test Block.
3. Define Chains only for meaningful reusable paths through the existing network. A Block may remain outside every Chain and must still be planned and verified.
4. Create a foundation Plan with direct Block PlanChanges for all Blocks that need implementation, including Blocks outside Chains. Prefer `foundation_plan_create` after the complete Block/Link architecture is present: it creates missing atomic Block checkpoints, dependency-ordered parallel groups, exact Direct Block PlanChanges, Chain integration gates, and the final Plan acceptance gate in one transaction. Use `graph_mutate` only when the Plan needs a deliberately custom structure; use compact receipts instead of repeating full objects.
5. Add Chain integration checkpoints after the necessary Block checkpoints exist. Make Chain gates depend on their required Block/Link checks, then make the final Plan gate depend on the required direct and Chain evidence.
6. Inspect architecture coverage before implementation: total Blocks, Blocks with checkpoints, verified Blocks, Blocks covered by Plans, Blocks outside Chains, and unplanned Blocks. Missing checkpoint or Plan coverage is an incomplete graph, not an irrelevant Block.

Do not claim initialization is complete while a non-deprecated Block lacks its own checkpoint or is absent from every intended Plan. A Plan with direct Block work is valid even when it has no target Chain.

## Mutation fidelity

- Keep every mutation small, cohesive, and truthful. Use current `expectedRevision`; on conflict, reopen and reconcile.
- Prefer `graph_mutate` actions that compose initialization in one ChangeSet: `create_block` + `create_checkpoint`, then `set_plan_changes` and `set_checkpoint_bindings` when a Plan directly owns the work.
- When implementing a Plan, pass its `planId` to `graph_mutate` and `checkpoint_record`. Once work is narrowed to a ChainScope, also pass `chainScopeId`; do not rely on prose summaries to reconstruct task ownership later. The service validates the relationship and records it in compact History metadata.
- Use `change_set_revert` only for a fully reversible update-only ChangeSet. It creates a new reverse ChangeSet and preserves the original audit trail. If the target is stale, contains creates/deletes/relation replacement, or cannot be reversed completely, accept the rejection and reconcile explicitly; never simulate success with a partial revert.
- Store each project fact once, in the language used by the project or current author. Do not generate or maintain translated copies of Block, Link, Chain, Plan, Checkpoint, evidence, or history fields unless the user explicitly asks to translate project content.
- Treat App interface localization as separate from graph content. A `locale` argument may select tool-generated headings or labels, but it must not cause entity fields to be translated or duplicated. Do not send `localizations` merely because the App supports English and Chinese.
- After every meaningful write:
  1. inspect every returned `ref`, `revision`, and `uiLocation` receipt;
  2. call `entity_open` for every changed semantic entity;
  3. compare the read-back against the intended positive requirements, prohibitions, ordering, contracts, and acceptance conditions;
  4. run `graph_validate` when topology, Plan workflow, completion, or contracts changed.
- If read-back loses or distorts a fact, stop implementing from that graph. Correct the graph/schema/Skill before recording more progress.
- When implementation disproves the documented architecture, update the architecture immediately.

## Progress and evidence

- Block/Chain delivery lifecycle: `proposed`, `planned`, `implementing`, `verifying`, `complete`, `deprecated`.
- Plan status: `draft`, `ready`, `active`, `verifying`, `complete`, `blocked`, `failed`, `retest_required`, `cancelled`.
- Plan step status: `pending`, `active`, `complete`, `blocked`, `failed`, `skipped`.
- Checkpoint outcome: `pending`, `running`, `passed`, `partial_pass`, `failed`, `blocked`, `not_supported`, `retest_required`.
- Evidence level, weakest to strongest: `none`, `static`, `simulated`, `integration`, `real_target`, `human_review`.
- A passed gate requires complete coverage and evidence at least as strong as its required level. Static analysis is not real-target proof.
- Aggregate checkpoint status is derived and cannot be manually forced to passed. Required failure/blocked/retest states propagate; optional failures remain visible warnings without blocking success.
- Reject checkpoint dependency cycles. A Chain integration checkpoint runs only after its required Block/Link children pass.
- Mark stale evidence `retest_required` when the implementation or environment invalidates it.
- Never declare a Plan complete while dependencies, required steps, or required gates are incomplete.

## Storage vocabulary

- Block `kind`: `principle`, `product`, `requirement`, `decision`, `flow`, `ui`, `service`, `function`, `integration`, `data`, `database`, `risk`, `test`, `checkpoint`.
- Block `architectureLayer`: `client`, `boundary`, `application`, `domain`, `data`, `external`, `quality`, `infrastructure`, `unspecified`.
- Link `kind`: `flows_to`, `calls`, `reads`, `writes`, `depends_on`, `implements`, `validates`, `constrains`, `supersedes`.
- `scope` is semantic metadata only; it does not imply Canvas position. Set `localOrder` only to stabilize order inside a semantic area.

The desktop App is a live read-only projection. MCP writes must produce a change-feed event and become visible without manual refresh.
