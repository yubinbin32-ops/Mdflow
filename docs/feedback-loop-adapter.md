# Feedback-loop adapter contract

The deterministic Todo replay is the local regression. A real external LLM study uses the same fixture and a caller-supplied adapter so the model, context, edits, recovery, and handoff remain auditable.

## Run

Set an adapter command and an explicit model name:

```sh
export MDFLOW_LLM_ADAPTER='your-llm-runner --non-interactive'
export MDFLOW_LLM_MODEL='provider/model-version'
npm run benchmark:feedback-loop:external
```

The command is run twice in clean temporary projects. The harness sets:

| Variable | Meaning |
| --- | --- |
| `MDFLOW_FEEDBACK_ROOT` | Temporary project root; edits must stay inside it |
| `MDFLOW_FEEDBACK_CONTEXT` | Markdown context pack for the current path |
| `MDFLOW_FEEDBACK_SOURCE` | Seeded `src/api/todo.ts` containing the validation defect |
| `MDFLOW_FEEDBACK_MODE` | `mdflow-first` or `markdown-first` |
| `MDFLOW_FEEDBACK_TASK` | The task prompt supplied to both paths |
| `MDFLOW_FEEDBACK_EXPECTED_REPAIR` | The exact validation behavior the smoke test expects |

The adapter must read the context file, inspect the source, edit the source, and exit zero. The harness then runs the Todo smoke test, records changed lines and elapsed time, records a checkpoint for the mdflow path, reopens the graph, and checks `changes_since` recovery. The Markdown path rereads its full context as the comparison baseline.

## Claim boundary

The report sets `llmClaim=true` only when the caller supplies both `--claim-llm` and `--model`. That flag is an attestation, not a provider identity proof; retain the adapter's stdout/stderr and review it before closing the Plan gate. The bundled adapter-contract test intentionally keeps `llmClaim=false`, because it is a protocol test rather than an LLM evaluation.

The current workspace cannot run this gate while the external inference endpoint is unreachable. The deterministic baseline remains separately reported as `llmClaim=false`.
