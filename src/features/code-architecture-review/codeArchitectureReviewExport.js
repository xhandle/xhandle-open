import { ARTIFACT_KINDS } from "../code-architecture-assurance/artifactDefinitions";
import { loadArtifactRowsAsync, storageKeyFor } from "../code-architecture-assurance/artifactUtils";
import {
  CROSS_REPO_ARCHITECTURE_KIND,
  getCbaProjectsInFolderTree,
  getCrossRepoGeneratedMeta,
  normalizeCrossRepoRow,
} from "../code-architecture-cross-repo/crossRepoArchitectureUtils";
import { getLatestCodeArchitectureHazardRun } from "../code-architecture-hazard-analysis/codeArchitectureHazardStore";
import { safetyRemediationStore } from "../safety-remediation/safetyRemediationStore";
import {
  XHANDLE_IDB_NAME,
  codeArchitectureMetaKey,
  codeArchitectureRowsKey,
  readCbaRowsFromIndexedDB,
} from "../code-architecture-assurance/codeArchitectureStorage";
import {
  codeArchitectureReviewPackageStartBody,
  codeArchitectureReviewPackagingTarget,
  reviewPackagerRequestHeaders,
} from "./reviewPackagerConfig";
export {
  codeArchitectureReviewPackagingTarget,
  configuredReviewPackagerUrl,
  isHostedCodeArchitectureReviewPackagerConfigured,
} from "./reviewPackagerConfig";

export const CODE_ARCHITECTURE_REVIEW_PACKAGE_SCHEMA_VERSION = 1;
export const CODE_ARCHITECTURE_REVIEW_PACKAGE_TYPE = "code-based-architecture-review-package";
export const REVIEW_ANALYSIS_SECTIONS = {
  HAZARD: "hazard-remediation",
  SOFTWARE: ARTIFACT_KINDS.SOFTWARE,
  SYSTEM: ARTIFACT_KINDS.SYSTEM,
  SUBSYSTEM: ARTIFACT_KINDS.SUBSYSTEM,
  DESIGN: ARTIFACT_KINDS.DESIGN,
  TRACEABILITY: "traceability-matrix",
};
const DIAGRAM_POSITIONS_STORE = "diagram_positions";

const CROSS_REPO_ARTIFACT_LOADS = [
  ["softwareRequirements", ARTIFACT_KINDS.SOFTWARE],
  ["systemRequirements", ARTIFACT_KINDS.SYSTEM],
  ["subsystemRequirements", ARTIFACT_KINDS.SUBSYSTEM],
  ["designElements", ARTIFACT_KINDS.DESIGN],
];

function appendParts(parts) {
  return parts.filter((part) => String(part || "").trim()).join(" | ");
}

function repoDisplayName(project, repo) {
  return repo?.repoName || repo?.repoId || [repo?.owner, repo?.repo].filter(Boolean).join("/") || project?.name || "Repository";
}

function safeNodePart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_.:-]+/g, "-");
}

function crossRepoEndpointNodeId(repoName, functionLabel) {
  return `cross-repo:${safeNodePart(repoName)}:${safeNodePart(functionLabel)}`;
}

function repoScopedRowRef(repo, row, rowIndex) {
  const repoKey = safeNodePart(repo?.id || repo?.repoId || repo?.repoName || "repo");
  const originalRef = row?.rowRef || row?.traceId || rowIndex + 1;
  return `${repoKey}:ROW-${safeNodePart(originalRef)}`;
}

function withDisplayRowEvidence(row, displayRowRef) {
  const fallbackFiles = [row?.fromFile, row?.toFile].filter(Boolean);
  return {
    ...(row?.codeEvidence || {}),
    rowRefs: [displayRowRef],
    files: row?.codeEvidence?.files || Array.from(new Set(fallbackFiles)),
  };
}

function repoComponentRow({ project, repo, functionName = "", rowRef = "", index = 0 }) {
  const repoName = repoDisplayName(project, repo);
  const label = functionName || repoName;
  return {
    from: label,
    fromFile: repoName,
    fromDetails: appendParts([
      "Repository component boundary",
      project?.name ? `Project ${project.name}` : "",
      repo?.branch ? `Branch ${repo.branch}` : "",
    ]),
    action: "",
    controlActionDetails: "",
    to: "",
    toFile: "",
    toDetails: "",
    architecture: {
      subsystem: repoName,
      csci: "Subsystems",
      csc: "Repository Boundary",
      csu: label,
      rationale: "Folder-level cross-repo architecture component boundary.",
    },
    rowRef: rowRef || `COMP-${String(index + 1).padStart(3, "0")}`,
    traceId: `cross-repo-component:${repo?.id || repo?.repoId || repoName}:${label}`,
    fromNodeId: crossRepoEndpointNodeId(repoName, label),
    edgeId: "",
    toNodeId: "",
    crossRepoComponent: { projectId: project?.id || "", repoId: repo?.id || "", repoName },
  };
}

