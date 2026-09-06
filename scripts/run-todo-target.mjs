import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTargetScenario } from "../benchmarks/todo-target/src/scenario.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = await runTargetScenario();
const output = process.argv.find((argument) => argument.startsWith("--write-report="));
if (output) {
  const target = path.resolve(root, output.slice("--write-report=".length));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
