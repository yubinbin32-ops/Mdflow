import {
  architectureCoverage,
  assertAllowed,
  LOCALES,
  ARCHITECTURE_LAYERS,
  DECISION_STATUSES,
  LEGACY_BLOCK_KINDS,
  localizationMap,
  localizedValue,
  localizedSearchText,
  taskTerms,
  normalizeBlock,
  normalizeChain,
  normalizeLink,
  normalizePlan,
  normalizeDecision,
  parseJson,
  entityExists,
  checkpointSatisfiesGate,
} from "./schema.mjs";

export function renderProjectMap(service, { locale = "en" } = {}) {
  const snapshot = service.snapshot();
  const coverage = architectureCoverage(snapshot);
  const graphBlocks = snapshot.blocks.filter((block) => block.kind !== "decision");
  assertAllowed(locale, LOCALES, "locale");
  const translations = localizationMap(snapshot);
  const layerCounts = Object.fromEntries(
      [...ARCHITECTURE_LAYERS]
      .map((layer) => [layer, graphBlocks.filter((block) => block.architectureLayer === layer).length])
      .filter(([, count]) => count > 0),
  );
  const scopeCounts = Object.fromEntries(
    [...new Set(graphBlocks.map((block) => block.scope))]
      .sort()
      .map((scope) => [scope, graphBlocks.filter((block) => block.scope === scope).length]),
  );
  const architectureGroups = [...new Set(graphBlocks.map((block) => `${block.architectureLayer}\u0000${block.scope}`))]
    .sort()
    .map((key) => {
      const [layer, scope] = key.split("\u0000");
      const members = graphBlocks
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
  lines.push(`- ${graphBlocks.length} Blocks / ${snapshot.links.length} Links / ${snapshot.chains.length} Chain overlays`);
  lines.push(`- ${snapshot.decisions.length} Decisions (scoped index; expand a record on demand)`);
  lines.push(`- Coverage: ${coverage.verified}/${coverage.totalBlocks} verified · ${coverage.planned}/${coverage.totalBlocks} planned · ${coverage.withCheckpoint}/${coverage.totalBlocks} with checkpoints`);
  lines.push(`- Verification coverage: ${coverage.verificationCovered}/${coverage.totalBlocks} bound or passed · ${coverage.inChains} in Chains · ${coverage.outsideChainIds.length} standalone`);
  lines.push(`- Architecture coverage: ${coverage.directPlanBlocks} direct Plan Blocks · ${coverage.chainPlanBlocks} through Chains · ${coverage.unverifiedIds.length} unverified · ${coverage.failingIds.length} failing`);
  if (coverage.unverifiedIds.length) lines.push(`- Unverified Blocks: ${coverage.unverifiedIds.slice(0, 12).map((id) => `block:${id}`).join(", ")}${coverage.unverifiedIds.length > 12 ? " …" : ""}`);
  if (coverage.failingIds.length) lines.push(`- Failed verification: ${coverage.failingIds.slice(0, 12).map((id) => `block:${id}`).join(", ")}${coverage.failingIds.length > 12 ? " …" : ""}`);
  if (coverage.outsideChainIds.length) lines.push(`- Outside Chains: ${coverage.outsideChainIds.slice(0, 12).map((id) => `block:${id}`).join(", ")}${coverage.outsideChainIds.length > 12 ? " …" : ""}`);
  if (coverage.unplannedIds.length) lines.push(`- Unplanned Blocks: ${coverage.unplannedIds.slice(0, 12).map((id) => `block:${id}`).join(", ")}${coverage.unplannedIds.length > 12 ? " …" : ""}`);
  if (coverage.withoutCheckpointIds.length) lines.push(`- Checkpoint-free Blocks (verification not requested yet): ${coverage.withoutCheckpointIds.slice(0, 12).map((id) => `block:${id}`).join(", ")}${coverage.withoutCheckpointIds.length > 12 ? " …" : ""}`);
  if (coverage.requiredCheckpointMissingIds.length) lines.push(`- Required checkpoints missing: ${coverage.requiredCheckpointMissingIds.slice(0, 12).map((id) => `block:${id}`).join(", ")}${coverage.requiredCheckpointMissingIds.length > 12 ? " …" : ""}`);
  if (coverage.checkpointUnboundIds.length) lines.push(`- Unbound Block checkpoints: ${coverage.checkpointUnboundIds.slice(0, 12).map((id) => `block:${id}`).join(", ")}${coverage.checkpointUnboundIds.length > 12 ? " …" : ""}`);
  if (coverage.chainGateMissingIds.length) lines.push(`- Missing Chain integration gates: ${coverage.chainGateMissingIds.slice(0, 12).map((id) => `block:${id}`).join(", ")}${coverage.chainGateMissingIds.length > 12 ? " …" : ""}`);
  lines.push(`- Architecture layers: ${Object.entries(layerCounts).map(([layer, count]) => `${layer} ${count}`).join(" · ") || "None"}`);
  lines.push(`- Scopes: ${Object.entries(scopeCounts).map(([scope, count]) => `${scope} ${count}`).join(" · ") || "None"}`);
  for (const block of graphBlocks.filter((item) => item.priority === "critical").slice(0, 8)) {
    const title = localizedValue(translations, "block", block.id, locale, "title", block.title);
    lines.push(`- [block:${block.id}] ${title} — ${block.deliveryState}/${block.healthState}`);
  }
  if (snapshot.decisions.length) {
    lines.push("", "## Decision index");
    for (const decision of snapshot.decisions.slice(0, 12)) {
      const scopes = snapshot.decisionScopes.filter((scope) => scope.decisionId === decision.id)
        .map((scope) => `${scope.scopeType}:${scope.scopeValue}`);
      lines.push(`- [decision:${decision.id}] ${decision.title} · ${decision.status}${scopes.length ? ` · scopes ${scopes.join(", ")}` : ""} · use decision_open for rationale`);
    }
    if (snapshot.decisions.length > 12) lines.push(`- … ${snapshot.decisions.length - 12} more; use decision_list for the complete index.`);
  }
  return {
    map: {
      project: snapshot.project,
      changeSequence: snapshot.changeSequence,
      counts: {
        blocks: graphBlocks.length,
        links: snapshot.links.length,
        chains: snapshot.chains.length,
        plans: snapshot.plans.length,
        decisions: snapshot.decisions.length,
      },
      architecture: {
        layerCounts,
        scopeCounts,
        groups: architectureGroups,
        coverage,
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
        typedProgress: plan.typedProgress,
        dependencyPlanIds: snapshot.planDependencies.filter((item) => item.planId === plan.id).sort((a, b) => a.position - b.position).map((item) => item.dependsOnPlanId),
        targetChainIds: snapshot.planChainRefs.filter((item) => item.planId === plan.id).sort((a, b) => a.position - b.position).map((item) => item.chainId),
      })),
      criticalBlocks: graphBlocks.filter((item) => item.priority === "critical").slice(0, 8).map((block) => ({
        id: block.id,
        title: localizedValue(translations, "block", block.id, locale, "title", block.title),
        deliveryState: block.deliveryState,
        healthState: block.healthState,
      })),
      decisions: snapshot.decisions.map((decision) => ({
        id: decision.id,
        title: decision.title,
        status: decision.status,
        scopes: snapshot.decisionScopes.filter((scope) => scope.decisionId === decision.id),
      })),
    },
    markdown: lines.join("\n"),
  };
}

