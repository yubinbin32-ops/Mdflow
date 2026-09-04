import crypto from "node:crypto";
import fs from "node:fs";
import { openDatabase, transaction } from "./database.mjs";
import { resolveProjectPaths } from "./paths.mjs";

const BLOCK_KINDS = new Set([
  "principle",
  "product",
  "requirement",
  "decision",
  "flow",
  "ui",
  "service",
  "function",
  "integration",
  "data",
  "database",
  "risk",
  "test",
  "checkpoint",
]);

const DELIVERY_STATES = new Set([
  "proposed",
  "planned",
  "implementing",
  "verifying",
  "complete",
  "deprecated",
]);

const HEALTH_STATES = new Set([
  "unknown",
  "healthy",
  "warning",
  "failing",
  "unstable",
  "disputed",
]);

const PLAN_STATUSES = new Set(["draft", "ready", "active", "verifying", "complete", "blocked", "cancelled"]);

const LINK_KINDS = new Set([
  "flows_to",
  "calls",
  "reads",
  "writes",
  "depends_on",
  "implements",
  "validates",
  "constrains",
  "supersedes",
]);

const EDITABLE_BLOCK_FIELDS = new Set([
  "kind",
  "title",
  "summary",
  "body",
  "contract",
  "deliveryState",
  "healthState",
  "priority",
  "confidence",
  "tags",
  "archived",
]);

const EDITABLE_CHAIN_FIELDS = new Set([
  "title",
  "purpose",
  "intent",
  "inputContract",
  "outputContract",
  "deliveryState",
  "healthState",
  "priority",
  "archived",
]);

const EDITABLE_LINK_FIELDS = new Set([
  "kind",
  "label",
  "contract",
  "healthState",
  "archived",
]);

const EDITABLE_PLAN_FIELDS = new Set([
  "title",
  "summary",
  "goal",
  "status",
  "priority",
  "proposedDelta",
  "nextAction",
  "blockers",
  "archived",
]);

const LOCALIZED_FIELDS = {
  block: new Set(["title", "summary", "body", "contract"]),
  chain: new Set(["title", "intent", "inputContract", "outputContract"]),
  link: new Set(["label", "contract"]),
  plan: new Set(["title", "summary", "goal", "nextAction"]),
};

const LOCALES = new Set(["en", "zh-Hans"]);

function now() {
  return new Date().toISOString();
}

function identifier(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeTags(value) {
  if (!Array.isArray(value)) return "[]";
  return JSON.stringify([...new Set(value.map(String).filter(Boolean))]);
}

function camelToColumn(field) {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function assertAllowed(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`Invalid ${label}: ${value}`);
}

function entityExists(database, projectId, type, id) {
  const table = type === "block" ? "blocks" : type === "chain" ? "chains" : type === "plan" ? "plans" : null;
  if (!table) return false;
  return Boolean(
    database.prepare(`SELECT 1 FROM ${table} WHERE project_id = ? AND id = ?`).get(projectId, id),
  );
}

function normalizeBlock(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    body: row.body,
    contract: row.contract,
    deliveryState: row.delivery_state,
    healthState: row.health_state,
    priority: row.priority,
    confidence: row.confidence,
    tags: parseJson(row.tags_json, []),
    currentRevision: row.current_revision,
    archived: Boolean(row.archived),
    updatedAt: row.updated_at,
  };
}

function normalizeChain(row) {
  return {
    id: row.id,
    title: row.title,
    purpose: row.purpose,
    intent: row.intent,
    inputContract: row.input_contract,
    outputContract: row.output_contract,
    deliveryState: row.delivery_state,
    healthState: row.health_state,
    priority: row.priority,
    currentRevision: row.current_revision,
    archived: Boolean(row.archived),
    updatedAt: row.updated_at,
  };
}

function normalizeLink(row) {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    targetType: row.target_type,
    targetId: row.target_id,
    kind: row.kind,
    label: row.label,
    contract: row.contract,
    healthState: row.health_state,
    currentRevision: row.current_revision,
    archived: Boolean(row.archived),
    updatedAt: row.updated_at,
  };
}

function normalizePlan(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    goal: row.goal,
    status: row.status,
    priority: row.priority,
    proposedDelta: parseJson(row.proposed_delta_json, []),
    nextAction: row.next_action,
    blockers: parseJson(row.blockers_json, []),
    currentRevision: row.current_revision,
    archived: Boolean(row.archived),
    updatedAt: row.updated_at,
  };
}

function normalizeLocalizations(rows) {
  return rows.map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
    locale: row.locale,
    field: row.field,
    value: row.value,
  }));
}

function localizationMap(snapshot) {
  return new Map(
    snapshot.localizations.map((item) => [
      `${item.entityType}:${item.entityId}:${item.locale}:${item.field}`,
      item.value,
    ]),
  );
}

function localizedValue(map, type, id, locale, field, fallback = "") {
  return map.get(`${type}:${id}:${locale}:${field}`) ?? fallback;
}

function localizedSearchText(snapshot, type, id) {
  return snapshot.localizations
    .filter((item) => item.entityType === type && item.entityId === id)
    .map((item) => item.value)
    .join(" ");
}

function taskTerms(task) {
  const terms = task
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length > 1);
  const cjkRuns = task.match(/[\p{Script=Han}]+/gu) ?? [];
  for (const run of cjkRuns) {
    for (let index = 0; index < run.length - 1; index += 1) terms.push(run.slice(index, index + 2));
  }
  return [...new Set(terms)];
}

export class MdflowService {
  constructor(options = {}) {
    this.paths = resolveProjectPaths(options);
    this.database = openDatabase(this.paths.databasePath);
    this.ensureProject();
  }

  close() {
    this.database.close();
  }

  ensureProject() {
    const timestamp = now();
    this.database
      .prepare(
        `INSERT INTO projects(id, name, repo_root, schema_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, repo_root = excluded.repo_root,
           schema_version = excluded.schema_version, updated_at = excluded.updated_at`,
      )
      .run(
        this.paths.descriptor.id,
        this.paths.descriptor.name,
        this.paths.projectRoot,
        this.paths.descriptor.schemaVersion ?? 1,
        timestamp,
        timestamp,
      );
  }

  project() {
    return this.database.prepare("SELECT * FROM projects WHERE id = ?").get(this.paths.descriptor.id);
  }

