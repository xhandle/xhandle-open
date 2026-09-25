/**
 * CSV text in and out, shared by every table the workspace exports.
 *
 * Per RFC 4180: a quoted field may contain commas, newlines, and doubled
 * quotes. The line-splitting parsers this codebase grew independently break on
 * any cell a reviewer wrapped onto two lines in a spreadsheet, and the
 * decomposition Details and hazard Causal Scenario cells are exactly that kind
 * of long prose.
 */

/** Split CSV text into a grid of raw cell strings. */
export function parseCsv(text = "") {
  const source = String(text ?? "").replace(/^﻿/, "");
  if (!source) return [];
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let index = 0;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (index < source.length) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 2; continue; }
        quoted = false; index += 1; continue;
      }
      // Spreadsheets write CRLF inside a wrapped cell; keep one newline.
      if (char === "\r" && source[index + 1] === "\n") { index += 1; continue; }
      field += char; index += 1; continue;
    }
    if (char === '"' && field === "") { quoted = true; index += 1; continue; }
    if (char === ",") { endField(); index += 1; continue; }
    if (char === "\r") {
      if (source[index + 1] === "\n") { index += 1; continue; }
      endRow(); index += 1; continue;
    }
    if (char === "\n") { endRow(); index += 1; continue; }
    field += char; index += 1;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

export const escapeCsvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

/**
 * Serialize a grid, byte-for-byte as this app has always written CSV: every
 * cell quoted, CRLF between records, and a BOM so Excel reads it as UTF-8.
 */
export function toCsvText(grid = []) {
  const csv = (Array.isArray(grid) ? grid : [])
    .map((cells) => (Array.isArray(cells) ? cells : []).map(escapeCsvCell).join(","))
    .join("\r\n");
  return `﻿${csv}`;
}

/** Collapse a pasted or imported cell to the text the table stores. */
export const csvCellText = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

/** Match a header cell regardless of case, spacing, and punctuation. */
export const csvHeaderKey = (value) => String(value ?? "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
