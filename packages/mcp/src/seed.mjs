import { createService } from "./service.mjs";

const service = createService();
const snapshot = service.snapshot();

if (snapshot.blocks.length === 0 && snapshot.chains.length === 0) {
  service.mutate({
    actor: "bootstrap",
    reason: "Create the first mdflow implementation plan",
    task: "Implement live MCP-to-App graph synchronization",
    operations: [
      {
        action: "create_block",
        id: "product-context-layer",
        fields: {
          kind: "product",
          title: "Executable project context",
          summary: "Replace repeated full-document reads with task-scoped graph context.",
          contract: "Agent reads a bounded Context Pack and expands only referenced entities.",
          deliveryState: "implementing",
          healthState: "healthy",
          priority: "critical",
          tags: ["product", "context"],
        },
      },
      {
        action: "create_block",
        id: "mcp-change-service",
        fields: {
          kind: "service",
          title: "MCP change service",
          summary: "Allow agents to query and atomically synchronize architecture and progress.",
          contract: "Mutations are limited, revision-checked, transactional, and append to change_feed.",
          deliveryState: "implementing",
          healthState: "warning",
          priority: "critical",
          tags: ["mcp", "realtime"],
        },
      },
      {
        action: "create_block",
        id: "live-graph-viewer",
        fields: {
          kind: "ui",
          title: "Live graph viewer",
          summary: "Render Block, Chain, Link and state changes without manual refresh.",
          contract: "Observe change_feed and animate to the newest committed graph revision.",
          deliveryState: "implementing",
          healthState: "warning",
          priority: "critical",
          tags: ["ui", "realtime"],
        },
      },
      {
        action: "create_block",
        id: "codex-plugin-delivery",
        fields: {
          kind: "integration",
          title: "Codex plugin delivery",
          summary: "Package the MCP server and synchronization Skill as one installable plugin.",
          contract: "Plugin manifest references the bundled stdio MCP server and mdflow Skill.",
          deliveryState: "planned",
          healthState: "unknown",
          priority: "high",
          tags: ["codex", "plugin"],
        },
      },
      {
        action: "create_chain",
        id: "initial-live-slice",
        fields: {
          title: "Live MCP → Canvas slice",
          purpose: "plan",
          intent: "Prove that an agent mutation is persisted, observed, and rendered without refresh.",
          inputContract: "A valid graph_mutate or checkpoint_record call.",
          outputContract: "The macOS Canvas reflects the committed revision automatically.",
          deliveryState: "implementing",
          healthState: "warning",
          priority: "critical",
        },
      },
    ],
  });
  service.mutate({
    actor: "bootstrap",
    reason: "Compose the first implementation chain",
    operations: [
      {
        action: "set_chain_members",
        id: "initial-live-slice",
        expectedRevision: 1,
        members: [
          { type: "block", id: "product-context-layer" },
          { type: "block", id: "mcp-change-service" },
          { type: "block", id: "live-graph-viewer" },
          { type: "block", id: "codex-plugin-delivery" },
        ],
      },
      {
        action: "create_link",
        id: "link-context-to-mcp",
        fields: {
          sourceType: "block",
          sourceId: "product-context-layer",
          targetType: "block",
          targetId: "mcp-change-service",
          kind: "flows_to",
          label: "task context",
          healthState: "healthy",
        },
      },
      {
        action: "create_link",
        id: "link-mcp-to-viewer",
        fields: {
          sourceType: "block",
          sourceId: "mcp-change-service",
          targetType: "block",
          targetId: "live-graph-viewer",
          kind: "writes",
          label: "change feed",
          contract: "Committed SQLite transaction increments change_feed sequence.",
          healthState: "warning",
        },
      },
      {
        action: "create_link",
        id: "link-viewer-to-plugin",
        fields: {
          sourceType: "block",
          sourceId: "live-graph-viewer",
          targetType: "block",
          targetId: "codex-plugin-delivery",
          kind: "flows_to",
          label: "verified slice",
          healthState: "unknown",
        },
      },
    ],
  });
  service.mutate({
    actor: "bootstrap",
    reason: "Attach implementation sources",
    operations: [
      {
        action: "add_source_ref",
        id: "mcp-change-service",
        fields: { path: "packages/mcp/src/service.mjs", symbol: "MdflowService", role: "implementation" },
      },
      {
        action: "add_source_ref",
        id: "live-graph-viewer",
        fields: { path: "apps/desktop/Sources/MdflowDesktop", symbol: "GraphStore", role: "implementation" },
      },
    ],
  });
  service.recordCheckpoint({
    actor: "bootstrap",
    targetType: "chain",
    targetId: "initial-live-slice",
    title: "Agent mutation appears without refresh",
    criteria: "A graph mutation increments the feed and the running App renders the new revision automatically.",
    status: "pending",
    evidence: [],
  });
  console.log("Seeded mdflow development graph.");
} else {
  console.log("Graph already contains data; seed skipped.");
}

service.close();
