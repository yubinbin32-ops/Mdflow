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

const PLAN_STATUSES = new Set(["draft", "ready", "active", "verifying", "complete", "blocked", "failed", "retest_required", "cancelled"]);
const PLAN_STEP_STATUSES = new Set(["pending", "active", "complete", "blocked", "failed", "skipped"]);
const CHECKPOINT_STATUSES = new Set([
  "pending", "running", "passed", "partial_pass", "failed", "blocked", "not_supported", "retest_required",
]);
const CHECKPOINT_KINDS = new Set(["atomic", "aggregate", "integration"]);
const EVIDENCE_LEVELS = new Set(["none", "static", "simulated", "integration", "real_target", "human_review"]);
const EVIDENCE_LEVEL_RANK = new Map([...EVIDENCE_LEVELS].map((value, index) => [value, index]));

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

const ARCHITECTURE_LAYERS = new Set([
  "client",
  "boundary",
  "application",
  "domain",
  "data",
  "external",
  "quality",
  "infrastructure",
  "unspecified",
]);

const EDITABLE_BLOCK_FIELDS = new Set([
  "kind",
  "title",
  "summary",
  "body",
  "contract",
  "scope",
  "architectureLayer",
  "localOrder",
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
  "phase",
  "planOrder",
  "proposedDelta",
  "completionPolicy",
  "nextAction",
  "blockers",
  "statusReason",
  "startedAt",
  "completedAt",
  "invalidatedAt",
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
  const table = type === "block" ? "blocks"
    : type === "chain" ? "chains"
      : type === "link" ? "links"
        : type === "plan" ? "plans"
          : type === "plan_change" ? "plan_changes"
            : type === "plan_chain_scope" ? "plan_chain_scopes" : null;
  if (!table) return false;
  if (["plan_changes", "plan_chain_scopes"].includes(table)) {
    return Boolean(database.prepare(
      `SELECT 1 FROM ${table} item JOIN plans p ON p.id = item.plan_id WHERE p.project_id = ? AND item.id = ?`,
    ).get(projectId, id));
  }
  return Boolean(database.prepare(`SELECT 1 FROM ${table} WHERE project_id = ? AND id = ?`).get(projectId, id));
}

function normalizeBlock(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    body: row.body,
    contract: row.contract,
    scope: row.scope,
    architectureLayer: row.architecture_layer,
    localOrder: row.local_order,
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
    phase: row.phase,
    planOrder: row.plan_order,
    proposedDelta: parseJson(row.proposed_delta_json, []),
    completionPolicy: parseJson(row.completion_policy_json, {}),
    nextAction: row.next_action,
    blockers: parseJson(row.blockers_json, []),
    statusReason: row.status_reason,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    invalidatedAt: row.invalidated_at,
    currentRevision: row.current_revision,
    archived: Boolean(row.archived),
    updatedAt: row.updated_at,
  };
}

function normalizePlanChainScope(row) {
  return {
    id: row.id, planId: row.plan_id, chainId: row.chain_id, position: row.position,
    title: row.title, summary: row.summary, rationale: row.rationale,
    startBlockId: row.start_block_id, endBlockId: row.end_block_id,
    nodeIds: parseJson(row.node_ids_json, []), linkIds: parseJson(row.link_ids_json, []),
    expectedDelta: parseJson(row.expected_delta_json, []), prohibitions: parseJson(row.prohibitions_json, []),
    localizations: parseJson(row.localizations_json, {}), status: row.status,
    currentRevision: row.current_revision, updatedAt: row.updated_at,
  };
}

function normalizePlanChange(row) {
  return {
    id: row.id, planId: row.plan_id, entityType: row.entity_type, entityId: row.entity_id,
    position: row.position, title: row.title, summary: row.summary,
    currentBehavior: row.current_behavior, proposedBehavior: row.proposed_behavior, rationale: row.rationale,
    prohibitions: parseJson(row.prohibitions_json, []), expectedEffects: parseJson(row.expected_effects_json, []),
    sourceRefs: parseJson(row.source_refs_json, []), localizations: parseJson(row.localizations_json, {}),
    status: row.status, currentRevision: row.current_revision, updatedAt: row.updated_at,
  };
}

function deriveCheckpointStates(checkpoints, dependencies) {
  const byId = new Map(checkpoints.map((checkpoint) => [checkpoint.id, { ...checkpoint, recordedStatus: checkpoint.status }]));
  const childrenByParent = new Map();
  for (const dependency of dependencies) {
    const values = childrenByParent.get(dependency.parentCheckpointId) ?? [];
    values.push(dependency);
    childrenByParent.set(dependency.parentCheckpointId, values);
  }
  const visiting = new Set();
  const resolved = new Set();
  const derive = (id) => {
    const checkpoint = byId.get(id);
    if (!checkpoint || resolved.has(id)) return checkpoint;
    if (visiting.has(id)) throw new Error("Checkpoint dependency graph must remain acyclic");
    visiting.add(id);
    const dependenciesForCheckpoint = (childrenByParent.get(id) ?? []).sort((a, b) => a.position - b.position);
    const children = dependenciesForCheckpoint.map((dependency) => ({
      dependency,
      checkpoint: derive(dependency.childCheckpointId),
    })).filter((item) => item.checkpoint);
    const required = children.filter((item) => item.dependency.required).map((item) => item.checkpoint);
    const optional = children.filter((item) => !item.dependency.required).map((item) => item.checkpoint);
    checkpoint.optionalWarnings = optional
      .filter((child) => ["failed", "blocked", "retest_required", "not_supported"].includes(child.status))
      .map((child) => child.id);
    if (children.length > 0) {
      const statuses = required.map((child) => child.status);
      const gatesPassed = required.length > 0 && required.every(checkpointSatisfiesGate);
      if (required.some((child) => child.invalidatedAt || child.status === "retest_required")) checkpoint.status = "retest_required";
      else if (statuses.includes("failed")) checkpoint.status = "failed";
      else if (statuses.includes("blocked")) checkpoint.status = "blocked";
      else if (statuses.length > 0 && statuses.every((status) => status === "not_supported")) checkpoint.status = "not_supported";
      else if (checkpoint.checkpointKind === "integration" || checkpoint.eligibleAfterChildren) {
        checkpoint.eligible = gatesPassed;
        checkpoint.status = gatesPassed ? checkpoint.recordedStatus : (statuses.some((status) => status === "passed") ? "partial_pass" : "pending");
      } else if (gatesPassed) {
        checkpoint.status = "passed";
        checkpoint.coverage = "complete";
        checkpoint.evidenceLevel = required.reduce((level, child) =>
          Math.min(level, EVIDENCE_LEVEL_RANK.get(child.evidenceLevel) ?? 0), Number.MAX_SAFE_INTEGER);
        checkpoint.evidenceLevel = [...EVIDENCE_LEVEL_RANK.entries()].find(([, rank]) => rank === checkpoint.evidenceLevel)?.[0] ?? "none";
        if ((EVIDENCE_LEVEL_RANK.get(checkpoint.evidenceLevel) ?? 0) <
            (EVIDENCE_LEVEL_RANK.get(checkpoint.requiredEvidenceLevel) ?? 0)) {
          checkpoint.status = "partial_pass";
        }
      } else if (statuses.includes("running")) checkpoint.status = "running";
      else if (statuses.some((status) => ["passed", "partial_pass"].includes(status))) checkpoint.status = "partial_pass";
      else checkpoint.status = "pending";
    }
    visiting.delete(id);
    resolved.add(id);
    return checkpoint;
  };
  for (const checkpoint of checkpoints) derive(checkpoint.id);
  return [...byId.values()];
}

function checkpointSatisfiesGate(checkpoint) {
  return checkpoint?.status === "passed" && checkpoint.coverage === "complete" &&
    (EVIDENCE_LEVEL_RANK.get(checkpoint.evidenceLevel) ?? 0) >=
      (EVIDENCE_LEVEL_RANK.get(checkpoint.requiredEvidenceLevel) ?? 0) && !checkpoint.invalidatedAt;
}

