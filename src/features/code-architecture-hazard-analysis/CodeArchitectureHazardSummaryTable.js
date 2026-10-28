import TablePreparationProgress from '../code-architecture-assurance/TablePreparationProgress';
import {registerTableSearchProvider,modelTableSearchEntries} from '../../components/quickSearchUtils';
import { SHOW_TABLE_REVIEW_COLUMNS } from "../../components/tablePresentation";
import useHazardRowWindow from './useHazardRowWindow';
import CopyTableButton from '../../components/CopyTableButton';
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { FilterableHeaderCell, useColumnFilters } from "../../components/FilterableTableHeader";
import { REVIEW_STATUSES } from "../results-review/reviewTypes";
import ReviewStatusBadge from "../results-review/ReviewStatusBadge";
import ColumnVisibilityMenu from "../code-architecture-assurance/ColumnVisibilityMenu";
import {
  buildCodeArchitectureHazardGroups,
  filterCodeArchitectureHazardRowsByContext,
} from "./codeArchitectureHazardGrouping";

const HIDDEN_SUMMARY_COLUMNS = new Set([
  "from node id",
  "control edge id",
  "to node id",
  "architecture row ref",
  "source symbols",
  "source line ranges",
  "operational context id",
  "operational scenario",
  "operational mode",
  "operating conditions",
  "context assumptions",
]);

export const STPA_DEFAULT_COLUMNS = [
  "Function", "Operational Scenario", "Operational Mode", "Operating Conditions",
  "Guide Phrase", "Guide Phrase Applicable", "Unsafe Control Action", "Loss", "Hazard", "Causal Scenario", "Safety Constraint", "Verification", "Safety Classification",
];
const STPA_DEFAULT_COLUMN_SET = new Set(STPA_DEFAULT_COLUMNS.map(name => name.toLowerCase()));

export const HARA_DEFAULT_COLUMNS = [
  "Function", "Operational Scenario", "Operational Mode", "Operating Conditions",
  "Guide Phrase", "Guide Phrase Applicable", "Malfunctioning Behavior", "Hazardous Event",
  "Severity", "Exposure", "Controllability", "ASIL", "Safety Goal", "Safety Classification",
];
export const FHA_DEFAULT_COLUMNS = [
  "Function (From)", "Control Action", "Function (To)", "Operational Context",
  "Guide Phrase", "Guide Phrase Applicable", "Effect", "Severity Category",
  "Severity Rationale", "Software Control Category", "Software Control Category Rationale",
  "Software Criticality Index", "SWCI Rationale / Derivation", "Safety Classification", "Verification",
];
const FHA_DEFAULT_COLUMN_SET = new Set(FHA_DEFAULT_COLUMNS.map(name => name.toLowerCase()));

const HARA_DEFAULT_COLUMN_SET = new Set(HARA_DEFAULT_COLUMNS.map(name => name.toLowerCase()));

