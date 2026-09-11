// Scores a hazard-analysis run against engineer-approved labels.
//
// The generation pipeline already enforces structure (schema, evidence quotes,
// reason codes). Nothing measured whether its engineering conclusions match what
// a qualified engineer would approve, so every prompt or threshold change was an
// unmeasured guess. These metrics make the four known failure modes countable:
// over-application, safety over-classification, unconverged canonicalization,
// and requirements that contradict the stated architecture.

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalized = (value) => text(value).toLowerCase();

const YES = "yes";
const NO = "no";

export function normalizeExpectedDecision(value) {
  const decision = normalized(value);
  if (/^(?:yes|applicable|true|significant|safety)\b/.test(decision)) return YES;
  if (/^(?:no|not applicable|false|non-safety|mission)\b/.test(decision)) return NO;
  return null;
}

// The pipeline writes "Yes" / "No" / "Needs Review". "Needs Review" is a real
// third state, not a silent yes: it means the run declined to decide. Scoring it
// as applicable would hide the declines, so it is counted separately.
export function normalizeProducedApplicability(row = {}) {
  const value = normalized(row.guidePhraseApplicable);
  if (/^yes\b|^applicable\b/.test(value)) return YES;
  if (/^no\b|^not applicable\b/.test(value)) return NO;
  return null;
}

