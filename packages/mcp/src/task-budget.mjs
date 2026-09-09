import crypto from "node:crypto";

const budgets = new Map();

function snapshot(entry) {
  return {
    taskContextId: entry.id,
    budgetChars: entry.budgetChars,
    consumedChars: entry.consumedChars,
    remainingChars: Math.max(0, entry.budgetChars - entry.consumedChars),
    responses: entry.responses,
  };
}

export function startTaskBudget({ projectRoot = ".", taskContextId = null, budgetChars = 12000 } = {}) {
  if (taskContextId && budgets.has(taskContextId)) {
    const existing = budgets.get(taskContextId);
    if (existing.projectRoot === projectRoot) return snapshot(existing);
  }
  const entry = {
    id: taskContextId || `task_${crypto.randomUUID()}`,
    projectRoot,
    budgetChars: Math.max(100, Math.floor(Number(budgetChars) || 12000)),
    consumedChars: 0,
    responses: 0,
  };
  budgets.set(entry.id, entry);
  return snapshot(entry);
}

export function taskBudget(taskContextId) {
  const entry = taskContextId ? budgets.get(taskContextId) : null;
  return entry ? snapshot(entry) : null;
}

function truncateMarkdown(markdown, maxChars, suffix) {
  const text = String(markdown ?? "");
  if (text.length <= maxChars) return text;
  const marker = `\n\n${suffix}`;
  if (maxChars <= marker.length) return marker.slice(0, maxChars);
  return `${text.slice(0, maxChars - marker.length)}${marker}`;
}

export function boundTaskResponse({ taskContextId, markdown, data, includeStructured = false } = {}) {
  const entry = taskContextId ? budgets.get(taskContextId) : null;
  if (!entry) return { markdown, structured: includeStructured ? data : undefined, budget: null };

  const before = snapshot(entry);
  const suffix = `[task budget ${before.remainingChars} chars remaining; keep taskContextId=${entry.id} for focused expansion]`;
  const markdownText = String(markdown ?? "");
  const structuredText = includeStructured ? JSON.stringify(data ?? {}) : "";
  const available = before.remainingChars;
  let boundedMarkdown = markdownText;
  let structured;
  if (!includeStructured) {
    boundedMarkdown = truncateMarkdown(markdownText, available, suffix);
  } else if (markdownText.length + structuredText.length <= available) {
    structured = data;
  } else {
    const receipt = {
      taskContextId: entry.id,
      budget: snapshot(entry),
      truncated: true,
      reason: "structured projection exceeded the remaining task budget",
    };
    structured = JSON.stringify(receipt).length <= available
      ? receipt
      : { taskContextId: entry.id, truncated: true };
  }
  if (includeStructured) {
    const structuredChars = JSON.stringify(structured).length;
    boundedMarkdown = truncateMarkdown(markdownText, Math.max(0, available - structuredChars), suffix);
  }
  const returnedChars = boundedMarkdown.length + (includeStructured ? JSON.stringify(structured ?? {}).length : 0);
  entry.consumedChars += Math.min(available, returnedChars);
  entry.responses += 1;
  const after = snapshot(entry);
  return { markdown: boundedMarkdown, structured, budget: after };
}

export function resetTaskBudgets() {
  budgets.clear();
}
