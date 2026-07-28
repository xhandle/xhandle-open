import { ARTIFACT_DEFINITIONS, ARTIFACT_KINDS } from "./artifactDefinitions";

export function makeId(prefix = "artifact") {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? `${prefix.toLowerCase()}-${crypto.randomUUID()}`
    : `${prefix.toLowerCase()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function cellText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value).trim();
}

export function splitIds(value) {
  return cellText(value)
    .split(/[,;\n\r]+|\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parentIdsFromRow(row = {}, parentField = "", targetType = "") {
  const ids = new Set(splitIds(row?.[parentField]));
  if (targetType && Array.isArray(row?.traceLinks)) {
    row.traceLinks.forEach((link) => {
      if (cellText(link?.targetType) === targetType) {
        splitIds(link?.targetId).forEach((id) => ids.add(id));
      }
    });
  }
  return Array.from(ids).filter(Boolean);
}

export function compactList(values = []) {
  return Array.from(new Set(values.map(cellText).filter(Boolean))).join(", ");
}

export function storageKeyFor(kind, projectId, repoId) {
  return `xhandle:cba-${kind}:${projectId || "no-project"}:${repoId || "no-repo"}`;
}

const ARTIFACT_DB_NAME = "xhandle-code-architecture-assurance";
const ARTIFACT_DB_VERSION = 1;
const ARTIFACT_STORE = "artifactRows";
const LOCAL_STORAGE_CACHE_MAX_CHARS = 750000;
const INDEXED_DB_ROW_CHUNK_MAX_CHARS = 300000;
const artifactRowsMemoryCache = new Map();
let persistentStorageRequestPromise = null;

function emitArtifactRowsChanged(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent("xhandle:code-architecture-assurance:changed", { detail }));
    window.dispatchEvent(new CustomEvent("xhandle:data-changed", { detail }));
  } catch {}
}

function canUseIndexedDB() {
  return typeof indexedDB !== "undefined";
}

function openArtifactDb() {
  if (!canUseIndexedDB()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ARTIFACT_DB_NAME, ARTIFACT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ARTIFACT_STORE)) {
        db.createObjectStore(ARTIFACT_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestPersistentBrowserStorage() {
  if (persistentStorageRequestPromise) return persistentStorageRequestPromise;
  persistentStorageRequestPromise = Promise.resolve().then(async () => {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  });
  return persistentStorageRequestPromise;
}

function chunkRowsForIndexedDb(rows = []) {
  const chunks = [];
  let current = [];
  let currentChars = 2;
  rows.forEach((row) => {
    const rowChars = JSON.stringify(row).length + 1;
    if (current.length && currentChars + rowChars > INDEXED_DB_ROW_CHUNK_MAX_CHARS) {
      chunks.push(current);
      current = [row];
      currentChars = rowChars + 2;
    } else {
      current.push(row);
      currentChars += rowChars;
    }
  });
  if (current.length || !chunks.length) chunks.push(current);
  return chunks;
}

async function readArtifactRowsFromDb(key) {
  const db = await openArtifactDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ARTIFACT_STORE, "readonly");
    const store = tx.objectStore(ARTIFACT_STORE);
    const request = store.get(key);
    request.onsuccess = () => {
      if (!request.result) {
        resolve(null);
        return;
      }
      const record = request.result;
      if (record.chunked && Array.isArray(record.chunkKeys)) {
        const chunkResults = new Array(record.chunkKeys.length);
        let remaining = record.chunkKeys.length;
        if (!remaining) {
          resolve([]);
          return;
        }
        record.chunkKeys.forEach((chunkKey, index) => {
          const chunkRequest = store.get(chunkKey);
          chunkRequest.onsuccess = () => {
            const chunkRows = chunkRequest.result?.rows;
            chunkResults[index] = Array.isArray(chunkRows) ? chunkRows : [];
            remaining -= 1;
            if (!remaining) resolve(chunkResults.flat());
          };
          chunkRequest.onerror = () => reject(chunkRequest.error);
        });
        return;
      }
      resolve(Array.isArray(record.rows) ? record.rows : []);
    };
    request.onerror = () => reject(request.error);
  });
}

async function writeArtifactRowsToDb(key, rows) {
  const db = await openArtifactDb();
  if (!db) return false;
  await requestPersistentBrowserStorage();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ARTIFACT_STORE, "readwrite");
    const store = tx.objectStore(ARTIFACT_STORE);
    const safeRows = Array.isArray(rows) ? rows : [];
    const chunks = chunkRowsForIndexedDb(safeRows);
    const updatedAt = new Date().toISOString();
    const priorRequest = store.get(key);
    priorRequest.onsuccess = () => {
      const priorChunkKeys = Array.isArray(priorRequest.result?.chunkKeys) ? priorRequest.result.chunkKeys : [];
      const chunkKeys = chunks.map((_, index) => `${key}:chunk:${index}`);
      chunks.forEach((chunkRows, index) => {
        store.put({
          key: chunkKeys[index],
          parentKey: key,
          rows: chunkRows,
          updatedAt,
        });
      });
      priorChunkKeys
        .filter((chunkKey) => !chunkKeys.includes(chunkKey))
        .forEach((chunkKey) => store.delete(chunkKey));
      store.put({
        key,
        rows: [],
        chunked: true,
        chunkKeys,
        rowCount: safeRows.length,
        updatedAt,
      });
    };
    priorRequest.onerror = () => reject(priorRequest.error);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Artifact row save transaction aborted."));
  });
}

export function loadArtifactRows(kind, projectId, repoId) {
  const key = storageKeyFor(kind, projectId, repoId);
  if (artifactRowsMemoryCache.has(key)) {
    return artifactRowsMemoryCache.get(key) || [];
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    const rows = Array.isArray(parsed) ? parsed : [];
    if (rows.length) artifactRowsMemoryCache.set(key, rows);
    return rows;
  } catch {
    return [];
  }
}

export async function loadArtifactRowsAsync(kind, projectId, repoId) {
  const key = storageKeyFor(kind, projectId, repoId);
  try {
    const dbRows = await readArtifactRowsFromDb(key);
    if (Array.isArray(dbRows)) {
      artifactRowsMemoryCache.set(key, dbRows);
      return dbRows;
    }
  } catch (error) {
    console.warn("[code-architecture-assurance] IndexedDB load failed; using localStorage fallback.", error);
  }
  const rows = loadArtifactRows(kind, projectId, repoId);
  artifactRowsMemoryCache.set(key, rows);
  return rows;
}

export function saveArtifactRows(kind, projectId, repoId, rows) {
  const key = storageKeyFor(kind, projectId, repoId);
  const safeRows = Array.isArray(rows) ? rows : [];
  artifactRowsMemoryCache.set(key, safeRows);
  writeArtifactRowsToDb(key, safeRows).catch((error) => {
    console.warn("[code-architecture-assurance] IndexedDB save failed.", error);
  });

  try {
    const serialized = JSON.stringify(safeRows);
    if (serialized.length <= LOCAL_STORAGE_CACHE_MAX_CHARS) {
      localStorage.setItem(key, serialized);
    } else {
      localStorage.removeItem(key);
    }
  } catch (error) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
  emitArtifactRowsChanged({ kind, projectId, repoId, key });
}

export async function saveArtifactRowsAsync(kind, projectId, repoId, rows) {
  const key = storageKeyFor(kind, projectId, repoId);
  const safeRows = Array.isArray(rows) ? rows : [];
  artifactRowsMemoryCache.set(key, safeRows);
  let persistedToIndexedDb = false;
  try {
    persistedToIndexedDb = await writeArtifactRowsToDb(key, safeRows);
  } catch (error) {
    console.warn("[code-architecture-assurance] IndexedDB save failed.", error);
  }

  let cachedToLocalStorage = false;
  try {
    const serialized = JSON.stringify(safeRows);
    if (serialized.length <= LOCAL_STORAGE_CACHE_MAX_CHARS) {
      localStorage.setItem(key, serialized);
      cachedToLocalStorage = true;
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
  if (!persistedToIndexedDb && !cachedToLocalStorage && safeRows.length) {
    throw new Error("Generated rows are too large for browser storage, and IndexedDB persistence failed. The derivation completed, but results could not be saved.");
  }
  emitArtifactRowsChanged({ kind, projectId, repoId, key });
}

export function architectureLabelFromRef(ref = {}) {
  const trace = cellText(ref.traceId || ref.rowRef || (Number.isFinite(Number(ref.rowIndex)) ? Number(ref.rowIndex) + 1 : ""));
  const mode = ref.mode === "edge" ? "Interface" : ref.mode === "to" ? "Target" : "Source";
  return trace ? `${mode} ${trace}` : mode;
}

export function architectureRefsLabel(refs = []) {
  const list = Array.isArray(refs) ? refs : [];
  return list.map(architectureLabelFromRef).filter(Boolean).join(", ");
}

export function architectureRefToFocusTarget(ref = {}) {
  return {
    type: ref.mode === "edge" ? "edge" : "node",
    mode: ref.mode || "edge",
    rowIndex: ref.rowIndex,
    rowRef: ref.rowRef,
    traceId: ref.traceId,
    nodeId: ref.mode === "to" ? ref.toNodeId : ref.fromNodeId,
    edgeId: ref.edgeId,
    fromNodeId: ref.fromNodeId,
    toNodeId: ref.toNodeId,
    functionName: ref.mode === "to" ? ref.toFunction : ref.fromFunction,
    fromFunction: ref.fromFunction,
    controlAction: ref.controlAction,
    toFunction: ref.toFunction,
    fromFile: ref.fromFile || "",
    toFile: ref.toFile || "",
    row: {
      from: ref.fromFunction,
      action: ref.controlAction,
      to: ref.toFunction,
      fromFile: ref.fromFile || "",
      toFile: ref.toFile || "",
      rowRef: ref.rowRef,
      traceId: ref.traceId,
      fromNodeId: ref.fromNodeId,
      edgeId: ref.edgeId,
      toNodeId: ref.toNodeId,
    },
  };
}

export function architectureRefFromFunctionalRow(row = {}, rowIndex = 0, mode = "edge") {
  return {
    rowIndex,
    rowRef: row.rowRef || rowIndex + 1,
    traceId: row.traceId || row.rowRef || String(rowIndex + 1),
    fromFunction: row.from || row.fromFunction || "",
    controlAction: row.action || row.controlAction || "",
    toFunction: row.to || row.toFunction || "",
    fromNodeId: row.fromNodeId || "",
    edgeId: row.edgeId || "",
    toNodeId: row.toNodeId || "",
    fromFile: row.fromFile || "",
    toFile: row.toFile || "",
    mode,
    subsystem: row.architecture?.subsystem || "",
    csci: row.architecture?.csci || "",
    csc: row.architecture?.csc || "",
    csu: row.architecture?.csu || "",
  };
}

export function findFunctionalRowByTrace(cbaRows = [], sourceId = "") {
  const target = cellText(sourceId);
  return cbaRows.find((row, index) =>
    cellText(row.traceId) === target ||
    cellText(row.rowRef) === target ||
    String(index + 1) === target
  );
}

export function findFunctionalRowIndexByTrace(cbaRows = [], sourceId = "") {
  const target = cellText(sourceId);
  return cbaRows.findIndex((row, index) =>
    cellText(row.traceId) === target ||
    cellText(row.rowRef) === target ||
    String(index + 1) === target
  );
}

export function enrichRowForDisplay(row = {}) {
  return {
    ...row,
    architectureSource: row.architectureSource || architectureRefsLabel(row.sourceArchitectureRefs),
  };
}

export function rowIdentity(row = {}, rowIndex = 0) {
  return cellText(row.internalId || row.id || row.sourceTraceId || rowIndex);
}

export function createBaseArtifactRow(kind, patch = {}, index = 0) {
  const definition = ARTIFACT_DEFINITIONS[kind];
  const now = new Date().toISOString();
  return {
    ...(definition?.defaultRow || {}),
    ...patch,
    id: patch.id || `${definition?.idPrefix || "ART"}-${String(index + 1).padStart(3, "0")}`,
    internalId: patch.internalId || makeId(definition?.internalPrefix || "artifact"),
    artifactType: definition?.artifactType || kind,
    traceLinks: Array.isArray(patch.traceLinks) ? patch.traceLinks : [],
    sourceArchitectureRefs: Array.isArray(patch.sourceArchitectureRefs) ? patch.sourceArchitectureRefs : [],
    source: patch.source || "manual",
    updatedAt: patch.updatedAt || now,
    approvedAt: patch.approvedAt || null,
  };
}

export function rowsById(rows = []) {
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [cellText(row.id), row]).filter(([id]) => id));
}

export function collectArchitectureRefsFromParents(parentIds = [], parentRows = []) {
  const byParentId = rowsById(parentRows);
  const refs = [];
  parentIds.forEach((id) => {
    const parent = byParentId.get(id);
    if (Array.isArray(parent?.sourceArchitectureRefs)) refs.push(...parent.sourceArchitectureRefs);
  });
  return dedupeArchitectureRefs(refs);
}

export function architectureRefsWithFallback(...refGroups) {
  const refs = [];
  refGroups.forEach((group) => {
    if (Array.isArray(group)) refs.push(...group);
  });
  return dedupeArchitectureRefs(refs);
}

export function allocatedFunctionFromRefs(refs = []) {
  const values = (Array.isArray(refs) ? refs : []).map((ref) =>
    compactList([ref.fromFunction, ref.controlAction, ref.toFunction])
  );
  return compactList(values);
}

export function sourceFilesFromRefs(refs = []) {
  const values = [];
  (Array.isArray(refs) ? refs : []).forEach((ref) => {
    values.push(ref.fromFile, ref.toFile);
  });
  return compactList(values);
}

export function dedupeArchitectureRefs(refs = []) {
  const seen = new Set();
  const out = [];
  (Array.isArray(refs) ? refs : []).forEach((ref) => {
    const key = [
      ref.traceId,
      ref.rowRef,
      ref.rowIndex,
      ref.fromNodeId,
      ref.edgeId,
      ref.toNodeId,
      ref.mode,
    ].map(cellText).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  });
  return out;
}

export function allocatedArchitectureFromRefs(refs = []) {
  const values = (Array.isArray(refs) ? refs : []).map((ref) =>
    compactList([ref.subsystem, ref.csci, ref.csc, ref.csu])
  );
  return compactList(values);
}

export function resolveArtifactArchitectureRefs(row = {}, kind = "", artifactCollections = {}) {
  const directRefs = Array.isArray(row?.sourceArchitectureRefs) ? row.sourceArchitectureRefs : [];
  if (directRefs.length) return dedupeArchitectureRefs(directRefs);

  const softwareRows = artifactCollections.softwareRows || artifactCollections.softwareRequirements || [];
  const systemRows = artifactCollections.systemRows || artifactCollections.systemRequirements || [];
  const subsystemRows = artifactCollections.subsystemRows || artifactCollections.subsystemRequirements || [];

  if (kind === ARTIFACT_KINDS.SYSTEM) {
    return collectArchitectureRefsFromParents(parentIdsFromRow(row, "parentSwRequirement", "software-requirement"), softwareRows);
  }

  if (kind === ARTIFACT_KINDS.SUBSYSTEM) {
    const systemById = rowsById(systemRows);
    const parentSystemRows = parentIdsFromRow(row, "parentSystemRequirement", "system-requirement").map((id) => systemById.get(id)).filter(Boolean);
    return dedupeArchitectureRefs(parentSystemRows.flatMap((parent) =>
      resolveArtifactArchitectureRefs(parent, ARTIFACT_KINDS.SYSTEM, artifactCollections)
    ));
  }

  if (kind === ARTIFACT_KINDS.DESIGN) {
    const subsystemById = rowsById(subsystemRows);
    const parentSubsystemRows = parentIdsFromRow(row, "parentRequirement", "subsystem-requirement").map((id) => subsystemById.get(id)).filter(Boolean);
    return dedupeArchitectureRefs(parentSubsystemRows.flatMap((parent) =>
      resolveArtifactArchitectureRefs(parent, ARTIFACT_KINDS.SUBSYSTEM, artifactCollections)
    ));
  }

  return dedupeArchitectureRefs(directRefs);
}

export function downstreamSubsystemRequirementIds(systemRow = {}, artifactCollections = {}) {
  const systemId = cellText(systemRow.id);
  const subsystemRows = artifactCollections.subsystemRows || artifactCollections.subsystemRequirements || [];
  return compactList(subsystemRows
    .filter((row) => parentIdsFromRow(row, "parentSystemRequirement", "system-requirement").includes(systemId))
    .map((row) => row.id));
}

export function downstreamDesignElementIds(row = {}, kind = "", artifactCollections = {}) {
  const designRows = artifactCollections.designRows || artifactCollections.designElements || [];

  if (kind === ARTIFACT_KINDS.SYSTEM) {
    const subsystemIds = splitIds(downstreamSubsystemRequirementIds(row, artifactCollections));
    return compactList(designRows
      .filter((design) => parentIdsFromRow(design, "parentRequirement", "subsystem-requirement").some((id) => subsystemIds.includes(id)))
      .map((design) => design.id));
  }

  if (kind === ARTIFACT_KINDS.SUBSYSTEM) {
    const subsystemId = cellText(row.id);
    return compactList(designRows
      .filter((design) => parentIdsFromRow(design, "parentRequirement", "subsystem-requirement").includes(subsystemId))
      .map((design) => design.id));
  }

  return "";
}

export function artifactKindForLinkType(linkType) {
  if (linkType === "software-requirement") return ARTIFACT_KINDS.SOFTWARE;
  if (linkType === "system-requirement") return ARTIFACT_KINDS.SYSTEM;
  if (linkType === "subsystem-requirement") return ARTIFACT_KINDS.SUBSYSTEM;
  if (linkType === "design-element") return ARTIFACT_KINDS.DESIGN;
  return "";
}

export function normalizeFunctionalRowRef(value) {
  const raw = cellText(value).trim();
  if (!raw) return "";
  const withoutPrefix = raw.replace(/^FD[-_\s]*/i, "").trim();
  const numeric = Number(withoutPrefix);
  if (Number.isFinite(numeric) && String(numeric) === withoutPrefix.replace(/^0+/, "")) {
    return String(numeric);
  }
  if (/^0+\d+$/.test(withoutPrefix)) {
    return withoutPrefix.replace(/^0+/, "") || "0";
  }
  return withoutPrefix.toLowerCase();
}

export function functionalRowIndexForTraceValue(cbaRows = [], value = "") {
  const target = normalizeFunctionalRowRef(value);
  if (!target) return -1;
  return (Array.isArray(cbaRows) ? cbaRows : []).findIndex((row, index) => {
    const candidates = [
      row?.traceId,
      row?.rowRef,
      row?.functionalTraceId,
      row?.sourceTraceId,
      index + 1,
    ].map(normalizeFunctionalRowRef).filter(Boolean);
    return candidates.includes(target);
  });
}
