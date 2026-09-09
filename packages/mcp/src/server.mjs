#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { ProjectServiceRouter } from "./project-router.mjs";
import { runCli } from "./cli.mjs";
import { sanitizeTerminalOutput } from "./sanitizer.mjs";

const router = new ProjectServiceRouter();
const server = new McpServer(
  { name: "mdflow", version: "0.3.1" },
  {
    instructions:
      "mdflow is project-scoped. At task start call context_for_task with the absolute projectRoot instead of reading documentation files broadly. For Plan work call plan_context: Plans contain direct Block work, ordered ChainScopes, canonical per-entity PlanChanges, and checkpoint gates. A Block does not need to belong to a Chain or have a checkpoint until a requirement, Plan, Chain gate, or explicit verification request requires one. Repeat projectRoot when practical and change it explicitly when switching projects. Use graph_mutate for durable architecture/progress changes, checkpoint_record for evidence, changes_since for compact synchronization, change_set_revert only for safe update-only rollback, and graph_validate after structural or completion updates. Register an uninitialized directory with project_register before other tools.",
  },
);
const projectRootInput = { projectRoot: z.string().min(1).optional() };

function withProject(input, callback) {
  const service = router.serviceFor(input);
  const { projectRoot: _projectRoot, ...payload } = input;
  return callback(service, payload);
}

function readResult(data, markdown, includeStructured = false) {
  return response(data, markdown, includeStructured ? data : undefined);
}

function writeResult(data, markdown, includeStructured = false) {
  const text = markdown ?? data?.markdown ?? writeReceiptMarkdown(data);
  return response(data, text, includeStructured ? data : undefined);
}

function writeReceiptMarkdown(data = {}) {
  if (data?.changeSetId && Number.isInteger(data?.graphRevision)) {
    return [
      "# Graph mutation",
      `- ChangeSet: ${data.changeSetId}`,
      `- Graph revision: ${data.graphRevision}`,
      ...(Array.isArray(data.receipts) && data.receipts.length
        ? ["", "## Applied operations", ...data.receipts.map((receipt) =>
          `- ${receipt.action ?? "updated"} ${receipt.ref ?? `${receipt.entityType ?? "entity"}:${receipt.id ?? "?"}`} · r${receipt.revision ?? "?"}`)]
        : []),
    ].join("\n");
  }
  if (data?.checkpoint && data?.changeSetId) {
    const checkpoint = data.checkpoint;
    return [
      "# Checkpoint recorded",
      `- Checkpoint: ${checkpoint.id}`,
      `- Status: ${checkpoint.status}`,
      `- Target: ${checkpoint.targetType ?? "?"}:${checkpoint.targetId ?? "?"}`,
      `- Revision: ${checkpoint.revision ?? "?"}`,
      `- Graph revision: ${data.graphRevision}`,
      `- ChangeSet: ${data.changeSetId}`,
    ].join("\n");
  }
  if (typeof data?.valid === "boolean") {
    return [
      "# Graph validation",
      `- Status: ${data.valid ? "valid" : "invalid"}`,
      `- Graph revision: ${data.graphRevision ?? "?"}`,
      `- Errors: ${data.errors?.length ?? 0}`,
      `- Warnings: ${data.warnings?.length ?? 0}`,
      ...(data.errors?.length ? ["", "## Errors", ...data.errors.map((item) => `- ${item}`)] : []),
      ...(data.warnings?.length ? ["", "## Warnings", ...data.warnings.map((item) => `- ${item}`)] : []),
    ].join("\n");
  }
  return "# mdflow operation\n- Completed";
}

// Read tools are Markdown-first. MCP clients may place both content and
// structuredContent in the model context, so duplicating a projection in both
// fields wastes tokens and can make the model choose stale values. Every tool
// is Markdown-first; callers opt into the exact JSON projection with
// includeStructured=true.
function response(data, markdown, structuredContent) {
  const output = { content: [{ type: "text", text: markdown ?? JSON.stringify(data) }] };
  if (structuredContent !== undefined) output.structuredContent = structuredContent;
  return output;
}

