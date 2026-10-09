import { functionalSourceIndex } from '../code-architecture-context/functionalModel';
import { codeSourceProvenance } from '../code-architecture-context/codeSourceIdentity';
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
const ARTIFACT_STORE = "artifactRows";
const LOCAL_STORAGE_CACHE_MAX_CHARS = 750000;
const INDEXED_DB_ROW_CHUNK_MAX_CHARS = 300000;
const artifactRowsMemoryCache = new Map();
const artifactWrites = new Map();
const unsavedArtifactRows = new Map();
export function getUnsavedArtifactRows(kind, projectId, repoId) {
  return unsavedArtifactRows.get(storageKeyFor(kind, projectId, repoId));
}
const artifactWriteVersions = new Map();
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

function openArtifactConnection(version) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, db) => {
      if (settled) { db?.close(); return; }
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(db);
    };
    const timer = setTimeout(() => finish(new Error("Requirements storage could not open. Close other xHandle tabs and retry.")), 5000);
    const request = version == null ? indexedDB.open(ARTIFACT_DB_NAME) : indexedDB.open(ARTIFACT_DB_NAME, version);
    request.onupgradeneeded = () => {
      if (settled) { request.transaction.abort(); return; }
      const db = request.result;
      if (!db.objectStoreNames.contains(ARTIFACT_STORE)) db.createObjectStore(ARTIFACT_STORE, { keyPath: "key" });
    };
    request.onblocked = () => finish(new Error("Requirements storage upgrade is blocked. Close other xHandle tabs and retry."));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      finish(null, request.result);
    };
    request.onerror = () => finish(request.error);
  });
}

async function openArtifactDb() {
  if (!canUseIndexedDB()) return null;
  // Inspect the actual version; never delete an existing database to repair it.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const db = await openArtifactConnection();
    if (db.objectStoreNames.contains(ARTIFACT_STORE)) return db;
    const nextVersion = db.version + 1;
    db.close();
    try {
      const repaired = await openArtifactConnection(nextVersion);
      if (repaired.objectStoreNames.contains(ARTIFACT_STORE)) return repaired;
      repaired.close();
    } catch (error) {
      // Another tab may have completed a newer upgrade between our opens.
      if (error?.name !== "VersionError") throw error;
    }
  }
  throw new Error("Requirements storage schema could not be initialized.");
}

export async function ensureArtifactStorageReady() {
  const db = await openArtifactDb();
  if (!db) throw new Error("Requirements storage is unavailable. Enable browser database storage before generating requirements.");
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ARTIFACT_STORE, "readwrite");
      tx.objectStore(ARTIFACT_STORE).count();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Requirements storage check was aborted."));
    });
  } finally { db.close(); }
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
      const invalid = () => Object.assign(new Error("Saved requirements are incomplete or damaged. Existing results were preserved; restore a complete backup or regenerate."), { revision: record.revision || 0 });
      if (record.chunked) {
        if (!Array.isArray(record.chunkKeys) || !Number.isInteger(record.rowCount) || record.rowCount < 0 || record.chunkKeys.some(chunkKey => typeof chunkKey !== "string") || new Set(record.chunkKeys).size !== record.chunkKeys.length) {
          reject(invalid()); return;
        }
        const chunkResults = new Array(record.chunkKeys.length);
        let remaining = record.chunkKeys.length;
        if (!remaining) {
          if (record.rowCount !== 0) reject(invalid());
          else resolve({ rows: [], revision: record.revision || 0 });
          return;
        }
        record.chunkKeys.forEach((chunkKey, index) => {
          const chunkRequest = store.get(chunkKey);
          chunkRequest.onsuccess = () => {
            const chunkRows = chunkRequest.result?.rows;
            if (!Array.isArray(chunkRows) || chunkRequest.result.parentKey !== key) { reject(invalid()); return; }
            chunkResults[index] = chunkRows;
            remaining -= 1;
            if (!remaining) {
              const rows = chunkResults.flat();
              if (rows.length !== record.rowCount) reject(invalid());
              else resolve({ rows, revision: record.revision || 0 });
            }
          };
          chunkRequest.onerror = () => reject(chunkRequest.error);
        });
        return;
      }
      if (!Array.isArray(record.rows)) reject(invalid());
      else resolve({ rows: record.rows, revision: record.revision || 0 });
    };
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error || new Error("Requirements load was aborted."));
    tx.onerror = () => reject(tx.error || new Error("Requirements could not be loaded."));
  }).finally(() => db.close?.());
}

async function writeArtifactRowsToDb(key, rows, revision) {
  const db = await openArtifactDb();
  if (!db) return false;
  void requestPersistentBrowserStorage();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ARTIFACT_STORE, "readwrite");
    const store = tx.objectStore(ARTIFACT_STORE);
    const safeRows = Array.isArray(rows) ? rows : [];
    const chunks = chunkRowsForIndexedDb(safeRows);
    const updatedAt = new Date().toISOString();
    const priorRequest = store.get(key);
    priorRequest.onsuccess = () => {
      try {
      revision.value = Math.max(revision.value, (priorRequest.result?.revision || 0) + 1);
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
        revision: revision.value,
        updatedAt,
      });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    };
    priorRequest.onerror = () => reject(priorRequest.error);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Artifact row save transaction aborted."));
  }).finally(() => db.close?.());
}

function localArtifactRecord(key) {
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { rows: parsed, revision: 0 };
  if (parsed?.format === "artifact-rows-v1" && Array.isArray(parsed.rows) && parsed.rowCount === parsed.rows.length && Number.isFinite(parsed.revision)) return parsed;
  throw new Error("Saved requirements fallback is incomplete or damaged.");
}

