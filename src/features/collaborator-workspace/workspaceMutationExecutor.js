import { deleteArtifacts, getArtifact, migrateLegacyStorageToWorkspaceGraphIfStale, recordChange } from "../workspace-graph";
import { loadProjectHazardAnalysisRecord, saveProjectHazardAnalysisRecord } from "../project-hazard-analysis/projectHazardAnalysisStorage";
import { loadSafetyIssueReportRecord, saveSafetyIssueReportRecord } from "../project-hazard-analysis/safetyIssueReportStorage";
import { loadRequirements, saveRequirementRecord, saveRequirements } from "../requirements/actions/requirementsState";
import { readCbaRowsFromIndexedDB, writeCbaRowsToIndexedDB } from "../code-architecture-assurance/codeArchitectureStorage";
import { loadReviewItems, saveReviewItems } from "../results-review/reviewStore";
import { createSafetyCase, deleteSafetyCase, loadSafetyCase, saveSafetyCase } from "../safety-case/safetyCaseStore";

const PROJECT_DATA_KEY = "xhandle.projectData";
const PROJECTS_KEY = "xhandle.projects";
const SYSML_KEY = "xhandle.designManagement.sysmlV2.models";
const UNDO_KEY = "xhandle:collaborator-workspace:undo";
const MAX_UNDO = 25;
const IMMUTABLE_FIELDS = new Set(["id", "projectId", "createdAt", "sourceId", "artifactId"]);

