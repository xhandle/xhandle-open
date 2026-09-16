import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, History, ShieldCheck, Trash2, X } from "lucide-react";
import {
  REVIEW_LIFECYCLE_LABELS,
  REVIEW_LIFECYCLE_STATES,
  REVIEW_STATUS_LABELS,
  REVIEW_UNIT_TYPES,
  reviewLifecycleStateForItem,
} from "./reviewTypes";

const clean = (value) => String(value ?? "").trim();

function rowIdentity(item = {}, entry = {}) {
  const rowId = entry.rowId ?? item.currentContent?.rowId ?? item.originalContent?.rowId
    ?? item.traceLinks?.find?.((link) => link.type === "table_row")?.rowId;
  const rowIndex = entry.rowIndex ?? item.currentContent?.rowIndex ?? item.originalContent?.rowIndex
    ?? item.traceLinks?.find?.((link) => link.type === "table_row")?.rowIndex;
  return {
    rowId: clean(rowId),
    rowIndex: Number.isFinite(Number(rowIndex)) ? Number(rowIndex) : null,
  };
}

function activityLabel(entry = {}) {
  if (entry.decision) return clean(entry.decision);
  if (entry.outcome) return clean(entry.outcome);
  return clean(entry.action || "Review activity")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function compactActivityIdentifier(value) {
  const text = clean(value);
  if (!text) return "";
  return text.length > 12 ? `${text.slice(0, 5)}…${text.slice(-5)}` : text;
}

function activityDisplayName(activity = {}) {
  if (activity.kind === "baseline") {
    return [activity.label, compactActivityIdentifier(activity.sourceRunId)].filter(Boolean).join(" · ");
  }
  const identity = activity.rowId
    || (activity.rowIndex !== null ? `Row ${activity.rowIndex + 1}` : "")
    || activity.sessionId
    || activity.id;
  return [activity.label, compactActivityIdentifier(identity)].filter(Boolean).join(" · ");
}

function baselineActivities(items = []) {
  const runs = new Map();
  items.filter((item) => item.reviewUnitType !== REVIEW_UNIT_TYPES.REVIEW_SESSION).forEach((item) => {
    const runKey = item.sourceRunId || `${item.artifactId?.split(":row:")[0] || item.artifactType}:${item.createdAt || "unknown"}`;
    if (!runs.has(runKey)) {
      runs.set(runKey, {
        id: `baseline-${runKey}`,
        kind: "baseline",
        at: item.createdAt || item.updatedAt || "",
        label: "Review baseline captured",
        sourceRunId: item.sourceRunId || "",
        sourceFeature: item.sourceFeature || "",
        sourceMethod: item.sourceMethod || "",
        itemCount: 0,
      });
    }
    runs.get(runKey).itemCount += 1;
  });
  return Array.from(runs.values());
}

export function buildReviewActivityHistory(items = []) {
  const list = Array.isArray(items) ? items : [];
  const activities = list.flatMap((item) => (item.history || []).map((entry, index) => {
    const identity = rowIdentity(item, entry);
    const kind = item.reviewUnitType === REVIEW_UNIT_TYPES.REVIEW_SESSION
      ? "session"
      : entry.action === "review_state_changed"
        ? "state"
        : "decision";
    return {
      id: entry.id || `${item.id}-history-${index}`,
      kind,
      at: entry.at || item.reviewedAt || item.updatedAt || item.createdAt || "",
      label: activityLabel(entry),
      itemLabel: entry.label || item.vibeReview?.label || identity.rowId || (identity.rowIndex !== null ? `Row ${identity.rowIndex + 1}` : ""),
      rowId: identity.rowId,
      rowIndex: identity.rowIndex,
      action: entry.reviewAction || entry.action || "",
      decision: entry.decision || "",
      outcome: entry.outcome || "",
      rationale: entry.rationale || "",
      userFeedback: entry.userFeedback || entry.feedback || "",
      reviewerName: entry.reviewerName || item.currentContent?.reviewerName || item.vibeReview?.reviewerName || "",
      reviewerId: entry.reviewerId || item.reviewerId || item.currentContent?.reviewerId || item.vibeReview?.reviewerId || "",
      provider: entry.provider || item.currentContent?.ai?.provider || "",
      model: entry.model || item.currentContent?.ai?.model || "",
      effort: entry.effort || item.currentContent?.ai?.effort || "",
      sessionId: entry.sessionId || item.currentContent?.sessionId || "",
      scopeLabel: entry.scopeLabel || item.currentContent?.scope || "",
      sourceRunId: item.sourceRunId || item.currentContent?.sourceRunId || "",
      previousReviewState: entry.previousReviewState || "",
      reviewState: entry.reviewState || "",
      before: entry.before,
      after: entry.after,
      summary: entry.summary || null,
      traceUri: entry.traceUri || item.traceLinks?.find?.((link) => link.type === "source_uri")?.uri || "",
      item,
    };
  })).filter((activity) => (
    activity.kind !== "session"
    || !["started", "in_progress"].includes(clean(activity.outcome).toLowerCase())
  ));
  const sessionDecisions = list.flatMap((item) => {
    if (item.reviewUnitType !== REVIEW_UNIT_TYPES.REVIEW_SESSION) return [];
    return (item.currentContent?.decisions || []).map((decision, index) => ({
      id: `${item.id}-decision-${decision.rowId || decision.sourceRowId || index}-${decision.timestamp || index}`,
      kind: "decision",
      at: decision.timestamp || item.updatedAt || item.createdAt || "",
      label: clean(decision.decision || decision.newReviewValue || decision.action || "Decision recorded"),
      itemLabel: decision.label || decision.rowId || decision.sourceRowId || `Row ${index + 1}`,
      rowId: clean(decision.rowId || decision.sourceRowId),
      rowIndex: Number.isFinite(Number(decision.rowIndex)) ? Number(decision.rowIndex) : null,
      action: decision.action || "",
      decision: decision.decision || decision.newReviewValue || "",
      rationale: decision.rationale || decision.proposal?.rationale || "",
      userFeedback: decision.userFeedback || "",
      reviewerName: item.currentContent?.reviewerName || item.vibeReview?.reviewerName || "",
      reviewerId: item.currentContent?.reviewerId || item.reviewerId || item.vibeReview?.reviewerId || "",
      provider: item.currentContent?.ai?.provider || "",
      model: item.currentContent?.ai?.model || "",
      effort: item.currentContent?.ai?.effort || "",
      sessionId: item.currentContent?.sessionId || "",
      scopeLabel: item.currentContent?.scope || "",
      sourceRunId: item.currentContent?.sourceRunId || item.sourceRunId || "",
      before: decision.previousRow,
      after: decision.nextRow,
      item: {
        ...item,
        currentContent: {
          ...(item.currentContent || {}),
          columns: decision.headers || decision.columns || item.currentContent?.columns || [],
        },
      },
    }));
  });
  return [...activities, ...sessionDecisions, ...baselineActivities(list)]
    .sort((a, b) => (Date.parse(b.at || 0) || 0) - (Date.parse(a.at || 0) || 0));
}

export function summarizeReviewActivityHistory(items = [], activities = buildReviewActivityHistory(items)) {
  const decisionActivities = activities.filter((activity) => activity.kind === "decision");
  const sessionItems = items.filter((item) => item.reviewUnitType === REVIEW_UNIT_TYPES.REVIEW_SESSION);
  const reviewedRows = new Set(decisionActivities.map((activity) => activity.rowId || `index:${activity.rowIndex}`).filter(Boolean));
  const traceable = decisionActivities.filter((activity) => activity.traceUri || activity.item?.traceLinks?.some?.((link) => link.type === "table_row"));
  return {
    activityCount: activities.filter((activity) => activity.kind !== "baseline").length,
    decisionCount: decisionActivities.length,
    reviewedRowCount: reviewedRows.size,
    sessionCount: new Set(sessionItems.map((item) => item.currentContent?.sessionId || item.id)).size,
    acceptedProposalCount: decisionActivities.filter((activity) => activity.action === "accept").length,
    humanOverrideCount: decisionActivities.filter((activity) => ["yes", "no", "keep", "revise", "remove"].includes(activity.action)).length,
    undoCount: decisionActivities.filter((activity) => activity.action === "undo").length,
    traceCoverage: decisionActivities.length ? Math.round((traceable.length / decisionActivities.length) * 100) : 0,
  };
}

function humanizeFieldName(value, fallback = "Value") {
  const text = clean(value);
  if (!text) return fallback;
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\bid\b/gi, "ID")
    .replace(/\bai\b/gi, "AI")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function columnName(column, index) {
  if (typeof column === "string") return humanizeFieldName(column, `Column ${index + 1}`);
  if (column && typeof column === "object") {
    return humanizeFieldName(column.label || column.header || column.title || column.name || column.key, `Column ${index + 1}`);
  }
  return `Column ${index + 1}`;
}

function valueSignature(value) {
  if (value === undefined) return "__undefined__";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function readableReviewValue(value, depth = 0) {
  if (value === undefined) return "Not captured";
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value.trim() || "Empty";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "None";
    if (value.every((entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry))) {
      return value.map((entry) => readableReviewValue(entry, depth + 1)).join(" · ");
    }
    return value.map((entry, index) => `${index + 1}. ${readableReviewValue(entry, depth + 1)}`).join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([key]) => !key.startsWith("_"));
    if (!entries.length) return "None";
    if (depth >= 2) return entries.map(([key, nested]) => `${humanizeFieldName(key)}: ${readableReviewValue(nested, depth + 1)}`).join("; ");
    return entries.map(([key, nested]) => `${humanizeFieldName(key)}: ${readableReviewValue(nested, depth + 1)}`).join("\n");
  }
  return String(value);
}

