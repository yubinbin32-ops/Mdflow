import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { getEncoding } from "js-tiktoken";
import { createService } from "../packages/mcp/src/service.mjs";

export const BLOCKS = [
  {
    id: "todo-ui",
    kind: "ui",
    title: "Todo UI",
    summary: "Render the Todo list, add form, completion state, and optimistic error banner.",
    layer: "client",
    source: "src/ui/TodoView.tsx",
  },
  {
    id: "todo-api",
    kind: "service",
    title: "Todo API",
    summary: "Validate commands, persist changes, and return a stable Todo response.",
    layer: "boundary",
    source: "src/api/todo.ts",
  },
  {
    id: "todo-db",
    kind: "database",
    title: "Todo Database",
    summary: "Store Todo rows, indexes, and the forward-only migration.",
    layer: "data",
    source: "src/data/todo.sql",
  },
  {
    id: "todo-provider",
    kind: "integration",
    title: "Todo Provider Sync",
    summary: "Sync completed items and classify provider timeouts for retry.",
    layer: "external",
    source: "src/provider/sync.ts",
  },
  {
    id: "todo-worker",
    kind: "function",
    title: "Todo Retry Worker",
    summary: "Process retryable provider failures without duplicating a Todo.",
    layer: "application",
    source: "src/worker/retry.ts",
  },
  {
    id: "todo-tests",
    kind: "test",
    title: "Todo Verification",
    summary: "Verify UI, API, database migration, provider timeout, and recovery behavior.",
    layer: "quality",
    source: "tests/todo.test.ts",
  },
];

const LINKS = [
  ["todo-ui-api", "todo-ui", "todo-api", "calls", "The UI sends validated Todo commands."],
  ["todo-api-db", "todo-api", "todo-db", "writes", "The API persists Todo rows."],
  ["todo-api-provider", "todo-api", "todo-provider", "calls", "The API requests provider synchronization."],
  ["todo-api-worker", "todo-api", "todo-worker", "flows_to", "The API queues retryable provider failures."],
  ["todo-worker-tests", "todo-worker", "todo-tests", "validates", "Tests verify recovery idempotency."],
];

export const TASKS = [
  {
    id: "create",
    prompt: "Implement the Todo add flow from the UI through the API and database, then verify the response.",
    refs: ["block:todo-ui", "block:todo-api", "block:todo-db", "chain:todo-create-flow", "plan:todo-foundation"],
  },
  {
    id: "recover",
    prompt: "Fix provider timeout recovery: queue the worker, avoid duplicate writes, and update the verification evidence.",
    refs: ["block:todo-api", "block:todo-provider", "block:todo-worker", "block:todo-tests", "plan:todo-foundation"],
  },
  {
    id: "migration",
    prompt: "Review the Todo database migration and regression tests before accepting the foundation plan.",
    refs: ["block:todo-db", "block:todo-tests", "plan:todo-foundation"],
  },
];

const encoder = getEncoding("cl100k_base");

function tokens(value) {
  return encoder.encode(String(value ?? "")).length;
}

function writeFixtureSources(root) {
  for (const block of BLOCKS) {
    const file = path.join(root, block.source);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `// Todo benchmark fixture: ${block.title}\nexport const ${block.id.replaceAll("-", "_")} = true;\n`);
  }
}

