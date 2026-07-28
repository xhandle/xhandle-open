import { buildSafetyCaseProjectContext } from "./safetyCaseProjectContext";

const KNOWN_INDEXED_DBS = ["TraceabilityDB", "xhandle", "TraceabilityMeta", "BaselinesDB", "SafetyCaseEvidenceDB", "xhandle-safety-remediation", "xhandle-code-architecture-hazard-analysis"];
const MAX_RECORDS_PER_STORE = 500;
const IDB_OPEN_TIMEOUT_MS = 3000;
const IDB_READ_TIMEOUT_MS = 2500;
const MAX_LOCAL_STORAGE_RECORDS_PER_KEY = 500;
const MAX_LOCAL_STORAGE_DEPTH = 5;
const HIDDEN_MODAL_CATEGORIES = new Set(["Safety Cases", "Browser Memory", "Project Metadata"]);
let lastEvidenceScanDiagnostics = null;

function createDiagnostics(selectedProjectId) {
  return {
    selectedProjectId: selectedProjectId || null,
    fallbackToWorkspace: false,
    localStorageKeys: 0,
    localStorageParsedKeys: 0,
    localStorageRawKeys: 0,
    localStorageRecords: 0,
    indexedDBNames: [],
    indexedDBOpened: [],
    indexedDBStores: 0,
    indexedDBRows: 0,
    normalizedArtifacts: 0,
    returnedArtifacts: 0,
    categories: {},
    errors: [],
  };
}

export function getLastEvidenceScanDiagnostics() {
  return lastEvidenceScanDiagnostics;
}

function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function withTimeout(promise, fallback, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    Promise.resolve(promise)
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timer));
  });
}

function loadLocationLookups() {
  if (typeof localStorage === "undefined") {
    return { projectsById: new Map(), foldersById: new Map(), modulesById: new Map() };
  }
  const projects = safeParse(localStorage.getItem("xhandle.projects"), []);
  const requirementFolders = safeParse(localStorage.getItem("xhandle:req-projects"), []);
  const projectsById = new Map((Array.isArray(projects) ? projects : []).map((project) => [String(project.id), project]));
  const foldersById = new Map();
  const modulesById = new Map();

  (Array.isArray(requirementFolders) ? requirementFolders : []).forEach((folder) => {
    if (folder?.id) foldersById.set(String(folder.id), folder);
    (folder?.modules || []).forEach((module) => {
      if (module?.id) modulesById.set(String(module.id), { ...module, folder });
    });
  });

  return { projectsById, foldersById, modulesById };
}

function labelFromLookup(map, id, fields = ["name", "title"]) {
  if (!id) return "";
  const value = map.get(String(id));
  if (!value) return "";
  for (const field of fields) {
    if (value?.[field]) return String(value[field]);
  }
  return "";
}

function compactParts(parts) {
  return parts.filter(Boolean).filter((part, index, all) => all.indexOf(part) === index);
}

