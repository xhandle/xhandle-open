/**
 * In-memory harness for driving the hazard review engine end to end.
 *
 * It stands in for the three systems a real review touches -- the hazard
 * artifact, the session store, and the audit/evidence trail -- so that
 * lifecycle tests can assert on the artifact AND the cursor together, and can
 * inject faults at each seam. It deliberately reuses the real apply helpers and
 * the real commit verification rather than reimplementing them, so a harness
 * test failing means the production path is wrong.
 */

import {
  ensureClassificationResolutionStatus,
  inspectClassificationResolution,
  CLASSIFICATION_RESOLUTION_STATUS,
} from "../project-hazard-analysis/classificationResolutionStatus";
import {
  findRowIndexById,
  rowChanged,
  rowFingerprint,
  verifyGovernedDecision,
} from "../project-hazard-analysis/governedDecisionCommit";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export const VALIDATED_STATUSES = new Set([
  CLASSIFICATION_RESOLUTION_STATUS.POLICY_VALIDATED,
  CLASSIFICATION_RESOLUTION_STATUS.HUMAN_POLICY_VALIDATED,
]);

export const HARNESS_HEADERS = Object.freeze([
  "Raw Analysis Row ID", "Function (From)", "Control Action", "Function (To)",
  "Guide Phrase", "Guide Phrase Applicable",
  "Safety Significant", "Safety Significance Rationale",
  "Safety Classification", "Safety Classification Rule", "Causal Path Type",
  "Classification Evidence", "Classification Confidence",
  "Causal Effect", "Resulting System State",
  "Intermediate Safety Function", "Intermediate Safety Effect",
  "Protection Assessment", "Protection Status", "Physical-Harm Chain Termination",
  "Hazard", "Loss",
  "Classification Resolution Status",
]);

export function harnessRow(rowId, overrides = {}) {
  const fields = {
    "Raw Analysis Row ID": rowId,
    "Function (From)": "Speed sensor",
    "Control Action": "Reports vehicle speed",
    "Function (To)": "Traction controller",
    "Guide Phrase": "More",
    "Guide Phrase Applicable": "Yes",
    "Safety Significant": "Needs Review",
    "Safety Significance Rationale": "",
    "Safety Classification": "Needs Review",
    "Safety Classification Rule": "U4",
    "Causal Path Type": "Uncertain",
    "Classification Evidence": "",
    "Classification Confidence": "Low",
    "Causal Effect": "Traction control commands excessive torque",
    "Resulting System State": "Vehicle exceeds safe speed for conditions",
    "Intermediate Safety Function": "",
    "Intermediate Safety Effect": "",
    "Protection Assessment": "No independent overspeed protection",
    "Protection Status": "Unprotected",
    "Physical-Harm Chain Termination": "Harm chain completes at occupant injury",
    Hazard: "H-1 Vehicle exceeds safe speed",
    Loss: "L-1 Occupant injury",
    "Classification Resolution Status": "",
    ...overrides,
  };
  return HARNESS_HEADERS.map((header) => fields[header] ?? "");
}

/**
 * Mirrors the write sets in App.js applyHazardVibeReviewDecision. Kept narrow
 * on purpose: the point of the harness is that a decision may only touch the
 * columns its review target governs.
 */
const WRITE_SETS = {
  safetySignificant: ["Safety Significant", "Safety Significance Rationale"],
  safetyClassification: [
    "Safety Classification", "Safety Classification Rule", "Causal Path Type",
    "Classification Evidence", "Classification Confidence",
  ],
  classificationResolution: [
    "Safety Classification", "Safety Classification Rule", "Causal Path Type", "Classification Evidence",
    "Classification Confidence", "Causal Effect", "Resulting System State",
    "Intermediate Safety Function", "Intermediate Safety Effect",
    "Protection Assessment", "Protection Status", "Physical-Harm Chain Termination",
  ],
  guidePhraseApplicable: ["Guide Phrase Applicable", "Guide Phrase Applicability Rationale"],
};