function parseJson(raw, fallback) {
  try { return JSON.parse(raw || JSON.stringify(fallback)); } catch { return fallback; }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeFieldKey(record, requested) {
  const field = String(requested || "").trim();
  if (!field) return "";
  if (Object.prototype.hasOwnProperty.call(record || {}, field)) return field;
  const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Object.keys(record || {}).find((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized) || field;
}

function applyPatch(record, action) {
  const base = { ...(record || {}) };
  const patch = action.record && typeof action.record === "object"
    ? action.record
    : { [normalizeFieldKey(base, action.field)]: action.value };
  Object.entries(patch).forEach(([rawKey, value]) => {
    const key = normalizeFieldKey(base, rawKey);
    if (!key || IMMUTABLE_FIELDS.has(key)) return;
    base[key] = value;
  });
  base.updatedAt = base.updatedAt ? new Date().toISOString() : base.updatedAt;
  return base;
}

function readProjectMap() {
  return parseJson(localStorage.getItem(PROJECT_DATA_KEY), {});
}

function writeProjectMap(map) {
  localStorage.setItem(PROJECT_DATA_KEY, JSON.stringify(map || {}));
}

function rowIndexFromSourceId(sourceId, segment) {
  const match = String(sourceId || "").match(new RegExp(`${segment}:(\\d+)$`, "i"));
  return match ? Number(match[1]) : -1;
}

function findRecordIndex(rows, artifact, segment) {
  const snapshot = artifact?.structuredData;
  if (snapshot?.id) {
    const idIndex = rows.findIndex((row) => String(row?.id) === String(snapshot.id));
    if (idIndex >= 0) return idIndex;
  }
  const exactIndex = rows.findIndex((row) => JSON.stringify(row) === JSON.stringify(snapshot));
  if (exactIndex >= 0) return exactIndex;
  const candidateIndex = rowIndexFromSourceId(artifact?.sourceId, segment);
  return candidateIndex >= 0 && candidateIndex < rows.length ? candidateIndex : -1;
}

function pushUndo(entry) {
  const rows = parseJson(localStorage.getItem(UNDO_KEY), []);
  localStorage.setItem(UNDO_KEY, JSON.stringify([entry, ...rows].slice(0, MAX_UNDO)));
}

function popUndo() {
  const rows = parseJson(localStorage.getItem(UNDO_KEY), []);
  const [entry, ...remaining] = rows;
  localStorage.setItem(UNDO_KEY, JSON.stringify(remaining));
  return entry || null;
}

function emitChanged(detail) {
  window.dispatchEvent?.(new CustomEvent("xhandle:workspace-authoritative-data-changed", { detail }));
}

async function applyFunctionalAction(action, artifact) {
  const projectId = action.target.projectId || artifact?.projectId;
  if (!projectId) throw new Error("The functional-decomposition project could not be resolved.");
  const map = readProjectMap();
  const data = { ...(map[projectId] || {}) };
  const rows = [...(data.responseRows || [])];
  const before = clone(rows);
  if (action.operation === "create") rows.push(clone(action.record));
  else {
    const index = findRecordIndex(rows, artifact, "responseRows");
    if (index < 0) throw new Error("The functional-decomposition row no longer exists. Refresh and try again.");
    if (action.operation === "delete") rows.splice(index, 1);
    else if (action.operation === "update") rows[index] = applyPatch(rows[index], action);
    else throw new Error(`Operation ${action.operation} is not supported for functional rows.`);
  }
  data.responseRows = rows;
  data._updatedAt = new Date().toISOString();
  map[projectId] = data;
  writeProjectMap(map);
  return { domain: "functional-decomposition", projectId, before, after: clone(rows) };
}

async function applyHazardAction(action, artifact) {
  const projectId = action.target.projectId || artifact?.projectId;
  const stored = await loadProjectHazardAnalysisRecord(projectId);
  const summary = clone(stored?.analysisResult?.Summary || []);
  if (summary.length < 1) throw new Error("The saved hazard-analysis Summary is unavailable.");
  const before = clone(stored);
  if (action.operation === "create") {
    const record = action.record || {};
    summary.push(summary[0].map((header) => record[header] ?? record[normalizeFieldKey(record, header)] ?? ""));
  } else {
    const sourceHeaders = artifact?.structuredData?.columns || [];
    const sourceRow = artifact?.structuredData?.row || [];
    const identityHeaderIndex = sourceHeaders.findIndex((header) => /^(?:Raw Analysis Row ID|Raw Row ID|Analysis Row ID)$/i.test(String(header || "").trim()));
    const currentIdentityIndex = summary[0].findIndex((header) => /^(?:Raw Analysis Row ID|Raw Row ID|Analysis Row ID)$/i.test(String(header || "").trim()));
    const sourceIdentity = identityHeaderIndex >= 0 ? String(sourceRow[identityHeaderIndex] || "").trim() : "";
    let rowIndex = sourceIdentity && currentIdentityIndex >= 0
      ? summary.slice(1).findIndex((row) => String(row[currentIdentityIndex] || "").trim() === sourceIdentity)
      : -1;
    if (rowIndex < 0) rowIndex = summary.slice(1).findIndex((row) => JSON.stringify(row) === JSON.stringify(sourceRow));
    if (rowIndex < 0) rowIndex = Number(artifact?.structuredData?.rowIndex ?? rowIndexFromSourceId(artifact?.sourceId, "Summary"));
    const dataIndex = rowIndex + 1;
    if (!Number.isInteger(dataIndex) || dataIndex <= 0 || dataIndex >= summary.length) throw new Error("The hazard-analysis row no longer exists. Refresh and try again.");
    if (action.operation === "delete") summary.splice(dataIndex, 1);
    else if (action.operation === "update") {
      const rowObject = Object.fromEntries(summary[0].map((header, index) => [header, summary[dataIndex][index]]));
      const updated = applyPatch(rowObject, action);
      summary[dataIndex] = summary[0].map((header) => updated[header] ?? "");
    } else throw new Error(`Operation ${action.operation} is not supported for hazard rows.`);
  }
  const after = { ...(stored || {}), analysisResult: { ...(stored?.analysisResult || {}), Summary: summary } };
  const saved = await saveProjectHazardAnalysisRecord(projectId, after);
  if (!saved) throw new Error("The hazard-analysis change could not be persisted.");
  return { domain: "hazard-analysis", projectId, before, after: clone(after) };
}

async function applyRiskAction(action, artifact) {
  const projectId = action.target.projectId || artifact?.projectId;
  const stored = await loadProjectHazardAnalysisRecord(projectId);
  const rows = [...(stored?.riskRegister || [])];
  const before = clone(stored);
  if (action.operation === "create") rows.push(clone(action.record));
  else {
    const index = rows.findIndex((row) => String(row?.id || "") === String(artifact?.sourceId || artifact?.structuredData?.id || ""));
    if (index < 0) throw new Error("The safety issue or risk no longer exists. Refresh and try again.");
    if (action.operation === "delete") rows.splice(index, 1);
    else if (action.operation === "update") rows[index] = applyPatch(rows[index], action);
    else throw new Error(`Operation ${action.operation} is not supported for risks.`);
  }
  const after = { ...(stored || {}), riskRegister: rows };
  const saved = await saveProjectHazardAnalysisRecord(projectId, after);
  if (!saved) throw new Error("The safety-issue or risk change could not be persisted.");
  return { domain: "risk-register", projectId, before, after: clone(after) };
}

async function applyRequirementAction(action, artifact) {
  const rows = loadRequirements();
  const before = clone(rows);
  if (action.operation === "create") saveRequirementRecord({ ...(action.record || {}), projectId: action.target.projectId || action.record?.projectId });
  else {
    const id = artifact?.sourceId || artifact?.structuredData?.id;
    const index = rows.findIndex((row) => String(row?.id) === String(id));
    if (index < 0) throw new Error("The requirement no longer exists. Refresh and try again.");
    if (action.operation === "delete") saveRequirements(rows.filter((_, rowIndex) => rowIndex !== index), { source: "collaborator-workspace", requirementId: id });
    else if (action.operation === "update") saveRequirementRecord(applyPatch(rows[index], action));
    else if (["link", "unlink"].includes(action.operation)) {
      const link = {
        artifactId: action.relationship?.toArtifactId,
        type: action.relationship?.type || "traces_to",
        title: action.relationship?.title || "",
      };
      const existingLinks = Array.isArray(rows[index].links) ? rows[index].links : [];
      const matches = (item) => String(item?.artifactId || item?.targetId || item?.id || "") === String(link.artifactId);
      const links = action.operation === "link"
        ? (existingLinks.some(matches) ? existingLinks : [...existingLinks, link])
        : existingLinks.filter((item) => !matches(item));
      saveRequirementRecord({ ...rows[index], links });
    }
    else throw new Error(`Operation ${action.operation} is not supported for requirements.`);
  }
  return { domain: "requirements", projectId: action.target.projectId || artifact?.projectId, before, after: clone(loadRequirements()) };
}

async function applyCodeArchitectureAction(action, artifact) {
  const key = artifact?.sourceKey || action.target.sourceKey;
  if (!key) throw new Error("The code-architecture repository source could not be resolved.");
  const rows = await readCbaRowsFromIndexedDB(key);
  const before = clone(rows);
  if (action.operation === "create") rows.push(clone(action.record));
  else {
    const sourceToken = String(artifact?.sourceId || "").split(":").pop();
    let index = rows.findIndex((row) => [row?.traceId, row?.edgeId].some((id) => String(id || "") === sourceToken));
    if (index < 0) index = rows.findIndex((row) => JSON.stringify(row) === JSON.stringify(artifact?.structuredData));
    if (index < 0) throw new Error("The code-architecture edge no longer exists. Refresh and try again.");
    if (action.operation === "delete") rows.splice(index, 1);
    else if (action.operation === "update") rows[index] = applyPatch(rows[index], action);
    else throw new Error(`Operation ${action.operation} is not supported for code-architecture edges.`);
  }
  const saved = await writeCbaRowsToIndexedDB(key, rows);
  if (!saved) throw new Error("The code-architecture change could not be persisted.");
  return { domain: "code-architecture", projectId: artifact?.projectId, sourceKey: key, before, after: clone(rows) };
}

async function applySafetyReportAction(action, artifact) {
  const projectId = action.target.projectId || artifact?.projectId;
  const before = await loadSafetyIssueReportRecord(projectId);
  if (action.operation === "delete") await saveSafetyIssueReportRecord(projectId, "");
  else if (action.operation === "update") {
    const current = before?.markdown || "";
    const next = action.field && !/^(?:markdown|content|body)$/i.test(action.field)
      ? current
      : String(action.value ?? action.record?.markdown ?? action.record?.content ?? "");
    await saveSafetyIssueReportRecord(projectId, next);
  } else if (action.operation === "create") await saveSafetyIssueReportRecord(projectId, String(action.record?.markdown || action.record?.content || ""));
  else throw new Error(`Operation ${action.operation} is not supported for reports.`);
  return { domain: "safety-report", projectId, before: clone(before), after: clone(await loadSafetyIssueReportRecord(projectId)) };
}

async function applySysmlAction(action, artifact) {
  const models = parseJson(localStorage.getItem(SYSML_KEY), []);
  const before = clone(models);
  if (action.operation === "create" && action.target.type === "sysml_element") {
    const targetModelId = artifact?.type === "sysml_model" ? artifact.sourceId : action.record?.modelId;
    const model = models.find((item) => String(item?.id) === String(targetModelId));
    if (!model) throw new Error("Choose the SysML model that should own the new element.");
    model.elements = [...(model.elements || []), { ...clone(action.record), id: action.record?.id || `element-${Date.now()}` }];
  } else if (action.operation === "create" && action.target.type === "sysml_model") {
    models.push({ elements: [], relationships: [], ...clone(action.record), id: action.record?.id || `model-${Date.now()}` });
  } else if (artifact?.type === "sysml_model") {
    const index = models.findIndex((model) => String(model?.id) === String(artifact?.sourceId));
    if (index < 0) throw new Error("The SysML model no longer exists.");
    if (action.operation === "delete") models.splice(index, 1);
    else if (action.operation === "update") models[index] = applyPatch(models[index], action);
  } else {
    const [modelId, elementId] = String(artifact?.sourceId || "").split(":");
    const model = models.find((item) => String(item?.id) === modelId);
    const index = model?.elements?.findIndex((element) => String(element?.id) === elementId) ?? -1;
    if (!model || index < 0) throw new Error("The SysML element no longer exists.");
    if (action.operation === "delete") model.elements.splice(index, 1);
    else if (action.operation === "update") model.elements[index] = applyPatch(model.elements[index], action);
  }
  localStorage.setItem(SYSML_KEY, JSON.stringify(models));
  window.dispatchEvent?.(new CustomEvent("xhandle:sysml-v2-updated"));
  return { domain: "sysml", projectId: artifact?.projectId, before, after: clone(models) };
}

async function applyReviewAction(action, artifact) {
  const rows = await loadReviewItems();
  const before = clone(rows);
  const id = artifact?.sourceId || artifact?.structuredData?.id;
  const index = rows.findIndex((row) => String(row?.id) === String(id));
  if (action.operation === "create") rows.push(clone(action.record));
  else if (index < 0) throw new Error("The review item no longer exists.");
  else if (action.operation === "delete") rows.splice(index, 1);
  else if (action.operation === "update") rows[index] = applyPatch(rows[index], action);
  await saveReviewItems(rows);
  return { domain: "review", projectId: artifact?.projectId, before, after: clone(rows) };
}

async function applySafetyCaseAction(action, artifact) {
  const type = action.operation === "create" ? (action.target.type || artifact?.type) : (artifact?.type || action.target.type);
  if (type === "safety_case") {
    if (action.operation === "create") {
      const created = await createSafetyCase({ projectId: action.target.projectId || action.record?.projectId, name: action.record?.name || action.record?.title });
      return { domain: "safety-case", projectId: created.projectId, before: null, after: created };
    }
    const existing = await loadSafetyCase(artifact?.sourceId, artifact?.projectId);
    if (!existing) throw new Error("The safety case no longer exists.");
    if (action.operation !== "update") throw new Error("Safety-case deletion requires the Safety Case view.");
    const after = applyPatch(existing, action);
    await saveSafetyCase(after);
    return { domain: "safety-case", projectId: artifact?.projectId, before: existing, after };
  }
  const [caseId, nodeId] = String(artifact?.sourceId || "").split(":");
  const safetyCase = await loadSafetyCase(caseId, artifact?.projectId);
  const before = clone(safetyCase);
  const index = safetyCase?.nodes?.findIndex((node) => String(node?.id) === nodeId) ?? -1;
  if (!safetyCase) throw new Error("The safety case no longer exists.");
  if (action.operation === "create") safetyCase.nodes.push({ ...clone(action.record), id: action.record?.id || `scn-${Date.now()}` });
  else if (index < 0) throw new Error("The safety-case node no longer exists.");
  else if (action.operation === "delete") safetyCase.nodes.splice(index, 1);
  else if (action.operation === "update") safetyCase.nodes[index] = applyPatch(safetyCase.nodes[index], action);
  else throw new Error(`Operation ${action.operation} is not supported for safety-case nodes.`);
  safetyCase.edges = (safetyCase.edges || []).filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
  await saveSafetyCase(safetyCase);
  return { domain: "safety-case", projectId: artifact?.projectId, before, after: clone(safetyCase) };
}

async function applyProjectAction(action, artifact) {
  const projects = parseJson(localStorage.getItem(PROJECTS_KEY), []);
  const before = clone(projects);
  if (action.operation === "create") projects.push({ ...action.record, id: action.record?.id || `project-${Date.now()}`, name: action.record?.name || "Untitled project" });
  else {
    const id = artifact?.sourceId || artifact?.projectId;
    const index = projects.findIndex((project) => String(project?.id) === String(id));
    if (index < 0) throw new Error("The project no longer exists.");
    if (action.operation === "delete") throw new Error("Project deletion must be completed from the Projects menu so dependent artifacts can be reviewed.");
    if (action.operation === "update") projects[index] = applyPatch(projects[index], action);
  }
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  return { domain: "projects", projectId: artifact?.projectId, before, after: clone(projects) };
}

function parseIndexedSource(sourceStore = "") {
  const match = String(sourceStore || "").match(/^indexedDB:([^/]+)\/(.+)$/i);
  return match ? { dbName: match[1], storeName: match[2] } : null;
}

async function applyGenericIndexedAction(action, artifact) {
  const source = parseIndexedSource(artifact?.sourceStore);
  if (!source || typeof indexedDB === "undefined") throw new Error("This artifact does not expose a governed writable source.");
  if (["source_file", "repository"].includes(artifact?.type)) {
    throw new Error("Repository source and indexed source-file content must be changed in the connected repository, not in xHandle's search index.");
  }
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(source.dbName);
    request.onerror = () => reject(request.error || new Error("Unable to open the artifact source."));
    request.onsuccess = () => resolve(request.result);
  });
  if (!db.objectStoreNames.contains(source.storeName)) {
    db.close();
    throw new Error("The artifact source store is unavailable.");
  }
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(source.storeName, "readonly");
    const request = tx.objectStore(source.storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("Unable to read the artifact source."));
  });
  const sourceId = String(artifact?.sourceId || "");
  const index = rows.findIndex((row) => String(row?.id ?? row?.key ?? "") === sourceId);
  if (index < 0) {
    db.close();
    throw new Error("The source record no longer exists. Refresh and try again.");
  }
  const before = clone(rows[index]);
  const storeInfo = db.transaction(source.storeName, "readonly").objectStore(source.storeName);
  const keyPath = storeInfo.keyPath;
  const primaryKey = typeof keyPath === "string" ? before?.[keyPath] : (before?.id ?? before?.key ?? sourceId);
  const after = action.operation === "update" ? applyPatch(before, action) : null;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(source.storeName, "readwrite");
    const store = tx.objectStore(source.storeName);
    if (action.operation === "delete") store.delete(primaryKey);
    else if (action.operation === "update") store.put(after);
    else {
      reject(new Error(`Operation ${action.operation} is not supported for this stored artifact.`));
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Unable to persist the artifact change."));
    tx.onabort = () => reject(tx.error || new Error("The artifact change was aborted."));
  });
  db.close();
  return { domain: "generic-indexed-artifact", projectId: artifact?.projectId, sourceStore: artifact?.sourceStore, primaryKey, before, after };
}

