import React, { useEffect, useMemo, useRef, useState } from "react";
import { FilterableHeaderCell, useColumnFilters } from "../../components/FilterableTableHeader";
import ReviewStatusBadge from "../results-review/ReviewStatusBadge";
import { REVIEW_STATUSES } from "../results-review/reviewTypes";
import ColumnVisibilityMenu from "./ColumnVisibilityMenu";
import {
  architectureRefsLabel,
  cellText,
  enrichRowForDisplay,
  parentIdsFromRow,
  rowIdentity,
  splitIds,
} from "./artifactUtils";

const MIN_COLUMN_WIDTH = 120;
const MAX_COLUMN_WIDTH = 720;

const PARENT_LINK_FIELDS = {
  parentSwRequirement: "software-requirement",
  parentSystemRequirement: "system-requirement",
  parentRequirement: "subsystem-requirement",
};

function valueForColumn(row, column, context) {
  if (typeof column.getValue === "function") return column.getValue(row, context);
  if (column.key === "architectureSource") return architectureRefsLabel(row.sourceArchitectureRefs);
  if (PARENT_LINK_FIELDS[column.key]) {
    return cellText(row?.[column.key]) || parentIdsFromRow(row, column.key, PARENT_LINK_FIELDS[column.key]).join(", ");
  }
  return row?.[column.key];
}

function AutoResizeTextarea({
  value,
  onChange,
  onBlur,
  autoFocus = false,
  disabled = false,
  minRows = 1,
  className = "",
}) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if (!autoFocus) return;
    const node = ref.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange?.(node.value.length, node.value.length);
  }, [autoFocus]);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      className={`w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-slate-200 focus:border-[#2D7DFE] focus:bg-white ${className}`}
      disabled={disabled}
    />
  );
}

function rowFocusAliases(row = {}, rowIndex = 0) {
  return [
    row.id,
    row.internalId,
    rowIdentity(row, rowIndex),
    row.sourceTraceId,
    row.hazardSummaryRef,
  ].map((value) => String(value || "").trim()).filter(Boolean);
}

function rowMatchesFocus(row = {}, rowIndex = 0, highlightedSet = new Set()) {
  return rowFocusAliases(row, rowIndex).some((id) => highlightedSet.has(id));
}

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

