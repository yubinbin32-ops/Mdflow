import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { registerProject, resolveProjectPaths } from "../src/paths.mjs";

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
        "checkpoint_record",
        "context_for_task",
        "entity_open",
        "graph_mutate",
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

    const create = await client.callTool({
      name: "graph_mutate",
      arguments: {
        reason: "Exercise the packaged MCP write path",
        operations: [
          { action: "create_block", id: "source", fields: { kind: "service", title: "Source", summary: "Produces committed changes" } },
          { action: "create_block", id: "canvas", fields: { kind: "ui", title: "Canvas", summary: "Renders the project network" } },
          { action: "create_chain", id: "live-path", fields: { title: "Live path", purpose: "architecture", intent: "Carry changes to the Canvas" } },
          { action: "create_plan", id: "verify-live-path", fields: { title: "Verify live path", goal: "Prove the packaged MCP workflow", status: "active", nextAction: "Record the end-to-end checkpoint" } },
          { action: "create_link", id: "source-canvas", fields: { sourceType: "block", sourceId: "source", targetType: "block", targetId: "canvas", kind: "writes", contract: "Only committed revisions are rendered" } },
        ],
      },
    });
    assert.equal(create.isError, undefined);
    assert.equal(create.structuredContent.graphRevision, 1);

    const compose = await client.callTool({
      name: "graph_mutate",
      arguments: {
        reason: "Compose explicit references",
        operations: [
          { action: "set_chain_path", id: "live-path", expectedRevision: 1, fields: { nodeIds: ["source", "canvas"], linkIds: ["source-canvas"] } },
          { action: "set_plan_chains", id: "verify-live-path", expectedRevision: 1, fields: { chainIds: ["live-path"] } },
        ],
      },
    });
    assert.equal(compose.isError, undefined);
    assert.equal(compose.structuredContent.graphRevision, 2);

    const checkpoint = await client.callTool({
      name: "checkpoint_record",
      arguments: {
        id: "packaged-mcp-proof", targetType: "plan", targetId: "verify-live-path",
        title: "Packaged MCP round trip", status: "passed",
        evidence: [{ kind: "automated-test", result: "graph write, context read, and validation passed" }],
      },
    });
    assert.equal(checkpoint.isError, undefined);

    const contextPack = await client.callTool({
      name: "context_for_task",
      arguments: { task: "verify the live canvas path", focusRefs: ["plan:verify-live-path"] },
    });
    assert.equal(contextPack.isError, undefined);
    assert.match(contextPack.content[0].text, /Verify live path/);
    assert.match(contextPack.content[0].text, /Live path/);

    const opened = await client.callTool({
      name: "entity_open",
      arguments: { type: "plan", id: "verify-live-path" },
    });
    assert.equal(opened.isError, undefined);
    assert.match(opened.content[0].text, /Record the end-to-end checkpoint/);
    assert.match(opened.content[0].text, /Packaged MCP round trip/);

    const changed = await client.callTool({
      name: "graph_mutate",
      arguments: {
        reason: "Exercise packaged rollback",
        operations: [{ action: "update_block", id: "source", expectedRevision: 1, fields: { summary: "Temporarily changed" } }],
      },
    });
    assert.equal(changed.isError, undefined);
    const reverted = await client.callTool({
      name: "change_set_revert",
      arguments: { changeSetId: changed.structuredContent.changeSetId, reason: "Undo packaged rollback probe" },
    });
    assert.equal(reverted.isError, undefined);
    const afterRevert = await client.callTool({ name: "entity_open", arguments: { type: "block", id: "source" } });
    assert.equal(afterRevert.isError, undefined);
    assert.match(afterRevert.content[0].text, /Produces committed changes/);

    const validation = await client.callTool({ name: "graph_validate", arguments: {} });
    assert.equal(validation.isError, undefined);
    assert.equal(validation.structuredContent.valid, true);
    assert.deepEqual(validation.structuredContent.errors, []);
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
      assert.equal(registered.structuredContent.created, true);
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
      assert.equal(mutation.structuredContent.graphRevision, 1);
    }

    const firstMap = await client.callTool({ name: "project_map", arguments: { projectRoot: firstRoot } });
    const secondMap = await client.callTool({ name: "project_map", arguments: { projectRoot: secondRoot } });
    assert.equal(firstMap.structuredContent.map.project.id, "first-project");
    assert.equal(secondMap.structuredContent.map.project.id, "second-project");
    assert.equal(firstMap.structuredContent.map.counts.blocks, 1);
    assert.equal(secondMap.structuredContent.map.counts.blocks, 1);
    assert.equal(firstMap.structuredContent.map.criticalBlocks.length, 0);
    assert.equal(secondMap.structuredContent.map.criticalBlocks.length, 0);

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