server.registerTool(
  "project_register",
  {
    description:
      "Register an existing directory as an mdflow project. This creates only .mdflow/project.json and is idempotent when the descriptor already exists.",
    inputSchema: {
      projectRoot: z.string().min(1),
      name: z.string().min(1).optional(),
      id: z.string().min(1).optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = router.register(input);
    return writeResult(data, `${data.created ? "Registered" : "Opened"} ${data.descriptor.name} at ${data.projectRoot}.`, input.includeStructured);
  },
);

server.registerTool(
  "project_map",
  {
    description: "Read a compact project map with architecture coverage, ordered Plans, Chain paths, unplanned Blocks, checkpoint-free Blocks, and missing required checkpoints without loading entity bodies.",
    inputSchema: { ...projectRootInput, locale: z.enum(["en", "zh-Hans"]).optional(), includeStructured: z.boolean().default(false) },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.projectMap(payload));
    return readResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "decision_list",
  {
    description: "Read the compact project-scoped Decision index. Bodies, rationale, alternatives, and consequences are omitted; use decision_open or entity_open(type=decision) for one record.",
    inputSchema: { ...projectRootInput, locale: z.enum(["en", "zh-Hans"]).optional(), includeStructured: z.boolean().default(false) },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.decisionList(payload));
    return readResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "decision_open",
  {
    description: "Open one project-scoped Decision. Returns its rationale, alternatives, consequences, scope, supersession, and compact History; never projects it onto Canvas.",
    inputSchema: { ...projectRootInput, id: z.string().min(1), historyLimit: z.number().int().min(0).max(30).optional(), locale: z.enum(["en", "zh-Hans"]).optional(), includeStructured: z.boolean().default(false) },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.entityOpen({ ...payload, type: "decision" }));
    return readResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "chain_code_stream",
  {
    description: "Extract an end-to-end code stream along an architectural Chain. Returns only targeted AST symbol slices and interfaces for each node, saving ~90% tokens compared to full file reads.",
    inputSchema: {
      ...projectRootInput,
      chainId: z.string().min(1),
      maxTotalChars: z.number().int().min(100).max(20000).optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.chainCodeStream(payload));
    return readResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "log_sanitize",
  {
    description: "Sanitize build, test, or terminal command outputs. Strips ANSI noise, collapses routine compiler stdout, and isolates actionable failure stack traces to protect context window from token flooding.",
    inputSchema: {
      rawOutput: z.string().min(1),
      exitCode: z.number().int().optional(),
      maxChars: z.number().int().min(100).max(10000).optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = sanitizeTerminalOutput(input.rawOutput, {
      exitCode: input.exitCode,
      maxChars: input.maxChars,
    });
    const markdown = [
      `# Sanitized Output (${data.reductionRatio} noise reduced)`,
      `- Original: ${data.originalLength} chars | Cleaned: ${data.sanitizedLength} chars`,
      `- State: ${data.hasErrors ? "Failures detected" : "Clean routine output"}`,
      "",
      "```text",
      data.text,
      "```",
    ].join("\n");
    return readResult(data, markdown, input.includeStructured);
  },
);

server.registerTool(
  "block_code_mutate",
  {
    description:
      "Atomically mutate a specific AST symbol's implementation bound to an architecture Block. Replaces only the targeted symbol body, runs automated verification with terminal log sanitization, and automatically rolls back if tests fail.",
    inputSchema: {
      ...projectRootInput,
      blockId: z.string().min(1),
      symbol: z.string().min(1),
      newCode: z.string().min(1),
      verifyCommand: z.string().optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.mutateBlockCode(payload));
    const status = data.success ? "Successfully updated" : "Failed to update (rolled back)";
    const md = [
      `# Block Code Mutation: ${status}`,
      `- Block: ${data.blockId}`,
      `- Symbol: ${data.symbol}`,
      `- File: ${data.filePath ?? "?"}`,
      ...(data.replacedLines ? [`- Lines: ${data.replacedLines.startLine} - ${data.replacedLines.newEndLine}`] : []),
      ...(data.error ? [`\n## Error\n${data.error}`] : []),
      ...(data.verification ? [`\n## Verification (${data.verification.passed ? "PASSED" : "FAILED"})\n\`\`\`text\n${data.verification.output}\n\`\`\``] : []),
    ].join("\n");
    return writeResult(data, md, input.includeStructured);
  },
);

server.registerTool(
  "foundation_plan_create",
  {
    description:
      "Generate one Foundation Plan from every non-deprecated unimplemented Block. Because this is an explicit implementation/verification Plan, the operation creates missing atomic Block checkpoints, direct Block PlanChanges, dependency-ordered parallel steps, Chain integration gates, and a final Plan acceptance gate in one transaction; plain architecture-only create_block does not.",
    inputSchema: {
      ...projectRootInput,
      id: z.string().min(1).default("foundation-plan"),
      title: z.string().min(1).default("Foundation Plan"),
      goal: z.string().min(1).optional(),
      requiredEvidenceLevel: z.enum(["none", "static", "simulated", "integration", "real_target", "human_review"]).default("integration"),
      actor: z.string().optional(),
      reason: z.string().min(1).optional(),
      gitHead: z.string().nullable().optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.createFoundationPlan(payload));
    const text = `Generated plan:${data.plan?.id ?? input.id} with ${data.generated?.blockIds?.length ?? 0} direct Block(s), ${data.generated?.chainIds?.length ?? 0} Chain gate(s), and acceptance checkpoint ${data.generated?.planAcceptanceCheckpointId ?? "—"}.`;
    return writeResult(data, text, input.includeStructured);
  },
);

server.registerTool(
  "context_for_task",
  {
    description:
      "Get a budgeted Markdown context pack for the current development task. Use at task start and expand only selected refs.",
    inputSchema: {
      ...projectRootInput,
      task: z.string().min(1),
      focusRefs: z.array(z.string()).max(20).optional(),
      maxChars: z.number().int().min(1000).max(24000).default(6000),
      locale: z.enum(["en", "zh-Hans"]).optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.contextForTask(payload));
    return readResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "plan_context",
  {
    description:
      "Read one Plan as a compact hierarchical development document: overview, ordered ChainScopes, inline Block/Link/Chain changes, checkpoint gates, and exact source refs. This is the primary read before implementing a Plan.",
    inputSchema: {
      ...projectRootInput,
      id: z.string().min(1),
      maxChars: z.number().int().min(1000).max(24000).default(12000),
      locale: z.enum(["en", "zh-Hans"]).optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.planContext(payload));
    return readResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "timeline_view",
  {
    description:
      "Read the unified project Timeline: execution phases, ordered plans (P0 > P1 > P2), and current active cursor (nowDoing, nextUp, lastFinished).",
    inputSchema: { ...projectRootInput, includeStructured: z.boolean().default(false) },
  },
  async (input) => {
    const data = withProject(input, (service) => service.getTimeline());
    return readResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "timeline_sync",
  {
    description:
      "Synchronize development cursor and active focus across conversations. Updates nowDoing, nextUp, and active step in the timeline.",
    inputSchema: {
      ...projectRootInput,
      planId: z.string().optional(),
      stepId: z.string().optional(),
      nowDoing: z.string().optional(),
      nextUp: z.string().optional(),
      lastFinished: z.string().optional(),
      touchedFiles: z.array(z.string()).optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.syncTimeline(payload));
    const md = [
      "# Timeline Synchronized",
      `- Plan: \`plan:${data.activePlanId ?? "none"}\``,
      ...(data.activeStepId ? [`- Step: \`${data.activeStepId}\``] : []),
      `- Now Doing: ${data.nowDoing}`,
      ...(data.nextUp ? [`- Next Up: ${data.nextUp}`] : []),
      ...(data.lastFinished ? [`- Last Finished: ${data.lastFinished}`] : []),
    ].join("\n");
    return writeResult(data, md, input.includeStructured);
  },
);

server.registerTool(
  "step_advance",
  {
    description:
      "Advance the active step of a Plan to complete, automatically updating progress and pointing nowDoing to the next step.",
    inputSchema: {
      ...projectRootInput,
      planId: z.string().optional(),
      stepId: z.string().optional(),
      status: z.enum(["complete", "active", "skipped", "failed"]).default("complete"),
      summary: z.string().optional(),
      nextStepId: z.string().optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.advanceStep(payload));
    const md = [
      "# Step Advanced",
      `- Plan: \`plan:${data.activePlanId ?? "none"}\``,
      `- Finished: ${data.lastFinished}`,
      `- Now Doing: ${data.nowDoing}`,
      ...(data.nextUp ? [`- Next Up: ${data.nextUp}`] : []),
    ].join("\n");
    return writeResult(data, md, input.includeStructured);
  },
);

server.registerTool(
  "changes_since",
  {
    description:
      "Read only graph/checkpoint mutations after a known change sequence. Use this for live synchronization and compact read-back instead of reloading the project.",
    inputSchema: {
      ...projectRootInput,
      sequence: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(500).default(100),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.changesSince(payload));
    return readResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "change_set_revert",
  {
    description:
      "Create a new reverse ChangeSet for a safe, fully reversible update-only ChangeSet. Original History is preserved; stale or unsupported changes are rejected instead of partially reverted.",
    inputSchema: {
      ...projectRootInput,
      changeSetId: z.string().min(1),
      actor: z.string().optional(),
      reason: z.string().optional(),
      task: z.string().optional(),
      gitHead: z.string().nullable().optional(),
      planId: z.string().optional(),
      chainScopeId: z.string().optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.revertChangeSet(payload));
    return writeResult(data, `Reverted ChangeSet ${input.changeSetId}. Graph revision ${data.graphRevision}. New ChangeSet ${data.changeSetId}.`, input.includeStructured);
  },
);

server.registerTool(
  "entity_open",
  {
    description: "Open one Block, Chain, Link, Plan, or project-scoped Decision with only relevant details and recent History. Decision bodies are never Canvas nodes.",
    inputSchema: {
      ...projectRootInput,
      type: z.enum(["block", "chain", "link", "plan", "decision"]),
      id: z.string().min(1),
      historyLimit: z.number().int().min(0).max(30).optional(),
      locale: z.enum(["en", "zh-Hans"]).optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.entityOpen(payload));
    return readResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "checkpoint_list",
  {
    description:
      "List checkpoints by status, target, Plan or ChainScope, including standalone checkpoints that are not referenced by any Plan. Use this for a compact verification inbox instead of opening every entity.",
    inputSchema: {
      ...projectRootInput,
      status: z.enum(["pending", "running", "passed", "partial_pass", "failed", "blocked", "not_supported", "retest_required"]).optional(),
      targetType: z.enum(["block", "chain", "link", "plan"]).optional(),
      targetId: z.string().min(1).optional(),
      planId: z.string().min(1).optional(),
      chainScopeId: z.string().min(1).optional(),
      unassignedOnly: z.boolean().default(false),
      limit: z.number().int().min(1).max(500).default(100),
      locale: z.enum(["en", "zh-Hans"]).optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.checkpointList(payload));
    return readResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "graph_search",
  {
    description: "Search graph entities and source paths without loading the entire project.",
    inputSchema: {
      ...projectRootInput,
      query: z.string().min(1),
      kinds: z.array(z.string()).optional(),
      states: z.array(z.string()).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      locale: z.enum(["en", "zh-Hans"]).optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.search(payload));
    return readResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "graph_mutate",
  {
    description:
      "Atomically create or patch Blocks, project-scoped Decisions, global Links, Chain paths, independent Plans, atomic Checkpoints, Background scopes, Decision scopes, and source refs. Decisions are not Canvas Blocks and never enter Block/Chain/Plan coverage. A plain create_block records architecture only; use create_checkpoint in the same ChangeSet when a requirement, Plan, Chain gate, or explicit verification request makes the check necessary. Link kinds are flows_to, calls, reads, writes, depends_on, implements, validates, constrains, and supersedes. Keep each call small and provide expectedRevision for updates.",
    inputSchema: {
      ...projectRootInput,
      actor: z.string().optional(),
      reason: z.string().min(1),
      task: z.string().optional(),
      gitHead: z.string().nullable().optional(),
      planId: z.string().optional(),
      chainScopeId: z.string().optional(),
      includeStructured: z.boolean().default(false),
      operations: z
        .array(
          z.object({
            action: z.enum([
              "create_block",
              "update_block",
              "delete_block",
              "create_decision",
              "update_decision",
              "delete_decision",
              "create_checkpoint",
              "delete_checkpoint",
              "record_checkpoint",
              "add_source_ref",
              "remove_source_ref",
              "create_chain",
              "update_chain",
              "delete_chain",
              "create_link",
              "update_link",
              "delete_link",
              "create_plan",
              "update_plan",
              "delete_plan",
              "set_plan_chains",
              "set_plan_dependencies",
              "set_plan_steps",
              "update_plan_step",
              "set_plan_checkpoints",
              "set_plan_chain_scopes",
              "update_plan_chain_scope",
              "set_plan_changes",
              "update_plan_change",
              "set_plan_chain_change_refs",
              "set_checkpoint_bindings",
              "set_checkpoint_dependencies",
              "set_chain_path",
              "set_background_scopes",
              "set_decision_scopes",
            ]),
            id: z.string().optional(),
            expectedRevision: z.number().int().optional(),
            fields: z.record(z.string(), z.unknown()).optional(),
            summary: z.string().optional(),
          }),
        )
        .min(1)
        .max(20),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.mutate(payload));
    const text = `Applied ${data.receipts.length} operation(s). Graph revision ${data.graphRevision}. ChangeSet ${data.changeSetId}.`;
    return writeResult(data, text, input.includeStructured);
  },
);

server.registerTool(
  "graph_patch",
  {
    description:
      "Apply a compact mdflow/1 Markdown-like patch. The server expands it into the same atomic ChangeSet used by graph_mutate, preserves omitted fields, and can create an atomic Block checkpoint with checkpoint=auto.",
    inputSchema: {
      ...projectRootInput,
      patch: z.string().min(1).max(65536),
      actor: z.string().optional(),
      reason: z.string().optional(),
      task: z.string().optional(),
      gitHead: z.string().nullable().optional(),
      planId: z.string().optional(),
      chainScopeId: z.string().optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.graphPatch(payload));
    return writeResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "graph_flow",
  {
    description:
      "Declare architectural flows and pipelines using natural arrow expressions like 'block:A -> block:B -> block:C' or 'A -[calls]-> B'. Automatically creates or updates links without complex JSON crafting.",
    inputSchema: {
      ...projectRootInput,
      flow: z.string().min(1),
      actor: z.string().optional(),
      reason: z.string().optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) =>
      service.applyArrowFlow(payload.flow, { actor: payload.actor, reason: payload.reason }),
    );
    const md = [
      "# Flow Applied",
      `- Flow: \`${data.flow}\``,
      `- Links modified: ${data.links?.length ?? 0}`,
      `- Graph revision: ${data.graphRevision}`,
      ...(Array.isArray(data.links) && data.links.length
        ? ["", "## Links", ...data.links.map((l) => `- \`block:${l.sourceId}\` -[${l.kind}]-> \`block:${l.targetId}\` (${l.updated ? "updated" : "created"})`)]
        : []),
    ].join("\n");
    return writeResult(data, md, input.includeStructured);
  },
);

server.registerTool(
  "architecture_link_suggest",
  {
    description:
      "Suggest high-confidence architectural links for an architecture Block based on AST source imports and layered conventions.",
    inputSchema: {
      ...projectRootInput,
      blockId: z.string().min(1),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.suggestLinks(payload.blockId));
    const suggestions = Array.isArray(data) ? data : [];
    const md = [
      `# Link Suggestions for block:${input.blockId}`,
      `- Found: ${suggestions.length} suggestion(s)`,
      ...(suggestions.length
        ? ["", ...suggestions.map((s) => `- \`block:${s.sourceId}\` -[${s.kind}]-> \`block:${s.targetId}\` (${s.confidence} confidence): ${s.reason}`)]
        : ["- No new link suggestions found."]),
    ].join("\n");
    return readResult(data, md, input.includeStructured);
  },
);

server.registerTool(
  "architecture_connect",
  {
    description:
      "Connect two architecture Blocks with a validated Link in one simple call without crafting manual operations.",
    inputSchema: {
      ...projectRootInput,
      sourceId: z.string().min(1),
      targetId: z.string().min(1),
      kind: z.enum(["flows_to", "calls", "reads", "writes", "depends_on", "implements", "validates", "constrains", "supersedes"]).default("calls"),
      label: z.string().optional(),
      contract: z.string().optional(),
      actor: z.string().optional(),
      reason: z.string().optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.connectBlocks(payload));
    const md = [
      "# Architecture Connected",
      `- Link: \`block:${input.sourceId}\` -[${input.kind}]-> \`block:${input.targetId}\``,
      `- Graph revision: ${data.graphRevision}`,
      `- ChangeSet: ${data.changeSetId}`,
    ].join("\n");
    return writeResult(data, md, input.includeStructured);
  },
);

server.registerTool(
  "checkpoint_record",
  {
    description:
      "Create or update a checkpoint with evidence. Passed checkpoints are the only basis for healthy completion states.",
    inputSchema: {
      ...projectRootInput,
      actor: z.string().optional(),
      id: z.string().optional(),
      targetType: z.enum(["block", "chain", "link", "plan"]),
      targetId: z.string().min(1),
      title: z.string().min(1),
      criteria: z.string().optional(),
      status: z.enum(["pending", "running", "passed", "partial_pass", "failed", "blocked", "not_supported", "retest_required"]),
      checkpointKind: z.enum(["atomic", "aggregate", "integration"]).optional(),
      aggregationPolicy: z.record(z.string(), z.unknown()).optional(),
      eligibleAfterChildren: z.boolean().optional(),
      evidenceLevel: z.enum(["none", "static", "simulated", "integration", "real_target", "human_review"]).optional(),
      requiredEvidenceLevel: z.enum(["none", "static", "simulated", "integration", "real_target", "human_review"]).optional(),
      coverage: z.enum(["complete", "partial"]).optional(),
      evidence: z.array(z.record(z.string(), z.unknown())).optional(),
      invalidatedAt: z.string().nullable().optional(),
      expectedRevision: z.number().int().optional(),
      planId: z.string().optional(),
      chainScopeId: z.string().optional(),
      gitHead: z.string().nullable().optional(),
      includeStructured: z.boolean().default(false),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.recordCheckpoint(payload));
    return writeResult(data, `Recorded checkpoint ${data.checkpoint.id} for ${data.checkpoint.status}. Graph revision ${data.graphRevision}.`, input.includeStructured);
  },
);

server.registerTool(
  "graph_validate",
  {
    description: "Validate global graph references, Chain paths, Plan targets, Background scopes, contracts, and checkpoint-backed completion.",
    inputSchema: { ...projectRootInput, includeStructured: z.boolean().default(false) },
  },
  async (input) => {
    const data = withProject(input, (service) => service.validate());
    return writeResult(data, undefined, input.includeStructured);
  },
);

const cliArgs = process.argv.slice(2);
if (cliArgs.length > 0 && cliArgs[0] !== "serve" && !cliArgs[0].startsWith("--mcp")) {
  await runCli(cliArgs, router);
  process.exit(0);
}

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => {
  router.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  router.close();
  process.exit(0);
});
