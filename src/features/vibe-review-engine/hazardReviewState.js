/**
 * Rebuild a hazard review state around the row a verified write just committed.
 *
 * The committed row is authoritative: it was read back and checked before it
 * was stored. A follow-up review therefore never needs to wait for the
 * workspace to re-render before it can start -- blocking on that leaves the
 * reviewer with a saved decision, no follow-up, and nothing to click. Other
 * rows are realigned onto the committed headers in case normalization added or
 * dropped a column.
 */
export function hazardStateWithCommittedRow(baseState, sourceRowId, committed) {
  const summary = baseState?.summary;
  if (!Array.isArray(summary?.[0]) || !Array.isArray(committed?.headers) || !Array.isArray(committed?.nextRow)) {
    return baseState;
  }
  const headers = [...committed.headers];
  const sourceHeaders = summary[0];
  const idIndex = sourceHeaders.findIndex((header) => (
    /^(?:Raw Analysis Row ID|Raw Row ID|Analysis Row ID|Row ID)$/i.test(String(header).trim())
  ));
  if (idIndex < 0) return { ...baseState, summary: [headers, [...committed.nextRow]] };

  const target = String(sourceRowId || "").trim();
  const rows = summary.slice(1).map((row) => {
    if (String(row?.[idIndex] || "").trim() === target) return [...committed.nextRow];
    if (sourceHeaders.length === headers.length) return row;
    const fields = Object.fromEntries(sourceHeaders.map((header, index) => [String(header).trim(), row?.[index] ?? ""]));
    return headers.map((header) => fields[String(header).trim()] ?? "");
  });
  const hasTarget = summary.slice(1).some((row) => String(row?.[idIndex] || "").trim() === target);
  return { ...baseState, summary: [headers, ...(hasTarget ? rows : [...rows, [...committed.nextRow]])] };
}
