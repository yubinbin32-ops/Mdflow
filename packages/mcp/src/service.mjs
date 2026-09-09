import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { openDatabase, exportGraphToJson, importGraphFromJson, getSyncMeta, setSyncMeta } from "./database.mjs";
import { resolveProjectPaths } from "./paths.mjs";
import { extractSymbolSlice, buildChainCodeStream, replaceSymbolSlice, detectLanguage } from "./ast.mjs";
import { sanitizeTerminalOutput } from "./sanitizer.mjs";
import { getTimelineState, syncTimeline, advanceStep } from "./timeline.mjs";
import { applyArrowFlow } from "./flow.mjs";
import { suggestLinksForBlock, connectBlocks } from "./architecture-link.mjs";

import {
  now,
  parseJson,
  entityExists,
  normalizeBlock,
  normalizeDecision,
  normalizeChain,
  normalizeLink,
  normalizePlan,
  normalizePlanChainScope,
  normalizePlanChange,
  deriveCheckpointStates,
  derivePlanState,
  normalizeLocalizations,
} from "./schema.mjs";

import { buildContextForTask } from "./context-engine.mjs";
import { renderPlanContext, createFoundationPlan } from "./plan-engine.mjs";
import { listCheckpoints, recordCheckpoint } from "./checkpoint-engine.mjs";
import {
  renderProjectMap,
  listDecisions,
  searchEntities,
  openEntity,
  getChangesSince,
  validateGraph,
} from "./query-engine.mjs";
import {
  executeMutate,
  executeGraphPatch,
  executeRevertChangeSet,
  historyState,
  historyStateForOperation,
  uiLocationFor,
} from "./mutation-engine.mjs";

export * from "./schema.mjs";
export * from "./context-engine.mjs";
export * from "./plan-engine.mjs";
export * from "./checkpoint-engine.mjs";
export * from "./query-engine.mjs";
export * from "./mutation-engine.mjs";

export class MdflowService {
  constructor(options = {}) {
    const resolvedOptions = typeof options === "string" ? { projectRoot: options } : options;
    this.paths = resolveProjectPaths(resolvedOptions);
    this.database = openDatabase(this.paths.databasePath);
    this.ensureProject();
    this.ensureSynced();
  }

  close() {
    this.database.close();
  }

  ensureSynced() {
    const graphJsonPath = this.paths.graphJsonPath;
    if (!graphJsonPath) return false;
    if (!fs.existsSync(graphJsonPath)) {
      const hasProject = this.database.prepare("SELECT count(*) as count FROM projects").get()?.count > 0;
      if (hasProject) {
        exportGraphToJson(this.database, graphJsonPath);
        return true;
      }
      return false;
    }

    const stat = fs.statSync(graphJsonPath);
    const meta = getSyncMeta(this.database);
    const hasProject = this.database.prepare("SELECT count(*) as count FROM projects").get()?.count > 0;

    if (!hasProject) {
      importGraphFromJson(this.database, graphJsonPath);
      return true;
    }

    if (meta.graph_json_mtime && Math.abs(stat.mtimeMs - Number(meta.graph_json_mtime)) < 10) {
      return false;
    }

    const content = fs.readFileSync(graphJsonPath, "utf8");
    const currentHash = crypto.createHash("sha256").update(content).digest("hex");
    if (meta.graph_json_hash !== currentHash) {
      importGraphFromJson(this.database, graphJsonPath);
      return true;
    } else {
      setSyncMeta(this.database, "graph_json_mtime", String(stat.mtimeMs));
      return false;
    }
  }

  ensureProject() {
    const timestamp = now();
    // The checkout path is runtime state, not canonical project truth. Store a
    // stable repository-relative marker so clones and Git worktrees do not
    // dirty the versioned graph merely by opening it. Snapshot readers expose
    // the resolved absolute root from `this.paths.projectRoot` instead.
    const storedRepoRoot = ".";
    this.database
      .prepare(
        `INSERT INTO projects(id, name, repo_root, schema_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, repo_root = excluded.repo_root,
           schema_version = excluded.schema_version, updated_at = excluded.updated_at
         WHERE projects.name IS NOT excluded.name
            OR projects.repo_root IS NOT excluded.repo_root
            OR projects.schema_version IS NOT excluded.schema_version`,
      )
      .run(
        this.paths.descriptor.id,
        this.paths.descriptor.name,
        storedRepoRoot,
        this.paths.descriptor.schemaVersion ?? 1,
        timestamp,
        timestamp,
      );
  }

