import {
  CLASSIFICATION_RESOLUTION_STATUS_HEADER,
  deriveClassificationResolutionStatus,
} from "./classificationResolutionStatus";

const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

const DECISION_BASIS_COLUMNS = [
  "Function (From)",
  "Function (From) Details",
  "Control Action",
  "Control Action Details",
  "Function (To)",
  "Function (To) Details",
  "Operational Context ID",
  "Operational Scenario",
  "Operational Mode",
  "Operating Conditions",
  "Context Assumptions",
  "Guide Phrase",
];

const REGENERATION_IDENTITY_COLUMNS = [
  "Raw Analysis Row ID",
  "Raw Row ID",
  "Analysis Row ID",
  "Function (From)",
  "Function (From) Details",
  "Control Action",
  "Control Action Details",
  "Function (To)",
  "Function (To) Details",
  "Subsystem Allocation",
  "Operational Context ID",
  "Operational Scenario",
  "Operational Mode",
  "Operating Conditions",
  "Context Assumptions",
  "Guide Phrase",
];

const GOVERNED_PROVENANCE_COLUMNS = [
  "Reviewer Name",
  "Reviewed By",
  "Reviewed Timestamp",
  "Reviewed At",
  "Review Session ID",
  "Vibe Review Session ID",
  "Source ID",
  "Source Identity",
  "Source Run ID",
];

const APPLICABILITY_GOVERNANCE_COLUMNS = new Set([
  ...REGENERATION_IDENTITY_COLUMNS,
  "Guide Phrase Applicable",
  "Guide Phrase Applicability Rationale",
  "Guide Phrase Applicability Review Status",
]);

const PHYSICAL_HARM_NARRATIVE_COLUMNS = [
  "Loss", "Losses", "Hazard", "Hazards", "Raw Loss Candidate", "Raw Hazard Candidate",
  "Unsafe Control Action", "Causal Scenario", "Causal Factor", "Causal Effect",
  "Resulting System State", "Intermediate Safety Effect", "Classification Evidence",
];

const PLACEHOLDER = /^(?:|unknown|undetermined|needs review|uncertain|tbd|to be determined|n\/?a)$/i;
const AFFIRMATIVE_HARM = /\b(?:collision|crash|injur\w*|fatal\w*|death|physical harm|property damage|environmental harm|loss of (?:safe )?separation|unsafe proximity|unintended (?:physical )?(?:motion|movement)|hazardous energy)\b/i;

const findColumnIndex = (headers, name) => (headers || []).findIndex(
  (header) => clean(header).toLowerCase() === name.toLowerCase()
);

const cell = (headers, row, name) => {
  const index = findColumnIndex(headers, name);
  return index >= 0 ? row?.[index] : "";
};

export function buildReviewedRowRegenerationContext({ headers = [], row = [], reviewTarget = "", decision = "" } = {}) {
  if (!Array.isArray(headers) || !Array.isArray(row) || !headers.length) return "";
  const existingRow = Object.fromEntries(headers.map((header, index) => [clean(header), row[index] ?? ""]));
  return [
    "Full-row reviewed regeneration evidence:",
    `The human-reviewed ${clean(reviewTarget) || "decision"} is ${clean(decision) || "recorded in the row"} and is authoritative.`,
    "Regenerate the entire derived hazard-analysis row as one coherent assessment using the interface, operational context, and all substantive information in the existing row below.",
    "Recompute every downstream analytical field, including loss, hazard, unsafe control action, causal scenario/factor, classification, causal path, protections, mitigations, constraints, requirements, verification, confidence, and resolution status.",
    "Do not preserve blank, Unknown, Undetermined, Needs Review, Uncertain, TBD, or placeholder values merely because they appeared in the previous generated row. Resolve them when the supplied row evidence and reviewed decision support a conclusion.",
    "Do not invent architecture or numerical thresholds. If a value genuinely cannot be resolved from the supplied evidence, retain one precise evidence gap instead of propagating generic uncertainty across dependent fields.",
    "Preserve row identity, interface endpoints, guide phrase, and operational-context identity.",
    JSON.stringify(existingRow, null, 2),
  ].join("\n");
}