export function createHazardReviewHarness({ rows = ["RAW-1", "RAW-2"], rowOverrides = {} } = {}) {
  const state = {
    summary: [
      [...HARNESS_HEADERS],
      ...rows.map((rowId) => harnessRow(rowId, rowOverrides[rowId] || {})),
    ],
    sessions: [],
    audit: [],
    captured: [],
    cellImpacts: [],
    bookkeepingErrors: [],
    applyCalls: 0,
    undoCalls: 0,
    faults: {
      // Set any of these to an Error to inject a fault at that seam.
      write: null,
      undo: null,
      audit: null,
      capture: null,
      dropWrite: false,
    },
  };

  const headerIndex = (header) => HARNESS_HEADERS.findIndex((candidate) => clean(candidate) === clean(header));

  const applyDecision = async ({ sourceRowId, reviewTarget, update, expectedRowFingerprint }) => {
    state.applyCalls += 1;
    if (state.faults.write) throw state.faults.write;

    const rowIndex = findRowIndexById(state.summary, sourceRowId);
    if (rowIndex <= 0) return { missing: true, sourceRowId };

    const previousRow = [...state.summary[rowIndex]];
    if (expectedRowFingerprint && rowFingerprint(previousRow) !== expectedRowFingerprint) {
      return { conflict: true, sourceRowId, currentRow: previousRow };
    }
    const next = state.summary.map((row) => [...row]);
    // dropWrite simulates an apply helper that silently fails to store the value.
    if (!state.faults.dropWrite) {
      (WRITE_SETS[reviewTarget] || WRITE_SETS.safetySignificant).forEach((header) => {
        const index = headerIndex(header);
        if (index >= 0 && Object.prototype.hasOwnProperty.call(update || {}, header)) {
          next[rowIndex][index] = clean(update[header]);
        }
      });
    }

    // The real commit boundary: normalize, read back by stable id, verify, then store.
    const committedSummary = ensureClassificationResolutionStatus(next);
    const committedIndex = findRowIndexById(committedSummary, sourceRowId);
    if (committedIndex <= 0) throw new Error("The reviewed row could not be read back after the update. No change was saved.");
    const committedRow = [...committedSummary[committedIndex]];

    const verified = verifyGovernedDecision({ reviewTarget, update, headers: committedSummary[0], committedRow });
    if (!verified.ok) throw new Error(verified.error);

    state.summary = committedSummary;
    const resolution = inspectClassificationResolution(committedSummary[0], committedRow);
    return {
      sourceRowId,
      rowIndex: committedIndex,
      previousRow,
      nextRow: committedRow,
      headers: [...committedSummary[0]],
      changed: rowChanged(previousRow, committedRow),
      classificationResolutionStatus: resolution.status,
      classificationResolutionFindings: resolution.findings,
      classificationResolutionUnresolved: reviewTarget === "classificationResolution"
        && !VALIDATED_STATUSES.has(resolution.status),
    };
  };

  /**
   * Mirrors App.js undoHazardVibeReviewDecision: restore only the columns the
   * decision recorded as its governed write set, then re-derive.
   */
  const undoDecision = async ({ sourceRowId, previousGovernedFields }) => {
    state.undoCalls += 1;
    if (state.faults.undo) throw state.faults.undo;
    const rowIndex = findRowIndexById(state.summary, sourceRowId);
    if (rowIndex <= 0 || !previousGovernedFields) {
      throw new Error("The original governed fields are no longer available for a safe undo.");
    }
    const previousRow = [...state.summary[rowIndex]];
    const restored = state.summary.map((row, index) => (index === rowIndex
      ? row.map((value, columnIndex) => (
        Object.prototype.hasOwnProperty.call(previousGovernedFields, state.summary[0][columnIndex])
          ? previousGovernedFields[state.summary[0][columnIndex]]
          : value))
      : [...row]));
    state.summary = ensureClassificationResolutionStatus(restored);
    return {
      sourceRowId,
      rowIndex,
      previousRow,
      nextRow: [...state.summary[rowIndex]],
      headers: [...state.summary[0]],
    };
  };

  const ports = {
    applyDecision,
    undoDecision,
    saveSession: (session) => { state.sessions.push(JSON.parse(JSON.stringify(session))); },
    appendAudit: (record) => {
      if (state.faults.audit) throw state.faults.audit;
      state.audit.push(record);
    },
    captureDecision: async (payload) => {
      if (state.faults.capture) throw state.faults.capture;
      state.captured.push(payload);
    },
    emitCellImpacts: (payload) => { state.cellImpacts.push(payload); },
    onBookkeepingError: (error) => { state.bookkeepingErrors.push(error); },
    now: () => "2026-09-20T00:00:00.000Z",
  };

  return {
    state,
    ports,
    /** Current stored value of a column for a row, as it would appear on reload. */
    valueOf(rowId, header) {
      const index = findRowIndexById(state.summary, rowId);
      const columnIndex = state.summary[0].findIndex((candidate) => clean(candidate) === clean(header));
      return index > 0 && columnIndex >= 0 ? state.summary[index][columnIndex] : undefined;
    },
    savedSessions: () => state.sessions,
    lastSavedSession: () => state.sessions[state.sessions.length - 1] || null,
  };
}

