export class DeterministicProvider {
  constructor() {
    this.failures = [];
    this.calls = [];
  }

  failNext(code = "timeout") {
    this.failures.push(code);
  }

  async sync(todo) {
    this.calls.push({ todoId: todo.id, text: todo.text });
    const failure = this.failures.shift();
    if (failure) {
      const error = new Error(`Provider ${failure}`);
      error.code = failure;
      throw error;
    }
    return { externalId: `provider-${todo.id}`, status: "synced" };
  }
}