export function preserveRegeneratedRowIdentity({ headers = [], sourceRow = [], regeneratedRow = [] } = {}) {
  if (!Array.isArray(regeneratedRow)) return regeneratedRow;
  const next = [...regeneratedRow];
  [...REGENERATION_IDENTITY_COLUMNS, ...GOVERNED_PROVENANCE_COLUMNS].forEach((header) => {
    const index = findColumnIndex(headers, header);
    if (index >= 0 && sourceRow?.[index] !== undefined) next[index] = sourceRow[index];
  });
  return next;
}

const write = (headers, row, header, value) => {
  const index = findColumnIndex(headers, header);
  if (index >= 0) row[index] = value;
};

const substantiveIntermediateChain = (headers, row) => {
  const intermediateFunction = clean(cell(headers, row, "Intermediate Safety Function"));
  const intermediateEffect = clean(cell(headers, row, "Intermediate Safety Effect"));
  return !PLACEHOLDER.test(intermediateFunction)
    && !PLACEHOLDER.test(intermediateEffect)
    && !/^not applicable$/i.test(intermediateFunction)
    && !/^not applicable$/i.test(intermediateEffect);
};

const clearContradictoryIdentifiers = (headers, row, safetySignificant) => {
  ["Canonical Loss ID", "Canonical Hazard ID", "Loss ID", "Hazard ID"].forEach((header) => {
    const index = findColumnIndex(headers, header);
    if (index < 0) return;
    const value = clean(row[index]);
    const missionOnly = /^(?:M|MR|MISSION|RELIABILITY)[-_:\s]/i.test(value);
    const safetyOnly = /^(?:L|H|LOSS|HAZARD|SAFETY)[-_:\s]/i.test(value);
    if ((safetySignificant && missionOnly) || (!safetySignificant && safetyOnly)) row[index] = "";
  });
};

export function latestGuidePhraseReviewByRowId(reviewItems = [], projectId = "", auditRecords = []) {
  const byRowId = new Map();
  (reviewItems || []).forEach((item) => {
    const review = item?.vibeReview;
    if (review?.domain !== "hazard-analysis" || review?.reviewTarget !== "guidePhraseApplicable") return;
    if (String(item?.projectId || "") !== String(projectId || "")) return;
    const rowId = clean(review?.rowId || item?.currentContent?.rowId || item?.originalContent?.rowId);
    const decision = clean(review?.decision);
    if (!rowId || !/^(?:yes|no)$/i.test(decision)) return;
    const existing = byRowId.get(rowId);
    const itemTime = Date.parse(item?.reviewedAt || item?.updatedAt || item?.createdAt || 0) || 0;
    const existingTime = Date.parse(existing?.reviewedAt || existing?.updatedAt || existing?.createdAt || 0) || 0;
    if (!existing || itemTime >= existingTime) byRowId.set(rowId, item);
  });
  (auditRecords || [])
    .filter((record) => String(record?.projectId || "") === String(projectId || ""))
    .sort((a, b) => (Date.parse(a?.timestamp || 0) || 0) - (Date.parse(b?.timestamp || 0) || 0))
    .forEach((record) => {
      const rowId = clean(record?.sourceRowId || record?.rowId);
      if (!rowId) return;
      if (record?.action === "undo") {
        byRowId.delete(rowId);
        return;
      }
      const decision = clean(record?.newReviewValue || record?.newGovernedFields?.["Guide Phrase Applicable"]);
      if (record?.reviewTarget !== "guidePhraseApplicable" || !/^(?:yes|no)$/i.test(decision)) return;
      byRowId.set(rowId, {
        projectId: String(projectId || ""),
        reviewedAt: record.timestamp || "",
        currentContent: { rowId, columns: record.headers || [], row: record.nextRow || [] },
        vibeReview: {
          domain: "hazard-analysis",
          reviewTarget: "guidePhraseApplicable",
          rowId,
          decision,
          reviewerName: record.reviewerName || "",
        },
      });
    });
  return byRowId;
}

