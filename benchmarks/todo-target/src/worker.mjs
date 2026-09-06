const RETRYABLE_ERRORS = new Set(["timeout", "temporarily_unavailable"]);

export async function syncTodo({ store, provider, todoId, idempotencyKey }) {
  const previous = store.getSyncAttempt(todoId, idempotencyKey);
  if (previous?.status === "succeeded") {
    return { status: "already_succeeded", attempt: previous };
  }
  const todo = store.getTodo(todoId);
  if (!todo) return { status: "not_found" };

  store.recordSyncAttempt(todoId, idempotencyKey, "running");
  try {
    const result = await provider.sync(todo);
    store.setSyncState(todoId, "synced");
    const attempt = store.recordSyncAttempt(todoId, idempotencyKey, "succeeded");
    return { status: "synced", result, attempt };
  } catch (error) {
    const code = error?.code ?? "provider_error";
    const retryable = RETRYABLE_ERRORS.has(code);
    store.setSyncState(todoId, retryable ? "retryable" : "failed");
    const attempt = store.recordSyncAttempt(todoId, idempotencyKey, retryable ? "retryable" : "failed", code);
    return { status: retryable ? "retryable" : "failed", errorCode: code, attempt };
  }
}
