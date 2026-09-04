#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { createService } from "./service.mjs";

const service = createService();
const server = new McpServer({ name: "mdflow", version: "0.1.0" });

function result(data, markdown) {
  return {
    content: [{ type: "text", text: markdown ?? JSON.stringify(data) }],
    structuredContent: data,
  };
}

server.registerTool(
  "project_map",
  {
    description: "Read a compact map of the current mdflow project and its plan chains without loading entity bodies.",
    inputSchema: { locale: z.enum(["en", "zh-Hans"]).optional() },
  },
  async (input) => {
    const data = service.projectMap(input);
    return result({ snapshot: data.snapshot }, data.markdown);
  },
);

server.registerTool(
  "context_for_task",
  {
    description:
      "Get a budgeted Markdown context pack for the current development task. Use at task start and expand only selected refs.",
    inputSchema: {
      task: z.string().min(1),
      focusRefs: z.array(z.string()).max(20).optional(),
      maxChars: z.number().int().min(1000).max(24000).optional(),
      locale: z.enum(["en", "zh-Hans"]).optional(),
    },
  },
  async (input) => {
    const data = service.contextForTask(input);
    return result(data, data.markdown);
  },
);

server.registerTool(
  "entity_open",
  {
    description: "Open one Block, Chain, Link, or Plan with only its relevant checkpoints, code refs, targets, and recent history.",
    inputSchema: {
      type: z.enum(["block", "chain", "link", "plan"]),
      id: z.string().min(1),
      historyLimit: z.number().int().min(0).max(30).optional(),
      locale: z.enum(["en", "zh-Hans"]).optional(),
    },
  },
  async (input) => {
    const data = service.entityOpen(input);
    return result(data, data.markdown);
  },
);

server.registerTool(
  "graph_search",
  {
    description: "Search graph entities and source paths without loading the entire project.",
    inputSchema: {
      query: z.string().min(1),
      kinds: z.array(z.string()).optional(),
      states: z.array(z.string()).optional(),
      limit: z.number().int().min(1).max(50).optional(),
      locale: z.enum(["en", "zh-Hans"]).optional(),
    },
  },
  async (input) => result(service.search(input)),
);

server.registerTool(
  "graph_mutate",
  {
    description:
      "Atomically create or patch Blocks, Chains, Links, memberships, and source refs. Use whenever implementation changes architecture or progress; keep each call small and provide expectedRevision for updates.",
    inputSchema: {
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
              "set_chain_members",
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
            members: z
              .array(z.object({ type: z.enum(["block", "chain"]), id: z.string() }))
              .optional(),
            summary: z.string().optional(),
          }),
        )
        .min(1)
        .max(10),
    },
  },
  async (input) => {
    const data = service.mutate(input);
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
  async (input) => result(service.recordCheckpoint(input)),
);

server.registerTool(
  "graph_validate",
  {
    description: "Validate graph references, contracts, chain membership, and checkpoint-backed completion.",
    inputSchema: {},
  },
  async () => result(service.validate()),
);

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", () => {
  service.close();
  process.exit(0);
});
