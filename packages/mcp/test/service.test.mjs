import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createService } from "../src/service.mjs";

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

test("localized fields are stored and Chinese tasks retrieve the same semantic graph", () => {
  const context = fixture();
  try {
    context.service.mutate({
      reason: "Create bilingual block",
      operations: [{
        action: "create_block", id: "canvas", fields: {
          kind: "ui", title: "Zoomable canvas", summary: "Scale and pan the graph",
          localizations: { "zh-Hans": { title: "可缩放画布", summary: "缩放和平移项目图" } },
        },
      }],
    });
    const result = context.service.contextForTask({ task: "调整画布缩放", locale: "zh-Hans" });
    assert.match(result.markdown, /可缩放画布/);
    assert.ok(result.refs.includes("block:canvas"));
    assert.equal(context.service.search({ query: "画布", locale: "zh-Hans" }).results[0].title, "可缩放画布");
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

test("updating canonical content removes untranslated stale localized facts", () => {
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
    assert.match(opened.markdown, /Run new check/);
    assert.doesNotMatch(opened.markdown, /运行旧检查/);
    assert.match(opened.markdown, /# 发布/);
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
        { action: "create_block", id: "canvas", fields: { kind: "ui", title: "Network canvas", summary: "Arrange project nodes without overlap", contract: "Selection focuses one stable graph", localizations: { "zh-Hans": { title: "网络画布", summary: "无重叠地排布项目节点" } } } },
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
    const chinese = context.service.contextForTask({ task: "调整网络画布排布", locale: "zh-Hans" });
    assert.ok(chinese.refs.includes("block:canvas"));
    assert.match(chinese.markdown, /网络画布/);
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
    const opened = context.service.planContext({ id: "refactor", maxChars: 12000 });
    assert.equal(opened.hierarchy.length, 2);
    assert.equal(opened.hierarchy[0].changes[0].id, "change-core");
    assert.equal(opened.hierarchy[1].changes[0].id, "change-core");
    assert.match(opened.markdown, /Current: Each caller writes independently/);
    assert.match(opened.markdown, /Proposed: Core owns one transaction/);
    assert.match(opened.markdown, /src\/core\.ts:20/);
    assert.ok(opened.markdown.length <= 12000);
    assert.throws(() => context.service.mutate({ reason: "Reject an off-path segment", operations: [{
      action: "set_plan_chain_scopes", id: "refactor", expectedRevision: 4,
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
    const first = context.service.mutate({ reason: "Create one Block", operations: [
      { action: "create_block", id: "one", fields: { kind: "service", title: "One" } },
    ] });
    const baseline = context.service.snapshot().changeSequence;
    context.service.mutate({ reason: "Update one Block", operations: [
      { action: "update_block", id: "one", expectedRevision: 1, fields: { summary: "Changed" } },
    ] });
    const changes = context.service.changesSince({ sequence: baseline });
    assert.equal(first.receipts[0].uiLocation, "Canvas > block:one");
    assert.equal(changes.changes.length, 1);
    assert.equal(changes.changes[0].ref, "block:one");
    assert.equal(changes.nextSequence, baseline + 1);
  } finally {
    context.cleanup();
  }
});