export function markdownBaseline() {
  const lines = [
    "# Todo website implementation context",
    "",
    "This is the complete Markdown-first handoff for the same isolated Todo fixture.",
    "The UI, API, database, provider, worker, tests, ordered flow, and Foundation Plan are all repeated for every task.",
    "",
    "## Architecture",
  ];
  for (const block of BLOCKS) {
    lines.push(
      `- block:${block.id} (${block.kind}, ${block.layer}): ${block.title} — ${block.summary}`,
      `  Source: ${block.source}`,
      `  Contract: ${block.title} must satisfy its declared behavior and expose evidence to the Plan.`,
    );
  }
  lines.push(
    "",
    "## Links and ordered path",
    ...LINKS.map(([, source, target, kind, contract]) => `- link:${source}-${target} (${kind}): block:${source} → block:${target}; ${contract}`),
    "- chain:todo-create-flow: block:todo-ui → block:todo-api → block:todo-db → block:todo-provider",
    "  The Chain is a reusable path, not the owner of its Blocks.",
    "",
    "## Plan",
    "- plan:todo-foundation: Foundation Plan for UI, API, database, provider, worker, and verification.",
    "- Direct Block work is required for every Block, including the verification Block outside the create Chain.",
    "- Plan acceptance follows Block checkpoints and the Chain integration gate.",
    "",
    "## Recovery requirements",
    "- A provider timeout must enqueue one retry and never duplicate a Todo write.",
    "- Database migration evidence and regression evidence must be attached before acceptance.",
    "",
    "## UI behavior",
    "- The add form disables duplicate submission while the request is in flight.",
    "- The list keeps the optimistic row only when the API returns the canonical identifier.",
    "- A failed request restores the editable draft and exposes the provider/API error without hiding the existing list.",
    "- Completion state is rendered from the API response rather than a second client-only source of truth.",
    "",
    "## API behavior",
    "- Validate non-empty text and reject malformed identifiers before touching the database.",
    "- The create endpoint returns the persisted row, migration version, and sync state.",
    "- Provider timeouts are classified as retryable; validation errors are not retried.",
    "- The worker receives an idempotency key and records the last attempt before calling the provider.",
    "",
    "## Database behavior",
    "- The Todo table has a stable primary key, text, completed flag, sync state, and created timestamp.",
    "- The forward-only migration creates the sync index and can be re-run without duplicating it.",
    "- A transaction contains the Todo insert and its initial retry record.",
    "",
    "## Provider and worker recovery",
    "- Provider responses are normalized to success, retryable timeout, or permanent rejection.",
    "- Retry processing uses bounded backoff, preserves the original Todo id, and stops after the configured attempt limit.",
    "- A second worker invocation for the same idempotency key is a no-op with the previous outcome.",
    "",
    "## Verification and handoff",
    "- UI, API, database, provider, worker, and recovery tests are separate evidence items.",
    "- The ordered Chain gate cannot pass before its Block checks pass.",
    "- The Plan acceptance gate covers direct Block work as well as Chain integration.",
    "- History must report changed fields and before/after values without copying full entities.",
    "- If an expected source location is missing, stop and recover the architecture context before editing.",
    "",
    "## Working notes copied into the Markdown handoff",
    "- Current implementation is planned, not complete; all six Blocks need evidence.",
    "- The Todo create path shares the API and database Blocks with the recovery path.",
    "- The verification Block remains a direct Plan target even though it is not in the create Chain.",
    "- Changes to the UI must be checked against the API contract and migration before they are accepted.",
    "- Changes to provider retry behavior require a regression test and a recovery replay.",
    "- Changes to database schema require a migration test and a clean fixture reset.",
  );
  return lines.join("\n");
}

export function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-todo-benchmark-"));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-todo-data-"));
  fs.mkdirSync(path.join(root, ".mdflow"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".mdflow", "project.json"),
    JSON.stringify({ id: "todo-benchmark", name: "Todo benchmark", schemaVersion: 1 }),
  );
  writeFixtureSources(root);
  const service = createService({ projectRoot: root, dataRoot });
  const operations = [];
  for (const block of BLOCKS) {
    operations.push({
      action: "create_block",
      id: block.id,
      fields: {
        kind: block.kind,
        title: block.title,
        summary: block.summary,
        body: `${block.title} is a first-class Todo architecture responsibility.`,
        contract: `${block.title} exposes its behavior through a verifiable contract.`,
        scope: "todo",
        architectureLayer: block.layer,
        deliveryState: "planned",
        priority: "high",
      },
    });
    operations.push({
      action: "create_checkpoint",
      id: `proof-${block.id}`,
      fields: {
        targetType: "block",
        targetId: block.id,
        title: `Verify ${block.title}`,
        criteria: `${block.title} satisfies its declared Todo responsibility.`,
        checkpointKind: "atomic",
        status: "pending",
        requiredEvidenceLevel: "static",
        coverage: "complete",
      },
    });
    operations.push({
      action: "add_source_ref",
      id: block.id,
      fields: {
        sourceId: `src-${block.id}`,
        path: block.source,
        startLine: 1,
        symbol: block.id.replaceAll("-", "_"),
        role: block.kind === "test" ? "test" : "implementation",
      },
    });
  }
  for (const [id, sourceId, targetId, kind, contract] of LINKS) {
    operations.push({
      action: "create_link",
      id,
      fields: { sourceType: "block", sourceId, targetType: "block", targetId, kind, contract },
    });
  }
  operations.push({
    action: "create_chain",
    id: "todo-create-flow",
    fields: {
      title: "Todo create flow",
      purpose: "Ordered user path",
      intent: "Create, persist, and synchronize a Todo.",
      inputContract: "Todo text",
      outputContract: "Persisted Todo with sync state",
      deliveryState: "planned",
    },
  });
  service.mutate(
    { actor: "benchmark", reason: "Build isolated Todo benchmark architecture", task: "todo-fixture", operations },
    { maxOperations: 100 },
  );
  service.mutate({
    actor: "benchmark",
    reason: "Define the reusable Todo create path",
    task: "todo-fixture",
    operations: [{
      action: "set_chain_path",
      id: "todo-create-flow",
      expectedRevision: 1,
      fields: {
        nodeIds: ["todo-ui", "todo-api", "todo-db", "todo-provider"],
        linkIds: ["todo-ui-api", "todo-api-db", "todo-api-provider"],
      },
    }],
  });
  service.createFoundationPlan({
    id: "todo-foundation",
    title: "Todo Foundation Plan",
    goal: "Implement and verify the complete Todo website architecture.",
    requiredEvidenceLevel: "integration",
    actor: "benchmark",
    reason: "Generate direct Block work and Chain gates for the Todo benchmark",
  });
  return {
    root,
    dataRoot,
    service,
    cleanup() {
      service.close();
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(dataRoot, { recursive: true, force: true });
    },
  };
}