export function listDecisions(service, { locale = "en" } = {}) {
  const snapshot = service.snapshot();
  assertAllowed(locale, LOCALES, "locale");
  const decisions = snapshot.decisions.map((decision) => ({
    id: decision.id,
    title: decision.title,
    summary: decision.summary,
    status: decision.status,
    currentRevision: decision.currentRevision,
    supersedesDecisionId: decision.supersedesDecisionId,
    scopes: snapshot.decisionScopes
      .filter((scope) => scope.decisionId === decision.id)
      .map((scope) => ({ type: scope.scopeType, value: scope.scopeValue })),
  }));
  const lines = ["# Decision index", `- Graph revision: ${snapshot.project.graphRevision}`, `- Count: ${decisions.length}`, ""];
  for (const decision of decisions) {
    const scopes = decision.scopes.map((scope) => `${scope.type}:${scope.value}`).join(", ");
    lines.push(`- [decision:${decision.id}] ${decision.title} · ${decision.status}${scopes ? ` · scopes ${scopes}` : ""} · use decision_open for rationale`);
  }
  return { decisions, markdown: lines.join("\n") };
}

export function searchEntities(service, { query, kinds = [], states = [], limit = 20, locale = "en" } = {}) {
  const term = `%${query.trim()}%`;
  const terms = taskTerms(query);
  const snapshot = service.snapshot();
  assertAllowed(locale, LOCALES, "locale");
  const translations = localizationMap(snapshot);
  const kindSet = new Set(kinds);
  const stateSet = new Set(states);
  const score = (text) => terms.reduce((total, item) => total + (text.toLowerCase().includes(item) ? 1 : 0), 0);
  const blocks = snapshot.blocks.filter((block) => block.kind !== "decision").map((block) => {
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
  const decisions = snapshot.decisions.map((decision) => {
    const text = `${decision.title}\n${decision.summary}\n${decision.rationale}\n${decision.status}\n${JSON.stringify(decision.alternatives)}\n${JSON.stringify(decision.consequences)}`;
    return { item: decision, score: score(text) };
  }).filter(({ item: decision, score }) => score > 0 &&
    (kindSet.size === 0 || kindSet.has("decision")) &&
    (stateSet.size === 0 || stateSet.has(decision.status)))
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id)).map(({ item }) => item);
  const sourceRows = service.database
    .prepare(
      `SELECT sr.*, b.title FROM source_refs sr JOIN blocks b ON b.id = sr.block_id
       WHERE b.project_id = ? AND (sr.path LIKE ? OR COALESCE(sr.symbol, '') LIKE ?) LIMIT ?`,
    )
    .all(service.paths.descriptor.id, term, term, limit);
  const searchItems = [
    ...blocks.map((block) => `- [block:${block.id}] ${localizedValue(translations, "block", block.id, locale, "title", block.title)} · ${block.deliveryState}`),
    ...chains.map((chain) => `- [chain:${chain.id}] ${localizedValue(translations, "chain", chain.id, locale, "title", chain.title)} · ${chain.deliveryState}`),
    ...plans.map((plan) => `- [plan:${plan.id}] ${localizedValue(translations, "plan", plan.id, locale, "title", plan.title)} · ${plan.status}`),
    ...decisions.map((decision) => `- [decision:${decision.id}] ${decision.title} · ${decision.status} · use decision_open for rationale`),
    ...sourceRows.map((row) => `- [source:${row.id}] ${localizedValue(translations, "block", row.block_id, locale, "title", row.title)} · ${row.path}${row.start_line ? `:${row.start_line}` : ""}`),
  ].slice(0, limit);
  return {
    query,
    results: [
      ...blocks.map((block) => ({ type: "block", id: block.id, title: localizedValue(translations, "block", block.id, locale, "title", block.title), state: block.deliveryState })),
      ...chains.map((chain) => ({ type: "chain", id: chain.id, title: localizedValue(translations, "chain", chain.id, locale, "title", chain.title), state: chain.deliveryState })),
      ...plans.map((plan) => ({ type: "plan", id: plan.id, title: localizedValue(translations, "plan", plan.id, locale, "title", plan.title), state: plan.status })),
      ...decisions.map((decision) => ({ type: "decision", id: decision.id, title: decision.title, state: decision.status })),
      ...sourceRows.map((row) => ({
        type: "source",
        id: row.id,
        title: `${localizedValue(translations, "block", row.block_id, locale, "title", row.title)}: ${row.path}${row.start_line ? `:${row.start_line}` : ""}`,
        blockId: row.block_id,
      })),
    ].slice(0, limit),
    markdown: [
      `# Search: ${query}`,
      `Count: ${searchItems.length}`,
      "",
      ...searchItems,
    ].join("\n"),
  };
}