const haraColumnLabel = header => ({
  "item / function": "Function",
  "malfunction": "Malfunctioning Behavior",
}[String(header || "").trim().toLowerCase()] || header);

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
  remotePage,
  preparationStart = 0,
  hazardMethod = "",
  className = "",
  reviewItems = [],
  reviewByRow,
  reviewDrawerOptions = {},
  showReview: requestedShowReview = true,
  highlightedRowIndex = null,
  focusRequestKey,
  onRowFocusResolved,
  onSelectedOperationalContextChange,
  storageKey = "code-architecture-hazard-summary:latest",
  onOpenArchitectureTarget,
  functionalTraceIds,
  onDeleteRow,
  onCollaboratorSelectionChange,
  collaboratorSelection,
  selectedOperationalContextId = "all",
  collapseAllRequest = null,
  onGroupStateChange,
  onVisibleSummaryChange,
  readOnly = false,
}) {
  const isStpa = ["STPA", "STPA-TEXTBOOK", "STPA_TEXTBOOK"].includes(String(hazardMethod).toUpperCase());
  const isHara = String(hazardMethod).toUpperCase() === "HARA";
  const isFha = String(hazardMethod).toUpperCase() === "FHA";
  const showCombinedContext = !isStpa && !isHara && !isFha;
  // New defaults apply once to existing tables; subsequent picker choices persist.
  const visibilityStorageKey = `${storageKey}:hidden-columns${isStpa ? ":stpa-focused-v5" : isHara ? ":hara-focused-v2" : isFha ? ":fha-focused-v2" : ""}`;
  const searchTableRef = useRef(null);
  const [selectedCellKey, setSelectedCellKey] = useState("");
  React.useEffect(() => {
    // Undefined allows standalone tables to retain their local selection behavior.
    // Parent-owned context removal must also remove the visual selection.
    if (collaboratorSelection === null) setSelectedCellKey("");
  }, [collaboratorSelection]);
  const [collapsedInterfaceKeys, setCollapsedInterfaceKeys] = useState(() => new Set());

  const displaySheet = React.useMemo(() => {
    if (!isFha || !Array.isArray(summarySheet?.[0])) return summarySheet;
    const originalHeaders = summarySheet[0];
    const missing = FHA_DEFAULT_COLUMNS.filter(name => !originalHeaders.includes(name) && !(name === 'Effect' && originalHeaders.includes('Mishap')));
    const cell = (row, name) => String(row[originalHeaders.indexOf(name)] ?? '').trim();
    return [[...originalHeaders, ...missing], ...summarySheet.slice(1).map(row => [
      ...row, ...missing.map(name => name === 'Operational Context'
        ? `${cell(row, 'Operational Scenario') || 'Unspecified scenario'} · ${cell(row, 'Operational Mode') || 'Unspecified mode'}`
        : ''),
    ])];
  }, [summarySheet, isFha]);
  const headers = React.useMemo(
    () => (Array.isArray(displaySheet?.[0]) ? displaySheet[0] : []),
    [displaySheet]
  );
  const rows = React.useMemo(
    () => (Array.isArray(displaySheet) ? displaySheet.slice(1) : []),
    [displaySheet]
  );
  const rowItems = React.useMemo(
    () => rows.map((row, rowIndex) => ({ row, rowIndex:remotePage?.rowIndices?.[rowIndex] ?? rowIndex })),
    [rows, remotePage?.rowIndices]
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
  const displayColumnLabel = React.useCallback(header => {
    if (isHara) return haraColumnLabel(header);
    if (isFha && header === "Mishap" && !headers.includes("Effect")) return "Effect";
    if (isStpa) {
      const alias = {"Function (From)":"Function", "Causal Factors":"Causal Factor", "Unsafe Control Actions":"Unsafe Control Action", "Malfunctioning Behavior":"Unsafe Control Action"}[header];
      if (alias && !headers.includes(alias)) return alias;
    }
    return header;
  }, [headers,isHara,isStpa,isFha]);
  const columnOptions = React.useMemo(
    () => headers.map((header, index) => ({
      key: String(index),
      header: displayColumnLabel(header),
      label: displayColumnLabel(header) || `Column ${index + 1}`,
      index,
    })),
    [headers, displayColumnLabel]
  );
  const defaultHiddenColumnKeys = React.useMemo(
    () => columnOptions
      .filter(({ header }) => isStpa
        ? !STPA_DEFAULT_COLUMN_SET.has(String(header || "").trim().toLowerCase())
        : isHara ? !HARA_DEFAULT_COLUMN_SET.has(String(header || "").trim().toLowerCase())
        : isFha ? !FHA_DEFAULT_COLUMN_SET.has(String(header || "").trim().toLowerCase())
        : HIDDEN_SUMMARY_COLUMNS.has(String(header || "").trim().toLowerCase()))
      .map((column) => column.key),
    [columnOptions, isStpa, isHara, isFha]
  );
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(visibilityStorageKey) || "null");
      return Array.isArray(saved) ? saved : defaultHiddenColumnKeys;
    } catch {
      return defaultHiddenColumnKeys;
    }
  });
  React.useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(visibilityStorageKey) || "null");
      setHiddenColumnKeys(Array.isArray(saved) ? saved : defaultHiddenColumnKeys);
    } catch {
      setHiddenColumnKeys(defaultHiddenColumnKeys);
    }
  }, [defaultHiddenColumnKeys, visibilityStorageKey]);
  React.useEffect(() => {
    if (readOnly) return;
    try {
      localStorage.setItem(visibilityStorageKey, JSON.stringify(hiddenColumnKeys));
    } catch {}
  }, [hiddenColumnKeys, visibilityStorageKey, readOnly]);
  const hiddenColumnSet = React.useMemo(() => new Set(hiddenColumnKeys), [hiddenColumnKeys]);
  const visibleColumns = React.useMemo(() => {
    const visible = columnOptions.filter((column) => !hiddenColumnSet.has(column.key));
    if (isHara || isFha || isStpa) visible.sort((a, b) => {
      const defaults = isFha ? FHA_DEFAULT_COLUMNS : isStpa ? STPA_DEFAULT_COLUMNS : HARA_DEFAULT_COLUMNS;
      const rank = column => { const index = defaults.indexOf(column.header); return index < 0 ? defaults.length : index; };
      return rank(a) - rank(b);
    });
    return visible.length ? visible : columnOptions.slice(0, 1);
  }, [columnOptions, hiddenColumnSet, isHara, isFha, isStpa]);
  const getFilterCell = React.useCallback((item, columnIndex) => {
    const column = visibleColumns[columnIndex];
    return column ? item?.row?.[column.index] ?? "" : "";
  }, [visibleColumns]);
  const localFilterState = useColumnFilters(rowItems, getFilterCell);
  const filterState = remotePage ? {
    ...localFilterState, filteredRows:rowItems,
    filters:Object.fromEntries(visibleColumns.map((c,i)=>[i,remotePage.filters[c.index] || []])),
    activeFilterCount:Object.keys(remotePage.filters).length,
    getOptions:()=>remotePage.options || [],
    setFilterValues:(i,values)=>remotePage.setFilter(visibleColumns[i].index,values),
    toggleFilterValue:(i,value)=>{const key=visibleColumns[i].index,old=remotePage.filters[key] || [];remotePage.setFilter(key,old.includes(value)?old.filter(v=>v!==value):[...old,value]);},
    clearAllFilters:remotePage.clearFilters,
  } : localFilterState;
  const optionColumn=visibleColumns[localFilterState.openIndex]?.index;
  const optionSearch=localFilterState.searches[localFilterState.openIndex] || '';
  useEffect(()=>{
    if(remotePage && optionColumn!=null)remotePage.requestOptions(optionColumn,optionSearch);
  },[remotePage?.requestOptions,optionColumn,optionSearch]);
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
  const showReview = SHOW_TABLE_REVIEW_COLUMNS && requestedShowReview;
  const reviewColumnWidth = showReview && reviewItems.length > 0 ? 110 : 0;
  const operationalContextColumnWidth = showCombinedContext ? 220 : 0;
  const tablePixelWidth = visibleColumns.reduce(
    (sum, { key, index }) => sum + (columnWidths[key] || defaultColumnWidths[String(index)] || 180),
    actionsColumnWidth + reviewColumnWidth + operationalContextColumnWidth
  );
  const traceLinkClass = "shrink-0 rounded p-1 text-[#2D7DFE] hover:bg-blue-100 hover:text-[#1E61D6]";
  const traceColumnType = React.useCallback((header) => {
    const normalized = String(header || "").trim().toLowerCase();
    if (["function (from)", "function", "item / function"].includes(normalized)) return "from";
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
  const copyColumns = useMemo(() => [
    ...(showCombinedContext ? [{
      key: 'operationalContext', label: 'Operational context',
      getValue: ({ row }) => `${getCellByHeader(row, 'Operational Scenario') || 'Unspecified scenario'} · ${getCellByHeader(row, 'Operational Mode') || 'Unspecified mode'}`,
    }] : []),
    ...visibleColumns.map(column => ({
      key: column.key, label: column.label, getValue: ({ row }) => row[column.index],
    })),
  ], [getCellByHeader, visibleColumns, showCombinedContext]);
  const filteredRowItems = filterState.filteredRows;
  const contextFilteredRowItems = useMemo(
    () => filterCodeArchitectureHazardRowsByContext(headers, filteredRowItems, selectedOperationalContextId),
    [filteredRowItems, headers, selectedOperationalContextId],
  );
  useEffect(() => {
    onVisibleSummaryChange?.([summarySheet?.[0] || [], ...contextFilteredRowItems.map(({ rowIndex }) => summarySheet[rowIndex + 1])]);
  }, [summarySheet, contextFilteredRowItems, onVisibleSummaryChange]);
  const hazardGroups = useMemo(
    () => buildCodeArchitectureHazardGroups(headers, contextFilteredRowItems),
    [contextFilteredRowItems, headers],
  );
  const rowIdentity = useCallback(item => {
    const index = headers.indexOf('Raw Analysis Row ID');
    return index >= 0 && item.row[index] ? item.row[index] : item.rowIndex;
  }, [headers]);
  const rowWindow=useHazardRowWindow(hazardGroups,collapsedInterfaceKeys,visibleColumns,columnWidths,searchTableRef,storageKey,rowIdentity);
  const {reveal:revealHazardRow}=rowWindow;
  const revealedRequest=useRef(null);
  const resolvedCallback=useRef(onRowFocusResolved);
  resolvedCallback.current=onRowFocusResolved;
  useEffect(()=>{
    if(highlightedRowIndex==null){revealedRequest.current=null;return;}
    const key=`${storageKey}:${focusRequestKey}:${highlightedRowIndex}`;
    if(revealedRequest.current?.key===key)return;
    const request={key,completed:false};
    revealedRequest.current=request;
    const scheduled=revealHazardRow(highlightedRowIndex, element=>{
      if(revealedRequest.current!==request || request.completed)return;
      element.scrollIntoView?.({behavior:'instant',block:'nearest'});
      request.completed=true;
      resolvedCallback.current?.(focusRequestKey);
    });
    if(!scheduled)revealedRequest.current=null;
    // StrictMode and dependency changes cancel setup before positioning can
    // finish. Only completed requests may suppress a subsequent setup.
    return ()=>{
      if(revealedRequest.current===request && !request.completed)revealedRequest.current=null;
    };
  },[highlightedRowIndex,focusRequestKey,storageKey,revealHazardRow,hazardGroups,collapsedInterfaceKeys,rowWindow.preparing]);
  useEffect(() => {
    const table=searchTableRef.current;
    if(!table)return;
    return registerTableSearchProvider(table,()=>modelTableSearchEntries({
      table,label:'Code architecture hazard analysis',indexes:visibleColumns.map(column=>column.index),
      getRowId:index=>`cba-hazard-row-${index}`, revealRow:revealHazardRow,
      items:hazardGroups.filter(group=>!collapsedInterfaceKeys.has(group.key)).flatMap(group=>group.items.map(item=>({row:item.row,originalIndex:item.rowIndex}))),
    }));
  },[hazardGroups,collapsedInterfaceKeys,visibleColumns,revealHazardRow,rowWindow.preparing]);
  const visibleInterfaceKeys = useMemo(() => hazardGroups.map((group) => group.key), [hazardGroups]);

  useEffect(() => {
    setCollapsedInterfaceKeys(new Set());
  }, [hazardGroups, storageKey, summarySheet]);

  useEffect(() => {
    if (!collapseAllRequest?.version) return;
    if (collapseAllRequest.collapsed) {
      setCollapsedInterfaceKeys(new Set(visibleInterfaceKeys));
    } else {
      setCollapsedInterfaceKeys(new Set());
    }
  }, [collapseAllRequest, visibleInterfaceKeys]);

  useEffect(() => {
    const allCollapsed = visibleInterfaceKeys.length > 0
      && visibleInterfaceKeys.every((key) => collapsedInterfaceKeys.has(key));
    onGroupStateChange?.({ allCollapsed, groupCount: visibleInterfaceKeys.length });
  }, [collapsedInterfaceKeys, onGroupStateChange, visibleInterfaceKeys]);

  useEffect(() => {
    if (highlightedRowIndex == null || !rowItems.some(item => item.rowIndex === highlightedRowIndex)) return;
    if (!filteredRowItems.some(item => item.rowIndex === highlightedRowIndex)) filterState.clearAllFilters();
    if (!contextFilteredRowItems.some(item => item.rowIndex === highlightedRowIndex) && selectedOperationalContextId !== "all") {
      onSelectedOperationalContextChange?.("all");
    }
    const group = hazardGroups.find(item => item.items.some(row => row.rowIndex === highlightedRowIndex));
    if (group && collapsedInterfaceKeys.has(group.key)) {
      setCollapsedInterfaceKeys(current => { const next = new Set(current); next.delete(group.key); return next; });
    }
  }, [highlightedRowIndex, focusRequestKey, rowItems, filteredRowItems, contextFilteredRowItems,
    filterState, selectedOperationalContextId, onSelectedOperationalContextChange, hazardGroups, collapsedInterfaceKeys]);
  const tableColumnCount = visibleColumns.length
    + (showCombinedContext ? 1 : 0)
    + (onDeleteRow && !readOnly ? 1 : 0)
    + (showReview && reviewItems.length > 0 ? 1 : 0);
  const renderHazardRow = ({ row, rowIndex, windowKey }) => {
    const reviewItem = reviewByRow?.get?.(rowIndex) || null;
    const rejected = reviewItem?.status === REVIEW_STATUSES.REJECTED;
    const highlighted = highlightedRowIndex === rowIndex;
    const rowId = getCellByHeader(row, "Raw Analysis Row ID") || getCellByHeader(row, "Trace ID") || `cba-hazard-row-${rowIndex + 1}`;
    const operationalScenario = getCellByHeader(row, "Operational Scenario") || "Unspecified scenario";
    const operationalMode = getCellByHeader(row, "Operational Mode") || "Unspecified mode";
    const operatingConditions = getCellByHeader(row, "Operating Conditions");
    const contextAssumptions = getCellByHeader(row, "Context Assumptions");
    const operationalContextLabel = `${operationalScenario} · ${operationalMode}`;
    const operationalContextTitle = [
      operationalContextLabel,
      operatingConditions ? `Conditions: ${operatingConditions}` : "",
      contextAssumptions ? `Assumptions: ${contextAssumptions}` : "",
    ].filter(Boolean).join("\n");
    const selectForCollaborator = (column = null) => {
      const cellKey = column ? `${rowId}:${column.index}` : rowId;
      setSelectedCellKey((current) => current === cellKey ? "" : cellKey);
      onCollaboratorSelectionChange?.(selectedCellKey === cellKey ? null : {
        kind: column ? "table-cell" : "table-row",
        source: "code-architecture-hazard-analysis",
        tableId: "code-architecture-hazard-analysis",
        id: rowId,
        title: `Code architecture hazard row ${rowIndex + 1}`,
        primary: {
          rowId,
          rowIndex,
          rowNumber: rowIndex + 1,
          ...(column ? {
            columnIndex: column.index,
            columnLabel: column.label,
            value: row?.[column.index] ?? "",
          } : {}),
        },
        selectedRows: [{
          rowId,
          rowIndex,
          rowNumber: rowIndex + 1,
          values: Object.fromEntries(headers.map((header, index) => [header, row?.[index] ?? ""])),
        }],
      });
    };
    return (
      <tr
        key={windowKey}
        data-window-key={windowKey}
        id={`cba-hazard-row-${rowIndex}`}
        onClick={() => selectForCollaborator()}
        className={`cursor-pointer align-top transition-colors ${
          highlighted
            ? "bg-[#FFF7D6] ring-2 ring-[#F3B63F] ring-inset"
            : selectedCellKey === rowId || selectedCellKey.startsWith(`${rowId}:`)
              ? "bg-blue-50 ring-1 ring-inset ring-blue-300"
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
              onClick={(event) => {
                event.stopPropagation();
                onDeleteRow(rowIndex);
              }}
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
        {showCombinedContext && <td className="px-3 py-2 align-top">
          <span
            className="inline-flex max-w-full rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium leading-4 text-slate-700"
            title={operationalContextTitle}
          >
            {operationalContextLabel}
          </span>
        </td>}
        {visibleColumns.map(({ header, index: colIndex }) => {
          const traceType = traceColumnType(header);
          const value = String(row?.[colIndex] ?? "");
          const diagramView = functionalTraceIds?.has(getCellByHeader(row, "Trace ID"))
            ? "Functional" : "CSU";
          return (
            <td
              data-column-index={colIndex}
              key={`${rowIndex}-${colIndex}`}
              className={`whitespace-pre-wrap break-words px-3 py-2 text-slate-700 ${selectedCellKey === `${rowId}:${colIndex}` ? "bg-blue-100 ring-1 ring-inset ring-blue-400" : ""} ${rejected ? "text-rose-900 line-through decoration-rose-400" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                selectForCollaborator({ index: colIndex, label: header || `Column ${colIndex + 1}` });
              }}
            >
              {traceType && value ? (
                <div className="flex items-start gap-1">
                  <span className="min-w-0 flex-1">{value}</span>
                  <button
                    type="button"
                    className={traceLinkClass}
                    title={`Open this trace in the ${diagramView} diagram view`}
                    aria-label={`Open ${header} in the ${diagramView} diagram view`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenArchitectureTarget?.(buildTraceTarget(row, traceType));
                    }}
                  >
                    ↗
                  </button>
                </div>
              ) : value}
            </td>
          );
        })}
      </tr>
    );
  };

  if (rowWindow.error) return <div role="alert">Unable to prepare hazard table: {rowWindow.error.message}</div>;
  if (rowWindow.preparing) return <TablePreparationProgress label="Preparing hazard table layout" progress={Math.floor(preparationStart + rowWindow.progress * (100 - preparationStart) / 100)} />;

  if (!Array.isArray(summarySheet) || summarySheet.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
        No code architecture hazard summary has been generated yet.
      </div>
    );
  }

  return (
    <div className={`${className || "max-h-80"} flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white`}>
      <div className="flex shrink-0 items-center justify-end gap-2 border-b border-slate-100 bg-white px-3 py-2">
        <span role="status" className="mr-auto text-sm text-slate-600">{remotePage ? `${remotePage.total} matching rows · groups show this page` : `${contextFilteredRowItems.length} of ${rows.length} rows match filters`}</span>
        {filterState.activeFilterCount > 0 && <button type="button" className="text-sm font-medium text-[#2D7DFE]" onClick={filterState.clearAllFilters}>Clear filters</button>}
        <ColumnVisibilityMenu
          columns={columnOptions.map((column) => ({ key: column.key, label: column.label }))}
          hiddenKeys={hiddenColumnKeys}
          onChange={setHiddenColumnKeys}
        />
        {remotePage ? <button type="button" onClick={()=>remotePage.copy(visibleColumns.map(c=>c.index))}>Copy matching rows</button> : <CopyTableButton label="Copy code architecture hazard analysis table" columns={copyColumns} rows={contextFilteredRowItems} />}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
      <table ref={searchTableRef} aria-label="Code architecture hazard analysis" className="table-fixed text-left text-sm" style={{ minWidth: tablePixelWidth }}>
        <colgroup>
          {onDeleteRow && !readOnly && <col style={{ width: actionsColumnWidth, minWidth: actionsColumnWidth }} />}
          {showReview && reviewItems.length > 0 && <col style={{ width: reviewColumnWidth, minWidth: reviewColumnWidth }} />}
          {showCombinedContext && <col style={{ width: operationalContextColumnWidth, minWidth: operationalContextColumnWidth }} />}
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
            {showCombinedContext && <th
              className="border-b border-slate-200 bg-slate-50 px-3 py-2"
              style={{ width: operationalContextColumnWidth, minWidth: operationalContextColumnWidth }}
            >
              Operational context
            </th>}
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
          {rowWindow.top>0 && <tr aria-hidden="true"><td colSpan={tableColumnCount} style={{height:rowWindow.top,padding:0,border:0}} /></tr>}
          {rowWindow.visible.map(entry=>{
            if(entry.item)return renderHazardRow({...entry.item,windowKey:entry.key});
            const group=entry.group,interfaceCollapsed=collapsedInterfaceKeys.has(group.key);
            return <tr key={entry.key} data-window-key={entry.key} className="bg-blue-50 text-blue-900">
              <td colSpan={tableColumnCount} className="border-y border-blue-100 px-3 py-2">
                <button type="button" className="flex w-full items-center gap-2 text-left text-sm font-semibold"
                  onClick={()=>setCollapsedInterfaceKeys(current=>{const next=new Set(current);if(next.has(group.key))next.delete(group.key);else next.add(group.key);return next;})}
                  aria-expanded={!interfaceCollapsed}>
                  {interfaceCollapsed?<ChevronRight size={16}/>:<ChevronDown size={16}/>}
                  <span className="min-w-0 flex-1">{group.label}</span>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-blue-700">{group.rowCount} analysis variant{group.rowCount===1?'':'s'}</span>
                </button>
              </td>
            </tr>;
          })}
          {rowWindow.bottom>0 && <tr aria-hidden="true"><td colSpan={tableColumnCount} style={{height:rowWindow.bottom,padding:0,border:0}} /></tr>}
        </tbody>
      </table>
      {contextFilteredRowItems.length === 0 && (
        <div className="border-t border-slate-100 px-3 py-6 text-center text-sm text-slate-500">
          No hazard rows match the active column or operational-context filters.
        </div>
      )}

      </div>
    </div>
  );
}
