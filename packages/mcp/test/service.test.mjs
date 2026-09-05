import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createService } from "../src/service.mjs";

function fileDigest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-project-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-data-"));
  fs.mkdirSync(path.join(root, ".mdflow"));
  fs.writeFileSync(
    path.join(root, ".mdflow", "project.json"),
    JSON.stringify({ id: "test-project", name: "Test", schemaVersion: 1 }),
  );
  const service = createService({ projectRoot: root, dataRoot });
  return {
    service,
    cleanup() {
      service.close();
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dataRoot, { recursive: true, force: true });
    },
  };
}

test("opening an already migrated versioned graph is byte-stable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-versioned-open-"));
  fs.mkdirSync(path.join(root, ".mdflow"));
  fs.writeFileSync(
    path.join(root, ".mdflow", "project.json"),
    JSON.stringify({ id: "versioned-open", name: "Versioned Open", schemaVersion: 1 }),
  );
  const databasePath = path.join(root, ".mdflow", "mdflow.sqlite");
  try {
    const first = createService({ projectRoot: root });
    first.close();
    const before = fileDigest(databasePath);

    const second = createService({ projectRoot: root });
    second.projectMap();
    second.close();

    assert.equal(fileDigest(databasePath), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Plans stay independent while Chains reference paths through one global network", () => {
  const context = fixture();
  try {
    const first = context.service.mutate({
      reason: "Create a global network, one path overlay, and one delivery plan",
      operations: [
        {
          action: "create_block", id: "input", fields: { kind: "service", title: "Input" },
        },
        {
          action: "create_block", id: "viewer", fields: { kind: "ui", title: "Viewer", summary: "Render changes live" },
        },
        {
          action: "create_chain", id: "live-path", fields: { title: "Live path", purpose: "architecture" },
        },
        {
          action: "create_plan", id: "ship-live-path", fields: {
            title: "Ship live path", goal: "Make mutations visible", status: "active",
            nextAction: "Verify the rendered revision",
          },
        },
        {
          action: "create_link", id: "input-viewer", fields: {
            sourceType: "block", sourceId: "input", targetType: "block", targetId: "viewer",
            kind: "writes", contract: "Committed changes only",
          },
        },
      ],
    });
    assert.equal(first.graphRevision, 1);
    assert.equal(first.receipts.length, 5);

    const second = context.service.mutate({
      reason: "Overlay the path and point the independent Plan at it",
      operations: [
        {
          action: "set_chain_path",
          id: "live-path",
          expectedRevision: 1,
          fields: { nodeIds: ["input", "viewer"], linkIds: ["input-viewer"] },
        },
        {
          action: "set_plan_chains",
          id: "ship-live-path",
          expectedRevision: 1,
          fields: { chainIds: ["live-path"] },
        },
      ],
    });
    const snapshot = context.service.snapshot();
    assert.equal(second.graphRevision, 2);
    assert.equal(snapshot.changeSequence, 7);
    assert.deepEqual(snapshot.chainNodes.map((node) => node.blockId), ["input", "viewer"]);
    assert.deepEqual(snapshot.chainEdges.map((edge) => edge.linkId), ["input-viewer"]);
    assert.deepEqual(snapshot.planChainRefs, [{ planId: "ship-live-path", chainId: "live-path", position: 0 }]);
    assert.equal(Object.hasOwn(snapshot, "members"), false);
    assert.equal(snapshot.plans.length, 1);
    assert.equal(snapshot.chains.some((chain) => chain.purpose === "plan"), false);
  } finally {
    context.cleanup();
  }
});

test("one Block can participate in multiple Chains without being duplicated or owned by either", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create overlapping paths",
      operations: [
        { action: "create_block", id: "shared", fields: { kind: "service", title: "Shared" } },
        { action: "create_block", id: "left", fields: { kind: "ui", title: "Left" } },
        { action: "create_block", id: "right", fields: { kind: "data", title: "Right" } },
        { action: "create_chain", id: "left-path", fields: { title: "Left path" } },
        { action: "create_chain", id: "right-path", fields: { title: "Right path" } },
        { action: "create_link", id: "shared-left", fields: { sourceType: "block", sourceId: "shared", targetType: "block", targetId: "left", kind: "flows_to" } },
        { action: "create_link", id: "shared-right", fields: { sourceType: "block", sourceId: "shared", targetType: "block", targetId: "right", kind: "flows_to" } },
      ],
    });
    context.service.mutate({
      reason: "Reference the same global Block from both paths",
      operations: [
        { action: "set_chain_path", id: "left-path", expectedRevision: 1, fields: { nodeIds: ["shared", "left"], linkIds: ["shared-left"] } },
        { action: "set_chain_path", id: "right-path", expectedRevision: 1, fields: { nodeIds: ["shared", "right"], linkIds: ["shared-right"] } },
      ],
    });
    context.service.mutate({
      reason: "Archive one overlay only",
      operations: [{ action: "update_chain", id: "left-path", expectedRevision: 2, fields: { archived: true } }],
    });
    const snapshot = context.service.snapshot();
    assert.deepEqual(snapshot.blocks.map((block) => block.id).sort(), ["left", "right", "shared"]);
    assert.deepEqual(snapshot.chains.map((chain) => chain.id), ["right-path"]);
    assert.deepEqual(snapshot.chainNodes.map((node) => node.blockId), ["shared", "right"]);
  } finally {
    context.cleanup();
  }
});

test("Chain paths reject edges outside their referenced nodes and stale rewrites", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create path validation fixture",
      operations: [
        { action: "create_block", id: "a", fields: { kind: "service", title: "A" } },
        { action: "create_block", id: "b", fields: { kind: "service", title: "B" } },
        { action: "create_block", id: "c", fields: { kind: "service", title: "C" } },
        { action: "create_chain", id: "path", fields: { title: "Path" } },
        { action: "create_link", id: "a-c", fields: { sourceType: "block", sourceId: "a", targetType: "block", targetId: "c", kind: "flows_to" } },
      ],
    });
    assert.throws(() => context.service.mutate({
      reason: "Attempt invalid path",
      operations: [{ action: "set_chain_path", id: "path", expectedRevision: 1, fields: { nodeIds: ["a", "b"], linkIds: ["a-c"] } }],
    }), /endpoints must both be referenced Chain nodes/);
    assert.equal(context.service.snapshot().chainNodes.length, 0);

    context.service.mutate({
      reason: "Set a valid node-only path",
      operations: [{ action: "set_chain_path", id: "path", expectedRevision: 1, fields: { nodeIds: ["a", "b"], linkIds: [] } }],
    });
    assert.throws(() => context.service.mutate({
      reason: "Attempt stale path rewrite",
      operations: [{ action: "set_chain_path", id: "path", expectedRevision: 1, fields: { nodeIds: ["b"], linkIds: [] } }],
    }), /Revision conflict/);
  } finally {
    context.cleanup();
  }
});

