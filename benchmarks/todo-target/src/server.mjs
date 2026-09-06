import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TodoStore } from "./store.mjs";
import { DeterministicProvider } from "./provider.mjs";
import { createTodoService } from "./service.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "../ui/index.html"), "utf8");

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error("request body too large");
  }
  if (!body) return {};
  return JSON.parse(body);
}

export function createTodoServer({ dbPath = ":memory:", provider = new DeterministicProvider() } = {}) {
  const store = new TodoStore(dbPath);
  const service = createTodoService({ store, provider });
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/todos") {
        send(response, 200, service.list());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/todos") {
        const body = await readBody(request);
        send(response, 201, service.create(body.text));
        return;
      }
      const syncMatch = url.pathname.match(/^\/api\/todos\/([^/]+)\/sync$/);
      if (request.method === "POST" && syncMatch) {
        const body = await readBody(request);
        const result = await service.sync(syncMatch[1], String(body.idempotencyKey ?? ""));
        send(response, result.status === "not_found" ? 404 : 200, result);
        return;
      }
      const completeMatch = url.pathname.match(/^\/api\/todos\/([^/]+)$/);
      if (request.method === "PATCH" && completeMatch) {
        const body = await readBody(request);
        const todo = service.complete(completeMatch[1], body.completed);
        send(response, todo ? 200 : 404, todo ?? { error: "Todo not found" });
        return;
      }
      send(response, 404, { error: "Not found" });
    } catch (error) {
      const status = /must not be empty|invalid json|request body too large/i.test(error.message) ? 400 : 500;
      send(response, status, { error: error.message });
    }
  });

  return {
    store,
    provider,
    server,
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      store.close();
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
