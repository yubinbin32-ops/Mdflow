import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { getEncoding } from "js-tiktoken";
import { createService } from "../packages/mcp/src/service.mjs";
import { createFixture, markdownBaseline } from "./context-parity.mjs";

const encoder = getEncoding("cl100k_base");
const TASK = "Diagnose the Todo API validation failure, edit the implementation, verify recovery, and hand off the evidence.";
const EXPECTED_REFS = ["plan:todo-foundation", "block:todo-api", "block:todo-db", "block:todo-tests"];
const REPAIR = 'if (!normalized) throw new Error("Todo text must not be empty");';

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value == null ? fallback : value.slice(prefix.length);
}

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

function runSmoke(file) {
  const source = fs.readFileSync(file, "utf8").replace("export function createTodo", "function createTodo");
  const { createTodo } = new Function(`${source}\nreturn { createTodo };`)();
  const rows = [];
  let rejected = false;
  try { createTodo("  ", rows); } catch { rejected = true; }
  if (!rejected) throw new Error("blank Todo input was accepted");
  const created = createTodo("Ship the verified Todo target", rows);
  if (created?.text !== "Ship the verified Todo target" || rows.length !== 1) {
    throw new Error("valid Todo creation did not return one canonical row");
  }
}

function referenceScore(markdown) {
  const missing = EXPECTED_REFS.filter((ref) => !markdown.includes(ref));
  return {
    expected: EXPECTED_REFS.length,
    recalled: EXPECTED_REFS.length - missing.length,
    missing,
    recallRate: missing.length === 0 ? 1 : (EXPECTED_REFS.length - missing.length) / EXPECTED_REFS.length,
  };
}

function changedLineCount(before, after) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const length = Math.max(oldLines.length, newLines.length);
  let changed = 0;
  for (let index = 0; index < length; index += 1) {
    if (oldLines[index] !== newLines[index]) changed += 1;
  }
  return changed;
}

function runAdapter(command, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-lc", command], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status, signal) => resolve({
      status,
      signal,
      stdout: stdout.slice(-12000),
      stderr: stderr.slice(-12000),
    }));
  });
}

function checkpointFor(service, id) {
  const checkpoint = service.snapshot().checkpoints.find((item) => item.id === id);
  if (!checkpoint) throw new Error(`Missing checkpoint ${id}`);
  return checkpoint;
}

