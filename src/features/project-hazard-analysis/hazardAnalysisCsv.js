/**
 * Re-import a hazard analysis that was reviewed in another tool.
 *
 * This is deliberately NOT the functional decomposition's whole-table replace.
 * Two properties of the hazard analysis make a replace wrong here:
 *
 *   1. Export CSV writes the *visible* rows. Column filters and the operational
 *      context selector routinely narrow a 300-row analysis to a handful, so a
 *      replace would delete everything the reviewer had filtered out of sight.
 *   2. Raw Analysis Row ID is a content hash of the row, and reviews, audit
 *      records, and safety issues all address rows by it. Rebuilding the table
 *      from a CSV would re-derive every ID and orphan that history.
 *
 * Imports first match stable IDs, then uniquely identifying interface/context
 * columns for older exports with blank or externally assigned IDs. Existing
 * internal IDs are retained so linked reviews remain attached to the same row.
 * Unmatched and ambiguous rows are reported; row order is never an identity.
 */

import { csvCellText, csvHeaderKey, parseCsv } from "../../lib/csv";
import { derivedSignificanceConflict, describeSignificanceConflict } from "./safetyColumnSchema";

export const HAZARD_ROW_ID_HEADERS = Object.freeze([
  "Raw Analysis Row ID",
  "Raw Row ID",
  "Analysis Row ID",
]);

/**
 * Columns that carry an adjudicated engineering position rather than generated
 * analysis. They are still importable -- a review in another tool is a review --
 * but the caller names them in its confirmation so nobody overwrites a governed
 * decision without being told.
 */
export const HAZARD_GOVERNED_HEADERS = Object.freeze([
  "Safety Significant",
  "Safety Significance Rationale",
  "Safety Classification",
  "Safety Classification Rule",
  "Classification Evidence",
  "Classification Confidence",
  "Classification Resolution Status",
]);

const findRowIdColumn = (headerCells = []) => {
  const wanted = new Set(HAZARD_ROW_ID_HEADERS.map(csvHeaderKey));
  return (Array.isArray(headerCells) ? headerCells : [])
    .findIndex((cell) => wanted.has(csvHeaderKey(cell)));
};

const IDENTITY_GROUPS = [
  ["Function (From)", "Control Action", "Function (To)", "Guide Phrase"],
  ["Item / Function", "Failure Mode"],
];
const CONTEXT_HEADERS = ["Operational Context ID", "Operational Scenario", "Operational Mode", "Operating Conditions"];

function identityColumns(sourceHeaders, targetHeaders) {
  const source = sourceHeaders.map(csvHeaderKey);
  const target = targetHeaders.map(csvHeaderKey);
  const group = IDENTITY_GROUPS.find((names) => names.every((name) => source.includes(csvHeaderKey(name)) && target.includes(csvHeaderKey(name))));
  if (!group) return [];
  return [...group, ...CONTEXT_HEADERS.filter((name) => source.includes(csvHeaderKey(name)) && target.includes(csvHeaderKey(name)))]
    .map((name) => ({ source: source.indexOf(csvHeaderKey(name)), target: target.indexOf(csvHeaderKey(name)) }));
}

function matchesIdentity(sourceRow, targetRow, columns) {
  return columns.length > 0
    && columns.some(({ source }) => csvCellText(sourceRow?.[source]))
    && columns.every(({ source, target }) => csvCellText(sourceRow?.[source]) === csvCellText(targetRow?.[target]));
}

/**
 * Work out what an imported file would change, without changing anything.
 *
 * Returns `{ updates, errors, changedRowCount, changedColumns,
 * governedColumns, unchangedRowCount, conflicts }`. `errors` is blocking: a
 * partially applied merge leaves the analysis in a state the reviewer never
 * reviewed. `conflicts` describes governed values the imported classification
 * contradicts; those are surfaced, never silently reconciled.
 */