test("stale revisions cannot overwrite an entity", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create block",
      operations: [
        { action: "create_block", id: "api", fields: { kind: "service", title: "API" } },
      ],
    });
    context.service.mutate({
      reason: "Advance block",
      operations: [
        {
          action: "update_block",
          id: "api",
          expectedRevision: 1,
          fields: { deliveryState: "implementing" },
        },
      ],
    });
    assert.throws(
      () =>
        context.service.mutate({
          reason: "Stale write",
          operations: [
            {
              action: "update_block",
              id: "api",
              expectedRevision: 1,
              fields: { summary: "Should not land" },
            },
          ],
        }),
      /Revision conflict/,
    );
    assert.equal(context.service.snapshot().blocks[0].summary, "");
  } finally {
    context.cleanup();
  }
});

test("task context stays scoped and includes matching contracts", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create context entities",
      operations: [
        {
          action: "create_block",
          id: "image-api",
          fields: {
            kind: "service",
            title: "Image API",
            summary: "Accept image uploads",
            body: "The upload flow preserves EXIF orientation and returns a stable asset identifier.",
            contract: "JPEG or PNG under 10MB",
            tags: ["image", "api"],
          },
        },
        {
          action: "create_block",
          id: "billing",
          fields: { kind: "service", title: "Billing", summary: "Reserve credits" },
        },
      ],
    });
    const contextPack = context.service.contextForTask({ task: "change image upload api" });
    assert.match(contextPack.markdown, /Image API/);
    assert.match(contextPack.markdown, /JPEG or PNG/);
    assert.match(contextPack.markdown, /EXIF orientation/);
    assert.doesNotMatch(contextPack.markdown, /Billing/);
    const opened = context.service.entityOpen({ type: "block", id: "image-api" });
    assert.match(opened.markdown, /## Details\nThe upload flow/);
  } finally {
    context.cleanup();
  }
});

test("Background Blocks enter scoped context without polluting the global topology", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create a project constraint and unrelated content",
      operations: [
        { action: "create_block", id: "project-rule", fields: {
          kind: "principle", title: "One canonical source", summary: "Store each fact once.", priority: "normal",
        } },
        { action: "create_block", id: "unrelated", fields: { kind: "service", title: "Billing queue" } },
      ],
    });
    context.service.mutate({
      reason: "Scope the constraint to the project",
      operations: [{
        action: "set_background_scopes", id: "project-rule", expectedRevision: 1,
        fields: { scopes: [{ type: "project", value: "*" }] },
      }],
    });
    const result = context.service.contextForTask({ task: "adjust an unrelated renderer detail" });
    assert.ok(result.refs.includes("block:project-rule"));
    assert.match(result.markdown, /One canonical source/);
    assert.doesNotMatch(result.markdown, /Billing queue/);
  } finally {
    context.cleanup();
  }
});

test("Plan context exposes its target Chains, checkpoints, and next action", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create plan context fixture",
      operations: [
        { action: "create_block", id: "work", fields: { kind: "service", title: "Work" } },
        { action: "create_chain", id: "delivery", fields: { title: "Delivery path", intent: "Ship the work" } },
        { action: "create_plan", id: "ship", fields: { title: "Ship it", status: "active", goal: "Deliver safely", nextAction: "Run verification" } },
      ],
    });
    context.service.mutate({
      reason: "Connect the plan to its path",
      operations: [
        { action: "set_chain_path", id: "delivery", expectedRevision: 1, fields: { nodeIds: ["work"], linkIds: [] } },
        { action: "set_plan_chains", id: "ship", expectedRevision: 1, fields: { chainIds: ["delivery"] } },
      ],
    });
    context.service.recordCheckpoint({
      id: "verify-ship", targetType: "plan", targetId: "ship", title: "End-to-end proof",
      criteria: "The path passes", status: "pending",
    });
    const result = context.service.contextForTask({ task: "continue shipping", focusRefs: ["plan:ship"] });
    assert.ok(result.refs.includes("plan:ship"));
    assert.ok(result.refs.includes("chain:delivery"));
    assert.match(result.markdown, /Run verification/);
    assert.match(result.markdown, /End-to-end proof/);
    const opened = context.service.entityOpen({ type: "plan", id: "ship" });
    assert.deepEqual(opened.targetChains, [{ chainId: "delivery", position: 0 }]);
    assert.equal(opened.checkpoints[0].id, "verify-ship");
    const discovered = context.service.search({ query: "ship active verification", kinds: ["plan"], states: ["active"] });
    assert.equal(discovered.results[0].id, "ship");
    const map = context.service.projectMap();
    assert.equal(map.map.counts.blocks, 1);
    assert.equal(Object.hasOwn(map.map, "blocks"), false);
  } finally {
    context.cleanup();
  }
});

test("checkpoints cannot be recorded against missing graph entities", () => {
  const context = fixture();
  try {
    assert.throws(() => context.service.recordCheckpoint({
      targetType: "plan", targetId: "missing", title: "Impossible", status: "passed",
    }), /plan:missing not found/);
    assert.equal(context.service.snapshot().changeSequence, 0);
  } finally {
    context.cleanup();
  }
});

test("standalone checkpoints are discoverable without being forced into a Plan", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create an independently testable service Block",
      operations: [{ action: "create_block", id: "worker", fields: { kind: "service", title: "Worker", summary: "Runs background jobs" } }],
    });
    context.service.recordCheckpoint({
      id: "worker-test", targetType: "block", targetId: "worker", title: "Worker unit tests", status: "pending",
    });
    const listed = context.service.checkpointList({ unassignedOnly: true });
    assert.equal(listed.count, 1);
    assert.equal(listed.items[0].id, "worker-test");
    assert.equal(listed.items[0].planned, false);
    const contextPack = context.service.contextForTask({ task: "continue the project" });
    assert.match(contextPack.markdown, /Standalone verification/);
    assert.match(contextPack.markdown, /Worker unit tests/);
  } finally {
    context.cleanup();
  }
});

