import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectRoot = process.cwd();
const transport = new StdioClientTransport({
  command: "node",
  args: ["plugins/mdflow/server/mdflow-mcp.mjs"],
  cwd: projectRoot,
});
const client = new Client({ name: "mdflow-plugin-smoke", version: "0.3.2" });

try {
  await client.connect(transport);
  const listing = await client.listTools();
  const names = new Set(listing.tools.map((tool) => tool.name));
  for (const required of ["context_for_task", "chain_code_stream", "run_command", "log_sanitize", "block_code_mutate"]) {
    assert.ok(names.has(required), `missing MCP tool: ${required}`);
  }

  const chainTool = listing.tools.find((tool) => tool.name === "chain_code_stream");
  assert.ok(chainTool.inputSchema.properties.mode, "chain_code_stream must expose mode");
  assert.ok(listing.tools.find((tool) => tool.name === "context_for_task").inputSchema.properties.budgetChars, "context_for_task must expose budgetChars");
  const contextResult = await client.callTool({
    name: "context_for_task",
    arguments: { projectRoot, task: "plugin smoke budget", maxChars: 1000, budgetChars: 4000 },
  });
  const contextText = contextResult.content?.map((item) => item.text ?? "").join("\n") ?? "";
  const taskContextId = contextText.match(/task_[0-9a-f-]{36}/)?.[0];
  assert.ok(taskContextId, "context_for_task must return a taskContextId");
  const focusedChain = await client.callTool({
    name: "chain_code_stream",
    arguments: {
      projectRoot,
      chainId: "chain-mcp-modular-architecture",
      taskContextId,
      maxTotalChars: 1000,
    },
  });
  assert.ok(focusedChain.content?.some((item) => typeof item.text === "string"), "focused Chain read failed");
  const runResult = await client.callTool({
    name: "run_command",
    arguments: {
      projectRoot,
      command: `printf 'OPENAI_API_KEY=sk-plugin-smoke\\n%s\\n' "$PWD"`,
      maxChars: 500,
    },
  });
  const rendered = runResult.content?.map((item) => item.text ?? "").join("\n") ?? "";
  assert.ok(!rendered.includes("sk-plugin-smoke"), "run_command leaked a credential");
  assert.ok(!rendered.includes(projectRoot), "run_command leaked the project path");
  assert.match(rendered, /\[REDACTED\]/);

  console.log(`# mdflow plugin smoke\n- MCP tools: ${names.size}\n- Contract-first Chain stream: exposed\n- Sanitized command gateway: passed`);
  console.log(`- Shared task budget: exposed (${taskContextId})`);
} finally {
  await client.close();
  await transport.close();
}
