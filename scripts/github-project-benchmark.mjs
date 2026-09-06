import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { getEncoding } from "js-tiktoken";
import { createService } from "../packages/mcp/src/service.mjs";

const REPOSITORY = "https://github.com/expressjs/express";
const COMMIT = "023767fe9872e029271df1418f73401bff20ff40";
const VERSION = "5.2.1";
const encoder = getEncoding("cl100k_base");

const TASKS = [
  {
    id: "response-boundary",
    prompt: "理解 Express 的请求处理路径，并为一个 response 边界修改定位实现、依赖和回归测试。",
    refs: ["lib/response.js", "lib/application.js", "router", "test/"],
    focusRefs: ["block:express-response", "block:express-runtime", "block:express-router", "block:express-tests", "chain:express-request-path"],
    expandRefs: ["block:express-response", "block:express-tests"],
  },
  {
    id: "error-path",
    prompt: "定位 Express 未处理请求和错误的收尾路径，准备一个不会重复写响应的修改。",
    refs: ["finalhandler", "lib/application.js", "lib/response.js", "test/acceptance"],
    focusRefs: ["block:express-runtime", "block:express-finalhandler", "block:express-response", "block:express-tests", "chain:express-error-path"],
    expandRefs: ["block:express-runtime", "block:express-finalhandler", "block:express-response"],
  },
  {
    id: "release-contract",
    prompt: "准备 Express 5.2.1 的发布更新，核对公开入口、版本、测试命令和发布历史。",
    refs: ["package.json", "index.js", "npm test", "History.md"],
    focusRefs: ["block:express-release-contract", "block:express-entry", "block:express-tests", "chain:express-release-path", "plan:express-foundation"],
    expandRefs: ["block:express-release-contract", "block:express-entry"],
  },
];

function tokenCount(text) {
  return encoder.encode(String(text ?? "")).length;
}

function score(text, refs) {
  const haystack = String(text ?? "").toLowerCase();
  const missingRefs = refs.filter((ref) => !haystack.includes(ref.toLowerCase()));
  return {
    expectedFacts: refs.length,
    recalledFacts: refs.length - missingRefs.length,
    missingRefs,
    recallRate: refs.length === 0 ? 1 : (refs.length - missingRefs.length) / refs.length,
    reworkTurns: missingRefs.length > 0 ? 1 : 0,
  };
}

function expandedMdflowText(service, task, pack) {
  const sections = [pack.markdown ?? ""];
  for (const ref of task.expandRefs ?? task.focusRefs) {
    const [type, id] = String(ref).split(":", 2);
    if (type === "block" || type === "chain" || type === "plan") {
      const opened = service.entityOpen({ type, id, historyLimit: 2, locale: "zh-Hans" });
      if (opened?.markdown) sections.push(`\n## Expanded ${ref}\n${opened.markdown}`);
    }
  }
  return sections.join("\n");
}

function summarize(name, rows, baselineText) {
  const expectedFacts = rows.reduce((sum, row) => sum + row.expectedFacts, 0);
  const recalledFacts = rows.reduce((sum, row) => sum + row.recalledFacts, 0);
  return {
    name,
    tasks: rows,
    totalTokens: rows.reduce((sum, row) => sum + row.tokens, 0),
    totalChars: rows.reduce((sum, row) => sum + row.chars, 0),
    assemblyMs: Number(rows.reduce((sum, row) => sum + row.assemblyMs, 0).toFixed(2)),
    expectedFacts,
    recalledFacts,
    recallRate: expectedFacts === 0 ? 1 : recalledFacts / expectedFacts,
    reworkTurns: rows.reduce((sum, row) => sum + row.reworkTurns, 0),
    baselineTokensPerTask: tokenCount(baselineText),
  };
}

export function runBenchmark({ projectRoot = process.env.MDFLOW_EXPRESS_ROOT || "/private/tmp/mdflow-express", baselinePath = path.resolve("benchmarks/open-source/express/markdown-baseline.md") } = {}) {
  const baseline = fs.readFileSync(baselinePath, "utf8");
  const service = createService({ projectRoot });
  try {
    const mdflowRows = TASKS.map((task) => {
      const started = performance.now();
      const pack = service.contextForTask({ task: task.prompt, focusRefs: task.focusRefs, maxChars: 12000 });
      const text = expandedMdflowText(service, task, pack);
      const facts = score(text, task.refs);
      return {
        id: task.id,
        tokens: tokenCount(text),
        chars: text.length,
        assemblyMs: Number((performance.now() - started).toFixed(2)),
        ...facts,
      };
    });
    const markdownRows = TASKS.map((task) => {
      const started = performance.now();
      const text = fs.readFileSync(baselinePath, "utf8");
      const facts = score(text, task.refs);
      return {
        id: task.id,
        tokens: tokenCount(text),
        chars: text.length,
        assemblyMs: Number((performance.now() - started).toFixed(2)),
        ...facts,
      };
    });
    const mdflow = summarize("mdflow-first", mdflowRows, baseline);
    const markdown = summarize("markdown-first", markdownRows, baseline);
    const graphValidation = service.validate();
    return {
      benchmark: "express-mdflow-vs-markdown",
      method: {
        tokenizer: "cl100k_base (js-tiktoken)",
        deterministic: true,
        llmClaim: false,
        speedDefinition: "context assembly time measured inside one Node process; not human reading time or an LLM latency claim",
        reworkDefinition: "one deterministic proxy turn for each task missing an expected fact; it is not an LLM claim",
        sameTaskSet: true,
        markdownControl: "the complete Markdown handoff is reread for every task",
      },
      repository: { url: REPOSITORY, version: VERSION, commit: COMMIT, projectRoot: "external-checkout" },
      fixture: { tasks: TASKS.length, blocks: 11, links: 12, chains: 3, plans: 1, blockCheckpoints: 11, chainGates: 3, planAcceptanceGates: 1 },
      mdflow,
      markdown,
      comparison: {
        tokenReduction: markdown.totalTokens === 0 ? 0 : 1 - mdflow.totalTokens / markdown.totalTokens,
        charReduction: markdown.totalChars === 0 ? 0 : 1 - mdflow.totalChars / markdown.totalChars,
        assemblyMsDelta: mdflow.assemblyMs - markdown.assemblyMs,
        recalledFactsDelta: mdflow.recalledFacts - markdown.recalledFacts,
        reworkTurnsDelta: mdflow.reworkTurns - markdown.reworkTurns,
      },
      graphValidation,
    };
  } finally {
    service.close();
  }
}

function writeReport(outputPath, result) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputArgument = process.argv.find((argument) => argument.startsWith("--write-report="));
  const result = runBenchmark();
  if (outputArgument) writeReport(path.resolve(outputArgument.slice("--write-report=".length)), result);
  console.log(JSON.stringify(result, null, 2));
}