export function planHazardAnalysisCsvImport(summary = [], text = "", { draftHeaders = [], draftRows = {} } = {}) {
  const headers = Array.isArray(summary?.[0]) ? summary[0] : null;
  if (!headers) {
    return emptyPlan(["This project has no hazard analysis table to merge into."]);
  }

  const grid = parseCsv(text);
  if (!grid.length) return emptyPlan(["The file is empty."]);

  const csvHeaders = grid[0];
  const csvIdIndex = findRowIdColumn(csvHeaders);
  const identity = identityColumns(csvHeaders, headers);
  if (csvIdIndex < 0 && !identity.length) {
    return emptyPlan([`The header row has no ${HAZARD_ROW_ID_HEADERS[0]} column. Export the analysis first and edit that file.`]);
  }
  const summaryIdIndex = findRowIdColumn(headers);
  if (summaryIdIndex < 0) {
    return emptyPlan(["This hazard analysis has no Raw Analysis Row ID column yet. Open the Hazard Analysis tab once so the row IDs are written down, then import."]);
  }

  // Only columns the analysis actually has can be merged; anything else in the
  // file is a note the reviewer added and is reported, not written.
  const byHeaderKey = new Map();
  headers.forEach((header, index) => {
    const key = csvHeaderKey(header);
    if (key && !byHeaderKey.has(key)) byHeaderKey.set(key, index);
  });

  const mapped = [];
  const unknownColumns = [];
  csvHeaders.forEach((cell, index) => {
    if (index === csvIdIndex) return;
    const key = csvHeaderKey(cell);
    if (!key) return;
    const summaryIndex = byHeaderKey.get(key);
    if (summaryIndex === undefined) {
      unknownColumns.push(String(cell).trim());
      return;
    }
    mapped.push({ csvIndex: index, summaryIndex, header: headers[summaryIndex] });
  });

  if (!mapped.length) {
    return emptyPlan(["The file has a row ID column but no other column this analysis recognizes."]);
  }

  const rowIndexById = new Map();
  summary.slice(1).forEach((row, offset) => {
    const id = csvCellText(row?.[summaryIdIndex]);
    if (id && !rowIndexById.has(id)) rowIndexById.set(id, offset + 1);
  });

  const draftIdIndex = findRowIdColumn(draftHeaders);
  const draftIndexes = new Map(draftHeaders.map((header, index) => [csvHeaderKey(header), index]));
  const errors = [];
  const updates = [];
  const seenIds = new Map();
  const seenRows = new Map();
  let identityMatchedRowCount = 0;
  const changedColumns = new Set();
  let unchangedRowCount = 0;

  grid.slice(1).forEach((cells, offset) => {
    const line = offset + 2;
    const id = csvCellText(cells?.[csvIdIndex]);
    if (cells.every((cell) => !csvCellText(cell))) return;
    const firstLine = id && seenIds.get(id);
    if (firstLine) {
      errors.push(`Line ${line} repeats Raw Analysis Row ID ${id} from line ${firstLine}.`);
      return;
    }
    if (id) seenIds.set(id, line);

    let rowIndex = id ? rowIndexById.get(id) : undefined;
    if (rowIndex === undefined) {
      const candidates = summary.slice(1).map((row, index) => ({ row, index: index + 1 }))
        .filter(({ row }) => matchesIdentity(cells, row, identity));
      if (candidates.length !== 1) {
        errors.push(candidates.length > 1
          ? `Line ${line}: identifying columns match ${candidates.length} rows. Include a matching Raw Analysis Row ID or distinguishing operational context.`
          : `Line ${line}: no matching row for Raw Analysis Row ID ${id || "(blank)"} or the identifying columns. Include unchanged interface and context columns to match an existing row.`);
        return;
      }
      rowIndex = candidates[0].index;
      identityMatchedRowCount += 1;
    }
    if (seenRows.has(rowIndex)) {
      errors.push(`Line ${line} matches the same analysis row as line ${seenRows.get(rowIndex)}.`);
      return;
    }
    seenRows.set(rowIndex, line);
    const canonicalId = csvCellText(summary[rowIndex]?.[summaryIdIndex]);
    const draftIdentity = identityColumns(headers, draftHeaders);
    const matchingDraftEntries = Object.entries(draftRows).filter(([, entry]) => {
      if (!Array.isArray(entry?.row)) return false;
      if (canonicalId && csvCellText(entry.row[draftIdIndex]) === canonicalId) return true;
      if (!matchesIdentity(summary[rowIndex], entry.row, draftIdentity)) return false;
      return summary.slice(1).filter((row) => matchesIdentity(row, entry.row, draftIdentity)).length === 1;
    });

    const current = summary[rowIndex] || [];
    const changes = mapped
      .map(({ csvIndex, summaryIndex, header }) => ({
        summaryIndex,
        header,
        value: csvCellText(cells?.[csvIndex]),
        previous: csvCellText(current?.[summaryIndex]),
      }))
      // A previous import may have saved Summary but left the displayed draft
      // stale. Include those differences so importing the same file repairs it.
      .filter((change) => change.value !== change.previous || matchingDraftEntries.some(([, { row }]) => {
        const index = draftIndexes.get(csvHeaderKey(change.header));
        return index !== undefined && csvCellText(row[index]) !== change.value;
      }));

    if (!changes.length) {
      unchangedRowCount += 1;
      return;
    }
    changes.forEach((change) => changedColumns.add(change.header));
    updates.push({ rowId: canonicalId, rowIndex, line, changes, draftKeys: matchingDraftEntries.map(([key]) => key) });
  });

  const governedColumns = HAZARD_GOVERNED_HEADERS.filter((header) => changedColumns.has(header));
  const conflicts = errors.length ? [] : describeMergedConflicts(summary, updates);

  return {
    updates,
    errors,
    unknownColumns,
    changedRowCount: updates.length,
    identityMatchedRowCount,
    changedColumns: Array.from(changedColumns),
    governedColumns,
    unchangedRowCount,
    conflicts,
  };
}