export function latestSafetySignificanceReviewByRowId(reviewItems = [], projectId = "", auditRecords = []) {
  const byRowId = new Map();
  (reviewItems || []).forEach((item) => {
    const review = item?.vibeReview;
    if (review?.domain !== "hazard-analysis" || review?.reviewTarget !== "safetySignificant") return;
    if (String(item?.projectId || "") !== String(projectId || "")) return;
    const rowId = clean(review?.rowId || item?.currentContent?.rowId || item?.originalContent?.rowId);
    const decision = clean(review?.decision);
    if (!rowId || !/^(?:yes|no)$/i.test(decision)) return;
    const existing = byRowId.get(rowId);
    const itemTime = Date.parse(item?.reviewedAt || item?.updatedAt || item?.createdAt || 0) || 0;
    const existingTime = Date.parse(existing?.reviewedAt || existing?.updatedAt || existing?.createdAt || 0) || 0;
    if (!existing || itemTime >= existingTime) byRowId.set(rowId, item);
  });
  (auditRecords || [])
    .filter((record) => String(record?.projectId || "") === String(projectId || ""))
    .sort((a, b) => (Date.parse(a?.timestamp || 0) || 0) - (Date.parse(b?.timestamp || 0) || 0))
    .forEach((record) => {
      const rowId = clean(record?.sourceRowId || record?.rowId);
      if (!rowId) return;
      if (record?.action === "undo") {
        byRowId.delete(rowId);
        return;
      }
      const decision = clean(record?.newReviewValue || record?.newGovernedFields?.["Safety Significant"]);
      if (record?.reviewTarget !== "safetySignificant" || !/^(?:yes|no)$/i.test(decision)) return;
      byRowId.set(rowId, {
        projectId: String(projectId || ""),
        reviewedAt: record.timestamp || "",
        currentContent: { rowId, columns: record.headers || [], row: record.nextRow || [] },
        vibeReview: {
          domain: "hazard-analysis",
          reviewTarget: "safetySignificant",
          rowId,
          decision,
          reviewerName: record.reviewerName || "",
        },
      });
    });
  return byRowId;
}

export function reconcileRegeneratedGuidePhraseReview({
  headers = [],
  previousRow = [],
  currentBasisRow,
  regeneratedRow = [],
  reviewItem = null,
} = {}) {
  if (!reviewItem || !Array.isArray(regeneratedRow)) {
    return { row: regeneratedRow, status: "unreviewed", changedBasisFields: [] };
  }

  const reviewedColumns = reviewItem?.currentContent?.columns;
  const reviewedRow = reviewItem?.currentContent?.row;
  const comparisonHeaders = Array.isArray(reviewedColumns) && reviewedColumns.length ? reviewedColumns : headers;
  const reviewedBasisRow = Array.isArray(reviewedRow) ? reviewedRow : (Array.isArray(previousRow) ? previousRow : []);
  const basisRow = Array.isArray(currentBasisRow) ? currentBasisRow : regeneratedRow;
  const changedBasisFields = DECISION_BASIS_COLUMNS.filter((column) => (
    clean(cell(comparisonHeaders, reviewedBasisRow, column)) !== clean(cell(headers, basisRow, column))
  ));
  const decisionIndex = findColumnIndex(headers, "Guide Phrase Applicable");
  const rationaleIndex = findColumnIndex(headers, "Guide Phrase Applicability Rationale");
  const next = [...regeneratedRow];

  if (changedBasisFields.length) {
    if (decisionIndex >= 0) next[decisionIndex] = "Needs Review";
    if (rationaleIndex >= 0) {
      next[rationaleIndex] = `Needs review: the prior reviewed applicability decision was invalidated because the regeneration basis changed (${changedBasisFields.join(", ")}).`;
    }
    return { row: next, status: "basis-changed", changedBasisFields };
  }

  const reviewedDecision = Array.isArray(reviewedColumns) && Array.isArray(reviewedRow)
    ? clean(cell(reviewedColumns, reviewedRow, "Guide Phrase Applicable"))
    : clean(reviewItem?.vibeReview?.decision);
  if (!/^(?:yes|no)$/i.test(reviewedDecision)) {
    return { row: regeneratedRow, status: "unreviewed", changedBasisFields: [] };
  }

  const reviewedRationale = Array.isArray(reviewedColumns) && Array.isArray(reviewedRow)
    ? cell(reviewedColumns, reviewedRow, "Guide Phrase Applicability Rationale")
    : "";
  if (decisionIndex >= 0) next[decisionIndex] = reviewedDecision;
  if (rationaleIndex >= 0 && clean(reviewedRationale)) next[rationaleIndex] = reviewedRationale;
  if (/^no$/i.test(reviewedDecision)) {
    headers.forEach((header, index) => {
      if (!APPLICABILITY_GOVERNANCE_COLUMNS.has(clean(header))) next[index] = "Not Applicable";
    });
    const classificationRuleIndex = findColumnIndex(headers, "Safety Classification Rule");
    const causalPathIndex = findColumnIndex(headers, "Causal Path Type");
    if (classificationRuleIndex >= 0) next[classificationRuleIndex] = "N4";
    if (causalPathIndex >= 0) next[causalPathIndex] = "None";
  }
  return {
    row: next,
    status: "preserved",
    changedBasisFields: [],
    reviewedAt: reviewItem.reviewedAt || reviewItem.updatedAt || "",
    reviewerName: reviewItem?.vibeReview?.reviewerName || "",
  };
}

