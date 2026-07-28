import { storageKeyFor, cellText, makeId } from "../code-architecture-assurance/artifactUtils";

export const CROSS_REPO_ARCHITECTURE_KIND = "cross-repo-architecture";
export const CROSS_REPO_REVIEW_STATUSES = ["Proposed", "Accepted", "Rejected", "Needs Review"];
export const CROSS_REPO_CONFIDENCE_VALUES = ["High", "Medium", "Low"];

export const CROSS_REPO_COLUMNS = [
  { key: "systemFunction", label: "System Function", width: 260 },
  { key: "sourceRepo", label: "Source Repo", width: 220 },
  { key: "sourceProjectId", label: "Source Project ID", width: 220 },
  { key: "sourceFunction", label: "Source Function", width: 240 },
  { key: "sourceDecompositionRowId", label: "Source Decomposition Row ID", width: 240 },
  { key: "sourceCSCI", label: "Source CSCI", width: 180 },
  { key: "sourceCSC", label: "Source CSC", width: 180 },
  { key: "sourceCSU", label: "Source CSU", width: 180 },
  { key: "interfaceType", label: "Interface Type", width: 180 },
  { key: "interfaceName", label: "Interface Name", width: 240 },
  { key: "dataControlFlow", label: "Data / Control Flow", width: 320 },
  { key: "targetRepo", label: "Target Repo", width: 220 },
  { key: "targetProjectId", label: "Target Project ID", width: 220 },
  { key: "targetFunction", label: "Target Function", width: 240 },
  { key: "targetDecompositionRowId", label: "Target Decomposition Row ID", width: 240 },
  { key: "targetCSCI", label: "Target CSCI", width: 180 },
  { key: "targetCSC", label: "Target CSC", width: 180 },
  { key: "targetCSU", label: "Target CSU", width: 180 },
  { key: "evidence", label: "Evidence", width: 420 },
  { key: "confidence", label: "Confidence", width: 140 },
  { key: "reviewStatus", label: "Review Status", width: 160 },
  { key: "notes", label: "Notes", width: 320 },
];

export function crossRepoStorageKey(folderId) {
  return storageKeyFor(CROSS_REPO_ARCHITECTURE_KIND, folderId, "folder");
}

export function crossRepoGeneratedMetaKey(folderId) {
  return `xhandle:cba-cross-repo-architecture-meta:${folderId || "no-folder"}`;
}

export function getCrossRepoGeneratedMeta(folderId) {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(crossRepoGeneratedMetaKey(folderId)) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCrossRepoGeneratedMeta(folderId, meta = {}) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(crossRepoGeneratedMetaKey(folderId), JSON.stringify({
      folderId,
      generatedAt: meta.generatedAt || new Date().toISOString(),
      rowCount: Number(meta.rowCount || 0),
      repoCount: Number(meta.repoCount || 0),
      projectCount: Number(meta.projectCount || 0),
    }));
  } catch {}
}

function cleanEnum(value, allowed, fallback) {
  const text = cellText(value);
  return allowed.find((item) => item.toLowerCase() === text.toLowerCase()) || fallback;
}

function rowId(row = {}, index = 0) {
  return cellText(row.id) || `XRA-${String(index + 1).padStart(3, "0")}`;
}

export function normalizeCrossRepoRow(row = {}, index = 0) {
  const now = new Date().toISOString();
  const sourceRowIndex = Number(row.sourceRowIndex);
  const targetRowIndex = Number(row.targetRowIndex);
  return {
    id: rowId(row, index),
    internalId: row.internalId || makeId("xra"),
    artifactType: "code_architecture_cross_repo_link",
    systemFunction: cellText(row.systemFunction),
    sourceRepo: cellText(row.sourceRepo),
    sourceProjectId: cellText(row.sourceProjectId),
    sourceRepoId: cellText(row.sourceRepoId),
    sourceFunction: cellText(row.sourceFunction),
    sourceDecompositionRowId: cellText(row.sourceDecompositionRowId),
    sourceRowIndex: Number.isFinite(sourceRowIndex) ? sourceRowIndex : null,
    sourceTraceId: cellText(row.sourceTraceId),
    sourceCSCI: cellText(row.sourceCSCI),
    sourceCSC: cellText(row.sourceCSC),
    sourceCSU: cellText(row.sourceCSU),
    interfaceType: cellText(row.interfaceType) || "Data Flow",
    interfaceName: cellText(row.interfaceName),
    dataControlFlow: cellText(row.dataControlFlow),
    targetRepo: cellText(row.targetRepo),
    targetProjectId: cellText(row.targetProjectId),
    targetRepoId: cellText(row.targetRepoId),
    targetFunction: cellText(row.targetFunction),
    targetDecompositionRowId: cellText(row.targetDecompositionRowId),
    targetRowIndex: Number.isFinite(targetRowIndex) ? targetRowIndex : null,
    targetTraceId: cellText(row.targetTraceId),
    targetCSCI: cellText(row.targetCSCI),
    targetCSC: cellText(row.targetCSC),
    targetCSU: cellText(row.targetCSU),
    evidence: cellText(row.evidence),
    confidence: cleanEnum(row.confidence, CROSS_REPO_CONFIDENCE_VALUES, "Medium"),
    reviewStatus: cleanEnum(row.reviewStatus, CROSS_REPO_REVIEW_STATUSES, "Proposed"),
    notes: cellText(row.notes),
    traceLinks: Array.isArray(row.traceLinks) ? row.traceLinks : [],
    createdAt: row.createdAt || now,
    updatedAt: row.updatedAt || now,
  };
}