export default function EngineeringArtifactTable({
  rows = [],
  columns = [],
  onUpdateRow,
  onDeleteRow,
  storageKey = "engineering-artifact-table:latest",
  reviewItems = [],
  reviewByRow,
  reviewDrawerOptions = {},
  onOpenTrace,
  highlightedRowIds = [],
  onFocusResolved,
  emptyMessage = "No rows yet.",
  noMatchMessage = "No rows match the active column filters.",
  showActions = true,
  showReview = true,
  readOnly = false,
  tableContext = {},
}) {
  const rowRefs = useRef({});
  const highlightedSet = useMemo(
    () => new Set((Array.isArray(highlightedRowIds) ? highlightedRowIds : []).map((id) => String(id))),
    [highlightedRowIds]
  );
  const displayRows = useMemo(
    () => rows.map((row, rowIndex) => ({ row: enrichRowForDisplay(row), rowIndex })),
    [rows]
  );
  const columnOptions = useMemo(
    () => columns.map((column, index) => ({
      ...column,
      originalIndex: index,
      visibilityKey: column.key || String(index),
    })),
    [columns]
  );
  const defaultHiddenColumns = useMemo(() => [], []);
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`${storageKey}:hidden-columns`) || "[]");
      return Array.isArray(saved) ? saved : defaultHiddenColumns;
    } catch {
      return defaultHiddenColumns;
    }
  });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`${storageKey}:hidden-columns`) || "[]");
      setHiddenColumnKeys(Array.isArray(saved) ? saved : defaultHiddenColumns);
    } catch {
      setHiddenColumnKeys(defaultHiddenColumns);
    }
  }, [defaultHiddenColumns, storageKey]);
  useEffect(() => {
    if (readOnly) return;
    try {
      localStorage.setItem(`${storageKey}:hidden-columns`, JSON.stringify(hiddenColumnKeys));
    } catch {}
  }, [hiddenColumnKeys, storageKey, readOnly]);
  const hiddenColumnSet = useMemo(() => new Set(hiddenColumnKeys), [hiddenColumnKeys]);
  const visibleColumns = useMemo(() => {
    const visible = columnOptions.filter((column) => !hiddenColumnSet.has(column.visibilityKey));
    return visible.length ? visible : columnOptions.slice(0, 1);
  }, [columnOptions, hiddenColumnSet]);
  const getFilterCell = React.useCallback((item, columnIndex) => {
    const column = visibleColumns[columnIndex];
    return column ? valueForColumn(item?.row, column, tableContext) ?? "" : "";
  }, [visibleColumns, tableContext]);
  const filterState = useColumnFilters(displayRows, getFilterCell);

  const defaultColumnWidths = useMemo(() => (
    Object.fromEntries(columnOptions.map((column) => [column.visibilityKey, column.width || 180]))
  ), [columnOptions]);
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
    const key = column?.visibilityKey || String(columnIndex);
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

  const reviewColumnWidth = showReview && reviewItems.length > 0 ? 110 : 0;
  const actionsColumnWidth = showActions ? 110 : 0;
  const tablePixelWidth = visibleColumns.reduce(
    (sum, column) => sum + (columnWidths[column.visibilityKey] || column.width || 180),
    reviewColumnWidth + actionsColumnWidth
  );
  const visibleRows = filterState.filteredRows;
  const [editingCellKey, setEditingCellKey] = useState("");
  useEffect(() => {
    if (!highlightedSet.size || !filterState.activeFilterCount) return;
    const visibleMatch = visibleRows.some(({ row, rowIndex }) => rowMatchesFocus(row, rowIndex, highlightedSet));
    if (visibleMatch) return;
    const hiddenMatch = displayRows.some(({ row, rowIndex }) => rowMatchesFocus(row, rowIndex, highlightedSet));
    if (hiddenMatch) filterState.clearAllFilters();
  }, [displayRows, filterState, highlightedSet, visibleRows]);
  useEffect(() => {
    if (!highlightedSet.size) return;
    const target = visibleRows.find(({ row, rowIndex }) => rowMatchesFocus(row, rowIndex, highlightedSet));
    if (!target) return;
    const aliases = rowFocusAliases(target.row, target.rowIndex);
    const node = aliases.map((id) => rowRefs.current[id]).find(Boolean);
    if (!node) return;
    const scroll = () => node.scrollIntoView?.({ behavior: "smooth", block: "center" });
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(scroll);
    else setTimeout(scroll, 0);
    onFocusResolved?.(rowFocusAliases(target.row, target.rowIndex));
  }, [highlightedSet, onFocusResolved, visibleRows]);
  const reviewItemIds = useMemo(() => reviewItems.map((item) => item.id), [reviewItems]);
  const thBase = "border-b border-slate-200 bg-slate-50 px-3 py-2";
  const tdBase = "border-b border-slate-100 px-3 py-2 align-top text-[13px] text-slate-800";

  const updateCell = React.useCallback((row, key, value) => {
    if (!row || !key || readOnly) return;
    onUpdateRow?.(row.id, { [key]: value });
  }, [onUpdateRow, readOnly]);

  const editableCellButtonClass = "block min-h-[34px] w-full whitespace-pre-wrap break-words rounded-md border border-transparent px-2 py-1 text-left text-xs text-slate-700 hover:border-slate-200 hover:bg-slate-50 focus:border-[#2D7DFE] focus:outline-none focus:ring-2 focus:ring-blue-100";

  return (
    <div className="min-h-0 flex flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex shrink-0 items-center justify-end border-b border-slate-100 bg-white px-3 py-2">
        <ColumnVisibilityMenu
          columns={columnOptions.map((column) => ({
            key: column.visibilityKey,
            label: column.label,
          }))}
          hiddenKeys={hiddenColumnKeys}
          onChange={setHiddenColumnKeys}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
      <table className="table-fixed text-left text-sm" style={{ minWidth: tablePixelWidth }}>
        <colgroup>
          {showActions && <col style={{ width: actionsColumnWidth, minWidth: actionsColumnWidth }} />}
          {showReview && reviewItems.length > 0 && <col style={{ width: reviewColumnWidth, minWidth: reviewColumnWidth }} />}
          {visibleColumns.map((column) => (
            <col
              key={column.visibilityKey}
              style={{
                width: columnWidths[column.visibilityKey] || column.width || 180,
                minWidth: 120,
              }}
            />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            {showActions && <th className={thBase}>Actions</th>}
            {showReview && reviewItems.length > 0 && (
              <th className={thBase} style={{ width: reviewColumnWidth, minWidth: reviewColumnWidth }}>Review</th>
            )}
            {visibleColumns.map((column, index) => (
              <FilterableHeaderCell
                key={column.visibilityKey}
                label={column.label}
                index={index}
                className={thBase}
                style={{
                  width: columnWidths[column.visibilityKey] || column.width || 180,
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
            const rowId = rowIdentity(row, rowIndex);
            const reviewItem = reviewByRow?.get?.(rowId) || reviewByRow?.get?.(rowIndex) || null;
            const rejected = reviewItem?.status === REVIEW_STATUSES.REJECTED;
            const highlighted = rowMatchesFocus(row, rowIndex, highlightedSet);
            return (
              <tr
                key={rowId}
                ref={(node) => {
                  if (node) {
                    rowFocusAliases(row, rowIndex).forEach((id) => {
                      rowRefs.current[id] = node;
                    });
                  }
                }}
                className={`align-top transition-colors ${
                  highlighted ? "bg-[#FFF7D6] ring-2 ring-[#F3B63F] ring-inset" : rejected ? "bg-rose-50/60" : ""
                }`}
              >
                {showActions && (
                  <td className={tdBase}>
                    {!readOnly && (
                      <button
                        type="button"
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                        onClick={() => onDeleteRow?.(row.id)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                )}
                {showReview && reviewItems.length > 0 && (
                  <td className={tdBase}>
                    <ReviewStatusBadge
                      reviewItem={reviewItem}
                      openOptions={{
                        ...reviewDrawerOptions,
                        reviewItemIds,
                      }}
                    />
                  </td>
                )}
                {visibleColumns.map((column) => {
                  const value = cellText(valueForColumn(row, column, tableContext));
                  const tokens = splitIds(value);
                  const canLink = column.linkType && tokens.length > 0;
                  const editable = !readOnly && !column.readOnly && !column.getValue;
                  const cellKey = `${rowId}:${column.key}`;
                  const isEditing = editable && editingCellKey === cellKey;
                  return (
                    <td key={`${rowId}-${column.key}`} className={`${tdBase} ${rejected ? "text-rose-900" : ""}`}>
                      {canLink ? (
                        <div className="flex flex-wrap gap-1">
                          {tokens.map((token, tokenIndex) => (
                            <button
                              key={`${token}-${tokenIndex}`}
                              type="button"
                              className="max-w-full whitespace-normal break-words rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-left text-xs font-semibold text-blue-700 underline-offset-2 hover:bg-blue-100 hover:underline"
                              onClick={() => onOpenTrace?.({ linkType: column.linkType, value: token, row, column })}
                            >
                              {token}
                            </button>
                          ))}
                        </div>
                      ) : column.readOnly || readOnly ? (
                        <span className="block whitespace-pre-wrap break-words text-xs text-slate-600">{value}</span>
                      ) : isEditing && column.longText ? (
                        <AutoResizeTextarea
                          minRows={2}
                          value={value}
                          onChange={(event) => updateCell(row, column.key, event.target.value)}
                          onBlur={() => setEditingCellKey("")}
                          autoFocus
                          className="min-h-[54px]"
                          disabled={!editable}
                        />
                      ) : isEditing ? (
                        <AutoResizeTextarea
                          minRows={1}
                          value={value}
                          onChange={(event) => updateCell(row, column.key, event.target.value)}
                          onBlur={() => setEditingCellKey("")}
                          autoFocus
                          disabled={!editable}
                        />
                      ) : (
                        <button
                          type="button"
                          className={`${editableCellButtonClass} ${column.longText ? "min-h-[54px]" : ""}`}
                          onClick={() => setEditingCellKey(cellKey)}
                          title={value}
                        >
                          {value || <span className="text-slate-400">Click to edit</span>}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {visibleRows.length === 0 && (
            <tr>
              <td
                className="px-3 py-8 text-center text-sm text-slate-500"
                colSpan={visibleColumns.length + (showActions ? 1 : 0) + (showReview && reviewItems.length > 0 ? 1 : 0)}
              >
                {rows.length ? noMatchMessage : emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {filterState.activeFilterCount > 0 && visibleRows.length < rows.length && (
        <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
          {visibleRows.length} of {rows.length} rows match active filters.
          <button type="button" className="ml-2 font-medium text-[#2D7DFE]" onClick={filterState.clearAllFilters}>
            Clear filters
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