export function restoreReviewedGuidePhraseDecisions(summary, reviewByRowId) {
  if (!Array.isArray(summary?.[0]) || !(reviewByRowId instanceof Map) || !reviewByRowId.size) {
    return { summary, changed: false, restoredRowIds: [] };
  }
  const headers = summary[0];
  const rowIdIndex = ["Raw Analysis Row ID", "Raw Row ID", "Analysis Row ID"]
    .map((name) => findColumnIndex(headers, name))
    .find((index) => index >= 0);
  if (!Number.isFinite(rowIdIndex)) return { summary, changed: false, restoredRowIds: [] };
  const restoredRowIds = [];
  const rows = summary.slice(1).map((row) => {
    const rowId = clean(row?.[rowIdIndex]);
    const reviewItem = reviewByRowId.get(rowId);
    if (!reviewItem) return row;
    const result = reconcileRegeneratedGuidePhraseReview({
      headers,
      previousRow: row,
      currentBasisRow: row,
      regeneratedRow: row,
      reviewItem,
    });
    if (result.status !== "preserved" || JSON.stringify(result.row) === JSON.stringify(row)) return row;
    restoredRowIds.push(rowId);
    return result.row;
  });
  return {
    summary: restoredRowIds.length ? [headers, ...rows] : summary,
    changed: restoredRowIds.length > 0,
    restoredRowIds,
  };
}

export function applyReviewedApplicabilityToGenerationInput({
  headers = [],
  previousRow = [],
  currentBasisRow = [],
  reviewItem = null,
  functionalRow = {},
} = {}) {
  const reconciliation = reconcileRegeneratedGuidePhraseReview({
    headers,
    previousRow,
    currentBasisRow,
    regeneratedRow: currentBasisRow,
    reviewItem,
  });
  if (reconciliation.status !== "preserved") {
    return { functionalRow, reconciliation };
  }
  return {
    functionalRow: {
      ...functionalRow,
      guidePhraseApplicable: cell(headers, reconciliation.row, "Guide Phrase Applicable"),
      guidePhraseApplicabilityRationale: cell(headers, reconciliation.row, "Guide Phrase Applicability Rationale"),
      guidePhraseApplicabilityReviewStatus: "Reviewed",
    },
    reconciliation,
  };
}