test("checkpoint discovery hides archived entity targets while preserving their history", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create entities with historical checkpoints",
      operations: [
        { action: "create_plan", id: "old-plan", fields: { title: "Old plan" } },
        { action: "create_chain", id: "old-chain", fields: { title: "Old chain" } },
      ],
    });
    context.service.recordCheckpoint({
      id: "old-plan-gate", targetType: "plan", targetId: "old-plan", title: "Old plan gate", status: "pending",
    });
    context.service.recordCheckpoint({
      id: "old-chain-gate", targetType: "chain", targetId: "old-chain", title: "Old chain gate", status: "pending",
    });
    context.service.mutate({
      reason: "Archive superseded entities",
      operations: [
        { action: "update_plan", id: "old-plan", expectedRevision: 1, fields: { archived: true, status: "cancelled" } },
        { action: "update_chain", id: "old-chain", expectedRevision: 1, fields: { archived: true, deliveryState: "deprecated" } },
      ],
    });
    const listed = context.service.checkpointList();
    assert.equal(listed.items.some((item) => ["old-plan-gate", "old-chain-gate"].includes(item.id)), false);
    assert.equal(context.service.snapshot().checkpoints.some((item) => item.id === "old-plan-gate"), true);
  } finally {
    context.cleanup();
  }
});

test("a completed Chain requires passed checkpoint evidence", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create an unverified completed Chain",
      operations: [{ action: "create_chain", id: "done-path", fields: { title: "Done path", deliveryState: "complete" } }],
    });
    assert.ok(context.service.validate().warnings.includes("Complete Chain has no passed checkpoint: chain:done-path"));
    context.service.recordCheckpoint({
      id: "done-proof", targetType: "chain", targetId: "done-path", title: "Path verified", status: "passed",
    });
    assert.equal(context.service.validate().warnings.includes("Complete Chain has no passed checkpoint: chain:done-path"), false);
  } finally {
    context.cleanup();
  }
});

test("locale never replaces canonical project content", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create a canonical block with one legacy translation",
      operations: [{
        action: "create_block", id: "canvas", fields: {
          kind: "ui", title: "Zoomable canvas", summary: "Scale and pan the graph",
          localizations: { "zh-Hans": { title: "可缩放画布", summary: "缩放和平移项目图" } },
        },
      }],
    });
    const english = context.service.entityOpen({ type: "block", id: "canvas", locale: "en" });
    const chineseUI = context.service.entityOpen({ type: "block", id: "canvas", locale: "zh-Hans" });
    assert.match(english.markdown, /Zoomable canvas/);
    assert.match(chineseUI.markdown, /Zoomable canvas/);
    assert.doesNotMatch(chineseUI.markdown, /可缩放画布/);
    assert.equal(context.service.search({ query: "Zoomable", locale: "zh-Hans" }).results[0].title, "Zoomable canvas");
    assert.deepEqual(context.service.search({ query: "可缩放", locale: "zh-Hans" }).results, []);
  } finally {
    context.cleanup();
  }
});

test("Blocks carry explicit architecture placement and reject invalid layers", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Classify one full-stack component",
      operations: [{
        action: "create_block", id: "orders", fields: {
          kind: "service", title: "Orders", scope: "commerce", architectureLayer: "application", localOrder: 20,
        },
      }],
    });
    const block = context.service.snapshot().blocks[0];
    assert.equal(block.scope, "commerce");
    assert.equal(block.architectureLayer, "application");
    assert.equal(block.localOrder, 20);
    assert.deepEqual(context.service.projectMap().map.architecture.layerCounts, { application: 1 });
    assert.match(context.service.entityOpen({ type: "block", id: "orders" }).markdown, /Architecture: application/);
    assert.throws(() => context.service.mutate({
      reason: "Reject an unknown layer",
      operations: [{ action: "update_block", id: "orders", expectedRevision: 1, fields: { architectureLayer: "middle" } }],
    }), /Invalid architecture layer/);
  } finally {
    context.cleanup();
  }
});

test("legacy localization input never overrides canonical plan facts", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create localized plan",
      operations: [{ action: "create_plan", id: "release", fields: {
        title: "Release", nextAction: "Run old check",
        localizations: { "zh-Hans": { title: "发布", nextAction: "运行旧检查" } },
      } }],
    });
    context.service.mutate({
      reason: "Advance canonical next action",
      operations: [{ action: "update_plan", id: "release", expectedRevision: 1, fields: { nextAction: "Run new check" } }],
    });
    const opened = context.service.entityOpen({ type: "plan", id: "release", locale: "zh-Hans" });
    assert.match(opened.markdown, /# Release/);
    assert.match(opened.markdown, /Run new check/);
    assert.doesNotMatch(opened.markdown, /运行旧检查/);
    assert.doesNotMatch(opened.markdown, /# 发布/);
  } finally {
    context.cleanup();
  }
});