function scorePack(pack, expectedRefs) {
  const searchable = `${pack.markdown}\n${(pack.refs ?? []).join(" ")}`;
  const missingRefs = expectedRefs.filter((ref) => !searchable.includes(ref));
  return {
    expected: expectedRefs.length,
    recalled: expectedRefs.length - missingRefs.length,
    missingRefs,
    recallRate: expectedRefs.length === 0 ? 1 : (expectedRefs.length - missingRefs.length) / expectedRefs.length,
  };
}

function evaluatePath(name, contexts, baseline, durationMs) {
  const tasks = contexts.map((context) => {
    const score = scorePack(context.pack, context.refs);
    return {
      id: context.id,
      tokens: tokens(context.text),
      chars: context.text.length,
      ...score,
      reworkTurns: score.missingRefs.length > 0 ? 1 : 0,
    };
  });
  const expected = tasks.reduce((sum, task) => sum + task.expected, 0);
  const recalled = tasks.reduce((sum, task) => sum + task.recalled, 0);
  const errors = tasks.filter((task) => task.missingRefs.length > 0).length;
  return {
    name,
    baselineTokens: tokens(baseline),
    totalTokens: tasks.reduce((sum, task) => sum + task.tokens, 0),
    totalChars: tasks.reduce((sum, task) => sum + task.chars, 0),
    durationMs: Number(durationMs.toFixed(2)),
    expectedFacts: expected,
    recalledFacts: recalled,
    recallRate: expected === 0 ? 1 : recalled / expected,
    errorRate: tasks.length === 0 ? 0 : errors / tasks.length,
    reworkTurns: tasks.reduce((sum, task) => sum + task.reworkTurns, 0),
    tasks,
  };
}

export function runBenchmark() {
  const fixture = createFixture();
  try {
    const baseline = markdownBaseline();
    const mdflowStarted = performance.now();
    const mdflowContexts = TASKS.map((task) => {
      const pack = fixture.service.contextForTask({
        task: task.prompt,
        focusRefs: ["plan:todo-foundation"],
        maxChars: 9000,
      });
      return { id: task.id, refs: task.refs, pack, text: pack.markdown };
    });
    const mdflowDuration = performance.now() - mdflowStarted;
    const markdownStarted = performance.now();
    const markdownContexts = TASKS.map((task) => ({
      id: task.id,
      refs: task.refs,
      pack: { markdown: baseline, refs: [] },
      text: baseline,
    }));
    const markdownDuration = performance.now() - markdownStarted;
    const mdflow = evaluatePath("mdflow-first", mdflowContexts, baseline, mdflowDuration);
    const markdown = evaluatePath("markdown-first", markdownContexts, baseline, markdownDuration);
    const graph = fixture.service.validate();
    const tokenReduction = markdown.totalTokens === 0 ? 0 : 1 - (mdflow.totalTokens / markdown.totalTokens);
    return {
      benchmark: "todo-context-parity",
      tokenizer: "cl100k_base (js-tiktoken)",
      fixture: {
        blocks: BLOCKS.length,
        links: LINKS.length,
        chains: 1,
        plans: 1,
        tasks: TASKS.length,
      },
      mdflow,
      markdown,
      comparison: {
        tokenReduction,
        recalledFactsDelta: mdflow.recalledFacts - markdown.recalledFacts,
        errorRateDelta: mdflow.errorRate - markdown.errorRate,
        reworkTurnsDelta: mdflow.reworkTurns - markdown.reworkTurns,
        reworkTurnsDefinition: "Deterministic recovery proxy: one extra context turn for each task with a missing expected reference; this is not an LLM claim.",
      },
      graphValidation: graph,
    };
  } finally {
    fixture.cleanup();
  }
}

function writeReport(outputPath, result) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runBenchmark();
  const outputArgument = process.argv.find((argument) => argument.startsWith("--write-report="));
  if (outputArgument) writeReport(path.resolve(outputArgument.slice("--write-report=".length)), result);
  console.log(JSON.stringify(result, null, 2));
}
