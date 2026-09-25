import {
  auditSafetyClassificationRecord,
  normalizeSafetyClassification,
} from "./safetySignificancePolicy";
import {
  describeSignificanceConflict,
  derivedSignificanceConflict,
  reconcileDerivedSafetyColumns,
} from "./safetyColumnSchema";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalized = (value) => clean(value).toLowerCase();

export const CLASSIFICATION_RESOLUTION_STATUS_HEADER = "Classification Resolution Status";
export const RAW_ANALYSIS_ROW_ID_HEADER = "Raw Analysis Row ID";

export const CLASSIFICATION_RESOLUTION_STATUS = Object.freeze({
  NEEDS_REVIEW: "Needs Review",
  POLICY_VALIDATED: "Policy Validated",
  POLICY_GAP: "Policy Validation Gap",
  HUMAN_POLICY_VALIDATED: "Human Disposition — Policy Validated",
  HUMAN_EVIDENCE_GAP: "Human Disposition — Evidence Gap",
  NOT_EVALUATED: "Not Evaluated",
});

const REQUIRED_POLICY_HEADERS = [
  "causal effect",
  "resulting system state",
  "protection assessment",
  "physical-harm chain termination",
];

function indexOfHeader(headers = [], candidates = []) {
  const normalizedHeaders = headers.map(normalized);
  return candidates
    .map((candidate) => normalizedHeaders.indexOf(normalized(candidate)))
    .find((index) => index >= 0) ?? -1;
}