function stringifyValue(value, fallback = "") {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function humanizeToken(value, fallback = "Record") {
  const text = stringifyValue(value, fallback)
    .replace(/^xhandle[:.]?/i, "")
    .replace(/[_:./-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function truncateText(value, maxLength = 220) {
  const text = stringifyValue(value, "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function firstUsefulString(raw, fields) {
  for (const field of fields) {
    const value = raw?.[field];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function readableDatabaseLabel(database) {
  if (database === "localStorage") return "Browser memory";
  if (database === "SafetyCaseEvidenceDB") return "Uploaded evidence";
  if (database === "TraceabilityDB") return "Traceability";
  if (database === "TraceabilityMeta") return "Traceability metadata";
  if (database === "BaselinesDB") return "Baselines";
  if (database === "xhandle") return "xHandle workspace";
  return humanizeToken(database, "IndexedDB");
}

function readableSourceLabel(source) {
  return humanizeToken(source, "Source");
}

function readableStoreLabel(store) {
  return humanizeToken(store, "Store");
}

function buildReadableSummary(raw) {
  const directSummary = firstUsefulString(raw, ["description", "Description", "summary", "Summary", "details", "Details", "rationale", "Rationale", "Mitigation"]);
  if (directSummary) return truncateText(directSummary, 700);

  const ignored = new Set(["id", "ID", "key", "Key", "_artifactId", "_localStorageKey", "_localStoragePath", "_sourceRecordKey", "projectId", "folderId", "moduleId", "dataUrl"]);
  const lines = Object.entries(raw || {})
    .filter(([key, value]) => !ignored.has(key) && value != null && value !== "" && typeof value !== "object")
    .slice(0, 8)
    .map(([key, value]) => `${humanizeToken(key)}: ${truncateText(value, 160)}`);
  if (lines.length) return lines.join("\n");

  const objectKeys = Object.keys(raw || {}).filter((key) => !ignored.has(key)).slice(0, 8);
  return objectKeys.length ? `Contains ${objectKeys.map((key) => humanizeToken(key).toLowerCase()).join(", ")}.` : "";
}

function inferArtifactTitle(raw, category, source, id) {
  const named = firstUsefulString(raw, [
    "title", "Title", "name", "Name", "Requirement", "requirement", "Hazard", "hazard", "Function", "function",
    "controlAction", "label", "fileName", "filename",
  ]);
  if (named) return truncateText(named, 140);
  if (raw?.fromFunction && raw?.toFunction) return `${raw.fromFunction} -> ${raw.toFunction}`;
  if (raw?._localStoragePath === "raw") return `${humanizeToken(source)} record`;
  return `${humanizeToken(category)} ${String(id).slice(0, 12)}`;
}

function describeArtifactLocation(raw, { database, store, source, lookups }) {
  const projectId = raw?.projectId || raw?.ProjectId || raw?.project || raw?.Project;
  const folderId = raw?.folderId || raw?.FolderId || projectId;
  const moduleId = raw?.moduleId || raw?.ModuleId;
  const moduleRecord = moduleId ? lookups.modulesById.get(String(moduleId)) : null;
  const projectName = raw?.projectName || raw?.ProjectName || labelFromLookup(lookups.projectsById, projectId);
  const folderName = raw?.folderName || raw?.FolderName || labelFromLookup(lookups.foldersById, folderId);
  const moduleName = raw?.moduleName || raw?.module || raw?.ModuleName || raw?.Module || moduleRecord?.name;
  const diagramName = raw?.diagramName || raw?.diagramTitle || raw?.DiagramName || raw?.DiagramTitle || raw?.graphName || raw?.modelName;
  const parentName = raw?.parentName || raw?.ParentName || raw?.groupName || raw?.GroupName || raw?.containerName;
  const sourcePath = database === "localStorage" ? source : `${database}.${store}`;

  const parts = compactParts([
    projectName && `Project: ${projectName}`,
    folderName && folderName !== projectName && `Folder: ${folderName}`,
    moduleName && `Module: ${moduleName}`,
    diagramName && `Diagram: ${diagramName}`,
    parentName && `Parent: ${parentName}`,
    sourcePath && `Store: ${sourcePath}`,
  ]);

  if (parts.length) return parts.join(" / ");
  return sourcePath ? `Store: ${sourcePath}` : "Location unavailable";
}

function normalizeArtifact(raw, category, source, { database = "localStorage", store = source, preserveId = false, lookups = null } = {}) {
  const id = raw?.id || raw?.ID || raw?.key || raw?.Key || raw?.artifactId || raw?.title || raw?.name || raw?._artifactId;
  if (!id) return null;
  const rawId = String(id);
  const locationLookups = lookups || loadLocationLookups();
  const summary = buildReadableSummary(raw);
  const title = inferArtifactTitle(raw, category, source, id);
  return {
    id: preserveId ? rawId : `${database}:${store}:${rawId}`,
    rawId,
    title,
    description: describeArtifactLocation(raw, { database, store, source, lookups: locationLookups }),
    summary,
    category,
    database,
    databaseLabel: readableDatabaseLabel(database),
    store,
    storeLabel: readableStoreLabel(store),
    source,
    sourceLabel: readableSourceLabel(source),
    type: raw?.type || raw?.Type || source,
    raw,
  };
}

function addArtifacts(groups, category, source, rows, options = {}) {
  const lookups = options.lookups || loadLocationLookups();
  const artifacts = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      try {
        return normalizeArtifact(row, category, source, { ...options, lookups });
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (!artifacts.length) return 0;
  if (options.diagnostics) options.diagnostics.normalizedArtifacts += artifacts.length;
  if (options.diagnostics) {
    options.diagnostics.categories[category] = (options.diagnostics.categories[category] || 0) + artifacts.length;
  }
  if (!groups[category]) groups[category] = [];
  groups[category].push(...artifacts);
  return artifacts.length;
}

function categoryForStore(database, storeName) {
  if (/code-architecture-hazard|hazardAnalysisRuns/i.test(`${database}.${storeName}`)) return "Code Architecture Hazard Analysis";
  if (/safety-remediation|remediation|patchProposal|safetyFinding|summaryArtifacts/i.test(`${database}.${storeName}`)) return "Safety Remediation";
  if (/attachment|upload|file/i.test(`${database}.${storeName}`)) return "Uploaded Evidence";
  if (/requirement/i.test(storeName)) return "Requirements";
  if (/note|review/i.test(storeName)) return "Notes & Reviews";
  if (/safety/i.test(storeName)) return "Safety Cases";
  if (/baseline|code|architecture|cba|index/i.test(storeName)) return "Architecture";
  if (/diagram|position/i.test(storeName)) return "Diagrams";
  if (/project|folder|handle|meta|sha/i.test(storeName)) return "Project Metadata";
  return database === "TraceabilityDB" ? "TraceabilityDB Records" : "IndexedDB Records";
}

function categoryForLocalStoragePath(key, path) {
  const target = `${key}.${path}`;
  if (/code-architecture-hazard|hazardAnalysisRuns/i.test(target)) return "Code Architecture Hazard Analysis";
  if (/safety-remediation|remediation|patchProposal|safetyFinding|summaryArtifacts/i.test(target)) return "Safety Remediation";
  if (/attachment|upload|file/i.test(target)) return "Uploaded Evidence";
  if (/responseRows|functional|decomposition/i.test(target)) return "Functional Decomposition";
  if (/riskRegister|hazard|risk-register/i.test(target)) return "Hazards";
  if (/analysisResult|risk-summary|Summary/i.test(target)) return "Risk Assessments";
  if (/requirement/i.test(target)) return "Requirements";
  if (/vnv|verification|validation|testCases|traceMatrix|procedures/i.test(target)) return "Verification & Validation";
  if (/review|approval|human-in-the-loop/i.test(target)) return "Notes & Reviews";
  if (/safetyCase/i.test(target)) return "Safety Cases";
  if (/diagram|position|group|node|edge|architecture|cba/i.test(target)) return "Architecture";
  if (/project|folder|module|meta|settings/i.test(target)) return "Project Metadata";
  return "Browser Memory";
}

function isRecordLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sheetRowsToRecords(rows, context) {
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) return [];
  const headers = rows[0].map((header, index) => String(header || `Column ${index + 1}`));
  return rows.slice(1, MAX_LOCAL_STORAGE_RECORDS_PER_KEY + 1).map((row, index) => {
    const record = {};
    headers.forEach((header, headerIndex) => {
      record[header] = Array.isArray(row) ? row[headerIndex] : "";
    });
    const title = record.Hazard || record.Hazards || record.Risk || record.Effect || record["Function (From)"] || record.Requirement || `Sheet row ${index + 1}`;
    return {
      ...record,
      ...context,
      id: `${context._localStorageKey}:${context._localStoragePath}:row-${index + 1}`,
      title,
      type: context._localStoragePath.includes("analysisResult") ? "analysis-sheet-row" : "sheet-row",
      summary: headers.map((header) => `${header}: ${record[header] ?? ""}`).join("\n"),
    };
  });
}

function normalizeFunctionalRow(row, context, index) {
  return {
    ...row,
    ...context,
    id: row?.id || `${context._localStorageKey}:${context._localStoragePath}:row-${index + 1}`,
    title: row?.fromFunction && row?.toFunction ? `${row.fromFunction} -> ${row.toFunction}` : row?.fromFunction || row?.toFunction || `Functional row ${index + 1}`,
    type: "functional-decomposition-row",
    summary: compactParts([
      row?.fromDetails && `From details: ${row.fromDetails}`,
      row?.controlAction && `Control action: ${row.controlAction}`,
      row?.controlDetails && `Control details: ${row.controlDetails}`,
      row?.toDetails && `To details: ${row.toDetails}`,
    ]).join("\n"),
  };
}

function shouldIncludeForProject(record, selectedProjectId) {
  if (!selectedProjectId) return true;
  const recordProjectId = record?.projectId || record?.ProjectId || record?.folderId || record?.FolderId;
  return recordProjectId == null || String(recordProjectId) === String(selectedProjectId);
}

function collectLocalStorageRecordsFromValue(value, context, depth = 0) {
  if (depth > MAX_LOCAL_STORAGE_DEPTH || value == null) return [];
  if (Array.isArray(value)) {
    if (!value.length) return [];
    if (Array.isArray(value[0])) return sheetRowsToRecords(value, context);
    return value.slice(0, MAX_LOCAL_STORAGE_RECORDS_PER_KEY).flatMap((item, index) => {
      if (isRecordLike(item)) {
        if (/responseRows/i.test(context._localStoragePath)) return [normalizeFunctionalRow(item, context, index)];
        return [{
          ...item,
          ...context,
          id: item.id || item.key || `${context._localStorageKey}:${context._localStoragePath}:row-${index + 1}`,
        }];
      }
      return [{
        ...context,
        id: `${context._localStorageKey}:${context._localStoragePath}:value-${index + 1}`,
        title: String(item).slice(0, 120) || `Value ${index + 1}`,
        type: "localStorage-value",
        summary: String(item),
        value: item,
      }];
    });
  }

  if (!isRecordLike(value)) {
    return [{
      ...context,
      id: `${context._localStorageKey}:${context._localStoragePath}:value`,
      title: String(value).slice(0, 120) || context._localStorageKey,
      type: "localStorage-value",
      summary: String(value),
      value,
    }];
  }

  const childRecords = [];
  Object.entries(value).forEach(([childKey, childValue]) => {
    const childContext = {
      ...context,
      _localStoragePath: context._localStoragePath ? `${context._localStoragePath}.${childKey}` : childKey,
    };
    if (Array.isArray(childValue) || isRecordLike(childValue)) {
      childRecords.push(...collectLocalStorageRecordsFromValue(childValue, childContext, depth + 1));
    }
  });

  if (childRecords.length) return childRecords;
  return [{
    ...value,
    ...context,
    id: value.id || value.key || `${context._localStorageKey}:${context._localStoragePath || "record"}`,
  }];
}

function collectProjectDataRecords(projectData, selectedProjectId, lookups) {
  const rows = [];
  Object.entries(isRecordLike(projectData) ? projectData : {}).forEach(([projectId, projectRecord]) => {
    if (selectedProjectId && String(projectId) !== String(selectedProjectId)) return;
    const projectName = labelFromLookup(lookups.projectsById, projectId);
    const baseContext = {
      projectId,
      projectName,
      _localStorageKey: "xhandle.projectData",
      _localStoragePath: projectId,
    };
    rows.push(...collectLocalStorageRecordsFromValue(projectRecord, baseContext));
  });
  return rows;
}

function loadAllLocalStorageEvidence(selectedProjectId, diagnostics = null) {
  const groups = {};
  if (typeof localStorage === "undefined") return groups;
  const lookups = loadLocationLookups();
  if (diagnostics) diagnostics.localStorageKeys = localStorage.length;

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    const rawValue = localStorage.getItem(key);
    const parsed = safeParse(rawValue, undefined);
    let records = [];
    if (typeof parsed === "undefined") {
      if (diagnostics) diagnostics.localStorageRawKeys += 1;
      records = [{
        _localStorageKey: key,
        _localStoragePath: "raw",
        id: `${key}:raw`,
        title: key,
        type: "localStorage-raw-value",
        summary: String(rawValue || "").slice(0, 5000),
      }];
    } else {
      if (diagnostics) diagnostics.localStorageParsedKeys += 1;
      records = key === "xhandle.projectData"
        ? collectProjectDataRecords(parsed, selectedProjectId, lookups)
        : collectLocalStorageRecordsFromValue(parsed, { _localStorageKey: key, _localStoragePath: "" });
    }
    if (diagnostics) diagnostics.localStorageRecords += records.length;

    records
      .filter((record) => shouldIncludeForProject(record, selectedProjectId))
      .forEach((record) => {
        const source = record._localStoragePath ? `${key}.${record._localStoragePath}` : key;
        addArtifacts(groups, categoryForLocalStoragePath(key, record._localStoragePath || ""), source, [record], {
          database: "localStorage",
          store: key,
          lookups,
          diagnostics,
        });
      });
  }

  return groups;
}

function flattenIndexedDBRows(rows, database, storeName) {
  return rows.flatMap((row, index) => {
    if (Array.isArray(row?.value)) {
      return row.value.slice(0, MAX_RECORDS_PER_STORE).map((item, childIndex) => ({
        ...item,
        id: item?.id || item?.key || `${row.key || index}:${childIndex}`,
        _sourceRecordKey: row.key,
      }));
    }
    return [{ ...row, id: row?.id || row?.key || `${storeName}-${index}` }];
  });
}

async function listIndexedDBNames() {
  if (typeof indexedDB === "undefined") return KNOWN_INDEXED_DBS;
  if (typeof indexedDB.databases === "function") {
    try {
      const databases = await indexedDB.databases();
      const names = databases.map((database) => database.name).filter(Boolean);
      return Array.from(new Set([...KNOWN_INDEXED_DBS, ...names]));
    } catch {
      return KNOWN_INDEXED_DBS;
    }
  }
  return KNOWN_INDEXED_DBS;
}

function openExistingIndexedDB(name) {
  return withTimeout(new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      try {
        request.transaction?.abort();
      } catch {
        // Ignore; this open path is read-only and should not create or upgrade databases.
      }
      resolve(null);
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => resolve(null);
  }), null, IDB_OPEN_TIMEOUT_MS);
}

function getAllFromStore(db, storeName) {
  return withTimeout(new Promise((resolve) => {
    try {
      const rows = [];
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).openCursor();
      request.onerror = () => resolve([]);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= MAX_RECORDS_PER_STORE) {
          resolve(rows);
          return;
        }
        const value = cursor.value;
        rows.push(value && typeof value === "object" ? { ...value, key: value.key ?? cursor.key } : { key: cursor.key, value });
        cursor.continue();
      };
      tx.onerror = () => resolve(rows);
      tx.onabort = () => resolve(rows);
    } catch {
      resolve([]);
    }
  }), [], IDB_READ_TIMEOUT_MS);
}

async function loadAllIndexedDBEvidence(projectId, diagnostics = null) {
  const groups = {};
  const dbNames = await listIndexedDBNames();
  if (diagnostics) diagnostics.indexedDBNames = dbNames;
  for (const dbName of dbNames) {
    const db = await openExistingIndexedDB(dbName);
    if (!db) continue;
    if (diagnostics) diagnostics.indexedDBOpened.push(dbName);
    const storeNames = Array.from(db.objectStoreNames || []);
    if (diagnostics) diagnostics.indexedDBStores += storeNames.length;
    for (const storeName of storeNames) {
      const rows = await getAllFromStore(db, storeName);
      if (diagnostics) diagnostics.indexedDBRows += rows.length;
      const scopedRows = projectId ? rows.filter((row) => row?.projectId == null || String(row.projectId) === String(projectId)) : rows;
      const flattenedRows = flattenIndexedDBRows(scopedRows, dbName, storeName);
      addArtifacts(groups, categoryForStore(dbName, storeName), `${dbName}.${storeName}`, flattenedRows, {
        database: dbName,
        store: storeName,
        diagnostics,
      });
    }
    db.close?.();
  }
  return groups;
}

function uniqueArtifacts(artifacts) {
  const seen = new Set();
  return artifacts.filter((artifact) => {
    const key = artifact.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeGroups(target, source) {
  Object.entries(source || {}).forEach(([category, artifacts]) => {
    if (!target[category]) target[category] = [];
    target[category].push(...artifacts);
  });
  return target;
}

function artifactCount(groups) {
  return Object.values(groups || {}).reduce((count, artifacts) => count + (Array.isArray(artifacts) ? artifacts.length : 0), 0);
}

function addProjectContextArtifacts(groups, context, diagnostics = null) {
  addArtifacts(groups, "Hazards", "risk-register", context.hazards, { preserveId: true, source: "risk-register", diagnostics });
  addArtifacts(groups, "Risk Assessments", "risk-summary", context.riskSummary, { preserveId: true, source: "risk-summary", diagnostics });
  addArtifacts(groups, "Requirements", "requirements", context.requirements, { preserveId: true, source: "requirements", diagnostics });
  addArtifacts(groups, "Verification & Validation", "vnv-center", context.verification, { preserveId: true, source: "vnv-center", diagnostics });
  addArtifacts(groups, "Architecture", "code-architecture", context.codeArchitecture, { preserveId: true, source: "code-architecture", diagnostics });
}

async function loadEvidenceGroupsForProject(selectedProjectId, diagnostics = null) {
  const groups = {};
  try {
    mergeGroups(groups, await loadAllIndexedDBEvidence(selectedProjectId, diagnostics));
  } catch (error) {
    diagnostics?.errors.push(`IndexedDB scan failed: ${error?.message || error}`);
    // Keep local browser-memory evidence available even if one IndexedDB store misbehaves.
  }
  try {
    mergeGroups(groups, loadAllLocalStorageEvidence(selectedProjectId, diagnostics));
  } catch (error) {
    diagnostics?.errors.push(`localStorage scan failed: ${error?.message || error}`);
    // Keep project-context evidence available even if a localStorage record is malformed.
  }
  addProjectContextArtifacts(groups, buildSafetyCaseProjectContext(selectedProjectId), diagnostics);
  return groups;
}

export async function loadLinkableSafetyCaseEvidence({ projectId, sourceProjectId } = {}) {
  const selectedProjectId = sourceProjectId ?? projectId;
  const diagnostics = createDiagnostics(selectedProjectId);
  let groups = await loadEvidenceGroupsForProject(selectedProjectId, diagnostics);
  if (selectedProjectId && artifactCount(groups) === 0) {
    diagnostics.fallbackToWorkspace = true;
    groups = await loadEvidenceGroupsForProject(undefined, diagnostics);
  }
  const result = Object.entries(groups)
    .filter(([category]) => !HIDDEN_MODAL_CATEGORIES.has(category))
    .map(([category, artifacts]) => ({
      category,
      artifacts: uniqueArtifacts(artifacts).sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""))),
    }))
    .filter((group) => group.artifacts.length)
    .sort((a, b) => a.category.localeCompare(b.category));
  diagnostics.returnedArtifacts = result.reduce((count, group) => count + group.artifacts.length, 0);
  lastEvidenceScanDiagnostics = diagnostics;
  return result;
}