function emptyPlan(errors) {
  return {
    updates: [],
    errors,
    unknownColumns: [],
    changedRowCount: 0,
    changedColumns: [],
    governedColumns: [],
    unchangedRowCount: 0,
    conflicts: [],
  };
}

/**
 * A governed Safety Significant value the merged Safety Classification would
 * contradict. Reported so the reviewer decides; nothing is rewritten.
 */
function describeMergedConflicts(summary, updates) {
  if (!updates.length) return [];
  const headers = summary[0];
  const merged = applyHazardAnalysisCsvImport(summary, updates);
  return updates
    .map(({ rowId, rowIndex }) => {
      const conflict = derivedSignificanceConflict(headers, merged[rowIndex]);
      return conflict ? `${rowId}: ${describeSignificanceConflict(conflict)}` : "";
    })
    .filter(Boolean);
}

/** Apply a plan's updates, returning a new Summary. The input is not mutated. */
export function applyHazardAnalysisCsvImport(summary = [], updates = []) {
  if (!updates.length) return summary;
  const next = summary.map((row) => (Array.isArray(row) ? [...row] : row));
  updates.forEach(({ rowIndex, changes }) => {
    const row = next[rowIndex];
    if (!Array.isArray(row)) return;
    changes.forEach(({ summaryIndex, value }) => { row[summaryIndex] = value; });
  });
  return next;
}

/** Mirror imported cells into the generated rows used by the table. */
export function applyHazardCsvImportToDrafts(draftRows = {}, draftHeaders = [], updates = []) {
  const idIndex = findRowIdColumn(draftHeaders);
  if (idIndex < 0 || !updates.length) return draftRows;
  const byId = new Map(updates.filter((update) => update.rowId).map((update) => [update.rowId, update]));
  const byKey = new Map(updates.flatMap((update) => (update.draftKeys || []).map((key) => [key, update])));
  const indexes = new Map(draftHeaders.map((header, index) => [csvHeaderKey(header), index]));
  return Object.fromEntries(Object.entries(draftRows).map(([key, entry]) => {
    const update = Array.isArray(entry?.row) && (byKey.get(key) || byId.get(csvCellText(entry.row[idIndex])));
    if (!update) return [key, entry];
    const row = [...entry.row];
    update.changes.forEach(({ header, value }) => {
      const index = indexes.get(csvHeaderKey(header));
      if (index !== undefined) row[index] = value;
    });
    return [key, { ...entry, row }];
  }));
}

/** One human-readable block naming everything that blocks an import. */
export function describeHazardCsvProblems({ errors = [] } = {}, limit = 6) {
  if (!errors.length) return "";
  const shown = errors.slice(0, limit);
  const remainder = errors.length - shown.length;
  return [
    "This CSV cannot be imported:",
    ...shown.map((problem) => `• ${problem}`),
    remainder > 0 ? `…and ${remainder} more.` : "",
  ].filter(Boolean).join("\n");
}

/** What the reviewer is asked to confirm before the merge is written. */
export function describeHazardCsvPlan(plan, limit = 8) {
  if (!plan?.changedRowCount) return "";
  const lines = [
    `Update ${plan.changedRowCount} row${plan.changedRowCount === 1 ? "" : "s"} in this hazard analysis?`,
    "",
    `Columns changed: ${plan.changedColumns.slice(0, limit).join(", ")}${plan.changedColumns.length > limit ? `, and ${plan.changedColumns.length - limit} more` : ""}.`,
  ];
  if (plan.identityMatchedRowCount) {
    lines.push(`${plan.identityMatchedRowCount} rows matched by identifying columns because their imported IDs were blank or different. Existing internal row IDs will be retained to preserve linked reviews.`);
  }
  if (plan.unchangedRowCount) {
    lines.push(`${plan.unchangedRowCount} row${plan.unchangedRowCount === 1 ? "" : "s"} in the file match the analysis already and will not be touched.`);
  }
  if (plan.governedColumns.length) {
    lines.push("", `This overwrites governed review decisions: ${plan.governedColumns.join(", ")}.`);
  }
  if (plan.unknownColumns.length) {
    lines.push("", `Ignored columns this analysis does not have: ${plan.unknownColumns.join(", ")}.`);
  }
  if (plan.conflicts.length) {
    lines.push("", `${plan.conflicts.length} row${plan.conflicts.length === 1 ? "" : "s"} will need a significance re-review afterwards:`);
    plan.conflicts.slice(0, 3).forEach((conflict) => lines.push(`• ${conflict}`));
    if (plan.conflicts.length > 3) lines.push(`…and ${plan.conflicts.length - 3} more.`);
  }
  lines.push("", "Rows not listed in the file are left unchanged. The previous version stays restorable.");
  return lines.join("\n");
}
