# Todo target project

This is the small real target used by the mdflow context benchmark. It is intentionally a complete, isolated vertical slice rather than a prose-only fixture:

```text
Browser UI → HTTP API → SQLite migration/store → provider → retry worker
```

The target verifies:

- idempotent schema migration;
- create flow and visible validation errors;
- provider timeout classification;
- retry recovery without a duplicate Todo row;
- idempotent replay after success;
- a real HTML surface and HTTP boundary.

Run it with:

```sh
npm run benchmark:todo:target
```

The command writes the deterministic result to `benchmarks/todo-target-results.json`. It is an experiment target, not part of the shipped macOS application.