function crossRepoRowToFunctionalRow(row, index, traceRefs = {}) {
  const sourceRepo = row.sourceRepo || row.sourceRepoId || "Source Repo";
  const targetRepo = row.targetRepo || row.targetRepoId || "Target Repo";
  const sourceFunction = row.sourceFunction || row.sourceDecompositionRowId || "Source Function";
  const targetFunction = row.targetFunction || row.targetDecompositionRowId || "Target Function";
  const sourceLabel = `${sourceRepo}: ${sourceFunction}`;
  const targetLabel = `${targetRepo}: ${targetFunction}`;
  const interfaceName = row.interfaceName || row.interfaceType || row.dataControlFlow || "Cross-Repo Interface";
  const sourceArchitecture = {
    subsystem: sourceRepo,
    csci: row.sourceSubsystem || row.sourceSystemFunction || "Application Subsystem",
    csc: row.sourceCsci || "Application Software",
    csu: row.sourceCsc || row.sourceCsu || sourceFunction,
    rationale: row.evidence || row.notes || "",
  };
  const targetArchitecture = {
    subsystem: targetRepo,
    csci: row.targetSubsystem || row.targetSystemFunction || "Application Subsystem",
    csc: row.targetCsci || "Application Software",
    csu: row.targetCsc || row.targetCsu || targetFunction,
    rationale: row.evidence || row.notes || "",
  };
  const sourceRef = appendParts([
    row.sourceDecompositionRowId ? `row ${row.sourceDecompositionRowId}` : "",
    row.sourceProjectId ? `project ${row.sourceProjectId}` : "",
  ]);
  const targetRef = appendParts([
    row.targetDecompositionRowId ? `row ${row.targetDecompositionRowId}` : "",
    row.targetProjectId ? `project ${row.targetProjectId}` : "",
  ]);
  const displayRowRef = row.id || `XREPO-${String(index + 1).padStart(3, "0")}`;
  return {
    from: sourceLabel,
    fromFile: sourceRepo,
    fromDetails: appendParts([
      row.sourceFunction,
      sourceRef,
      row.sourceCsci ? `CSCI ${row.sourceCsci}` : "",
      row.sourceCsc ? `CSC ${row.sourceCsc}` : "",
      row.sourceCsu ? `CSU ${row.sourceCsu}` : "",
    ]),
    action: interfaceName,
    controlActionDetails: appendParts([
      row.dataControlFlow,
      row.interfaceType ? `Interface type: ${row.interfaceType}` : "",
      row.confidence ? `Confidence: ${row.confidence}` : "",
      row.reviewStatus ? `Review: ${row.reviewStatus}` : "",
      row.evidence ? `Evidence: ${row.evidence}` : "",
      row.notes ? `Notes: ${row.notes}` : "",
    ]),
    to: targetLabel,
    toFile: targetRepo,
    toDetails: appendParts([
      row.targetFunction,
      targetRef,
      row.targetCsci ? `CSCI ${row.targetCsci}` : "",
      row.targetCsc ? `CSC ${row.targetCsc}` : "",
      row.targetCsu ? `CSU ${row.targetCsu}` : "",
    ]),
    architecture: {
      subsystem: row.systemFunction || "Cross-Repo Functional Architecture",
      csci: row.interfaceType || "System Interface",
      csc: row.dataControlFlow || row.interfaceName || "Cross-Repo Flow",
      csu: interfaceName,
      rationale: row.evidence || row.notes || "",
    },
    fromArchitecture: sourceArchitecture,
    toArchitecture: targetArchitecture,
    rowRef: displayRowRef,
    traceId: row.internalId || row.id || `cross-repo-${index + 1}`,
    codeEvidence: {
      rowRefs: Array.from(new Set([
        displayRowRef,
        traceRefs.sourceDisplayRowRef,
        traceRefs.targetDisplayRowRef,
      ].filter(Boolean))),
      files: [sourceRepo, targetRepo].filter(Boolean),
      sourceFunctions: [
        { functionName: sourceFunction, filePath: sourceRepo },
        { functionName: interfaceName, filePath: appendParts([sourceRepo, targetRepo]) },
        { functionName: targetFunction, filePath: targetRepo },
      ].filter((fn) => fn.functionName),
    },
    fromNodeId: crossRepoEndpointNodeId(sourceRepo, sourceLabel),
    edgeId: row.internalId || row.id || "",
    toNodeId: crossRepoEndpointNodeId(targetRepo, targetLabel),
    crossRepoSource: row,
  };
}

function repoIdentityValues(project, repo) {
  return Array.from(new Set([
    project?.id,
    repo?.id,
    repo?.repoId,
    repo?.repoName,
    repoDisplayName(project, repo),
  ].filter(Boolean).map((value) => String(value).trim())));
}

function traceLookupKey(projectId, repoId, rowRef) {
  return [projectId, repoId, rowRef].map((value) => String(value || "").trim()).join("::");
}

function addRepoTraceLookup(lookup, project, repo, row, rowIndex, displayRowRef) {
  const projectKeys = Array.from(new Set([project?.id, ""].filter((value) => value !== undefined && value !== null).map((value) => String(value).trim())));
  const repoKeys = repoIdentityValues(project, repo);
  const rowKeys = Array.from(new Set([
    row?.rowRef,
    row?.traceId,
    rowIndex + 1,
    Number.isFinite(Number(row?.rowIndex)) ? Number(row.rowIndex) + 1 : "",
  ].filter(Boolean).map((value) => String(value).trim())));
  projectKeys.forEach((projectKey) => {
    repoKeys.forEach((repoKey) => {
      rowKeys.forEach((rowKey) => {
        lookup.set(traceLookupKey(projectKey, repoKey, rowKey), displayRowRef);
      });
    });
  });
}

