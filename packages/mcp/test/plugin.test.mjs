import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
        "checkpoint_record",
        "context_for_task",
        "entity_open",
        "graph_mutate",
        "graph_search",
        "graph_validate",
        "project_map",
      ],
    );
    const response = await client.callTool({ name: "project_map", arguments: {} });
    assert.equal(response.isError, undefined);
    assert.match(response.content[0].text, /Plugin Test/);
  } finally {
    await client.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