test("a project-owned graph replaces broad prose with bounded golden task contexts", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create a representative project-owned graph",
      operations: [
        { action: "create_block", id: "canvas", fields: { kind: "ui", title: "Network canvas", summary: "Arrange project nodes without overlap", contract: "Selection focuses one stable graph" } },
        { action: "create_block", id: "router", fields: { kind: "service", title: "Project router", summary: "Isolate every project", contract: "Every call resolves an absolute project root" } },
        { action: "create_block", id: "database", fields: { kind: "database", title: "Local graph database", summary: "Store private project state", contract: "Runtime data lives inside ignored .mdflow" } },
        { action: "create_chain", id: "project-loop", fields: { title: "Project development loop", intent: "Read, modify and render one project" } },
        { action: "create_plan", id: "verify-project-loop", fields: { title: "Verify project loop", goal: "Prove scoped development", status: "active", nextAction: "Run the focused context checks" } },
      ],
    });
    context.service.mutate({
      reason: "Connect and reference the project loop",
      operations: [
        { action: "create_link", id: "router-database", fields: { sourceType: "block", sourceId: "router", targetType: "block", targetId: "database", kind: "writes", contract: "Only the selected project database is opened" } },
        { action: "create_link", id: "database-canvas", fields: { sourceType: "block", sourceId: "database", targetType: "block", targetId: "canvas", kind: "flows_to" } },
        { action: "set_chain_path", id: "project-loop", expectedRevision: 1, fields: { nodeIds: ["router", "database", "canvas"], linkIds: ["router-database", "database-canvas"] } },
        { action: "set_plan_chains", id: "verify-project-loop", expectedRevision: 1, fields: { chainIds: ["project-loop"] } },
      ],
    });
    const snapshot = context.service.snapshot();
    const chineseUI = context.service.contextForTask({ task: "adjust the network canvas layout", locale: "zh-Hans" });
    assert.ok(chineseUI.refs.includes("block:canvas"));
    assert.match(chineseUI.markdown, /Network canvas/);
    assert.doesNotMatch(chineseUI.markdown, /网络画布/);
    const focused = context.service.contextForTask({ task: "change the isolated project database routing", focusRefs: ["plan:verify-project-loop"] });
    assert.ok(focused.refs.includes("plan:verify-project-loop"));
    assert.ok(focused.refs.includes("chain:project-loop"));
    assert.ok(focused.markdown.length <= 12000);
    const fullGraphSize = JSON.stringify(snapshot).length;
    assert.ok(focused.markdown.length < fullGraphSize, `focused context ${focused.markdown.length} should be smaller than graph ${fullGraphSize}`);
    assert.equal(context.service.validate().valid, true);
  } finally {
    context.cleanup();
  }
});

test("ordered Plan workflow derives progress from dependencies, steps, and evidence gates", () => {
  const context = fixture();
  try {
    const created = context.service.mutate({
      reason: "Create an ordered delivery workflow",
      operations: [
        { action: "create_block", id: "api", fields: { kind: "service", title: "API" } },
        { action: "create_block", id: "ui", fields: { kind: "ui", title: "UI" } },
        { action: "create_link", id: "api-ui", fields: { sourceType: "block", sourceId: "api", targetType: "block", targetId: "ui", kind: "flows_to" } },
        { action: "create_chain", id: "delivery", fields: { title: "Delivery" } },
        { action: "create_plan", id: "foundation", fields: { title: "Foundation", status: "complete", phase: "foundation", planOrder: 1 } },
        { action: "create_plan", id: "ship", fields: { title: "Ship", status: "active", priority: "critical", phase: "delivery", planOrder: 9 } },
      ],
    });
    assert.equal(created.receipts.find((item) => item.id === "ship").uiLocation, "Project > Plans > plan:ship");
    assert.deepEqual(created.receipts.find((item) => item.id === "api").readBack, { ref: "block:api", revision: 1 });
    context.service.mutate({
      reason: "Bind the ordered workflow to the architecture",
      operations: [
        { action: "set_chain_path", id: "delivery", expectedRevision: 1, fields: { nodeIds: ["api", "ui"], linkIds: ["api-ui"] } },
        { action: "set_plan_chains", id: "ship", expectedRevision: 1, fields: { chainIds: ["delivery"] } },
      ],
    });
    context.service.mutate({
      reason: "Declare prerequisites",
      operations: [{ action: "set_plan_dependencies", id: "ship", expectedRevision: 2, fields: { planIds: ["foundation"] } }],
    });
    context.service.mutate({
      reason: "Declare ordered implementation steps",
      operations: [{ action: "set_plan_steps", id: "ship", expectedRevision: 3, fields: { steps: [
        { id: "ship-api", title: "Implement API", status: "complete", targetRefs: ["block:api"] },
        { id: "ship-ui", title: "Connect UI", status: "complete", targetRefs: ["block:ui", "chain:delivery"] },
      ] } }],
    });
    context.service.recordCheckpoint({
      id: "ship-real", targetType: "plan", targetId: "ship", title: "Real target acceptance",
      status: "pending", requiredEvidenceLevel: "real_target",
    });
    context.service.mutate({
      reason: "Gate completion on real target evidence",
      operations: [{ action: "set_plan_checkpoints", id: "ship", expectedRevision: 4, fields: { checkpoints: [
        { checkpointId: "ship-real", stepId: "ship-ui", required: true },
      ] } }],
    });
    let plan = context.service.snapshot().plans.find((item) => item.id === "ship");
    assert.equal(plan.derivedStatus, "verifying");
    assert.deepEqual(plan.progress, { completedSteps: 2, totalSteps: 2, passedRequiredCheckpoints: 0, totalRequiredCheckpoints: 1 });
    assert.throws(() => context.service.recordCheckpoint({
      id: "ship-real", expectedRevision: 1, targetType: "plan", targetId: "ship", title: "Real target acceptance",
      status: "passed", evidenceLevel: "integration", requiredEvidenceLevel: "real_target", evidence: [{ run: "integration" }],
    }), /requires real_target evidence/);
    context.service.recordCheckpoint({
      id: "ship-real", expectedRevision: 1, targetType: "plan", targetId: "ship", title: "Real target acceptance",
      status: "passed", evidenceLevel: "real_target", requiredEvidenceLevel: "real_target", evidence: [{ run: "production-like" }],
    });
    plan = context.service.snapshot().plans.find((item) => item.id === "ship");
    assert.equal(plan.derivedStatus, "complete");
    assert.deepEqual(plan.progress, { completedSteps: 2, totalSteps: 2, passedRequiredCheckpoints: 1, totalRequiredCheckpoints: 1 });
    const opened = context.service.entityOpen({ type: "plan", id: "ship" });
    assert.deepEqual(opened.dependencies, [{ planId: "foundation", position: 0 }]);
    assert.deepEqual(opened.steps.map((item) => item.id), ["ship-api", "ship-ui"]);
    assert.deepEqual(opened.checkpointRefs, [{ checkpointId: "ship-real", stepId: "ship-ui", position: 0, required: true }]);
    assert.match(opened.markdown, /real_target\/real_target/);
    const task = context.service.contextForTask({ task: "finish shipping", focusRefs: ["plan:ship"] });
    assert.match(task.markdown, /delivery #9/);
    assert.match(task.markdown, /2\/2 steps/);
    assert.match(context.service.projectMap().markdown, /delivery #9/);
    assert.equal(context.service.validate().valid, true);
  } finally {
    context.cleanup();
  }
});

test("Plan gates aggregate Block checkpoints even when the Block is outside every Chain", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create a plan and an unchained Block change",
      operations: [
        { action: "create_block", id: "standalone-api", fields: { kind: "service", title: "Standalone API" } },
        { action: "create_plan", id: "implement", fields: { title: "Implement architecture", status: "active" } },
      ],
    });
    context.service.recordCheckpoint({
      id: "standalone-api-check", targetType: "block", targetId: "standalone-api",
      title: "Standalone API is usable", status: "pending", requiredEvidenceLevel: "integration",
    });
    context.service.mutate({
      reason: "Associate the unchained Block with the Plan through a canonical change",
      operations: [{ action: "set_plan_changes", id: "implement", expectedRevision: 1, fields: { changes: [{
        id: "implement-standalone-api", entityType: "block", entityId: "standalone-api", position: 0,
        title: "Implement Standalone API", status: "complete",
      }] } }],
    });
    context.service.mutate({
      reason: "Bind the Block acceptance checkpoint to the Plan change",
      operations: [{ action: "set_checkpoint_bindings", id: "standalone-api-check", expectedRevision: 1, fields: { bindings: [{
        subjectType: "plan_change", subjectId: "implement-standalone-api", role: "acceptance", required: true,
      }] } }],
    });
    let plan = context.service.snapshot().plans.find((item) => item.id === "implement");
    assert.deepEqual(plan.progress, { completedSteps: 1, totalSteps: 1, passedRequiredCheckpoints: 0, totalRequiredCheckpoints: 1 });
    const planContext = context.service.planContext({ id: "implement" });
    assert.equal(planContext.directChanges.length, 1);
    assert.equal(planContext.directChanges[0].entityId, "standalone-api");
    assert.equal(planContext.directChanges[0].checkpoints[0].checkpoint.id, "standalone-api-check");
    assert.match(planContext.markdown, /Direct Block work/);
    assert.match(planContext.markdown, /Required checkpoint pending/);
    const coverage = context.service.projectMap().map.architecture.coverage;
    assert.equal(coverage.outsideChainIds.includes("standalone-api"), true);
    assert.equal(coverage.unplannedIds.includes("standalone-api"), false);
    assert.equal(context.service.validate().warnings.some((warning) => warning.includes("Plan has no target Chain")), false);
    context.service.recordCheckpoint({
      id: "standalone-api-check", expectedRevision: 2, targetType: "block", targetId: "standalone-api",
      title: "Standalone API is usable", status: "passed", evidenceLevel: "integration", requiredEvidenceLevel: "integration",
      evidence: [{ kind: "integration-test", result: "endpoint responded" }],
    });
    plan = context.service.snapshot().plans.find((item) => item.id === "implement");
    assert.deepEqual(plan.progress, { completedSteps: 1, totalSteps: 1, passedRequiredCheckpoints: 1, totalRequiredCheckpoints: 1 });
    assert.equal(plan.derivedStatus, "complete");
  } finally {
    context.cleanup();
  }
});