function stableRowId(value = "") {
  // FNV-1a keeps legacy analyses reviewable without depending on an AI-issued
  // identifier. The row position is included by the caller to disambiguate
  // otherwise identical analysis variants; once normalized, the ID persists.
  let hash = 0x811c9dc5;
  const input = String(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `RAW-${(hash >>> 0).toString(36).toUpperCase().padStart(7, "0")}`;
}

export function ensureHazardAnalysisRowIds(summary = []) {
  if (!Array.isArray(summary?.[0])) return summary;
  const sourceHeaders = summary[0].map(clean);
  const existingIndex = indexOfHeader(sourceHeaders, [
    RAW_ANALYSIS_ROW_ID_HEADER,
    "Raw Row ID",
    "Analysis Row ID",
    "Row ID",
  ]);
  const headers = existingIndex >= 0
    ? [...sourceHeaders]
    : [...sourceHeaders, RAW_ANALYSIS_ROW_ID_HEADER];
  const idIndex = existingIndex >= 0 ? existingIndex : headers.length - 1;
  const used = new Set();
  const rows = summary.slice(1).map((sourceRow, rowOffset) => {
    const row = Array.isArray(sourceRow) ? [...sourceRow] : [];
    while (row.length < headers.length) row.push("");
    let id = clean(row[idIndex]);
    if (!id) {
      const identityCells = sourceHeaders.map((header, index) => (
        index === existingIndex || normalized(header) === normalized(CLASSIFICATION_RESOLUTION_STATUS_HEADER)
          ? ""
          : clean(row[index])
      ));
      let salt = rowOffset + 1;
      do {
        id = stableRowId(`${identityCells.join("\u001f")}\u001e${salt}`);
        salt += 1;
      } while (used.has(id));
      row[idIndex] = id;
    }
    used.add(id);
    return row;
  });
  return [headers, ...rows];
}

function fieldsFromRow(headers = [], row = []) {
  return Object.fromEntries(headers.map((header, index) => [clean(header), clean(row?.[index])]));
}

function hasCompletePolicySchema(headers = []) {
  const available = new Set(headers.map(normalized));
  return REQUIRED_POLICY_HEADERS.every((header) => available.has(header))
    && ["hazards", "hazard"].some((header) => available.has(header))
    && ["losses", "loss"].some((header) => available.has(header));
}

function policyRecord(fields = {}) {
  return {
    guidePhrase: fields["Guide Phrase"],
    guidePhraseApplicable: fields["Guide Phrase Applicable"],
    safetyClassification: fields["Safety Classification"],
    safetyClassificationRule: fields["Safety Classification Rule"] || fields["Classification Rule"],
    causalPathType: fields["Causal Path Type"],
    causalEffect: fields["Causal Effect"],
    resultingSystemState: fields["Resulting System State"],
    intermediateSafetyFunction: fields["Intermediate Safety Function"],
    intermediateSafetyEffect: fields["Intermediate Safety Effect"],
    protectionAssessment: fields["Protection Assessment"],
    protectionStatus: fields["Protection Status"],
    physicalHarmChainTermination: fields["Physical-Harm Chain Termination"],
    classificationEvidence: fields["Classification Evidence"],
    safetySignificanceRationale: fields["Safety Significance Rationale"],
    proposedSafetyAssessmentRationale: fields["Proposed Safety Assessment Rationale"],
    proposedSafetyAssessment: fields["Proposed Safety Assessment"],
    safetySignificant: fields["Safety Significant"],
    losses: fields.Losses || fields.Loss,
    hazards: fields.Hazards || fields.Hazard,
    causalScenario: fields["Causal Scenario"],
    safetyExposurePath: fields["Safety Exposure Path"],
  };
}

function hasHumanDisposition(fields = {}) {
  const basis = [
    fields["Classification Evidence"],
    fields["Safety Significance Rationale"],
    fields["Proposed Safety Assessment Rationale"],
  ].map(clean).join(" ");
  return /\b(?:human (?:reviewer )?disposition|human-directed vibe review|human adjudication)\b/i.test(basis);
}

function rowNeedsReview(fields = {}) {
  const classification = clean(fields["Safety Classification"]);
  return [
    classification,
    fields["Safety Significant"],
    fields["Guide Phrase Applicable"],
  ].some((value) => /^needs review$/i.test(clean(value)))
    || (classification && normalizeSafetyClassification(classification) === "Needs Review");
}

export function inspectClassificationResolution(headers = [], row = []) {
  const fields = fieldsFromRow(headers, row);
  if (rowNeedsReview(fields)) return {
    status: CLASSIFICATION_RESOLUTION_STATUS.NEEDS_REVIEW,
    findings: ["A governed applicability, safety-significance, or safety-classification decision still needs review."],
  };

  const humanDisposition = hasHumanDisposition(fields);

  // A governed significance decision that the classification contradicts is
  // never resolved automatically, so it must block validation in every branch
  // below rather than being reconciled away on the path to storage.
  const significanceConflict = derivedSignificanceConflict(headers, row);
  const conflictFindings = significanceConflict ? [describeSignificanceConflict(significanceConflict)] : [];
  const gapStatus = humanDisposition
    ? CLASSIFICATION_RESOLUTION_STATUS.HUMAN_EVIDENCE_GAP
    : CLASSIFICATION_RESOLUTION_STATUS.POLICY_GAP;

  if (!hasCompletePolicySchema(headers)) {
    return {
      status: significanceConflict
        ? gapStatus
        : (humanDisposition
          ? CLASSIFICATION_RESOLUTION_STATUS.HUMAN_EVIDENCE_GAP
          : CLASSIFICATION_RESOLUTION_STATUS.NOT_EVALUATED),
      findings: [
        ...conflictFindings,
        "The hazard summary does not contain the complete policy-evidence schema required for validation.",
      ],
    };
  }

  const audit = auditSafetyClassificationRecord(policyRecord(fields), {
    from: fields["Function (From)"],
    controlAction: fields["Control Action"],
    to: fields["Function (To)"],
    guidePhrase: fields["Guide Phrase"],
  });
  const unresolved = significanceConflict || audit.validationFindings.length;
  return {
    status: humanDisposition
      ? (unresolved
        ? CLASSIFICATION_RESOLUTION_STATUS.HUMAN_EVIDENCE_GAP
        : CLASSIFICATION_RESOLUTION_STATUS.HUMAN_POLICY_VALIDATED)
      : (unresolved
        ? CLASSIFICATION_RESOLUTION_STATUS.POLICY_GAP
        : CLASSIFICATION_RESOLUTION_STATUS.POLICY_VALIDATED),
    findings: [...conflictFindings, ...(audit.validationFindings || [])],
    audit,
    significanceConflict: significanceConflict || null,
  };
}

export function deriveClassificationResolutionStatus(headers = [], row = []) {
  return inspectClassificationResolution(headers, row).status;
}

export function ensureClassificationResolutionStatus(summary = []) {
  if (!Array.isArray(summary?.[0])) return summary;
  const identifiedSummary = ensureHazardAnalysisRowIds(summary);
  const sourceHeaders = identifiedSummary[0].map(clean);
  if (indexOfHeader(sourceHeaders, ["Safety Classification", "Safety Significant"]) < 0) return summary;
  const existingIndex = indexOfHeader(sourceHeaders, [CLASSIFICATION_RESOLUTION_STATUS_HEADER]);
  const headers = existingIndex >= 0
    ? [...sourceHeaders]
    : [...sourceHeaders, CLASSIFICATION_RESOLUTION_STATUS_HEADER];
  const statusIndex = existingIndex >= 0 ? existingIndex : headers.length - 1;
  const rows = identifiedSummary.slice(1).map((sourceRow) => {
    const row = reconcileDerivedSafetyColumns(sourceHeaders, Array.isArray(sourceRow) ? sourceRow : []);
    while (row.length < headers.length) row.push("");
    row[statusIndex] = deriveClassificationResolutionStatus(sourceHeaders, row);
    return row;
  });
  return [headers, ...rows];
}

export function normalizeHazardAnalysisResolutionStatus(analysisResult = null) {
  if (!analysisResult || typeof analysisResult !== "object" || !Array.isArray(analysisResult.Summary?.[0])) {
    return analysisResult;
  }
  const sourceHeaders = analysisResult.Summary[0];
  const omitted = new Set(["proposed safety assessment", "proposed safety assessment rationale"]);
  const keepIndexes = sourceHeaders
    .map((header, index) => ({ header: normalized(header), index }))
    .filter(({ header }) => !omitted.has(header))
    .map(({ index }) => index);
  const summary = keepIndexes.length === sourceHeaders.length
    ? analysisResult.Summary
    : analysisResult.Summary.map((row) => keepIndexes.map((index) => row?.[index] ?? ""));
  return {
    ...analysisResult,
    Summary: ensureClassificationResolutionStatus(summary),
  };
}