export function getCbaFolderDescendantIds(folders = [], rootFolderId = "") {
  if (!rootFolderId) return new Set();
  const ids = new Set([rootFolderId]);
  const queue = [rootFolderId];
  const list = Array.isArray(folders) ? folders : [];
  while (queue.length) {
    const parentId = queue.shift();
    list.forEach((folder) => {
      if (folder?.parentId !== parentId || ids.has(folder.id)) return;
      ids.add(folder.id);
      queue.push(folder.id);
    });
  }
  return ids;
}

export function getCbaProjectsInFolderTree(projects = [], folders = [], folderId = "") {
  const folderIds = getCbaFolderDescendantIds(folders, folderId);
  return (Array.isArray(projects) ? projects : []).filter((project) => folderIds.has(project.folderId || null));
}

function compactRow(row = {}, index = 0) {
  return {
    rowIndex: Number.isFinite(Number(row.rowIndex)) ? Number(row.rowIndex) : index,
    rowRef: cellText(row.rowRef || index + 1),
    traceId: cellText(row.traceId),
    from: cellText(row.from || row.fromFunction),
    action: cellText(row.action || row.controlAction),
    to: cellText(row.to || row.toFunction),
    fromFile: cellText(row.fromFile),
    toFile: cellText(row.toFile),
    subsystem: cellText(row.architecture?.subsystem),
    csci: cellText(row.architecture?.csci),
    csc: cellText(row.architecture?.csc),
    csu: cellText(row.architecture?.csu),
  };
}

export function compactFunctionalRowsForCrossRepoPrompt(project = {}, repo = {}, rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const maxRows = 80;
  const indexedRows = safeRows.map((row, index) => ({ ...row, rowIndex: index }));
  const sampledRows = indexedRows.length > maxRows
    ? [
      ...indexedRows.slice(0, 35),
      ...indexedRows.slice(Math.max(35, Math.floor(indexedRows.length / 2) - 15), Math.floor(indexedRows.length / 2) + 15),
      ...indexedRows.slice(-15),
    ]
    : indexedRows;
  return {
    projectId: project.id || "",
    projectName: project.name || "",
    repoId: repo.id || repo.repoId || "",
    repoName: repo.repoName || repo.repoId || [repo.owner, repo.repo].filter(Boolean).join("/"),
    owner: repo.owner || "",
    repo: repo.repo || "",
    branch: repo.branch || "",
    commitSha: repo.commitSha || "",
    rowCount: safeRows.length,
    rows: sampledRows.map(compactRow),
  };
}

export function buildTraceLinksForCrossRepoRow(row = {}) {
  const links = [];
  if (row.sourceProjectId || row.sourceRepoId || row.sourceDecompositionRowId) {
    links.push({
      type: "source-functional-row",
      projectId: row.sourceProjectId,
      repoId: row.sourceRepoId,
      rowIndex: row.sourceRowIndex,
      rowRef: row.sourceDecompositionRowId,
      traceId: row.sourceTraceId || row.sourceDecompositionRowId,
    });
  }
  if (row.targetProjectId || row.targetRepoId || row.targetDecompositionRowId) {
    links.push({
      type: "target-functional-row",
      projectId: row.targetProjectId,
      repoId: row.targetRepoId,
      rowIndex: row.targetRowIndex,
      rowRef: row.targetDecompositionRowId,
      traceId: row.targetTraceId || row.targetDecompositionRowId,
    });
  }
  return links;
}