export function normalizeProducedSafetySignificance(row = {}) {
  const assessment = normalized(row.proposedSafetyAssessment);
  if (/^safety\b/.test(assessment)) return YES;
  if (/^mission/.test(assessment)) return NO;
  const significance = normalized(row.safetySignificant);
  if (/^yes\b/.test(significance)) return YES;
  if (/^no\b/.test(significance)) return NO;
  return null;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function emptyConfusion() {
  return { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0, undecided: 0, unlabeled: 0 };
}

function recordConfusion(counts, expected, produced) {
  if (expected === null) {
    counts.unlabeled += 1;
    return;
  }
  if (produced === null) {
    counts.undecided += 1;
    return;
  }
  if (expected === YES && produced === YES) counts.truePositive += 1;
  else if (expected === NO && produced === YES) counts.falsePositive += 1;
  else if (expected === NO && produced === NO) counts.trueNegative += 1;
  else counts.falseNegative += 1;
}

function summarizeConfusion(counts) {
  const { truePositive, falsePositive, trueNegative, falseNegative } = counts;
  const decided = truePositive + falsePositive + trueNegative + falseNegative;
  return {
    ...counts,
    decided,
    precision: ratio(truePositive, truePositive + falsePositive),
    recall: ratio(truePositive, truePositive + falseNegative),
    f1: ratio(2 * truePositive, 2 * truePositive + falsePositive + falseNegative),
    accuracy: ratio(truePositive + trueNegative, decided),
    // The headline number for over-generation: of the deviations an engineer
    // judged to have no credible mechanism, how many did the run claim anyway.
    falsePositiveRate: ratio(falsePositive, falsePositive + trueNegative),
  };
}

export function matchRowsToItems(items = [], rows = []) {
  const byExactId = new Map();
  const byItemPrefix = new Map();
  rows.forEach((row) => {
    const id = text(row?.id);
    if (!id) return;
    byExactId.set(id, row);
    const prefix = id.replace(/-(?:STPA|FMEA|HARA|FHA|WHATIF)$/i, "");
    if (!byItemPrefix.has(prefix)) byItemPrefix.set(prefix, row);
  });
  return items.map((item, index) => {
    const itemId = text(item?.id);
    return byExactId.get(itemId)
      || byItemPrefix.get(itemId)
      || rows[index]
      || null;
  });
}

function requirementText(row = {}) {
  return text(row.systemRequirement || row.safetyRequirementsConstraints || row.safetyConstraint);
}

function hazardText(row = {}) {
  return text(row.hazards || row.hazard || row.rawHazardCandidate);
}

// A forbidden claim is a plain phrase an engineer marked as contradicting the
// fixture's stated architecture (e.g. requiring a powered command in a context
// whose assumption is passive fail-safe on power loss).
function findForbiddenClaims(row, forbiddenClaims = []) {
  const requirement = normalized(requirementText(row));
  const mitigation = normalized(row.mitigationStrategy);
  const haystack = `${requirement} ${mitigation}`;
  return forbiddenClaims.filter((claim) => {
    const needle = normalized(claim);
    return needle && haystack.includes(needle);
  });
}

export function scoreApplicability(items = [], matchedRows = []) {
  const counts = emptyConfusion();
  const disagreements = [];
  items.forEach((item, index) => {
    const expected = normalizeExpectedDecision(item?.expected?.applicable);
    const row = matchedRows[index];
    const produced = row ? normalizeProducedApplicability(row) : null;
    recordConfusion(counts, expected, produced);
    if (expected !== null && produced !== null && expected !== produced) {
      disagreements.push({
        itemId: text(item?.id),
        guidePhrase: text(item?.guidePhrase),
        expected,
        produced,
        expectedRationale: text(item?.expected?.rationale),
        producedRationale: text(row?.guidePhraseApplicabilityRationale),
      });
    }
  });
  return { ...summarizeConfusion(counts), disagreements };
}

// Safety significance is only meaningful where the deviation is genuinely
// applicable. Scoring it on rows the engineer marked non-applicable would
// double-count an applicability error as a classification error too.
export function scoreSafetySignificance(items = [], matchedRows = []) {
  const counts = emptyConfusion();
  const disagreements = [];
  items.forEach((item, index) => {
    if (normalizeExpectedDecision(item?.expected?.applicable) !== YES) return;
    const row = matchedRows[index];
    if (!row || normalizeProducedApplicability(row) !== YES) return;
    const expected = normalizeExpectedDecision(item?.expected?.safetySignificant);
    const produced = normalizeProducedSafetySignificance(row);
    recordConfusion(counts, expected, produced);
    if (expected !== null && produced !== null && expected !== produced) {
      disagreements.push({
        itemId: text(item?.id),
        guidePhrase: text(item?.guidePhrase),
        expected,
        produced,
        hazard: hazardText(row),
        producedRationale: text(row?.proposedSafetyAssessmentRationale || row?.safetySignificanceRationale),
      });
    }
  });
  return { ...summarizeConfusion(counts), disagreements };
}

export function scoreCanonicalization(fixture = {}, items = [], matchedRows = []) {
  const expectedHazards = Array.isArray(fixture.canonicalHazards) ? fixture.canonicalHazards : [];
  const producedHazardIds = new Set();
  const producedHazardStatements = new Set();
  let mappingCorrect = 0;
  let mappingIncorrect = 0;
  let mappingMissing = 0;
  const disagreements = [];

  items.forEach((item, index) => {
    const row = matchedRows[index];
    if (!row || normalizeProducedApplicability(row) !== YES) return;
    const producedId = text(row.canonicalHazardId);
    if (producedId) producedHazardIds.add(normalized(producedId));
    const statement = hazardText(row);
    if (statement) producedHazardStatements.add(normalized(statement));

    const expectedId = text(item?.expected?.canonicalHazardId);
    if (!expectedId) return;
    if (!producedId) {
      mappingMissing += 1;
      return;
    }
    if (normalized(producedId) === normalized(expectedId)) {
      mappingCorrect += 1;
      return;
    }
    mappingIncorrect += 1;
    disagreements.push({
      itemId: text(item?.id),
      expectedHazardId: expectedId,
      producedHazardId: producedId,
      hazard: statement,
    });
  });

  const labelled = mappingCorrect + mappingIncorrect + mappingMissing;
  return {
    expectedHazardCount: expectedHazards.length,
    producedHazardIdCount: producedHazardIds.size,
    producedHazardStatementCount: producedHazardStatements.size,
    // > 1 means the run produced more distinct hazard statements than the
    // approved model needs — the "hundreds of row-level findings" problem.
    convergenceRatio: ratio(producedHazardStatements.size, expectedHazards.length),
    mappingCorrect,
    mappingIncorrect,
    mappingMissing,
    mappingAccuracy: ratio(mappingCorrect, labelled),
    disagreements,
  };
}

export function scoreArchitecturalConsistency(items = [], matchedRows = []) {
  const violations = [];
  let checked = 0;
  items.forEach((item, index) => {
    const forbidden = Array.isArray(item?.expected?.forbiddenRequirementClaims)
      ? item.expected.forbiddenRequirementClaims
      : [];
    if (!forbidden.length) return;
    const row = matchedRows[index];
    if (!row || normalizeProducedApplicability(row) !== YES) return;
    checked += 1;
    findForbiddenClaims(row, forbidden).forEach((claim) => {
      violations.push({
        itemId: text(item?.id),
        claim,
        requirement: requirementText(row),
        contextAssumptions: text(item?.contextAssumptions),
      });
    });
  });
  return {
    checked,
    violationCount: violations.length,
    violationRate: ratio(violations.length, checked),
    violations,
  };
}

export function scoreHazardEvalRun({ fixture = {}, rows = [] } = {}) {
  const items = Array.isArray(fixture.items) ? fixture.items : [];
  const matchedRows = matchRowsToItems(items, Array.isArray(rows) ? rows : []);
  const missingRows = matchedRows.filter((row) => !row).length;

  return {
    fixtureId: text(fixture.fixtureId),
    domain: text(fixture.domain),
    itemCount: items.length,
    missingRows,
    applicability: scoreApplicability(items, matchedRows),
    safetySignificance: scoreSafetySignificance(items, matchedRows),
    canonicalization: scoreCanonicalization(fixture, items, matchedRows),
    architecturalConsistency: scoreArchitecturalConsistency(items, matchedRows),
  };
}

function sumConfusion(reports, key) {
  const counts = emptyConfusion();
  reports.forEach((report) => {
    const entry = report[key] || {};
    counts.truePositive += entry.truePositive || 0;
    counts.falsePositive += entry.falsePositive || 0;
    counts.trueNegative += entry.trueNegative || 0;
    counts.falseNegative += entry.falseNegative || 0;
    counts.undecided += entry.undecided || 0;
    counts.unlabeled += entry.unlabeled || 0;
  });
  return summarizeConfusion(counts);
}

export function aggregateHazardEvalReports(reports = []) {
  const list = Array.isArray(reports) ? reports : [];
  const canonicalization = list.reduce((totals, report) => {
    const entry = report.canonicalization || {};
    return {
      expectedHazardCount: totals.expectedHazardCount + (entry.expectedHazardCount || 0),
      producedHazardStatementCount: totals.producedHazardStatementCount + (entry.producedHazardStatementCount || 0),
      mappingCorrect: totals.mappingCorrect + (entry.mappingCorrect || 0),
      mappingIncorrect: totals.mappingIncorrect + (entry.mappingIncorrect || 0),
      mappingMissing: totals.mappingMissing + (entry.mappingMissing || 0),
    };
  }, {
    expectedHazardCount: 0,
    producedHazardStatementCount: 0,
    mappingCorrect: 0,
    mappingIncorrect: 0,
    mappingMissing: 0,
  });
  const architectural = list.reduce((totals, report) => {
    const entry = report.architecturalConsistency || {};
    return {
      checked: totals.checked + (entry.checked || 0),
      violationCount: totals.violationCount + (entry.violationCount || 0),
    };
  }, { checked: 0, violationCount: 0 });

  return {
    fixtureCount: list.length,
    itemCount: list.reduce((total, report) => total + (report.itemCount || 0), 0),
    missingRows: list.reduce((total, report) => total + (report.missingRows || 0), 0),
    applicability: sumConfusion(list, "applicability"),
    safetySignificance: sumConfusion(list, "safetySignificance"),
    canonicalization: {
      ...canonicalization,
      convergenceRatio: ratio(canonicalization.producedHazardStatementCount, canonicalization.expectedHazardCount),
      mappingAccuracy: ratio(
        canonicalization.mappingCorrect,
        canonicalization.mappingCorrect + canonicalization.mappingIncorrect + canonicalization.mappingMissing,
      ),
    },
    architecturalConsistency: {
      ...architectural,
      violationRate: ratio(architectural.violationCount, architectural.checked),
    },
  };
}
