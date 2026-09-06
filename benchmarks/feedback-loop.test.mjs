import assert from "node:assert/strict";
import test from "node:test";
import { runFeedbackLoopBenchmark } from "../scripts/feedback-loop-benchmark.mjs";

test("clean-project feedback loop reproduces, fixes, and recovers a real code defect", async () => {
  const result = await runFeedbackLoopBenchmark();
  assert.equal(result.fixture.cleanProject, true);
  assert.equal(result.mdflow.recalled, result.mdflow.expected);
  assert.equal(result.markdown.recalled, result.markdown.expected);
  assert.equal(result.mdflow.incrementalRecovery, true);
  assert.equal(result.markdown.incrementalRecovery, false);
  assert.equal(result.mdflow.codeEdits, 1);
  assert.equal(result.mdflow.recoveryTurns, 1);
  assert.equal(result.markdown.recoveryTurns, 2);
  assert.equal(result.comparison.errorRate, 0);
});
