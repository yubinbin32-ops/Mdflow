import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const TODO_SCHEMA_VERSION = 1;

function rowToTodo(row) {
  if (!row) return null;
  return {
    id: row.id,
    text: row.text,
    completed: Boolean(row.completed),
    syncState: row.sync_state,
    createdAt: row.created_at,
  };
}

function rowToAttempt(row) {
  if (!row) return null;
  return {
    todoId: row.todo_id,
    idempotencyKey: row.idempotency_key,
    attemptCount: row.attempt_count,
    status: row.status,
    errorCode: row.error_code,
    lastAttemptAt: row.last_attempt_at,
  };
}

export class TodoStore {
  constructor(filename = ":memory:") {
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        sync_state TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_attempts (
        todo_id TEXT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        error_code TEXT,
        last_attempt_at TEXT NOT NULL,
        PRIMARY KEY (todo_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS todos_created_idx ON todos(created_at DESC);
      CREATE INDEX IF NOT EXISTS sync_attempts_status_idx ON sync_attempts(status);
    `);
    const existing = this.db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(TODO_SCHEMA_VERSION);
    if (!existing) {
      this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(TODO_SCHEMA_VERSION, new Date().toISOString());
    }
  }

  schemaVersions() {
    return this.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version);
  }

  createTodo(text) {
    const normalized = String(text ?? "").trim();
    if (!normalized) throw new Error("Todo text must not be empty");
    const todo = {
      id: crypto.randomUUID(),
      text: normalized,
      createdAt: new Date().toISOString(),
    };
    this.db.prepare("INSERT INTO todos(id, text, created_at) VALUES (?, ?, ?)").run(todo.id, todo.text, todo.createdAt);
    return this.getTodo(todo.id);
  }

  getTodo(id) {
    return rowToTodo(this.db.prepare("SELECT id, text, completed, sync_state, created_at FROM todos WHERE id = ?").get(id));
  }

  listTodos() {
    return this.db.prepare("SELECT id, text, completed, sync_state, created_at FROM todos ORDER BY created_at ASC, id ASC").all().map(rowToTodo);
  }

  completeTodo(id, completed = true) {
    const result = this.db.prepare("UPDATE todos SET completed = ? WHERE id = ?").run(Number(Boolean(completed)), id);
    if (!result.changes) return null;
    return this.getTodo(id);
  }

  setSyncState(id, state) {
    this.db.prepare("UPDATE todos SET sync_state = ? WHERE id = ?").run(state, id);
    return this.getTodo(id);
  }

  getSyncAttempt(todoId, idempotencyKey) {
    return rowToAttempt(this.db.prepare(
      "SELECT todo_id, idempotency_key, attempt_count, status, error_code, last_attempt_at FROM sync_attempts WHERE todo_id = ? AND idempotency_key = ?",
    ).get(todoId, idempotencyKey));
  }

  recordSyncAttempt(todoId, idempotencyKey, status, errorCode = null) {
    const now = new Date().toISOString();
    const existing = this.getSyncAttempt(todoId, idempotencyKey);
    if (!existing) {
      this.db.prepare(
        "INSERT INTO sync_attempts(todo_id, idempotency_key, attempt_count, status, error_code, last_attempt_at) VALUES (?, ?, 1, ?, ?, ?)",
      ).run(todoId, idempotencyKey, status, errorCode, now);
    } else {
      this.db.prepare(
        "UPDATE sync_attempts SET attempt_count = ?, status = ?, error_code = ?, last_attempt_at = ? WHERE todo_id = ? AND idempotency_key = ?",
      ).run(existing.attemptCount + 1, status, errorCode, now, todoId, idempotencyKey);
    }
    return this.getSyncAttempt(todoId, idempotencyKey);
  }

  countTodos() {
    return this.db.prepare("SELECT COUNT(*) AS count FROM todos").get().count;
  }

  close() {
    this.db.close();
  }
}
