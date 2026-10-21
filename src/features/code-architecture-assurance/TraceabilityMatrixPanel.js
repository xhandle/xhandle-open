import TablePreparationProgress from './TablePreparationProgress';
import { buildFunctionalModelRows } from '../code-architecture-context/functionalModel';
import React, { useEffect, useState } from "react";
import { ARTIFACT_KINDS, TRACEABILITY_MATRIX_COLUMNS } from "./artifactDefinitions";
import EngineeringArtifactTable from "./EngineeringArtifactTable";
import {
  allocatedArchitectureFromRefs,
  allocatedFunctionFromRefs,
  architectureRefFromFunctionalRow,
  architectureRefsLabel,
  cellText,
  compactList,
  loadArtifactRowsAsync,
  resolveArtifactArchitectureRefs,
  rowsById,
  indexArtifactCollections,
  sourceFilesFromRefs,
  splitIds,
  storageKeyFor,
} from "./artifactUtils";

const EMPTY_ROWS = [];
const EMPTY_ARTIFACTS = { softwareRows: [], systemRows: [], subsystemRows: [], designRows: [] };

function functionalId(row = {}, index = 0) {
  return cellText(row.traceId || row.rowRef || index + 1);
}

function functionalSource(row = {}) {
  return cellText(row.from || row.fromFunction);
}

function functionalAction(row = {}) {
  return cellText(row.action || row.controlAction);
}

function functionalTarget(row = {}) {
  return cellText(row.to || row.toFunction);
}

function functionalFiles(row = {}) {
  return compactList([row.fromFile, row.toFile, row.sourceFiles]);
}

function functionLabel(row = {}, index = 0) {
  const id = functionalId(row, index);
  return id ? `FD-${id}` : `FD-${index + 1}`;
}

function parentMatches(value, id) {
  return splitIds(value).includes(cellText(id));
}

