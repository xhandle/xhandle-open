/**
 * Post-write verification for the hazard Vibe Review commit boundary.
 *
 * A review decision is only "applied" once the governed field it adjudicated is
 * observably present in the row that will be stored. Before this module existed,
 * three of the four review targets reported success after checking only that the
 * apply helper had returned arrays, and the intended "did not change the row"
 * guard could never fire because every helper returned a hard-coded
 * changedRowIndexes. A silently dropped write was indistinguishable from success.
 *
 * These helpers run against the fully normalized candidate summary BEFORE it is
 * persisted, so a failed verification aborts the commit with nothing written.
 */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

/** The field whose value a review target is responsible for adjudicating. */
export const GOVERNED_DECISION_FIELD = Object.freeze({
  guidePhraseApplicable: "Guide Phrase Applicable",
  safetySignificant: "Safety Significant",
  safetyClassification: "Safety Classification",
  classificationResolution: "Safety Classification",
});

export function governedDecisionField(reviewTarget) {
  return GOVERNED_DECISION_FIELD[clean(reviewTarget)] || GOVERNED_DECISION_FIELD.safetySignificant;
}

function columnIndex(headers = [], header = "") {
  return headers.findIndex((candidate) => same(candidate, header));
}

/**
 * Confirm the adjudicated decision survived into the committed row.
 *
 * Returns `{ ok: true }` when there is nothing to assert -- the update did not
 * carry a value for the governed field, so the reviewer adjudicated nothing.
 */
export function verifyGovernedDecision({ reviewTarget, update = {}, headers = [], committedRow = [] } = {}) {
  const field = governedDecisionField(reviewTarget);
  const expected = clean(update?.[field]);
  if (!expected) return { ok: true, field, expected: "", actual: "", skipped: true };

  if (!Array.isArray(headers) || !Array.isArray(committedRow)) {
    return { ok: false, field, expected, actual: "", error: `The committed hazard row could not be read back to confirm ${field}.` };
  }

  const index = columnIndex(headers, field);
  if (index < 0) {
    return { ok: false, field, expected, actual: "", error: `The hazard summary has no ${field} column, so the decision could not be stored.` };
  }

  const actual = clean(committedRow[index]);
  if (!same(actual, expected)) {
    return {
      ok: false,
      field,
      expected,
      actual,
      error: `The review decision was not stored: ${field} should be "${expected}" but the committed row holds "${actual || "(empty)"}". No change was saved.`,
    };
  }
  return { ok: true, field, expected, actual };
}

/** Whether the commit actually altered the row, compared cell by cell. */
export function rowChanged(previousRow = [], committedRow = []) {
  if (!Array.isArray(previousRow) || !Array.isArray(committedRow)) return true;
  if (previousRow.length !== committedRow.length) return true;
  return previousRow.some((value, index) => clean(value) !== clean(committedRow[index]));
}

/**
 * Locate a row by its stable Raw Analysis Row ID against a specific header set.
 * Normalization may add or drop columns, so the committed summary must be
 * indexed on its own headers rather than the pre-write ones.
 */
export function findRowIndexById(summary = [], sourceRowId = "") {
  if (!Array.isArray(summary?.[0])) return -1;
  const idIndex = summary[0].findIndex((header) => (
    /^(?:Raw Analysis Row ID|Raw Row ID|Analysis Row ID|Row ID)$/i.test(clean(header))
  ));
  if (idIndex < 0) return -1;
  const offset = summary.slice(1).findIndex((row) => same(row?.[idIndex], sourceRowId));
  return offset < 0 ? -1 : offset + 1;
}

/**
 * A stable fingerprint of a row, used to detect that it changed between the
 * moment a proposal was formed and the moment its decision is applied.
 *
 * Verification proves the decision landed; the fingerprint proves it landed on
 * the row the reviewer was actually shown. Without it, a regeneration, a manual
 * edit, or another tab can move the row underneath an open proposal and the
 * decision overwrites work it never saw.
 */
export function rowFingerprint(row, { ignoreKeys = [] } = {}) {
  if (Array.isArray(row)) return row.map((value) => clean(value)).join("\u001f");
  if (row && typeof row === "object") {
    const skip = new Set(ignoreKeys);
    return Object.keys(row).filter((k) => !skip.has(k)).sort()
      .map((k) => `${k}=${clean(row[k])}`).join("\u001f");
  }
  return "";
}
