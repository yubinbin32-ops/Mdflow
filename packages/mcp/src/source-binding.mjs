import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { detectLanguage, extractSymbolSlice } from "./ast.mjs";

function hashText(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function normalizeCode(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function relativePath(projectRoot, filePath) {
  const absolute = path.resolve(projectRoot, filePath);
  const relative = path.relative(projectRoot, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

function refKey(ref, index) {
  return ref.id || `${ref.blockId ?? "block"}:${ref.path}:${ref.symbol ?? "line"}:${index}`;
}

function readFileCached(projectRoot, ref, fileCache) {
  const rawPath = String(ref.path ?? "");
  const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(projectRoot, rawPath);
  const relative = relativePath(projectRoot, absolutePath);
  if (!relative) {
    return { absolutePath, relativePath: null, status: "outside_project" };
  }

  let stat;
  try {
    stat = fs.statSync(absolutePath);
    if (!stat.isFile()) return { absolutePath, relativePath: relative, status: "missing" };
  } catch {
    return { absolutePath, relativePath: relative, status: "missing" };
  }

  const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  const cached = fileCache.get(relative);
  if (cached?.signature === signature) return cached;

  try {
    const content = fs.readFileSync(absolutePath, "utf8");
    const next = {
      absolutePath,
      relativePath: relative,
      status: "readable",
      signature,
      content,
      fileHash: hashText(content),
      lineCount: content.split(/\r?\n/).length,
      language: detectLanguage(absolutePath),
    };
    fileCache.set(relative, next);
    return next;
  } catch {
    return { absolutePath, relativePath: relative, status: "unreadable", signature };
  }
}

function currentSlice(file, ref) {
  if (file.status !== "readable") return { found: false, reason: file.status, code: "" };
  if (!ref.symbol && (!ref.startLine || !ref.endLine)) {
    return { found: false, reason: "unbound", code: "" };
  }
  return extractSymbolSlice(file.content, {
    symbol: ref.symbol || null,
    startLine: ref.symbol ? null : ref.startLine,
    endLine: ref.symbol ? null : ref.endLine,
    maxLines: Math.max(file.lineCount + 1, 50),
    language: file.language,
    filePath: file.absolutePath,
  });
}

function sourceStatus({ file, slice, moved, implementationChanged }) {
  if (file.status !== "readable") return file.status;
  if (!slice.found) return slice.reason === "ambiguous" ? "ambiguous" : "stale";
  if (!slice.symbol) return "line_only";
  if (moved) return "moved";
  if (implementationChanged) return "changed";
  return "anchored";
}

function changeKinds(previous, current) {
  if (!previous) return [];
  const kinds = [];
  if (previous.path !== current.path || previous.symbol !== current.symbol) kinds.push("binding_definition_changed");
  if (previous.fileHash && current.fileHash && previous.fileHash !== current.fileHash) kinds.push("source_file_changed");
  if (previous.nodeHash && current.nodeHash && previous.nodeHash !== current.nodeHash) kinds.push("implementation_changed");
  if (previous.startLine && current.startLine && (previous.startLine !== current.startLine || previous.endLine !== current.endLine)) kinds.push("binding_moved");
  if (previous.bindingStatus !== current.bindingStatus) {
    if (["missing", "unreadable", "outside_project", "stale", "ambiguous"].includes(current.bindingStatus)) kinds.push("binding_invalid");
    else if (["missing", "unreadable", "outside_project", "stale", "ambiguous"].includes(previous.bindingStatus)) kinds.push("binding_restored");
  }
  return [...new Set(kinds)];
}

export function scanSourceBindings({
  projectRoot,
  sourceRefs = [],
  previous = new Map(),
  fileCache = new Map(),
  scannedAt = new Date().toISOString(),
} = {}) {
  const bindings = [];
  const changes = [];
  for (const [index, ref] of sourceRefs.entries()) {
    const key = refKey(ref, index);
    const previousBinding = previous.get(key) ?? null;
    const file = readFileCached(projectRoot, ref, fileCache);
    const slice = currentSlice(file, ref);
    const fileChanged = Boolean(previousBinding?.fileHash && file.fileHash && previousBinding.fileHash !== file.fileHash);
    const moved = Boolean(previousBinding?.startLine && slice.startLine && (
      previousBinding.startLine !== slice.startLine || previousBinding.endLine !== slice.endLine
    ));
    const nodeHash = slice.found ? hashText(normalizeCode(slice.code)) : null;
    const signatureHash = slice.signature ? hashText(normalizeCode(slice.signature)) : null;
    const implementationChanged = Boolean(previousBinding?.nodeHash && nodeHash && previousBinding.nodeHash !== nodeHash);
    const bindingStatus = file.status !== "readable"
      ? file.status
      : !slice.found
        ? (slice.reason === "ambiguous" ? "ambiguous" : "stale")
        : !ref.symbol && fileChanged
          ? "stale"
        : moved
          ? "moved"
          : "fresh";
    const binding = {
      id: ref.id ?? key,
      blockId: ref.blockId,
      path: ref.path,
      relativePath: file.relativePath,
      absolutePath: file.absolutePath,
      symbol: ref.symbol ?? null,
      role: ref.role ?? "implementation",
      language: file.language ?? detectLanguage(ref.path),
      startLine: slice.startLine ?? null,
      endLine: slice.endLine ?? null,
      signature: slice.signature ?? null,
      fileHash: file.fileHash ?? null,
      nodeHash,
      signatureHash,
      bindingStatus,
      implementationStatus: implementationChanged ? "changed" : "unchanged",
      sourceStatus: sourceStatus({ file, slice: !ref.symbol && fileChanged ? { ...slice, found: false, reason: "stale" } : slice, moved, implementationChanged }),
      reason: slice.reason ?? (file.status === "readable" ? null : file.status),
      candidates: slice.candidates ?? [],
      scannedAt,
      // Kept in the process-local index only; never returned by default.
      content: file.status === "readable" ? file.content : null,
    };
    bindings.push(binding);
    const kinds = changeKinds(previousBinding, binding);
    if (kinds.length) {
      changes.push({
        refId: binding.id,
        blockId: binding.blockId,
        path: binding.relativePath ?? binding.path,
        symbol: binding.symbol,
        kinds,
        previous: {
          bindingStatus: previousBinding.bindingStatus,
          implementationStatus: previousBinding.implementationStatus,
          startLine: previousBinding.startLine ?? null,
          endLine: previousBinding.endLine ?? null,
          fileHash: previousBinding.fileHash ?? null,
          nodeHash: previousBinding.nodeHash ?? null,
        },
        current: {
          bindingStatus: binding.bindingStatus,
          implementationStatus: binding.implementationStatus,
          startLine: binding.startLine,
          endLine: binding.endLine,
          fileHash: binding.fileHash,
          nodeHash: binding.nodeHash,
        },
      });
    }
  }
  const sourceRevision = hashText(bindings
    .map((item) => [item.id, item.bindingStatus, item.fileHash, item.nodeHash, item.startLine, item.endLine])
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map((item) => item.join("|"))
    .join("\n"));
  return {
    bindings,
    changes,
    changed: changes.length > 0,
    sourceRevision,
    scannedAt,
    fileCache,
  };
}

export function bindingIdentity(binding) {
  return {
    id: binding.id,
    blockId: binding.blockId,
    path: binding.relativePath ?? binding.path,
    symbol: binding.symbol,
    language: binding.language,
    signature: binding.signature,
    fileHash: binding.fileHash,
    nodeHash: binding.nodeHash,
    signatureHash: binding.signatureHash,
    startLine: binding.startLine,
    endLine: binding.endLine,
    bindingStatus: binding.bindingStatus,
  };
}