  project() {
    this.ensureSynced();
    return this.database.prepare("SELECT * FROM projects WHERE id = ?").get(this.paths.descriptor.id);
  }

  snapshot() {
    this.ensureSynced();
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
    const decisions = this.database
      .prepare("SELECT * FROM decisions WHERE project_id = ? AND archived = 0 ORDER BY updated_at DESC, id")
      .all(projectId)
      .map(normalizeDecision);
    const decisionScopes = this.database
      .prepare(
        `SELECT ds.* FROM decision_scopes ds JOIN decisions d ON d.id = ds.decision_id
         WHERE d.project_id = ? AND d.archived = 0 ORDER BY ds.decision_id, ds.scope_type, ds.scope_value`,
      )
      .all(projectId)
      .map((row) => ({ decisionId: row.decision_id, scopeType: row.scope_type, scopeValue: row.scope_value }));
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
      .prepare("SELECT * FROM checkpoints WHERE project_id = ? ORDER BY updated_at DESC, id ASC")
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
      decisions,
      decisionScopes,
      sourceRefs,
      checkpoints,
      checkpointBindings,
      checkpointDependencies,
      localizations,
    };
  }

  chainCodeStream({ chainId, maxTotalChars = 4000 } = {}) {
    if (!chainId?.trim()) throw new Error("chainId is required");
    this.ensureSynced();
    const snapshot = this.snapshot();
    const chain = snapshot.chains.find((c) => c.id === chainId);
    if (!chain) throw new Error(`Chain not found: ${chainId}`);

    const nodeIds = snapshot.chainNodes
      .filter((node) => node.chainId === chain.id)
      .sort((a, b) => a.position - b.position)
      .map((node) => node.blockId);

    const streamNodes = [];
    for (const blockId of nodeIds) {
      const block = snapshot.blocks.find((b) => b.id === blockId);
      if (!block) continue;

      const sourceRefs = this.database
        .prepare("SELECT path, start_line, end_line, symbol, role FROM source_refs WHERE block_id = ? ORDER BY id")
        .all(block.id);

      let code = null;
      let filePath = null;
      let symbol = null;

      if (sourceRefs.length > 0) {
        const ref = sourceRefs[0];
        filePath = ref.path;
        symbol = ref.symbol;
        const fullPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(this.paths.projectRoot, filePath);
        try {
          if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath, "utf8");
            const slice = extractSymbolSlice(content, {
              symbol: ref.symbol,
              startLine: ref.start_line,
              endLine: ref.end_line,
              maxLines: 40,
            });
            code = slice.code;
          }
        } catch {
          code = null;
        }
      }

      streamNodes.push({
        blockId: block.id,
        title: block.title,
        filePath,
        symbol,
        code,
        contract: block.contract || block.summary,
      });
    }

    const codeStream = buildChainCodeStream(streamNodes, { maxTotalChars });
    return {
      chainId: chain.id,
      title: chain.title,
      nodes: streamNodes,
      codeStream,
      markdown: [
        `# Chain Code Stream: ${chain.title} (${chain.id})`,
        `Nodes: ${streamNodes.length} · Sliced from AST symbol facades`,
        "",
        codeStream,
      ].join("\n"),
    };
  }

  sanitizeLog({ rawOutput, maxChars = 3000, exitCode = null } = {}) {
    return sanitizeTerminalOutput(rawOutput, { maxChars, exitCode });
  }

  mutateBlockCode({ blockId, symbol, newCode, verifyCommand = null } = {}) {
    if (!blockId?.trim()) throw new Error("blockId is required");
    if (!symbol?.trim()) throw new Error("symbol is required");
    if (typeof newCode !== "string") throw new Error("newCode is required");

    this.ensureSynced();
    const snapshot = this.snapshot();
    const block = snapshot.blocks.find((b) => b.id === blockId);
    if (!block) throw new Error(`Block not found: ${blockId}`);

    const sourceRefs = snapshot.sourceRefs.filter((ref) => ref.blockId === block.id);
    if (!sourceRefs.length) {
      throw new Error(`Block "${blockId}" has no bound source files (virtual blueprint)`);
    }

    const ref = sourceRefs.find((r) => r.symbol === symbol) || sourceRefs[0];
    const filePath = ref.path;
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.paths.projectRoot, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Source file not found at ${fullPath}`);
    }

    const originalCode = fs.readFileSync(fullPath, "utf8");
    const lang = detectLanguage(fullPath);
    const { updatedCode, replacedLines } = replaceSymbolSlice(originalCode, {
      symbol,
      newCode,
      language: lang,
    });

    // Write modified code to disk
    fs.writeFileSync(fullPath, updatedCode, "utf8");

    // Optional verification with sanitizer and auto-rollback
    if (verifyCommand) {
      try {
        const rawOutput = execSync(verifyCommand, {
          cwd: this.paths.projectRoot,
          encoding: "utf8",
          stdio: "pipe",
        });
        const sanitized = sanitizeTerminalOutput(rawOutput);
        return {
          success: true,
          blockId,
          symbol,
          filePath,
          replacedLines,
          verification: {
            passed: true,
            command: verifyCommand,
            output: sanitized.text,
          },
        };
      } catch (err) {
        // Automatic rollback on verification failure!
        fs.writeFileSync(fullPath, originalCode, "utf8");
        const rawError = (err.stdout || "") + "\n" + (err.stderr || "") + "\n" + err.message;
        const sanitized = sanitizeTerminalOutput(rawError);
        return {
          success: false,
          blockId,
          symbol,
          filePath,
          error: "Verification test failed. Source code automatically rolled back.",
          verification: {
            passed: false,
            command: verifyCommand,
            output: sanitized.text,
          },
        };
      }
    }

    return {
      success: true,
      blockId,
      symbol,
      filePath,
      replacedLines,
    };
  }

  projectMap(options = {}) {
    return renderProjectMap(this, options);
  }

  decisionList(options = {}) {
    return listDecisions(this, options);
  }

  listDecisions(options = {}) {
    return this.decisionList(options);
  }

  search(options = {}) {
    return searchEntities(this, options);
  }

  entityOpen(options = {}) {
    return openEntity(this, options);
  }

  openEntity(options = {}) {
    return this.entityOpen(options);
  }

  checkpointList(options = {}) {
    return listCheckpoints(this, options);
  }

  listCheckpoints(options = {}) {
    return this.checkpointList(options);
  }

  planContext(options = {}) {
    return renderPlanContext(this, options);
  }

  changesSince(options = {}) {
    return getChangesSince(this, options);
  }

  revertChangeSet(options = {}) {
    return executeRevertChangeSet(this, options);
  }

  getTimeline() {
    return getTimelineState(this);
  }

  syncTimeline(payload = {}) {
    return syncTimeline(this, payload);
  }

  advanceStep(payload = {}) {
    return advanceStep(this, payload);
  }

  applyArrowFlow(flowExpression, options = {}) {
    return applyArrowFlow(this, flowExpression, options);
  }

  suggestLinks(blockId) {
    return suggestLinksForBlock(this, blockId);
  }

  connectBlocks(payload = {}) {
    return connectBlocks(this, payload);
  }

  contextForTask(options = {}) {
    return buildContextForTask(this, options);
  }

  resolveHistoryContext(planId = null, chainScopeId = null) {
    let resolvedPlanId = planId || null;
    if (resolvedPlanId && !entityExists(this.database, this.paths.descriptor.id, "plan", resolvedPlanId)) {
      throw new Error(`plan:${resolvedPlanId} not found`);
    }
    if (chainScopeId) {
      const scope = this.database.prepare(
        `SELECT pcs.plan_id FROM plan_chain_scopes pcs JOIN plans p ON p.id = pcs.plan_id
         WHERE p.project_id = ? AND pcs.id = ?`,
      ).get(this.paths.descriptor.id, chainScopeId);
      if (!scope) throw new Error(`plan_chain_scope:${chainScopeId} not found`);
      if (resolvedPlanId && scope.plan_id !== resolvedPlanId) {
        throw new Error(`plan_chain_scope:${chainScopeId} does not belong to plan:${resolvedPlanId}`);
      }
      resolvedPlanId = scope.plan_id;
    }
    return { planId: resolvedPlanId, chainScopeId: chainScopeId || null };
  }

  createFoundationPlan(options = {}) {
    return createFoundationPlan(this, options);
  }

  graphPatch(options = {}) {
    return executeGraphPatch(this, options);
  }

  mutate(options, limits) {
    return executeMutate(this, options, limits);
  }

  historyStateForOperation(operation, entityType, id) {
    return historyStateForOperation(this, operation, entityType, id);
  }

  historyState(entityType, id) {
    return historyState(this, entityType, id);
  }

  uiLocationFor(entityType, id) {
    return uiLocationFor(entityType, id);
  }

  recordCheckpoint(options = {}) {
    return recordCheckpoint(this, options);
  }

  validate() {
    return validateGraph(this);
  }

  validateGraph() {
    return this.validate();
  }
}

export function createService(options = {}) {
  return new MdflowService(options);
}