function parentIdsFor(row = {}, parentField = "", targetType = "") {
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

function buildIssue({ sw, sys, sub, design }) {
  if (!sw) return "Missing SW Requirement";
  if (!sys) return "Missing System Requirement";
  if (!sub) return "Missing Subsystem Requirement";
  if (!design) return "Missing Design Element";
  return "";
}

function buildCompleteness(issue) {
  return issue ? issue : "Complete";
}

function rowForChain({ chainIndex, functionalRow, functionalIndex, architectureRef, sw, sys, sub, design, artifacts }) {
  const issue = compactList([buildIssue({ sw, sys, sub, design }), functionalRow?.lineage?.status === "historical" ? "Historical architecture evidence; review current applicability" : ""]);
  const refs = compactRefs([
    design ? resolveArtifactArchitectureRefs(design, ARTIFACT_KINDS.DESIGN, artifacts) : [],
    sub ? resolveArtifactArchitectureRefs(sub, ARTIFACT_KINDS.SUBSYSTEM, artifacts) : [],
    sys ? resolveArtifactArchitectureRefs(sys, ARTIFACT_KINDS.SYSTEM, artifacts) : [],
    sw?.sourceArchitectureRefs || [],
    architectureRef ? [architectureRef] : [],
  ]);
  const inheritedFiles = sourceFilesFromRefs(refs);
  return {
    id: `trace-${chainIndex}`,
    traceChainId: `TRACE-${String(chainIndex + 1).padStart(4, "0")}`,
    functionalRow: functionLabel(functionalRow, functionalIndex),
    functionalTraceId: functionalId(functionalRow, functionalIndex),
    architectureSource: architectureRefsLabel(refs),
    sourceArchitectureRefs: refs,
    sourceFunction: functionalSource(functionalRow),
    controlAction: functionalAction(functionalRow),
    targetFunction: functionalTarget(functionalRow),
    softwareRequirement: cellText(sw?.id),
    systemRequirement: cellText(sys?.id),
    subsystemRequirement: cellText(sub?.id),
    designElement: cellText(design?.id),
    sourceFiles: compactList([functionalFiles(functionalRow), inheritedFiles, sw?.linkedSourceCode, design?.linkedSourceCode]),
    allocatedArchitecture: cellText(
      design?.allocatedArchitecture ||
      sub?.allocatedArchitecture ||
      allocatedArchitectureFromRefs(refs)
    ),
    traceCompleteness: buildCompleteness(issue),
    openIssues: issue,
  };
}

function compactRefs(groups = []) {
  const seen = new Set();
  const refs = [];
  groups.flat().filter(Boolean).forEach((ref) => {
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
    refs.push(ref);
  });
  return refs;
}

function refsMatchFunctionalRow(refs = [], traceId = "", functionalIndex = 0, functionalRow = {}) {
  return (Array.isArray(refs) ? refs : []).some(ref => {
    if (cellText(ref.traceId)) return cellText(ref.traceId) === cellText(traceId);
    if (functionalRow.lineage) return false;
    return cellText(ref.rowRef) === cellText(functionalRow.rowRef || functionalIndex + 1) || Number(ref.rowIndex) === functionalIndex;
  });
}

function missingParentRow({ chainIndex, type, row, parentField, parentLabel, refs, parentId }) {
  const idLabel = cellText(row?.id);
  const missingLabel = parentId
    ? `${type} ${idLabel} references missing ${parentLabel} ${parentId}.`
    : `${type} ${idLabel} is missing ${parentLabel}.`;
  return {
    id: `broken-${type.toLowerCase()}-${chainIndex}`,
    traceChainId: `TRACE-${String(chainIndex + 1).padStart(4, "0")}`,
    softwareRequirement: type === "System Requirement" ? parentId : "",
    systemRequirement: type === "System Requirement" ? idLabel : type === "Subsystem Requirement" ? parentId : "",
    subsystemRequirement: type === "Subsystem Requirement" ? idLabel : type === "Design Element" ? parentId : "",
    designElement: type === "Design Element" ? idLabel : "",
    sourceArchitectureRefs: refs,
    architectureSource: architectureRefsLabel(refs),
    traceCompleteness: parentId ? "Broken Parent Link" : `Missing ${parentLabel}`,
    openIssues: missingLabel,
    [parentField]: parentId || "",
  };
}

function mergeTraceGroup(group = [], groupIndex = 0) {
  const refs = compactRefs(group.map((row) => row.sourceArchitectureRefs || []));
  const issues = compactList(group.map((row) => row.openIssues));
  return {
    id: `trace-group-${groupIndex}`,
    traceChainId: `TRACE-${String(groupIndex + 1).padStart(4, "0")}`,
    functionalRow: compactList(group.map((row) => row.functionalRow)),
    functionalTraceId: compactList(group.map((row) => row.functionalTraceId)),
    architectureSource: architectureRefsLabel(refs),
    sourceArchitectureRefs: refs,
    sourceFunction: compactList(group.map((row) => row.sourceFunction)),
    controlAction: compactList(group.map((row) => row.controlAction)),
    targetFunction: compactList(group.map((row) => row.targetFunction)),
    softwareRequirement: compactList(group.map((row) => row.softwareRequirement)),
    systemRequirement: compactList(group.map((row) => row.systemRequirement)),
    subsystemRequirement: compactList(group.map((row) => row.subsystemRequirement)),
    designElement: compactList(group.map((row) => row.designElement)),
    sourceFiles: compactList(group.map((row) => row.sourceFiles)),
    allocatedArchitecture: compactList(group.map((row) => row.allocatedArchitecture)) || allocatedArchitectureFromRefs(refs),
    traceCompleteness: issues ? "Open" : "Complete",
    openIssues: issues,
  };
}

function consolidateTraceRowsByArtifactChain(rows = []) {
  const grouped = new Map();
  const passthrough = [];

  rows.forEach((row) => {
    const canGroup = row.traceCompleteness === "Complete" &&
      cellText(row.systemRequirement || row.subsystemRequirement || row.designElement);
    if (!canGroup) {
      passthrough.push(row);
      return;
    }
    const key = cellText(row.designElement)
      ? `design:${cellText(row.designElement)}`
      : cellText(row.subsystemRequirement)
        ? `subsystem:${cellText(row.subsystemRequirement)}`
        : `system:${cellText(row.systemRequirement)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  return [
    ...Array.from(grouped.values()).map((group, index) => mergeTraceGroup(group, index)),
    ...passthrough.map((row, index) => ({
      ...row,
      id: row.id || `trace-passthrough-${index}`,
      traceChainId: row.traceChainId || `TRACE-${String(grouped.size + index + 1).padStart(4, "0")}`,
    })),
  ];
}

export function buildTraceabilityRows({ cbaRows, softwareRows, systemRows, subsystemRows, designRows }) {
  const artifacts = indexArtifactCollections({ softwareRows, systemRows, subsystemRows, designRows });
  const links = artifacts.relationshipIndex;
  // Candidate indexes retain original source order. The existing matching
  // predicate remains the authority for legacy/alias semantics.
  const softwareTrace = new Map(), softwareRef = new Map(), softwareRowIndex = new Map();
  const add = (map, key, index) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(index);
  };
  softwareRows.forEach((sw, index) => {
    splitIds(sw.sourceTraceId).forEach(id => add(softwareTrace, id, index));
    (sw.sourceArchitectureRefs || []).forEach(ref => {
      if (cellText(ref.traceId)) add(softwareTrace, cellText(ref.traceId), index);
      else {
        add(softwareRef, cellText(ref.rowRef), index);
        add(softwareRowIndex, Number(ref.rowIndex), index);
      }
    });
  });
  const softwareIds = new Set(softwareRows.map(row => row.id));
  const coveredSoftware = new Set();
  const functionalAliases = new Map();
  buildFunctionalModelRows(cbaRows).forEach(model => model.functionalModel.sourceTraceIds.forEach(trace => {
    if (!functionalAliases.has(trace)) functionalAliases.set(trace, new Set());
    functionalAliases.get(trace).add(model.traceId);
  }));
  const sysById = rowsById(systemRows);
  const subById = rowsById(subsystemRows);
  const rows = [];
  let chainIndex = 0;

  cbaRows.forEach((functionalRow, functionalIndex) => {
    const traceId = functionalId(functionalRow, functionalIndex);
    const architectureRef = architectureRefFromFunctionalRow(functionalRow, functionalIndex, "edge");
    const candidateIds = new Set(softwareTrace.get(traceId) || []);
    (functionalAliases.get(traceId) || []).forEach(alias => (softwareTrace.get(alias) || []).forEach(id => candidateIds.add(id)));
    if (!functionalRow.lineage) {
      (softwareRef.get(cellText(functionalRow.rowRef || functionalIndex + 1)) || []).forEach(id => candidateIds.add(id));
      (softwareRowIndex.get(functionalIndex) || []).forEach(id => candidateIds.add(id));
    }
    const swMatches = [...candidateIds].sort((a, b) => a - b).map(index => softwareRows[index]).filter((sw) =>
      parentMatches(sw.sourceTraceId, traceId) ||
      [...(functionalAliases.get(traceId) || [])].some(alias => parentMatches(sw.sourceTraceId, alias)
        || (sw.sourceArchitectureRefs || []).some(ref => ref.traceId === alias)) ||
      refsMatchFunctionalRow(sw.sourceArchitectureRefs || [], traceId, functionalIndex, functionalRow)
    );
    const swList = swMatches.length ? swMatches : [null];

    swList.forEach((sw) => {
      const sysMatches = sw
        ? (links.systems.get(cellText(sw.id)) || [])
        : [];
      const sysList = sysMatches.length ? sysMatches : [null];

      sysList.forEach((sys) => {
        const subMatches = sys
          ? (links.subsystems.get(cellText(sys.id)) || [])
          : [];
        const subList = subMatches.length ? subMatches : [null];

        subList.forEach((sub) => {
          const designMatches = sub
            ? (links.designs.get(cellText(sub.id)) || [])
            : [];
          const designList = designMatches.length ? designMatches : [null];

          designList.forEach((design) => {
            coveredSoftware.add(cellText(sw?.id));
            rows.push(rowForChain({
              chainIndex,
              functionalRow,
              functionalIndex,
              architectureRef,
              sw,
              sys,
              sub,
              design,
              artifacts,
            }));
            chainIndex += 1;
          });
        });
      });
    });
  });

  softwareRows.forEach(sw => {
    if (coveredSoftware.has(cellText(sw.id))) return;
    rows.push(missingParentRow({ chainIndex: chainIndex++, type: "Software Requirement", row: sw, parentField: "softwareRequirement", parentLabel: "unambiguous retained architecture evidence", refs: sw.sourceArchitectureRefs || [], parentId: sw.sourceTraceId || "" }));
    coveredSoftware.add(rows[rows.length - 1].softwareRequirement);
  });
  systemRows.forEach((sys) => {
    const parents = parentIdsFor(sys, "parentSwRequirement", "software-requirement");
    const refs = resolveArtifactArchitectureRefs(sys, ARTIFACT_KINDS.SYSTEM, artifacts);
    if (!parents.length) {
      rows.push(missingParentRow({
        chainIndex,
        type: "System Requirement",
        row: sys,
        parentField: "softwareRequirement",
        parentLabel: "Parent SW Requirement",
        refs,
      }));
      chainIndex += 1;
    }
    parents.forEach((parentId) => {
      if (softwareIds.has(parentId)) return;
      rows.push(missingParentRow({
        chainIndex,
        type: "System Requirement",
        row: sys,
        parentField: "softwareRequirement",
        parentLabel: "SW requirement",
        refs,
        parentId,
      }));
      chainIndex += 1;
    });
  });
  subsystemRows.forEach((sub) => {
    const parents = parentIdsFor(sub, "parentSystemRequirement", "system-requirement");
    const refs = resolveArtifactArchitectureRefs(sub, ARTIFACT_KINDS.SUBSYSTEM, artifacts);
    if (!parents.length) {
      rows.push(missingParentRow({
        chainIndex,
        type: "Subsystem Requirement",
        row: sub,
        parentField: "systemRequirement",
        parentLabel: "Parent System Requirement",
        refs,
      }));
      chainIndex += 1;
    }
    parents.forEach((parentId) => {
      if (sysById.has(parentId)) return;
      rows.push(missingParentRow({
        chainIndex,
        type: "Subsystem Requirement",
        row: sub,
        parentField: "systemRequirement",
        parentLabel: "system requirement",
        refs,
        parentId,
      }));
      chainIndex += 1;
    });
  });
  designRows.forEach((design) => {
    const parents = parentIdsFor(design, "parentRequirement", "subsystem-requirement");
    const refs = resolveArtifactArchitectureRefs(design, ARTIFACT_KINDS.DESIGN, artifacts);
    if (!parents.length) {
      rows.push(missingParentRow({
        chainIndex,
        type: "Design Element",
        row: design,
        parentField: "subsystemRequirement",
        parentLabel: "Parent Subsystem Requirement",
        refs,
      }));
      chainIndex += 1;
    }
    parents.forEach((parentId) => {
      if (subById.has(parentId)) return;
      rows.push(missingParentRow({
        chainIndex,
        type: "Design Element",
        row: design,
        parentField: "subsystemRequirement",
        parentLabel: "subsystem requirement",
        refs,
        parentId,
      }));
      chainIndex += 1;
    });
  });

  rows.forEach((row) => {
    if (row.traceCompleteness === "Complete" && !row.architectureSource) {
      row.traceCompleteness = "Missing Functional Source Trace";
      row.openIssues = "Artifact chain exists, but no architecture source reference could be resolved.";
    }
    if (!row.allocatedArchitecture && row.sourceArchitectureRefs?.length) {
      row.allocatedArchitecture = allocatedArchitectureFromRefs(row.sourceArchitectureRefs);
    }
    if (!row.sourceFunction && row.sourceArchitectureRefs?.length) {
      row.sourceFunction = allocatedFunctionFromRefs(row.sourceArchitectureRefs);
    }
  });

  return consolidateTraceRowsByArtifactChain(rows);
}

export default function TraceabilityMatrixPanel({
  cbaRows = EMPTY_ROWS,
  project,
  repo,
  onOpenTrace,
  initialArtifacts = null,
}) {
  const projectId = project?.id || "no-project";
  const repoId = repo?.id || repo?.repoId || repo?.repoName || "no-repo";
  const scope = JSON.stringify([projectId, repoId]);
  const [artifactScope, setArtifactScope] = useState(initialArtifacts ? scope : null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loadState, setLoadState] = useState({ progress: 0, loading: !initialArtifacts, error: null });
  const [artifacts, setArtifacts] = useState(initialArtifacts || {
    softwareRows: [],
    systemRows: [],
    subsystemRows: [],
    designRows: [],
  });

  useEffect(() => {
    if (initialArtifacts) {
      setLoadState({ progress: 100, loading: false, error: null });
      setArtifacts(initialArtifacts);
      setArtifactScope(scope);
      return undefined;
    }
    let cancelled = false;
    let completed = 0;
    let failed = false;
    setLoadState({ progress: 0, loading: true, error: null });
    const track = (request) => request.then(value => {
      completed += 1;
      if (!cancelled && !failed) setLoadState({ progress: completed * 25, loading: true, error: null });
      return value;
    });
    Promise.all([
      loadArtifactRowsAsync(ARTIFACT_KINDS.SOFTWARE, projectId, repoId),
      loadArtifactRowsAsync(ARTIFACT_KINDS.SYSTEM, projectId, repoId),
      loadArtifactRowsAsync(ARTIFACT_KINDS.SUBSYSTEM, projectId, repoId),
      loadArtifactRowsAsync(ARTIFACT_KINDS.DESIGN, projectId, repoId),
    ].map(track)).then(([softwareRows, systemRows, subsystemRows, designRows]) => {
      if (cancelled) return;
      setLoadState({ progress: 100, loading: false, error: null });
      setArtifactScope(scope);
      setArtifacts({
        softwareRows: Array.isArray(softwareRows) ? softwareRows : [],
        systemRows: Array.isArray(systemRows) ? systemRows : [],
        subsystemRows: Array.isArray(subsystemRows) ? subsystemRows : [],
        designRows: Array.isArray(designRows) ? designRows : [],
      });
    }).catch(error => {
      failed = true;
      if (!cancelled) setLoadState({ progress: 0, loading: false, error: error.message || "Unable to load traceability data." });
    });
    return () => {
      cancelled = true;
    };
  }, [initialArtifacts, projectId, refreshToken, repoId, scope]);

  useEffect(() => {
    const onChanged = event => {
      if (event.detail?.projectId !== projectId || event.detail?.repoId !== repoId) return;
      setRefreshToken((value) => value + 1);
    };
    window.addEventListener("xhandle:code-architecture-assurance:changed", onChanged);
    return () => window.removeEventListener("xhandle:code-architecture-assurance:changed", onChanged);
  }, [projectId, repoId]);

  const [built, setBuilt] = useState(null);
  useEffect(() => {
    if (loadState.loading || loadState.error || artifactScope !== scope) return undefined;
    let cancelled = false;
    // Let the working indicator paint before synchronous chain construction.
    const timer = setTimeout(() => {
      try {
        const rows = buildTraceabilityRows({ cbaRows, ...artifacts });
        if (!cancelled) setBuilt({ artifacts, cbaRows, projectId, repoId, rows });
      } catch (error) {
        if (!cancelled) setLoadState({ progress: 0, loading: false, error: error.message || "Unable to prepare traceability." });
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [artifacts, cbaRows, projectId, repoId, loadState.loading, loadState.error, artifactScope, scope]);
  const ready = built?.artifacts === artifacts && built?.cbaRows === cbaRows && built?.projectId === projectId && built?.repoId === repoId;
  const hasBuilt = built?.projectId === projectId && built?.repoId === repoId;
  const rows = hasBuilt ? built.rows : EMPTY_ROWS;
  const displayedArtifacts = artifactScope === scope ? artifacts : EMPTY_ARTIFACTS;

  const completeCount = rows.filter((row) => row.traceCompleteness === "Complete").length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Traceability Matrix</h2>
            <p className="mt-1 text-sm text-slate-500">
              End-to-end computed traceability from functional decomposition through requirements and design.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshToken((value) => value + 1)}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh Traceability
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">Chains: {rows.length}</span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">Complete: {completeCount}</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">Open: {rows.length - completeCount}</span>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">SWR: {displayedArtifacts.softwareRows.length}</span>
          <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700">SYS: {displayedArtifacts.systemRows.length}</span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">SUB: {displayedArtifacts.subsystemRows.length}</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">DES: {displayedArtifacts.designRows.length}</span>
        </div>
      </div>
      {loadState.error ? <div role="alert">{loadState.error} <button onClick={() => setRefreshToken(value => value + 1)}>Retry loading</button></div>
        : loadState.loading ? <TablePreparationProgress label="Loading traceability data" progress={loadState.progress} />
        : !ready ? <TablePreparationProgress label="Building traceability chains" progress={0} />
        : null}
      {hasBuilt && <EngineeringArtifactTable
        key={scope}
        preparationLabel="Preparing traceability matrix table"
        copyLabel="Copy traceability matrix table"
        rows={rows}
        columns={TRACEABILITY_MATRIX_COLUMNS}
        storageKey={storageKeyFor("traceability-matrix", projectId, repoId)}
        onOpenTrace={onOpenTrace}
        emptyMessage="No traceability rows are available yet."
        noMatchMessage="No traceability rows match the active column filters."
        showActions={false}
        showReview={false}
        readOnly
      />}
    </div>
  );
}