async function restoreGenericIndexedSnapshot(snapshot) {
  const source = parseIndexedSource(snapshot?.sourceStore);
  if (!source || !snapshot?.before) return;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(source.dbName);
    request.onerror = () => reject(request.error || new Error("Unable to open the artifact source for undo."));
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(source.storeName, "readwrite");
    tx.objectStore(source.storeName).put(snapshot.before);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Unable to restore the artifact source."));
  });
  db.close();
}

async function applyOne(action) {
  const artifact = action.target.artifactId ? await getArtifact(action.target.artifactId) : null;
  const type = action.operation === "create" ? (action.target.type || artifact?.type) : (artifact?.type || action.target.type);
  if (!artifact && action.operation !== "create") throw new Error("The selected source artifact is no longer available. Refresh and try again.");
  if (type === "functional_decomposition_row") return applyFunctionalAction(action, artifact);
  if (type === "hazard_analysis_row") return applyHazardAction(action, artifact);
  if (["risk", "safety_issue", "safety_finding"].includes(type)) return applyRiskAction(action, artifact);
  if (type === "requirement") return applyRequirementAction(action, artifact);
  if (type === "code_architecture_edge") return applyCodeArchitectureAction(action, artifact);
  if (["safety_issue_report", "report"].includes(type)) return applySafetyReportAction(action, artifact);
  if (["sysml_model", "sysml_element"].includes(type)) return applySysmlAction(action, artifact);
  if (type === "review_item") return applyReviewAction(action, artifact);
  if (["safety_case", "safety_case_node"].includes(type)) return applySafetyCaseAction(action, artifact);
  if (type === "project") return applyProjectAction(action, artifact);
  if (artifact?.sourceStore?.startsWith("indexedDB:")) return applyGenericIndexedAction(action, artifact);
  throw new Error(`Collaborator does not yet have a governed write adapter for ${type || "this artifact type"}.`);
}