/** A governed decision of the shape the engine expects from a proposal. */
export function significanceProposal(decision, rationale = "") {
  const governed = {
    "Safety Significant": decision,
    "Safety Significance Rationale": rationale
      || `Human-directed Vibe Review decision: Safety Significant = ${decision}.`,
  };
  return { normalizedDecision: decision, governedDecision: governed, ...governed };
}

export function classificationProposal(classification, extra = {}) {
  const governed = {
    "Safety Classification": classification,
    "Safety Classification Rule": classification === "Safety — Direct" ? "D1" : "N1",
    "Causal Path Type": classification === "Safety — Direct" ? "Direct" : "None",
    "Classification Evidence": "Human-directed Vibe Review decision recorded by the reviewer.",
    "Classification Confidence": "Medium",
    ...extra,
  };
  return { normalizedDecision: classification, governedDecision: governed, ...governed };
}

export function reviewCard(rowId) {
  return {
    sourceRowId: rowId,
    from: "Speed sensor",
    controlAction: "Reports vehicle speed",
    to: "Traction controller",
  };
}

/**
 * In-memory harness for the functional-decomposition review.
 *
 * Rows are objects keyed by a stable review id, mirroring the real
 * decomposition store. `Revise` on a row whose subsystem changes propagates to
 * every other row naming the same function, which is the atomic reallocation
 * the real apply path performs.
 */
