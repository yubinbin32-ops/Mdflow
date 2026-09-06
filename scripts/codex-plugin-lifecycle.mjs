import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePlugin = path.join(scriptRoot, "plugins/mdflow");
const sourceMarketplace = path.join(scriptRoot, ".agents/plugins/marketplace.json");
const sourceManifest = path.join(sourcePlugin, ".codex-plugin/plugin.json");
const previousVersion = "0.1.0-test.previous";

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value == null ? fallback : value.slice(prefix.length);
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJSON(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseJsonOutput(output) {
  try { return JSON.parse(output); } catch { /* Codex may print warnings beside JSON output */ }
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(output.slice(start, end + 1)); } catch { return null; }
}

function runCodex(binary, home, args) {
  const result = spawnSync(binary, args, {
    cwd: scriptRoot,
    env: { ...process.env, CODEX_HOME: home, TERM: "xterm-256color" },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    throw new Error(`codex ${args.join(" ")} failed (${result.status ?? "signal"}): ${output}`);
  }
  let json = null;
  if (output) json = parseJsonOutput(output);
  return { status: result.status, output, json };
}

function prepareMarketplace(root, version) {
  fs.mkdirSync(path.join(root, ".agents/plugins"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugins"), { recursive: true });
  fs.copyFileSync(sourceMarketplace, path.join(root, ".agents/plugins/marketplace.json"));
  fs.cpSync(sourcePlugin, path.join(root, "plugins/mdflow"), { recursive: true });
  const manifestPath = path.join(root, "plugins/mdflow/.codex-plugin/plugin.json");
  const manifest = readJSON(manifestPath);
  manifest.version = version;
  writeJSON(manifestPath, manifest);
  return manifestPath;
}

async function probeInstalledMcp(installedPath, label) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-plugin-project-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-plugin-data-"));
  const projectMeta = path.join(projectRoot, ".mdflow");
  const server = path.join(installedPath, "server/mdflow-mcp.mjs");
  fs.mkdirSync(projectMeta, { recursive: true });
  fs.writeFileSync(path.join(projectMeta, "project.json"), `${JSON.stringify({ id: `lifecycle-${label}`, name: `Lifecycle ${label}`, schemaVersion: 1 })}\n`);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--no-warnings=ExperimentalWarning", server],
    env: { MDFLOW_PROJECT_ROOT: projectRoot, MDFLOW_DATA_DIR: dataRoot },
    stderr: "pipe",
  });
  const client = new Client({ name: "mdflow-plugin-lifecycle", version: "0.1.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const projectMap = await client.callTool({ name: "project_map", arguments: {} });
    const validation = await client.callTool({ name: "graph_validate", arguments: {} });
    if (projectMap.isError || validation.isError || !validation.content?.[0]?.text?.includes("Status: valid")) {
      throw new Error(`Installed ${label} MCP did not return a valid project graph`);
    }
    return {
      label,
      server,
      toolCount: tools.tools.length,
      projectMapMarkdown: projectMap.content?.[0]?.text?.slice(0, 240) ?? "",
      graphValid: true,
    };
  } finally {
    try { await client.close(); } catch { /* transport may already be closed */ }
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
}

function assertInstalledVersion(home, expected) {
  const listing = runCodex(process.env.MDFLOW_CODEX_BIN ?? "codex", home, ["plugin", "list", "--json"]);
  const installed = listing.json?.installed?.find((item) => item.name === "mdflow");
  if (!installed || installed.version !== expected || installed.enabled === false) {
    throw new Error(`Expected installed mdflow ${expected}, got ${JSON.stringify(installed ?? null)}`);
  }
  return installed;
}

export async function runCodexPluginLifecycle({ codexBinary = process.env.MDFLOW_CODEX_BIN ?? "codex" } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-codex-home-"));
  const marketplace = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-codex-marketplace-"));
  const currentManifest = readJSON(sourceManifest);
  const currentVersion = currentManifest.version;
  const manifestPath = prepareMarketplace(marketplace, previousVersion);
  const stages = {};
  try {
    stages.marketplace = runCodex(codexBinary, home, ["plugin", "marketplace", "add", marketplace, "--json"]).json;
    const available = runCodex(codexBinary, home, ["plugin", "list", "--available", "--json"]).json;
    if (!available?.available?.some((item) => item.pluginId === "mdflow@mdflow-development" && item.version === previousVersion)) {
      throw new Error("The isolated marketplace did not expose the previous mdflow version");
    }

    const firstInstall = runCodex(codexBinary, home, ["plugin", "add", "mdflow@mdflow-development", "--json"]).json;
    const firstPath = firstInstall?.installedPath;
    if (!firstPath || !fs.existsSync(firstPath)) throw new Error("Fresh plugin install did not create an installed bundle");
    stages.freshInstall = { ...firstInstall, mcp: await probeInstalledMcp(firstPath, "fresh-install") };
    assertInstalledVersion(home, previousVersion);

    const upgradedManifest = readJSON(manifestPath);
    upgradedManifest.version = currentVersion;
    writeJSON(manifestPath, upgradedManifest);
    stages.marketplaceRefresh = runCodex(codexBinary, home, ["plugin", "marketplace", "upgrade", "--json"]).json;
    const upgraded = runCodex(codexBinary, home, ["plugin", "add", "mdflow@mdflow-development", "--json"]).json;
    const upgradedPath = upgraded?.installedPath;
    if (!upgradedPath || !fs.existsSync(upgradedPath)) throw new Error("Plugin upgrade did not create the current bundle");
    stages.upgrade = { ...upgraded, mcp: await probeInstalledMcp(upgradedPath, "upgrade") };
    assertInstalledVersion(home, currentVersion);

    stages.disable = runCodex(codexBinary, home, ["plugin", "remove", "mdflow@mdflow-development", "--json"]).json;
    const afterRemove = runCodex(codexBinary, home, ["plugin", "list", "--json"]).json;
    if (afterRemove?.installed?.some((item) => item.name === "mdflow")) throw new Error("Plugin removal left mdflow enabled");

    const rollbackManifest = readJSON(manifestPath);
    rollbackManifest.version = previousVersion;
    writeJSON(manifestPath, rollbackManifest);
    runCodex(codexBinary, home, ["plugin", "marketplace", "upgrade", "--json"]);
    const rollback = runCodex(codexBinary, home, ["plugin", "add", "mdflow@mdflow-development", "--json"]).json;
    if (!rollback?.installedPath || !fs.existsSync(rollback.installedPath)) throw new Error("Rollback reinstall did not create a bundle");
    stages.rollback = { ...rollback, mcp: await probeInstalledMcp(rollback.installedPath, "rollback") };
    assertInstalledVersion(home, previousVersion);

    const report = {
      benchmark: "codex-plugin-lifecycle",
      codexBinary,
      isolatedHome: true,
      stages,
      limitation: "Codex CLI remove is the disable/uninstall operation; Developer ID, notarization, and public marketplace upload remain separate gates.",
    };
    let serialized = JSON.stringify(report);
    for (const alias of [`/private${home}`, home]) serialized = serialized.replaceAll(alias, "<isolated-codex-home>");
    for (const alias of [`/private${marketplace}`, marketplace]) serialized = serialized.replaceAll(alias, "<isolated-marketplace>");
    return JSON.parse(serialized);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(marketplace, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await runCodexPluginLifecycle();
    const targetArgument = process.argv.find((item) => item.startsWith("--write-report="));
    if (targetArgument) {
      const target = path.resolve(targetArgument.slice("--write-report=".length));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
