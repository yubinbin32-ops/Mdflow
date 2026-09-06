import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function walk(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else files.push(path.relative(root, absolute));
    }
  };
  visit(root);
  return files.sort();
}

function plistString(contents, key) {
  const match = contents.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
  return match?.[1] ?? null;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function signingArguments(root) {
  const identity = process.env.MDFLOW_CODESIGN_IDENTITY ?? "-";
  if (identity === "-") return ["--force", "--sign", "-", root];
  return ["--force", "--options", "runtime", "--timestamp", "--sign", identity, root];
}

function requiredFile(root, relative, errors) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) errors.push(`Missing package file: ${relative}`);
  return absolute;
}

export function inspectPackage(appRoot, { verifySignature = true } = {}) {
  const root = path.resolve(appRoot);
  const errors = [];
  const warnings = [];
  if (!fs.existsSync(root) || !root.endsWith(".app")) errors.push(`Not an app bundle: ${root}`);

  const executable = requiredFile(root, "Contents/MacOS/mdflow-desktop", errors);
  const infoPath = requiredFile(root, "Contents/Info.plist", errors);
  const iconPath = requiredFile(root, "Contents/Resources/AppIcon.icns", errors);
  const manifestPath = requiredFile(root, "Contents/Resources/MarketplaceRoot/plugins/mdflow/.codex-plugin/plugin.json", errors);
  const mcpPath = requiredFile(root, "Contents/Resources/MarketplaceRoot/plugins/mdflow/.mcp.json", errors);
  const serverPath = requiredFile(root, "Contents/Resources/MarketplaceRoot/plugins/mdflow/server/mdflow-mcp.mjs", errors);
  const skillPath = requiredFile(root, "Contents/Resources/MarketplaceRoot/plugins/mdflow/skills/mdflow/SKILL.md", errors);
  const marketplacePath = requiredFile(root, "Contents/Resources/MarketplaceRoot/.agents/plugins/marketplace.json", errors);

  let info = "";
  if (fs.existsSync(infoPath)) info = fs.readFileSync(infoPath, "utf8");
  const infoValues = {
    bundleIdentifier: plistString(info, "CFBundleIdentifier"),
    executable: plistString(info, "CFBundleExecutable"),
    version: plistString(info, "CFBundleShortVersionString"),
    minimumSystem: plistString(info, "LSMinimumSystemVersion"),
  };
  if (infoValues.bundleIdentifier !== "com.mdflow.desktop") errors.push("Info.plist has the wrong bundle identifier");
  if (infoValues.executable !== "mdflow-desktop") errors.push("Info.plist executable does not match the package binary");
  if (!infoValues.version) errors.push("Info.plist is missing CFBundleShortVersionString");
  if (infoValues.minimumSystem !== "14.0") errors.push("Info.plist must declare macOS 14.0 or newer");
  if (fs.existsSync(executable) && !fs.statSync(executable).mode.toString(8).endsWith("755")) warnings.push("App executable is not mode 755; codesign may still make it runnable");

  let plugin = {};
  let mcp = {};
  let marketplace = {};
  try { if (fs.existsSync(manifestPath)) plugin = readJSON(manifestPath); } catch (error) { errors.push(`Invalid plugin manifest: ${error.message}`); }
  try { if (fs.existsSync(mcpPath)) mcp = readJSON(mcpPath); } catch (error) { errors.push(`Invalid MCP manifest: ${error.message}`); }
  try { if (fs.existsSync(marketplacePath)) marketplace = readJSON(marketplacePath); } catch (error) { errors.push(`Invalid marketplace manifest: ${error.message}`); }
  if (!plugin.name || !plugin.version || plugin.name !== "mdflow") errors.push("Plugin manifest must identify mdflow and include a version");
  if (mcp.mcpServers?.mdflow?.command !== "node") errors.push("Plugin MCP manifest must launch node");
  if (!mcp.mcpServers?.mdflow?.args?.some((argument) => argument.includes("server/mdflow-mcp.mjs"))) errors.push("Plugin MCP manifest must point to the bundled server");
  if (!marketplace.plugins?.some((item) => item.name === "mdflow")) errors.push("Marketplace manifest does not expose mdflow");
  if (fs.existsSync(serverPath) && fs.statSync(serverPath).size < 100_000) errors.push("Bundled MCP server is unexpectedly small");
  if (fs.existsSync(skillPath) && !fs.readFileSync(skillPath, "utf8").includes("context_for_task")) errors.push("Packaged mdflow Skill is missing context_for_task guidance");

  const files = fs.existsSync(root) ? walk(root) : [];
  const forbidden = files.filter((file) => /(^|\/)(\.git|\.mdflow|node_modules|\.build)(\/|$)|\.sqlite(?:-|$)/.test(file));
  if (forbidden.length) errors.push(`Package contains private/development data: ${forbidden.join(", ")}`);

  let signature = { checked: false, valid: false, output: "" };
  if (verifySignature && fs.existsSync(root)) {
    const result = spawnSync("codesign", ["--verify", "--deep", "--strict", root], { encoding: "utf8" });
    signature = { checked: true, valid: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
    if (!signature.valid) errors.push(`codesign verification failed: ${signature.output || "unknown error"}`);
    const details = spawnSync("codesign", ["-dv", "--verbose=4", root], { encoding: "utf8" });
    const detailOutput = `${details.stdout ?? ""}${details.stderr ?? ""}`;
    signature.mode = detailOutput.includes("Signature=adhoc") ? "adhoc" : signature.valid ? "signed" : "invalid";
    if (signature.mode === "adhoc") warnings.push("Package uses an ad-hoc signature; Developer ID/notarization is required for public distribution");
  }

  const manifest = {
    format: 1,
    app: "mdflow",
    bundleIdentifier: infoValues.bundleIdentifier,
    appVersion: infoValues.version,
    pluginVersion: plugin.version ?? null,
    minimumSystem: infoValues.minimumSystem,
    signature: signature.checked ? (signature.valid ? "verified" : "invalid") : "not-checked",
    signingMode: signature.mode ?? "not-checked",
    files: {
      executableSha256: fs.existsSync(executable) ? sha256(executable) : null,
      serverSha256: fs.existsSync(serverPath) ? sha256(serverPath) : null,
      fileCount: files.length,
    },
  };
  return { valid: errors.length === 0, errors, warnings, root, info: infoValues, plugin: { name: plugin.name, version: plugin.version }, signature, files, manifest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const appRoot = process.argv.find((argument) => argument.endsWith(".app")) ?? "dist/mdflow.app";
  const manifestPath = path.join(path.resolve(appRoot), "Contents/Resources/RELEASE-MANIFEST.json");
  let result = inspectPackage(appRoot);

  if (process.argv.includes("--write-manifest")) {
    if (!process.argv.includes("--resign")) {
      result = {
        ...result,
        valid: false,
        errors: [...result.errors, "--write-manifest requires --resign so the manifest remains inside the code signature"],
      };
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      process.exit();
    }
    // The manifest is itself a sealed resource. Write it before the final
    // signature, then inspect the signed bundle once more so the file count
    // includes CodeResources/provisioning metadata that codesign adds.
    const writeManifest = (manifest) => fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeManifest(result.manifest);
    if (process.argv.includes("--resign")) {
      const firstSign = spawnSync("codesign", signingArguments(path.resolve(appRoot)), { encoding: "utf8" });
      if (firstSign.status !== 0) {
        result = {
          ...result,
          valid: false,
          errors: [...result.errors, `codesign re-sign failed: ${`${firstSign.stdout ?? ""}${firstSign.stderr ?? ""}`.trim()}`],
        };
      } else {
        result = inspectPackage(appRoot);
        writeManifest(result.manifest);
        const finalSign = spawnSync("codesign", signingArguments(path.resolve(appRoot)), { encoding: "utf8" });
        if (finalSign.status !== 0) {
          result = {
            ...result,
            valid: false,
            errors: [...result.errors, `codesign final sign failed: ${`${finalSign.stdout ?? ""}${finalSign.stderr ?? ""}`.trim()}`],
          };
        } else {
          result = inspectPackage(appRoot);
        }
      }
    }
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}
