import React, { useEffect, useMemo, useState } from "react";
import { GitBranch } from "lucide-react";
import { useActivityCenter } from "../../components/activity/ActivityCenter";
import { FunctionalDecompositionTable } from "../../components/generateFunctionalDecompositionFromGitHub";
import { createReviewItemsFromGeneratedTable } from "../results-review";
import { EngineeringArtifactPanel, TraceabilityMatrixPanel } from "../code-architecture-assurance";
import {
  loadArtifactRowsAsync,
  saveArtifactRowsAsync,
} from "../code-architecture-assurance/artifactUtils";
import { ARTIFACT_KINDS } from "../code-architecture-assurance/artifactDefinitions";
import {
  CodeArchitectureHazardPanel,
  deleteCodeArchitectureHazardRuns,
  getLatestCodeArchitectureHazardRun,
  runCodeArchitectureHazardAnalysis,
  saveCodeArchitectureHazardRun,
} from "../code-architecture-hazard-analysis";
import { deriveCrossRepoArchitecture } from "./crossRepoArchitectureAI";
import {
  CROSS_REPO_ARCHITECTURE_KIND,
  CROSS_REPO_COLUMNS,
  getCbaProjectsInFolderTree,
  getCrossRepoGeneratedMeta,
  normalizeCrossRepoRow,
  saveCrossRepoGeneratedMeta,
} from "./crossRepoArchitectureUtils";

function rowTarget(row, side) {
  const prefix = side === "source" ? "source" : "target";
  return {
    projectId: row[`${prefix}ProjectId`],
    repoId: row[`${prefix}RepoId`],
    rowIndex: row[`${prefix}RowIndex`],
    rowRef: row[`${prefix}DecompositionRowId`],
    traceId: row[`${prefix}TraceId`],
  };
}

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
        { functionName: interfaceName, filePath: appendParts([sourceRepo, targetRepo], " -> ") },
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

