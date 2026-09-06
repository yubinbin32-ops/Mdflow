import { syncTodo } from "./worker.mjs";

export function createTodoService({ store, provider }) {
  return {
    create(text) {
      return store.createTodo(text);
    },
    list() {
      return store.listTodos();
    },
    complete(id, completed = true) {
      return store.completeTodo(id, completed);
    },
    sync(id, idempotencyKey) {
      return syncTodo({ store, provider, todoId: id, idempotencyKey });
    },
  };
}
