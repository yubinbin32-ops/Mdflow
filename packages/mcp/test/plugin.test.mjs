import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { registerProject, resolveProjectPaths } from "../src/paths.mjs";
import { ProjectServiceRouter } from "../src/project-router.mjs";
import { createService } from "../src/service.mjs";

test("registered projects version the canonical graph but ignore SQLite sidecars", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-local-data-"));
  try {
    const first = registerProject({ projectRoot: root, id: "local-data", name: "Local Data" });
    const second = registerProject({ projectRoot: root });
    const paths = resolveProjectPaths({ projectRoot: root });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(paths.databasePath, path.join(root, ".mdflow", "mdflow.sqlite"));
    assert.equal(
      fs.readFileSync(path.join(root, ".mdflow", ".gitignore"), "utf8"),
      "*\n!.gitignore\n!project.json\n!mdflow.sqlite\nmdflow.sqlite-wal\nmdflow.sqlite-shm\nmdflow.sqlite-journal\n",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("project router reopens a cached MCP service after SQLite checkout replacement", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-router-reopen-"));
  const replacementRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-router-replacement-"));
  const descriptor = { id: "router-reopen", name: "Router Reopen", schemaVersion: 1 };
  const writeProject = (projectRoot) => {
    fs.mkdirSync(path.join(projectRoot, ".mdflow"));
    fs.writeFileSync(path.join(projectRoot, ".mdflow", "project.json"), `${JSON.stringify(descriptor)}\n`);
  };
  writeProject(root);
  writeProject(replacementRoot);
  const router = new ProjectServiceRouter();
  let replacementService;
  try {
    const first = router.serviceFor({ projectRoot: root });
    first.mutate({
      reason: "Seed the original cached service",
      operations: [{ action: "create_block", id: "before-checkout", fields: { kind: "service", title: "Before checkout" } }],
    });

    fs.copyFileSync(path.join(root, ".mdflow", "mdflow.sqlite"), path.join(replacementRoot, ".mdflow", "mdflow.sqlite"));
    replacementService = createService({ projectRoot: replacementRoot });
    replacementService.mutate({
      reason: "Prepare the checked-out graph",
      operations: [{ action: "create_block", id: "after-checkout", fields: { kind: "service", title: "After checkout" } }],
    });
    replacementService.close();
    replacementService = undefined;

    const staged = path.join(root, ".mdflow", "mdflow.sqlite.replacement");
    fs.copyFileSync(path.join(replacementRoot, ".mdflow", "mdflow.sqlite"), staged);
    fs.renameSync(staged, path.join(root, ".mdflow", "mdflow.sqlite"));

    const reopened = router.serviceFor({ projectRoot: root });
    assert.notEqual(reopened, first);
    const ids = reopened.snapshot().blocks.map((block) => block.id).sort();
    assert.deepEqual(ids, ["after-checkout", "before-checkout"]);
  } finally {
    replacementService?.close();
    router.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(replacementRoot, { recursive: true, force: true });
  }
});

test("bundled plugin starts and exposes the mdflow tools", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-plugin-project-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-plugin-data-"));
  fs.mkdirSync(path.join(root, ".mdflow"));
  fs.writeFileSync(
    path.join(root, ".mdflow", "project.json"),
    JSON.stringify({ id: "plugin-test", name: "Plugin Test", schemaVersion: 1 }),
  );
  const currentFile = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(currentFile), "../../..");
  const bundle = path.join(repositoryRoot, "plugins/mdflow/server/mdflow-mcp.mjs");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--no-warnings=ExperimentalWarning", bundle],
    env: { MDFLOW_PROJECT_ROOT: root, MDFLOW_DATA_DIR: dataRoot },
    stderr: "pipe",
  });
  const client = new Client({ name: "mdflow-test", version: "0.1.0" });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        "change_set_revert",
        "changes_since",
        "checkpoint_list",
        "checkpoint_record",
        "context_for_task",
        "decision_list",
        "decision_open",
        "entity_open",
        "foundation_plan_create",
        "graph_mutate",
        "graph_patch",
        "graph_search",
        "graph_validate",
        "plan_context",
        "project_map",
        "project_register",
      ],
    );
    const response = await client.callTool({ name: "project_map", arguments: {} });
    assert.equal(response.isError, undefined);
    assert.match(response.content[0].text, /Plugin Test/);
    assert.equal(response.structuredContent, undefined);

    const create = await client.callTool({
      name: "graph_mutate",
      arguments: {
        reason: "Exercise the packaged MCP write path",
        operations: [
          { action: "create_block", id: "source", fields: { kind: "service", title: "Source", summary: "Produces committed changes" } },
          { action: "create_block", id: "canvas", fields: { kind: "ui", title: "Canvas", summary: "Renders the project network" } },
          { action: "create_chain", id: "live-path", fields: { title: "Live path", purpose: "architecture", intent: "Carry changes to the Canvas" } },
          { action: "create_plan", id: "verify-live-path", fields: { title: "Verify live path", goal: "Prove the packaged MCP workflow", status: "active", nextAction: "Record the end-to-end checkpoint" } },
          { action: "create_decision", id: "packaged-decision", fields: { title: "Packaged Decision", summary: "Keep architecture memory outside Canvas", rationale: "Decisions need scoped, on-demand context.", scopes: [{ type: "project", value: "*" }] } },
          { action: "create_link", id: "source-canvas", fields: { sourceType: "block", sourceId: "source", targetType: "block", targetId: "canvas", kind: "writes", contract: "Only committed revisions are rendered" } },
          { action: "create_checkpoint", id: "source-proof", fields: { targetType: "block", targetId: "source", title: "Source is usable", status: "pending", checkpointKind: "atomic", requiredEvidenceLevel: "static" } },
        ],
      },
    });
    assert.equal(create.isError, undefined);
    assert.equal(create.structuredContent, undefined);

    const decisionIndex = await client.callTool({ name: "decision_list", arguments: {} });
    assert.equal(decisionIndex.isError, undefined);
    assert.equal(decisionIndex.structuredContent, undefined);
    assert.match(decisionIndex.content[0].text, /packaged-decision/);
    const decision = await client.callTool({ name: "decision_open", arguments: { id: "packaged-decision" } });
    assert.equal(decision.isError, undefined);
    assert.equal(decision.structuredContent, undefined);
    assert.match(decision.content[0].text, /Decisions need scoped/);

    const compactPatch = await client.callTool({
      name: "graph_patch",
      arguments: {
        patch: "mdflow/1 reason=\"Exercise compact Markdown-like writes\"\nupdate block:canvas\nsummary=\"Renders the project network compactly\"",
      },
    });
    assert.equal(compactPatch.isError, undefined);
    assert.equal(compactPatch.structuredContent, undefined);
    assert.match(compactPatch.content[0].text, /# Graph patch/);
    assert.match(compactPatch.content[0].text, /updated block:canvas/);

    const compose = await client.callTool({
      name: "graph_mutate",
      arguments: {
        reason: "Compose explicit references",
        operations: [
          { action: "set_chain_path", id: "live-path", expectedRevision: 1, fields: { nodeIds: ["source", "canvas"], linkIds: ["source-canvas"] } },
          { action: "set_plan_chains", id: "verify-live-path", expectedRevision: 1, fields: { chainIds: ["live-path"] } },
          { action: "set_checkpoint_bindings", id: "source-proof", expectedRevision: 1, fields: { bindings: [{ subjectType: "plan", subjectId: "verify-live-path", role: "acceptance", required: true }] } },
        ],
      },
    });
    assert.equal(compose.isError, undefined);
    assert.equal(compose.structuredContent, undefined);

    const checkpoint = await client.callTool({
      name: "checkpoint_record",
      arguments: {
        id: "packaged-mcp-proof", targetType: "plan", targetId: "verify-live-path",
        title: "Packaged MCP round trip", status: "passed",
        evidence: [{ kind: "automated-test", result: "graph write, context read, and validation passed" }],
      },
    });
    assert.equal(checkpoint.isError, undefined);
    assert.equal(checkpoint.structuredContent, undefined);
    const checkpointIndex = await client.callTool({ name: "checkpoint_list", arguments: { unassignedOnly: true } });
    assert.equal(checkpointIndex.isError, undefined);
    assert.equal(checkpointIndex.structuredContent, undefined);
    const checkpointIndexStructured = await client.callTool({ name: "checkpoint_list", arguments: { unassignedOnly: true, includeStructured: true } });
    assert.equal(checkpointIndexStructured.structuredContent.count, 0);

    const foundation = await client.callTool({
      name: "foundation_plan_create",
      arguments: { id: "foundation-receipt", title: "Foundation receipt" },
    });
    assert.equal(foundation.isError, undefined);
    assert.match(foundation.content[0].text, /Generated plan:foundation-receipt/);
    assert.equal(foundation.structuredContent, undefined);

    const contextPack = await client.callTool({
      name: "context_for_task",
      arguments: { task: "verify the live canvas path", focusRefs: ["plan:verify-live-path"] },
    });
    assert.equal(contextPack.isError, undefined);
    assert.match(contextPack.content[0].text, /Verify live path/);
    assert.match(contextPack.content[0].text, /Live path/);
    assert.equal(contextPack.structuredContent, undefined);
    const contextPackStructured = await client.callTool({
      name: "context_for_task",
      arguments: { task: "verify the live canvas path", focusRefs: ["plan:verify-live-path"], includeStructured: true },
    });
    assert.equal(typeof contextPackStructured.structuredContent.graphRevision, "number");

    const planPack = await client.callTool({
      name: "plan_context",
      arguments: { id: "verify-live-path" },
    });
    assert.equal(planPack.isError, undefined);
    assert.match(planPack.content[0].text, /Verify live path/);
    assert.equal(planPack.structuredContent, undefined);

    const fullPlanPack = await client.callTool({
      name: "plan_context",
      arguments: { id: "verify-live-path", includeStructured: true },
    });
    assert.equal(typeof fullPlanPack.structuredContent.markdown, "string");

    const opened = await client.callTool({
      name: "entity_open",
      arguments: { type: "plan", id: "verify-live-path" },
    });
    assert.equal(opened.isError, undefined);
    assert.match(opened.content[0].text, /Record the end-to-end checkpoint/);
    assert.match(opened.content[0].text, /Packaged MCP round trip/);
    assert.equal(opened.structuredContent, undefined);
    const openedStructured = await client.callTool({
      name: "entity_open",
      arguments: { type: "plan", id: "verify-live-path", includeStructured: true },
    });
    assert.equal(typeof openedStructured.structuredContent.markdown, "string");

    const changed = await client.callTool({
      name: "graph_mutate",
      arguments: {
        reason: "Exercise packaged rollback",
        includeStructured: true,
        operations: [{ action: "update_block", id: "source", expectedRevision: 1, fields: { summary: "Temporarily changed" } }],
      },
    });
    assert.equal(changed.isError, undefined);
    const reverted = await client.callTool({
      name: "change_set_revert",
      arguments: { changeSetId: changed.structuredContent.changeSetId, reason: "Undo packaged rollback probe", includeStructured: true },
    });
    assert.equal(reverted.isError, undefined);
    const afterRevert = await client.callTool({ name: "entity_open", arguments: { type: "block", id: "source" } });
    assert.equal(afterRevert.isError, undefined);
    assert.match(afterRevert.content[0].text, /Produces committed changes/);

    const validation = await client.callTool({ name: "graph_validate", arguments: {} });
    assert.equal(validation.isError, undefined);
    assert.equal(validation.structuredContent, undefined);
    assert.match(validation.content[0].text, /# Graph validation/);
    const validationStructured = await client.callTool({ name: "graph_validate", arguments: { includeStructured: true } });
    assert.equal(validationStructured.structuredContent.valid, true);
    assert.deepEqual(validationStructured.structuredContent.errors, []);

    const changes = await client.callTool({ name: "changes_since", arguments: { sequence: 0 } });
    assert.equal(changes.isError, undefined);
    assert.equal(changes.structuredContent, undefined);
    assert.match(changes.content[0].text, /Changes since sequence 0/);
    const changesStructured = await client.callTool({ name: "changes_since", arguments: { sequence: 0, includeStructured: true } });
    assert.equal(Array.isArray(changesStructured.structuredContent.changes), true);

    const search = await client.callTool({ name: "graph_search", arguments: { query: "Canvas" } });
    assert.equal(search.isError, undefined);
    assert.equal(search.structuredContent, undefined);
    assert.match(search.content[0].text, /Search: Canvas/);
    const searchStructured = await client.callTool({ name: "graph_search", arguments: { query: "Canvas", includeStructured: true } });
    assert.equal(Array.isArray(searchStructured.structuredContent.results), true);
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("bundled plugin registers and isolates multiple projects in one Codex connection", async () => {
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-plugin-first-"));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-plugin-second-"));
  const invalidRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-plugin-invalid-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-plugin-multi-data-"));
  const currentFile = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(currentFile), "../../..");
  const bundle = path.join(repositoryRoot, "plugins/mdflow/server/mdflow-mcp.mjs");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--no-warnings=ExperimentalWarning", bundle],
    env: { MDFLOW_DATA_DIR: dataRoot },
    stderr: "pipe",
  });
  const client = new Client({ name: "mdflow-multi-project-test", version: "0.1.0" });

  try {
    await client.connect(transport);
    for (const project of [
      { projectRoot: firstRoot, id: "first-project", name: "First Project" },
      { projectRoot: secondRoot, id: "second-project", name: "Second Project" },
    ]) {
      const registered = await client.callTool({ name: "project_register", arguments: project });
      assert.equal(registered.isError, undefined);
      assert.equal(registered.structuredContent, undefined);
    }

    for (const [projectRoot, title] of [[firstRoot, "First architecture"], [secondRoot, "Second architecture"]]) {
      const mutation = await client.callTool({
        name: "graph_mutate",
        arguments: {
          projectRoot,
          reason: "Prove project-scoped writes",
          operations: [{ action: "create_block", id: "architecture", fields: { kind: "product", title } }],
        },
      });
      assert.equal(mutation.isError, undefined);
      assert.equal(mutation.structuredContent, undefined);
    }

    const firstMap = await client.callTool({ name: "project_map", arguments: { projectRoot: firstRoot } });
    const secondMap = await client.callTool({ name: "project_map", arguments: { projectRoot: secondRoot } });
    assert.equal(firstMap.structuredContent, undefined);
    assert.equal(secondMap.structuredContent, undefined);
    assert.match(firstMap.content[0].text, /First Project/);
    assert.match(secondMap.content[0].text, /Second Project/);
    const firstMapStructured = await client.callTool({ name: "project_map", arguments: { projectRoot: firstRoot, includeStructured: true } });
    const secondMapStructured = await client.callTool({ name: "project_map", arguments: { projectRoot: secondRoot, includeStructured: true } });
    assert.equal(firstMapStructured.structuredContent.map.project.id, "first-project");
    assert.equal(secondMapStructured.structuredContent.map.project.id, "second-project");
    assert.equal(firstMapStructured.structuredContent.map.counts.blocks, 1);
    assert.equal(secondMapStructured.structuredContent.map.counts.blocks, 1);
    assert.equal(firstMapStructured.structuredContent.map.criticalBlocks.length, 0);
    assert.equal(secondMapStructured.structuredContent.map.criticalBlocks.length, 0);

    const inherited = await client.callTool({ name: "entity_open", arguments: { type: "block", id: "architecture" } });
    assert.equal(inherited.isError, undefined);
    assert.match(inherited.content[0].text, /Second architecture/);

    const switched = await client.callTool({ name: "entity_open", arguments: { projectRoot: firstRoot, type: "block", id: "architecture" } });
    assert.equal(switched.isError, undefined);
    assert.match(switched.content[0].text, /First architecture/);

    const inheritedAfterSwitch = await client.callTool({ name: "entity_open", arguments: { type: "block", id: "architecture" } });
    assert.equal(inheritedAfterSwitch.isError, undefined);
    assert.match(inheritedAfterSwitch.content[0].text, /First architecture/);

    const invalid = await client.callTool({ name: "project_map", arguments: { projectRoot: invalidRoot } });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /No \.mdflow\/project\.json found/);
  } finally {
    await client.close();
    fs.rmSync(firstRoot, { recursive: true, force: true });
    fs.rmSync(secondRoot, { recursive: true, force: true });
    fs.rmSync(invalidRoot, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