  snapshot() {
    const projectId = this.paths.descriptor.id;
    const blocks = this.database
      .prepare("SELECT * FROM blocks WHERE project_id = ? AND archived = 0 ORDER BY title")
      .all(projectId)
      .map(normalizeBlock);
    const chains = this.database
      .prepare("SELECT * FROM chains WHERE project_id = ? AND archived = 0 ORDER BY updated_at DESC")
      .all(projectId)
      .map(normalizeChain);
    const plans = this.database
      .prepare("SELECT * FROM plans WHERE project_id = ? AND archived = 0 ORDER BY updated_at DESC")
      .all(projectId)
      .map(normalizePlan);
    const links = this.database
      .prepare("SELECT * FROM links WHERE project_id = ? AND archived = 0 ORDER BY created_at")
      .all(projectId)
      .map(normalizeLink);
    const members = this.database
      .prepare(
        `SELECT cm.* FROM chain_members cm
         JOIN chains c ON c.id = cm.chain_id
         WHERE c.project_id = ? ORDER BY cm.chain_id, cm.position`,
      )
      .all(projectId)
      .map((row) => ({
        chainId: row.chain_id,
        memberType: row.member_type,
        memberId: row.member_id,
        position: row.position,
      }));
    const chainNodes = this.database
      .prepare(
        `SELECT cn.* FROM chain_nodes cn JOIN chains c ON c.id = cn.chain_id
         WHERE c.project_id = ? ORDER BY cn.chain_id, cn.position`,
      )
      .all(projectId)
      .map((row) => ({ chainId: row.chain_id, blockId: row.block_id, position: row.position, role: row.role }));
    const chainEdges = this.database
      .prepare(
        `SELECT ce.* FROM chain_edges ce JOIN chains c ON c.id = ce.chain_id
         WHERE c.project_id = ? ORDER BY ce.chain_id, ce.position`,
      )
      .all(projectId)
      .map((row) => ({ chainId: row.chain_id, linkId: row.link_id, position: row.position }));
    const planChainRefs = this.database
      .prepare(
        `SELECT pcr.* FROM plan_chain_refs pcr JOIN plans p ON p.id = pcr.plan_id
         WHERE p.project_id = ? ORDER BY pcr.plan_id, pcr.position`,
      )
      .all(projectId)
      .map((row) => ({ planId: row.plan_id, chainId: row.chain_id, position: row.position }));
    const backgroundScopes = this.database
      .prepare(
        `SELECT bs.* FROM background_scopes bs JOIN blocks b ON b.id = bs.block_id
         WHERE b.project_id = ? ORDER BY bs.block_id, bs.scope_type, bs.scope_value`,
      )
      .all(projectId)
      .map((row) => ({ blockId: row.block_id, scopeType: row.scope_type, scopeValue: row.scope_value }));
    const sourceRefs = this.database
      .prepare(
        `SELECT sr.* FROM source_refs sr JOIN blocks b ON b.id = sr.block_id
         WHERE b.project_id = ? ORDER BY sr.path, sr.start_line`,
      )
      .all(projectId)
      .map((row) => ({
        id: row.id,
        blockId: row.block_id,
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        symbol: row.symbol,
        role: row.role,
        gitCommit: row.git_commit,
      }));
    const checkpoints = this.database
      .prepare("SELECT * FROM checkpoints WHERE project_id = ? ORDER BY updated_at DESC")
      .all(projectId)
      .map((row) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        title: row.title,
        criteria: row.criteria,
        status: row.status,
        evidence: parseJson(row.evidence_json, []),
        currentRevision: row.current_revision,
        updatedAt: row.updated_at,
      }));
    const localizations = normalizeLocalizations(
      this.database
        .prepare(
          `SELECT lt.* FROM localized_text lt
           WHERE EXISTS (
             SELECT 1 FROM blocks b WHERE b.project_id = ? AND lt.entity_type = 'block' AND b.id = lt.entity_id
             UNION ALL
             SELECT 1 FROM chains c WHERE c.project_id = ? AND lt.entity_type = 'chain' AND c.id = lt.entity_id
             UNION ALL
             SELECT 1 FROM links l WHERE l.project_id = ? AND lt.entity_type = 'link' AND l.id = lt.entity_id
             UNION ALL
             SELECT 1 FROM plans p WHERE p.project_id = ? AND lt.entity_type = 'plan' AND p.id = lt.entity_id
           )`,
        )
        .all(projectId, projectId, projectId, projectId),
    );
    const changeSequence =
      this.database
        .prepare("SELECT COALESCE(MAX(sequence), 0) AS value FROM change_feed WHERE project_id = ?")
        .get(projectId).value ?? 0;

    return {
      project: {
        id: projectId,
        name: this.paths.descriptor.name,
        graphRevision: this.project().graph_revision,
        root: this.paths.projectRoot,
      },
      changeSequence,
      blocks,
      chains,
      plans,
      links,
      members,
      chainNodes,
      chainEdges,
      planChainRefs,
      backgroundScopes,
      sourceRefs,
      checkpoints,
      localizations,
    };
  }

  projectMap({ locale = "en" } = {}) {
    const snapshot = this.snapshot();
    assertAllowed(locale, LOCALES, "locale");
    const translations = localizationMap(snapshot);
    const lines = [
      `# ${snapshot.project.name}`,
      `Graph revision: ${snapshot.project.graphRevision}`,
      "",
      "## Plans",
    ];
    const plans = snapshot.plans;
    if (plans.length === 0) lines.push("- None");
    for (const plan of plans) {
      const count = snapshot.planChainRefs.filter((item) => item.planId === plan.id).length;
      const title = localizedValue(translations, "plan", plan.id, locale, "title", plan.title);
      lines.push(
        `- [plan:${plan.id}] ${title} — ${plan.status}, ${count} target chain(s)`,
      );
    }
    lines.push("", "## Project network");
    lines.push(`- ${snapshot.blocks.length} Blocks / ${snapshot.links.length} Links / ${snapshot.chains.length} Chain overlays`);
    for (const block of snapshot.blocks.filter((item) => item.priority === "critical").slice(0, 8)) {
      const title = localizedValue(translations, "block", block.id, locale, "title", block.title);
      lines.push(`- [block:${block.id}] ${title} — ${block.deliveryState}/${block.healthState}`);
    }
    return { snapshot, markdown: lines.join("\n") };
  }

  search({ query, kinds = [], states = [], limit = 20, locale = "en" }) {
    const term = `%${query.trim()}%`;
    const snapshot = this.snapshot();
    assertAllowed(locale, LOCALES, "locale");
    const translations = localizationMap(snapshot);
    const kindSet = new Set(kinds);
    const stateSet = new Set(states);
    const blocks = snapshot.blocks.filter((block) => {
      const text = `${block.title}\n${block.summary}\n${block.body}\n${block.contract}\n${block.tags.join(" ")}\n${localizedSearchText(snapshot, "block", block.id)}`;
      return (
        text.toLowerCase().includes(query.trim().toLowerCase()) &&
        (kindSet.size === 0 || kindSet.has(block.kind)) &&
        (stateSet.size === 0 || stateSet.has(block.deliveryState) || stateSet.has(block.healthState))
      );
    });
    const chains = snapshot.chains.filter((chain) => {
      const text = `${chain.title}\n${chain.intent}\n${chain.inputContract}\n${chain.outputContract}\n${localizedSearchText(snapshot, "chain", chain.id)}`;
      return (
        text.toLowerCase().includes(query.trim().toLowerCase()) &&
        (kindSet.size === 0 || kindSet.has("chain")) &&
        (stateSet.size === 0 || stateSet.has(chain.deliveryState) || stateSet.has(chain.healthState))
      );
    });
    const plans = snapshot.plans.filter((plan) => {
      const text = `${plan.title}\n${plan.summary}\n${plan.goal}\n${plan.nextAction}\n${localizedSearchText(snapshot, "plan", plan.id)}`;
      return text.toLowerCase().includes(query.trim().toLowerCase()) &&
        (kindSet.size === 0 || kindSet.has("plan")) &&
        (stateSet.size === 0 || stateSet.has(plan.status));
    });
    const sourceRows = this.database
      .prepare(
        `SELECT sr.*, b.title FROM source_refs sr JOIN blocks b ON b.id = sr.block_id
         WHERE b.project_id = ? AND (sr.path LIKE ? OR COALESCE(sr.symbol, '') LIKE ?) LIMIT ?`,
      )
      .all(this.paths.descriptor.id, term, term, limit);
    return {
      query,
      results: [
        ...blocks.map((block) => ({ type: "block", id: block.id, title: localizedValue(translations, "block", block.id, locale, "title", block.title), state: block.deliveryState })),
        ...chains.map((chain) => ({ type: "chain", id: chain.id, title: localizedValue(translations, "chain", chain.id, locale, "title", chain.title), state: chain.deliveryState })),
        ...plans.map((plan) => ({ type: "plan", id: plan.id, title: localizedValue(translations, "plan", plan.id, locale, "title", plan.title), state: plan.status })),
        ...sourceRows.map((row) => ({
          type: "source",
          id: row.id,
          title: `${localizedValue(translations, "block", row.block_id, locale, "title", row.title)}: ${row.path}${row.start_line ? `:${row.start_line}` : ""}`,
          blockId: row.block_id,
        })),
      ].slice(0, limit),
    };
  }

  entityOpen({ type, id, historyLimit = 8, locale = "en" }) {
    const projectId = this.paths.descriptor.id;
    let entity;
    if (type === "block") {
      const row = this.database.prepare("SELECT * FROM blocks WHERE project_id = ? AND id = ?").get(projectId, id);
      if (row) entity = normalizeBlock(row);
    } else if (type === "chain") {
      const row = this.database.prepare("SELECT * FROM chains WHERE project_id = ? AND id = ?").get(projectId, id);
      if (row) entity = normalizeChain(row);
    } else if (type === "link") {
      const row = this.database.prepare("SELECT * FROM links WHERE project_id = ? AND id = ?").get(projectId, id);
      if (row) entity = normalizeLink(row);
    } else if (type === "plan") {
      const row = this.database.prepare("SELECT * FROM plans WHERE project_id = ? AND id = ?").get(projectId, id);
      if (row) entity = normalizePlan(row);
    }
    if (!entity) throw new Error(`${type}:${id} not found`);

    const checkpoints = this.database
      .prepare(
        "SELECT * FROM checkpoints WHERE project_id = ? AND target_type = ? AND target_id = ? ORDER BY updated_at DESC",
      )
      .all(projectId, type, id)
      .map((row) => ({
        id: row.id,
        title: row.title,
        criteria: row.criteria,
        status: row.status,
        evidence: parseJson(row.evidence_json, []),
        updatedAt: row.updated_at,
      }));
    const history = this.database
      .prepare(
        `SELECT h.* FROM history h JOIN change_sets cs ON cs.id = h.change_set_id
         WHERE cs.project_id = ? AND h.entity_type = ? AND h.entity_id = ?
         ORDER BY h.id DESC LIMIT ?`,
      )
      .all(projectId, type, id, historyLimit)
      .map((row) => ({
        action: row.action,
        revision: row.revision,
        summary: row.summary,
        createdAt: row.created_at,
      }));
    const sourceRefs =
      type === "block"
        ? this.database
            .prepare("SELECT * FROM source_refs WHERE block_id = ? ORDER BY created_at")
            .all(id)
            .map((row) => ({
              id: row.id,
              path: row.path,
              startLine: row.start_line,
              endLine: row.end_line,
              symbol: row.symbol,
              role: row.role,
              gitCommit: row.git_commit,
            }))
        : [];
    const members =
      type === "chain"
        ? this.database
            .prepare("SELECT chain_id, 'block' AS member_type, block_id AS member_id, position FROM chain_nodes WHERE chain_id = ? ORDER BY position")
            .all(id)
            .map((row) => ({
              memberType: row.member_type,
              memberId: row.member_id,
              position: row.position,
            }))
        : [];
    const edgeRefs =
      type === "chain"
        ? this.database.prepare("SELECT link_id, position FROM chain_edges WHERE chain_id = ? ORDER BY position").all(id)
            .map((row) => ({ linkId: row.link_id, position: row.position }))
        : [];
    const targetChains =
      type === "plan"
        ? this.database.prepare("SELECT chain_id, position FROM plan_chain_refs WHERE plan_id = ? ORDER BY position").all(id)
            .map((row) => ({ chainId: row.chain_id, position: row.position }))
        : [];

    assertAllowed(locale, LOCALES, "locale");
    const snapshot = this.snapshot();
    const translations = localizationMap(snapshot);
    const field = type === "link" ? "label" : "title";
    const displayTitle = localizedValue(translations, type, id, locale, field, entity[field] ?? `${type}:${id}`);
    const displaySummary = localizedValue(translations, type, id, locale, type === "chain" ? "intent" : "summary", entity.intent ?? entity.summary ?? "");
    const displayContract = localizedValue(translations, type, id, locale, "contract", entity.contract ?? "");
    const displayInput = localizedValue(translations, type, id, locale, "inputContract", entity.inputContract ?? "");
    const displayOutput = localizedValue(translations, type, id, locale, "outputContract", entity.outputContract ?? "");
    const lines = [`# ${displayTitle}`, ""];
    lines.push(`- Ref: ${type}:${id}`);
    lines.push(`- Revision: ${entity.currentRevision}`);
    if (entity.deliveryState) lines.push(`- Delivery: ${entity.deliveryState}`);
    if (entity.status) lines.push(`- Status: ${entity.status}`);
    if (entity.healthState) lines.push(`- Health: ${entity.healthState}`);
    if (displaySummary) lines.push("", "## Summary", displaySummary);
    if (displayContract) lines.push("", "## Contract", displayContract);
    if (entity.inputContract || entity.outputContract) {
      lines.push("", "## Contract", `Input: ${displayInput || "—"}`, `Output: ${displayOutput || "—"}`);
    }
    if (type === "plan") {
      const goal = localizedValue(translations, type, id, locale, "goal", entity.goal);
      const nextAction = localizedValue(translations, type, id, locale, "nextAction", entity.nextAction);
      if (goal) lines.push("", "## Goal", goal);
      if (nextAction) lines.push("", "## Next action", nextAction);
      if (targetChains.length) {
        lines.push("", "## Target chains");
        for (const target of targetChains) lines.push(`- [chain:${target.chainId}]`);
      }
      if (entity.proposedDelta.length) lines.push("", "## Proposed graph delta", JSON.stringify(entity.proposedDelta));
      if (entity.blockers.length) lines.push("", "## Blockers", ...entity.blockers.map((item) => `- ${item}`));
    }
    if (sourceRefs.length) {
      lines.push("", "## Files & Code");
      for (const source of sourceRefs) {
        lines.push(
          `- ${source.role}: ${source.path}${source.startLine ? `:${source.startLine}` : ""}${source.symbol ? ` (${source.symbol})` : ""}`,
        );
      }
    }
    if (checkpoints.length) {
      lines.push("", "## Checkpoints");
      for (const checkpoint of checkpoints) lines.push(`- ${checkpoint.status}: ${checkpoint.title}`);
    }
    if (history.length) {
      lines.push("", "## Relevant history");
      for (const item of history) lines.push(`- r${item.revision} ${item.action}: ${item.summary}`);
    }
    return { entity, sourceRefs, members, edgeRefs, targetChains, checkpoints, history, markdown: lines.join("\n") };
  }

  contextForTask({ task, focusRefs = [], maxChars = 12000, locale = "en" }) {
    const snapshot = this.snapshot();
    assertAllowed(locale, LOCALES, "locale");
    const translations = localizationMap(snapshot);
    const terms = taskTerms(task);
    const scoreText = (text) =>
      terms.reduce((score, term) => score + (text.toLowerCase().includes(term) ? 1 : 0), 0);
    const scoredBlocks = snapshot.blocks
      .map((block) => ({
        block,
        score:
          scoreText(`${block.title} ${block.summary} ${block.body} ${block.contract} ${block.tags.join(" ")} ${localizedSearchText(snapshot, "block", block.id)}`) +
          (focusRefs.includes(`block:${block.id}`) ? 100 : 0) +
          (["principle", "decision"].includes(block.kind) && block.priority === "critical" ? 2 : 0),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    const scoredChains = snapshot.chains
      .map((chain) => ({
        chain,
        score:
          scoreText(`${chain.title} ${chain.intent} ${chain.inputContract} ${chain.outputContract} ${localizedSearchText(snapshot, "chain", chain.id)}`) +
          (focusRefs.includes(`chain:${chain.id}`) ? 100 : 0),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    const scoredPlans = snapshot.plans
      .map((plan) => ({
        plan,
        score:
          scoreText(`${plan.title} ${plan.summary} ${plan.goal} ${plan.nextAction} ${JSON.stringify(plan.proposedDelta)} ${localizedSearchText(snapshot, "plan", plan.id)}`) +
          (focusRefs.includes(`plan:${plan.id}`) ? 100 : 0) +
          (["active", "blocked", "verifying"].includes(plan.status) ? 1 : 0),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scoredBlocks.length === 0 && scoredChains.length === 0 && scoredPlans.length === 0) {
      for (const plan of snapshot.plans.filter((item) => ["active", "ready", "blocked"].includes(item.status)).slice(0, 3)) {
        scoredPlans.push({ plan, score: 1 });
      }
    }

    const selectedBlockIds = new Set(scoredBlocks.slice(0, 12).map((entry) => entry.block.id));
    const selectedChainIds = new Set(scoredChains.slice(0, 5).map((entry) => entry.chain.id));
    const selectedPlanIds = new Set(scoredPlans.slice(0, 3).map((entry) => entry.plan.id));
    for (const target of snapshot.planChainRefs) {
      if (selectedPlanIds.has(target.planId)) selectedChainIds.add(target.chainId);
    }
    for (const member of snapshot.chainNodes) {
      if (selectedChainIds.has(member.chainId)) selectedBlockIds.add(member.blockId);
    }
    for (const scope of snapshot.backgroundScopes) {
      if (scope.scopeType === "project" ||
          (scope.scopeType === "lens" && terms.some((term) => scope.scopeValue.toLowerCase().includes(term))) ||
          (scope.scopeType === "chain" && selectedChainIds.has(scope.scopeValue))) {
        selectedBlockIds.add(scope.blockId);
      }
    }
    const relevantBlocks = snapshot.blocks.filter((block) => selectedBlockIds.has(block.id));
    const relevantChains = snapshot.chains.filter((chain) => selectedChainIds.has(chain.id));
    const relevantPlans = snapshot.plans.filter((plan) => selectedPlanIds.has(plan.id));
    const relevantLinks = snapshot.links.filter(
      (link) =>
        (selectedBlockIds.has(link.sourceId) || selectedChainIds.has(link.sourceId)) &&
        (selectedBlockIds.has(link.targetId) || selectedChainIds.has(link.targetId)),
    );
    const relevantCheckpoints = snapshot.checkpoints.filter(
      (checkpoint) => selectedBlockIds.has(checkpoint.targetId) || selectedChainIds.has(checkpoint.targetId),
    );

    const lines = ["# Task Context", `Task: ${task}`, `Graph revision: ${snapshot.project.graphRevision}`, ""];
    const constraints = relevantBlocks.filter((block) => ["principle", "decision"].includes(block.kind));
    if (constraints.length) {
      lines.push("## Must-follow constraints");
      for (const block of constraints) {
        const title = localizedValue(translations, "block", block.id, locale, "title", block.title);
        const summary = localizedValue(translations, "block", block.id, locale, "summary", block.summary);
        lines.push(`- [block:${block.id}] ${title}: ${summary}`);
      }
      lines.push("");
    }
    if (relevantPlans.length) {
      lines.push("## Active plans");
      for (const plan of relevantPlans) {
        const title = localizedValue(translations, "plan", plan.id, locale, "title", plan.title);
        const summary = localizedValue(translations, "plan", plan.id, locale, "summary", plan.summary);
        const nextAction = localizedValue(translations, "plan", plan.id, locale, "nextAction", plan.nextAction);
        lines.push(`- [plan:${plan.id}] ${title} — ${plan.status}`);
        if (summary) lines.push(`  ${summary}`);
        if (nextAction) lines.push(`  Next: ${nextAction}`);
      }
      lines.push("");
    }
    if (relevantChains.length) {
      lines.push("## Target chains");
      for (const chain of relevantChains) {
        const title = localizedValue(translations, "chain", chain.id, locale, "title", chain.title);
        const intent = localizedValue(translations, "chain", chain.id, locale, "intent", chain.intent);
        lines.push(`- [chain:${chain.id}] ${title} — ${chain.deliveryState}/${chain.healthState}`);
        if (intent) lines.push(`  ${intent}`);
      }
      lines.push("");
    }
    if (relevantBlocks.length) {
      lines.push("## Relevant blocks");
      for (const block of relevantBlocks) {
        const title = localizedValue(translations, "block", block.id, locale, "title", block.title);
        const summary = localizedValue(translations, "block", block.id, locale, "summary", block.summary);
        const contract = localizedValue(translations, "block", block.id, locale, "contract", block.contract);
        lines.push(`- [block:${block.id}] ${title} — ${block.deliveryState}/${block.healthState}`);
        if (summary) lines.push(`  ${summary}`);
        if (contract) lines.push(`  Contract: ${contract}`);
      }
      lines.push("");
    }
    if (relevantLinks.length) {
      lines.push("## Relationships and interfaces");
      for (const link of relevantLinks) {
        const label = localizedValue(translations, "link", link.id, locale, "label", link.label);
        const contract = localizedValue(translations, "link", link.id, locale, "contract", link.contract);
        lines.push(
          `- ${link.sourceType}:${link.sourceId} -[${link.kind}${label ? `:${label}` : ""}]-> ${link.targetType}:${link.targetId}`,
        );
        if (contract) lines.push(`  Contract: ${contract}`);
      }
      lines.push("");
    }
    const failing = relevantCheckpoints.filter((checkpoint) => checkpoint.status !== "passed");
    if (failing.length) {
      lines.push("## Open checkpoints");
      for (const checkpoint of failing) lines.push(`- ${checkpoint.status}: ${checkpoint.title}`);
      lines.push("");
    }
    lines.push("## Expand", "Use entity_open with a block, chain, or link ID when more detail is needed.");
    const markdown = lines.join("\n").slice(0, maxChars);
    return {
      graphRevision: snapshot.project.graphRevision,
      refs: [
        ...relevantPlans.map((plan) => `plan:${plan.id}`),
        ...relevantChains.map((chain) => `chain:${chain.id}`),
        ...relevantBlocks.map((block) => `block:${block.id}`),
      ],
      markdown,
    };
  }

  mutate({ actor = "agent", reason, task = "", gitHead = null, operations }) {
    if (!reason?.trim()) throw new Error("reason is required");
    if (!Array.isArray(operations) || operations.length === 0) throw new Error("operations are required");
    if (operations.length > 10) throw new Error("graph_mutate accepts at most 10 operations");
    if (JSON.stringify(operations).length > 8192) throw new Error("graph_mutate input exceeds 8 KB");

    const database = this.database;
    const projectId = this.paths.descriptor.id;
    const changeSetId = identifier("change");
    const timestamp = now();
    const receipts = [];

    return transaction(database, () => {
      database
        .prepare(
          `INSERT INTO change_sets(id, project_id, actor, reason, task, git_head, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(changeSetId, projectId, actor, reason.trim(), task, gitHead, timestamp);

      for (const operation of operations) {
        const receipt = this.applyOperation(operation, { changeSetId, timestamp });
        receipts.push(receipt);
        database
          .prepare(
            `INSERT INTO history(change_set_id, entity_type, entity_id, action, revision, summary, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            changeSetId,
            receipt.entityType,
            receipt.id,
            receipt.action,
            receipt.revision,
            receipt.summary,
            timestamp,
          );
        database
          .prepare(
            `INSERT INTO change_feed(project_id, change_set_id, entity_type, entity_id, action, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(projectId, changeSetId, receipt.entityType, receipt.id, receipt.action, timestamp);
      }

      database
        .prepare(
          `UPDATE projects SET graph_revision = graph_revision + 1, updated_at = ? WHERE id = ?`,
        )
        .run(timestamp, projectId);
      const graphRevision = database.prepare("SELECT graph_revision FROM projects WHERE id = ?").get(projectId)
        .graph_revision;
      return { changeSetId, graphRevision, receipts };
    });
  }

  applyOperation(operation, context) {
    switch (operation.action) {
      case "create_block":
        return this.createBlock(operation, context);
      case "update_block":
        return this.updateEntity("block", operation, context);
      case "add_source_ref":
        return this.addSourceRef(operation, context);
      case "remove_source_ref":
        return this.removeSourceRef(operation, context);
      case "create_chain":
        return this.createChain(operation, context);
      case "update_chain":
        return this.updateEntity("chain", operation, context);
      case "set_chain_members":
        return this.setChainMembers(operation, context);
      case "create_link":
        return this.createLink(operation, context);
      case "update_link":
        return this.updateEntity("link", operation, context);
      case "create_plan":
        return this.createPlan(operation, context);
      case "update_plan":
        return this.updateEntity("plan", operation, context);
      case "set_plan_chains":
        return this.setPlanChains(operation, context);
      case "set_chain_path":
        return this.setChainPath(operation, context);
      case "set_background_scopes":
        return this.setBackgroundScopes(operation, context);
      default:
        throw new Error(`Unsupported action: ${operation.action}`);
    }
  }

  applyLocalizations(entityType, entityId, localizations, timestamp) {
    if (localizations == null) return;
    if (typeof localizations !== "object" || Array.isArray(localizations)) {
      throw new Error("fields.localizations must be an object keyed by locale");
    }
    const allowedFields = LOCALIZED_FIELDS[entityType];
    const upsert = this.database.prepare(
      `INSERT INTO localized_text(entity_type, entity_id, locale, field, value, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id, locale, field)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    for (const [locale, values] of Object.entries(localizations)) {
      assertAllowed(locale, LOCALES, "locale");
      if (typeof values !== "object" || Array.isArray(values) || values == null) {
        throw new Error(`Localization for ${locale} must be an object`);
      }
      for (const [field, value] of Object.entries(values)) {
        if (!allowedFields.has(field)) throw new Error(`${field} cannot be localized on ${entityType}`);
        if (typeof value !== "string") throw new Error(`Localized ${field} must be a string`);
        upsert.run(entityType, entityId, locale, field, value, timestamp);
      }
    }
  }

  createPlan(operation, { timestamp }) {
    const fields = operation.fields ?? {};
    if (!fields.title?.trim()) throw new Error("create_plan requires fields.title");
    assertAllowed(fields.status ?? "draft", PLAN_STATUSES, "plan status");
    const id = operation.id ?? identifier("plan");
    this.database.prepare(
      `INSERT INTO plans(
        id, project_id, title, summary, goal, status, priority, proposed_delta_json,
        next_action, blockers_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, this.paths.descriptor.id, fields.title.trim(), fields.summary ?? "", fields.goal ?? "",
      fields.status ?? "draft", fields.priority ?? "normal", JSON.stringify(fields.proposedDelta ?? []),
      fields.nextAction ?? "", JSON.stringify(fields.blockers ?? []), timestamp, timestamp,
    );
    this.applyLocalizations("plan", id, fields.localizations, timestamp);
    return { entityType: "plan", id, action: "created", revision: 1, summary: fields.title.trim() };
  }

  setPlanChains(operation) {
    if (!operation.id || !Number.isInteger(operation.expectedRevision)) {
      throw new Error("set_plan_chains requires id and expectedRevision");
    }
    const plan = this.database.prepare("SELECT * FROM plans WHERE project_id = ? AND id = ?")
      .get(this.paths.descriptor.id, operation.id);
    if (!plan) throw new Error(`plan:${operation.id} not found`);
    if (plan.current_revision !== operation.expectedRevision) {
      throw new Error(`Revision conflict for plan:${operation.id}; expected ${operation.expectedRevision}, current ${plan.current_revision}`);
    }
    const chainIds = operation.fields?.chainIds ?? [];
    for (const chainId of chainIds) {
      if (!entityExists(this.database, this.paths.descriptor.id, "chain", chainId)) throw new Error(`chain:${chainId} not found`);
    }
    this.database.prepare("DELETE FROM plan_chain_refs WHERE plan_id = ?").run(operation.id);
    const insert = this.database.prepare("INSERT INTO plan_chain_refs(plan_id, chain_id, position) VALUES (?, ?, ?)");
    chainIds.forEach((chainId, index) => insert.run(operation.id, chainId, index));
    const revision = plan.current_revision + 1;
    this.database.prepare("UPDATE plans SET current_revision = ?, updated_at = ? WHERE id = ?").run(revision, now(), operation.id);
    return { entityType: "plan", id: operation.id, action: "chains-set", revision, summary: `${chainIds.length} target chain(s)` };
  }

  setChainPath(operation) {
    if (!operation.id || !Number.isInteger(operation.expectedRevision)) {
      throw new Error("set_chain_path requires id and expectedRevision");
    }
    const chain = this.database.prepare("SELECT * FROM chains WHERE project_id = ? AND id = ?")
      .get(this.paths.descriptor.id, operation.id);
    if (!chain) throw new Error(`chain:${operation.id} not found`);
    if (chain.current_revision !== operation.expectedRevision) {
      throw new Error(`Revision conflict for chain:${operation.id}; expected ${operation.expectedRevision}, current ${chain.current_revision}`);
    }
    const nodeIds = operation.fields?.nodeIds ?? [];
    const linkIds = operation.fields?.linkIds ?? [];
    const nodeSet = new Set(nodeIds);
    for (const blockId of nodeIds) {
      if (!entityExists(this.database, this.paths.descriptor.id, "block", blockId)) throw new Error(`block:${blockId} not found`);
    }
    const links = linkIds.map((linkId) => {
      const link = this.database.prepare("SELECT * FROM links WHERE project_id = ? AND id = ? AND archived = 0")
        .get(this.paths.descriptor.id, linkId);
      if (!link) throw new Error(`link:${linkId} not found`);
      if (link.source_type !== "block" || link.target_type !== "block" || !nodeSet.has(link.source_id) || !nodeSet.has(link.target_id)) {
        throw new Error(`link:${linkId} endpoints must both be referenced Chain nodes`);
      }
      return link;
    });
    this.database.prepare("DELETE FROM chain_nodes WHERE chain_id = ?").run(operation.id);
    this.database.prepare("DELETE FROM chain_edges WHERE chain_id = ?").run(operation.id);
    this.database.prepare("DELETE FROM chain_members WHERE chain_id = ?").run(operation.id);
    const insertNode = this.database.prepare("INSERT INTO chain_nodes(chain_id, block_id, position, role) VALUES (?, ?, ?, 'path')");
    const insertMember = this.database.prepare("INSERT INTO chain_members(chain_id, member_type, member_id, position) VALUES (?, 'block', ?, ?)");
    nodeIds.forEach((blockId, index) => {
      insertNode.run(operation.id, blockId, index);
      insertMember.run(operation.id, blockId, index);
    });
    const insertEdge = this.database.prepare("INSERT INTO chain_edges(chain_id, link_id, position) VALUES (?, ?, ?)");
    links.forEach((link, index) => insertEdge.run(operation.id, link.id, index));
    const revision = chain.current_revision + 1;
    this.database.prepare("UPDATE chains SET current_revision = ?, updated_at = ? WHERE id = ?").run(revision, now(), operation.id);
    return { entityType: "chain", id: operation.id, action: "path-set", revision, summary: `${nodeIds.length} nodes / ${linkIds.length} edges` };
  }

  setBackgroundScopes(operation) {
    if (!operation.id || !Number.isInteger(operation.expectedRevision)) {
      throw new Error("set_background_scopes requires block id and expectedRevision");
    }
    const block = this.database.prepare("SELECT * FROM blocks WHERE project_id = ? AND id = ?")
      .get(this.paths.descriptor.id, operation.id);
    if (!block) throw new Error(`block:${operation.id} not found`);
    if (block.current_revision !== operation.expectedRevision) {
      throw new Error(`Revision conflict for block:${operation.id}; expected ${operation.expectedRevision}, current ${block.current_revision}`);
    }
    const scopes = operation.fields?.scopes ?? [];
    const allowed = new Set(["project", "lens", "chain", "repo"]);
    this.database.prepare("DELETE FROM background_scopes WHERE block_id = ?").run(operation.id);
    const insert = this.database.prepare("INSERT INTO background_scopes(block_id, scope_type, scope_value) VALUES (?, ?, ?)");
    for (const scope of scopes) {
      assertAllowed(scope.type, allowed, "background scope type");
      insert.run(operation.id, scope.type, scope.value ?? "*");
    }
    const revision = block.current_revision + 1;
    this.database.prepare("UPDATE blocks SET current_revision = ?, updated_at = ? WHERE id = ?").run(revision, now(), operation.id);
    return { entityType: "block", id: operation.id, action: "scopes-set", revision, summary: `${scopes.length} scope(s)` };
  }

  createBlock(operation, { timestamp }) {
    const fields = operation.fields ?? {};
    assertAllowed(fields.kind, BLOCK_KINDS, "block kind");
    assertAllowed(fields.deliveryState ?? "proposed", DELIVERY_STATES, "delivery state");
    assertAllowed(fields.healthState ?? "unknown", HEALTH_STATES, "health state");
    if (!fields.title?.trim()) throw new Error("create_block requires fields.title");
    const id = operation.id ?? identifier("block");
    this.database
      .prepare(
        `INSERT INTO blocks(
          id, project_id, kind, title, summary, body, contract, delivery_state, health_state,
          priority, confidence, tags_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.paths.descriptor.id,
        fields.kind,
        fields.title.trim(),
        fields.summary ?? "",
        fields.body ?? "",
        fields.contract ?? "",
        fields.deliveryState ?? "proposed",
        fields.healthState ?? "unknown",
        fields.priority ?? "normal",
        fields.confidence ?? "confirmed",
        serializeTags(fields.tags),
        timestamp,
        timestamp,
      );
    this.applyLocalizations("block", id, fields.localizations, timestamp);
    return { entityType: "block", id, action: "created", revision: 1, summary: fields.title.trim() };
  }

  createChain(operation, { timestamp }) {
    const fields = operation.fields ?? {};
    assertAllowed(fields.deliveryState ?? "planned", DELIVERY_STATES, "delivery state");
    assertAllowed(fields.healthState ?? "unknown", HEALTH_STATES, "health state");
    if (!fields.title?.trim()) throw new Error("create_chain requires fields.title");
    const id = operation.id ?? identifier("chain");
    this.database
      .prepare(
        `INSERT INTO chains(
          id, project_id, title, purpose, intent, input_contract, output_contract,
          delivery_state, health_state, priority, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.paths.descriptor.id,
        fields.title.trim(),
        fields.purpose ?? "feature",
        fields.intent ?? "",
        fields.inputContract ?? "",
        fields.outputContract ?? "",
        fields.deliveryState ?? "planned",
        fields.healthState ?? "unknown",
        fields.priority ?? "normal",
        timestamp,
        timestamp,
      );
    this.applyLocalizations("chain", id, fields.localizations, timestamp);
    return { entityType: "chain", id, action: "created", revision: 1, summary: fields.title.trim() };
  }

  createLink(operation, { timestamp }) {
    const fields = operation.fields ?? {};
    assertAllowed(fields.kind, LINK_KINDS, "link kind");
    assertAllowed(fields.healthState ?? "unknown", HEALTH_STATES, "health state");
    if (!entityExists(this.database, this.paths.descriptor.id, fields.sourceType, fields.sourceId)) {
      throw new Error(`Missing link source ${fields.sourceType}:${fields.sourceId}`);
    }
    if (!entityExists(this.database, this.paths.descriptor.id, fields.targetType, fields.targetId)) {
      throw new Error(`Missing link target ${fields.targetType}:${fields.targetId}`);
    }
    const id = operation.id ?? identifier("link");
    this.database
      .prepare(
        `INSERT INTO links(
          id, project_id, source_type, source_id, target_type, target_id, kind, label,
          contract, health_state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.paths.descriptor.id,
        fields.sourceType,
        fields.sourceId,
        fields.targetType,
        fields.targetId,
        fields.kind,
        fields.label ?? "",
        fields.contract ?? "",
        fields.healthState ?? "unknown",
        timestamp,
        timestamp,
      );
    this.applyLocalizations("link", id, fields.localizations, timestamp);
    return { entityType: "link", id, action: "created", revision: 1, summary: fields.label || fields.kind };
  }

  updateEntity(type, operation, { timestamp }) {
    const config = {
      block: { table: "blocks", allowed: EDITABLE_BLOCK_FIELDS, normalizer: normalizeBlock },
      chain: { table: "chains", allowed: EDITABLE_CHAIN_FIELDS, normalizer: normalizeChain },
      link: { table: "links", allowed: EDITABLE_LINK_FIELDS, normalizer: normalizeLink },
      plan: { table: "plans", allowed: EDITABLE_PLAN_FIELDS, normalizer: normalizePlan },
    }[type];
    if (!operation.id || !Number.isInteger(operation.expectedRevision)) {
      throw new Error(`update_${type} requires id and expectedRevision`);
    }
    const existing = this.database
      .prepare(`SELECT * FROM ${config.table} WHERE project_id = ? AND id = ?`)
      .get(this.paths.descriptor.id, operation.id);
    if (!existing) throw new Error(`${type}:${operation.id} not found`);
    if (existing.current_revision !== operation.expectedRevision) {
      throw new Error(
        `Revision conflict for ${type}:${operation.id}; expected ${operation.expectedRevision}, current ${existing.current_revision}`,
      );
    }
    const fields = { ...(operation.fields ?? {}) };
    const localizations = fields.localizations;
    delete fields.localizations;
    const updates = [];
    const values = [];
    for (const [field, rawValue] of Object.entries(fields)) {
      if (!config.allowed.has(field)) throw new Error(`Field ${field} is not editable on ${type}`);
      if (field === "kind" && type === "block") assertAllowed(rawValue, BLOCK_KINDS, "block kind");
      if (field === "kind" && type === "link") assertAllowed(rawValue, LINK_KINDS, "link kind");
      if (field === "deliveryState") assertAllowed(rawValue, DELIVERY_STATES, "delivery state");
      if (field === "healthState") assertAllowed(rawValue, HEALTH_STATES, "health state");
      if (field === "status") assertAllowed(rawValue, PLAN_STATUSES, "plan status");
      const column = field === "proposedDelta" ? "proposed_delta_json" : field === "blockers" ? "blockers_json" : camelToColumn(field);
      updates.push(`${column} = ?`);
      values.push(field === "tags" ? serializeTags(rawValue) : ["proposedDelta", "blockers"].includes(field) ? JSON.stringify(rawValue ?? []) : field === "archived" ? Number(Boolean(rawValue)) : rawValue);
    }
    if (updates.length === 0 && localizations == null) throw new Error(`update_${type} has no fields`);
    const revision = existing.current_revision + 1;
    updates.push("current_revision = ?", "updated_at = ?");
    values.push(revision, timestamp, this.paths.descriptor.id, operation.id);
    this.database
      .prepare(`UPDATE ${config.table} SET ${updates.join(", ")} WHERE project_id = ? AND id = ?`)
      .run(...values);
    this.applyLocalizations(type, operation.id, localizations, timestamp);
    const normalized = config.normalizer(
      this.database
        .prepare(`SELECT * FROM ${config.table} WHERE project_id = ? AND id = ?`)
        .get(this.paths.descriptor.id, operation.id),
    );
    return {
      entityType: type,
      id: operation.id,
      action: "updated",
      revision,
      summary: operation.summary ?? normalized.title ?? normalized.label ?? Object.keys(fields).join(", "),
    };
  }

  addSourceRef(operation, { timestamp }) {
    const fields = operation.fields ?? {};
    if (!operation.id) throw new Error("add_source_ref requires id of the target block");
    if (!entityExists(this.database, this.paths.descriptor.id, "block", operation.id)) {
      throw new Error(`block:${operation.id} not found`);
    }
    if (!fields.path?.trim()) throw new Error("add_source_ref requires fields.path");
    const sourceId = fields.sourceId ?? identifier("source");
    this.database
      .prepare(
        `INSERT INTO source_refs(id, block_id, path, start_line, end_line, symbol, role, git_commit, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sourceId,
        operation.id,
        fields.path,
        fields.startLine ?? null,
        fields.endLine ?? null,
        fields.symbol ?? null,
        fields.role ?? "implementation",
        fields.gitCommit ?? null,
        timestamp,
      );
    const block = this.database.prepare("SELECT current_revision FROM blocks WHERE id = ?").get(operation.id);
    return {
      entityType: "block",
      id: operation.id,
      action: "source-linked",
      revision: block.current_revision,
      summary: `${fields.role ?? "implementation"}: ${fields.path}`,
      sourceId,
    };
  }

  removeSourceRef(operation) {
    const sourceId = operation.fields?.sourceId;
    if (!operation.id || !sourceId) {
      throw new Error("remove_source_ref requires the target block id and fields.sourceId");
    }
    const source = this.database
      .prepare("SELECT * FROM source_refs WHERE id = ? AND block_id = ?")
      .get(sourceId, operation.id);
    if (!source) throw new Error(`source:${sourceId} is not attached to block:${operation.id}`);
    this.database.prepare("DELETE FROM source_refs WHERE id = ?").run(sourceId);
    const block = this.database.prepare("SELECT current_revision FROM blocks WHERE id = ?").get(operation.id);
    return {
      entityType: "block",
      id: operation.id,
      action: "source-removed",
      revision: block.current_revision,
      summary: `${source.role}: ${source.path}`,
      sourceId,
    };
  }

  setChainMembers(operation) {
    if (!operation.id || !Number.isInteger(operation.expectedRevision)) {
      throw new Error("set_chain_members requires id and expectedRevision");
    }
    const chain = this.database
      .prepare("SELECT * FROM chains WHERE project_id = ? AND id = ?")
      .get(this.paths.descriptor.id, operation.id);
    if (!chain) throw new Error(`chain:${operation.id} not found`);
    if (chain.current_revision !== operation.expectedRevision) {
      throw new Error(
        `Revision conflict for chain:${operation.id}; expected ${operation.expectedRevision}, current ${chain.current_revision}`,
      );
    }
    const members = operation.members ?? [];
    for (const member of members) {
      if (!entityExists(this.database, this.paths.descriptor.id, member.type, member.id)) {
        throw new Error(`Missing chain member ${member.type}:${member.id}`);
      }
      if (member.type === "chain" && member.id === operation.id) throw new Error("A chain cannot contain itself");
    }
    this.database.prepare("DELETE FROM chain_members WHERE chain_id = ?").run(operation.id);
    this.database.prepare("DELETE FROM chain_nodes WHERE chain_id = ?").run(operation.id);
    this.database.prepare("DELETE FROM chain_edges WHERE chain_id = ?").run(operation.id);
    const insert = this.database.prepare(
      "INSERT INTO chain_members(chain_id, member_type, member_id, position) VALUES (?, ?, ?, ?)",
    );
    const insertNode = this.database.prepare(
      "INSERT INTO chain_nodes(chain_id, block_id, position, role) VALUES (?, ?, ?, 'path')",
    );
    members.forEach((member, index) => {
      insert.run(operation.id, member.type, member.id, index);
      if (member.type === "block") insertNode.run(operation.id, member.id, index);
    });
    const revision = chain.current_revision + 1;
    this.database
      .prepare("UPDATE chains SET current_revision = ?, updated_at = ? WHERE id = ?")
      .run(revision, now(), operation.id);
    return {
      entityType: "chain",
      id: operation.id,
      action: "members-set",
      revision,
      summary: `${members.length} members`,
    };
  }

  recordCheckpoint({ actor = "agent", id, targetType, targetId, title, criteria = "", status, evidence = [], expectedRevision }) {
    if (!["block", "chain", "link", "plan"].includes(targetType)) throw new Error(`Invalid targetType: ${targetType}`);
    if (!title?.trim()) throw new Error("title is required");
    if (!["pending", "running", "passed", "failed", "blocked"].includes(status)) {
      throw new Error(`Invalid checkpoint status: ${status}`);
    }
    const checkpointId = id ?? identifier("checkpoint");
    const timestamp = now();
    const changeSetId = identifier("change");
    return transaction(this.database, () => {
      this.database
        .prepare(
          `INSERT INTO change_sets(id, project_id, actor, reason, task, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(changeSetId, this.paths.descriptor.id, actor, `Checkpoint: ${title}`, title, timestamp);
      const existing = this.database.prepare("SELECT * FROM checkpoints WHERE id = ?").get(checkpointId);
      let revision = 1;
      let action = "created";
      if (existing) {
        if (!Number.isInteger(expectedRevision) || expectedRevision !== existing.current_revision) {
          throw new Error(
            `Revision conflict for checkpoint:${checkpointId}; expected ${expectedRevision}, current ${existing.current_revision}`,
          );
        }
        revision = existing.current_revision + 1;
        action = "updated";
        this.database
          .prepare(
            `UPDATE checkpoints SET title = ?, criteria = ?, status = ?, evidence_json = ?,
             current_revision = ?, updated_at = ? WHERE id = ?`,
          )
          .run(title, criteria, status, JSON.stringify(evidence), revision, timestamp, checkpointId);
      } else {
        this.database
          .prepare(
            `INSERT INTO checkpoints(
              id, project_id, target_type, target_id, title, criteria, status, evidence_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            checkpointId,
            this.paths.descriptor.id,
            targetType,
            targetId,
            title,
            criteria,
            status,
            JSON.stringify(evidence),
            timestamp,
            timestamp,
          );
      }
      const targetTable = targetType === "block" ? "blocks" : targetType === "chain" ? "chains" : targetType === "link" ? "links" : "plans";
      const healthState = status === "passed" ? "healthy" : status === "failed" ? "failing" : status === "blocked" ? "warning" : null;
      if (healthState && targetType !== "plan") {
        this.database
          .prepare(`UPDATE ${targetTable} SET health_state = ?, updated_at = ? WHERE id = ?`)
          .run(healthState, timestamp, targetId);
      }
      this.database
        .prepare(
          `INSERT INTO history(change_set_id, entity_type, entity_id, action, revision, summary, created_at)
           VALUES (?, 'checkpoint', ?, ?, ?, ?, ?)`,
        )
        .run(changeSetId, checkpointId, action, revision, `${status}: ${title}`, timestamp);
      this.database
        .prepare(
          `INSERT INTO change_feed(project_id, change_set_id, entity_type, entity_id, action, created_at)
           VALUES (?, ?, 'checkpoint', ?, ?, ?)`,
        )
        .run(this.paths.descriptor.id, changeSetId, checkpointId, action, timestamp);
      this.database
        .prepare("UPDATE projects SET graph_revision = graph_revision + 1, updated_at = ? WHERE id = ?")
        .run(timestamp, this.paths.descriptor.id);
      return {
        changeSetId,
        graphRevision: this.project().graph_revision,
        checkpoint: { id: checkpointId, revision, status },
      };
    });
  }

  validate() {
    const snapshot = this.snapshot();
    const errors = [];
    const warnings = [];
    const refs = new Set([
      ...snapshot.blocks.map((block) => `block:${block.id}`),
      ...snapshot.chains.map((chain) => `chain:${chain.id}`),
    ]);
    for (const link of snapshot.links) {
      if (!refs.has(`${link.sourceType}:${link.sourceId}`)) errors.push(`Dangling link source: link:${link.id}`);
      if (!refs.has(`${link.targetType}:${link.targetId}`)) errors.push(`Dangling link target: link:${link.id}`);
      if (["calls", "reads", "writes"].includes(link.kind) && !link.contract.trim()) {
        warnings.push(`Missing contract: link:${link.id}`);
      }
    }
    for (const member of snapshot.members) {
      if (!refs.has(`${member.memberType}:${member.memberId}`)) {
        errors.push(`Missing chain member: ${member.chainId} -> ${member.memberType}:${member.memberId}`);
      }
    }
    for (const chain of snapshot.chains) {
      const nodes = snapshot.chainNodes.filter((item) => item.chainId === chain.id);
      const edges = snapshot.chainEdges.filter((item) => item.chainId === chain.id);
      const count = nodes.length;
      if (count === 0) warnings.push(`Empty chain: chain:${chain.id}`);
      const nodeIds = new Set(nodes.map((item) => item.blockId));
      for (const edge of edges) {
        const link = snapshot.links.find((item) => item.id === edge.linkId);
        if (!link) errors.push(`Missing Chain edge: chain:${chain.id} -> link:${edge.linkId}`);
        else if (!nodeIds.has(link.sourceId) || !nodeIds.has(link.targetId)) {
          errors.push(`Chain edge leaves referenced nodes: chain:${chain.id} -> link:${edge.linkId}`);
        }
      }
    }
    for (const target of snapshot.planChainRefs) {
      if (!snapshot.plans.some((plan) => plan.id === target.planId)) errors.push(`Missing Plan: plan:${target.planId}`);
      if (!snapshot.chains.some((chain) => chain.id === target.chainId)) errors.push(`Missing Plan target: plan:${target.planId} -> chain:${target.chainId}`);
    }
    for (const scope of snapshot.backgroundScopes) {
      if (!snapshot.blocks.some((block) => block.id === scope.blockId)) errors.push(`Missing Background Block: block:${scope.blockId}`);
    }
    for (const block of snapshot.blocks) {
      if (block.deliveryState === "complete") {
        const passed = snapshot.checkpoints.some(
          (checkpoint) => checkpoint.targetType === "block" && checkpoint.targetId === block.id && checkpoint.status === "passed",
        );
        if (!passed) warnings.push(`Complete block has no passed checkpoint: block:${block.id}`);
      }
    }
    for (const plan of snapshot.plans) {
      if (plan.status === "complete") {
        const passed = snapshot.checkpoints.some(
          (checkpoint) => checkpoint.targetType === "plan" && checkpoint.targetId === plan.id && checkpoint.status === "passed",
        );
        if (!passed) warnings.push(`Complete plan has no passed checkpoint: plan:${plan.id}`);
      }
      if (snapshot.planChainRefs.every((item) => item.planId !== plan.id)) warnings.push(`Plan has no target Chain: plan:${plan.id}`);
    }
    return { valid: errors.length === 0, errors, warnings, graphRevision: snapshot.project.graphRevision };
  }
}

export function createService(options = {}) {
  return new MdflowService(options);
}