export function openEntity(service, rawPayload = {}) {
  const payload = typeof rawPayload === "string" ? { ref: rawPayload } : (rawPayload ?? {});
  let { type, id, historyLimit = 8, locale = "en" } = payload;
  if ((!type || !id) && payload.ref) {
    const parts = payload.ref.split(":");
    type = parts[0];
    id = parts.slice(1).join(":");
  }
  const projectId = service.paths.descriptor.id;
  let entity;
  if (type === "block") {
    const row = service.database.prepare("SELECT * FROM blocks WHERE project_id = ? AND id = ?").get(projectId, id);
    if (row) entity = normalizeBlock(row);
  } else if (type === "chain") {
    const row = service.database.prepare("SELECT * FROM chains WHERE project_id = ? AND id = ?").get(projectId, id);
    if (row) entity = normalizeChain(row);
  } else if (type === "link") {
    const row = service.database.prepare("SELECT * FROM links WHERE project_id = ? AND id = ?").get(projectId, id);
    if (row) entity = normalizeLink(row);
  } else if (type === "plan") {
    const row = service.database.prepare("SELECT * FROM plans WHERE project_id = ? AND id = ?").get(projectId, id);
    if (row) entity = normalizePlan(row);
  } else if (type === "decision") {
    const row = service.database.prepare("SELECT * FROM decisions WHERE project_id = ? AND id = ?").get(projectId, id);
    if (row) entity = normalizeDecision(row);
  }
  if (!entity) throw new Error(`${type}:${id} not found`);

  const checkpoints = service.database
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
  const history = service.database
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
      ? service.database
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
  const decisionScopes = type === "decision"
    ? service.database.prepare("SELECT scope_type, scope_value FROM decision_scopes WHERE decision_id = ? ORDER BY scope_type, scope_value").all(id)
      .map((row) => ({ scopeType: row.scope_type, scopeValue: row.scope_value }))
    : [];
  const pathNodes =
    type === "chain"
      ? service.database
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
      ? service.database.prepare("SELECT link_id, position FROM chain_edges WHERE chain_id = ? ORDER BY position").all(id)
          .map((row) => ({ linkId: row.link_id, position: row.position }))
      : [];
  const targetChains =
    type === "plan"
      ? service.database.prepare("SELECT chain_id, position FROM plan_chain_refs WHERE plan_id = ? ORDER BY position").all(id)
          .map((row) => ({ chainId: row.chain_id, position: row.position }))
      : [];
  const dependencies = type === "plan"
    ? service.database.prepare("SELECT depends_on_plan_id, position FROM plan_dependencies WHERE plan_id = ? ORDER BY position").all(id)
        .map((row) => ({ planId: row.depends_on_plan_id, position: row.position }))
    : [];
  const steps = type === "plan"
    ? service.database.prepare("SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY position").all(id).map((row) => ({
        id: row.id, position: row.position, title: row.title, action: row.action, status: row.status,
        targetRefs: parseJson(row.target_refs_json, []), proposedDelta: parseJson(row.proposed_delta_json, []),
      }))
    : [];
  const checkpointRefs = type === "plan"
    ? service.database.prepare("SELECT checkpoint_id, step_id, position, required FROM plan_checkpoint_refs WHERE plan_id = ? ORDER BY position").all(id)
        .map((row) => ({ checkpointId: row.checkpoint_id, stepId: row.step_id, position: row.position, required: Boolean(row.required) }))
    : [];

  assertAllowed(locale, LOCALES, "locale");
  const snapshot = service.snapshot();
  const translations = localizationMap(snapshot);
  const coverage = type === "block"
    ? architectureCoverage(snapshot).blockCoverage.find((item) => item.blockId === id) ?? null
    : null;
  const ruleScopes = type === "block"
    ? snapshot.backgroundScopes.filter((scope) => scope.blockId === id)
    : [];
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
    if (ruleScopes.length) {
      lines.push(`- Rule scopes: ${ruleScopes.map((scope) => `${scope.scopeType}:${scope.scopeValue}`).join(", ")} (background; not a Canvas Block)`);
    }
    if (coverage) {
      lines.push(`- Coverage: checkpoint=${coverage.hasCheckpoint ? "yes" : "no"} · required=${coverage.checkpointRequired ? "yes" : "no"} · requiredMissing=${coverage.missingRequiredCheckpoint ? "yes" : "no"} · plan=${coverage.isCoveredByPlan ? "yes" : "no"} · chain=${coverage.isCoveredByChain ? "yes" : "no"} · verification=${coverage.isCoveredByAnyVerification ? "yes" : "no"}`);
    }
  }
  if (type === "decision" && decisionScopes.length) {
    lines.push(`- Scopes: ${decisionScopes.map((scope) => `${scope.scopeType}:${scope.scopeValue}`).join(", ")} (background; not a Canvas entity)`);
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
  if (type === "decision") {
    if (entity.rationale) lines.push("", "## Rationale", entity.rationale);
    if (entity.alternatives.length) lines.push("", "## Alternatives", ...entity.alternatives.map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`));
    if (entity.consequences.length) lines.push("", "## Consequences", ...entity.consequences.map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`));
    if (entity.supersedesDecisionId) lines.push("", "## Supersedes", `[decision:${entity.supersedesDecisionId}]`);
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
    const scopeChainIDs = snapshot.planChainScopes.filter((scope) => scope.planId === id).sort((left, right) => left.position - right.position).map((scope) => scope.chainId);
    const allTargetChainIDs = [...new Set([...targetChains.map((target) => target.chainId), ...scopeChainIDs])];
    if (allTargetChainIDs.length) {
      lines.push("", "## Target chains");
      for (const chainID of allTargetChainIDs) lines.push(`- [chain:${chainID}]`);
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
    const detailed = service.planContext({ id, locale, maxChars: 24000 });
    return {
      entity: detailed.plan,
      sourceRefs, pathNodes, pathEdges, targetChains, dependencies, steps, checkpointRefs,
      checkpoints: detailed.checkpoints, history, hierarchy: detailed.hierarchy, markdown: detailed.markdown,
    };
  }
  return { entity, sourceRefs, pathNodes, pathEdges, targetChains, dependencies, steps, checkpointRefs, checkpoints, history, coverage, ruleScopes, decisionScopes, markdown: lines.join("\n") };
}