function findDisplayRowRefForCrossRepoSide(lookup, row, side) {
  const prefix = side === "source" ? "source" : "target";
  const projectKeys = [row[`${prefix}ProjectId`], ""].filter((value) => value !== undefined && value !== null).map((value) => String(value).trim());
  const repoKeys = [
    row[`${prefix}RepoId`],
    row[`${prefix}Repo`],
  ].filter(Boolean).map((value) => String(value).trim());
  const rowKeys = [
    row[`${prefix}DecompositionRowId`],
    row[`${prefix}TraceId`],
    Number.isFinite(Number(row[`${prefix}RowIndex`])) ? Number(row[`${prefix}RowIndex`]) + 1 : "",
  ].filter(Boolean).map((value) => String(value).trim());
  for (const projectKey of projectKeys) {
    for (const repoKey of repoKeys) {
      for (const rowKey of rowKeys) {
        const matched = lookup.get(traceLookupKey(projectKey, repoKey, rowKey));
        if (matched) return matched;
      }
    }
  }
  return "";
}

function repoNodeId(repo, repoName, functionName, side, rowIndex) {
  const base = repo?.id || repo?.repoId || repoName;
  return `repo-row:${safeNodePart(base)}:${safeNodePart(functionName)}:${side}:${rowIndex}`;
}

function repoFunctionalRowToCrossRepoDisplayRow({ project, repo, row, rowIndex }) {
  const repoName = repoDisplayName(project, repo);
  const arch = row?.architecture || {};
  const from = row?.from || row?.fromFunction || "Source Function";
  const to = row?.to || row?.toFunction || "";
  const displayRowRef = repoScopedRowRef(repo, row, rowIndex);
  return {
    from,
    fromFile: row?.fromFile || repoName,
    fromDetails: row?.fromDetails || "",
    action: row?.action || row?.controlAction || "",
    controlActionDetails: row?.controlActionDetails || row?.controlDetails || "",
    to,
    toFile: row?.toFile || (to ? repoName : ""),
    toDetails: row?.toDetails || "",
    architecture: {
      subsystem: repoName,
      csci: arch.subsystem || "Application Subsystem",
      csc: arch.csci || "Application Software",
      csu: arch.csc || arch.csu || from,
      rationale: arch.rationale || "",
    },
    codeEvidence: withDisplayRowEvidence(row, displayRowRef),
    sourceEvidence: row?.sourceEvidence || null,
    rowRef: displayRowRef,
    traceId: `repo-functional:${safeNodePart(repo?.id || repoName)}:${row?.traceId || row?.rowRef || rowIndex + 1}`,
    fromNodeId: row?.fromNodeId
      ? `repo:${safeNodePart(repo?.id || repoName)}:${row.fromNodeId}`
      : repoNodeId(repo, repoName, from, "from", rowIndex),
    edgeId: row?.edgeId
      ? `repo:${safeNodePart(repo?.id || repoName)}:${row.edgeId}`
      : `repo-edge:${safeNodePart(repo?.id || repoName)}:${rowIndex}`,
    toNodeId: to
      ? row?.toNodeId
        ? `repo:${safeNodePart(repo?.id || repoName)}:${row.toNodeId}`
        : repoNodeId(repo, repoName, to, "to", rowIndex)
      : "",
    crossRepoRepoSource: {
      projectId: project?.id || "",
      repoId: repo?.id || "",
      rowIndex,
      rowRef: row?.rowRef || "",
      traceId: row?.traceId || "",
    },
  };
}

function buildCrossRepoFunctionalRows({ rows = [], folderProjects = [], repoFunctionalRows = [] }) {
  const byProjectId = new Map(folderProjects.map((project) => [project.id, project]));
  const byRepoId = new Map();
  folderProjects.forEach((project) => {
    (project.repos || []).forEach((repo) => {
      const repoName = repoDisplayName(project, repo);
      [repo.id, repo.repoId, repo.repoName, repoName].filter(Boolean).forEach((key) => {
        byRepoId.set(String(key), { project, repo });
      });
    });
  });

  const componentRows = [];
  const endpointMembership = new Map();
  let componentIndex = 0;

  folderProjects.forEach((project) => {
    (project.repos || []).forEach((repo) => {
      componentRows.push(repoComponentRow({ project, repo, index: componentIndex }));
      componentIndex += 1;
    });
  });

  const addEndpointMembership = (row, side) => {
    const prefix = side === "source" ? "source" : "target";
    const repoKey = row[`${prefix}RepoId`] || row[`${prefix}Repo`] || "";
    const match = byRepoId.get(String(repoKey)) || byProjectId.get(row[`${prefix}ProjectId`]);
    const project = match?.project || null;
    const repo = match?.repo || {
      id: row[`${prefix}RepoId`] || row[`${prefix}Repo`] || "",
      repoId: row[`${prefix}RepoId`] || row[`${prefix}Repo`] || "",
      repoName: row[`${prefix}Repo`] || row[`${prefix}RepoId`] || "",
    };
    const repoName = repoDisplayName(project, repo);
    const functionName = `${repoName}: ${row[`${prefix}Function`] || row[`${prefix}DecompositionRowId`] || "Repository Function"}`;
    const key = `${repoName}:${functionName}`;
    if (endpointMembership.has(key)) return;
    endpointMembership.set(key, repoComponentRow({
      project,
      repo,
      functionName,
      rowRef: `${side === "source" ? "SRC" : "TGT"}-${row.id || endpointMembership.size + 1}`,
      index: componentRows.length + endpointMembership.size,
    }));
  };

  rows.forEach((row) => {
    addEndpointMembership(row, "source");
    addEndpointMembership(row, "target");
  });

  const repoTraceLookup = new Map();
  const repoDisplayRows = repoFunctionalRows.flatMap(({ project, repo, rows: repoRows }) =>
    (repoRows || []).map((row, rowIndex) => {
      const displayRow = repoFunctionalRowToCrossRepoDisplayRow({ project, repo, row, rowIndex });
      addRepoTraceLookup(repoTraceLookup, project, repo, row, rowIndex, displayRow.rowRef);
      return displayRow;
    })
  );

  return [
    ...componentRows,
    ...repoDisplayRows,
    ...Array.from(endpointMembership.values()),
    ...rows.map((row, index) => crossRepoRowToFunctionalRow(row, index, {
      sourceDisplayRowRef: findDisplayRowRefForCrossRepoSide(repoTraceLookup, row, "source"),
      targetDisplayRowRef: findDisplayRowRefForCrossRepoSide(repoTraceLookup, row, "target"),
    })),
  ];
}