function derivePlanState(
  plan, allPlans, dependencies, steps, checkpointRefs, checkpoints,
  chainScopes = [], changes = [], checkpointBindings = [],
) {
  const ownDependencies = dependencies.filter((item) => item.planId === plan.id);
  const ownSteps = steps.filter((item) => item.planId === plan.id);
  const ownScopes = chainScopes.filter((item) => item.planId === plan.id);
  const ownChanges = changes.filter((item) => item.planId === plan.id);
  const ownCheckpointRefs = checkpointRefs.filter((item) => item.planId === plan.id);
  const requiredRefs = ownCheckpointRefs.filter((item) => item.required);
  const checkpointById = new Map(checkpoints.map((item) => [item.id, item]));
  const scopeIDs = new Set(ownScopes.map((item) => item.id));
  const requiredCheckpointIDs = new Set([
    ...requiredRefs.map((item) => item.checkpointId),
    ...checkpoints.filter((item) => item.targetType === "plan" && item.targetId === plan.id).map((item) => item.id),
    ...checkpointBindings.filter((binding) => binding.required && (
      (binding.subjectType === "plan" && binding.subjectId === plan.id) ||
      (binding.subjectType === "plan_chain_scope" && scopeIDs.has(binding.subjectId))
    )).map((binding) => binding.checkpointId),
  ]);
  const requiredCheckpoints = [...requiredCheckpointIDs].map((id) => checkpointById.get(id)).filter(Boolean);
  const completedGates = requiredCheckpoints.filter(checkpointSatisfiesGate).length;
  const usesDetailedChanges = ownScopes.length > 0 || ownChanges.length > 0;
  const completedWork = usesDetailedChanges
    ? ownChanges.filter((item) => ["complete", "passed"].includes(item.status)).length
    : ownSteps.filter((item) => ["complete", "skipped"].includes(item.status)).length;
  const totalWork = usesDetailedChanges ? ownChanges.length : ownSteps.length;
  const progress = {
    completedSteps: completedWork,
    totalSteps: totalWork,
    passedRequiredCheckpoints: completedGates,
    totalRequiredCheckpoints: requiredCheckpoints.length,
  };
  let derivedStatus = plan.status;
  let derivedReason = plan.statusReason;
  if (plan.invalidatedAt || requiredCheckpoints.some((item) => item.invalidatedAt || item.status === "retest_required")) {
    derivedStatus = "retest_required";
    derivedReason ||= "A required checkpoint was invalidated and must be run again.";
  } else if (plan.status === "cancelled") {
    derivedStatus = "cancelled";
  } else if (ownSteps.some((item) => item.status === "failed") || requiredCheckpoints.some((item) => item.status === "failed")) {
    derivedStatus = "failed";
    derivedReason ||= "A required step or checkpoint failed.";
  } else if (plan.blockers.length || ownSteps.some((item) => item.status === "blocked") || requiredCheckpoints.some((item) => item.status === "blocked")) {
    derivedStatus = "blocked";
    derivedReason ||= "A required step, checkpoint, or explicit blocker prevents progress.";
  } else {
    const incompleteDependencies = ownDependencies.filter((item) => {
      const dependency = allPlans.find((candidate) => candidate.id === item.dependsOnPlanId);
      return dependency?.status !== "complete";
    });
    if (incompleteDependencies.length) {
      derivedStatus = "ready";
      derivedReason ||= `Waiting for ${incompleteDependencies.length} prerequisite plan(s).`;
    } else if (totalWork > 0 && progress.completedSteps === totalWork &&
        requiredCheckpoints.length > 0 && completedGates === requiredCheckpoints.length) {
      derivedStatus = "complete";
      derivedReason ||= usesDetailedChanges
        ? "All declared entity changes and required checkpoint gates passed."
        : "All ordered steps and required checkpoint gates passed.";
    } else if (totalWork > 0 && progress.completedSteps === totalWork) {
      derivedStatus = "verifying";
      derivedReason ||= usesDetailedChanges
        ? "Declared changes are complete; checkpoint evidence remains."
        : "Implementation steps are complete; checkpoint evidence remains.";
    }
  }
  return { ...plan, derivedStatus, derivedReason, progress };
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

function operationEntityType(action) {
  if (action.includes("block") || ["add_source_ref", "remove_source_ref", "set_background_scopes"].includes(action)) return "block";
  if (action.includes("chain") && !action.startsWith("set_plan_")) return "chain";
  if (action.includes("link")) return "link";
  if (action.includes("plan")) return "plan";
  if (action.includes("checkpoint")) return "checkpoint";
  return null;
}

function affectedRefsForOperation(operation) {
  const refs = new Set();
  const fields = operation.fields ?? {};
  const add = (type, id) => { if (id) refs.add(`${type}:${id}`); };
  for (const id of fields.nodeIds ?? []) add("block", id);
  for (const id of fields.linkIds ?? []) add("link", id);
  for (const id of fields.chainIds ?? []) add("chain", id);
  for (const id of fields.planIds ?? []) add("plan", id);
  for (const scope of fields.scopes ?? []) {
    add("chain", scope.chainId);
    for (const id of scope.nodeIds ?? []) add("block", id);
    for (const id of scope.linkIds ?? []) add("link", id);
  }
  for (const change of fields.changes ?? []) add(change.entityType, change.entityId);
  for (const ref of fields.refs ?? []) {
    add("plan_chain_scope", ref.chainScopeId);
    add("plan_change", ref.planChangeId);
  }
  for (const binding of fields.bindings ?? []) add(binding.subjectType, binding.subjectId);
  for (const child of fields.children ?? []) add("checkpoint", child.checkpointId);
  for (const checkpoint of fields.checkpoints ?? []) add("checkpoint", checkpoint.checkpointId);
  return [...refs];
}

function taskTerms(task) {
  const stopWords = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "is", "it",
    "of", "on", "or", "the", "this", "to", "what", "when", "where", "which", "with",
  ]);
  const terms = task
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length > 1 && !stopWords.has(term));
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
    let plans = this.database
      .prepare("SELECT * FROM plans WHERE project_id = ? AND archived = 0 ORDER BY phase, plan_order, priority, updated_at DESC")
      .all(projectId)
      .map(normalizePlan);
    const links = this.database
      .prepare("SELECT * FROM links WHERE project_id = ? AND archived = 0 ORDER BY created_at")
      .all(projectId)
      .map(normalizeLink);
    const chainNodes = this.database
      .prepare(
        `SELECT cn.* FROM chain_nodes cn JOIN chains c ON c.id = cn.chain_id
         WHERE c.project_id = ? AND c.archived = 0 ORDER BY cn.chain_id, cn.position`,
      )
      .all(projectId)
      .map((row) => ({ chainId: row.chain_id, blockId: row.block_id, position: row.position, role: row.role }));
    const chainEdges = this.database
      .prepare(
        `SELECT ce.* FROM chain_edges ce JOIN chains c ON c.id = ce.chain_id
         WHERE c.project_id = ? AND c.archived = 0 ORDER BY ce.chain_id, ce.position`,
      )
      .all(projectId)
      .map((row) => ({ chainId: row.chain_id, linkId: row.link_id, position: row.position }));
    const planChainRefs = this.database
      .prepare(
        `SELECT pcr.* FROM plan_chain_refs pcr JOIN plans p ON p.id = pcr.plan_id
         WHERE p.project_id = ? AND p.archived = 0 ORDER BY pcr.plan_id, pcr.position`,
      )
      .all(projectId)
      .map((row) => ({ planId: row.plan_id, chainId: row.chain_id, position: row.position }));
    const planDependencies = this.database
      .prepare(
        `SELECT pd.* FROM plan_dependencies pd JOIN plans p ON p.id = pd.plan_id
         WHERE p.project_id = ? AND p.archived = 0 ORDER BY pd.plan_id, pd.position`,
      )
      .all(projectId)
      .map((row) => ({ planId: row.plan_id, dependsOnPlanId: row.depends_on_plan_id, position: row.position }));
    const planSteps = this.database
      .prepare(
        `SELECT ps.* FROM plan_steps ps JOIN plans p ON p.id = ps.plan_id
         WHERE p.project_id = ? AND p.archived = 0 ORDER BY ps.plan_id, ps.position`,
      )
      .all(projectId)
      .map((row) => ({
        id: row.id, planId: row.plan_id, position: row.position, title: row.title, action: row.action,
        status: row.status, targetRefs: parseJson(row.target_refs_json, []), proposedDelta: parseJson(row.proposed_delta_json, []),
        updatedAt: row.updated_at,
      }));
    const planCheckpointRefs = this.database
      .prepare(
        `SELECT pcr.* FROM plan_checkpoint_refs pcr JOIN plans p ON p.id = pcr.plan_id
         WHERE p.project_id = ? AND p.archived = 0 ORDER BY pcr.plan_id, pcr.position`,
      )
      .all(projectId)
      .map((row) => ({
        planId: row.plan_id, checkpointId: row.checkpoint_id, stepId: row.step_id,
        position: row.position, required: Boolean(row.required),
      }));
    const planChainScopes = this.database
      .prepare(
        `SELECT pcs.* FROM plan_chain_scopes pcs JOIN plans p ON p.id = pcs.plan_id
         WHERE p.project_id = ? AND p.archived = 0 ORDER BY pcs.plan_id, pcs.position`,
      )
      .all(projectId)
      .map(normalizePlanChainScope);
    const planChanges = this.database
      .prepare(
        `SELECT pc.* FROM plan_changes pc JOIN plans p ON p.id = pc.plan_id
         WHERE p.project_id = ? AND p.archived = 0 ORDER BY pc.plan_id, pc.position`,
      )
      .all(projectId)
      .map(normalizePlanChange);
    const planChainChangeRefs = this.database
      .prepare(
        `SELECT pccr.* FROM plan_chain_change_refs pccr
         JOIN plan_chain_scopes pcs ON pcs.id = pccr.chain_scope_id
         JOIN plans p ON p.id = pcs.plan_id
         WHERE p.project_id = ? AND p.archived = 0 ORDER BY pccr.chain_scope_id, pccr.position`,
      )
      .all(projectId)
      .map((row) => ({
        chainScopeId: row.chain_scope_id, planChangeId: row.plan_change_id,
        role: row.role, position: row.position,
      }));
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
    const rawCheckpoints = this.database
      .prepare("SELECT * FROM checkpoints WHERE project_id = ? ORDER BY updated_at DESC")
      .all(projectId)
      .map((row) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        title: row.title,
        criteria: row.criteria,
        status: row.status,
        checkpointKind: row.checkpoint_kind,
        aggregationPolicy: parseJson(row.aggregation_policy_json, {}),
        eligibleAfterChildren: Boolean(row.eligible_after_children),
        evidenceLevel: row.evidence_level,
        requiredEvidenceLevel: row.required_evidence_level,
        coverage: row.coverage,
        evidence: parseJson(row.evidence_json, []),
        invalidatedAt: row.invalidated_at,
        currentRevision: row.current_revision,
        updatedAt: row.updated_at,
      }));
    const checkpointBindings = this.database
      .prepare(
        `SELECT cb.* FROM checkpoint_bindings cb JOIN checkpoints c ON c.id = cb.checkpoint_id
         WHERE c.project_id = ? ORDER BY cb.checkpoint_id, cb.position`,
      )
      .all(projectId)
      .map((row) => ({
        checkpointId: row.checkpoint_id, subjectType: row.subject_type, subjectId: row.subject_id,
        role: row.role, required: Boolean(row.required), position: row.position,
      }));
    const checkpointDependencies = this.database
      .prepare(
        `SELECT cd.* FROM checkpoint_dependencies cd JOIN checkpoints c ON c.id = cd.parent_checkpoint_id
         WHERE c.project_id = ? ORDER BY cd.parent_checkpoint_id, cd.position`,
      )
      .all(projectId)
      .map((row) => ({
        parentCheckpointId: row.parent_checkpoint_id, childCheckpointId: row.child_checkpoint_id,
        position: row.position, required: Boolean(row.required),
      }));
    const checkpoints = deriveCheckpointStates(rawCheckpoints, checkpointDependencies);
    plans = plans.map((plan) => derivePlanState(
      plan, plans, planDependencies, planSteps, planCheckpointRefs, checkpoints,
      planChainScopes, planChanges, checkpointBindings,
    ));
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
      chainNodes,
      chainEdges,
      planChainRefs,
      planDependencies,
      planSteps,
      planCheckpointRefs,
      planChainScopes,
      planChanges,
      planChainChangeRefs,
      backgroundScopes,
      sourceRefs,
      checkpoints,
      checkpointBindings,
      checkpointDependencies,
      localizations,
    };
  }

  projectMap({ locale = "en" } = {}) {
    const snapshot = this.snapshot();
    assertAllowed(locale, LOCALES, "locale");
    const translations = localizationMap(snapshot);
    const layerCounts = Object.fromEntries(
      [...ARCHITECTURE_LAYERS]
        .map((layer) => [layer, snapshot.blocks.filter((block) => block.architectureLayer === layer).length])
        .filter(([, count]) => count > 0),
    );
    const scopeCounts = Object.fromEntries(
      [...new Set(snapshot.blocks.map((block) => block.scope))]
        .sort()
        .map((scope) => [scope, snapshot.blocks.filter((block) => block.scope === scope).length]),
    );
    const architectureGroups = [...new Set(snapshot.blocks.map((block) => `${block.architectureLayer}\u0000${block.scope}`))]
      .sort()
      .map((key) => {
        const [layer, scope] = key.split("\u0000");
        const members = snapshot.blocks
          .filter((block) => block.architectureLayer === layer && block.scope === scope)
          .sort((left, right) => left.localOrder - right.localOrder || left.id.localeCompare(right.id));
        return {
          layer,
          scope,
          count: members.length,
          blockRefs: members.slice(0, 50).map((block) => `block:${block.id}`),
          truncated: members.length > 50,
        };
      });
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
      const progress = `${plan.progress.completedSteps}/${plan.progress.totalSteps} steps · ${plan.progress.passedRequiredCheckpoints}/${plan.progress.totalRequiredCheckpoints} gates`;
      lines.push(
        `- [plan:${plan.id}] ${title} — ${plan.phase} #${plan.planOrder} · ${plan.priority} · ${plan.derivedStatus} · ${progress} · ${count} target chain(s)`,
      );
      if (plan.derivedReason) lines.push(`  ${plan.derivedReason}`);
    }
    lines.push("", "## Project network");
    lines.push(`- ${snapshot.blocks.length} Blocks / ${snapshot.links.length} Links / ${snapshot.chains.length} Chain overlays`);
    lines.push(`- Architecture layers: ${Object.entries(layerCounts).map(([layer, count]) => `${layer} ${count}`).join(" · ") || "None"}`);
    lines.push(`- Scopes: ${Object.entries(scopeCounts).map(([scope, count]) => `${scope} ${count}`).join(" · ") || "None"}`);
    for (const block of snapshot.blocks.filter((item) => item.priority === "critical").slice(0, 8)) {
      const title = localizedValue(translations, "block", block.id, locale, "title", block.title);
      lines.push(`- [block:${block.id}] ${title} — ${block.deliveryState}/${block.healthState}`);
    }
    return {
      map: {
        project: snapshot.project,
        changeSequence: snapshot.changeSequence,
        counts: {
          blocks: snapshot.blocks.length,
          links: snapshot.links.length,
          chains: snapshot.chains.length,
          plans: snapshot.plans.length,
        },
        architecture: {
          layerCounts,
          scopeCounts,
          groups: architectureGroups,
        },
        plans: plans.map((plan) => ({
          id: plan.id,
          title: localizedValue(translations, "plan", plan.id, locale, "title", plan.title),
          status: plan.status,
          derivedStatus: plan.derivedStatus,
          derivedReason: plan.derivedReason,
          priority: plan.priority,
          phase: plan.phase,
          order: plan.planOrder,
          progress: plan.progress,
          dependencyPlanIds: snapshot.planDependencies.filter((item) => item.planId === plan.id).sort((a, b) => a.position - b.position).map((item) => item.dependsOnPlanId),
          targetChainIds: snapshot.planChainRefs.filter((item) => item.planId === plan.id).sort((a, b) => a.position - b.position).map((item) => item.chainId),
        })),
        criticalBlocks: snapshot.blocks.filter((item) => item.priority === "critical").slice(0, 8).map((block) => ({
          id: block.id,
          title: localizedValue(translations, "block", block.id, locale, "title", block.title),
          deliveryState: block.deliveryState,
          healthState: block.healthState,
        })),
      },
      markdown: lines.join("\n"),
    };
  }

  search({ query, kinds = [], states = [], limit = 20, locale = "en" }) {
    const term = `%${query.trim()}%`;
    const terms = taskTerms(query);
    const snapshot = this.snapshot();
    assertAllowed(locale, LOCALES, "locale");
    const translations = localizationMap(snapshot);
    const kindSet = new Set(kinds);
    const stateSet = new Set(states);
    const score = (text) => terms.reduce((total, item) => total + (text.toLowerCase().includes(item) ? 1 : 0), 0);
    const blocks = snapshot.blocks.map((block) => {
      const text = `${block.title}\n${block.summary}\n${block.body}\n${block.contract}\n${block.scope}\n${block.architectureLayer}\n${block.tags.join(" ")}\n${localizedSearchText(snapshot, "block", block.id)}`;
      return { item: block, score: score(text) };
    }).filter(({ item: block, score }) => {
      return (score > 0 &&
        (kindSet.size === 0 || kindSet.has(block.kind)) &&
        (stateSet.size === 0 || stateSet.has(block.deliveryState) || stateSet.has(block.healthState))
      );
    }).sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id)).map(({ item }) => item);
    const chains = snapshot.chains.map((chain) => {
      const text = `${chain.title}\n${chain.intent}\n${chain.inputContract}\n${chain.outputContract}\n${localizedSearchText(snapshot, "chain", chain.id)}`;
      return { item: chain, score: score(text) };
    }).filter(({ item: chain, score }) => {
      return (score > 0 &&
        (kindSet.size === 0 || kindSet.has("chain")) &&
        (stateSet.size === 0 || stateSet.has(chain.deliveryState) || stateSet.has(chain.healthState))
      );
    }).sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id)).map(({ item }) => item);
    const plans = snapshot.plans.map((plan) => {
      const text = `${plan.title}\n${plan.summary}\n${plan.goal}\n${plan.status}\n${plan.nextAction}\n${JSON.stringify(plan.blockers)}\n${localizedSearchText(snapshot, "plan", plan.id)}`;
      return { item: plan, score: score(text) };
    }).filter(({ item: plan, score }) => score > 0 &&
        (kindSet.size === 0 || kindSet.has("plan")) &&
        (stateSet.size === 0 || stateSet.has(plan.status)))
      .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id)).map(({ item }) => item);
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
      .prepare(type === "plan"
        ? `SELECT DISTINCT c.* FROM checkpoints c
           LEFT JOIN plan_checkpoint_refs pcr ON pcr.checkpoint_id = c.id
           WHERE c.project_id = ? AND ((c.target_type = ? AND c.target_id = ?) OR pcr.plan_id = ?)
           ORDER BY c.updated_at DESC`
        : "SELECT * FROM checkpoints WHERE project_id = ? AND target_type = ? AND target_id = ? ORDER BY updated_at DESC",
      )
      .all(...(type === "plan" ? [projectId, type, id, id] : [projectId, type, id]))
      .map((row) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        title: row.title,
        criteria: row.criteria,
        status: row.status,
        evidenceLevel: row.evidence_level,
        requiredEvidenceLevel: row.required_evidence_level,
        coverage: row.coverage,
        evidence: parseJson(row.evidence_json, []),
        invalidatedAt: row.invalidated_at,
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
    const pathNodes =
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
    const pathEdges =
      type === "chain"
        ? this.database.prepare("SELECT link_id, position FROM chain_edges WHERE chain_id = ? ORDER BY position").all(id)
            .map((row) => ({ linkId: row.link_id, position: row.position }))
        : [];
    const targetChains =
      type === "plan"
        ? this.database.prepare("SELECT chain_id, position FROM plan_chain_refs WHERE plan_id = ? ORDER BY position").all(id)
            .map((row) => ({ chainId: row.chain_id, position: row.position }))
        : [];
    const dependencies = type === "plan"
      ? this.database.prepare("SELECT depends_on_plan_id, position FROM plan_dependencies WHERE plan_id = ? ORDER BY position").all(id)
          .map((row) => ({ planId: row.depends_on_plan_id, position: row.position }))
      : [];
    const steps = type === "plan"
      ? this.database.prepare("SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY position").all(id).map((row) => ({
          id: row.id, position: row.position, title: row.title, action: row.action, status: row.status,
          targetRefs: parseJson(row.target_refs_json, []), proposedDelta: parseJson(row.proposed_delta_json, []),
        }))
      : [];
    const checkpointRefs = type === "plan"
      ? this.database.prepare("SELECT checkpoint_id, step_id, position, required FROM plan_checkpoint_refs WHERE plan_id = ? ORDER BY position").all(id)
          .map((row) => ({ checkpointId: row.checkpoint_id, stepId: row.step_id, position: row.position, required: Boolean(row.required) }))
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
    if (type === "block") {
      lines.push(`- Architecture: ${entity.architectureLayer}`);
      lines.push(`- Scope: ${entity.scope}`);
      lines.push(`- Local order: ${entity.localOrder}`);
    }
    if (entity.deliveryState) lines.push(`- Delivery: ${entity.deliveryState}`);
    if (entity.status) lines.push(`- Status: ${entity.status}`);
    if (type === "plan") {
      lines.push(`- Phase: ${entity.phase}`);
      lines.push(`- Order: ${entity.planOrder}`);
      lines.push(`- Priority: ${entity.priority}`);
    }
    if (entity.healthState) lines.push(`- Health: ${entity.healthState}`);
    if (displaySummary) lines.push("", "## Summary", displaySummary);
    if (type === "block") {
      const displayBody = localizedValue(translations, type, id, locale, "body", entity.body ?? "");
      if (displayBody) lines.push("", "## Details", displayBody);
    }
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
      if (dependencies.length) {
        lines.push("", "## Prerequisites", ...dependencies.map((item) => `- [plan:${item.planId}]`));
      }
      if (steps.length) {
        lines.push("", "## Ordered steps");
        for (const step of steps) lines.push(`${step.position + 1}. ${step.status}: ${step.title}${step.action ? ` — ${step.action}` : ""}`);
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
      for (const checkpoint of checkpoints) {
        const required = checkpointRefs.find((item) => item.checkpointId === checkpoint.id)?.required;
        lines.push(`- ${checkpoint.status} · ${checkpoint.evidenceLevel}/${checkpoint.requiredEvidenceLevel}${required === false ? " · optional" : ""}: ${checkpoint.title}`);
      }
    }
    if (history.length) {
      lines.push("", "## Relevant history");
      for (const item of history) lines.push(`- r${item.revision} ${item.action}: ${item.summary}`);
    }
    if (type === "plan") {
      const detailed = this.planContext({ id, locale, maxChars: 24000 });
      return {
        entity: detailed.plan,
        sourceRefs, pathNodes, pathEdges, targetChains, dependencies, steps, checkpointRefs,
        checkpoints: detailed.checkpoints, history, hierarchy: detailed.hierarchy, markdown: detailed.markdown,
      };
    }
    return { entity, sourceRefs, pathNodes, pathEdges, targetChains, dependencies, steps, checkpointRefs, checkpoints, history, markdown: lines.join("\n") };
  }

  planContext({ id, locale = "en", maxChars = 12000 }) {
    assertAllowed(locale, LOCALES, "locale");
    const snapshot = this.snapshot();
    const plan = snapshot.plans.find((item) => item.id === id);
    if (!plan) throw new Error(`plan:${id} not found`);
    const translations = localizationMap(snapshot);
    const scopes = snapshot.planChainScopes.filter((item) => item.planId === id).sort((a, b) => a.position - b.position);
    const changes = snapshot.planChanges.filter((item) => item.planId === id).sort((a, b) => a.position - b.position);
    const bindingsBySubject = new Map();
    for (const binding of snapshot.checkpointBindings) {
      const key = `${binding.subjectType}:${binding.subjectId}`;
      const values = bindingsBySubject.get(key) ?? [];
      const checkpoint = snapshot.checkpoints.find((item) => item.id === binding.checkpointId);
      if (checkpoint) values.push({ ...binding, checkpoint });
      bindingsBySubject.set(key, values);
    }
    const scopeChangeRefs = new Map();
    for (const ref of snapshot.planChainChangeRefs) {
      const values = scopeChangeRefs.get(ref.chainScopeId) ?? [];
      const change = changes.find((item) => item.id === ref.planChangeId);
      if (change) values.push({ ...ref, change });
      scopeChangeRefs.set(ref.chainScopeId, values);
    }
    const hierarchy = scopes.map((scope) => ({
      ...scope,
      chain: snapshot.chains.find((item) => item.id === scope.chainId) ?? null,
      changes: (scopeChangeRefs.get(scope.id) ?? []).sort((a, b) => a.position - b.position).map((item) => ({
        ...item.change,
        role: item.role,
        checkpoints: bindingsBySubject.get(`plan_change:${item.change.id}`) ?? [],
      })),
      checkpoints: bindingsBySubject.get(`plan_chain_scope:${scope.id}`) ?? [],
    }));
    const unattachedChanges = changes.filter((change) =>
      !snapshot.planChainChangeRefs.some((ref) => ref.planChangeId === change.id));
    const planCheckpoints = [
      ...(bindingsBySubject.get(`plan:${id}`) ?? []),
      ...snapshot.checkpoints.filter((checkpoint) => checkpoint.targetType === "plan" && checkpoint.targetId === id)
        .map((checkpoint) => ({ checkpoint, role: "plan", required: true, position: 0 })),
      ...snapshot.planCheckpointRefs.filter((ref) => ref.planId === id).map((ref) => {
        const checkpoint = snapshot.checkpoints.find((item) => item.id === ref.checkpointId);
        return checkpoint ? { ...ref, checkpoint } : null;
      }).filter(Boolean),
    ].filter((item, index, values) => values.findIndex((candidate) => candidate.checkpoint.id === item.checkpoint.id) === index);
    const title = localizedValue(translations, "plan", id, locale, "title", plan.title);
    const summary = localizedValue(translations, "plan", id, locale, "summary", plan.summary);
    const goal = localizedValue(translations, "plan", id, locale, "goal", plan.goal);
    const lines = [
      `# ${title}`,
      `${plan.phase} #${plan.planOrder} · ${plan.priority} · ${plan.derivedStatus}`,
      "",
      summary || "No summary.",
      "",
      "## Goal",
      goal || "—",
    ];
    const nextAction = localizedValue(translations, "plan", id, locale, "nextAction", plan.nextAction);
    if (nextAction) lines.push("", "## Next action", nextAction);
    if (plan.proposedDelta.length) lines.push("", "## Overall change", ...plan.proposedDelta.map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`));
    if (plan.blockers.length) lines.push("", "## Blockers / prohibitions", ...plan.blockers.map((item) => `- ${item}`));
    if (hierarchy.length === 0) {
      lines.push("", "## Chain scopes", "待迁移：此 Plan 尚未声明 ChainScope 和逐实体变更，不能按 0/0 视为完成。");
    }
    for (const scope of hierarchy) {
      lines.push("", `## ${scope.position + 1}. ${scope.title} [chain:${scope.chainId}]`, scope.summary || "—");
      if (scope.rationale) lines.push(`Reason: ${scope.rationale}`);
      if (scope.nodeIds.length || scope.linkIds.length) lines.push(`Path: ${scope.nodeIds.map((nodeId) => `block:${nodeId}`).join(" → ")}${scope.linkIds.length ? ` · Links ${scope.linkIds.map((linkId) => `link:${linkId}`).join(", ")}` : ""}`);
      if (scope.prohibitions.length) lines.push("Prohibitions:", ...scope.prohibitions.map((item) => `- ${item}`));
      for (const change of scope.changes) {
        lines.push("", `### ${change.title} [${change.entityType}:${change.entityId}]`, change.summary || "—");
        if (change.currentBehavior) lines.push(`Current: ${change.currentBehavior}`);
        if (change.proposedBehavior) lines.push(`Proposed: ${change.proposedBehavior}`);
        if (change.rationale) lines.push(`Reason: ${change.rationale}`);
        if (change.prohibitions.length) lines.push(`Must not: ${change.prohibitions.join("; ")}`);
        if (change.expectedEffects.length) lines.push(`Expected: ${change.expectedEffects.join("; ")}`);
        if (change.sourceRefs.length) lines.push(`Sources: ${change.sourceRefs.join(", ")}`);
        for (const binding of change.checkpoints) {
          const checkpoint = binding.checkpoint;
          lines.push(`- Checkpoint ${checkpoint.status}: ${checkpoint.title} (${checkpoint.evidenceLevel}/${checkpoint.requiredEvidenceLevel})`);
        }
      }
      for (const binding of scope.checkpoints) {
        const checkpoint = binding.checkpoint;
        lines.push(`- Chain gate ${checkpoint.status}: ${checkpoint.title} (${checkpoint.evidenceLevel}/${checkpoint.requiredEvidenceLevel})`);
      }
    }
    if (unattachedChanges.length) {
      lines.push("", "## Cross-Chain changes");
      for (const change of unattachedChanges) lines.push(`- ${change.title} [${change.entityType}:${change.entityId}] — ${change.proposedBehavior || change.summary}`);
    }
    if (planCheckpoints.length) {
      lines.push("", "## Plan acceptance");
      for (const binding of planCheckpoints) {
        const checkpoint = binding.checkpoint;
        lines.push(`- ${checkpoint.status}: ${checkpoint.title} (${checkpoint.evidenceLevel}/${checkpoint.requiredEvidenceLevel})`);
      }
    }
    let markdown = lines.join("\n");
    if (markdown.length > maxChars) markdown = `${markdown.slice(0, Math.max(0, maxChars - 64))}\n\n[truncated; open a referenced entity for detail]`;
    return {
      plan, hierarchy, unattachedChanges, checkpoints: planCheckpoints.map((item) => item.checkpoint),
      dependencies: snapshot.planDependencies.filter((item) => item.planId === id),
      markdown,
    };
  }

  changesSince({ sequence = 0, limit = 100 } = {}) {
    if (!Number.isInteger(sequence) || sequence < 0) throw new Error("sequence must be a non-negative integer");
    const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const rows = this.database.prepare(
      `SELECT cf.sequence, cf.change_set_id, cf.entity_type, cf.entity_id, cf.action, cf.created_at,
              h.revision, h.summary, h.plan_id, h.chain_scope_id, h.before_json, h.after_json,
              h.changed_fields_json, h.affected_refs_json, h.evidence_refs_json
       FROM change_feed cf
       LEFT JOIN history h ON h.change_set_id = cf.change_set_id AND h.entity_type = cf.entity_type
         AND h.entity_id = cf.entity_id AND h.action = cf.action
       WHERE cf.project_id = ? AND cf.sequence > ? ORDER BY cf.sequence LIMIT ?`,
    ).all(this.paths.descriptor.id, sequence, boundedLimit).map((row) => ({
      sequence: row.sequence, changeSetId: row.change_set_id, ref: `${row.entity_type}:${row.entity_id}`,
      action: row.action, revision: row.revision, summary: row.summary, planId: row.plan_id,
      chainScopeId: row.chain_scope_id, before: parseJson(row.before_json, {}), after: parseJson(row.after_json, {}),
      changedFields: parseJson(row.changed_fields_json, []), affectedRefs: parseJson(row.affected_refs_json, []),
      evidenceRefs: parseJson(row.evidence_refs_json, []), createdAt: row.created_at,
    }));
    return { fromSequence: sequence, nextSequence: rows.at(-1)?.sequence ?? sequence, changes: rows };
  }

  contextForTask({ task, focusRefs = [], maxChars = 6000, locale = "en" }) {
    const snapshot = this.snapshot();
    assertAllowed(locale, LOCALES, "locale");
    const translations = localizationMap(snapshot);
    const terms = taskTerms(task);
    const planSignals = new Set(["plan", "todo", "roadmap", "progress", "status", "next", "blocker", "blocked", "release", "readiness", "计划", "进度", "阻塞", "发布"]);
    const taskMentionsPlan = terms.some((term) => planSignals.has(term));
    const scoreText = (text) =>
      terms.reduce((score, term) => score + (text.toLowerCase().includes(term) ? 1 : 0), 0);
    const scoredBlocks = snapshot.blocks
      .map((block) => {
        const semanticScore = scoreText(`${block.title} ${block.summary} ${block.body} ${block.contract} ${block.scope} ${block.architectureLayer} ${block.tags.join(" ")} ${localizedSearchText(snapshot, "block", block.id)}`);
        return { block, score: semanticScore + (focusRefs.includes(`block:${block.id}`) ? 100 : 0) };
      })
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
      .map((plan) => {
        const focused = focusRefs.includes(`plan:${plan.id}`);
        const semanticScore = scoreText(`${plan.title} ${plan.summary} ${plan.goal} ${plan.status} ${plan.nextAction} ${JSON.stringify(plan.proposedDelta)} ${JSON.stringify(plan.blockers)} ${localizedSearchText(snapshot, "plan", plan.id)}`);
        return { plan, semanticScore, score: semanticScore + (focused ? 100 : 0), focused };
      })
      .filter((entry) => entry.focused || entry.semanticScore >= 3 || (taskMentionsPlan && entry.semanticScore >= 1))
      .sort((a, b) => b.score - a.score);

    if (scoredBlocks.length === 0 && scoredChains.length === 0 && scoredPlans.length === 0) {
      for (const plan of snapshot.plans.filter((item) => ["active", "ready", "blocked"].includes(item.status)).slice(0, 3)) {
        scoredPlans.push({ plan, score: 1 });
      }
    }

    const selectedBlockIds = new Set(scoredBlocks.slice(0, 5).map((entry) => entry.block.id));
    const selectedChainIds = new Set(scoredChains.slice(0, 1).map((entry) => entry.chain.id));
    const selectedPlanIds = new Set(scoredPlans.slice(0, 1).map((entry) => entry.plan.id));
    const detailedBlockIds = new Set([
      ...scoredBlocks.slice(0, 3).map((entry) => entry.block.id),
      ...focusRefs.filter((ref) => ref.startsWith("block:")).map((ref) => ref.slice("block:".length)),
    ]);
    const relatedChains = new Map();
    for (const node of snapshot.chainNodes) {
      if (selectedBlockIds.has(node.blockId)) relatedChains.set(node.chainId, (relatedChains.get(node.chainId) ?? 0) + 1);
    }
    for (const [chainId] of [...relatedChains.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      if (selectedChainIds.size >= 1) break;
      selectedChainIds.add(chainId);
    }
    const traversalChainIds = new Set(selectedChainIds);
    for (const target of snapshot.planChainRefs) {
      if (selectedPlanIds.has(target.planId)) selectedChainIds.add(target.chainId);
    }
    for (const chainId of traversalChainIds) {
      const path = snapshot.chainNodes
        .filter((item) => item.chainId === chainId)
        .sort((a, b) => a.position - b.position)
        .map((item) => item.blockId);
      if (focusRefs.includes(`chain:${chainId}`)) {
        for (const blockId of path.slice(0, 10)) selectedBlockIds.add(blockId);
        continue;
      }
      const matchingPositions = path.flatMap((blockId, index) => selectedBlockIds.has(blockId) ? [index] : []);
      for (const position of matchingPositions) {
        for (const index of [position - 1, position, position + 1]) {
          if (path[index]) selectedBlockIds.add(path[index]);
        }
      }
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
    const relevantScopeIDs = new Set(snapshot.planChainScopes.filter((scope) => selectedPlanIds.has(scope.planId)).map((scope) => scope.id));
    const relevantChangeIDs = new Set(snapshot.planChanges.filter((change) => selectedPlanIds.has(change.planId)).map((change) => change.id));
    const boundCheckpointIDs = new Set(snapshot.checkpointBindings.filter((binding) =>
      (binding.subjectType === "plan" && selectedPlanIds.has(binding.subjectId)) ||
      (binding.subjectType === "plan_chain_scope" && relevantScopeIDs.has(binding.subjectId)) ||
      (binding.subjectType === "plan_change" && relevantChangeIDs.has(binding.subjectId)))
      .map((binding) => binding.checkpointId));
    const relevantCheckpoints = snapshot.checkpoints.filter(
      (checkpoint) =>
        (checkpoint.targetType === "block" && selectedBlockIds.has(checkpoint.targetId)) ||
        (checkpoint.targetType === "chain" && selectedChainIds.has(checkpoint.targetId)) ||
        (checkpoint.targetType === "plan" && selectedPlanIds.has(checkpoint.targetId)) ||
        boundCheckpointIDs.has(checkpoint.id),
    );

    const lines = ["# Task Context", `Task: ${task}`, `Graph revision: ${snapshot.project.graphRevision}`, ""];
    const constraints = relevantBlocks.filter((block) => ["principle", "decision"].includes(block.kind));
    if (constraints.length) {
      lines.push("## Must-follow constraints");
      for (const block of constraints) {
        const title = localizedValue(translations, "block", block.id, locale, "title", block.title);
        const summary = localizedValue(translations, "block", block.id, locale, "summary", block.summary);
        lines.push(`- [block:${block.id}] ${title}: ${summary}`);
        const contract = localizedValue(translations, "block", block.id, locale, "contract", block.contract);
        if (contract) lines.push(`  Contract: ${contract}`);
      }
      lines.push("");
    }
    if (relevantPlans.length) {
      lines.push("## Active plans");
      for (const plan of relevantPlans) {
        const title = localizedValue(translations, "plan", plan.id, locale, "title", plan.title);
        const summary = localizedValue(translations, "plan", plan.id, locale, "summary", plan.summary);
        const nextAction = localizedValue(translations, "plan", plan.id, locale, "nextAction", plan.nextAction);
        lines.push(`- [plan:${plan.id}] ${title} — ${plan.phase} #${plan.planOrder} · ${plan.priority} · ${plan.derivedStatus}`);
        const scopes = snapshot.planChainScopes.filter((scope) => scope.planId === plan.id).sort((a, b) => a.position - b.position);
        const changes = snapshot.planChanges.filter((change) => change.planId === plan.id).sort((a, b) => a.position - b.position);
        lines.push(`  Progress: ${plan.progress.completedSteps}/${plan.progress.totalSteps} ${scopes.length || changes.length ? "changes" : "steps"} · ${plan.progress.passedRequiredCheckpoints}/${plan.progress.totalRequiredCheckpoints} required gates`);
        if (plan.derivedReason) lines.push(`  State: ${plan.derivedReason}`);
        const dependencies = snapshot.planDependencies.filter((item) => item.planId === plan.id).sort((a, b) => a.position - b.position);
        if (dependencies.length) lines.push(`  Prerequisites: ${dependencies.map((item) => `[plan:${item.dependsOnPlanId}]`).join(", ")}`);
        const steps = snapshot.planSteps.filter((item) => item.planId === plan.id).sort((a, b) => a.position - b.position);
        for (const step of steps) lines.push(`  ${step.position + 1}. ${step.status}: ${step.title}${step.targetRefs.length ? ` (${step.targetRefs.join(", ")})` : ""}`);
        for (const scope of scopes) {
          lines.push(`  ChainScope ${scope.position + 1}: ${scope.title} [chain:${scope.chainId}] — ${scope.summary || scope.rationale}`);
          if (scope.prohibitions.length) lines.push(`    Prohibitions: ${scope.prohibitions.join("; ")}`);
          const changeIDs = snapshot.planChainChangeRefs.filter((ref) => ref.chainScopeId === scope.id).sort((a, b) => a.position - b.position).map((ref) => ref.planChangeId);
          for (const changeID of changeIDs) {
            const change = changes.find((item) => item.id === changeID);
            if (!change) continue;
            lines.push(`    - [${change.entityType}:${change.entityId}] ${change.title}: ${change.currentBehavior || "—"} -> ${change.proposedBehavior || change.summary || "—"}`);
            if (change.prohibitions.length) lines.push(`      Must not: ${change.prohibitions.join("; ")}`);
            if (change.sourceRefs.length) lines.push(`      Sources: ${change.sourceRefs.join(", ")}`);
          }
        }
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
    const contentBlocks = relevantBlocks.filter((block) => !["principle", "decision"].includes(block.kind));
    if (contentBlocks.length) {
      lines.push("## Relevant blocks");
      for (const block of contentBlocks) {
        const title = localizedValue(translations, "block", block.id, locale, "title", block.title);
        const summary = localizedValue(translations, "block", block.id, locale, "summary", block.summary);
        const body = localizedValue(translations, "block", block.id, locale, "body", block.body);
        const contract = localizedValue(translations, "block", block.id, locale, "contract", block.contract);
        lines.push(`- [block:${block.id}] ${title} — ${block.architectureLayer}/${block.scope} · ${block.deliveryState}/${block.healthState}`);
        if (summary) lines.push(`  ${summary}`);
        if (body && detailedBlockIds.has(block.id)) lines.push(`  Details: ${body}`);
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
      for (const checkpoint of failing) {
        lines.push(`- ${checkpoint.status} · ${checkpoint.evidenceLevel}/${checkpoint.requiredEvidenceLevel} · ${checkpoint.coverage}: ${checkpoint.title}`);
      }
      lines.push("");
    }
    lines.push("## Expand", "Use plan_context for a Plan; use entity_open for a Block, Chain, or Link when more detail is needed.");
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
    if (operations.length > 20) throw new Error("graph_mutate accepts at most 20 operations");
    if (JSON.stringify(operations).length > 65536) throw new Error("graph_mutate input exceeds 64 KB");

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
        const predictedType = operationEntityType(operation.action);
        const before = predictedType && operation.id ? this.historyState(predictedType, operation.id) : {};
        const receipt = this.applyOperation(operation, { changeSetId, timestamp });
        receipt.ref = `${receipt.entityType}:${receipt.id}`;
        receipt.uiLocation = this.uiLocationFor(receipt.entityType, receipt.id);
        receipt.readBack = { ref: receipt.ref, revision: receipt.revision };
        const after = this.historyState(receipt.entityType, receipt.id);
        const changedFields = Object.keys(operation.fields ?? {});
        const affectedRefs = affectedRefsForOperation(operation);
        receipts.push(receipt);
        database
          .prepare(
            `INSERT INTO history(
              change_set_id, entity_type, entity_id, action, revision, summary, plan_id,
              before_json, after_json, changed_fields_json, affected_refs_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            changeSetId,
            receipt.entityType,
            receipt.id,
            receipt.action,
            receipt.revision,
            receipt.summary,
            receipt.entityType === "plan" ? receipt.id : null,
            JSON.stringify(before ?? {}),
            JSON.stringify(after ?? {}),
            JSON.stringify(changedFields),
            JSON.stringify(affectedRefs),
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

  historyState(entityType, id) {
    if (entityType === "block") {
      const row = this.database.prepare("SELECT * FROM blocks WHERE project_id = ? AND id = ?").get(this.paths.descriptor.id, id);
      return row ? {
        ...normalizeBlock(row),
        sourceRefs: this.database.prepare("SELECT path, start_line, end_line, symbol, role FROM source_refs WHERE block_id = ? ORDER BY id").all(id),
      } : {};
    }
    if (entityType === "chain") {
      const row = this.database.prepare("SELECT * FROM chains WHERE project_id = ? AND id = ?").get(this.paths.descriptor.id, id);
      return row ? {
        ...normalizeChain(row),
        nodeIds: this.database.prepare("SELECT block_id FROM chain_nodes WHERE chain_id = ? ORDER BY position").all(id).map((item) => item.block_id),
        linkIds: this.database.prepare("SELECT link_id FROM chain_edges WHERE chain_id = ? ORDER BY position").all(id).map((item) => item.link_id),
      } : {};
    }
    if (entityType === "link") {
      const row = this.database.prepare("SELECT * FROM links WHERE project_id = ? AND id = ?").get(this.paths.descriptor.id, id);
      return row ? normalizeLink(row) : {};
    }
    if (entityType === "plan") {
      const row = this.database.prepare("SELECT * FROM plans WHERE project_id = ? AND id = ?").get(this.paths.descriptor.id, id);
      return row ? {
        ...normalizePlan(row),
        chainScopeIds: this.database.prepare("SELECT id FROM plan_chain_scopes WHERE plan_id = ? ORDER BY position").all(id).map((item) => item.id),
        changeIds: this.database.prepare("SELECT id FROM plan_changes WHERE plan_id = ? ORDER BY position").all(id).map((item) => item.id),
      } : {};
    }
    if (entityType === "checkpoint") {
      const row = this.database.prepare("SELECT * FROM checkpoints WHERE project_id = ? AND id = ?").get(this.paths.descriptor.id, id);
      return row ? {
        id: row.id, targetType: row.target_type, targetId: row.target_id, title: row.title,
        status: row.status, checkpointKind: row.checkpoint_kind, evidenceLevel: row.evidence_level,
        requiredEvidenceLevel: row.required_evidence_level, coverage: row.coverage,
        bindings: this.database.prepare("SELECT subject_type, subject_id, role, required FROM checkpoint_bindings WHERE checkpoint_id = ? ORDER BY position").all(id),
        children: this.database.prepare("SELECT child_checkpoint_id, required FROM checkpoint_dependencies WHERE parent_checkpoint_id = ? ORDER BY position").all(id),
        currentRevision: row.current_revision,
      } : {};
    }
    return {};
  }

  uiLocationFor(entityType, id) {
    if (entityType === "plan") return `Project > Plans > plan:${id}`;
    if (entityType === "chain") return `Project > Chains > chain:${id}`;
    if (entityType === "block") return `Canvas > block:${id}`;
    if (entityType === "link") return `Canvas > link:${id}`;
    if (entityType === "source_ref") return `Project > Block details > Files & Code > ${id}`;
    return `Project > ${entityType}:${id}`;
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
      case "set_plan_dependencies":
        return this.setPlanDependencies(operation, context);
      case "set_plan_steps":
        return this.setPlanSteps(operation, context);
      case "set_plan_checkpoints":
        return this.setPlanCheckpoints(operation, context);
      case "set_plan_chain_scopes":
        return this.setPlanChainScopes(operation, context);
      case "set_plan_changes":
        return this.setPlanChanges(operation, context);
      case "set_plan_chain_change_refs":
        return this.setPlanChainChangeRefs(operation, context);
      case "set_checkpoint_bindings":
        return this.setCheckpointBindings(operation, context);
      case "set_checkpoint_dependencies":
        return this.setCheckpointDependencies(operation, context);
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

  removeStaleLocalizations(entityType, entityId, changedFields, localizations) {
    const localizedFields = LOCALIZED_FIELDS[entityType];
    const explicitlyUpdated = new Set(
      Object.values(localizations ?? {}).flatMap((values) => Object.keys(values ?? {})),
    );
    const remove = this.database.prepare(
      "DELETE FROM localized_text WHERE entity_type = ? AND entity_id = ? AND field = ?",
    );
    for (const field of changedFields) {
      if (localizedFields.has(field) && !explicitlyUpdated.has(field)) {
        remove.run(entityType, entityId, field);
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
        id, project_id, title, summary, goal, status, priority, phase, plan_order,
        proposed_delta_json, completion_policy_json, next_action, blockers_json, status_reason,
        started_at, completed_at, invalidated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, this.paths.descriptor.id, fields.title.trim(), fields.summary ?? "", fields.goal ?? "",
      fields.status ?? "draft", fields.priority ?? "normal", fields.phase ?? "implementation", fields.planOrder ?? 0,
      JSON.stringify(fields.proposedDelta ?? []), JSON.stringify(fields.completionPolicy ?? {}),
      fields.nextAction ?? "", JSON.stringify(fields.blockers ?? []), fields.statusReason ?? "",
      fields.startedAt ?? null, fields.completedAt ?? null, fields.invalidatedAt ?? null, timestamp, timestamp,
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

  planForMutation(operation, action) {
    if (!operation.id || !Number.isInteger(operation.expectedRevision)) {
      throw new Error(`${action} requires id and expectedRevision`);
    }
    const plan = this.database.prepare("SELECT * FROM plans WHERE project_id = ? AND id = ?")
      .get(this.paths.descriptor.id, operation.id);
    if (!plan) throw new Error(`plan:${operation.id} not found`);
    if (plan.current_revision !== operation.expectedRevision) {
      throw new Error(`Revision conflict for plan:${operation.id}; expected ${operation.expectedRevision}, current ${plan.current_revision}`);
    }
    return plan;
  }

  finishPlanRelationMutation(plan, operation, action, summary) {
    const revision = plan.current_revision + 1;
    this.database.prepare("UPDATE plans SET current_revision = ?, updated_at = ? WHERE id = ?")
      .run(revision, now(), operation.id);
    return { entityType: "plan", id: operation.id, action, revision, summary };
  }

  setPlanDependencies(operation) {
    const plan = this.planForMutation(operation, "set_plan_dependencies");
    const planIds = operation.fields?.planIds ?? [];
    if (!Array.isArray(planIds) || new Set(planIds).size !== planIds.length) throw new Error("planIds must be unique");
    for (const dependencyId of planIds) {
      if (dependencyId === operation.id) throw new Error("Plan cannot depend on itself");
      if (!entityExists(this.database, this.paths.descriptor.id, "plan", dependencyId)) throw new Error(`plan:${dependencyId} not found`);
    }
    const existing = this.database.prepare("SELECT plan_id, depends_on_plan_id FROM plan_dependencies").all();
    const adjacency = new Map();
    for (const row of existing) {
      if (row.plan_id === operation.id) continue;
      if (!adjacency.has(row.plan_id)) adjacency.set(row.plan_id, []);
      adjacency.get(row.plan_id).push(row.depends_on_plan_id);
    }
    adjacency.set(operation.id, planIds);
    const visiting = new Set();
    const visited = new Set();
    const hasCycle = (id) => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const next of adjacency.get(id) ?? []) if (hasCycle(next)) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if ([...adjacency.keys()].some(hasCycle)) throw new Error("Plan dependencies must remain acyclic");
    this.database.prepare("DELETE FROM plan_dependencies WHERE plan_id = ?").run(operation.id);
    const insert = this.database.prepare("INSERT INTO plan_dependencies(plan_id, depends_on_plan_id, position) VALUES (?, ?, ?)");
    planIds.forEach((id, index) => insert.run(operation.id, id, index));
    return this.finishPlanRelationMutation(plan, operation, "dependencies-set", `${planIds.length} prerequisite plan(s)`);
  }

  setPlanSteps(operation, { timestamp }) {
    const plan = this.planForMutation(operation, "set_plan_steps");
    const steps = operation.fields?.steps ?? [];
    if (!Array.isArray(steps)) throw new Error("steps must be an array");
    const ids = steps.map((step, index) => step.id ?? `${operation.id}-step-${index + 1}`);
    if (new Set(ids).size !== ids.length) throw new Error("Plan step IDs must be unique");
    for (const [index, step] of steps.entries()) {
      if (!step.title?.trim()) throw new Error(`Plan step ${index + 1} requires title`);
      assertAllowed(step.status ?? "pending", PLAN_STEP_STATUSES, "plan step status");
      for (const ref of step.targetRefs ?? []) {
        const [type, id] = String(ref).split(":", 2);
        if (!id || !entityExists(this.database, this.paths.descriptor.id, type, id)) throw new Error(`Missing Plan step target: ${ref}`);
      }
    }
    this.database.prepare("DELETE FROM plan_steps WHERE plan_id = ?").run(operation.id);
    const insert = this.database.prepare(
      `INSERT INTO plan_steps(id, plan_id, position, title, action, status, target_refs_json, proposed_delta_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    steps.forEach((step, index) => insert.run(
      ids[index], operation.id, index, step.title.trim(), step.action ?? "", step.status ?? "pending",
      JSON.stringify(step.targetRefs ?? []), JSON.stringify(step.proposedDelta ?? []), timestamp, timestamp,
    ));
    return this.finishPlanRelationMutation(plan, operation, "steps-set", `${steps.length} ordered step(s)`);
  }

  setPlanCheckpoints(operation) {
    const plan = this.planForMutation(operation, "set_plan_checkpoints");
    const checkpoints = operation.fields?.checkpoints ?? [];
    if (!Array.isArray(checkpoints)) throw new Error("checkpoints must be an array");
    const stepIds = new Set(this.database.prepare("SELECT id FROM plan_steps WHERE plan_id = ?").all(operation.id).map((row) => row.id));
    for (const item of checkpoints) {
      if (!item.checkpointId || !this.database.prepare("SELECT 1 FROM checkpoints WHERE project_id = ? AND id = ?").get(this.paths.descriptor.id, item.checkpointId)) {
        throw new Error(`checkpoint:${item.checkpointId ?? ""} not found`);
      }
      if (item.stepId && !stepIds.has(item.stepId)) throw new Error(`Plan step not found: ${item.stepId}`);
    }
    this.database.prepare("DELETE FROM plan_checkpoint_refs WHERE plan_id = ?").run(operation.id);
    const insert = this.database.prepare(
      "INSERT INTO plan_checkpoint_refs(plan_id, checkpoint_id, step_id, position, required) VALUES (?, ?, ?, ?, ?)",
    );
    checkpoints.forEach((item, index) => insert.run(operation.id, item.checkpointId, item.stepId ?? null, index, item.required === false ? 0 : 1));
    return this.finishPlanRelationMutation(plan, operation, "checkpoints-set", `${checkpoints.length} checkpoint gate(s)`);
  }

  setPlanChainScopes(operation, { timestamp }) {
    const plan = this.planForMutation(operation, "set_plan_chain_scopes");
    const scopes = operation.fields?.scopes ?? [];
    if (!Array.isArray(scopes)) throw new Error("scopes must be an array");
    const ids = scopes.map((scope, index) => scope.id ?? `${operation.id}-chain-scope-${index + 1}`);
    if (new Set(ids).size !== ids.length) throw new Error("Plan ChainScope IDs must be unique");
    for (const [index, scope] of scopes.entries()) {
      if (!scope.chainId || !entityExists(this.database, this.paths.descriptor.id, "chain", scope.chainId)) {
        throw new Error(`chain:${scope.chainId ?? ""} not found`);
      }
      if (!scope.title?.trim()) throw new Error(`Plan ChainScope ${index + 1} requires title`);
      const chainNodeIds = this.database.prepare("SELECT block_id FROM chain_nodes WHERE chain_id = ? ORDER BY position")
        .all(scope.chainId).map((row) => row.block_id);
      const chainLinkIds = this.database.prepare("SELECT link_id FROM chain_edges WHERE chain_id = ? ORDER BY position")
        .all(scope.chainId).map((row) => row.link_id);
      const nodeIds = scope.nodeIds ?? chainNodeIds;
      const linkIds = scope.linkIds ?? chainLinkIds;
      let lastPosition = -1;
      for (const blockId of nodeIds) {
        const position = chainNodeIds.indexOf(blockId);
        if (position < 0) throw new Error(`Plan ChainScope references block:${blockId} outside chain:${scope.chainId}`);
        if (position <= lastPosition) throw new Error(`Plan ChainScope nodes must follow chain:${scope.chainId} order`);
        lastPosition = position;
      }
      for (const linkId of linkIds) {
        if (!chainLinkIds.includes(linkId)) throw new Error(`Plan ChainScope references link:${linkId} outside chain:${scope.chainId}`);
      }
      if (scope.startBlockId && nodeIds[0] !== scope.startBlockId) throw new Error("startBlockId must be the first scoped node");
      if (scope.endBlockId && nodeIds.at(-1) !== scope.endBlockId) throw new Error("endBlockId must be the last scoped node");
    }
    this.database.prepare("DELETE FROM plan_chain_scopes WHERE plan_id = ?").run(operation.id);
    const insert = this.database.prepare(
      `INSERT INTO plan_chain_scopes(
        id, plan_id, chain_id, position, title, summary, rationale, start_block_id, end_block_id,
        node_ids_json, link_ids_json, expected_delta_json, prohibitions_json, localizations_json,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    scopes.forEach((scope, index) => {
      const chainNodeIds = this.database.prepare("SELECT block_id FROM chain_nodes WHERE chain_id = ? ORDER BY position")
        .all(scope.chainId).map((row) => row.block_id);
      const chainLinkIds = this.database.prepare("SELECT link_id FROM chain_edges WHERE chain_id = ? ORDER BY position")
        .all(scope.chainId).map((row) => row.link_id);
      insert.run(
        ids[index], operation.id, scope.chainId, index, scope.title.trim(), scope.summary ?? "", scope.rationale ?? "",
        scope.startBlockId ?? (scope.nodeIds ?? chainNodeIds)[0] ?? null,
        scope.endBlockId ?? (scope.nodeIds ?? chainNodeIds).at(-1) ?? null,
        JSON.stringify(scope.nodeIds ?? chainNodeIds), JSON.stringify(scope.linkIds ?? chainLinkIds),
        JSON.stringify(scope.expectedDelta ?? []), JSON.stringify(scope.prohibitions ?? []),
        JSON.stringify(scope.localizations ?? {}), scope.status ?? "pending", timestamp, timestamp,
      );
    });
    this.database.prepare("DELETE FROM plan_chain_refs WHERE plan_id = ?").run(operation.id);
    const targetInsert = this.database.prepare("INSERT INTO plan_chain_refs(plan_id, chain_id, position) VALUES (?, ?, ?)");
    [...new Set(scopes.map((scope) => scope.chainId))].forEach((chainId, index) => targetInsert.run(operation.id, chainId, index));
    return this.finishPlanRelationMutation(plan, operation, "chain-scopes-set", `${scopes.length} detailed Chain scope(s)`);
  }

  setPlanChanges(operation, { timestamp }) {
    const plan = this.planForMutation(operation, "set_plan_changes");
    const changes = operation.fields?.changes ?? [];
    if (!Array.isArray(changes)) throw new Error("changes must be an array");
    const keys = changes.map((change) => `${change.entityType}:${change.entityId}`);
    if (new Set(keys).size !== keys.length) throw new Error("A Plan may define only one canonical change per entity");
    for (const [index, change] of changes.entries()) {
      if (!change.title?.trim()) throw new Error(`Plan change ${index + 1} requires title`);
      if (!["block", "link", "chain"].includes(change.entityType) ||
          !entityExists(this.database, this.paths.descriptor.id, change.entityType, change.entityId)) {
        throw new Error(`${change.entityType}:${change.entityId} not found`);
      }
    }
    this.database.prepare("DELETE FROM plan_changes WHERE plan_id = ?").run(operation.id);
    const insert = this.database.prepare(
      `INSERT INTO plan_changes(
        id, plan_id, entity_type, entity_id, position, title, summary, current_behavior, proposed_behavior,
        rationale, prohibitions_json, expected_effects_json, source_refs_json, localizations_json,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    changes.forEach((change, index) => insert.run(
      change.id ?? `${operation.id}-${change.entityType}-${change.entityId}`, operation.id,
      change.entityType, change.entityId, index, change.title.trim(), change.summary ?? "",
      change.currentBehavior ?? "", change.proposedBehavior ?? "", change.rationale ?? "",
      JSON.stringify(change.prohibitions ?? []), JSON.stringify(change.expectedEffects ?? []),
      JSON.stringify(change.sourceRefs ?? []), JSON.stringify(change.localizations ?? {}),
      change.status ?? "pending", timestamp, timestamp,
    ));
    return this.finishPlanRelationMutation(plan, operation, "changes-set", `${changes.length} canonical entity change(s)`);
  }

  setPlanChainChangeRefs(operation) {
    const plan = this.planForMutation(operation, "set_plan_chain_change_refs");
    const refs = operation.fields?.refs ?? [];
    if (!Array.isArray(refs)) throw new Error("refs must be an array");
    const scopes = new Set(this.database.prepare("SELECT id FROM plan_chain_scopes WHERE plan_id = ?").all(operation.id).map((row) => row.id));
    const changes = new Set(this.database.prepare("SELECT id FROM plan_changes WHERE plan_id = ?").all(operation.id).map((row) => row.id));
    for (const ref of refs) {
      if (!scopes.has(ref.chainScopeId)) throw new Error(`Plan ChainScope not found: ${ref.chainScopeId}`);
      if (!changes.has(ref.planChangeId)) throw new Error(`Plan change not found: ${ref.planChangeId}`);
    }
    this.database.prepare(
      "DELETE FROM plan_chain_change_refs WHERE chain_scope_id IN (SELECT id FROM plan_chain_scopes WHERE plan_id = ?)",
    ).run(operation.id);
    const insert = this.database.prepare(
      "INSERT INTO plan_chain_change_refs(chain_scope_id, plan_change_id, role, position) VALUES (?, ?, ?, ?)",
    );
    refs.forEach((ref, index) => insert.run(ref.chainScopeId, ref.planChangeId, ref.role ?? "affected", ref.position ?? index));
    return this.finishPlanRelationMutation(plan, operation, "chain-change-refs-set", `${refs.length} Chain-to-change reference(s)`);
  }

  checkpointForMutation(operation, action) {
    if (!operation.id || !Number.isInteger(operation.expectedRevision)) throw new Error(`${action} requires id and expectedRevision`);
    const checkpoint = this.database.prepare("SELECT * FROM checkpoints WHERE project_id = ? AND id = ?")
      .get(this.paths.descriptor.id, operation.id);
    if (!checkpoint) throw new Error(`checkpoint:${operation.id} not found`);
    if (checkpoint.current_revision !== operation.expectedRevision) {
      throw new Error(`Revision conflict for checkpoint:${operation.id}; expected ${operation.expectedRevision}, current ${checkpoint.current_revision}`);
    }
    return checkpoint;
  }

  finishCheckpointRelationMutation(checkpoint, operation, action, summary) {
    const revision = checkpoint.current_revision + 1;
    this.database.prepare("UPDATE checkpoints SET current_revision = ?, updated_at = ? WHERE id = ?")
      .run(revision, now(), operation.id);
    return { entityType: "checkpoint", id: operation.id, action, revision, summary };
  }

  setCheckpointBindings(operation) {
    const checkpoint = this.checkpointForMutation(operation, "set_checkpoint_bindings");
    const bindings = operation.fields?.bindings ?? [];
    if (!Array.isArray(bindings)) throw new Error("bindings must be an array");
    for (const binding of bindings) {
      if (!entityExists(this.database, this.paths.descriptor.id, binding.subjectType, binding.subjectId)) {
        throw new Error(`${binding.subjectType}:${binding.subjectId} not found`);
      }
    }
    this.database.prepare("DELETE FROM checkpoint_bindings WHERE checkpoint_id = ?").run(operation.id);
    const insert = this.database.prepare(
      "INSERT INTO checkpoint_bindings(checkpoint_id, subject_type, subject_id, role, required, position) VALUES (?, ?, ?, ?, ?, ?)",
    );
    bindings.forEach((binding, index) => insert.run(
      operation.id, binding.subjectType, binding.subjectId, binding.role ?? "leaf",
      binding.required === false ? 0 : 1, binding.position ?? index,
    ));
    return this.finishCheckpointRelationMutation(checkpoint, operation, "bindings-set", `${bindings.length} subject binding(s)`);
  }

  setCheckpointDependencies(operation) {
    const checkpoint = this.checkpointForMutation(operation, "set_checkpoint_dependencies");
    const children = operation.fields?.children ?? [];
    if (!Array.isArray(children)) throw new Error("children must be an array");
    const ids = children.map((child) => child.checkpointId);
    if (new Set(ids).size !== ids.length) throw new Error("Checkpoint child IDs must be unique");
    for (const childId of ids) {
      if (childId === operation.id) throw new Error("Checkpoint cannot depend on itself");
      if (!this.database.prepare("SELECT 1 FROM checkpoints WHERE project_id = ? AND id = ?").get(this.paths.descriptor.id, childId)) {
        throw new Error(`checkpoint:${childId ?? ""} not found`);
      }
    }
    const rows = this.database.prepare(
      `SELECT cd.parent_checkpoint_id, cd.child_checkpoint_id FROM checkpoint_dependencies cd
       JOIN checkpoints c ON c.id = cd.parent_checkpoint_id WHERE c.project_id = ?`,
    ).all(this.paths.descriptor.id);
    const adjacency = new Map();
    for (const row of rows) {
      if (row.parent_checkpoint_id === operation.id) continue;
      const values = adjacency.get(row.parent_checkpoint_id) ?? [];
      values.push(row.child_checkpoint_id);
      adjacency.set(row.parent_checkpoint_id, values);
    }
    adjacency.set(operation.id, ids);
    const visiting = new Set();
    const visited = new Set();
    const hasCycle = (id) => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const child of adjacency.get(id) ?? []) if (hasCycle(child)) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if ([...adjacency.keys()].some(hasCycle)) throw new Error("Checkpoint dependencies must remain acyclic");
    this.database.prepare("DELETE FROM checkpoint_dependencies WHERE parent_checkpoint_id = ?").run(operation.id);
    const insert = this.database.prepare(
      "INSERT INTO checkpoint_dependencies(parent_checkpoint_id, child_checkpoint_id, position, required) VALUES (?, ?, ?, ?)",
    );
    children.forEach((child, index) => insert.run(operation.id, child.checkpointId, child.position ?? index, child.required === false ? 0 : 1));
    return this.finishCheckpointRelationMutation(checkpoint, operation, "dependencies-set", `${children.length} child checkpoint(s)`);
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
    const insertNode = this.database.prepare("INSERT INTO chain_nodes(chain_id, block_id, position, role) VALUES (?, ?, ?, 'path')");
    nodeIds.forEach((blockId, index) => {
      insertNode.run(operation.id, blockId, index);
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
    assertAllowed(fields.architectureLayer ?? "unspecified", ARCHITECTURE_LAYERS, "architecture layer");
    assertAllowed(fields.deliveryState ?? "proposed", DELIVERY_STATES, "delivery state");
    assertAllowed(fields.healthState ?? "unknown", HEALTH_STATES, "health state");
    if (!fields.title?.trim()) throw new Error("create_block requires fields.title");
    if (fields.scope != null && (typeof fields.scope !== "string" || !fields.scope.trim())) {
      throw new Error("fields.scope must be a non-empty string");
    }
    if (fields.localOrder != null && !Number.isInteger(fields.localOrder)) {
      throw new Error("fields.localOrder must be an integer");
    }
    const id = operation.id ?? identifier("block");
    this.database
      .prepare(
        `INSERT INTO blocks(
          id, project_id, kind, title, summary, body, contract, scope, architecture_layer,
          local_order, delivery_state, health_state, priority, confidence, tags_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.paths.descriptor.id,
        fields.kind,
        fields.title.trim(),
        fields.summary ?? "",
        fields.body ?? "",
        fields.contract ?? "",
        fields.scope?.trim() ?? "general",
        fields.architectureLayer ?? "unspecified",
        fields.localOrder ?? 0,
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
      if (field === "architectureLayer") assertAllowed(rawValue, ARCHITECTURE_LAYERS, "architecture layer");
      if (field === "scope" && (typeof rawValue !== "string" || !rawValue.trim())) {
        throw new Error("scope must be a non-empty string");
      }
      if (field === "localOrder" && !Number.isInteger(rawValue)) {
        throw new Error("localOrder must be an integer");
      }
      if (field === "deliveryState") assertAllowed(rawValue, DELIVERY_STATES, "delivery state");
      if (field === "healthState") assertAllowed(rawValue, HEALTH_STATES, "health state");
      if (field === "status") assertAllowed(rawValue, PLAN_STATUSES, "plan status");
      const column = field === "proposedDelta" ? "proposed_delta_json"
        : field === "completionPolicy" ? "completion_policy_json"
          : field === "blockers" ? "blockers_json" : camelToColumn(field);
      updates.push(`${column} = ?`);
      values.push(field === "tags" ? serializeTags(rawValue)
        : ["proposedDelta", "blockers", "completionPolicy"].includes(field) ? JSON.stringify(rawValue ?? (field === "completionPolicy" ? {} : []))
          : field === "archived" ? Number(Boolean(rawValue)) : field === "scope" ? rawValue.trim() : rawValue);
    }
    if (updates.length === 0 && localizations == null) throw new Error(`update_${type} has no fields`);
    const revision = existing.current_revision + 1;
    updates.push("current_revision = ?", "updated_at = ?");
    values.push(revision, timestamp, this.paths.descriptor.id, operation.id);
    this.database
      .prepare(`UPDATE ${config.table} SET ${updates.join(", ")} WHERE project_id = ? AND id = ?`)
      .run(...values);
    this.removeStaleLocalizations(type, operation.id, Object.keys(fields), localizations);
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

  recordCheckpoint({
    actor = "agent", id, targetType, targetId, title, criteria = "", status,
    checkpointKind = "atomic", aggregationPolicy = {}, eligibleAfterChildren = false,
    evidenceLevel, requiredEvidenceLevel = "static", coverage = "complete",
    evidence = [], invalidatedAt = null, expectedRevision,
  }) {
    if (!["block", "chain", "link", "plan"].includes(targetType)) throw new Error(`Invalid targetType: ${targetType}`);
    if (!title?.trim()) throw new Error("title is required");
    assertAllowed(status, CHECKPOINT_STATUSES, "checkpoint status");
    assertAllowed(checkpointKind, CHECKPOINT_KINDS, "checkpoint kind");
    if (!entityExists(this.database, this.paths.descriptor.id, targetType, targetId)) {
      throw new Error(`${targetType}:${targetId} not found`);
    }
    const resolvedEvidenceLevel = evidenceLevel ?? (status === "passed" ? "static" : "none");
    assertAllowed(resolvedEvidenceLevel, EVIDENCE_LEVELS, "evidence level");
    assertAllowed(requiredEvidenceLevel, EVIDENCE_LEVELS, "required evidence level");
    if (!["complete", "partial"].includes(coverage)) throw new Error(`Invalid checkpoint coverage: ${coverage}`);
    if (status === "passed" && coverage !== "complete") throw new Error("Passed checkpoint requires complete coverage");
    if (checkpointKind === "aggregate" && status === "passed") {
      throw new Error("Aggregate checkpoint status is derived from child checkpoints and cannot be recorded as passed");
    }
    if (status === "passed" && (EVIDENCE_LEVEL_RANK.get(resolvedEvidenceLevel) ?? 0) < (EVIDENCE_LEVEL_RANK.get(requiredEvidenceLevel) ?? 0)) {
      throw new Error(`Passed checkpoint requires ${requiredEvidenceLevel} evidence, received ${resolvedEvidenceLevel}`);
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
        if (existing.project_id !== this.paths.descriptor.id || existing.target_type !== targetType || existing.target_id !== targetId) {
          throw new Error(`checkpoint:${checkpointId} target cannot be changed`);
        }
        if (!Number.isInteger(expectedRevision) || expectedRevision !== existing.current_revision) {
          throw new Error(
            `Revision conflict for checkpoint:${checkpointId}; expected ${expectedRevision}, current ${existing.current_revision}`,
          );
        }
        revision = existing.current_revision + 1;
        action = "updated";
        this.database
          .prepare(
            `UPDATE checkpoints SET title = ?, criteria = ?, status = ?, checkpoint_kind = ?,
             aggregation_policy_json = ?, eligible_after_children = ?, evidence_level = ?,
             required_evidence_level = ?, coverage = ?, evidence_json = ?, invalidated_at = ?,
             current_revision = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            title, criteria, status, checkpointKind, JSON.stringify(aggregationPolicy ?? {}), Number(Boolean(eligibleAfterChildren)),
            resolvedEvidenceLevel, requiredEvidenceLevel, coverage,
            JSON.stringify(evidence), invalidatedAt, revision, timestamp, checkpointId,
          );
      } else {
        this.database
          .prepare(
            `INSERT INTO checkpoints(
              id, project_id, target_type, target_id, title, criteria, status, checkpoint_kind,
              aggregation_policy_json, eligible_after_children, evidence_level,
              required_evidence_level, coverage, evidence_json, invalidated_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            checkpointId,
            this.paths.descriptor.id,
            targetType,
            targetId,
            title,
            criteria,
            status,
            checkpointKind,
            JSON.stringify(aggregationPolicy ?? {}),
            Number(Boolean(eligibleAfterChildren)),
            resolvedEvidenceLevel,
            requiredEvidenceLevel,
            coverage,
            JSON.stringify(evidence),
            invalidatedAt,
            timestamp,
            timestamp,
          );
      }
      const targetTable = targetType === "block" ? "blocks" : targetType === "chain" ? "chains" : targetType === "link" ? "links" : "plans";
      const healthState = status === "passed" ? "healthy" : status === "failed" ? "failing" : ["blocked", "partial_pass", "retest_required"].includes(status) ? "warning" : null;
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
        checkpoint: {
          id: checkpointId, revision, status, checkpointKind, aggregationPolicy,
          eligibleAfterChildren: Boolean(eligibleAfterChildren), evidenceLevel: resolvedEvidenceLevel,
          requiredEvidenceLevel, coverage,
        },
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
    for (const dependency of snapshot.planDependencies) {
      if (!snapshot.plans.some((plan) => plan.id === dependency.planId)) errors.push(`Missing dependent Plan: plan:${dependency.planId}`);
      if (!snapshot.plans.some((plan) => plan.id === dependency.dependsOnPlanId)) errors.push(`Missing prerequisite Plan: plan:${dependency.dependsOnPlanId}`);
    }
    for (const step of snapshot.planSteps) {
      if (!snapshot.plans.some((plan) => plan.id === step.planId)) errors.push(`Missing Plan for step: ${step.id}`);
      for (const ref of step.targetRefs) {
        const [type, id] = String(ref).split(":", 2);
        if (!id || !entityExists(this.database, this.paths.descriptor.id, type, id)) errors.push(`Missing Plan step target: ${step.id} -> ${ref}`);
      }
    }
    for (const ref of snapshot.planCheckpointRefs) {
      if (!snapshot.plans.some((plan) => plan.id === ref.planId)) errors.push(`Missing Plan checkpoint owner: plan:${ref.planId}`);
      if (!snapshot.checkpoints.some((checkpoint) => checkpoint.id === ref.checkpointId)) errors.push(`Missing Plan checkpoint: plan:${ref.planId} -> checkpoint:${ref.checkpointId}`);
      if (ref.stepId && !snapshot.planSteps.some((step) => step.id === ref.stepId && step.planId === ref.planId)) {
        errors.push(`Checkpoint references a foreign Plan step: checkpoint:${ref.checkpointId} -> ${ref.stepId}`);
      }
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
    const unspecifiedBlocks = snapshot.blocks.filter((block) => block.architectureLayer === "unspecified");
    if (unspecifiedBlocks.length > 0) {
      warnings.push(`${unspecifiedBlocks.length} block(s) have no architecture layer`);
    }
    for (const chain of snapshot.chains) {
      if (chain.deliveryState === "complete") {
        const passed = snapshot.checkpoints.some(
          (checkpoint) => checkpoint.targetType === "chain" && checkpoint.targetId === chain.id && checkpoint.status === "passed",
        );
        if (!passed) warnings.push(`Complete Chain has no passed checkpoint: chain:${chain.id}`);
      }
    }
    for (const plan of snapshot.plans) {
      if (plan.status === "complete") {
        const required = snapshot.planCheckpointRefs.filter((item) => item.planId === plan.id && item.required);
        const fallback = snapshot.checkpoints.filter((checkpoint) => checkpoint.targetType === "plan" && checkpoint.targetId === plan.id);
        const gates = required.length ? required.map((item) => snapshot.checkpoints.find((checkpoint) => checkpoint.id === item.checkpointId)).filter(Boolean) : fallback;
        if (!gates.length || gates.some((checkpoint) => !checkpointSatisfiesGate(checkpoint))) {
          warnings.push(`Complete plan has unsatisfied checkpoint gates: plan:${plan.id}`);
        }
        const steps = snapshot.planSteps.filter((step) => step.planId === plan.id);
        if (steps.length && steps.some((step) => !["complete", "skipped"].includes(step.status))) {
          warnings.push(`Complete plan has unfinished steps: plan:${plan.id}`);
        }
      }
      if (snapshot.planChainRefs.every((item) => item.planId !== plan.id)) warnings.push(`Plan has no target Chain: plan:${plan.id}`);
    }
    return { valid: errors.length === 0, errors, warnings, graphRevision: snapshot.project.graphRevision };
  }
}

export function createService(options = {}) {
  return new MdflowService(options);
}