export function reconcileRegeneratedSafetySignificanceReview({
  headers = [],
  regeneratedRow = [],
  reviewItem = null,
} = {}) {
  if (!reviewItem || !Array.isArray(regeneratedRow)) {
    return { row: regeneratedRow, status: "unreviewed" };
  }
  const reviewedColumns = reviewItem?.currentContent?.columns;
  const reviewedRow = reviewItem?.currentContent?.row;
  const decision = Array.isArray(reviewedColumns) && Array.isArray(reviewedRow)
    ? clean(cell(reviewedColumns, reviewedRow, "Safety Significant"))
    : clean(reviewItem?.vibeReview?.decision);
  if (!/^(?:yes|no)$/i.test(decision)) return { row: regeneratedRow, status: "unreviewed" };
  const rationale = Array.isArray(reviewedColumns) && Array.isArray(reviewedRow)
    ? cell(reviewedColumns, reviewedRow, "Safety Significance Rationale")
    : "";
  const next = [...regeneratedRow];
  const decisionIndex = findColumnIndex(headers, "Safety Significant");
  const rationaleIndex = findColumnIndex(headers, "Safety Significance Rationale");
  const classificationIndex = findColumnIndex(headers, "Safety Classification");
  const classificationRuleIndex = findColumnIndex(headers, "Safety Classification Rule");
  const causalPathTypeIndex = findColumnIndex(headers, "Causal Path Type");
  const intermediateFunctionIndex = findColumnIndex(headers, "Intermediate Safety Function");
  const intermediateEffectIndex = findColumnIndex(headers, "Intermediate Safety Effect");
  const applicable = clean(cell(headers, next, "Guide Phrase Applicable"));
  if (/^no$|^not applicable$/i.test(applicable)) {
    headers.forEach((header, index) => {
      if (!APPLICABILITY_GOVERNANCE_COLUMNS.has(clean(header))) next[index] = "Not Applicable";
    });
    if (classificationRuleIndex >= 0) next[classificationRuleIndex] = "N4";
    if (causalPathTypeIndex >= 0) next[causalPathTypeIndex] = "None";
    return {
      row: next,
      status: "preserved",
      reviewedAt: reviewItem.reviewedAt || reviewItem.updatedAt || "",
      reviewerName: reviewItem?.vibeReview?.reviewerName || "",
    };
  }
  if (decisionIndex >= 0) next[decisionIndex] = decision;
  if (rationaleIndex >= 0 && clean(rationale)) next[rationaleIndex] = rationale;
  if (/^no$/i.test(decision)) {
    if (classificationIndex >= 0) next[classificationIndex] = "Mission/Reliability";
    if (classificationRuleIndex >= 0) next[classificationRuleIndex] = "M1";
    if (causalPathTypeIndex >= 0) next[causalPathTypeIndex] = "None";
    if (intermediateFunctionIndex >= 0) next[intermediateFunctionIndex] = "Not Applicable";
    if (intermediateEffectIndex >= 0) next[intermediateEffectIndex] = "Not Applicable";
    const protectionAssessmentIndex = findColumnIndex(headers, "Protection Assessment");
    const protectionStatusIndex = findColumnIndex(headers, "Protection Status");
    const terminationIndex = findColumnIndex(headers, "Physical-Harm Chain Termination");
    const evidenceIndex = findColumnIndex(headers, "Classification Evidence");
    if (protectionAssessmentIndex >= 0 && PLACEHOLDER.test(clean(next[protectionAssessmentIndex]))) {
      next[protectionAssessmentIndex] = "No protection is credited by this non-safety disposition.";
    }
    if (protectionStatusIndex >= 0) next[protectionStatusIndex] = "Not Applicable";
    const overrideNote = "Human disposition overrides the prior generated safety interpretation; no safety-significant physical-harm path is retained.";
    if (terminationIndex >= 0) next[terminationIndex] = overrideNote;
    if (evidenceIndex >= 0 && (PLACEHOLDER.test(clean(next[evidenceIndex])) || AFFIRMATIVE_HARM.test(clean(next[evidenceIndex])))) {
      next[evidenceIndex] = overrideNote;
    }
    PHYSICAL_HARM_NARRATIVE_COLUMNS.forEach((header) => {
      const index = findColumnIndex(headers, header);
      if (index >= 0 && AFFIRMATIVE_HARM.test(clean(next[index]))) {
        next[index] = `Mission/reliability effect of the ${clean(cell(headers, next, "Guide Phrase")) || "reviewed deviation"}; prior generated physical-harm claim removed by human disposition.`;
      }
    });
    const confidenceIndex = findColumnIndex(headers, "Classification Confidence");
    if (confidenceIndex >= 0 && PLACEHOLDER.test(clean(next[confidenceIndex]))) next[confidenceIndex] = "Human Reviewed";
  } else {
    const generatedClassification = classificationIndex >= 0 ? clean(next[classificationIndex]) : "";
    const hasIntermediate = !PLACEHOLDER.test(clean(next[intermediateFunctionIndex]))
      && !PLACEHOLDER.test(clean(next[intermediateEffectIndex]));
    const useRelated = hasIntermediate && !/^Safety\s*[—-]\s*Direct$/i.test(generatedClassification);
    if (classificationIndex >= 0) next[classificationIndex] = useRelated ? "Safety — Related" : "Safety — Direct";
    if (classificationRuleIndex >= 0 && !new RegExp(useRelated ? "^R[1-4]$" : "^D[1-3]$", "i").test(clean(next[classificationRuleIndex]))) {
      next[classificationRuleIndex] = useRelated ? "R1" : "D1";
    }
    if (causalPathTypeIndex >= 0) next[causalPathTypeIndex] = useRelated ? "Contributory" : "Direct";
    if (!useRelated) {
      if (intermediateFunctionIndex >= 0) next[intermediateFunctionIndex] = "Not Applicable";
      if (intermediateEffectIndex >= 0) next[intermediateEffectIndex] = "Not Applicable";
    }
  }
  return {
    row: next,
    status: "preserved",
    reviewedAt: reviewItem.reviewedAt || reviewItem.updatedAt || "",
    reviewerName: reviewItem?.vibeReview?.reviewerName || "",
  };
}