test("architecture coverage reports Blocks that have no checkpoint or Plan coverage", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Declare an unimplemented architecture Block",
      operations: [{ action: "create_block", id: "orphan-ui", fields: { kind: "ui", title: "Orphan UI", deliveryState: "proposed" } }],
    });
    const coverage = context.service.projectMap().map.architecture.coverage;
    assert.deepEqual(coverage.withoutCheckpointIds, ["orphan-ui"]);
    assert.deepEqual(coverage.unplannedIds, ["orphan-ui"]);
    const contextPack = context.service.contextForTask({ task: "implement the architecture" });
    assert.match(contextPack.markdown, /Missing checkpoints: block:orphan-ui/);
    assert.match(contextPack.markdown, /Unplanned: block:orphan-ui/);
    const warnings = context.service.validate().warnings;
    assert.ok(warnings.some((warning) => warning.includes("Block(s) have no checkpoint") && warning.includes("block:orphan-ui")));
    assert.ok(warnings.some((warning) => warning.includes("Block(s) are not covered by any Plan") && warning.includes("block:orphan-ui")));
  } finally {
    context.cleanup();
  }
});

test("architecture coverage requires exact Block work instead of broad target Chain references", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create a reusable path and a Plan that only points at it",
      operations: [
        { action: "create_block", id: "api", fields: { kind: "service", title: "API" } },
        { action: "create_block", id: "database", fields: { kind: "database", title: "Database" } },
        { action: "create_chain", id: "request-path", fields: { title: "Request path" } },
        { action: "create_link", id: "api-database", fields: { sourceType: "block", sourceId: "api", targetType: "block", targetId: "database", kind: "writes" } },
        { action: "create_plan", id: "implement-api", fields: { title: "Implement API" } },
      ],
    });
    context.service.mutate({
      reason: "Define the reusable path and broad Plan reference",
      operations: [
        { action: "set_chain_path", id: "request-path", expectedRevision: 1, fields: { nodeIds: ["api", "database"], linkIds: ["api-database"] } },
        { action: "set_plan_chains", id: "implement-api", expectedRevision: 1, fields: { chainIds: ["request-path"] } },
      ],
    });

    let coverage = context.service.projectMap().map.architecture.coverage;
    assert.deepEqual(coverage.unplannedIds.sort(), ["api", "database"]);

    context.service.mutate({
      reason: "Declare the exact Chain segment changed by the Plan",
      operations: [{
        action: "set_plan_chain_scopes", id: "implement-api", expectedRevision: 2,
        fields: { scopes: [{ id: "api-scope", chainId: "request-path", title: "Implement request persistence", nodeIds: ["api", "database"], linkIds: ["api-database"] }] },
      }],
    });
    coverage = context.service.projectMap().map.architecture.coverage;
    assert.deepEqual(coverage.unplannedIds, []);
    assert.equal(coverage.chainPlanBlocks, 2);
  } finally {
    context.cleanup();
  }
});