function architectureSourceLabel(refs = []) {
  return refs
    .map((ref) => {
      const trace = String(ref?.traceId || ref?.rowRef || "").trim();
      const mode = ref?.mode === "edge" ? "Interface" : ref?.mode === "to" ? "Target" : "Source";
      return trace ? `${mode} ${trace}` : mode;
    })
    .filter(Boolean)
    .join(", ");
}

function refForDisplayRow(displayRow, rowIndex, mode = "edge") {
  return {
    rowIndex,
    rowRef: displayRow.rowRef,
    traceId: displayRow.traceId || displayRow.rowRef,
    fromFunction: displayRow.from || "",
    controlAction: displayRow.action || "",
    toFunction: displayRow.to || "",
    fromNodeId: displayRow.fromNodeId || "",
    edgeId: displayRow.edgeId || "",
    toNodeId: displayRow.toNodeId || "",
    fromFile: displayRow.fromFile || "",
    toFile: displayRow.toFile || "",
    mode,
    subsystem: displayRow.architecture?.subsystem || "",
    csci: displayRow.architecture?.csci || "",
    csc: displayRow.architecture?.csc || "",
    csu: displayRow.architecture?.csu || "",
  };
}

function buildRepoTraceMap(project, repo, rows = []) {
  const map = new Map();
  rows.forEach((row, rowIndex) => {
    const displayRow = repoFunctionalRowToCrossRepoDisplayRow({ project, repo, row, rowIndex });
    const ref = refForDisplayRow(displayRow, rowIndex, "edge");
    [row?.traceId, row?.rowRef, rowIndex + 1].filter(Boolean).forEach((key) => {
      map.set(String(key).trim(), ref);
    });
  });
  return map;
}

function remapArchitectureRef(ref = {}, traceMap) {
  const match = [ref.traceId, ref.rowRef, Number.isFinite(Number(ref.rowIndex)) ? Number(ref.rowIndex) + 1 : ""]
    .map((value) => String(value || "").trim())
    .find((value) => value && traceMap.has(value));
  return match ? { ...traceMap.get(match), mode: ref.mode || traceMap.get(match).mode || "edge" } : ref;
}

function remapSourceIds(value, traceMap) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => traceMap.get(item)?.rowRef || item)
    .join(", ");
}

function remapArtifactRows(rows = [], kind, traceMap) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const sourceArchitectureRefs = Array.isArray(row.sourceArchitectureRefs)
      ? row.sourceArchitectureRefs.map((ref) => remapArchitectureRef(ref, traceMap))
      : [];
    if (kind !== ARTIFACT_KINDS.SOFTWARE) {
      return {
        ...row,
        sourceArchitectureRefs,
        architectureSource: sourceArchitectureRefs.length ? architectureSourceLabel(sourceArchitectureRefs) : row.architectureSource,
      };
    }
    const remappedSourceTraceId = remapSourceIds(row.sourceTraceId || row.sourceFunctionalRow || row.architectureRowRef, traceMap);
    return {
      ...row,
      sourceTraceId: remappedSourceTraceId || row.sourceTraceId,
      sourceFunctionalRow: remappedSourceTraceId || row.sourceFunctionalRow,
      architectureRowRef: remappedSourceTraceId || row.architectureRowRef,
      sourceArchitectureRefs,
      architectureSource: sourceArchitectureRefs.length ? architectureSourceLabel(sourceArchitectureRefs) : row.architectureSource,
    };
  });
}

function emptyRepoAssuranceArtifacts() {
  return {
    softwareRequirements: [],
    systemRequirements: [],
    subsystemRequirements: [],
    designElements: [],
  };
}

function safeJsonParse(raw, fallback = null) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function readLocalStorageJson(key, fallback = null) {
  if (typeof localStorage === "undefined" || !key) return fallback;
  return safeJsonParse(localStorage.getItem(key), fallback);
}

function readLocalStorageValue(key, fallback = null) {
  if (typeof localStorage === "undefined" || !key) return fallback;
  const value = localStorage.getItem(key);
  return value == null ? fallback : value;
}

function openDb(name) {
  if (typeof indexedDB === "undefined" || !name) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(name);
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
}

async function readIndexedDbRecord(database, storeName, key) {
  const db = await openDb(database);
  if (!db || !storeName || !key || !db.objectStoreNames.contains(storeName)) {
    try { db?.close?.(); } catch {}
    return null;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).get(key);
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result || null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      try { db.close(); } catch {}
      resolve(null);
    };
  });
}

function diagramStorageKey(repo = {}) {
  const repoId = repo.repoId || repo.repoName || repo.id || "repo";
  const branch = repo.branch || "main";
  return `diagram:github:${repoId}:${branch}`;
}