export async function executeWorkspaceActionPlan(plan) {
  if (!plan?.actions?.length) throw new Error("There are no workspace actions to apply.");
  const applied = [];
  try {
    for (const action of plan.actions) {
      const snapshot = await applyOne(action);
      applied.push({ action, snapshot });
    }
  } catch (error) {
    for (const item of [...applied].reverse()) {
      try { await restoreSnapshot(item.snapshot); } catch {}
    }
    await migrateLegacyStorageToWorkspaceGraphIfStale({ force: true, mode: "full" });
    emitChanged({ source: "collaborator-rollback", projectIds: [...new Set(applied.map((item) => item.snapshot.projectId).filter(Boolean))] });
    throw new Error(`${error?.message || "The workspace action failed."} The action plan was rolled back; no partial plan was retained.`);
  }
  for (const { action, snapshot } of applied) {
    try {
      await recordChange({
        projectId: snapshot.projectId,
        entityType: action.target.type || "workspace_artifact",
        entityId: action.target.artifactId || action.id,
        action: action.operation,
        detail: { source: "collaborator", summary: plan.summary, field: action.field || null },
      });
    } catch (error) {
      console.warn("[collaborator-workspace] Change log write failed after the source update.", error);
    }
  }
  const undoEntry = { id: `workspace-undo-${Date.now()}`, at: new Date().toISOString(), summary: plan.summary, applied };
  pushUndo(undoEntry);
  for (const item of applied) {
    const sourceStoreByDomain = {
      "functional-decomposition": "localStorage:xhandle.projectData",
      "hazard-analysis": "indexedDB:xhandle-project-hazard-analysis/analyses",
      "risk-register": "indexedDB:xhandle-project-hazard-analysis/analyses",
      requirements: "localStorage:xhandle:requirements",
      "code-architecture": "indexedDB:xhandle/copilot_baseline",
      "safety-report": "indexedDB:xhandle-project-reports/safetyIssueReports",
      sysml: "localStorage:xhandle.designManagement.sysmlV2.models",
      review: "indexedDB:xhandle-results-review/reviewItems",
      "safety-case": "indexedDB:TraceabilityDB/SafetyCases",
      projects: "localStorage:xhandle.projects",
      "generic-indexed-artifact": item.snapshot.sourceStore,
    };
    const sourceStore = sourceStoreByDomain[item.snapshot.domain];
    if (sourceStore) await deleteArtifacts({ projectId: item.snapshot.projectId, sourceStore });
  }
  await migrateLegacyStorageToWorkspaceGraphIfStale({ force: true, mode: "full" });
  emitChanged({ source: "collaborator", projectIds: [...new Set(applied.map((item) => item.snapshot.projectId).filter(Boolean))], domains: [...new Set(applied.map((item) => item.snapshot.domain))] });
  return {
    ok: true,
    actionCount: applied.length,
    summary: plan.summary || `Applied ${applied.length} workspace change${applied.length === 1 ? "" : "s"}.`,
    undoId: undoEntry.id,
    projectIds: [...new Set(applied.map((item) => item.snapshot.projectId).filter(Boolean))],
    domains: [...new Set(applied.map((item) => item.snapshot.domain))],
  };
}