test("Plan dependency cycles and invalidated checkpoint evidence are rejected or reopened", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create dependent plans",
      operations: [
        { action: "create_plan", id: "first", fields: { title: "First" } },
        { action: "create_plan", id: "second", fields: { title: "Second" } },
      ],
    });
    context.service.mutate({
      reason: "Make the second plan wait for the first",
      operations: [{ action: "set_plan_dependencies", id: "second", expectedRevision: 1, fields: { planIds: ["first"] } }],
    });
    assert.throws(() => context.service.mutate({
      reason: "Attempt a dependency cycle",
      operations: [{ action: "set_plan_dependencies", id: "first", expectedRevision: 1, fields: { planIds: ["second"] } }],
    }), /must remain acyclic/);
    context.service.recordCheckpoint({
      id: "stale-proof", targetType: "plan", targetId: "second", title: "Stale proof",
      status: "retest_required", evidenceLevel: "integration", requiredEvidenceLevel: "integration",
      invalidatedAt: "2026-09-04T00:00:00.000Z",
    });
    context.service.mutate({
      reason: "Attach the invalidated gate",
      operations: [{ action: "set_plan_checkpoints", id: "second", expectedRevision: 2, fields: { checkpoints: [{ checkpointId: "stale-proof" }] } }],
    });
    const second = context.service.snapshot().plans.find((item) => item.id === "second");
    assert.equal(second.derivedStatus, "retest_required");
    assert.match(second.derivedReason, /run again/);
  } finally {
    context.cleanup();
  }
});

test("hierarchical Plan context preserves one canonical change across multiple Chain scopes", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create overlapping delivery paths",
      operations: [
        { action: "create_block", id: "api", fields: { kind: "service", title: "API", summary: "Accept requests" } },
        { action: "create_block", id: "core", fields: { kind: "function", title: "Core", summary: "Apply rules" } },
        { action: "create_block", id: "store", fields: { kind: "database", title: "Store", summary: "Persist state" } },
        { action: "create_chain", id: "request", fields: { title: "Request path" } },
        { action: "create_chain", id: "persistence", fields: { title: "Persistence path" } },
        { action: "create_link", id: "api-core", fields: { sourceType: "block", sourceId: "api", targetType: "block", targetId: "core", kind: "calls" } },
        { action: "create_link", id: "core-store", fields: { sourceType: "block", sourceId: "core", targetType: "block", targetId: "store", kind: "writes" } },
        { action: "create_plan", id: "refactor", fields: { title: "Refactor routing", summary: "Make writes deterministic", goal: "One explicit transaction path" } },
      ],
    });
    context.service.mutate({ reason: "Define paths", operations: [
      { action: "set_chain_path", id: "request", expectedRevision: 1, fields: { nodeIds: ["api", "core"], linkIds: ["api-core"] } },
      { action: "set_chain_path", id: "persistence", expectedRevision: 1, fields: { nodeIds: ["core", "store"], linkIds: ["core-store"] } },
    ] });
    context.service.mutate({ reason: "Describe affected Chain segments", operations: [{
      action: "set_plan_chain_scopes", id: "refactor", expectedRevision: 1, fields: { scopes: [
        { id: "request-scope", chainId: "request", title: "Validate before Core", nodeIds: ["api", "core"], linkIds: ["api-core"], rationale: "Reject invalid input early" },
        { id: "persistence-scope", chainId: "persistence", title: "Commit after Core", nodeIds: ["core", "store"], linkIds: ["core-store"], rationale: "Keep writes atomic" },
      ] },
    }] });
    context.service.mutate({ reason: "Describe exact entity changes", operations: [{
      action: "set_plan_changes", id: "refactor", expectedRevision: 2, fields: { changes: [
        { id: "change-core", entityType: "block", entityId: "core", title: "Centralize transaction", currentBehavior: "Each caller writes independently", proposedBehavior: "Core owns one transaction", rationale: "Avoid partial writes", prohibitions: ["Do not move validation into Store"], expectedEffects: ["Atomic persistence"], sourceRefs: ["src/core.ts:20"] },
        { id: "change-link", entityType: "link", entityId: "core-store", title: "Strengthen write contract", proposedBehavior: "Write only committed state" },
      ] },
    }] });
    context.service.mutate({ reason: "Reuse the Core change in both scopes", operations: [{
      action: "set_plan_chain_change_refs", id: "refactor", expectedRevision: 3, fields: { refs: [
        { chainScopeId: "request-scope", planChangeId: "change-core" },
        { chainScopeId: "persistence-scope", planChangeId: "change-core" },
        { chainScopeId: "persistence-scope", planChangeId: "change-link" },
      ] },
    }] });
    const snapshot = context.service.snapshot();
    assert.equal(snapshot.planChanges.filter((item) => item.entityId === "core").length, 1);
    assert.equal(snapshot.planChainChangeRefs.filter((item) => item.planChangeId === "change-core").length, 2);

    context.service.mutate({ reason: "Refresh canonical changes without dropping scope references", operations: [{
      action: "set_plan_changes", id: "refactor", expectedRevision: 4, fields: { changes: [
        { id: "change-core", entityType: "block", entityId: "core", title: "Centralize transaction", summary: "One transaction boundary", currentBehavior: "Each caller writes independently", proposedBehavior: "Core owns one transaction", rationale: "Avoid partial writes", prohibitions: ["Do not move validation into Store"], expectedEffects: ["Atomic persistence"], sourceRefs: ["src/core.ts:20"] },
        { id: "change-link", entityType: "link", entityId: "core-store", title: "Strengthen write contract", proposedBehavior: "Write only committed state" },
      ] },
    }] });
    assert.equal(context.service.snapshot().planChainChangeRefs.length, 3);

    const historyBaseline = context.service.snapshot().changeSequence;
    context.service.mutate({ reason: "Patch one canonical change", operations: [{
      action: "update_plan_change", id: "refactor", expectedRevision: 5,
      fields: { changeId: "change-core", patch: { summary: "Core owns the complete transaction boundary" } },
    }] });
    let patchedSnapshot = context.service.snapshot();
    assert.equal(patchedSnapshot.planChanges.find((item) => item.id === "change-core").summary, "Core owns the complete transaction boundary");
    assert.equal(patchedSnapshot.planChanges.find((item) => item.id === "change-core").currentRevision, 3);
    assert.equal(patchedSnapshot.planChainChangeRefs.length, 3);
    const incremental = context.service.changesSince({ sequence: historyBaseline });
    assert.deepEqual(incremental.changes[0].changedFields, ["summary"]);
    assert.equal(incremental.changes[0].before.summary, "One transaction boundary");
    assert.equal(incremental.changes[0].after.summary, "Core owns the complete transaction boundary");
    assert.ok(incremental.changes[0].affectedRefs.includes("plan_change:change-core"));

    context.service.mutate({ reason: "Patch one ChainScope without moving the camera target", operations: [{
      action: "update_plan_chain_scope", id: "refactor", expectedRevision: 6,
      fields: { scopeId: "request-scope", patch: { summary: "Validate request before transaction work" } },
    }] });
    patchedSnapshot = context.service.snapshot();
    assert.equal(patchedSnapshot.planChainScopes.find((item) => item.id === "request-scope").summary, "Validate request before transaction work");
    assert.equal(patchedSnapshot.planChainScopes.find((item) => item.id === "request-scope").currentRevision, 2);
    assert.equal(patchedSnapshot.planChainChangeRefs.length, 3);

    context.service.mutate({ reason: "Refresh scopes without dropping canonical change references", operations: [{
      action: "set_plan_chain_scopes", id: "refactor", expectedRevision: 7, fields: { scopes: [
        { id: "request-scope", chainId: "request", title: "Validate before Core", summary: "Keep request validation explicit", nodeIds: ["api", "core"], linkIds: ["api-core"], rationale: "Reject invalid input early" },
        { id: "persistence-scope", chainId: "persistence", title: "Commit after Core", nodeIds: ["core", "store"], linkIds: ["core-store"], rationale: "Keep writes atomic" },
      ] },
    }] });
    assert.equal(context.service.snapshot().planChainChangeRefs.length, 3);

    const opened = context.service.planContext({ id: "refactor", maxChars: 12000 });
    assert.equal(opened.hierarchy.length, 2);
    assert.equal(opened.hierarchy[0].changes[0].id, "change-core");
    assert.equal(opened.hierarchy[1].changes[0].id, "change-core");
    assert.match(opened.markdown, /Current: Each caller writes independently/);
    assert.match(opened.markdown, /Proposed: Core owns one transaction/);
    assert.match(opened.markdown, /src\/core\.ts:20/);
    assert.ok(opened.markdown.length <= 12000);
    assert.throws(() => context.service.mutate({ reason: "Reject an off-path segment", operations: [{
      action: "set_plan_chain_scopes", id: "refactor", expectedRevision: 8,
      fields: { scopes: [{ chainId: "request", title: "Wrong", nodeIds: ["store"] }] },
    }] }), /outside chain:request/);
  } finally {
    context.cleanup();
  }
});

