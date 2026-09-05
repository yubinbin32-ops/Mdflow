import assert from "node:assert/strict";
import test from "node:test";
import { runBenchmark } from "../../../scripts/context-parity.mjs";

test("Todo context parity benchmark uses a real tokenizer without losing expected facts", () => {
  const result = runBenchmark();

  assert.equal(result.tokenizer, "cl100k_base (js-tiktoken)");
  assert.equal(result.graphValidation.valid, true);
  assert.equal(result.mdflow.recallRate, 1);
  assert.equal(result.markdown.recallRate, 1);
  assert.equal(result.mdflow.errorRate, 0);
  assert.equal(result.mdflow.reworkTurns, 0);
  assert.ok(result.comparison.tokenReduction > 0.25);
  assert.equal(result.comparison.recalledFactsDelta, 0);
  assert.equal(result.comparison.errorRateDelta, 0);
  assert.equal(result.comparison.reworkTurnsDelta, 0);
});
