import React, { useEffect, useMemo, useState } from "react";
import { ARTIFACT_DEFINITIONS, ARTIFACT_KINDS } from "./artifactDefinitions";
import { DERIVE_BY_KIND } from "./artifactAI";
import EngineeringArtifactTable from "./EngineeringArtifactTable";
import { useArtifactReview } from "./useArtifactReview";
import { useActivityCenter } from "../../components/activity/ActivityCenter";
import {
  cellText,
  createBaseArtifactRow,
  downstreamDesignElementIds,
  downstreamSubsystemRequirementIds,
  loadArtifactRows,
  loadArtifactRowsAsync,
  makeId,
  saveArtifactRowsAsync,
  storageKeyFor,
} from "./artifactUtils";

function columnsForKind(kind, columns) {
  return columns.map((column) => {
    if (kind === ARTIFACT_KINDS.SYSTEM && column.key === "linkedSubsystemRequirement") {
      return {
        ...column,
        readOnly: true,
        linkType: "subsystem-requirement",
        getValue: (row, context) => downstreamSubsystemRequirementIds(row, context),
      };
    }
    if (kind === ARTIFACT_KINDS.SYSTEM && column.key === "linkedDesignElement") {
      return {
        ...column,
        readOnly: true,
        linkType: "design-element",
        getValue: (row, context) => downstreamDesignElementIds(row, ARTIFACT_KINDS.SYSTEM, context),
      };
    }
    if (kind === ARTIFACT_KINDS.SUBSYSTEM && column.key === "linkedDesignElement") {
      return {
        ...column,
        readOnly: true,
        linkType: "design-element",
        getValue: (row, context) => downstreamDesignElementIds(row, ARTIFACT_KINDS.SUBSYSTEM, context),
      };
    }
    return column;
  });
}

const DOWNSTREAM_ARTIFACT_KINDS = {
  [ARTIFACT_KINDS.SOFTWARE]: [
    ARTIFACT_KINDS.SYSTEM,
    ARTIFACT_KINDS.SUBSYSTEM,
    ARTIFACT_KINDS.DESIGN,
  ],
  [ARTIFACT_KINDS.SYSTEM]: [
    ARTIFACT_KINDS.SUBSYSTEM,
    ARTIFACT_KINDS.DESIGN,
  ],
  [ARTIFACT_KINDS.SUBSYSTEM]: [
    ARTIFACT_KINDS.DESIGN,
  ],
  [ARTIFACT_KINDS.DESIGN]: [],
};

async function clearDownstreamArtifacts(kind, projectId, repoId) {
  const downstreamKinds = DOWNSTREAM_ARTIFACT_KINDS[kind] || [];
  await Promise.all(downstreamKinds.map((downstreamKind) =>
    saveArtifactRowsAsync(downstreamKind, projectId, repoId, [])
  ));
}

function rowsMatchingKind(rows = [], kind = "") {
  const prefix = ARTIFACT_DEFINITIONS[kind]?.idPrefix;
  if (!prefix) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const id = cellText(row?.id);
    return !id || new RegExp(`^${prefix}-`, "i").test(id);
  });
}

