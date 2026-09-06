import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runExternalFeedbackLoop } from "../scripts/feedback-loop-llm.mjs";

test("external feedback-loop adapter protocol edits and recovers both paths", async () => {
  const adapterRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-adapter-contract-"));
  const adapter = path.join(adapterRoot, "adapter.mjs");
  fs.writeFileSync(adapter, `import fs from "node:fs";
const file = process.env.MDFLOW_FEEDBACK_SOURCE;
const before = fs.readFileSync(file, "utf8");
const after = before.replace("if (!normalized) return null;", 'if (!normalized) throw new Error("Todo text must not be empty");');
if (after === before) process.exit(2);
fs.writeFileSync(file, after);
`);
  try {
    const result = await runExternalFeedbackLoop({
      adapterCommand: `${process.execPath} "${adapter}"`,
      model: "deterministic-test-adapter",
      claimLlm: false,
    });
    assert.equal(result.llmClaim, false);
    assert.equal(result.mdflow.agentMode, "external-adapter");
    assert.equal(result.markdown.agentMode, "external-adapter");
    assert.equal(result.mdflow.incrementalRecovery, true);
    assert.equal(result.markdown.incrementalRecovery, false);
    assert.equal(result.mdflow.recalled, result.mdflow.expected);
    assert.equal(result.markdown.recalled, result.markdown.expected);
    assert.equal(result.mdflow.codeEdits, 1);
    assert.equal(result.markdown.codeEdits, 1);
  } finally {
    fs.rmSync(adapterRoot, { recursive: true, force: true });
  }
});
