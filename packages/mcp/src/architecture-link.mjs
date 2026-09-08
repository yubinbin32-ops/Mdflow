import fs from "node:fs";
import path from "node:path";
import { detectLanguage } from "./ast.mjs";

const LAYER_ORDER = [
  "client",
  "boundary",
  "application",
  "domain",
  "data",
  "external",
  "quality",
  "infrastructure",
  "unspecified",
];

/**
 * Extract imported file paths from source code
 */
function extractImports(sourceCode, filePath = "") {
  const imports = [];
  const lines = sourceCode.split(/\r?\n/);
  const lang = detectLanguage(filePath);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) {
      continue;
    }

    if (lang === "javascript" || lang === "typescript") {
      const fromMatch = trimmed.match(/(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/);
      if (fromMatch) {
        const importPath = fromMatch[1] || fromMatch[2];
        if (importPath.startsWith(".")) {
          const resolved = path.normalize(path.join(path.dirname(filePath), importPath));
          imports.push(resolved);
        }
      }
    } else if (lang === "swift") {
      const swiftMatch = trimmed.match(/^import\s+([A-Za-z0-9_]+)/);
      if (swiftMatch) imports.push(swiftMatch[1]);
    } else if (lang === "python") {
      const pyMatch = trimmed.match(/^(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/);
      if (pyMatch) imports.push((pyMatch[1] || pyMatch[2]).replace(/\./g, "/"));
    }
  }
  return imports;
}

/**
 * Suggest architectural links for a specific Block
 */
export function suggestLinksForBlock(service, blockId) {
  const snapshot = service.snapshot();
  const block = snapshot.blocks.find((b) => b.id === blockId);
  if (!block) {
    throw new Error(`block:${blockId} not found`);
  }

  const existingLinks = snapshot.links.filter(
    (l) => (l.sourceType === "block" && l.sourceId === blockId) ||
           (l.targetType === "block" && l.targetId === blockId),
  );
  const connectedBlockIds = new Set(
    existingLinks.map((l) => (l.sourceId === blockId ? l.targetId : l.sourceId)),
  );

  const suggestions = [];
  const blockSources = snapshot.sourceRefs.filter((s) => s.blockId === blockId);
  const repoRoot = service.paths.repoRoot || service.paths.projectRoot;

  // 1. AST / Code Import based suggestions
  const sourceImports = new Set();
  for (const ref of blockSources) {
    const refPath = ref.path || ref.filePath;
    if (!refPath) continue;
    const absolutePath = path.isAbsolute(refPath) ? refPath : path.join(repoRoot, refPath);
    if (fs.existsSync(absolutePath)) {
      try {
        const code = fs.readFileSync(absolutePath, "utf8");
        const found = extractImports(code, refPath);
        found.forEach((imp) => sourceImports.add(imp));
      } catch {
        // ignore unreadable files
      }
    }
  }

  if (sourceImports.size > 0) {
    for (const otherBlock of snapshot.blocks) {
      if (otherBlock.id === blockId || connectedBlockIds.has(otherBlock.id)) continue;
      const otherSources = snapshot.sourceRefs.filter((s) => s.blockId === otherBlock.id);
      for (const otherRef of otherSources) {
        const otherPath = otherRef.path || otherRef.filePath;
        if (!otherPath) continue;
        const normalizedOther = otherPath.replace(/\.[^/.]+$/, "");
        for (const imp of sourceImports) {
          const normalizedImp = imp.replace(/\.[^/.]+$/, "");
          if (normalizedOther.endsWith(normalizedImp) || normalizedImp.endsWith(normalizedOther)) {
            suggestions.push({
              sourceId: blockId,
              targetId: otherBlock.id,
              kind: ["data", "database"].includes(otherBlock.kind) ? "reads" : "calls",
              confidence: "high",
              reason: `Source file ${otherPath} is imported by block:${blockId}`,
            });
            connectedBlockIds.add(otherBlock.id);
            break;
          }
        }
      }
    }
  }

  // 2. Layer & Scope based neighborhood suggestions
  const currentLayerIdx = LAYER_ORDER.indexOf(block.architectureLayer);
  for (const otherBlock of snapshot.blocks) {
    if (otherBlock.id === blockId || connectedBlockIds.has(otherBlock.id)) continue;
    if (["principle", "decision"].includes(otherBlock.kind)) continue;

    const otherLayerIdx = LAYER_ORDER.indexOf(otherBlock.architectureLayer);
    const sameScope = block.scope === otherBlock.scope && block.scope !== "general";

    if (currentLayerIdx >= 0 && otherLayerIdx >= 0) {
      if (currentLayerIdx < otherLayerIdx && (otherLayerIdx - currentLayerIdx <= 2 || sameScope)) {
        const kind = ["data", "database"].includes(otherBlock.kind) ? "reads" : "calls";
        suggestions.push({
          sourceId: blockId,
          targetId: otherBlock.id,
          kind,
          confidence: sameScope ? "medium" : "low",
          reason: `Layer convention: ${block.architectureLayer} -> ${otherBlock.architectureLayer}${sameScope ? ` (shares scope ${block.scope})` : ""}`,
        });
      } else if (currentLayerIdx > otherLayerIdx && (currentLayerIdx - otherLayerIdx <= 2 || sameScope)) {
        const kind = ["data", "database"].includes(block.kind) ? "reads" : "calls";
        suggestions.push({
          sourceId: otherBlock.id,
          targetId: blockId,
          kind,
          confidence: sameScope ? "medium" : "low",
          reason: `Layer convention: ${otherBlock.architectureLayer} -> ${block.architectureLayer}${sameScope ? ` (shares scope ${block.scope})` : ""}`,
        });
      }
    }
  }

  return suggestions.slice(0, 10);
}

/**
 * Connect two architecture Blocks with a validated Link
 */
export function connectBlocks(service, {
  sourceId,
  targetId,
  kind = "calls",
  label = "",
  contract = "",
  actor = "agent",
  reason = "Connect architecture blocks",
}) {
  const snapshot = service.snapshot();
  const source = snapshot.blocks.find((b) => b.id === sourceId);
  const target = snapshot.blocks.find((b) => b.id === targetId);

  if (!source) throw new Error(`Source block:${sourceId} not found`);
  if (!target) throw new Error(`Target block:${targetId} not found`);

  const linkId = `link-${sourceId}-to-${targetId}`;
  const existing = snapshot.links.find((l) => l.id === linkId);

  const operation = existing
    ? {
        action: "update_link",
        id: linkId,
        expectedRevision: existing.currentRevision,
        fields: {
          kind,
          label: label || existing.label,
          contract: contract || existing.contract,
        },
      }
    : {
        action: "create_link",
        id: linkId,
        fields: {
          sourceType: "block",
          sourceId,
          targetType: "block",
          targetId,
          kind,
          label: label || `${source.title} -> ${target.title}`,
          contract: contract || `${source.title} ${kind} ${target.title}`,
        },
      };

  return service.mutate({
    operations: [operation],
    actor,
    reason,
    task: "architecture-connect",
  });
}