// This is the sole post-generation persistence boundary for reviewed hazard rows.
// It is intentionally pure so batch, scoped, and resumed regeneration cannot drift.
export function normalizeReviewedHazardRowForPersistence({
  headers = [],
  sourceRow = [],
  previousRow = sourceRow,
  currentBasisRow = sourceRow,
  regeneratedRow = [],
  guidePhraseReviewItem = null,
  safetySignificanceReviewItem = null,
} = {}) {
  const identityPreservedRow = preserveRegeneratedRowIdentity({ headers, sourceRow, regeneratedRow });
  const guidePhraseReview = reconcileRegeneratedGuidePhraseReview({
    headers,
    previousRow,
    currentBasisRow,
    regeneratedRow: identityPreservedRow,
    reviewItem: guidePhraseReviewItem,
  });
  const safetySignificanceReview = reconcileRegeneratedSafetySignificanceReview({
    headers,
    regeneratedRow: guidePhraseReview.row,
    reviewItem: safetySignificanceReviewItem,
  });
  const row = preserveRegeneratedRowIdentity({
    headers,
    sourceRow,
    regeneratedRow: safetySignificanceReview.row,
  });
  const applicable = clean(cell(headers, row, "Guide Phrase Applicable"));
  const governedSafety = clean(cell(headers, row, "Safety Significant"));

  if (/^no$|^not applicable$/i.test(applicable)) {
    // The applicability reconciler applies the existing product-wide N/A policy.
    write(headers, row, "Safety Classification", "Not Applicable");
    write(headers, row, "Safety Classification Rule", "N4");
    write(headers, row, "Causal Path Type", "None");
  } else if (/^yes$/i.test(governedSafety)) {
    const related = substantiveIntermediateChain(headers, row);
    write(headers, row, "Safety Classification", related ? "Safety — Related" : "Safety — Direct");
    const rule = clean(cell(headers, row, "Safety Classification Rule"));
    write(headers, row, "Safety Classification Rule",
      new RegExp(related ? "^R[1-4]$" : "^D[1-3]$", "i").test(rule) ? rule.toUpperCase() : related ? "R1" : "D1");
    write(headers, row, "Causal Path Type", related ? "Contributory" : "Direct");
    if (!related) {
      write(headers, row, "Intermediate Safety Function", "Not Applicable");
      write(headers, row, "Intermediate Safety Effect", "Not Applicable");
    }
    clearContradictoryIdentifiers(headers, row, true);
  } else if (/^no$/i.test(governedSafety)) {
    write(headers, row, "Safety Classification", "Mission/Reliability");
    const rule = clean(cell(headers, row, "Safety Classification Rule"));
    write(headers, row, "Safety Classification Rule", /^M[1-4]$/i.test(rule) ? rule.toUpperCase() : "M1");
    write(headers, row, "Causal Path Type", "None");
    clearContradictoryIdentifiers(headers, row, false);
  }

  const resolutionStatusIndex = findColumnIndex(headers, CLASSIFICATION_RESOLUTION_STATUS_HEADER);
  if (resolutionStatusIndex >= 0) {
    row[resolutionStatusIndex] = deriveClassificationResolutionStatus(headers, row);
  }
  return { row, guidePhraseReview, safetySignificanceReview };
}

export function applyReviewedSafetySignificanceToGenerationInput({
  headers = [],
  reviewItem = null,
  functionalRow = {},
} = {}) {
  const reviewedColumns = reviewItem?.currentContent?.columns;
  const reviewedRow = reviewItem?.currentContent?.row;
  const decision = Array.isArray(reviewedColumns) && Array.isArray(reviewedRow)
    ? clean(cell(reviewedColumns, reviewedRow, "Safety Significant"))
    : clean(reviewItem?.vibeReview?.decision);
  if (!/^(?:yes|no)$/i.test(decision)) return { functionalRow, status: "unreviewed" };
  const rationale = Array.isArray(reviewedColumns) && Array.isArray(reviewedRow)
    ? cell(reviewedColumns, reviewedRow, "Safety Significance Rationale")
    : "";
  return {
    functionalRow: {
      ...functionalRow,
      safetySignificant: decision,
      safetySignificanceRationale: rationale,
      safetySignificanceReviewStatus: "Reviewed",
    },
    status: "preserved",
  };
}