async function restoreSnapshot(snapshot) {
  const { domain, projectId, before, sourceKey } = snapshot;
  if (domain === "functional-decomposition") {
    const map = readProjectMap(); const data = { ...(map[projectId] || {}), responseRows: clone(before), _updatedAt: new Date().toISOString() }; map[projectId] = data; writeProjectMap(map);
  } else if (["hazard-analysis", "risk-register"].includes(domain)) {
    await saveProjectHazardAnalysisRecord(projectId, before || {});
  } else if (domain === "requirements") saveRequirements(before || [], { source: "collaborator-undo" });
  else if (domain === "code-architecture") await writeCbaRowsToIndexedDB(sourceKey, before || []);
  else if (domain === "safety-report") await saveSafetyIssueReportRecord(projectId, before?.markdown || "");
  else if (domain === "sysml") localStorage.setItem(SYSML_KEY, JSON.stringify(before || []));
  else if (domain === "review") await saveReviewItems(before || []);
  else if (domain === "safety-case") {
    if (before) await saveSafetyCase(before);
    else if (snapshot.after?.id) await deleteSafetyCase(snapshot.after.id, projectId);
  }
  else if (domain === "projects") localStorage.setItem(PROJECTS_KEY, JSON.stringify(before || []));
  else if (domain === "generic-indexed-artifact") await restoreGenericIndexedSnapshot(snapshot);
}

