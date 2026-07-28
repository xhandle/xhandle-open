import React, { useEffect, useMemo, useRef, useState } from "react";
import { FilterableHeaderCell, useColumnFilters } from "../../components/FilterableTableHeader";
import { REVIEW_STATUSES } from "../results-review/reviewTypes";
import ReviewStatusBadge from "../results-review/ReviewStatusBadge";
import ColumnVisibilityMenu from "../code-architecture-assurance/ColumnVisibilityMenu";

const HIDDEN_SUMMARY_COLUMNS = new Set([
  "from node id",
  "control edge id",
  "to node id",
  "architecture row ref",
  "source symbols",
  "source line ranges",
]);

const MIN_COLUMN_WIDTH = 120;
const MAX_COLUMN_WIDTH = 720;

function clampColumnWidth(value, fallback = 180) {
  const numeric = Number(value);
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 180;
  if (!Number.isFinite(numeric)) return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, safeFallback));
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(numeric)));
}

function normalizeColumnWidths(defaultWidths = {}, savedWidths = {}) {
  return Object.fromEntries(Object.entries(defaultWidths).map(([key, fallback]) => [
    key,
    clampColumnWidth(savedWidths?.[key], fallback),
  ]));
}

export default function CodeArchitectureHazardSummaryTable({
  summarySheet,
  className = "",
  reviewItems = [],
  reviewByRow,
  reviewDrawerOptions = {},
  showReview = true,
  highlightedRowIndex = null,
  storageKey = "code-architecture-hazard-summary:latest",
  onOpenArchitectureTarget,
  onDeleteRow,
  readOnly = false,
}) {
  const rowRefs = useRef({});
  const [focusedRowIndex, setFocusedRowIndex] = useState(null);

  useEffect(() => {
    if (highlightedRowIndex === null || highlightedRowIndex === undefined || highlightedRowIndex === "") return;
    const targetIndex = Number(highlightedRowIndex);
    if (!Number.isFinite(targetIndex)) return;
    setFocusedRowIndex(targetIndex);
  }, [highlightedRowIndex]);

  useEffect(() => {
    if (highlightedRowIndex === null || highlightedRowIndex === undefined || highlightedRowIndex === "") return;
    const targetIndex = Number(highlightedRowIndex);
    if (!Number.isFinite(targetIndex)) return;
    const rowEl = rowRefs.current[targetIndex];
    rowEl?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [highlightedRowIndex, focusedRowIndex]);

  const headers = React.useMemo(
    () => (Array.isArray(summarySheet?.[0]) ? summarySheet[0] : []),
    [summarySheet]
  );
  const rows = React.useMemo(
    () => (Array.isArray(summarySheet) ? summarySheet.slice(1) : []),
    [summarySheet]
  );
  const rowItems = React.useMemo(
    () => rows.map((row, rowIndex) => ({ row, rowIndex })),
    [rows]
  );
  const headerIndexByName = React.useMemo(() => {
    const map = new Map();
    headers.forEach((header, index) => {
      const key = String(header || "").trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, index);
    });
    return map;
  }, [headers]);
  const getCellByHeader = React.useCallback((row, headerName) => {
    const index = headerIndexByName.get(String(headerName || "").trim().toLowerCase());
    return index >= 0 ? String(row?.[index] ?? "").trim() : "";
  }, [headerIndexByName]);
  const columnOptions = React.useMemo(
    () => headers.map((header, index) => ({
      key: String(index),
      header,
      label: header || `Column ${index + 1}`,
      index,
    })),
    [headers]
  );
  const defaultHiddenColumnKeys = React.useMemo(
    () => columnOptions
      .filter(({ header }) => HIDDEN_SUMMARY_COLUMNS.has(String(header || "").trim().toLowerCase()))
      .map((column) => column.key),
    [columnOptions]
  );
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`${storageKey}:hidden-columns`) || "null");
      return Array.isArray(saved) ? saved : defaultHiddenColumnKeys;
    } catch {
      return defaultHiddenColumnKeys;
    }
  });
  React.useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`${storageKey}:hidden-columns`) || "null");
      setHiddenColumnKeys(Array.isArray(saved) ? saved : defaultHiddenColumnKeys);
    } catch {
      setHiddenColumnKeys(defaultHiddenColumnKeys);
    }
  }, [defaultHiddenColumnKeys, storageKey]);
  React.useEffect(() => {
    if (readOnly) return;
    try {
      localStorage.setItem(`${storageKey}:hidden-columns`, JSON.stringify(hiddenColumnKeys));
    } catch {}
  }, [hiddenColumnKeys, storageKey, readOnly]);
  const hiddenColumnSet = React.useMemo(() => new Set(hiddenColumnKeys), [hiddenColumnKeys]);
  const visibleColumns = React.useMemo(() => {
    const visible = columnOptions.filter((column) => !hiddenColumnSet.has(column.key));
    return visible.length ? visible : columnOptions.slice(0, 1);
  }, [columnOptions, hiddenColumnSet]);
  const getFilterCell = React.useCallback((item, columnIndex) => {
    const column = visibleColumns[columnIndex];
    return column ? item?.row?.[column.index] ?? "" : "";
  }, [visibleColumns]);
  const filterState = useColumnFilters(rowItems, getFilterCell);
  const defaultColumnWidths = useMemo(() => {
    const widthFor = (header) => {
      const text = String(header || "").toLowerCase();
      if (/details|rationale|cause|mitigation|requirement|hazardous event|description|effect|scenario/.test(text)) return 420;
      if (/related source|source symbols|source line|file/.test(text)) return 300;
      if (/function \(from\)|function \(to\)|control action|hazard|failure mode|risk/.test(text)) return 240;
      if (/subsystem|csci|csc|csu|architecture/.test(text)) return 220;
      return 180;
    };
    return Object.fromEntries(headers.map((header, index) => [String(index), widthFor(header)]));
  }, [headers]);
  const [columnWidths, setColumnWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`${storageKey}:column-widths`) || "{}");
      return normalizeColumnWidths(defaultColumnWidths, saved && typeof saved === "object" ? saved : {});
    } catch {
      return normalizeColumnWidths(defaultColumnWidths);
    }
  });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`${storageKey}:column-widths`) || "{}");
      setColumnWidths(normalizeColumnWidths(defaultColumnWidths, saved && typeof saved === "object" ? saved : {}));
    } catch {
      setColumnWidths(normalizeColumnWidths(defaultColumnWidths));
    }
  }, [defaultColumnWidths, storageKey]);
  useEffect(() => {
    if (readOnly) return;
    try {
      localStorage.setItem(`${storageKey}:column-widths`, JSON.stringify(columnWidths));
    } catch {}
  }, [columnWidths, storageKey, readOnly]);
  const handleColumnResizeStart = React.useCallback((event, columnIndex) => {
    event.preventDefault();
    event.stopPropagation();
    const column = visibleColumns[columnIndex];
    const key = column?.key || String(columnIndex);
    const startX = event.clientX;
    const startWidth = columnWidths[key] || defaultColumnWidths[key] || 180;
    const onMouseMove = (moveEvent) => {
      setColumnWidths((prev) => ({
        ...prev,
        [key]: clampColumnWidth(startWidth + moveEvent.clientX - startX, startWidth),
      }));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [columnWidths, defaultColumnWidths, visibleColumns]);
  const actionsColumnWidth = onDeleteRow && !readOnly ? 110 : 0;
  const reviewColumnWidth = showReview && reviewItems.length > 0 ? 110 : 0;
  const tablePixelWidth = visibleColumns.reduce(
    (sum, { key, index }) => sum + (columnWidths[key] || defaultColumnWidths[String(index)] || 180),
    actionsColumnWidth + reviewColumnWidth
  );
  const traceLinkClass = "whitespace-pre-wrap break-words text-left font-semibold text-[#2D7DFE] underline decoration-[#2D7DFE]/30 underline-offset-2 hover:text-[#1E61D6]";
  const traceColumnType = React.useCallback((header) => {
    const normalized = String(header || "").trim().toLowerCase();
    if (normalized === "function (from)") return "from";
    if (normalized === "control action") return "action";
    if (normalized === "function (to)") return "to";
    return "";
  }, []);
  const buildTraceTarget = React.useCallback((row, type) => {
    const rowRefText = getCellByHeader(row, "Architecture Row Ref");
    const rowRefNumber = Number(rowRefText);
    const rowIndex = Number.isFinite(rowRefNumber) ? rowRefNumber - 1 : NaN;
    const fromFunction = getCellByHeader(row, "Function (From)");
    const controlAction = getCellByHeader(row, "Control Action");
    const toFunction = getCellByHeader(row, "Function (To)");
    const fromNodeId = getCellByHeader(row, "From Node ID");
    const edgeId = getCellByHeader(row, "Control Edge ID");
    const toNodeId = getCellByHeader(row, "To Node ID");
    return {
      type: type === "action" ? "edge" : "node",
      mode: type === "from" ? "from" : type === "to" ? "to" : "edge",
      rowIndex,
      rowRef: rowRefText,
      traceId: getCellByHeader(row, "Trace ID"),
      nodeId: type === "from" ? fromNodeId : type === "to" ? toNodeId : "",
      edgeId: type === "action" ? edgeId : "",
      fromNodeId,
      toNodeId,
      functionName: type === "from" ? fromFunction : type === "to" ? toFunction : "",
      fromFunction,
      controlAction,
      toFunction,
      fromFile: getCellByHeader(row, "Related Source File(s)"),
      toFile: getCellByHeader(row, "Related Source File(s)"),
    };
  }, [getCellByHeader]);
  const filteredRowItems = filterState.filteredRows;
  const visibleRows = filteredRowItems;

  if (!Array.isArray(summarySheet) || summarySheet.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
        No code architecture hazard summary has been generated yet.
      </div>
    );
  }

  return (
    <div className={`${className || "max-h-80"} flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white`}>
      <div className="flex shrink-0 items-center justify-end border-b border-slate-100 bg-white px-3 py-2">
        <ColumnVisibilityMenu
          columns={columnOptions.map((column) => ({ key: column.key, label: column.label }))}
          hiddenKeys={hiddenColumnKeys}
          onChange={setHiddenColumnKeys}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
      <table className="table-fixed text-left text-sm" style={{ minWidth: tablePixelWidth }}>
        <colgroup>
          {onDeleteRow && !readOnly && <col style={{ width: actionsColumnWidth, minWidth: actionsColumnWidth }} />}
          {showReview && reviewItems.length > 0 && <col style={{ width: reviewColumnWidth, minWidth: reviewColumnWidth }} />}
          {visibleColumns.map(({ key, index }) => (
            <col
              key={key}
              style={{
                width: columnWidths[key] || defaultColumnWidths[String(index)] || 180,
                minWidth: 120,
              }}
            />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            {onDeleteRow && !readOnly && (
              <th className="border-b border-slate-200 px-3 py-2" style={{ width: actionsColumnWidth, minWidth: actionsColumnWidth }}>
                Actions
              </th>
            )}
            {showReview && reviewItems.length > 0 && (
              <th className="border-b border-slate-200 px-3 py-2" style={{ width: reviewColumnWidth, minWidth: reviewColumnWidth }}>
                Review
              </th>
            )}
            {visibleColumns.map(({ header, key, index }, visibleIndex) => (
              <FilterableHeaderCell
                key={`${header}-${index}`}
                label={header || `Column ${index + 1}`}
                index={visibleIndex}
                className="border-b border-slate-200 bg-slate-50 px-3 py-2"
                style={{
                  width: columnWidths[key] || defaultColumnWidths[String(index)] || 180,
                  minWidth: 120,
                }}
                filterState={filterState}
                onResizeStart={handleColumnResizeStart}
              />
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {visibleRows.map(({ row, rowIndex }) => {
            const reviewItem = reviewByRow?.get?.(rowIndex) || null;
            const rejected = reviewItem?.status === REVIEW_STATUSES.REJECTED;
            const highlighted = highlightedRowIndex === rowIndex;
            return (
              <tr
                key={rowIndex}
                ref={(el) => {
                  if (el) rowRefs.current[rowIndex] = el;
                  else delete rowRefs.current[rowIndex];
                }}
                className={`align-top transition-colors ${
                  highlighted
                    ? "bg-[#FFF7D6] ring-2 ring-[#F3B63F] ring-inset"
                    : rejected
                      ? "bg-rose-50/60"
                      : ""
                }`}
              >
                {onDeleteRow && !readOnly && (
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                      onClick={() => onDeleteRow(rowIndex)}
                    >
                      Delete
                    </button>
                  </td>
                )}
                {showReview && reviewItems.length > 0 && (
                  <td className="px-3 py-2">
                    <ReviewStatusBadge
                      reviewItem={reviewItem}
                      openOptions={{
                        ...reviewDrawerOptions,
                        reviewItemIds: reviewItems.map((item) => item.id),
                      }}
                    />
                  </td>
                )}
                {visibleColumns.map(({ header, index: colIndex }) => {
                  const traceType = traceColumnType(header);
                  const value = String(row?.[colIndex] ?? "");
                  return (
                  <td key={`${rowIndex}-${colIndex}`} className={`whitespace-pre-wrap break-words px-3 py-2 text-slate-700 ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}>
                    {traceType && value ? (
                      <button
                        type="button"
                        className={traceLinkClass}
                        title="Open this trace in the CSU diagram view"
                        onClick={() => onOpenArchitectureTarget?.(buildTraceTarget(row, traceType))}
                      >
                        {value}
                      </button>
                    ) : value}
                  </td>
                );})}
              </tr>
            );
          })}
        </tbody>
      </table>
      {filteredRowItems.length === 0 && (
        <div className="border-t border-slate-100 px-3 py-6 text-center text-sm text-slate-500">
          No hazard rows match the active column filters.
        </div>
      )}
      {filterState.activeFilterCount > 0 && filteredRowItems.length < rows.length && (
        <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
          {filteredRowItems.length} of {rows.length} rows match active filters.
          <button type="button" className="ml-2 font-medium text-[#2D7DFE]" onClick={filterState.clearAllFilters}>
            Clear filters
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
