import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProjectServiceRouter } from "../src/project-router.mjs";
import { beginTask, synchronizeTaskNetwork } from "../src/reconciliation.mjs";

test("block_code_stream returns only the requested AST symbol slice", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "contextos-slice-test-"));
  const router = new ProjectServiceRouter();
  router.register({ projectRoot: tmpDir, name: "slice-test" });
  const service = router.serviceFor({ projectRoot: tmpDir });
  await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
  await fs.writeFile(path.join(tmpDir, "src/example.js"), [
    "export function first() { return 'first'; }",
    "export function second() { return 'second'; }",
  ].join("\n"));
  service.mutate({ reason: "Create AST slice fixture", operations: [
    { action: "create_block", id: "first", fields: { title: "First", kind: "function", architectureLayer: "application", scope: "core" } },
    { action: "add_source_ref", id: "first", fields: { path: "src/example.js", symbol: "first", role: "implementation" } },
  ] });
  const result = service.blockCodeStream({ blockId: "first", mode: "slice", maxLines: 20 });
  assert.match(result.codeStream, /return 'first'/);
  assert.doesNotMatch(result.codeStream, /return 'second'/);
  assert.equal(result.node.filePath, "src/example.js");
  assert.equal(result.node.symbol, "first");
  // A repository index pass shares the file cache with binding reads. The
  // binding must stay readable after that boundary so a real task can move
  // from context retrieval to an AST slice without reopening the whole file.
  service.contextForTask({ task: "read the first function", maxChars: 1200 });
  const afterContext = service.blockCodeStream({ blockId: "first", mode: "slice", maxLines: 20 });
  assert.equal(afterContext.node.sourceStatus, "anchored");
  assert.match(afterContext.codeStream, /return 'first'/);
  router.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("plan and chain append operations preserve existing paths and changes", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "contextos-append-test-"));
  const router = new ProjectServiceRouter();
  router.register({ projectRoot: tmpDir, name: "append-test" });
  const service = router.serviceFor({ projectRoot: tmpDir });
  service.mutate({ reason: "Create append fixture", operations: [
    { action: "create_block", id: "a", fields: { title: "A", kind: "service", architectureLayer: "application", scope: "core" } },
    { action: "create_block", id: "b", fields: { title: "B", kind: "service", architectureLayer: "application", scope: "core" } },
    { action: "create_link", id: "a-to-b", fields: { sourceType: "block", sourceId: "a", targetType: "block", targetId: "b", kind: "calls", label: "A calls B", contract: "A -> B" } },
    { action: "create_chain", id: "chain-ab", fields: { title: "AB", intent: "A to B", deliveryState: "planned" } },
    { action: "create_plan", id: "plan-ab", fields: { title: "AB Plan", status: "active" } },
  ] });
  const chainResult = service.appendChainPath({ chainId: "chain-ab", expectedRevision: 1, nodeIds: ["a", "b"], linkIds: ["a-to-b"] });
  assert.equal(chainResult.receipts[0].action, "path-appended");
  assert.deepEqual(service.snapshot().chainNodes.filter((item) => item.chainId === "chain-ab").map((item) => item.blockId), ["a", "b"]);
  const planResult = service.appendPlanChanges({
    planId: "plan-ab",
    expectedRevision: 1,
    changes: [{ entityType: "block", entityId: "b", title: "Implement B", status: "pending" }],
  });
  assert.equal(planResult.receipts[0].action, "changes-appended");
  assert.equal(service.snapshot().planChanges.filter((item) => item.planId === "plan-ab").length, 1);
  const updatedPlan = service.updatePlanChanges({
    planId: "plan-ab",
    expectedRevision: 2,
    updates: [{ changeId: "plan-ab-change-block-b", patch: { status: "complete" } }],
  });
  assert.equal(updatedPlan.receipts[0].action, "plan-changes-updated");
  assert.equal(service.snapshot().planChanges.find((item) => item.planId === "plan-ab")?.status, "complete");
  assert.throws(
    () => service.appendPlanChanges({ planId: "plan-ab", expectedRevision: 3, changes: [{ entityType: "block", entityId: "b", title: "Duplicate B" }] }),
    /canonical change/,
  );
  const started = beginTask(service, { intent: "Continue B", blockIds: ["a"], planId: "plan-ab", standaloneReason: "Plan coverage fixture" });
  assert.equal(started.planCoverage.changed, true);
  assert.equal(service.snapshot().planChanges.filter((item) => item.planId === "plan-ab").length, 2);
  assert.equal(JSON.parse(service.database.prepare("SELECT scope_json FROM task_sessions WHERE id = ?").get(started.taskId).scope_json).planId, "plan-ab");
  router.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("task network reconciliation appends an explicitly linked Block", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "contextos-network-test-"));
  const router = new ProjectServiceRouter();
  router.register({ projectRoot: tmpDir, name: "network-test" });
  const service = router.serviceFor({ projectRoot: tmpDir });
  service.mutate({ reason: "Create network fixture", operations: [
    { action: "create_block", id: "root", fields: { title: "Root", kind: "service", architectureLayer: "application", scope: "core" } },
    { action: "create_block", id: "leaf", fields: { title: "Leaf", kind: "service", architectureLayer: "application", scope: "core" } },
    { action: "create_link", id: "root-to-leaf", fields: { sourceType: "block", sourceId: "root", targetType: "block", targetId: "leaf", kind: "calls", contract: "Root -> Leaf" } },
    { action: "create_chain", id: "feature-chain", fields: { title: "Feature", intent: "Root to Leaf", inputContract: "input", outputContract: "output", deliveryState: "planned" } },
    { action: "set_chain_path", id: "feature-chain", expectedRevision: 1, fields: { nodeIds: ["root"], linkIds: [] } },
  ] });
  const result = synchronizeTaskNetwork(service, { chainId: "feature-chain", blockIds: ["root", "leaf"] });
  assert.equal(result.changed, true);
  assert.deepEqual(result.appendedNodeIds, ["leaf"]);
  assert.deepEqual(service.snapshot().chainNodes.filter((item) => item.chainId === "feature-chain").map((item) => item.blockId), ["root", "leaf"]);
  assert.deepEqual(service.snapshot().chainEdges.filter((item) => item.chainId === "feature-chain").map((item) => item.linkId), ["root-to-leaf"]);
  router.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("context boundary advances a bound ghost Block without marking it complete", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "contextos-ghost-test-"));
  const router = new ProjectServiceRouter();
  router.register({ projectRoot: tmpDir, name: "ghost-test" });
  const service = router.serviceFor({ projectRoot: tmpDir });
  await fs.writeFile(path.join(tmpDir, "worker.js"), "export function work() { return 42; }\n");
  service.mutate({ reason: "Create ghost fixture", operations: [
    { action: "create_block", id: "worker", fields: { title: "Worker", kind: "function", architectureLayer: "application", scope: "core", deliveryState: "planned" } },
    { action: "add_source_ref", id: "worker", expectedRevision: 1, fields: { path: "worker.js", symbol: "work", role: "implementation" } },
  ] });
  const context = service.contextForTask({ task: "run worker", maxChars: 4000 });
  assert.deepEqual(context.autoReconciliation.advancedBlockIds, ["worker"]);
  const block = service.snapshot().blocks.find((item) => item.id === "worker");
  assert.equal(block.deliveryState, "implementing");
  assert.notEqual(block.deliveryState, "complete");
  router.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});