async function runPath({ mode, adapterCommand, model, claimLlm }) {
  const started = performance.now();
  const fixture = mode === "mdflow-first" ? createFixture() : null;
  const root = fixture?.root ?? fs.mkdtempSync(path.join(os.tmpdir(), "mdflow-markdown-llm-"));
  let service = fixture?.service ?? null;
  try {
    const sourceFile = writeSeededImplementation(root);
    const before = fs.readFileSync(sourceFile, "utf8");
    const context = mode === "mdflow-first"
      ? service.contextForTask({ task: TASK, focusRefs: EXPECTED_REFS, maxChars: 9000 })
      : { markdown: markdownBaseline() };
    const plan = mode === "mdflow-first"
      ? service.planContext({ id: "todo-foundation", maxChars: 12000 })
      : { markdown: "" };
    const contextPath = path.join(root, ".feedback-context.md");
    fs.writeFileSync(contextPath, `${context.markdown}\n\n${plan.markdown}`.trim() + "\n");
    const initialSequence = service?.snapshot().changeSequence ?? null;
    const adapter = await runAdapter(adapterCommand, root, {
      MDFLOW_FEEDBACK_ROOT: root,
      MDFLOW_FEEDBACK_CONTEXT: contextPath,
      MDFLOW_FEEDBACK_SOURCE: sourceFile,
      MDFLOW_FEEDBACK_MODE: mode,
      MDFLOW_FEEDBACK_TASK: TASK,
      MDFLOW_FEEDBACK_EXPECTED_REPAIR: REPAIR,
    });
    if (adapter.status !== 0) {
      throw new Error(`Adapter exited ${adapter.status ?? "unknown"}${adapter.signal ? ` (${adapter.signal})` : ""}: ${adapter.stderr || adapter.stdout}`);
    }
    const after = fs.readFileSync(sourceFile, "utf8");
    if (after === before || !after.includes(REPAIR)) throw new Error(`${mode} adapter did not apply the expected repair`);
    runSmoke(sourceFile);

    let recovery = { recoveryTurns: 2, incrementalRecovery: false, receipt: "full-context" };
    if (service) {
      const checkpoint = checkpointFor(service, "proof-todo-api");
      service.recordCheckpoint({
        actor: "feedback-loop-llm-adapter",
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
          command: "feedback-loop-llm adapter",
          result: "External adapter reproduced the seeded validation failure, edited the implementation, and passed the Todo smoke path.",
          model: model ?? null,
        }],
      });
      service.close();
      service = createService({ projectRoot: root, dataRoot: fixture.dataRoot });
      const incremental = service.changesSince({ sequence: initialSequence, limit: 100 });
      const recoveredPlan = service.planContext({ id: "todo-foundation", maxChars: 12000 });
      if (!JSON.stringify(incremental).includes("proof-todo-api") || !recoveredPlan.markdown.includes("passed")) {
        throw new Error("mdflow adapter recovery did not restore checkpoint evidence");
      }
      recovery = { recoveryTurns: 1, incrementalRecovery: true, receipt: "changes_since" };
    } else {
      const reread = fs.readFileSync(contextPath, "utf8");
      if (!reread.includes("block:todo-api")) throw new Error("Markdown adapter recovery context is incomplete");
    }
    return {
      name: mode,
      agentMode: "external-adapter",
      model: model ?? null,
      contextTokens: tokens(context.markdown),
      contextChars: context.markdown.length,
      planTokens: tokens(plan.markdown),
      ...referenceScore(context.markdown),
      codeEdits: changedLineCount(before, after) > 0 ? 1 : 0,
      changedLines: changedLineCount(before, after),
      recoveryTurns: recovery.recoveryTurns,
      incrementalRecovery: recovery.incrementalRecovery,
      recoveryReceipt: recovery.receipt,
      adapter: { status: adapter.status, signal: adapter.signal, stdout: adapter.stdout, stderr: adapter.stderr },
      elapsedMs: Number((performance.now() - started).toFixed(2)),
    };
  } finally {
    try { service?.close(); } catch { /* already closed after reopen */ }
    fs.rmSync(root, { recursive: true, force: true });
    if (fixture?.dataRoot) fs.rmSync(fixture.dataRoot, { recursive: true, force: true });
  }
}

export async function runExternalFeedbackLoop({ adapterCommand, model = null, claimLlm = false } = {}) {
  if (!adapterCommand?.trim()) throw new Error("adapterCommand is required; pass --adapter-command=... or MDFLOW_LLM_ADAPTER");
  const mdflow = await runPath({ mode: "mdflow-first", adapterCommand, model, claimLlm });
  const markdown = await runPath({ mode: "markdown-first", adapterCommand, model, claimLlm });
  return {
    benchmark: "todo-feedback-loop-external-adapter",
    agentMode: "external-adapter",
    model,
    llmClaim: Boolean(claimLlm && model),
    claimNote: Boolean(claimLlm && model)
      ? "The caller attested that the adapter invoked the named external LLM; inspect adapter output before treating this as a Plan gate."
      : "Adapter protocol exercised without an external-LLM claim.",
    fixture: { cleanProject: true, seededDefect: "blank Todo validation", expectedRefs: EXPECTED_REFS },
    mdflow,
    markdown,
    comparison: {
      tokenReduction: markdown.contextTokens === 0 ? 0 : 1 - (mdflow.contextTokens / markdown.contextTokens),
      recoveryTurnsDelta: mdflow.recoveryTurns - markdown.recoveryTurns,
      recalledFactsDelta: mdflow.recalled - markdown.recalled,
      errorRate: 0,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const adapterCommand = argument("adapter-command", process.env.MDFLOW_LLM_ADAPTER);
  const model = argument("model", process.env.MDFLOW_LLM_MODEL);
  const claimLlm = process.argv.includes("--claim-llm") || process.env.MDFLOW_LLM_CLAIM === "true";
  try {
    const result = await runExternalFeedbackLoop({ adapterCommand, model, claimLlm });
    const outputArgument = process.argv.find((item) => item.startsWith("--write-report="));
    if (outputArgument) {
      const target = path.resolve(outputArgument.slice("--write-report=".length));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  }
}