test("checkpoint DAG derives aggregate state, keeps optional failures as warnings, and rejects cycles", () => {
  const context = fixture();
  try {
    context.service.mutate({ reason: "Create checkpoint targets", operations: [
      { action: "create_block", id: "worker", fields: { kind: "service", title: "Worker" } },
      { action: "create_plan", id: "ship", fields: { title: "Ship worker" } },
    ] });
    context.service.recordCheckpoint({ id: "static", targetType: "block", targetId: "worker", title: "Static checks", status: "pending" });
    context.service.recordCheckpoint({ id: "optional", targetType: "block", targetId: "worker", title: "Optional benchmark", status: "pending" });
    context.service.recordCheckpoint({ id: "gate", targetType: "plan", targetId: "ship", title: "Worker gate", status: "pending", checkpointKind: "aggregate" });
    context.service.mutate({ reason: "Build aggregate gate", operations: [{
      action: "set_checkpoint_dependencies", id: "gate", expectedRevision: 1,
      fields: { children: [{ checkpointId: "static" }, { checkpointId: "optional", required: false }] },
    }] });
    context.service.recordCheckpoint({ id: "static", expectedRevision: 1, targetType: "block", targetId: "worker", title: "Static checks", status: "passed", evidenceLevel: "static" });
    context.service.recordCheckpoint({ id: "optional", expectedRevision: 1, targetType: "block", targetId: "worker", title: "Optional benchmark", status: "failed" });
    let gate = context.service.snapshot().checkpoints.find((item) => item.id === "gate");
    assert.equal(gate.status, "passed");
    assert.deepEqual(gate.optionalWarnings, ["optional"]);
    assert.throws(() => context.service.recordCheckpoint({
      id: "gate", expectedRevision: 2, targetType: "plan", targetId: "ship", title: "Worker gate",
      status: "passed", checkpointKind: "aggregate",
    }), /cannot be recorded as passed/);
    assert.throws(() => context.service.mutate({ reason: "Create checkpoint cycle", operations: [{
      action: "set_checkpoint_dependencies", id: "static", expectedRevision: 2,
      fields: { children: [{ checkpointId: "gate" }] },
    }] }), /must remain acyclic/);
    context.service.mutate({ reason: "Bind the same proof to Plan and Block change", operations: [{
      action: "set_checkpoint_bindings", id: "static", expectedRevision: 2,
      fields: { bindings: [{ subjectType: "block", subjectId: "worker" }, { subjectType: "plan", subjectId: "ship", role: "shared" }] },
    }] });
    assert.equal(context.service.snapshot().checkpointBindings.length, 2);
  } finally {
    context.cleanup();
  }
});

