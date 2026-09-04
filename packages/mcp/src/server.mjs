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
      "mdflow is project-scoped. At task start call context_for_task with the absolute projectRoot. Pass the same projectRoot to every later tool call; change it deliberately when switching projects. Plans are independent work entities that target Chain path overlays. Use graph_mutate for durable architecture or progress changes, checkpoint_record for evidence, and graph_validate after structural or completion updates. Register an uninitialized directory with project_register before other tools.",
  },
);
const projectRootInput = { projectRoot: z.string().min(1).optional() };

function withProject(input, callback) {
  const service = router.serviceFor(input);
  const { projectRoot: _projectRoot, ...payload } = input;
  return callback(service, payload);
}

function result(data, markdown) {
  return {
    content: [{ type: "text", text: markdown ?? JSON.stringify(data) }],
    structuredContent: data,
  };
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
    description: "Read a compact map of the current mdflow project and its plan chains without loading entity bodies.",
    inputSchema: { ...projectRootInput, locale: z.enum(["en", "zh-Hans"]).optional() },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.projectMap(payload));
    return result({ map: data.map }, data.markdown);
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
      maxChars: z.number().int().min(1000).max(24000).default(8000),
      locale: z.enum(["en", "zh-Hans"]).optional(),
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.contextForTask(payload));
    return result(data, data.markdown);
  },
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
    },
  },
  async (input) => {
    const data = withProject(input, (service, payload) => service.entityOpen(payload));
    return result(data, data.markdown);
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
    },
  },
  async (input) => result(withProject(input, (service, payload) => service.search(payload))),
);

server.registerTool(
  "graph_mutate",
  {
    description:
      "Atomically create or patch Blocks, global Links, Chain paths, independent Plans, Background scopes, and source refs. Use whenever implementation changes architecture or progress; keep each call small and provide expectedRevision for updates.",
    inputSchema: {
      ...projectRootInput,
      actor: z.string().optional(),
      reason: z.string().min(1),
      task: z.string().optional(),
      gitHead: z.string().nullable().optional(),
      operations: z
        .array(
          z.object({
            action: z.enum([
              "create_block",
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
        .max(10),
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
      status: z.enum(["pending", "running", "passed", "failed", "blocked"]),
      evidence: z.array(z.record(z.string(), z.unknown())).optional(),
      expectedRevision: z.number().int().optional(),
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