export function loadArtifactRows(kind, projectId, repoId) {
  const key = storageKeyFor(kind, projectId, repoId);
  if (artifactRowsMemoryCache.has(key)) return artifactRowsMemoryCache.get(key);
  try {
    const record = localArtifactRecord(key);
    if (record) artifactRowsMemoryCache.set(key, record.rows);
    return record?.rows || [];
  } catch { return []; }
}

export async function loadArtifactRowsAsync(kind, projectId, repoId) {
  const key = storageKeyFor(kind, projectId, repoId);
  // A notification/read must observe the completed write, never an older snapshot.
  if (unsavedArtifactRows.has(key)) return unsavedArtifactRows.get(key);
  const pending = artifactWrites.get(key);
  if (pending) await pending;
  const version = artifactWriteVersions.get(key);
  let local = null, localError = null;
  try { local = localArtifactRecord(key); } catch (error) { localError = error; }
  let stored;
  try { stored = await readArtifactRowsFromDb(key); }
  catch (error) {
    if (!local || (error.revision != null && local.revision < error.revision)) throw error;
    stored = null;
  }
  // Retry if a write began while the read was in flight.
  if (artifactWrites.get(key) || version !== artifactWriteVersions.get(key)) return loadArtifactRowsAsync(kind, projectId, repoId);
  const record = local && (!stored || local.revision > stored.revision) ? local : stored;
  if (!record && localError) throw localError;
  const rows = record?.rows || [];
  artifactRowsMemoryCache.set(key, rows);
  return rows;
}

export function saveArtifactRows(kind, projectId, repoId, rows) {
  // Legacy fire-and-forget callers still notify only after durable completion.
  return saveArtifactRowsAsync(kind, projectId, repoId, rows).catch(error => {
    console.warn("[code-architecture-assurance] Save failed.", error);
  });
}

export function saveArtifactRowsAsync(kind, projectId, repoId, rows) {
  const key = storageKeyFor(kind, projectId, repoId);
  const safeRows = Array.isArray(rows) ? rows : [];
  artifactWriteVersions.set(key, (artifactWriteVersions.get(key) || 0) + 1);
  const prior = artifactWrites.get(key) || Promise.resolve();
  const operation = prior.catch(() => {}).then(async () => {
    let local;
    try { local = localArtifactRecord(key); } catch { /* A new complete save repairs a damaged fallback. */ }
    const revision = { value: Math.max(Date.now(), (local?.revision || 0) + 1) };
    let persisted = false;
    try { persisted = await writeArtifactRowsToDb(key, safeRows, revision); }
    catch (error) { console.warn("[code-architecture-assurance] IndexedDB save failed.", error); }
    let cached = false;
    try {
      const serialized = JSON.stringify({ format: "artifact-rows-v1", revision: revision.value, rowCount: safeRows.length, rows: safeRows });
      if (serialized.length <= LOCAL_STORAGE_CACHE_MAX_CHARS) {
        localStorage.setItem(key, serialized);
        cached = true;
      } else if (persisted) localStorage.removeItem(key);
    } catch { /* Keep prior persisted data intact if the replacement fails. */ }
    if (!persisted && !cached) throw new Error("Requirements could not be saved to browser storage. Generated results remain in this view; copy them before refreshing.");
    unsavedArtifactRows.delete(key);
    artifactRowsMemoryCache.set(key, safeRows);
  });
  artifactWrites.set(key, operation);
  return operation.then(() => {
    if (artifactWrites.get(key) === operation) artifactWrites.delete(key);
    emitArtifactRowsChanged({ kind, projectId, repoId, key });
  }, error => {
    unsavedArtifactRows.set(key, safeRows);
    if (artifactWrites.get(key) === operation) artifactWrites.delete(key);
    throw error;
  });
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
    type: !ref.mode || ref.mode === "edge" ? "edge" : "node",
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
    ...codeSourceProvenance(row),
    ...(row.functionalModel ? {
      sourceTraceIds: row.functionalModel.sourceTraceIds,
      sourceRowRefs: row.functionalModel.sourceRowRefs,
      sourceIndices: row.functionalModel.sourceIndices,
      functionalModelVersion: row.functionalModel.version,
    } : {}),
    lineage: row.lineage || null,
    canonicalRelationshipId: row.canonicalRelationshipId || "",
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
  return cbaRows[functionalRowIndexForTraceValue(cbaRows, sourceId)];
}
export function findFunctionalRowIndexByTrace(cbaRows = [], sourceId = "") {
  return functionalRowIndexForTraceValue(cbaRows, sourceId);
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
  cbaRows = Array.isArray(cbaRows) ? cbaRows : [];
  const raw = cellText(value);
  const exact = cbaRows.map((row,index)=>({row,index})).filter(({row})=>[row.traceId,row.functionalTraceId,row.sourceTraceId].some(id=>id && cellText(id)===raw));
  if (exact.length) return exact.length === 1 ? exact[0].index : -1;
  if (raw.startsWith("functional-relationship:")) return functionalSourceIndex(cbaRows, raw);
  const target = normalizeFunctionalRowRef(value);
  if (!target) return -1;
  const explicitRefs = cbaRows.map((row,index)=>({row,index})).filter(({row})=>row.rowRef != null && normalizeFunctionalRowRef(row.rowRef) === target);
  if (explicitRefs.length) return explicitRefs.length === 1 ? explicitRefs[0].index : -1;
  const matches = cbaRows.map((row,index)=>({row,index})).filter(({row,index})=> !row.lineage && [row.traceId,row.rowRef,row.functionalTraceId,row.sourceTraceId,index+1].map(normalizeFunctionalRowRef).filter(Boolean).includes(target));
  return matches.length === 1 ? matches[0].index : -1;
}