function unwrapComparisonValue(value, item = {}) {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "row")) {
    return { value: value.row, columns: value.columns || item.currentContent?.columns || item.originalContent?.columns || [] };
  }
  return { value, columns: item.currentContent?.columns || item.originalContent?.columns || [] };
}

export function buildReadableEvidenceDiff(before, after, item = {}) {
  const beforeShape = unwrapComparisonValue(before, item);
  const afterShape = unwrapComparisonValue(after, item);
  const columns = beforeShape.columns.length ? beforeShape.columns : afterShape.columns;
  const beforeValue = beforeShape.value;
  const afterValue = afterShape.value;
  let rows = [];

  if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
    const beforeList = Array.isArray(beforeValue) ? beforeValue : [];
    const afterList = Array.isArray(afterValue) ? afterValue : [];
    const length = Math.max(beforeList.length, afterList.length);
    rows = Array.from({ length }, (_, index) => ({
      key: `column-${index}`,
      field: columnName(columns[index], index),
      before: beforeList[index],
      after: afterList[index],
    }));
  } else if (
    (beforeValue && typeof beforeValue === "object")
    || (afterValue && typeof afterValue === "object")
  ) {
    const beforeObject = beforeValue && typeof beforeValue === "object" ? beforeValue : {};
    const afterObject = afterValue && typeof afterValue === "object" ? afterValue : {};
    const keys = Array.from(new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]))
      .filter((key) => !key.startsWith("_"));
    rows = keys.map((key) => ({
      key,
      field: humanizeFieldName(key),
      before: beforeObject[key],
      after: afterObject[key],
    }));
  } else {
    rows = [{ key: "value", field: "Value", before: beforeValue, after: afterValue }];
  }

  const normalized = rows.map((row) => ({
    ...row,
    beforeText: readableReviewValue(row.before),
    afterText: readableReviewValue(row.after),
    changed: valueSignature(row.before) !== valueSignature(row.after),
  }));
  return {
    changed: normalized.filter((row) => row.changed),
    unchanged: normalized.filter((row) => !row.changed),
  };
}