export function getChangesSince(service, { sequence = 0, limit = 100 } = {}) {
  if (!Number.isInteger(sequence) || sequence < 0) throw new Error("sequence must be a non-negative integer");
  const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const latestSequence = service.database.prepare(
    "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM change_feed WHERE project_id = ?",
  ).get(service.paths.descriptor.id).sequence;
  const earliestSequence = service.database.prepare(
    "SELECT COALESCE(MIN(sequence), 0) AS sequence FROM change_feed WHERE project_id = ?",
  ).get(service.paths.descriptor.id).sequence;
  const rows = service.database.prepare(
    `SELECT cf.sequence, cf.change_set_id, cf.entity_type, cf.entity_id, cf.action, cf.created_at,
            h.revision, h.summary, h.plan_id, h.chain_scope_id, h.before_json, h.after_json,
            h.changed_fields_json, h.affected_refs_json, h.evidence_refs_json
     FROM change_feed cf
     LEFT JOIN history h ON h.change_set_id = cf.change_set_id AND h.entity_type = cf.entity_type
       AND h.entity_id = cf.entity_id AND h.action = cf.action
     WHERE cf.project_id = ? AND cf.sequence > ? ORDER BY cf.sequence LIMIT ?`,
  ).all(service.paths.descriptor.id, sequence, boundedLimit + 1).map((row) => ({
    sequence: row.sequence, changeSetId: row.change_set_id, ref: `${row.entity_type}:${row.entity_id}`,
    action: row.action, revision: row.revision, summary: row.summary, planId: row.plan_id,
    chainScopeId: row.chain_scope_id, before: parseJson(row.before_json, {}), after: parseJson(row.after_json, {}),
    changedFields: parseJson(row.changed_fields_json, []), affectedRefs: parseJson(row.affected_refs_json, []),
    evidenceRefs: parseJson(row.evidence_refs_json, []), createdAt: row.created_at,
  }));
  const hasMore = rows.length > boundedLimit;
  if (hasMore) rows.pop();
  const markdown = [
    `# Changes since sequence ${sequence}`,
    `Range: ${sequence} → ${rows.at(-1)?.sequence ?? sequence} · latest ${latestSequence} · earliest ${earliestSequence || "—"}`,
    `Returned: ${rows.length}${hasMore ? ` · more available after ${rows.at(-1)?.sequence ?? sequence}` : ""}`,
    "",
    ...rows.map((change) => {
      const fields = change.changedFields?.length ? ` · fields ${change.changedFields.join(", ")}` : "";
      const refs = change.affectedRefs?.length ? ` · refs ${change.affectedRefs.join(", ")}` : "";
      return `- #${change.sequence} ${change.action} ${change.ref} · r${change.revision ?? "?"}${fields}${refs}${change.summary ? ` — ${change.summary}` : ""}`;
    }),
    ...(rows.length ? ["", "Use includeStructured=true when exact before/after JSON is required."] : []),
  ].join("\n");
  return {
    fromSequence: sequence,
    nextSequence: rows.at(-1)?.sequence ?? sequence,
    latestSequence,
    earliestSequence,
    hasMore,
    changes: rows,
    markdown,
  };
}

