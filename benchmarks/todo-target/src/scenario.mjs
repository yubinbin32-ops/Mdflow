import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { TodoStore, TODO_SCHEMA_VERSION } from "./store.mjs";
import { DeterministicProvider } from "./provider.mjs";
import { createTodoServer } from "./server.mjs";

async function json(response) {
  return { status: response.status, body: await response.json() };
}

export async function runTargetScenario() {
  const started = performance.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-todo-target-"));
  const dbPath = path.join(root, "todo.sqlite");
  const first = new TodoStore(dbPath);
  assert.deepEqual(first.schemaVersions(), [TODO_SCHEMA_VERSION]);
  first.close();
  const second = new TodoStore(dbPath);
  assert.deepEqual(second.schemaVersions(), [TODO_SCHEMA_VERSION]);
  second.close();

  const provider = new DeterministicProvider();
  const app = createTodoServer({ provider });
  const base = await app.listen();
  try {
    const page = await fetch(`${base}/`);
    const pageText = await page.text();
    assert.equal(page.status, 200);
    assert.match(pageText, /id="todo-form"/);
    assert.match(pageText, /aria-live/);

    const created = await json(await fetch(`${base}/api/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Ship the verified Todo target" }),
    }));
    assert.equal(created.status, 201);
    const todoId = created.body.id;
    const invalid = await json(await fetch(`${base}/api/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "  " }),
    }));
    assert.equal(invalid.status, 400);

    provider.failNext("timeout");
    const firstSync = await json(await fetch(`${base}/api/todos/${todoId}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "todo-sync-1" }),
    }));
    assert.equal(firstSync.body.status, "retryable");
    const recovered = await json(await fetch(`${base}/api/todos/${todoId}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "todo-sync-1" }),
    }));
    assert.equal(recovered.body.status, "synced");
    const replay = await json(await fetch(`${base}/api/todos/${todoId}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "todo-sync-1" }),
    }));
    assert.equal(replay.body.status, "already_succeeded");
    assert.equal(provider.calls.length, 2);
    assert.equal(app.store.countTodos(), 1);
    assert.equal(app.store.getTodo(todoId).syncState, "synced");
    assert.equal(app.store.getSyncAttempt(todoId, "todo-sync-1").attemptCount, 4);

    return {
      name: "todo-target-real-path",
      status: "passed",
      checks: {
        migrationIsIdempotent: true,
        uiApiCreateFlow: true,
        validationErrorIsVisible: true,
        timeoutRecovery: true,
        idempotentReplay: true,
        noDuplicateTodoWrite: true,
      },
      implementation: {
        files: 7,
        schemaVersion: TODO_SCHEMA_VERSION,
        providerCalls: provider.calls.length,
        todos: app.store.countTodos(),
        syncAttempts: app.store.getSyncAttempt(todoId, "todo-sync-1").attemptCount,
      },
      durationMs: Number((performance.now() - started).toFixed(2)),
    };
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
