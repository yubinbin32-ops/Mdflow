# Express 5.2.1：Markdown-only 对照材料

> 这不是 mdflow 的开发真相，而是发布基准中的对照输入。它刻意只使用一份完整 Markdown handoff，让每个任务都重新读取同一份材料；源码和测试仍来自 Express 的固定 commit。

- Repository: https://github.com/expressjs/express
- Snapshot: `023767fe9872e029271df1418f73401bff20ff40`
- Version: Express 5.2.1
- Runtime: Node.js >= 18
- Test command: `npm test`

## Architecture order

1. `index.js` is the public package entry and delegates to `lib/express.js`.
2. `lib/express.js` creates an application, mixes in EventEmitter behavior, and exposes the application, request, response, Router, and body-parser APIs.
3. `lib/application.js` initializes the app, lazily creates the Router, handles requests, registers middleware, creates routes, renders views, and listens on an HTTP server.
4. The external `router` package owns route matching and middleware traversal.
5. `lib/request.js` normalizes incoming HTTP metadata such as headers, query, protocol, host, IP, and content negotiation.
6. `lib/response.js` produces HTTP output through status, send, json, jsonp, file, download, format, cookie, and redirect helpers.
7. `lib/view.js` resolves templates and delegates rendering to an engine.
8. `lib/utils.js` supplies MIME, ETag, cache, extension, and protocol helpers.
9. `finalhandler` closes unhandled requests and errors.
10. `test/` and `test/acceptance/` verify the public behavior through Mocha and Supertest.
11. `package.json`, `Readme.md`, `LICENSE`, and `History.md` define the public release contract.

## Paths

### Request path

`index.js` → `lib/express.js` → `lib/application.js` → `router` → `lib/response.js`

The application runtime reads request helpers and writes response helpers. The Router is a reusable dependency, not the owner of the application blocks.

### Error path

`lib/application.js` → `finalhandler` → `lib/response.js`

When routing does not complete a response or propagates an error, finalhandler creates the final HTTP response without duplicating a write.

### Release validation path

`package.json` → `index.js` → application runtime → `test/` and `test/acceptance/`

The package entry, runtime behavior, test command, public documentation, and version must describe the same snapshot.

## Development task cards

### Response boundary

For a response-boundary change, inspect `lib/response.js` and the `res.*` tests. Preserve legal HTTP status/header behavior, chainable methods, serialization, and error propagation.

### Error handling

For an error-path change, inspect `lib/application.js`, `finalhandler`, `lib/response.js`, and acceptance tests for 404 and error responses. Verify that a request is finalized exactly once.

### Release update

For a release update, inspect `package.json`, `index.js`, `Readme.md`, `History.md`, and the full `npm test` command. Record the exact commit and test result.

## Verification facts

- The fixed snapshot is Express 5.2.1 at commit `023767fe9872e029271df1418f73401bff20ff40`.
- `npm test` is the full regression command and passed 1260 tests in the baseline run.
- The request, error, and release paths are separate readings of the same implementation; a path does not replace direct Block coverage.
- This Markdown handoff has no machine-enforced Block, Link, Chain, Plan, or Checkpoint relationships. That absence is intentional for the Markdown-only control condition.

## Source index

The following index is the material an agent must carry when it cannot ask a graph for an exact source target:

| Responsibility | Source | Important symbols | Evidence to inspect |
| --- | --- | --- | --- |
| Package entry | `index.js:1-11` | `module.exports` | `test/exports.js` |
| Application factory | `lib/express.js:20-81` | `createApplication` | `test/exports.js`, `test/app.js` |
| Application runtime | `lib/application.js:59-177` | `app.init`, `app.handle` | `test/app.js`, `test/app.router.js` |
| Middleware and routes | `lib/application.js:185-268` | `app.use`, `app.route`, `app.param` | `test/app.use.js`, `test/app.route.js`, `test/app.param.js` |
| HTTP server | `lib/application.js:598-608` | `app.listen` | `test/app.listen.js` |
| Request boundary | `lib/request.js:1-230` | request prototype | `test/req.*.js` |
| Response boundary | `lib/response.js:1-247` | `res.status`, `res.send`, `res.json` | `test/res.*.js` |
| View rendering | `lib/view.js:1-205` | `View` | `test/app.render.js`, `test/acceptance/mvc.js` |
| Runtime helpers | `lib/utils.js:1-271` | MIME, ETag, cache helpers | `test/res.*.js`, `test/req.*.js` |
| Error finalization | external `finalhandler` used by `lib/application.js` | final response | `test/app.routes.error.js`, `test/acceptance/error.js` |
| Regression network | `test/`, `test/acceptance/` | Route, Router, app, req, res, acceptance suites | `npm test` |
| Release contract | `package.json`, `Readme.md`, `LICENSE`, `History.md` | version, main, engines, scripts | `npm test`, package install |