function DiffRows({ rows }) {
  return (
    <div className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
      {rows.map((row) => (
        <div key={row.key} className="grid gap-2 p-3 md:grid-cols-[minmax(9rem,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-3">
          <div className="text-xs font-semibold text-gray-800">{row.field}</div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 md:hidden">Before</div>
            <div className="whitespace-pre-wrap break-words rounded bg-gray-50 px-2 py-1.5 text-xs leading-5 text-gray-700">{row.beforeText}</div>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 md:hidden">After</div>
            <div className="whitespace-pre-wrap break-words rounded bg-blue-50 px-2 py-1.5 text-xs leading-5 text-gray-800">{row.afterText}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EvidenceDiff({ before, after, item, defaultOpen = false }) {
  if (before === undefined && after === undefined) return null;
  const comparison = buildReadableEvidenceDiff(before, after, item);
  return (
    <details open={defaultOpen} className="mt-3 rounded-md border border-gray-200 bg-white">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-gray-700">
        Before / after evidence · {comparison.changed.length} field{comparison.changed.length === 1 ? "" : "s"} changed
      </summary>
      <div className="border-t border-gray-200 p-3">
        <div className="mb-2 hidden grid-cols-[minmax(9rem,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 text-[10px] font-semibold uppercase tracking-wide text-gray-500 md:grid">
          <div>Field</div><div>Before</div><div>After</div>
        </div>
        {comparison.changed.length
          ? <DiffRows rows={comparison.changed} />
          : <div className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">No field-level content change was recorded.</div>}
        {comparison.unchanged.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-gray-600">Show {comparison.unchanged.length} unchanged field{comparison.unchanged.length === 1 ? "" : "s"}</summary>
            <div className="mt-2"><DiffRows rows={comparison.unchanged} /></div>
          </details>
        )}
      </div>
    </details>
  );
}

export default function ReviewActivityHistoryModal({ record, onClose, onOpenSource, onChangeReviewState, onDelete }) {
  const [changingReviewState, setChangingReviewState] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const items = useMemo(() => record?.items || [], [record]);
  const reviewedItems = useMemo(() => items.filter((item) => item.reviewUnitType !== REVIEW_UNIT_TYPES.REVIEW_SESSION), [items]);
  const activities = useMemo(() => buildReviewActivityHistory(items), [items]);
  const summary = useMemo(() => summarizeReviewActivityHistory(items, activities), [items, activities]);
  const sourceRunIds = useMemo(() => Array.from(new Set(items.map((item) => item.sourceRunId).filter(Boolean))), [items]);
  const reviewState = useMemo(() => {
    const states = new Set(reviewedItems.map(reviewLifecycleStateForItem));
    return states.size === 1 ? Array.from(states)[0] : "mixed";
  }, [reviewedItems]);

  const handleReviewStateChange = async (event) => {
    const nextState = event.target.value;
    if (!onChangeReviewState || !Object.values(REVIEW_LIFECYCLE_STATES).includes(nextState)) return;
    setChangingReviewState(true);
    try {
      await onChangeReviewState(nextState);
    } finally {
      setChangingReviewState(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || deleting) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!record) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, record]);

  if (!record) return null;
  return (
    <div className="fixed bottom-0 left-0 right-[var(--xhandle-collaborator-reserved-width)] top-14 z-[90] flex min-w-0 items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-label="Review Activity History">
      <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-lg font-semibold text-gray-950"><History size={19} /> Review Activity History</div>
            <div className="mt-1 text-sm font-medium text-gray-700">{record.recordName || `${record.projectName} · ${record.materialType}`}</div>
            {record.recordName && <div className="mt-0.5 text-xs text-gray-500">{record.projectName} · {record.materialType}</div>}
            <div className="mt-1 break-all text-xs text-gray-500">Artifact: {record.artifactRoot || "Unknown"}</div>
          </div>
          <div className="flex shrink-0 items-end gap-3">
            {reviewedItems.length > 0 && onChangeReviewState && (
              <label className="text-xs font-semibold text-gray-600">
                <span className="mb-1 block">Review state</span>
                <select
                  aria-label="Review state"
                  className="min-w-36 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 disabled:cursor-wait disabled:opacity-60"
                  value={reviewState}
                  disabled={changingReviewState}
                  onChange={handleReviewStateChange}
                >
                  {reviewState === "mixed" && <option value="mixed" disabled>Mixed states</option>}
                  {Object.values(REVIEW_LIFECYCLE_STATES).map((state) => (
                    <option key={state} value={state}>
                      {state === REVIEW_LIFECYCLE_STATES.OPEN && reviewState !== REVIEW_LIFECYCLE_STATES.OPEN ? "Re-open" : REVIEW_LIFECYCLE_LABELS[state]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {onDelete && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
                disabled={deleting}
                onClick={handleDelete}
              >
                <Trash2 size={14} /> {deleting ? "Deleting..." : "Delete record"}
              </button>
            )}
            <button type="button" className="rounded-md p-2 text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="Close review activity history"><X size={18} /></button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <section className="mb-4 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-950"><ShieldCheck size={16} /> Quality assurance summary</div>
              {[
                [summary.activityCount, "Recorded activities"],
                [summary.reviewedRowCount, "Rows reviewed"],
                [summary.sessionCount, "Review sessions"],
                [`${summary.traceCoverage}%`, "Decision trace coverage"],
              ].map(([value, label]) => (
                <div key={label} className="text-xs text-gray-600"><span className="font-semibold text-gray-950">{value}</span> {label.toLowerCase()}</div>
              ))}
            </div>
            <div className="mt-1.5 truncate text-[11px] text-gray-600" title={sourceRunIds.join(", ")}>
              {summary.acceptedProposalCount} AI proposal{summary.acceptedProposalCount === 1 ? "" : "s"} accepted · {summary.humanOverrideCount} explicit human override{summary.humanOverrideCount === 1 ? "" : "s"} · {summary.undoCount} undo operation{summary.undoCount === 1 ? "" : "s"}
              {sourceRunIds.length ? ` · Source runs: ${sourceRunIds.join(", ")}` : ""}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="font-semibold text-gray-950">Chronological review record</div>
              <div className="text-xs text-gray-500">Newest first</div>
            </div>
            <div className="space-y-2">
              {activities.map((activity) => (
                <article key={activity.id} className={`overflow-hidden rounded-md border ${activity.kind === "session" ? "border-violet-200 bg-violet-50/50" : activity.kind === "state" ? "border-blue-200 bg-blue-50/40" : activity.kind === "baseline" ? "border-gray-200 bg-gray-50" : "border-emerald-200 bg-emerald-50/40"}`}>
                  {activity.kind === "baseline" ? (
                    <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
                      <CheckCircle2 size={13} className="shrink-0" />
                      <span className="truncate text-xs font-semibold text-gray-900" title={activityDisplayName(activity)}>{activityDisplayName(activity)}</span>
                      <span className="truncate text-[10px] text-gray-500">· {activity.itemCount} row{activity.itemCount === 1 ? "" : "s"} registered</span>
                      <time className="ml-auto shrink-0 text-[10px] text-gray-500">{activity.at ? new Date(activity.at).toLocaleString() : "Time unavailable"}</time>
                    </div>
                  ) : activity.kind === "decision" ? (
                    <div className="bg-white/70 px-3 py-3">
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-gray-950">{activity.itemLabel || activityDisplayName(activity)}</div>
                          <div className="mt-0.5 text-xs text-gray-700">
                            <span className="font-semibold">Decision:</span> {activity.decision || activityLabel(activity)}
                            {activity.action ? ` · ${activity.action.replace(/[_-]+/g, " ")}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[11px] text-gray-600">
                          <div className="font-semibold text-gray-800">{activity.reviewerName || activity.reviewerId || "Reviewer unavailable"}</div>
                          <time>{activity.at ? new Date(activity.at).toLocaleString() : "Time unavailable"}</time>
                        </div>
                      </div>
                      <EvidenceDiff before={activity.before} after={activity.after} item={activity.item} defaultOpen />
                      {activity.rationale && <div className="mt-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm leading-5 text-gray-800"><span className="font-semibold">Supporting rationale:</span> {activity.rationale}</div>}
                      {activity.userFeedback && <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"><span className="font-semibold">Reviewer feedback:</span> {activity.userFeedback}</div>}
                      {onOpenSource && <button type="button" className="mt-2 inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50" onClick={() => onOpenSource(activity.item)}><ExternalLink size={14} /> Jump to reviewed source</button>}
                    </div>
                  ) : (
                    <details>
                      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 marker:hidden">
                        <CheckCircle2 size={13} className="shrink-0" />
                        <span className="shrink-0 text-xs font-semibold text-gray-950" title={activityDisplayName(activity)}>{activityDisplayName(activity)}</span>
                        {activity.itemLabel && <span className="truncate text-[11px] text-gray-600" title={activity.itemLabel}>· {activity.itemLabel}</span>}
                        <time className="ml-auto shrink-0 text-[10px] text-gray-500">{activity.at ? new Date(activity.at).toLocaleString() : "Time unavailable"}</time>
                        <span className="shrink-0 text-[10px] font-semibold text-blue-700">Details</span>
                      </summary>
                      <div className="border-t border-gray-200/80 bg-white/70 px-3 py-2">
                        <div className="flex flex-wrap gap-1.5 text-[10px]">
                          {activity.rowId && <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">Row ID: {activity.rowId}</span>}
                          {activity.rowIndex !== null && <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">Row {activity.rowIndex + 1}</span>}
                          {activity.sessionId && <span className="rounded-full border border-violet-200 bg-white px-2 py-0.5">Session: {activity.sessionId}</span>}
                          {(activity.provider || activity.model || activity.effort) && <span className="rounded-full border border-blue-200 bg-white px-2 py-0.5">AI: {[activity.provider, activity.model, activity.effort].filter(Boolean).join(" · ")}</span>}
                          {activity.action && <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5">Action: {activity.action}</span>}
                          {(activity.reviewerName || activity.reviewerId) && <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">Reviewer: {activity.reviewerName || activity.reviewerId}</span>}
                          {activity.item && activity.kind === "decision" && <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">Review state: {REVIEW_LIFECYCLE_LABELS[reviewLifecycleStateForItem(activity.item)]}</span>}
                          {activity.item?.status && activity.kind === "decision" && <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">Disposition: {REVIEW_STATUS_LABELS[activity.item.status] || activity.item.status}</span>}
                        </div>

                        {activity.previousReviewState && activity.reviewState && (
                          <div className="mt-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-950">
                            Review state changed from <span className="font-semibold">{REVIEW_LIFECYCLE_LABELS[activity.previousReviewState] || activity.previousReviewState}</span> to <span className="font-semibold">{REVIEW_LIFECYCLE_LABELS[activity.reviewState] || activity.reviewState}</span>.
                          </div>
                        )}
                        {activity.scopeLabel && <div className="mt-2 text-xs text-gray-700"><span className="font-semibold">Review scope:</span> {activity.scopeLabel}</div>}
                        {activity.rationale && <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-800"><span className="font-semibold">Rationale:</span> {activity.rationale}</div>}
                        {activity.userFeedback && <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><span className="font-semibold">Reviewer feedback:</span> {activity.userFeedback}</div>}
                        {activity.summary && <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-gray-700"><span className="font-semibold">Session result:</span> {readableReviewValue(activity.summary)}</div>}
                        <EvidenceDiff before={activity.before} after={activity.after} item={activity.item} />

                        {activity.kind === "decision" && activity.item && (
                          <button type="button" className="mt-2 inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50" onClick={() => onOpenSource?.(activity.item)}>
                            <ExternalLink size={14} /> Jump to reviewed source
                          </button>
                        )}
                      </div>
                    </details>
                  )}
                </article>
              ))}
              {!activities.length && (
                <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-600">No review activity has been recorded for this artifact yet.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
