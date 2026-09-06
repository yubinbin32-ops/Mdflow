import assert from "node:assert/strict";
import test from "node:test";
import { runTargetScenario } from "../src/scenario.mjs";

test("real Todo target completes create, migration, timeout recovery, and idempotent replay", async () => {
  const result = await runTargetScenario();
  assert.equal(result.status, "passed");
  assert.deepEqual(result.checks, {
    migrationIsIdempotent: true,
    uiApiCreateFlow: true,
    validationErrorIsVisible: true,
    timeoutRecovery: true,
    idempotentReplay: true,
    noDuplicateTodoWrite: true,
  });
  assert.equal(result.implementation.todos, 1);
  assert.equal(result.implementation.providerCalls, 2);
  assert.equal(result.implementation.syncAttempts, 4);
});