export function buildCrossRepoFunctionalRows({ rows = [], folderProjects = [], repoFunctionalRows = [] }) {
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

export function buildRepoTraceMap(project, repo, rows = []) {
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

export function remapArtifactRows(rows = [], kind, traceMap) {
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

export const CROSS_REPO_ARTIFACT_LOADS = [
  ["softwareRequirements", ARTIFACT_KINDS.SOFTWARE],
  ["systemRequirements", ARTIFACT_KINDS.SYSTEM],
  ["subsystemRequirements", ARTIFACT_KINDS.SUBSYSTEM],
  ["designElements", ARTIFACT_KINDS.DESIGN],
];

export function emptyRepoAssuranceArtifacts() {
  return {
    softwareRequirements: [],
    systemRequirements: [],
    subsystemRequirements: [],
    designElements: [],
  };
}

export default function CrossRepoArchitecturePanel({
  folder,
  folders = [],
  projects = [],
  onOpenFunctionalRow,
  readCbaRows,
  resultsReview = null,
}) {
  const [rows, setRows] = useState([]);
  const [repoFunctionalRows, setRepoFunctionalRows] = useState([]);
  const [repoAssuranceArtifacts, setRepoAssuranceArtifacts] = useState(emptyRepoAssuranceArtifacts);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [lastGeneratedAt, setLastGeneratedAt] = useState("");
  const [activeArtifactTab, setActiveArtifactTab] = useState("architecture");
  const [hazardMethod, setHazardMethod] = useState("STPA-Textbook");
  const [hazardGenerationMode, setHazardGenerationMode] = useState("standard");
  const [hazardRun, setHazardRun] = useState(null);
  const [isRunningHazard, setIsRunningHazard] = useState(false);
  const [hazardProgress, setHazardProgress] = useState({ step: 0, total: 9, message: "" });
  const [hazardSummaryOpenKey, setHazardSummaryOpenKey] = useState(null);
  const [highlightedHazardRowIndex, setHighlightedHazardRowIndex] = useState(null);
  const [architectureTableOpenKey, setArchitectureTableOpenKey] = useState(null);
  const [highlightedArchitectureRowIndex, setHighlightedArchitectureRowIndex] = useState(null);
  const [pendingArchitectureFocusTarget, setPendingArchitectureFocusTarget] = useState(null);
  const { startActivity, updateActivity, finishActivity } = useActivityCenter();
  const folderId = folder?.id || "folder";
  const virtualProject = useMemo(() => ({
    id: folderId,
    name: folder?.name || "Cross-Repo System",
  }), [folder?.name, folderId]);
  const virtualRepo = useMemo(() => ({
    id: "folder",
    repoId: "folder",
    repoName: `${folder?.name || "Folder"} Cross-Repo`,
    repoUrl: "",
    branch: "folder",
  }), [folder?.name]);

  const folderProjects = useMemo(
    () => getCbaProjectsInFolderTree(projects, folders, folderId),
    [folderId, folders, projects]
  );

  const functionalRows = useMemo(
    () => buildCrossRepoFunctionalRows({ rows, folderProjects, repoFunctionalRows }),
    [folderProjects, repoFunctionalRows, rows]
  );
  const architectureRefreshKey = useMemo(() => {
    const first = functionalRows[0]?.traceId || functionalRows[0]?.rowRef || "";
    const last = functionalRows[functionalRows.length - 1]?.traceId || functionalRows[functionalRows.length - 1]?.rowRef || "";
    return `${folderId}:${functionalRows.length}:${first}:${last}`;
  }, [folderId, functionalRows]);

  useEffect(() => {
    let cancelled = false;
    getLatestCodeArchitectureHazardRun({ projectId: folderId, repoId: "folder" })
      .then((run) => {
        if (!cancelled) setHazardRun(run || null);
      })
      .catch(() => {
        if (!cancelled) setHazardRun(null);
      });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  useEffect(() => {
    let cancelled = false;
    setHasLoaded(false);
    loadArtifactRowsAsync(CROSS_REPO_ARCHITECTURE_KIND, folderId, "folder")
      .then((loadedRows) => {
        if (cancelled) return;
        const normalized = (Array.isArray(loadedRows) ? loadedRows : []).map(normalizeCrossRepoRow);
        const generatedMeta = getCrossRepoGeneratedMeta(folderId);
        setRows(normalized);
        setLastGeneratedAt(normalized[0]?.generatedAt || normalized[0]?.createdAt || generatedMeta?.generatedAt || "");
        setHasLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setHasLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  useEffect(() => {
    if (!hasLoaded) return undefined;
    const timeout = setTimeout(() => {
      saveArtifactRowsAsync(CROSS_REPO_ARCHITECTURE_KIND, folderId, "folder", rows).catch((error) => {
        console.warn("[cross-repo-architecture] save failed", error);
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [folderId, hasLoaded, rows]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = [];
      const artifacts = emptyRepoAssuranceArtifacts();
      for (const project of folderProjects) {
        for (const repo of project.repos || []) {
          try {
            const repoRows = await readCbaRows(project.id, repo.id);
            if (cancelled) return;
            const normalizedRepoRows = Array.isArray(repoRows) ? repoRows : [];
            loaded.push({ project, repo, rows: normalizedRepoRows });
            const traceMap = buildRepoTraceMap(project, repo, normalizedRepoRows);
            const [
              softwareRows,
              systemRows,
              subsystemRows,
              designRows,
            ] = await Promise.all(CROSS_REPO_ARTIFACT_LOADS.map(([, kind]) =>
              loadArtifactRowsAsync(kind, project.id, repo.id)
            ));
            if (cancelled) return;
            artifacts.softwareRequirements.push(...remapArtifactRows(softwareRows, ARTIFACT_KINDS.SOFTWARE, traceMap));
            artifacts.systemRequirements.push(...remapArtifactRows(systemRows, ARTIFACT_KINDS.SYSTEM, traceMap));
            artifacts.subsystemRequirements.push(...remapArtifactRows(subsystemRows, ARTIFACT_KINDS.SUBSYSTEM, traceMap));
            artifacts.designElements.push(...remapArtifactRows(designRows, ARTIFACT_KINDS.DESIGN, traceMap));
          } catch {
            if (cancelled) return;
            loaded.push({ project, repo, rows: [] });
          }
        }
      }
      if (!cancelled) {
        setRepoFunctionalRows(loaded);
        setRepoAssuranceArtifacts(artifacts);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderProjects, readCbaRows]);

  const gatherProjectsWithRows = async ({ activityId, progress }) => {
    const out = [];
    const total = folderProjects.reduce((sum, project) => sum + (project.repos?.length || 0), 0);
    for (const project of folderProjects) {
      const repos = [];
      for (const repo of project.repos || []) {
        const repoRows = await readCbaRows(project.id, repo.id);
        progress.completed += 1;
        updateActivity(activityId, {
          step: progress.completed,
          total: progress.total,
          message: `Loaded ${progress.completed} of ${total} repo decomposition table${total === 1 ? "" : "s"}.`,
        });
        if (Array.isArray(repoRows) && repoRows.length) {
          repos.push({ ...repo, rows: repoRows });
        }
      }
      if (repos.length) out.push({ ...project, repos });
    }
    return out;
  };

  const loadAssuranceArtifactsForProjects = async ({ projectsWithRepos, activityId, progress }) => {
    const artifacts = emptyRepoAssuranceArtifacts();
    const repoContexts = [];
    const analyzedRepoCount = projectsWithRepos.reduce((sum, project) => sum + (project.repos?.length || 0), 0);
    progress.total += analyzedRepoCount * CROSS_REPO_ARTIFACT_LOADS.length;
    updateActivity(activityId, {
      step: progress.completed,
      total: progress.total,
      message: `Loading assurance artifacts for ${analyzedRepoCount} analyzed repo${analyzedRepoCount === 1 ? "" : "s"}...`,
    });

    for (const project of projectsWithRepos) {
      for (const repo of project.repos || []) {
        repoContexts.push({ project, repo, rows: repo.rows || [] });
        const traceMap = buildRepoTraceMap(project, repo, repo.rows || []);
        const repoName = repoDisplayName(project, repo);
        for (const [artifactKey, kind] of CROSS_REPO_ARTIFACT_LOADS) {
          const artifactRows = await loadArtifactRowsAsync(kind, project.id, repo.id);
          artifacts[artifactKey].push(...remapArtifactRows(artifactRows, kind, traceMap));
          progress.completed += 1;
          updateActivity(activityId, {
            step: progress.completed,
            total: progress.total,
            message: `Loaded ${artifactKey.replace(/([A-Z])/g, " $1").toLowerCase()} for ${repoName}.`,
          });
        }
      }
    }

    return { artifacts, repoContexts };
  };

  const generate = async () => {
    const activityId = `cross-repo-architecture:${folderId}`;
    setIsGenerating(true);
    setMessage("Gathering repo functional decompositions...");
    const repoCount = folderProjects.reduce((sum, project) => sum + (project.repos?.length || 0), 0);
    const progress = {
      completed: 0,
      total: Math.max(1, repoCount + 3),
    };
    startActivity(activityId, {
      title: "Cross-Repo Architecture",
      step: 0,
      total: progress.total,
      message: "Gathering repo functional decompositions...",
    });
    try {
      const projectsWithRepos = await gatherProjectsWithRows({ activityId, progress });
      if (projectsWithRepos.length < 2) {
        const msg = "At least two analyzed repo projects are needed to infer cross-repo architecture.";
        setMessage(msg);
        finishActivity(activityId, "error", msg);
        return;
      }
      const { artifacts, repoContexts } = await loadAssuranceArtifactsForProjects({ projectsWithRepos, activityId, progress });
      setRepoFunctionalRows(repoContexts);
      setRepoAssuranceArtifacts(artifacts);

      progress.completed += 1;
      updateActivity(activityId, {
        step: progress.completed,
        total: progress.total,
        message: `Analyzing ${repoContexts.length} repo decomposition table${repoContexts.length === 1 ? "" : "s"} for cross-repo interfaces...`,
      });
      const generatedAt = new Date().toISOString();
      const generated = await deriveCrossRepoArchitecture({ folder, projectsWithRepos });
      const normalized = generated.map((row, index) => normalizeCrossRepoRow({
        ...row,
        generatedAt,
      }, index));
      setRows(normalized);
      setHasLoaded(true);
      setLastGeneratedAt(generatedAt);

      progress.completed += 1;
      updateActivity(activityId, {
        step: progress.completed,
        total: progress.total,
        message: `Saving ${normalized.length} generated cross-repo link${normalized.length === 1 ? "" : "s"}...`,
      });
      await saveArtifactRowsAsync(CROSS_REPO_ARCHITECTURE_KIND, folderId, "folder", normalized);
      saveCrossRepoGeneratedMeta(folderId, {
        generatedAt,
        rowCount: normalized.length,
        repoCount: repoContexts.length,
        projectCount: projectsWithRepos.length,
      });
      if (resultsReview?.createReviewItems && normalized.length) {
        updateActivity(activityId, {
          step: progress.completed,
          total: progress.total,
          message: `Registering ${normalized.length} cross-repo link${normalized.length === 1 ? "" : "s"} for review...`,
        });
        await resultsReview.createReviewItems(createReviewItemsFromGeneratedTable({
          sourceFeature: "Code-Based Architecture Cross-Repo Architecture",
          sourceMethod: "Folder Functional Decomposition Synthesis",
          sourceRunId: `cross-repo-architecture:${folderId}:${Date.now()}`,
          artifactType: "code_architecture_cross_repo_link",
          artifactId: `code-architecture-cross-repo:${folderId}`,
          projectId: folderId,
          rows: normalized,
          columns: CROSS_REPO_COLUMNS.map((column) => column.key),
        }));
      }
      progress.completed = progress.total;
      updateActivity(activityId, {
        step: progress.completed,
        total: progress.total,
        message: "Cross-repo architecture generation complete.",
      });
      const msg = `${normalized.length} cross-repo architecture link${normalized.length === 1 ? "" : "s"} generated for review.`;
      setMessage(msg);
      finishActivity(activityId, "success", msg);
    } catch (error) {
      const msg = error?.message || "Cross-repo architecture generation failed.";
      setMessage(msg);
      finishActivity(activityId, "error", msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const runHazardAnalysis = async (selectedMethod = hazardMethod, options = {}) => {
    const selectedHazardGenerationMode = options.hazardGenerationMode || hazardGenerationMode || "standard";
    const activityId = `cross-repo-hazard:${folderId}`;
    setHazardMethod(selectedMethod);
    setHazardGenerationMode(selectedHazardGenerationMode);
    setIsRunningHazard(true);
    setHazardProgress({ step: 0, total: 9, message: "Preparing cross-repo hazard analysis..." });
    startActivity(activityId, {
      title: "Cross-Repo Hazard Analysis",
      step: 0,
      total: 9,
      message: "Preparing cross-repo hazard analysis...",
    });
    try {
      const run = await runCodeArchitectureHazardAnalysis({
        cbaRows: functionalRows,
        method: selectedMethod,
        repoMeta: virtualRepo,
        projectId: folderId,
        hazardGenerationMode: selectedHazardGenerationMode,
        onPartialRunUpdate: setHazardRun,
        setProgress: (step, total, message) => {
          setHazardProgress({ step, total, message });
          updateActivity(activityId, { step, total, message });
        },
        onActivityUpdate: ({ step, total, message }) => {
          setHazardProgress((prev) => {
            const next = {
              step: Number.isFinite(Number(step)) ? Number(step) : prev.step,
              total: Number.isFinite(Number(total)) ? Number(total) : prev.total,
              message: message || prev.message,
            };
            updateActivity(activityId, next);
            return next;
          });
        },
      });
      setHazardRun(run);
      finishActivity(activityId, "success", "Cross-repo hazard analysis complete");
    } catch (error) {
      const errorMessage = error?.message || "Cross-repo hazard analysis failed";
      finishActivity(activityId, "error", errorMessage);
    } finally {
      setIsRunningHazard(false);
    }
  };

  const clearHazardContents = async () => {
    const summaryCount = Math.max(0, (hazardRun?.generatedSheets?.Summary?.length || 1) - 1);
    const confirmed = window.confirm(
      `Clear cross-repo hazard analysis contents${summaryCount ? ` (${summaryCount} summary rows)` : ""}? This cannot be undone.`,
    );
    if (!confirmed) return;
    await deleteCodeArchitectureHazardRuns({ projectId: folderId, repoId: "folder" });
    setHazardRun(null);
    setHazardProgress({ step: 0, total: 9, message: "" });
  };

  const deleteHazardSummaryRow = async (rowIndex) => {
    const summary = hazardRun?.generatedSheets?.Summary;
    if (!Array.isArray(summary) || rowIndex < 0) return;
    const nextSummary = [summary[0], ...summary.slice(1).filter((_, index) => index !== rowIndex)];
    const nextRun = {
      ...hazardRun,
      generatedSheets: {
        ...hazardRun.generatedSheets,
        Summary: nextSummary,
      },
      updatedAt: new Date().toISOString(),
    };
    await saveCodeArchitectureHazardRun(nextRun);
    setHazardRun(nextRun);
  };

  const openHazardSummaryRow = (rowIndex) => {
    const targetIndex = Number(rowIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) return;
    setActiveArtifactTab("hazard");
    setHazardSummaryOpenKey(`open-${Date.now()}`);
    setHighlightedHazardRowIndex(targetIndex);
    setTimeout(() => {
      setHighlightedHazardRowIndex((current) => (current === targetIndex ? null : current));
    }, 2600);
  };

  const openCrossRepoFunctionalTableRow = (rowIndex) => {
    const targetIndex = Number(rowIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) return false;
    setActiveArtifactTab("architecture");
    setArchitectureTableOpenKey(`open-${Date.now()}`);
    setHighlightedArchitectureRowIndex(targetIndex);
    setTimeout(() => {
      setHighlightedArchitectureRowIndex((current) => (current === targetIndex ? null : current));
    }, 2600);
    return true;
  };

  const focusCrossRepoArchitectureRow = (rowIndex, mode = "edge") => {
    const targetIndex = Number(rowIndex);
    if (!Number.isFinite(targetIndex) || targetIndex < 0) return false;
    const row = functionalRows[targetIndex];
    if (!row) return false;
    const focusMode = mode === "from" || mode === "to" || mode === "edge" ? mode : "edge";
    setActiveArtifactTab("architecture");
    setPendingArchitectureFocusTarget({
      type: focusMode === "edge" ? "edge" : "node",
      mode: focusMode,
      row,
      rowIndex: targetIndex,
      rowRef: row.rowRef || targetIndex + 1,
      traceId: row.traceId || "",
      nodeId: focusMode === "to" ? row.toNodeId : row.fromNodeId,
      edgeId: focusMode === "edge" ? row.edgeId : "",
      functionName: focusMode === "to" ? row.to : row.from,
      fromFunction: row.from,
      controlAction: row.action,
      toFunction: row.to,
      fromFile: row.fromFile || "",
      toFile: row.toFile || "",
    });
    return true;
  };

  const handleFolderTrace = (target) => {
    if (target?.type === "functional-row" || target?.targetType === "functional-row") {
      setActiveArtifactTab("architecture");
      return;
    }
    if (target?.tab) setActiveArtifactTab(target.tab);
  };

  const artifactTabs = [
    ["architecture", "Architecture Diagram"],
    ["hazard", "Hazard & Remediation"],
    [ARTIFACT_KINDS.SOFTWARE, "Software Requirements"],
    [ARTIFACT_KINDS.SYSTEM, "System Requirements"],
    [ARTIFACT_KINDS.SUBSYSTEM, "Subsystem Requirements"],
    [ARTIFACT_KINDS.DESIGN, "System / Subsystem Design"],
    ["traceability-matrix", "Traceability Matrix"],
  ];

  const architectureContent = functionalRows.length ? (
    <FunctionalDecompositionTable
      data={functionalRows}
      repoId={`cross-repo:${folderId}`}
      branch="folder"
      repoMeta={{
        repoId: `cross-repo:${folderId}`,
        repoName: `${folder?.name || "Folder"} Cross-Repo Architecture`,
        repoUrl: "",
        branch: "folder",
      }}
      onOpenFunctionalRow={(target) => {
        const targetRowRef = typeof target === "object" && target !== null
          ? String(target.rowRef || target.traceId || target.ref || "").trim()
          : "";
        const rowIndex = typeof target === "number"
          ? target
          : Number.isFinite(Number(target?.rowIndex))
            ? Number(target.rowIndex)
            : functionalRows.findIndex((row, index) =>
              String(row?.rowRef || "").trim() === targetRowRef ||
              String(row?.traceId || "").trim() === targetRowRef ||
              String(index + 1) === targetRowRef
            );
        const requestedMode = target?.mode || target?.type;
        const wantsTable = target?.intent === "open-table" || target?.action === "open-table" || target?.target === "table";
        if (wantsTable && openCrossRepoFunctionalTableRow(rowIndex)) {
          return;
        }
        if (focusCrossRepoArchitectureRow(rowIndex, requestedMode === "to" || requestedMode === "from" ? requestedMode : "edge")) {
          return;
        }
        const displayRow = functionalRows[rowIndex];
        const row = displayRow?.crossRepoSource;
        if (!row) {
          if (displayRow?.crossRepoRepoSource) {
            onOpenFunctionalRow?.(displayRow.crossRepoRepoSource);
          }
          return;
        }
        const mode = target?.mode || target?.type;
        onOpenFunctionalRow?.(rowTarget(row, mode === "to" ? "target" : "source"));
      }}
      assuranceArtifacts={repoAssuranceArtifacts}
      hazardSummary={hazardRun?.generatedSheets?.Summary}
      onOpenHazardRow={openHazardSummaryRow}
      forceTableOpenKey={architectureTableOpenKey}
      highlightedRowIndex={highlightedArchitectureRowIndex}
      focusTarget={pendingArchitectureFocusTarget}
      onFocusTargetHandled={() => setPendingArchitectureFocusTarget(null)}
      architectureRefreshKey={architectureRefreshKey}
      colorSystemElements
      architectureLevelLabels={{
        architecture: "Architecture",
        subsystem: "System Element",
        csci: "Subsystem",
        csc: "CSCI",
        csu: "CSC",
        detailed: "CSU",
      }}
      architectureLevels={[
        ["subsystem", "System Element"],
        ["csci", "Subsystem"],
        ["csc", "CSCI"],
        ["csu", "CSC"],
        ["detailed", "CSU"],
      ]}
    />
  ) : (
    <div className="flex min-h-[360px] flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
      No cross-repo architecture rows yet. Generate Cross-Repo Architecture to view the same table and diagram format used by Code-Based Architecture functional decomposition.
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="shrink-0 border-b border-slate-200 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">Cross-Repo Architecture</h3>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              Projects: {folderProjects.length}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              Rows: {rows.length}
            </span>
            {lastGeneratedAt && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                Generated: {new Date(lastGeneratedAt).toLocaleString()}
              </span>
            )}
            {message && <span className="text-xs font-medium text-slate-600">{message}</span>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={isGenerating || !folderProjects.length}
              className="inline-flex items-center gap-2 rounded-md bg-[#2D7DFE] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#1E61D6] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GitBranch size={15} />
              {isGenerating ? "Generating..." : "Generate Cross-Repo Architecture"}
            </button>
          </div>
        </div>
      </div>

      <div className="shrink-0 flex flex-nowrap items-center gap-1 overflow-x-auto border-b border-slate-200 pb-1.5">
        {artifactTabs.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveArtifactTab(tab)}
            className={`shrink-0 rounded-md px-2.5 py-1 text-sm font-semibold ${
              activeArtifactTab === tab
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {activeArtifactTab === "architecture" ? architectureContent
          : activeArtifactTab === "hazard" ? (
            <CodeArchitectureHazardPanel
              cbaRows={functionalRows}
              latestRun={hazardRun}
              method={hazardMethod}
              onMethodChange={setHazardMethod}
              hazardGenerationMode={hazardGenerationMode}
              onHazardGenerationModeChange={setHazardGenerationMode}
              onRunAnalysis={runHazardAnalysis}
              onClearContents={clearHazardContents}
              onDeleteSummaryRow={deleteHazardSummaryRow}
              isRunning={isRunningHazard}
              progress={hazardProgress}
              forceSummaryOpenKey={hazardSummaryOpenKey}
              highlightedRowIndex={highlightedHazardRowIndex}
              onOpenArchitectureTarget={(target) => {
                setPendingArchitectureFocusTarget(target);
                setActiveArtifactTab("architecture");
              }}
            />
          ) : activeArtifactTab === ARTIFACT_KINDS.SOFTWARE ? (
            <EngineeringArtifactPanel
              key={`${folderId}:${ARTIFACT_KINDS.SOFTWARE}`}
              kind={ARTIFACT_KINDS.SOFTWARE}
              cbaRows={functionalRows}
              project={virtualProject}
              repo={virtualRepo}
              onOpenTrace={handleFolderTrace}
              hazardAnalysis={hazardRun}
            />
          ) : activeArtifactTab === ARTIFACT_KINDS.SYSTEM ? (
            <EngineeringArtifactPanel
              key={`${folderId}:${ARTIFACT_KINDS.SYSTEM}`}
              kind={ARTIFACT_KINDS.SYSTEM}
              cbaRows={functionalRows}
              project={virtualProject}
              repo={virtualRepo}
              onOpenTrace={handleFolderTrace}
            />
          ) : activeArtifactTab === ARTIFACT_KINDS.SUBSYSTEM ? (
            <EngineeringArtifactPanel
              key={`${folderId}:${ARTIFACT_KINDS.SUBSYSTEM}`}
              kind={ARTIFACT_KINDS.SUBSYSTEM}
              cbaRows={functionalRows}
              project={virtualProject}
              repo={virtualRepo}
              onOpenTrace={handleFolderTrace}
            />
          ) : activeArtifactTab === ARTIFACT_KINDS.DESIGN ? (
            <EngineeringArtifactPanel
              key={`${folderId}:${ARTIFACT_KINDS.DESIGN}`}
              kind={ARTIFACT_KINDS.DESIGN}
              cbaRows={functionalRows}
              project={virtualProject}
              repo={virtualRepo}
              onOpenTrace={handleFolderTrace}
            />
          ) : (
            <TraceabilityMatrixPanel
              cbaRows={functionalRows}
              project={virtualProject}
              repo={virtualRepo}
              onOpenTrace={handleFolderTrace}
            />
          )}
      </div>
    </div>
  );
}