function mergeGeneratedRows(nextRows, existingRows, kind) {
  const byTrace = new Map();
  const internalPrefix = ARTIFACT_DEFINITIONS[kind]?.internalPrefix || "artifact";
  const keyFor = (value) => {
    const text = cellText(value);
    return text ? text : "";
  };
  const rowKeys = (row = {}) => {
    const keys = kind === ARTIFACT_KINDS.SOFTWARE
      ? [row.id, row.hazardSummaryRef]
      : [
      row.id,
      row.sourceTraceId,
      row.parentSwRequirement,
      row.parentSystemRequirement,
      row.parentRequirement,
    ];
    return keys.map(keyFor).filter(Boolean);
  };
  existingRows.forEach((row) => {
    rowKeys(row).forEach((key) => {
      if (!byTrace.has(key)) byTrace.set(key, row);
    });
  });
  const usedRowIdentities = new Set();
  const matchedExistingKeys = new Set();
  return nextRows.map((row) => {
    const keys = rowKeys(row);
    const existingKey = keys.find((key) => byTrace.has(key) && !matchedExistingKeys.has(key));
    const existing = existingKey ? byTrace.get(existingKey) : null;
    if (existingKey) {
      rowKeys(existing).forEach((key) => matchedExistingKeys.add(key));
    }
    if (!existing) {
      const rowIdentity = cellText(row.internalId || row.id);
      const internalId = !rowIdentity || usedRowIdentities.has(rowIdentity)
        ? makeId(internalPrefix)
        : row.internalId;
      usedRowIdentities.add(cellText(internalId || row.id));
      return { ...row, internalId };
    }
    const merged = { ...row };
    Object.entries(existing).forEach(([key, value]) => {
      if (!cellText(merged[key]) && cellText(value)) merged[key] = value;
    });
    const existingIdentity = cellText(existing.internalId || existing.id);
    const rowIdentity = cellText(row.internalId || row.id);
    const internalId = existingIdentity && !usedRowIdentities.has(existingIdentity)
      ? existing.internalId
      : (rowIdentity && !usedRowIdentities.has(rowIdentity) ? row.internalId : makeId(internalPrefix));
    usedRowIdentities.add(cellText(internalId || row.id || existing.id));
    return {
      ...merged,
      id: row.id || existing.id,
      internalId,
      traceLinks: Array.isArray(row.traceLinks) && row.traceLinks.length ? row.traceLinks : existing.traceLinks,
      sourceArchitectureRefs: Array.isArray(row.sourceArchitectureRefs) && row.sourceArchitectureRefs.length
        ? row.sourceArchitectureRefs
        : existing.sourceArchitectureRefs,
      source: existing.source || row.source || merged.source,
      updatedAt: existing.updatedAt || row.updatedAt,
    };
  });
}

function softwareDerivationSummary(rows = []) {
  const functionalCount = rows.filter((row) =>
    row?.source === "functional-derived" ||
    row?.source === "ai-generated"
  ).length;
  const fallbackCount = rows.filter((row) =>
    row?.source === "functional-derived-fallback" ||
    row?.source === "code-derived-fallback"
  ).length;
  const hazardCount = rows.filter((row) => row?.source === "hazard-derived").length;
  const parts = [];
  if (functionalCount) {
    parts.push(`${functionalCount} from functional decomposition`);
  }
  if (fallbackCount) {
    parts.push(`${fallbackCount} functional fallback`);
  }
  if (hazardCount) {
    parts.push(`${hazardCount} from hazard analysis`);
  }
  return parts.length ? ` (${parts.join("; ")})` : "";
}