export function validateGraph(service) {
  const snapshot = service.snapshot();
  const coverage = architectureCoverage(snapshot);
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
      if (!id || !entityExists(service.database, service.paths.descriptor.id, type, id)) errors.push(`Missing Plan step target: ${step.id} -> ${ref}`);
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
  const decisionIDs = new Set(snapshot.decisions.map((decision) => decision.id));
  for (const decision of snapshot.decisions) {
    if (!DECISION_STATUSES.has(decision.status)) errors.push(`Invalid Decision status: decision:${decision.id}`);
    if (decision.supersedesDecisionId && !decisionIDs.has(decision.supersedesDecisionId)) {
      errors.push(`Missing superseded Decision: decision:${decision.id} -> decision:${decision.supersedesDecisionId}`);
    }
  }
  for (const scope of snapshot.decisionScopes) {
    if (!decisionIDs.has(scope.decisionId)) errors.push(`Missing Decision for scope: decision:${scope.decisionId}`);
    if (scope.scopeType === "chain" && scope.scopeValue !== "*" && !snapshot.chains.some((chain) => chain.id === scope.scopeValue)) {
      errors.push(`Missing Chain for Decision scope: decision:${scope.decisionId} -> chain:${scope.scopeValue}`);
    }
  }
  for (const block of snapshot.blocks) {
    if (!LEGACY_BLOCK_KINDS.has(block.kind)) {
      errors.push(`Invalid Block kind: block:${block.id}`);
    } else if (block.kind === "decision") {
      warnings.push(`Legacy decision Block is not a Decision record and is excluded from the Canvas; migrate block:${block.id} to decision:<id>`);
      continue;
    } else if (block.kind === "test" || block.kind === "checkpoint") {
      warnings.push(`Block block:${block.id} uses kind '${block.kind}'. Testing and verification criteria belong in Checkpoints and Plan gates.`);
      continue;
    }
    if (block.deliveryState === "complete") {
      const passed = snapshot.checkpoints.some(
        (checkpoint) => checkpoint.targetType === "block" && checkpoint.targetId === block.id && checkpoint.status === "passed",
      );
      if (!passed) warnings.push(`Complete block has no passed checkpoint: block:${block.id}`);
    }
  }
  const connectedBlockIds = new Set();
  for (const link of snapshot.links) {
    if (link.sourceType === "block") connectedBlockIds.add(link.sourceId);
    if (link.targetType === "block") connectedBlockIds.add(link.targetId);
  }
  for (const node of snapshot.chainNodes) {
    connectedBlockIds.add(node.blockId);
  }
  const ruleBlockIds = new Set(snapshot.backgroundScopes.map((s) => s.blockId));
  const isolatedFlowBlocks = snapshot.blocks.filter((block) =>
    !connectedBlockIds.has(block.id) &&
    !ruleBlockIds.has(block.id) &&
    !["principle", "decision", "risk", "test", "checkpoint"].includes(block.kind)
  );
  if (isolatedFlowBlocks.length > 0) {
    warnings.push(`${isolatedFlowBlocks.length} architecture Block(s) have no Link or Chain connections (independent or awaiting flow): ${isolatedFlowBlocks.slice(0, 10).map((b) => `block:${b.id}`).join(", ")}${isolatedFlowBlocks.length > 10 ? " …" : ""}. Use graph_flow ("A -> B") if they belong to a sequence.`);
  }
  const unspecifiedBlocks = snapshot.blocks.filter((block) => block.architectureLayer === "unspecified");
  if (unspecifiedBlocks.length > 0) {
    warnings.push(`${unspecifiedBlocks.length} block(s) have no architecture layer`);
  }
  if (coverage.requiredCheckpointMissingIds.length) {
    warnings.push(`${coverage.requiredCheckpointMissingIds.length} Block(s) require a checkpoint but have none: ${coverage.requiredCheckpointMissingIds.slice(0, 20).map((id) => `block:${id}`).join(", ")}${coverage.requiredCheckpointMissingIds.length > 20 ? " …" : ""}`);
  }
  if (coverage.unplannedIds.length) {
    warnings.push(`${coverage.unplannedIds.length} Block(s) are not covered by any Plan: ${coverage.unplannedIds.slice(0, 20).map((id) => `block:${id}`).join(", ")}${coverage.unplannedIds.length > 20 ? " …" : ""}`);
  }
  if (coverage.checkpointUnboundIds.length) {
    warnings.push(`${coverage.checkpointUnboundIds.length} planned Block checkpoint(s) are not bound to an exact PlanChange: ${coverage.checkpointUnboundIds.slice(0, 20).map((id) => `block:${id}`).join(", ")}${coverage.checkpointUnboundIds.length > 20 ? " …" : ""}`);
  }
  if (coverage.chainGateMissingIds.length) {
    warnings.push(`${coverage.chainGateMissingIds.length} Block(s) belong to Chains without an integration gate: ${coverage.chainGateMissingIds.slice(0, 20).map((id) => `block:${id}`).join(", ")}${coverage.chainGateMissingIds.length > 20 ? " …" : ""}`);
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
    const hasChain = snapshot.planChainRefs.some((item) => item.planId === plan.id);
    const hasChange = snapshot.planChanges.some((item) => item.planId === plan.id);
    const hasStep = snapshot.planSteps.some((item) => item.planId === plan.id);
    if (!hasChain && !hasChange && !hasStep) warnings.push(`Plan has no declared work target: plan:${plan.id}`);
  }
  return { valid: errors.length === 0, errors, warnings, graphRevision: snapshot.project.graphRevision };
}
