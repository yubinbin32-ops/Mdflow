import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createService } from "../src/service.mjs";
import { populateDesignGraph } from "../src/design-graph.mjs";

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

test("mutations are atomic and visible through the change feed", () => {
  const context = fixture();
  try {
    const first = context.service.mutate({
      reason: "Create live slice",
      operations: [
        {
          action: "create_block",
          id: "viewer",
          fields: {
            kind: "ui",
            title: "Viewer",
            summary: "Render changes live",
            deliveryState: "implementing",
          },
        },
        {
          action: "create_chain",
          id: "live-plan",
          fields: { title: "Live plan", purpose: "plan" },
        },
      ],
    });
    assert.equal(first.graphRevision, 1);
    assert.equal(first.receipts.length, 2);

    const second = context.service.mutate({
      reason: "Compose plan",
      operations: [
        {
          action: "set_chain_members",
          id: "live-plan",
          expectedRevision: 1,
          members: [{ type: "block", id: "viewer" }],
        },
      ],
    });
    const snapshot = context.service.snapshot();
    assert.equal(second.graphRevision, 2);
    assert.equal(snapshot.changeSequence, 3);
    assert.deepEqual(snapshot.members[0], {
      chainId: "live-plan",
      memberType: "block",
      memberId: "viewer",
      position: 0,
    });
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
    assert.doesNotMatch(contextPack.markdown, /Billing/);
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

test("design graph replaces broad prose with bounded golden task contexts", () => {
  const context = fixture();
  try {
    const snapshot = populateDesignGraph(context.service);
    assert.ok(snapshot.blocks.length >= 30);
    assert.ok(snapshot.chains.length >= 8);
    assert.equal(context.service.validate().valid, true);
    const cases = [
      ["修改画布缩放和视图", "block:zoom-pan-canvas"],
      ["MCP mutation revision change feed", "block:atomic-mutation"],
      ["Codex plugin installation", "chain:plugin-delivery-chain"],
      ["添加中英文双语检索", "block:bilingual-retrieval"],
    ];
    for (const [task, expectedRef] of cases) {
      const result = context.service.contextForTask({ task, locale: task.includes("文") ? "zh-Hans" : "en" });
      assert.ok(result.refs.includes(expectedRef), `${task} should include ${expectedRef}`);
      assert.ok(result.markdown.length <= 12000);
    }
  } finally {
    context.cleanup();
  }
});
