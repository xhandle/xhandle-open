import {
  auditSafetyClassificationRecord,
  normalizeSafetyClassification,
} from "./safetySignificancePolicy";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalized = (value) => clean(value).toLowerCase();

export const CLASSIFICATION_RESOLUTION_STATUS_HEADER = "Classification Resolution Status";

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

export function deriveClassificationResolutionStatus(headers = [], row = []) {
  const fields = fieldsFromRow(headers, row);
  if (rowNeedsReview(fields)) return CLASSIFICATION_RESOLUTION_STATUS.NEEDS_REVIEW;

  const humanDisposition = hasHumanDisposition(fields);
  if (!hasCompletePolicySchema(headers)) {
    return humanDisposition
      ? CLASSIFICATION_RESOLUTION_STATUS.HUMAN_EVIDENCE_GAP
      : CLASSIFICATION_RESOLUTION_STATUS.NOT_EVALUATED;
  }

  const audit = auditSafetyClassificationRecord(policyRecord(fields), {
    from: fields["Function (From)"],
    controlAction: fields["Control Action"],
    to: fields["Function (To)"],
    guidePhrase: fields["Guide Phrase"],
  });
  if (humanDisposition) {
    return audit.validationFindings.length
      ? CLASSIFICATION_RESOLUTION_STATUS.HUMAN_EVIDENCE_GAP
      : CLASSIFICATION_RESOLUTION_STATUS.HUMAN_POLICY_VALIDATED;
  }
  return audit.validationFindings.length
    ? CLASSIFICATION_RESOLUTION_STATUS.POLICY_GAP
    : CLASSIFICATION_RESOLUTION_STATUS.POLICY_VALIDATED;
}

export function ensureClassificationResolutionStatus(summary = []) {
  if (!Array.isArray(summary?.[0])) return summary;
  const sourceHeaders = summary[0].map(clean);
  if (indexOfHeader(sourceHeaders, ["Safety Classification", "Safety Significant"]) < 0) return summary;
  const existingIndex = indexOfHeader(sourceHeaders, [CLASSIFICATION_RESOLUTION_STATUS_HEADER]);
  const headers = existingIndex >= 0
    ? [...sourceHeaders]
    : [...sourceHeaders, CLASSIFICATION_RESOLUTION_STATUS_HEADER];
  const statusIndex = existingIndex >= 0 ? existingIndex : headers.length - 1;
  const rows = summary.slice(1).map((sourceRow) => {
    const row = [...(Array.isArray(sourceRow) ? sourceRow : [])];
    while (row.length < headers.length) row.push("");
    row[statusIndex] = deriveClassificationResolutionStatus(sourceHeaders, sourceRow);
    return row;
  });
  return [headers, ...rows];
}

export function normalizeHazardAnalysisResolutionStatus(analysisResult = null) {
  if (!analysisResult || typeof analysisResult !== "object" || !Array.isArray(analysisResult.Summary?.[0])) {
    return analysisResult;
  }
  return {
    ...analysisResult,
    Summary: ensureClassificationResolutionStatus(analysisResult.Summary),
  };
}
