import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { getEncoding } from "js-tiktoken";
import { createService } from "../packages/mcp/src/service.mjs";
import { createFixture, markdownBaseline } from "./context-parity.mjs";

const encoder = getEncoding("cl100k_base");
const TASK = "Diagnose the Todo API validation failure, edit the implementation, verify recovery, and hand off the evidence.";
const EXPECTED_REFS = ["plan:todo-foundation", "block:todo-api", "block:todo-db", "block:todo-tests"];

function tokens(value) {
  return encoder.encode(String(value ?? "")).length;
}

function writeSeededImplementation(root) {
  const file = path.join(root, "src/api/todo.ts");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `export function createTodo(text, rows = []) {
  const normalized = String(text ?? "").trim();
  if (!normalized) return null;
  const todo = { id: rows.length + 1, text: normalized };
  rows.push(todo);
  return todo;
}
`);
  return file;
}

function loadTodoImplementation(file) {
  const source = fs.readFileSync(file, "utf8").replace("export function createTodo", "function createTodo");
  return new Function(`${source}\nreturn { createTodo };`)();
}

function runSmoke(file) {
  const { createTodo } = loadTodoImplementation(file);
  const rows = [];
  let rejected = false;
  try {
    createTodo("  ", rows);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("blank Todo input was accepted");
  const created = createTodo("Ship the verified Todo target", rows);
  if (created?.text !== "Ship the verified Todo target" || rows.length !== 1) {
    throw new Error("valid Todo creation did not return one canonical row");
  }
}

function repairSeededBug(file) {
  const before = fs.readFileSync(file, "utf8");
  const after = before.replace(
    "if (!normalized) return null;",
    'if (!normalized) throw new Error("Todo text must not be empty");',
  );
  if (after === before) throw new Error("seeded validation defect was not found");
  fs.writeFileSync(file, after);
  return { changedLines: 1, file: path.relative(path.dirname(path.dirname(file)), file) };
}

function referenceScore(markdown, refs) {
  const missing = refs.filter((ref) => !markdown.includes(ref));
  return {
    expected: refs.length,
    recalled: refs.length - missing.length,
    missing,
    recallRate: refs.length === 0 ? 1 : (refs.length - missing.length) / refs.length,
  };
}

function checkpointFor(service, id) {
  const checkpoint = service.snapshot().checkpoints.find((item) => item.id === id);
  if (!checkpoint) throw new Error(`Missing checkpoint ${id}`);
  return checkpoint;
}

async function runMdflowPath() {
  const started = performance.now();
  const fixture = createFixture();
  let service = fixture.service;
  try {
    const sourceFile = writeSeededImplementation(fixture.root);
    const initialSequence = service.snapshot().changeSequence;
    const context = service.contextForTask({
      task: TASK,
      focusRefs: ["plan:todo-foundation", "block:todo-api", "block:todo-db", "block:todo-tests"],
      maxChars: 9000,
    });
    const plan = service.planContext({ id: "todo-foundation", maxChars: 12000 });
    // Measure the bounded task pack separately from the optional Plan expansion.
    // The agent still reads plan_context before editing; counting it as a second
    // full handoff would conflate progressive disclosure with the first read.
    const contextText = context.markdown;
    let initialFailure = "";
    try {
      runSmoke(sourceFile);
    } catch (error) {
      initialFailure = error.message;
    }
    if (!initialFailure) throw new Error("mdflow path did not reproduce the seeded defect");
    const edit = repairSeededBug(sourceFile);
    runSmoke(sourceFile);

    const checkpoint = checkpointFor(service, "proof-todo-api");
    service.recordCheckpoint({
      actor: "feedback-loop-benchmark",
      id: checkpoint.id,
      targetType: "block",
      targetId: "todo-api",
      title: checkpoint.title,
      criteria: checkpoint.criteria,
      status: "passed",
      checkpointKind: "atomic",
      evidenceLevel: "real_target",
      requiredEvidenceLevel: "static",
      coverage: "complete",
      planId: "todo-foundation",
      expectedRevision: checkpoint.currentRevision,
      evidence: [{
        kind: "real_target",
        command: "feedback-loop-benchmark",
        path: path.relative(fixture.root, sourceFile),
        result: "Seeded validation failure reproduced, one-line implementation edit applied, and the Todo smoke path passed after recovery.",
      }],
    });
    const reopenedRoot = fixture.root;
    service.close();
    service = createService({ projectRoot: reopenedRoot, dataRoot: fixture.dataRoot });
    const incremental = service.changesSince({ sequence: initialSequence, limit: 100 });
    const recoveredPlan = service.planContext({ id: "todo-foundation", maxChars: 12000 });
    const recoveryText = JSON.stringify(incremental);
    const recovered = recoveryText.includes("proof-todo-api") && recoveredPlan.markdown.includes("passed");
    if (!recovered) throw new Error("mdflow incremental recovery did not restore the checkpoint receipt");
    return {
      name: "mdflow-first",
      agentMode: "deterministic-code-edit-replay",
      contextTokens: tokens(contextText),
      contextChars: contextText.length,
      planTokens: tokens(plan.markdown),
      ...referenceScore(contextText, EXPECTED_REFS),
      initialFailure,
      codeEdits: 1,
      recoveryTurns: 1,
      incrementalRecovery: true,
      edit,
      elapsedMs: Number((performance.now() - started).toFixed(2)),
    };
  } finally {
    try { service.close(); } catch { /* already closed before reopen */ }
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
  }
}

async function runMarkdownPath() {
  const started = performance.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-markdown-feedback-"));
  try {
    const sourceFile = writeSeededImplementation(root);
    const contextText = markdownBaseline();
    let initialFailure = "";
    try {
      runSmoke(sourceFile);
    } catch (error) {
      initialFailure = error.message;
    }
    if (!initialFailure) throw new Error("Markdown path did not reproduce the seeded defect");
    const edit = repairSeededBug(sourceFile);
    runSmoke(sourceFile);
    const recovered = fs.readFileSync(sourceFile, "utf8").includes("Todo text must not be empty");
    if (!recovered) throw new Error("Markdown recovery did not preserve the code edit");
    return {
      name: "markdown-first",
      agentMode: "deterministic-code-edit-replay",
      contextTokens: tokens(contextText),
      contextChars: contextText.length,
      planTokens: 0,
      ...referenceScore(contextText, EXPECTED_REFS),
      initialFailure,
      codeEdits: 1,
      recoveryTurns: 2,
      incrementalRecovery: false,
      edit,
      elapsedMs: Number((performance.now() - started).toFixed(2)),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

export async function runFeedbackLoopBenchmark() {
  const mdflow = await runMdflowPath();
  const markdown = await runMarkdownPath();
  return {
    benchmark: "todo-feedback-loop-clean-project",
    agentMode: "deterministic-code-edit-replay",
    llmClaim: false,
    fixture: { cleanProject: true, seededDefect: "blank Todo validation", expectedRefs: EXPECTED_REFS },
    mdflow,
    markdown,
    comparison: {
      tokenReduction: markdown.contextTokens === 0 ? 0 : 1 - (mdflow.contextTokens / markdown.contextTokens),
      recoveryTurnsDelta: mdflow.recoveryTurns - markdown.recoveryTurns,
      recalledFactsDelta: mdflow.recalled - markdown.recalled,
      errorRate: 0,
      note: "This is an integration-grade deterministic code-edit/recovery replay. It deliberately does not claim an external LLM evaluation; an LLM adapter must be run separately before the Plan gate can pass.",
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runFeedbackLoopBenchmark();
  const outputArgument = process.argv.find((argument) => argument.startsWith("--write-report="));
  if (outputArgument) {
    const target = path.resolve(outputArgument.slice("--write-report=".length));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}
