import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectPackage } from "../../../scripts/verify-package.mjs";

function write(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

test("release package verifier rejects private graph data and accepts a clean bundle", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-package-"));
  const app = path.join(root, "mdflow.app");
  try {
    write(app, "Contents/MacOS/mdflow-desktop", "binary");
    write(app, "Contents/Info.plist", `<?xml version="1.0"?><plist><dict>
      <key>CFBundleIdentifier</key><string>com.mdflow.desktop</string>
      <key>CFBundleExecutable</key><string>mdflow-desktop</string>
      <key>CFBundleShortVersionString</key><string>0.1.0</string>
      <key>LSMinimumSystemVersion</key><string>14.0</string>
    </dict></plist>`);
    write(app, "Contents/Resources/AppIcon.icns", "icon");
    write(app, "Contents/Resources/MarketplaceRoot/plugins/mdflow/.codex-plugin/plugin.json", JSON.stringify({ name: "mdflow", version: "0.1.0" }));
    write(app, "Contents/Resources/MarketplaceRoot/plugins/mdflow/.mcp.json", JSON.stringify({ mcpServers: { mdflow: { command: "node", args: ["./server/mdflow-mcp.mjs"] } } }));
    write(app, "Contents/Resources/MarketplaceRoot/plugins/mdflow/server/mdflow-mcp.mjs", "x".repeat(100_001));
    write(app, "Contents/Resources/MarketplaceRoot/plugins/mdflow/skills/mdflow/SKILL.md", "context_for_task");
    write(app, "Contents/Resources/MarketplaceRoot/.agents/plugins/marketplace.json", JSON.stringify({ plugins: [{ name: "mdflow" }] }));

    const clean = inspectPackage(app, { verifySignature: false });
    assert.equal(clean.valid, true);
    assert.equal(clean.manifest.pluginVersion, "0.1.0");
    write(app, "Contents/Resources/MarketplaceRoot/.mdflow/mdflow.sqlite", "private");
    const dirty = inspectPackage(app, { verifySignature: false });
    assert.equal(dirty.valid, false);
    assert.match(dirty.errors.join("\n"), /private\/development data/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