export async function undoLastWorkspaceAction() {
  const entry = popUndo();
  if (!entry) return { ok: false, message: "There is no Collaborator workspace change to undo." };
  for (const item of [...(entry.applied || [])].reverse()) await restoreSnapshot(item.snapshot);
  for (const item of entry.applied || []) {
    const sourceStoreByDomain = {
      "functional-decomposition": "localStorage:xhandle.projectData",
      "hazard-analysis": "indexedDB:xhandle-project-hazard-analysis/analyses",
      "risk-register": "indexedDB:xhandle-project-hazard-analysis/analyses",
      requirements: "localStorage:xhandle:requirements",
      "code-architecture": "indexedDB:xhandle/copilot_baseline",
      "safety-report": "indexedDB:xhandle-project-reports/safetyIssueReports",
      sysml: "localStorage:xhandle.designManagement.sysmlV2.models",
      review: "indexedDB:xhandle-results-review/reviewItems",
      "safety-case": "indexedDB:TraceabilityDB/SafetyCases",
      projects: "localStorage:xhandle.projects",
      "generic-indexed-artifact": item.snapshot.sourceStore,
    };
    const sourceStore = sourceStoreByDomain[item.snapshot.domain];
    if (sourceStore) await deleteArtifacts({ projectId: item.snapshot.projectId, sourceStore });
  }
  await migrateLegacyStorageToWorkspaceGraphIfStale({ force: true, mode: "full" });
  emitChanged({ source: "collaborator-undo", projectIds: [...new Set((entry.applied || []).map((item) => item.snapshot.projectId).filter(Boolean))] });
  return { ok: true, summary: `Undid: ${entry.summary || "the last Collaborator workspace change"}` };
}

export function getWorkspaceUndoDepth() {
  return parseJson(localStorage.getItem(UNDO_KEY), []).length;
}