test("changes_since returns compact incremental mutation receipts", () => {
  const context = fixture();
  try {
    const first = context.service.mutate({ reason: "Create one scoped Block", operations: [
      { action: "create_block", id: "one", fields: { kind: "service", title: "One" } },
      { action: "create_chain", id: "one-chain", fields: { title: "One chain" } },
      { action: "create_plan", id: "one-plan", fields: { title: "One plan" } },
    ] });
    context.service.mutate({ reason: "Define the scoped path", operations: [
      { action: "set_chain_path", id: "one-chain", expectedRevision: 1, fields: { nodeIds: ["one"], linkIds: [] } },
      { action: "set_plan_chain_scopes", id: "one-plan", expectedRevision: 1, fields: { scopes: [
        { id: "one-scope", chainId: "one-chain", title: "Change one", nodeIds: ["one"], linkIds: [] },
      ] } },
    ] });
    const baseline = context.service.snapshot().changeSequence;
    context.service.mutate({ reason: "Update one Block", planId: "one-plan", chainScopeId: "one-scope", operations: [
      { action: "update_block", id: "one", expectedRevision: 1, fields: { summary: "Changed" } },
    ] });
    const changes = context.service.changesSince({ sequence: baseline });
    assert.equal(first.receipts[0].uiLocation, "Canvas > block:one");
    assert.equal(changes.changes.length, 1);
    assert.equal(changes.changes[0].ref, "block:one");
    assert.equal(changes.changes[0].planId, "one-plan");
    assert.equal(changes.changes[0].chainScopeId, "one-scope");
    assert.equal(changes.changes[0].before.summary, "");
    assert.equal(changes.changes[0].after.summary, "Changed");
    assert.deepEqual(changes.changes[0].changedFields, ["summary"]);
    assert.ok(changes.changes[0].affectedRefs.includes("block:one"));
    assert.ok(changes.changes[0].affectedRefs.includes("plan:one-plan"));
    assert.equal(changes.nextSequence, baseline + 1);
    assert.throws(() => context.service.mutate({
      reason: "Reject a missing Plan history context", planId: "missing", operations: [
        { action: "update_block", id: "one", expectedRevision: 2, fields: { summary: "Nope" } },
      ],
    }), /plan:missing not found/);

    context.service.recordCheckpoint({
      id: "one-checkpoint", targetType: "block", targetId: "one", title: "Verify one",
      status: "pending", evidenceLevel: "none", requiredEvidenceLevel: "static",
      planId: "one-plan", chainScopeId: "one-scope",
    });
    const checkpointBaseline = context.service.snapshot().changeSequence;
    context.service.recordCheckpoint({
      id: "one-checkpoint", targetType: "block", targetId: "one", title: "Verify one",
      status: "passed", evidenceLevel: "integration", requiredEvidenceLevel: "static",
      evidence: [{ kind: "test", path: "test/one.test.mjs", result: "passed" }],
      expectedRevision: 1, planId: "one-plan", chainScopeId: "one-scope",
    });
    const checkpointChanges = context.service.changesSince({ sequence: checkpointBaseline });
    assert.equal(checkpointChanges.changes.length, 1);
    assert.equal(checkpointChanges.changes[0].planId, "one-plan");
    assert.equal(checkpointChanges.changes[0].chainScopeId, "one-scope");
    assert.deepEqual(checkpointChanges.changes[0].changedFields, ["status", "evidenceLevel", "evidence"]);
    assert.deepEqual(checkpointChanges.changes[0].evidenceRefs, ["test/one.test.mjs"]);
    assert.equal(checkpointChanges.changes[0].before.status, "pending");
    assert.equal(checkpointChanges.changes[0].after.status, "passed");
    assert.equal(checkpointChanges.hasMore, false);
    assert.equal(checkpointChanges.latestSequence, checkpointChanges.nextSequence);
  } finally {
    context.cleanup();
  }
});

test("changes_since paginates long sequences without losing the resume cursor", () => {
  const context = fixture();
  try {
    context.service.mutate({ reason: "Create long-sequence probe", operations: [
      { action: "create_block", id: "long-sequence", fields: { kind: "test", title: "Long sequence" } },
    ] });
    const baseline = context.service.snapshot().changeSequence;
    for (let index = 0; index < 505; index += 1) {
      context.service.mutate({ reason: `Long sequence mutation ${index + 1}`, operations: [{
        action: "update_block", id: "long-sequence", expectedRevision: index + 1,
        fields: { summary: `mutation-${index + 1}` },
      }] });
    }
    const firstPage = context.service.changesSince({ sequence: baseline, limit: 500 });
    assert.equal(firstPage.changes.length, 500);
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.changes[0].sequence, baseline + 1);
    assert.equal(firstPage.changes.at(-1).sequence, baseline + 500);
    assert.equal(firstPage.nextSequence, baseline + 500);
    assert.equal(firstPage.latestSequence, baseline + 505);
    const secondPage = context.service.changesSince({ sequence: firstPage.nextSequence, limit: 500 });
    assert.equal(secondPage.changes.length, 5);
    assert.equal(secondPage.hasMore, false);
    assert.equal(secondPage.changes[0].sequence, baseline + 501);
    assert.equal(secondPage.changes.at(-1).sequence, baseline + 505);
    assert.equal(secondPage.nextSequence, secondPage.latestSequence);
  } finally {
    context.cleanup();
  }
});

test("change_set_revert creates a reverse audit trail and refuses stale work", () => {
  const context = fixture();
  try {
    context.service.mutate({ reason: "Create revert probe", operations: [
      { action: "create_block", id: "revert-probe", fields: { kind: "service", title: "Revert probe", summary: "Before" } },
    ] });
    const changed = context.service.mutate({ reason: "Change revert probe", operations: [
      { action: "update_block", id: "revert-probe", expectedRevision: 1, fields: { summary: "After" } },
    ] });
    const reversed = context.service.revertChangeSet({ changeSetId: changed.changeSetId, reason: "Undo probe" });
    assert.equal(reversed.receipts[0].action, "updated");
    assert.equal(context.service.snapshot().blocks.find((item) => item.id === "revert-probe").summary, "Before");
    const changes = context.service.changesSince({ sequence: 1 });
    assert.equal(changes.changes.length, 2);
    assert.equal(changes.changes.at(-1).before.summary, "After");
    assert.equal(changes.changes.at(-1).after.summary, "Before");

    const second = context.service.mutate({ reason: "Change after revert", operations: [
      { action: "update_block", id: "revert-probe", expectedRevision: 3, fields: { summary: "Newer" } },
    ] });
    assert.throws(() => context.service.revertChangeSet({ changeSetId: changed.changeSetId, reason: "Reject stale undo" }), /stale/);
    assert.equal(context.service.snapshot().blocks.find((item) => item.id === "revert-probe").summary, "Newer");
    assert.notEqual(second.changeSetId, reversed.changeSetId);
  } finally {
    context.cleanup();
  }
});

test("change_set_revert reverses repeated updates in one ChangeSet in history order", () => {
  const context = fixture();
  try {
    context.service.mutate({ reason: "Create repeated-update probe", operations: [
      { action: "create_block", id: "repeated-probe", fields: { kind: "service", title: "Repeated probe", summary: "Initial" } },
    ] });
    const changed = context.service.mutate({ reason: "Apply two dependent updates atomically", operations: [
      { action: "update_block", id: "repeated-probe", expectedRevision: 1, fields: { summary: "First" } },
      { action: "update_block", id: "repeated-probe", expectedRevision: 2, fields: { summary: "Second" } },
    ] });
    const reversed = context.service.revertChangeSet({ changeSetId: changed.changeSetId, reason: "Undo repeated updates" });
    assert.equal(reversed.receipts.length, 2);
    assert.equal(context.service.snapshot().blocks.find((item) => item.id === "repeated-probe").summary, "Initial");
  } finally {
    context.cleanup();
  }
});
