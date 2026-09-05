#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { ProjectServiceRouter } from "./project-router.mjs";

const router = new ProjectServiceRouter();
const server = new McpServer(
  { name: "mdflow", version: "0.2.0" },
  {
    instructions:
      "mdflow is project-scoped. At task start call context_for_task with the absolute projectRoot instead of reading documentation files broadly. For Plan work call plan_context: Plans contain direct Block work, ordered ChainScopes, canonical per-entity PlanChanges, and checkpoint gates. A Block does not need to belong to a Chain, but every non-deprecated Block needs its own checkpoint and intended Plan coverage. Repeat projectRoot when practical and change it explicitly when switching projects. Use graph_mutate for durable architecture/progress changes, checkpoint_record for evidence, changes_since for compact synchronization, change_set_revert only for safe update-only rollback, and graph_validate after structural or completion updates. Register an uninitialized directory with project_register before other tools.",
  },
);
const projectRootInput = { projectRoot: z.string().min(1).optional() };

function withProject(input, callback) {
  const service = router.serviceFor(input);
  const { projectRoot: _projectRoot, ...payload } = input;
  return callback(service, payload);
}

function result(data, markdown) {
  return response(data, markdown, data);
}

function readResult(data, markdown, includeStructured = false) {
  return response(data, markdown, includeStructured ? data : undefined);
}

// Read tools are Markdown-first. MCP clients may place both content and
// structuredContent in the model context, so duplicating a projection in both
// fields wastes tokens and can make the model choose stale values. Mutations
// and validation keep their small machine receipt; read tools pass undefined
// here unless the caller explicitly asks for includeStructured=true.
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
    },
  },
  async (input) => {
    const data = router.register(input);
    return result(data, `${data.created ? "Registered" : "Opened"} ${data.descriptor.name} at ${data.projectRoot}.`);
  },
);

server.registerTool(
  "project_map",
  {
    description: "Read a compact project map with architecture coverage, ordered Plans, Chain paths, unplanned Blocks, and missing Block checkpoints without loading entity bodies.",
    inputSchema: { ...projectRootInput, locale: z.enum(["en", "zh-Hans"]).optional(), includeStructured: z.boolean().default(false) },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.projectMap(payload));
    return readResult(data, data.markdown, input.includeStructured);
  },
);

server.registerTool(
  "foundation_plan_create",
  {
    description:
      "Generate one Foundation Plan from every non-deprecated unimplemented Block. The operation creates missing atomic Block checkpoints, direct Block PlanChanges, dependency-ordered parallel steps, Chain integration gates, and a final Plan acceptance gate in one transaction.",
    inputSchema: {
      ...projectRootInput,
      id: z.string().min(1).default("foundation-plan"),
      title: z.string().min(1).default("Foundation Plan"),
      goal: z.string().min(1).optional(),
      requiredEvidenceLevel: z.enum(["none", "static", "simulated", "integration", "real_target", "human_review"]).default("integration"),
      actor: z.string().optional(),
      reason: z.string().min(1).optional(),
      gitHead: z.string().nullable().optional(),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.createFoundationPlan(payload));
    return result(data, data.markdown);
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
    },
  },
  async (input) => result(withProject(input, (service, payload) => service.revertChangeSet(payload))),
);

server.registerTool(
  "entity_open",
  {
    description: "Open one Block, Chain, Link, or Plan with only its relevant checkpoints, code refs, targets, and recent history.",
    inputSchema: {
      ...projectRootInput,
      type: z.enum(["block", "chain", "link", "plan"]),
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
      "Atomically create or patch Blocks, global Links, Chain paths, independent Plans, atomic Checkpoints, Background scopes, and source refs. Use create_checkpoint in the same ChangeSet as create_block when verification intent is already known. Link kinds are flows_to, calls, reads, writes, depends_on, implements, validates, constrains, and supersedes. Keep each call small and provide expectedRevision for updates.",
    inputSchema: {
      ...projectRootInput,
      actor: z.string().optional(),
      reason: z.string().min(1),
      task: z.string().optional(),
      gitHead: z.string().nullable().optional(),
      planId: z.string().optional(),
      chainScopeId: z.string().optional(),
      operations: z
        .array(
          z.object({
            action: z.enum([
              "create_block",
              "create_checkpoint",
              "update_block",
              "add_source_ref",
              "remove_source_ref",
              "create_chain",
              "update_chain",
              "create_link",
              "update_link",
              "create_plan",
              "update_plan",
              "set_plan_chains",
              "set_plan_dependencies",
              "set_plan_steps",
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
    return result(data, text);
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
    },
  },
  async (input) => result(withProject(input, (service, payload) => service.recordCheckpoint(payload))),
);

server.registerTool(
  "graph_validate",
  {
    description: "Validate global graph references, Chain paths, Plan targets, Background scopes, contracts, and checkpoint-backed completion.",
    inputSchema: { ...projectRootInput },
  },
  async (input) => result(withProject(input, (service) => service.validate())),
);

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
