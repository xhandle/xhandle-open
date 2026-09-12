const MAX_SELECTION_FIELDS = 80;

function clean(value) {
  return String(value ?? "").trim();
}

function compactValues(headers = [], row = []) {
  return Object.fromEntries(
    (headers || [])
      .slice(0, MAX_SELECTION_FIELDS)
      .map((header, index) => [clean(header) || `Column ${index + 1}`, row?.[index] ?? ""]),
  );
}

export function createTableCellSelection({
  tableId,
  tableLabel,
  projectId,
  rowId,
  rowIndex,
  headers = [],
  row = [],
  columnIndex,
} = {}) {
  const safeRowIndex = Number.isFinite(Number(rowIndex)) ? Number(rowIndex) : 0;
  const safeColumnIndex = Number.isFinite(Number(columnIndex)) ? Number(columnIndex) : 0;
  const columnLabel = clean(headers[safeColumnIndex]) || `Column ${safeColumnIndex + 1}`;
  const value = row?.[safeColumnIndex] ?? "";
  const stableRowId = clean(rowId) || `${clean(tableId) || "table"}:row:${safeRowIndex}`;
  return {
    kind: "table-cell",
    source: "table",
    tableId: clean(tableId),
    tableLabel: clean(tableLabel) || "Table",
    projectId: clean(projectId),
    primary: {
      rowId: stableRowId,
      rowIndex: safeRowIndex,
      rowNumber: safeRowIndex + 1,
      columnIndex: safeColumnIndex,
      columnLabel,
      value,
    },
    selectedRows: [{
      rowId: stableRowId,
      rowIndex: safeRowIndex,
      rowNumber: safeRowIndex + 1,
      values: compactValues(headers, row),
    }],
    selectedCells: [{
      rowId: stableRowId,
      rowIndex: safeRowIndex,
      rowNumber: safeRowIndex + 1,
      columnIndex: safeColumnIndex,
      columnLabel,
      value,
    }],
    updatedAt: new Date().toISOString(),
  };
}

export function isSelectedTableRow(selection, tableId, rowId) {
  return Boolean(
    selection?.tableId === tableId
    && selection?.selectedRows?.some((row) => String(row.rowId) === String(rowId)),
  );
}

export function isSelectedTableCell(selection, tableId, rowId, columnIndex) {
  return Boolean(
    selection?.tableId === tableId
    && selection?.selectedCells?.some((cell) => (
      String(cell.rowId) === String(rowId) && Number(cell.columnIndex) === Number(columnIndex)
    )),
  );
}

export function describeActiveSelection(selection) {
  if (!selection) return "";
  if (selection.kind === "functional-canvas") {
    const nodes = selection.selectedNodes?.length || 0;
    if (selection.selectedEdge) return `Functional diagram edge: ${selection.selectedEdge.label || `${selection.selectedEdge.source} → ${selection.selectedEdge.target}`}`;
    if (nodes) return `${nodes} selected functional diagram node${nodes === 1 ? "" : "s"}`;
  }
  if (selection.kind === "safety-issue") return `Safety issue: ${selection.title || selection.id || "selected issue"}`;
  if (selection.kind === "table-cell") {
    return `${selection.tableLabel}, row ${selection.primary?.rowNumber || "?"}, ${selection.primary?.columnLabel || "selected cell"}`;
  }
  return selection.label || selection.title || "Selected workspace item";
}