export function createFunctionalReviewHarness({ rows } = {}) {
  const defaultRows = [
    { _functionalVibeReviewId: "FR-1", subsystem: "Sensing", fromFunction: "Measure speed", controlAction: "Report speed", toFunction: "Control traction" },
    { _functionalVibeReviewId: "FR-2", subsystem: "Control", fromFunction: "Control traction", controlAction: "Command torque", toFunction: "Drive wheels" },
  ];
  const state = {
    rows: (rows || defaultRows).map((row) => ({ ...row })),
    sessions: [],
    audit: [],
    captured: [],
    bookkeepingErrors: [],
    applyCalls: 0,
    undoCalls: 0,
    faults: { write: null, undo: null, audit: null, capture: null },
  };

  const indexOf = (rowId) => state.rows.findIndex((row) => String(row._functionalVibeReviewId) === String(rowId));

  const applyDecision = async ({ rowId, decision, proposedRow, expectedRowFingerprint }) => {
    state.applyCalls += 1;
    if (state.faults.write) throw state.faults.write;

    const rowIndex = indexOf(rowId);
    if (rowIndex < 0) return { missing: true, rowId };
    const previousRow = { ...state.rows[rowIndex] };
    if (expectedRowFingerprint
      && rowFingerprint(previousRow, { ignoreKeys: ["_functionalVibeReview"] }) !== expectedRowFingerprint) {
      return { conflict: true, rowId, currentRow: previousRow };
    }

    if (decision === "Remove") {
      state.rows = state.rows.filter((_, index) => index !== rowIndex);
      return { rowId, rowIndex, decision, previousRow, nextRows: state.rows.map((row) => ({ ...row })),
        affectedRows: [], state: { rows: snapshot() } };
    }

    const affectedRows = [];
    let nextRows = state.rows.map((row) => ({ ...row }));
    if (decision === "Revise") {
      const nextRow = { ...previousRow, ...proposedRow, _functionalVibeReviewId: rowId };
      nextRows[rowIndex] = nextRow;
      // One function has one owning subsystem: reallocating it on this row must
      // move every other row that names the same function, atomically.
      if (proposedRow?.subsystem && proposedRow.subsystem !== previousRow.subsystem) {
        nextRows = nextRows.map((row, index) => {
          if (index === rowIndex || row.fromFunction !== previousRow.fromFunction) return row;
          const updated = { ...row, subsystem: proposedRow.subsystem };
          affectedRows.push({ rowId: row._functionalVibeReviewId, rowIndex: index, previousRow: { ...row }, nextRow: updated, propagated: true });
          return updated;
        });
      }
    }
    state.rows = nextRows;
    return { rowId, rowIndex, decision, previousRow, nextRows: state.rows.map((row) => ({ ...row })),
      affectedRows, state: { rows: snapshot() } };
  };

  const undoDecision = async ({ record }) => {
    state.undoCalls += 1;
    if (state.faults.undo) throw state.faults.undo;
    if (!record?.previousRow) throw new Error("The original functional row is no longer available for undo.");

    if (record.decision === "Remove") {
      const restored = state.rows.map((row) => ({ ...row }));
      restored.splice(record.rowIndex, 0, { ...record.previousRow });
      state.rows = restored;
    } else {
      const rowIndex = indexOf(record.rowId);
      if (rowIndex < 0) throw new Error("The reviewed functional row is no longer present.");
      state.rows = state.rows.map((row, index) => (index === rowIndex ? { ...record.previousRow } : { ...row }));
      (record.affectedRows || []).filter((entry) => entry.propagated).forEach((entry) => {
        const index = indexOf(entry.rowId);
        if (index >= 0) state.rows[index] = { ...entry.previousRow };
      });
    }
    return { rowId: record.rowId, state: { rows: snapshot() } };
  };

  function snapshot() {
    return state.rows.map((row, rowIndex) => ({
      rowId: String(row._functionalVibeReviewId),
      rowIndex,
      row: { ...row },
    }));
  }

  const ports = {
    applyDecision,
    undoDecision,
    saveSession: (session) => { state.sessions.push(JSON.parse(JSON.stringify(session))); },
    appendAudit: (record) => {
      if (state.faults.audit) throw state.faults.audit;
      state.audit.push(record);
    },
    captureDecision: async (payload) => {
      if (state.faults.capture) throw state.faults.capture;
      state.captured.push(payload);
    },
    onBookkeepingError: (error) => { state.bookkeepingErrors.push(error); },
    now: () => "2026-09-20T00:00:00.000Z",
  };

  return {
    state,
    ports,
    snapshot,
    rowIds: () => state.rows.map((row) => String(row._functionalVibeReviewId)),
    rowOf: (rowId) => state.rows[indexOf(rowId)],
  };
}

export function functionalCard(rowId, label = "Measure speed → Report speed → Control traction") {
  return { rowId, label };
}
