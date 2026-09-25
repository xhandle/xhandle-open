/**
 * The CSV round trip for the functional decomposition table.
 *
 * A reviewer exports the table, edits it in a spreadsheet, and imports it back.
 * Both directions live here so the dialect cannot drift, and so the import can
 * be tested: it replaces the whole table, which is the most destructive thing
 * the Functional Diagramming tab does outside a vibe review.
 *
 * The table carries two invariants that the in-app editor enforces on every
 * keystroke (getFunctionalLabelConflictForEdit in App.js):
 *
 *   1. a Function (From) label has exactly one owning subsystem, and
 *   2. a Function (From) / Control Action / Function (To) interface is unique.
 *
 * A spreadsheet enforces neither, so an import that ignored them could load a
 * table the editor itself would have refused. They are checked here and
 * reported against CSV line numbers, so the reviewer fixes the file rather than
 * discovering a corrupt architecture later.
 */

import { csvCellText, csvHeaderKey, parseCsv, toCsvText } from "../../lib/csv";
import {
  FUNCTIONAL_FIELD_ALIASES,
  FUNCTIONAL_FIELD_LABELS,
  FUNCTIONAL_ROW_FIELDS,
} from "../functional-vibe-review/functionalVibeReview";

export { parseCsv };

export const FUNCTIONAL_DECOMPOSITION_COLUMNS = Object.freeze(
  FUNCTIONAL_ROW_FIELDS.map((key) => Object.freeze({ key, label: FUNCTIONAL_FIELD_LABELS[key] })),
);

/** Without these three a row names no interface, so there is nothing to import. */
const REQUIRED_FIELDS = Object.freeze(["fromFunction", "controlAction", "toFunction"]);

const labelKey = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 260).toLowerCase();

const interfaceKey = (row) => [row?.fromFunction, row?.controlAction, row?.toFunction]
  .map(labelKey)
  .join("::");

/** The exact bytes the Export CSV action writes, BOM included so Excel reads UTF-8. */
export function functionalDecompositionToCsv(rows = []) {
  const headers = FUNCTIONAL_DECOMPOSITION_COLUMNS.map(({ label }) => label);
  const body = (Array.isArray(rows) ? rows : [])
    .map((row) => FUNCTIONAL_DECOMPOSITION_COLUMNS.map(({ key }) => row?.[key] ?? ""));
  return toCsvText([headers, ...body]);
}

/**
 * Map each header cell to a row field. Accepts the labels this app exports and
 * the aliases the rest of the workspace already understands, so a header a
 * reviewer retyped as "Function From" still lands.
 */
export function resolveFunctionalCsvHeaders(headerCells = []) {
  const byKey = new Map();
  FUNCTIONAL_ROW_FIELDS.forEach((field) => {
    byKey.set(csvHeaderKey(FUNCTIONAL_FIELD_LABELS[field]), field);
    (FUNCTIONAL_FIELD_ALIASES[field] || []).forEach((alias) => {
      if (!byKey.has(csvHeaderKey(alias))) byKey.set(csvHeaderKey(alias), field);
    });
  });

  const columns = new Map();
  (Array.isArray(headerCells) ? headerCells : []).forEach((cell, index) => {
    const field = byKey.get(csvHeaderKey(cell));
    if (field && !columns.has(field)) columns.set(field, index);
  });

  const missingRequired = REQUIRED_FIELDS
    .filter((field) => !columns.has(field))
    .map((field) => FUNCTIONAL_FIELD_LABELS[field]);

  return { columns, missingRequired };
}

/**
 * Turn exported-and-edited CSV back into table rows.
 *
 * Returns `{ rows, errors, conflicts, ignoredBlankRows }`. `errors` and
 * `conflicts` are both blocking: the caller must not replace the table while
 * either is non-empty, because a partial import silently discards edits the
 * reviewer believed they had made.
 */
export function parseFunctionalDecompositionCsv(text = "") {
  const grid = parseCsv(text);
  if (!grid.length) {
    return { rows: [], errors: ["The file is empty."], conflicts: [], ignoredBlankRows: 0 };
  }

  const { columns, missingRequired } = resolveFunctionalCsvHeaders(grid[0]);
  if (missingRequired.length) {
    return {
      rows: [],
      errors: [`The header row is missing ${missingRequired.join(", ")}. Export the table first and edit that file.`],
      conflicts: [],
      ignoredBlankRows: 0,
    };
  }

  const rows = [];
  const lineNumbers = [];
  let ignoredBlankRows = 0;

  grid.slice(1).forEach((cells, offset) => {
    const row = {};
    FUNCTIONAL_ROW_FIELDS.forEach((field) => {
      const columnIndex = columns.get(field);
      row[field] = columnIndex === undefined ? "" : csvCellText(cells[columnIndex]);
    });
    if (FUNCTIONAL_ROW_FIELDS.every((field) => !row[field])) {
      ignoredBlankRows += 1;
      return;
    }
    rows.push(row);
    lineNumbers.push(offset + 2);
  });

  if (!rows.length) {
    return { rows: [], errors: ["The file has a header row but no decomposition rows."], conflicts: [], ignoredBlankRows };
  }

  const incomplete = rows
    .map((row, index) => ({ row, line: lineNumbers[index] }))
    .filter(({ row }) => REQUIRED_FIELDS.some((field) => !row[field]))
    .map(({ line }) => `Line ${line} is missing Function (From), Control Action, or Function (To).`);

  const conflicts = [];
  const owners = new Map();
  const interfaces = new Map();
  rows.forEach((row, index) => {
    const line = lineNumbers[index];
    const fromKey = labelKey(row.fromFunction);
    const subsystem = row.subsystem;
    if (fromKey && subsystem) {
      const existing = owners.get(fromKey);
      if (existing && labelKey(existing.subsystem) !== labelKey(subsystem)) {
        conflicts.push(`Line ${line}: "${row.fromFunction}" is allocated to "${subsystem}" here and to "${existing.subsystem}" on line ${existing.line}.`);
      } else if (!existing) {
        owners.set(fromKey, { subsystem, line });
      }
    }
    const key = interfaceKey(row);
    if (key && key !== "::") {
      const existingLine = interfaces.get(key);
      if (existingLine) {
        conflicts.push(`Line ${line} repeats the interface "${row.fromFunction} / ${row.controlAction} / ${row.toFunction}" from line ${existingLine}.`);
      } else {
        interfaces.set(key, line);
      }
    }
  });

  return { rows, errors: incomplete, conflicts, ignoredBlankRows };
}

/** One human-readable block naming everything that blocks an import. */
export function describeFunctionalCsvProblems({ errors = [], conflicts = [] } = {}, limit = 6) {
  const problems = [...errors, ...conflicts];
  if (!problems.length) return "";
  const shown = problems.slice(0, limit);
  const remainder = problems.length - shown.length;
  return [
    `This CSV cannot be imported:`,
    ...shown.map((problem) => `• ${problem}`),
    remainder > 0 ? `…and ${remainder} more.` : "",
  ].filter(Boolean).join("\n");
}