function tableUiStateFor(storageKey) {
  return {
    hiddenColumns: readLocalStorageJson(`${storageKey}:hidden-columns`, []),
    columnWidths: readLocalStorageJson(`${storageKey}:column-widths`, {}),
  };
}

function sanitizeRepo(repo = {}) {
  const { token, accessToken, authToken, password, ...safeRepo } = repo || {};
  return safeRepo;
}

function uniqueStrings(values) {
  return Array.from(new Set(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function repoIdentityCandidates(repo = {}) {
  return uniqueStrings([
    repo.id,
    repo.repoId,
    repo.repoName,
    [repo.owner, repo.repo].filter(Boolean).join("/"),
  ]);
}

async function loadBestArtifactRows(kind, projectId, repoIds) {
  let bestRows = [];
  for (const repoId of repoIds) {
    const rows = await loadArtifactRowsAsync(kind, projectId, repoId);
    if (Array.isArray(rows) && rows.length > bestRows.length) {
      bestRows = rows;
    }
  }
  return bestRows;
}

async function loadAssuranceArtifacts(projectId, repo, includeMap) {
  const repoIds = repoIdentityCandidates(repo);
  const shouldIncludeArtifactKind = (kind) => (
    !includeMap ||
    includeMap[kind] ||
    includeMap[REVIEW_ANALYSIS_SECTIONS.TRACEABILITY]
  );
  const artifactEntries = await Promise.all(
    [
      ARTIFACT_KINDS.SOFTWARE,
      ARTIFACT_KINDS.SYSTEM,
      ARTIFACT_KINDS.SUBSYSTEM,
      ARTIFACT_KINDS.DESIGN,
    ].map(async (kind) => [
      kind,
      shouldIncludeArtifactKind(kind) ? await loadBestArtifactRows(kind, projectId, repoIds) : [],
    ])
  );
  return Object.fromEntries(artifactEntries);
}

function idSet(values) {
  return new Set(uniqueStrings(values));
}

function recordMatchesScope(record, { projectId, repoIds }) {
  if (!record) return false;
  const recordProjectId = String(record.projectId || "").trim();
  const recordRepoId = String(record.repoId || record.repoName || "").trim();
  if (projectId && recordProjectId && recordProjectId !== String(projectId)) return false;
  if (repoIds.size && recordRepoId && !repoIds.has(recordRepoId)) return false;
  return true;
}

async function loadSafetyRemediationContext({ projectId, repo }) {
  const repoIds = idSet(repoIdentityCandidates(repo));
  const state = await safetyRemediationStore.loadAll();
  const safetyFindings = (state.safetyFindings || []).filter((finding) => (
    recordMatchesScope(finding, { projectId, repoIds })
  ));
  const findingIds = idSet(safetyFindings.map((finding) => finding.id));
  const patchProposals = (state.patchProposals || []).filter((patch) => (
    findingIds.has(patch.safetyFindingId) ||
    recordMatchesScope(patch, { projectId, repoIds })
  ));
  const patchIds = idSet(patchProposals.map((patch) => patch.id));
  const reviewDecisions = (state.reviewDecisions || []).filter((decision) => (
    findingIds.has(decision.targetId) ||
    patchIds.has(decision.targetId) ||
    recordMatchesScope(decision, { projectId, repoIds })
  ));
  const verificationRuns = (state.verificationRuns || []).filter((run) => (
    findingIds.has(run.safetyFindingId) ||
    patchIds.has(run.patchProposalId) ||
    recordMatchesScope(run, { projectId, repoIds })
  ));
  const safetyRemediationEvidence = (state.safetyRemediationEvidence || []).filter((evidence) => (
    findingIds.has(evidence.safetyFindingId) ||
    patchIds.has(evidence.patchProposalId) ||
    recordMatchesScope(evidence, { projectId, repoIds })
  ));
  const summaryArtifacts = (state.summaryArtifacts || []).filter((summary) => (
    findingIds.has(summary.safetyFindingId) ||
    patchIds.has(summary.patchProposalId) ||
    findingIds.has(summary.findingId) ||
    patchIds.has(summary.patchId) ||
    recordMatchesScope(summary, { projectId, repoIds })
  ));

  if (
    !safetyFindings.length &&
    !patchProposals.length &&
    !reviewDecisions.length &&
    !summaryArtifacts.length &&
    !verificationRuns.length &&
    !safetyRemediationEvidence.length
  ) {
    return null;
  }

  return {
    safetyFindings,
    patchProposals,
    reviewDecisions,
    summaryArtifacts,
    verificationRuns,
    safetyRemediationEvidence,
  };
}

async function buildProjectRepoPackage({ project, folder = null, repo, activeRepo = null, cbaRows = null, includedAnalysis = null }) {
  const rowsKey = codeArchitectureRowsKey(project.id, repo.id);
  const rows = repo.id === activeRepo?.id && Array.isArray(cbaRows) && cbaRows.length
    ? cbaRows
    : await readCbaRowsFromIndexedDB(rowsKey);
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const includeMap = includedAnalysis && typeof includedAnalysis === "object" ? includedAnalysis : null;
  const assuranceArtifacts = await loadAssuranceArtifacts(project.id, repo, includeMap);
  const includeSafetyRemediation = !includeMap || includeMap[REVIEW_ANALYSIS_SECTIONS.HAZARD];
  const safetyRemediation = includeSafetyRemediation
    ? await loadSafetyRemediationContext({ projectId: project.id, repo })
    : null;
  const diagramKey = diagramStorageKey(repo);
  const diagramPositions = await readIndexedDbRecord(XHANDLE_IDB_NAME, DIAGRAM_POSITIONS_STORE, diagramKey);
  const repoMetaKey = codeArchitectureMetaKey(project.id, repo.id);
  const repoMeta = readLocalStorageJson(repoMetaKey, null);
  const safeRepo = sanitizeRepo(repo);

  return {
    id: `project:${project.id}:${safeRepo.id}`,
    type: "project",
    label: `${project.name || "Code Architecture"} - ${repoDisplayName(project, safeRepo)}`,
    project: { ...project, repos: (project.repos || []).map(sanitizeRepo) },
    folder,
    repo: safeRepo,
    repoMeta,
    rows,
    diagramPositions: diagramPositions?.value || diagramPositions || null,
    assuranceArtifacts,
    safetyRemediation,
    storage: {
      cbaRows: {
        database: XHANDLE_IDB_NAME,
        store: "copilot_baseline",
        key: rowsKey,
      },
      repoMetaKey,
      diagramPositions: {
        database: XHANDLE_IDB_NAME,
        store: DIAGRAM_POSITIONS_STORE,
        key: diagramKey,
      },
      assuranceArtifacts: Object.fromEntries(
        Object.keys(assuranceArtifacts).map((kind) => [kind, storageKeyFor(kind, project.id, repo.id)])
      ),
    },
    uiState: {
      codeArchitectureFunctionalTable: tableUiStateFor(`code-architecture-functional-table:${project.id}:${repo.id}`),
      diagram: {
        storageKey: diagramKey,
      },
      assuranceTables: Object.fromEntries(
        Object.keys(assuranceArtifacts).map((kind) => [kind, tableUiStateFor(storageKeyFor(kind, project.id, repo.id))])
      ),
    },
  };
}

async function buildCrossRepoPackage({ folder, folders = [], projects = [], includedAnalysis = null }) {
  const folderId = folder?.id || "";
  if (!folderId) return null;
  const rawRows = await loadArtifactRowsAsync(CROSS_REPO_ARCHITECTURE_KIND, folderId, "folder");
  const rows = (Array.isArray(rawRows) ? rawRows : []).map(normalizeCrossRepoRow);

  const folderProjects = getCbaProjectsInFolderTree(projects, folders, folderId);
  const generatedMeta = getCrossRepoGeneratedMeta(folderId);
  if (!rows.length && !generatedMeta?.generatedAt && folderProjects.length < 2) return null;
  const repoFunctionalRows = [];
  const artifacts = emptyRepoAssuranceArtifacts();
  const includeMap = includedAnalysis && typeof includedAnalysis === "object" ? includedAnalysis : null;
  const shouldIncludeArtifactKind = (kind) => (
    !includeMap ||
    includeMap[kind] ||
    includeMap[REVIEW_ANALYSIS_SECTIONS.TRACEABILITY]
  );
  for (const project of folderProjects) {
    for (const repo of project.repos || []) {
      const repoRows = await readCbaRowsFromIndexedDB(codeArchitectureRowsKey(project.id, repo.id));
      const normalizedRepoRows = Array.isArray(repoRows) ? repoRows : [];
      repoFunctionalRows.push({ project, repo, rows: normalizedRepoRows });
      const traceMap = buildRepoTraceMap(project, repo, normalizedRepoRows);
      for (const [artifactKey, kind] of CROSS_REPO_ARTIFACT_LOADS) {
        if (!shouldIncludeArtifactKind(kind)) continue;
        const artifactRows = await loadBestArtifactRows(kind, project.id, repoIdentityCandidates(repo));
        artifacts[artifactKey].push(...remapArtifactRows(artifactRows, kind, traceMap));
      }
    }
  }

  const functionalRows = buildCrossRepoFunctionalRows({ rows, folderProjects, repoFunctionalRows });
  const virtualProject = { id: folderId, name: folder?.name || "Cross-Repo Architecture" };
  const virtualRepo = {
    id: "folder",
    repoId: "folder",
    repoName: `${folder?.name || "Folder"} Cross-Repo`,
    repoUrl: "",
    branch: "folder",
  };
  return {
    id: `cross-repo:${folderId}`,
    type: "cross-repo",
    label: `${folder?.name || "Folder"} Cross-Repo Architecture`,
    project: virtualProject,
    folder,
    repo: virtualRepo,
    repoMeta: virtualRepo,
    rows: functionalRows,
    diagramPositions: null,
    assuranceArtifacts: artifacts,
    rawCrossRepoRows: rows,
    storage: {
      cbaRows: {
        database: XHANDLE_IDB_NAME,
        store: "artifactRows",
        key: storageKeyFor(CROSS_REPO_ARCHITECTURE_KIND, folderId, "folder"),
      },
    },
    uiState: {
      codeArchitectureFunctionalTable: tableUiStateFor(`code-architecture-functional-table:cross-repo:${folderId}`),
      diagram: {
        storageKey: `diagram:github:cross-repo:${folderId}:folder`,
      },
    },
  };
}

function hazardSummaryCount(run) {
  return Array.isArray(run?.generatedSheets?.Summary)
    ? Math.max(0, run.generatedSheets.Summary.length - 1)
    : 0;
}

function hazardRunMatchesRepo(run, repo) {
  if (!run || !repo) return false;
  return (
    run.repoId === repo.id ||
    run.repoId === repo.repoId ||
    run.repoId === repo.repoName
  );
}

async function attachHazardRun(packageEntry, { activeRepo = null, activeHazardRun = null, includedAnalysis = null } = {}) {
  if (!packageEntry) return packageEntry;
  const includeHazard = !includedAnalysis || includedAnalysis[REVIEW_ANALYSIS_SECTIONS.HAZARD];
  if (!includeHazard) return { ...packageEntry, hazardRun: null };
  if (
    packageEntry.type === "project" &&
    activeHazardRun &&
    (
      packageEntry.repo?.id === activeRepo?.id ||
      hazardRunMatchesRepo(activeHazardRun, packageEntry.repo)
    ) &&
    hazardSummaryCount(activeHazardRun) > 0
  ) {
    return { ...packageEntry, hazardRun: activeHazardRun };
  }
  const projectId = packageEntry.project?.id || "";
  const repoId = packageEntry.type === "cross-repo" ? "folder" : packageEntry.repo?.id || "";
  if (!projectId || !repoId) return { ...packageEntry, hazardRun: null };
  const storedRun = await getLatestCodeArchitectureHazardRun({ projectId, repoId });
  return {
    ...packageEntry,
    hazardRun: hazardSummaryCount(storedRun) > 0 ? storedRun : null,
  };
}

function normalizeReviewTargets({ project, folder, repo, repos, cbaRows, reviewTargets }) {
  if (Array.isArray(reviewTargets) && reviewTargets.length) return reviewTargets;
  if (!project?.id) return [];
  return [{
    type: "project",
    project,
    folder,
    repos: (Array.isArray(repos) && repos.length ? repos : [repo]).filter((entry) => entry?.id),
    activeRepo: repo,
    cbaRows,
  }];
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function collectCodeArchitectureReviewPackage({
  project,
  folder = null,
  repo = null,
  repos = null,
  cbaRows = null,
  hazardRun = null,
  reviewTargets = null,
  appDisplayName = "",
  includedAnalysis = null,
  reviewItems = [],
  uiState = {},
} = {}) {
  const targets = normalizeReviewTargets({ project, folder, repo, repos, cbaRows, reviewTargets });
  if (!targets.length) throw new Error("Select at least one Code-Based Architecture project before exporting.");

  const builtPackages = [];
  for (const target of targets) {
    if (target?.type === "cross-repo") {
      const crossRepoPackage = await buildCrossRepoPackage({
        folder: target.folder,
        folders: target.folders || [],
        projects: target.projects || [],
        includedAnalysis,
      });
      if (crossRepoPackage) builtPackages.push(crossRepoPackage);
      continue;
    }

    const targetProject = target?.project;
    const targetRepos = (Array.isArray(target?.repos) && target.repos.length
      ? target.repos
      : targetProject?.repos || []
    ).filter((entry) => entry?.id);
    for (const targetRepo of targetRepos) {
      const packageEntry = await buildProjectRepoPackage({
        project: targetProject,
        folder: target.folder || null,
        repo: targetRepo,
        activeRepo: target.activeRepo || repo,
        cbaRows: target.cbaRows,
        includedAnalysis,
      });
      if (packageEntry) builtPackages.push(packageEntry);
    }
  }

  const repoPackages = (await Promise.all(builtPackages.map((entry) => (
    attachHazardRun(entry, {
      activeRepo: repo,
      activeHazardRun: hazardRun,
      includedAnalysis,
    })
  )))).filter(Boolean);

  if (!repoPackages.length) {
    throw new Error("Analyze at least one selected Code-Based Architecture project before exporting a review package.");
  }

  const activeRepoPackage = repoPackages.find((entry) => entry.repo?.id === repo?.id) || repoPackages[0];
  const safeRepo = activeRepoPackage.repo;
  const repoMeta = activeRepoPackage.repoMeta;
  const assuranceArtifacts = activeRepoPackage.assuranceArtifacts;
  const safetyRemediation = activeRepoPackage.safetyRemediation || null;
  const hazardRunForActiveRepo = activeRepoPackage.hazardRun || null;
  const activeProject = activeRepoPackage.project || project || {};

  return {
    schemaVersion: CODE_ARCHITECTURE_REVIEW_PACKAGE_SCHEMA_VERSION,
    type: CODE_ARCHITECTURE_REVIEW_PACKAGE_TYPE,
    artifactType: CODE_ARCHITECTURE_REVIEW_PACKAGE_TYPE,
    exportedAt: new Date().toISOString(),
    reviewMode: true,
    appDisplayName: String(appDisplayName || "").trim() || "xHandle Code Architecture Review",
    appName: String(appDisplayName || "").trim() || "xHandle Code Architecture Review",
    project: {
      ...activeProject,
      repos: (activeProject.repos || []).map(sanitizeRepo),
    },
    folder: activeRepoPackage.folder || folder,
    activeRepo: safeRepo,
    repoMeta,
    storage: {
      ...activeRepoPackage.storage,
      repositories: Object.fromEntries(repoPackages.map((entry) => [entry.id, entry.storage])),
    },
    data: {
      cbaRows: activeRepoPackage.rows,
      diagramPositions: activeRepoPackage.diagramPositions,
      assuranceArtifacts,
      safetyRemediation,
      hazardRun: hazardRunForActiveRepo,
      reviewItems: Array.isArray(reviewItems) ? reviewItems : [],
      repositories: repoPackages.map((entry) => ({
        id: entry.id,
        type: entry.type,
        label: entry.label,
        project: entry.project,
        folder: entry.folder || null,
        repo: entry.repo,
        repoMeta: entry.repoMeta,
        cbaRows: entry.rows,
        diagramPositions: entry.diagramPositions,
        assuranceArtifacts: entry.assuranceArtifacts,
        safetyRemediation: entry.safetyRemediation || null,
        hazardRun: entry.hazardRun || null,
      })),
    },
    uiState: {
      activeWorkspaceTab: uiState.activeWorkspaceTab || "architecture",
      hazardRemediationTab: uiState.hazardRemediationTab || "hazard-analysis",
      includedAnalysis: includedAnalysis || null,
      ...activeRepoPackage.uiState,
      hazardSummaryTable: tableUiStateFor(`code-architecture-hazard-summary:${safeRepo.repoId || safeRepo.repoName || "repo"}:${hazardRunForActiveRepo?.id || "latest"}`),
      repositories: Object.fromEntries(repoPackages.map((entry) => [entry.id, entry.uiState])),
      sidebar: {
        codeArchitectureProjectsOpen: readLocalStorageValue("xhandle.sidebarCodeArchitectureProjectsOpen", "true"),
        codeArchitectureFoldersOpen: readLocalStorageJson("xhandle.sidebarCodeArchitectureFoldersOpen", {}),
      },
      ...uiState,
    },
  };
}

function reviewPackageFilenameBase(reviewPackage) {
  const baseName = reviewPackage?.appDisplayName || [
    reviewPackage?.project?.name || "code-architecture",
    reviewPackage?.activeRepo?.repoName || reviewPackage?.activeRepo?.repoId || "repo",
  ].filter(Boolean).join("-");
  return String(baseName)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "code-architecture-review";
}

export function downloadCodeArchitectureReviewPackage(reviewPackage) {
  downloadJson(reviewPackage, `${reviewPackageFilenameBase(reviewPackage)}-review-package.json`);
}

function downloadUrl(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function isAbsoluteHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function resolveReviewAppDownloadUrl(targetBackendUrl, job = {}) {
  const rawUrl = job.artifactUrl || job.downloadUrl;
  if (!rawUrl) return "";
  if (isAbsoluteHttpUrl(rawUrl)) return rawUrl;
  return `${targetBackendUrl}${String(rawUrl).startsWith("/") ? "" : "/"}${rawUrl}`;
}

function packagingBackendUrl(backendUrl) {
  return codeArchitectureReviewPackagingTarget(backendUrl).url;
}

export async function chooseCodeArchitectureReviewDestination({ backendUrl } = {}) {
  const targetBackendUrl = packagingBackendUrl(backendUrl);
  let response;
  try {
    response = await fetch(`${targetBackendUrl}/api/code-architecture-review/package/choose-destination`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    throw new Error(
      `Could not open the local folder picker at ${targetBackendUrl}. Start the local xHandle backend, then try again. ${error?.message || ""}`.trim()
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {}

  if (!response.ok) {
    throw new Error(payload?.error || `Could not open folder picker (HTTP ${response.status}).`);
  }
  return payload || { cancelled: true };
}

export async function downloadCodeArchitectureReviewApp(
  reviewPackage,
  { backendUrl, onProgress, reviewAppTarget = "mac", destinationDirectory = "" } = {}
) {
  const packagingTarget = codeArchitectureReviewPackagingTarget(backendUrl);
  const targetBackendUrl = packagingTarget.url;
  const requestBody = codeArchitectureReviewPackageStartBody({
    reviewPackage,
    reviewAppTarget,
    destinationDirectory,
    packagingMode: packagingTarget.mode,
  });
  let response;
  try {
    response = await fetch(`${targetBackendUrl}/api/code-architecture-review/package/start`, {
      method: "POST",
      headers: reviewPackagerRequestHeaders(),
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    throw new Error(
      `Could not reach the local review app packager at ${targetBackendUrl}. Start the local xHandle backend, then try again. ${error?.message || ""}`.trim()
    );
  }

  if (!response.ok) {
    let message = `Failed to generate review app (HTTP ${response.status}).`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {}
    throw new Error(message);
  }

  const startedJob = await response.json();
  return downloadCodeArchitectureReviewAppJob(startedJob, { backendUrl: targetBackendUrl, onProgress });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function downloadCodeArchitectureReviewAppJob(startedJob, { backendUrl, onProgress } = {}) {
  const targetBackendUrl = packagingBackendUrl(backendUrl);
  let job = startedJob;
  onProgress?.(job);

  while (job && !job.ready && job.status !== "failed") {
    await wait(1500);
    const statusResponse = await fetch(`${targetBackendUrl}/api/code-architecture-review/package/${encodeURIComponent(job.id)}/status`, {
      headers: reviewPackagerRequestHeaders(),
    });
    if (!statusResponse.ok) {
      throw new Error(`Failed to read review app build status (HTTP ${statusResponse.status}).`);
    }
    job = await statusResponse.json();
    onProgress?.(job);
  }

  if (!job || job.status === "failed") {
    const detail = job?.error || job?.logTail || "Review app package build failed.";
    throw new Error(detail);
  }

  const finalDownloadUrl = resolveReviewAppDownloadUrl(targetBackendUrl, job);
  if (!finalDownloadUrl) {
    throw new Error("Review app package is ready, but no download URL was returned.");
  }
  downloadUrl(finalDownloadUrl, job.downloadName || "code-architecture-review-app.zip");
  return job;
}
