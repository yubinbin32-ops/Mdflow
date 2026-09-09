import test from "node:test";
import assert from "node:assert/strict";
import { boundTaskResponse, resetTaskBudgets, startTaskBudget, taskBudget } from "../src/task-budget.mjs";

test("task budget is shared across focused reads and caps structured duplication", () => {
  resetTaskBudgets();
  const budget = startTaskBudget({ projectRoot: ".", budgetChars: 600 });
  const first = boundTaskResponse({
    taskContextId: budget.taskContextId,
    markdown: "a".repeat(350),
    data: { large: "b".repeat(900) },
    includeStructured: true,
  });
  assert.equal(first.structured.truncated, true);
  const second = boundTaskResponse({
    taskContextId: budget.taskContextId,
    markdown: "c".repeat(350),
    data: { value: "d" },
    includeStructured: false,
  });
  assert.ok(second.markdown.length < 350);
  assert.ok(taskBudget(budget.taskContextId).consumedChars <= 600);
  resetTaskBudgets();
});