export default function EngineeringArtifactPanel({
  kind,
  cbaRows = [],
  project,
  repo,
  sourceRows = [],
  focusTarget,
  onFocusResolved,
  onOpenTrace,
  hazardAnalysis = null,
  reviewMode = false,
  initialRows = null,
  initialArtifactCollections = null,
}) {
  const definition = ARTIFACT_DEFINITIONS[kind];
  const projectId = project?.id || "no-project";
  const repoId = repo?.id || repo?.repoId || repo?.repoName || "no-repo";
  const storageKey = useMemo(() => storageKeyFor(kind, projectId, repoId), [kind, projectId, repoId]);
  const [rows, setRows] = useState(() => Array.isArray(initialRows) ? initialRows : loadArtifactRows(kind, projectId, repoId));
  const [loadedStorageKey, setLoadedStorageKey] = useState(storageKey);
  const [parentSourceRows, setParentSourceRows] = useState(sourceRows);
  const [sourceSnapshot, setSourceSnapshot] = useState(sourceRows);
  const [hasLoadedRows, setHasLoadedRows] = useState(false);
  const [isDeriving, setIsDeriving] = useState(false);
  const [deriveMessage, setDeriveMessage] = useState("");
  const { startActivity, updateActivity, finishActivity } = useActivityCenter();
  const [artifactCollections, setArtifactCollections] = useState(() => initialArtifactCollections || ({
    softwareRows: kind === ARTIFACT_KINDS.SOFTWARE ? [] : loadArtifactRows(ARTIFACT_KINDS.SOFTWARE, projectId, repoId),
    systemRows: kind === ARTIFACT_KINDS.SYSTEM ? [] : loadArtifactRows(ARTIFACT_KINDS.SYSTEM, projectId, repoId),
    subsystemRows: kind === ARTIFACT_KINDS.SUBSYSTEM ? [] : loadArtifactRows(ARTIFACT_KINDS.SUBSYSTEM, projectId, repoId),
    designRows: kind === ARTIFACT_KINDS.DESIGN ? [] : loadArtifactRows(ARTIFACT_KINDS.DESIGN, projectId, repoId),
  }));
  const currentSourceRows = kind === ARTIFACT_KINDS.SOFTWARE ? cbaRows : parentSourceRows;
  const sourceRowsSignature = useMemo(() => {
    const list = Array.isArray(sourceRows) ? sourceRows : [];
    return `${list.length}:${list[0]?.id || ""}:${list[list.length - 1]?.id || ""}`;
  }, [sourceRows]);
  const artifactContext = useMemo(() => {
    const softwareRows = kind === ARTIFACT_KINDS.SOFTWARE ? rows : artifactCollections.softwareRows;
    const systemRows = kind === ARTIFACT_KINDS.SYSTEM ? rows : artifactCollections.systemRows;
    const subsystemRows = kind === ARTIFACT_KINDS.SUBSYSTEM ? rows : artifactCollections.subsystemRows;
    const designRows = kind === ARTIFACT_KINDS.DESIGN ? rows : artifactCollections.designRows;
    return {
      softwareRows,
      systemRows,
      subsystemRows,
      designRows,
      softwareRequirements: softwareRows,
      systemRequirements: systemRows,
      subsystemRequirements: subsystemRows,
      designElements: designRows,
    };
  }, [artifactCollections, kind, rows]);
  const displayColumns = useMemo(
    () => columnsForKind(kind, definition.columns),
    [definition.columns, kind]
  );

  useEffect(() => {
    if (Array.isArray(initialRows)) {
      setRows(rowsMatchingKind(initialRows, kind));
      setLoadedStorageKey(storageKey);
      setHasLoadedRows(true);
      return undefined;
    }
    let cancelled = false;
    setHasLoadedRows(false);
    setRows([]);
    setDeriveMessage("");
    loadArtifactRowsAsync(kind, projectId, repoId).then((loadedRows) => {
      if (!cancelled) {
        setRows(rowsMatchingKind(loadedRows, kind));
        setLoadedStorageKey(storageKey);
        setHasLoadedRows(true);
      }
    }).catch(() => {
      if (!cancelled) {
        setLoadedStorageKey(storageKey);
        setHasLoadedRows(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [initialRows, kind, projectId, repoId, storageKey]);

  useEffect(() => {
    if (initialArtifactCollections) {
      setArtifactCollections(initialArtifactCollections);
      return undefined;
    }
    let cancelled = false;
    async function loadArtifactCollections() {
      const [softwareRows, systemRows, subsystemRows, designRows] = await Promise.all([
        loadArtifactRowsAsync(ARTIFACT_KINDS.SOFTWARE, projectId, repoId),
        loadArtifactRowsAsync(ARTIFACT_KINDS.SYSTEM, projectId, repoId),
        loadArtifactRowsAsync(ARTIFACT_KINDS.SUBSYSTEM, projectId, repoId),
        loadArtifactRowsAsync(ARTIFACT_KINDS.DESIGN, projectId, repoId),
      ]);
      if (cancelled) return;
      setArtifactCollections({
        softwareRows: Array.isArray(softwareRows) ? softwareRows : [],
        systemRows: Array.isArray(systemRows) ? systemRows : [],
        subsystemRows: Array.isArray(subsystemRows) ? subsystemRows : [],
        designRows: Array.isArray(designRows) ? designRows : [],
      });
    }
    loadArtifactCollections().catch((error) => {
      console.warn("[code-architecture-assurance] Failed to load linked artifact rows", error);
    });
    const onChanged = (event) => {
      const detail = event?.detail || {};
      loadArtifactCollections().catch(() => {});
      if (
        detail.kind === kind &&
        detail.projectId === projectId &&
        detail.repoId === repoId
      ) {
        loadArtifactRowsAsync(kind, projectId, repoId).then((loadedRows) => {
          setRows(rowsMatchingKind(loadedRows, kind));
          setHasLoadedRows(true);
        }).catch(() => {});
      }
    };
    window.addEventListener("xhandle:code-architecture-assurance:changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("xhandle:code-architecture-assurance:changed", onChanged);
    };
  }, [initialArtifactCollections, kind, projectId, repoId]);

  useEffect(() => {
    if (kind === ARTIFACT_KINDS.SOFTWARE) {
      setParentSourceRows(cbaRows);
      return undefined;
    }

    const sourceKind = definition.sourceKind;
    if (!sourceKind) {
      setParentSourceRows(sourceRows);
      return undefined;
    }

    let cancelled = false;
    if (Array.isArray(sourceRows) && sourceRows.length) {
      setParentSourceRows(sourceRows);
    }
    loadArtifactRowsAsync(sourceKind, projectId, repoId).then((loadedRows) => {
      if (!cancelled && Array.isArray(loadedRows)) {
        setParentSourceRows(loadedRows);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cbaRows, definition.sourceKind, kind, projectId, repoId, sourceRowsSignature]);

  useEffect(() => {
    setSourceSnapshot(currentSourceRows);
  }, [currentSourceRows]);

  useEffect(() => {
    if (reviewMode) return undefined;
    if (!hasLoadedRows || loadedStorageKey !== storageKey) return undefined;
    const timeout = setTimeout(() => {
      saveArtifactRowsAsync(kind, projectId, repoId, rows);
    }, 250);
    return () => clearTimeout(timeout);
  }, [hasLoadedRows, kind, loadedStorageKey, projectId, repoId, rows, storageKey, reviewMode]);

  const {
    reviewItems,
    reviewByRow,
    reviewDrawerOptions,
  } = useArtifactReview({
    rows,
    columns: displayColumns,
    definition,
    projectId,
    repoId,
    setRows,
    enabled: !reviewMode,
  });

  const deriveRows = React.useCallback(async () => {
    const derive = DERIVE_BY_KIND[kind];
    if (!derive) return;
    const source = currentSourceRows;
    const activityId = `code-architecture-assurance:${kind}:${projectId}:${repoId}`;
    const sourceTotal = Array.isArray(source) ? source.length : 0;
    setSourceSnapshot(source);
    setIsDeriving(true);
    const initialMessage = kind === ARTIFACT_KINDS.SOFTWARE
      ? "Deriving software requirements from functional decomposition, then importing hazard-analysis requirements..."
      : `Deriving ${definition.title.toLowerCase()} with AI...`;
    setDeriveMessage(initialMessage);
    startActivity(activityId, {
      title: definition.title,
      step: 0,
      total: sourceTotal,
      message: initialMessage,
    });
    const onProgress = (progress = {}) => {
      const total = Number(progress.total) || sourceTotal || 0;
      const completed = Math.min(total, Math.max(0, Number(progress.completed) || 0));
      const message = progress.message || progress.phase || initialMessage;
      updateActivity(activityId, {
        step: completed,
        total,
        message,
      });
      setDeriveMessage(message);
    };
    try {
      const args = {
        projectName: project?.name || "",
        repoName: repo?.repoName || repo?.repoId || "",
        onProgress,
      };
      let generated = [];
      if (kind === ARTIFACT_KINDS.SOFTWARE) {
        generated = await derive({ ...args, cbaRows: source, hazardAnalysis });
      } else if (kind === ARTIFACT_KINDS.SYSTEM) {
        generated = await derive({ ...args, softwareRequirements: source });
      } else if (kind === ARTIFACT_KINDS.SUBSYSTEM) {
        generated = await derive({ ...args, systemRequirements: source });
      } else {
        generated = await derive({ ...args, subsystemRequirements: source });
      }
      const mergedRows = mergeGeneratedRows(generated, rows, kind);
      setRows(mergedRows);
      setHasLoadedRows(true);
      await saveArtifactRowsAsync(kind, projectId, repoId, mergedRows);
      await clearDownstreamArtifacts(kind, projectId, repoId);
      const sourceSummary = kind === ARTIFACT_KINDS.SOFTWARE ? softwareDerivationSummary(generated) : "";
      const doneMessage = `${generated.length} ${definition.title.toLowerCase()} row${generated.length === 1 ? "" : "s"} derived for review${sourceSummary}.`;
      setDeriveMessage(doneMessage);
      finishActivity(activityId, "success", doneMessage);
    } catch (error) {
      const errorMessage = error?.message || `${definition.title} derivation failed.`;
      setDeriveMessage(errorMessage);
      finishActivity(activityId, "error", errorMessage);
    } finally {
      setIsDeriving(false);
    }
  }, [currentSourceRows, definition.title, finishActivity, hazardAnalysis, kind, project?.name, projectId, repo?.repoId, repo?.repoName, repoId, rows, startActivity, updateActivity]);

  const addRow = React.useCallback(() => {
    setRows((prev) => [
      ...prev,
      createBaseArtifactRow(kind, {}, prev.length),
    ]);
  }, [kind]);

  const updateRow = React.useCallback((id, patch) => {
    setRows((prev) => prev.map((row) => (
      row.id === id ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row
    )));
  }, []);

  const deleteRow = React.useCallback((id) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }, []);

  const clearRows = React.useCallback(async () => {
    if (!rows.length) return;
    const downstreamKinds = DOWNSTREAM_ARTIFACT_KINDS[kind] || [];
    const downstreamLabel = downstreamKinds.length
      ? ` This will also clear derived downstream contents: ${downstreamKinds.map((downstreamKind) => ARTIFACT_DEFINITIONS[downstreamKind]?.title).filter(Boolean).join(", ")}.`
      : "";
    const confirmed = window.confirm(
      `Permanently clear all ${rows.length} ${definition.title.toLowerCase()} row${rows.length === 1 ? "" : "s"} for this repository?${downstreamLabel} This cannot be undone.`,
    );
    if (!confirmed) return;
    setRows([]);
    setHasLoadedRows(true);
    await saveArtifactRowsAsync(kind, projectId, repoId, []);
    await clearDownstreamArtifacts(kind, projectId, repoId);
  }, [definition.title, kind, projectId, repoId, rows.length]);

  const sourceCount = sourceSnapshot.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="shrink-0 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{definition.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{definition.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSourceSnapshot(currentSourceRows)}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Refresh Sources
            </button>
            {!reviewMode && (
              <>
                <button
                  type="button"
                  onClick={deriveRows}
                  disabled={!sourceCount || isDeriving}
                  className="rounded-md bg-[#2D7DFE] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1E61D6] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeriving ? "Deriving..." : definition.deriveButton}
                </button>
                <button
                  type="button"
                  onClick={addRow}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {definition.addButton}
                </button>
                <button
                  type="button"
                  onClick={clearRows}
                  disabled={!rows.length || isDeriving}
                  className="rounded-md border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Clear Contents
                </button>
              </>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
            {definition.sourceLabel}: {sourceCount}
          </span>
        </div>
        {deriveMessage && <div className="mt-2 text-xs font-medium text-slate-600">{deriveMessage}</div>}
      </div>
      <EngineeringArtifactTable
        rows={rows}
        columns={displayColumns}
        onUpdateRow={updateRow}
        onDeleteRow={deleteRow}
        storageKey={storageKey}
        reviewItems={reviewItems}
        reviewByRow={reviewByRow}
        reviewDrawerOptions={reviewDrawerOptions}
        showReview
        showActions={!reviewMode}
        onOpenTrace={onOpenTrace}
        highlightedRowIds={focusTarget?.tab === kind ? focusTarget.rowIds : []}
        onFocusResolved={focusTarget?.tab === kind ? onFocusResolved : undefined}
        emptyMessage={definition.emptyMessage}
        noMatchMessage={definition.noMatchMessage}
        tableContext={artifactContext}
        readOnly={reviewMode}
      />
    </div>
  );
}