## Link inventory

- Entry implements the application factory.
- The factory calls the application runtime.
- The runtime calls the external Router.
- The runtime constrains request and response boundaries.
- The runtime calls View and finalhandler.
- The runtime reads shared protocol utilities.
- Tests validate the runtime and response boundary.
- The release contract constrains the package entry.
- finalhandler writes the final response.

## Verification handoff

The Markdown reader must manually keep these checks aligned:

1. The package entry must load the same `createApplication` implementation described by the factory section.
2. The runtime must use the external Router and must not bypass request/response prototypes.
3. Every response-boundary edit must have a matching `res.*` regression test.
4. Every error-path edit must be checked against both the application runtime and finalhandler behavior.
5. The full `npm test` command must run both `test/` and `test/acceptance/`.
6. The release version, Node engine, package main, README instructions, license, and History entry must describe one commit.
7. The baseline result is 1260 passing tests at the snapshot commit; any different result requires a fresh explanation.

## Checkpoint ledger copied into the handoff

The sample graph records one atomic verification for each responsibility, three path integrations, and one plan acceptance. A Markdown reader has to maintain the same list by hand:

- package entry: source export and version check
- application factory: prototype and public export check
- application runtime: middleware, route, render, and listen check
- Router dependency: route matching and middleware traversal check
- request boundary: header, query, protocol, host, and IP check
- response boundary: status, serialization, file, cookie, redirect, and format check
- view rendering: engine lookup and render callback check
- utility layer: MIME, ETag, cache, and extension check
- error finalization: 404 and thrown-error response check
- regression network: complete `npm test` check
- release contract: package metadata and public documentation check
- request path integration: entry → factory → runtime → Router → response
- error path integration: runtime → finalhandler → response
- release path integration: package contract → entry → runtime → tests
- plan acceptance: all eleven atomic checks and three path checks pass

## Application runtime notes

The application runtime is the densest part of the handoff. A Markdown-only reader must carry these details while editing it:

- `app.init` creates settings, locals, mount state, and a lazy router reference.
- `app.defaultConfiguration` establishes `env`, `query parser`, `trust proxy`, `subdomain offset`, `etag`, `x-powered-by`, and `view cache` defaults.
- `app.handle` creates a finalhandler, obtains the router, and calls router.handle with the request and response.
- `app.use` accepts one or more middleware functions, flattens arrays, supports mounted applications, and restores the URL after delegation.
- `app.route` returns a Route bound to a path; `app.param` registers parameter callbacks.
- `app.engine` maps a file extension to a template engine.
- `app.render` creates a View, resolves settings, and invokes the engine callback.
- `app.listen` wraps an HTTP server around the application function and forwards arguments to `server.listen`.
- Settings inherit through mounted applications unless the child overrides them.
- Router methods must preserve registration order, error-handler arity, `next('route')`, and `next('router')` behavior.
- Promise rejections from handlers must enter the error path instead of becoming unhandled process errors.
- A mounted app must retain `parent`, `mountpath`, and the original request parameters after returning to its parent.

The runtime edit checklist therefore includes `test/app.js`, `test/app.use.js`, `test/app.route.js`, `test/app.param.js`, `test/app.render.js`, `test/app.listen.js`, `test/app.router.js`, and the matching acceptance fixtures. A change that only passes a local route test is not enough to close the runtime responsibility.

## Request notes

`lib/request.js` extends Node's IncomingMessage without owning routing. The handoff must preserve the difference between raw input and normalized getters:

- `req.get` and `req.header` read case-insensitive headers and special-case `referer`/`referrer`.
- `req.accepts`, `req.acceptsEncodings`, `req.acceptsCharsets`, and `req.acceptsLanguages` delegate content negotiation to the `accepts` dependency.
- `req.range` parses byte ranges and reports malformed ranges separately from unsatisfied ranges.
- `req.param` follows the legacy precedence of route params, body, and query while warning that explicit sources are preferred.
- `req.is` and `req.protocol` depend on content type, TLS, and the trust-proxy setting.
- `req.hostname`, `req.host`, `req.ip`, and `req.ips` must not trust forwarded headers unless the proxy policy allows them.
- `req.path`, `req.originalUrl`, `req.baseUrl`, and `req.route` expose routing state without changing it.
- `req.fresh`, `req.stale`, and `req.xhr` are derived cache or header views, not independent state.

The request tests are split across `test/req.accepts*.js`, `test/req.host.js`, `test/req.hostname.js`, `test/req.ip.js`, `test/req.ips.js`, `test/req.protocol.js`, `test/req.query.js`, `test/req.range.js`, `test/req.route.js`, and related files. Any proxy or parsing change must be checked against the complete `req.*` family.

## Response notes

`lib/response.js` is a large public boundary. The Markdown-only handoff repeats the following contract because a single summary hides important coupling:

- `res.status` accepts a valid integer HTTP status and rejects invalid codes before headers are sent.
- `res.links` formats link relations; `res.sendStatus` sets a status and sends its standard phrase.
- `res.send` detects strings, buffers, objects, and arrays; it sets content type, length, freshness, and ETag consistently.
- `res.json` and `res.jsonp` serialize according to app settings and escape JSONP payloads safely.
- `res.sendFile` and `res.download` validate paths, handle root options, propagate filesystem errors, and set disposition when needed.
- `res.format` performs content negotiation and sends 406 when no representation matches.
- `res.attachment`, `res.type`, `res.set`, `res.get`, `res.vary`, and `res.location` manage headers without silently overwriting incompatible values.
- `res.cookie` and `res.clearCookie` serialize options, signed values, and expiry behavior.
- `res.redirect` resolves relative URLs, applies the configured escape behavior, and supplies a short body for clients that do not follow redirects.
- `res.render` delegates to `app.render` and must not double-send when the view engine fails.
- `res.end` remains the Node response primitive; Express helpers must preserve its lifecycle and chainability.

The response test inventory includes `test/res.append.js`, `res.attachment.js`, `res.cookie.js`, `res.download.js`, `res.format.js`, `res.json.js`, `res.jsonp.js`, `res.links.js`, `res.location.js`, `res.redirect.js`, `res.send.js`, `res.sendFile.js`, `res.sendStatus.js`, `res.set.js`, `res.status.js`, `res.type.js`, and `res.vary.js`. These files are not redundant release clutter: they are the direct evidence for the response Block.

## View and utility notes

View and utility behavior is easy to lose when a document is shortened:

- `View` infers an engine from the filename, resolves absolute and configured view paths, caches successful lookups when `view cache` is enabled, and reports a useful missing-template error.
- `app.engine` must accept extensions with or without a leading dot.
- `utils.compileETag` and `utils.etag` distinguish weak and strong validators.
- `utils.compileQueryParser` supports simple, extended, custom function, and disabled modes.
- `utils.compileTrust` turns numeric hop counts, booleans, arrays, and functions into a trust predicate.
- `utils.flatten` normalizes nested middleware arrays before routing.
- `utils.normalizeType` and `utils.normalizeTypes` retain the original MIME string while exposing the normalized type.
- `utils.setCharset` updates a content type without discarding its existing parameters.

View checks live in `test/app.render.js` and acceptance MVC fixtures. Utility behavior is exercised indirectly by request/response tests; a utility change must therefore run the entire suite rather than only a utility unit test.

## Test and release inventory

The Mocha command loads `test/support/env`, runs every file under `test/`, then runs every file under `test/acceptance/`. The test network includes Route and Router primitives, app settings, middleware, HTTP method helpers, body parsers, static files, request getters, response helpers, regressions, and acceptance examples such as auth, cookies, downloads, error pages, MVC, multi-router, resources, vhosts, and web services.

The package contract is also part of the architecture: `package.json` declares `main: index.js`, version `5.2.1`, Node `>=18`, exports for Router and body parsers, and the exact `npm test` command. The public README explains installation and the Hello World path; LICENSE controls redistribution; History records release changes. A release edit must preserve the relationship between all four files and the fixed source commit.

This appendix is intentionally verbose. It represents the context a Markdown-only agent must carry to achieve the same first-pass recall without a graph. The benchmark compares this complete handoff against mdflow's task-scoped projection, not against an artificially empty README.
