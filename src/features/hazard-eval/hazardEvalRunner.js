// Drives a labeled fixture through the real hazard-analysis pipeline and scores
// the result. The pipeline is injected so a caller can supply a replay-backed
// build (see hazardEvalCassette.js) instead of one that spends tokens.

import {
  HAZARD_ANALYSIS_STAGE_KEYS,
  SAFETY_SIGNIFICANCE_FIELDS,
  generateStandardCodeHazardAnalysisSheets,
  getStandardConfig,
} from "../../components/aiAnalysisCodeHazardStandard";
import { aggregateHazardEvalReports, scoreHazardEvalRun } from "./hazardEvalScoring";

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Mirrors the column lookups in flattenDecomposition. Order is not significant
// to that function — it resolves columns by header name — but keeping the
// canonical order makes a recorded prompt readable.
export const FIXTURE_DECOMPOSITION_HEADERS = [
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
  "Guide Phrase Applicable",
  "Guide Phrase Applicability Rationale",
  // A traceability column. Carrying it lets the pipeline allocate requirements
  // to a named subsystem instead of inventing a generic owner.
  "Subsystem",
];

// flattenDecomposition assigns item ids positionally as FD-{index+1} and ignores
// any id column. A fixture whose ids do not follow that order would be scored
// against the wrong rows, so this fails loudly rather than mis-attributing.
export function assertFixtureItemIds(fixture = {}) {
  const items = Array.isArray(fixture.items) ? fixture.items : [];
  const mismatched = items
    .map((item, index) => ({ actual: text(item?.id), expected: `FD-${index + 1}` }))
    .filter((entry) => entry.actual !== entry.expected);
  if (mismatched.length) {
    const detail = mismatched.map(({ actual, expected }) => `${actual || "(blank)"} should be ${expected}`).join("; ");
    throw new Error(
      `Fixture "${text(fixture.fixtureId)}" has item ids that do not match the positional ids the pipeline assigns: ${detail}.`,
    );
  }
  return true;
}

export function buildFixtureSheets(fixture = {}) {
  assertFixtureItemIds(fixture);
  const items = Array.isArray(fixture.items) ? fixture.items : [];
  return {
    "Functional Decomposition": [
      [...FIXTURE_DECOMPOSITION_HEADERS],
      ...items.map((item) => [
        text(item.from),
        text(item.fromDetails),
        text(item.controlAction),
        text(item.controlActionDetails),
        text(item.to),
        text(item.toDetails),
        text(item.operationalContextId),
        text(item.operationalScenario),
        text(item.operationalMode),
        text(item.operatingConditions),
        text(item.contextAssumptions),
        text(item.guidePhrase),
        // Left blank on purpose: the pipeline must decide applicability itself.
        // Seeding it here would score the fixture against its own answer.
        "",
        "",
        text(item.subsystem),
      ]),
    ],
  };
}

export function sheetToRows(sheet = [], config = {}) {
  if (!Array.isArray(sheet) || sheet.length < 2) return [];
  const headers = (sheet[0] || []).map(text);
  const labelToField = new Map([
    ...(config.fields || []),
    ...SAFETY_SIGNIFICANCE_FIELDS,
  ].map(([fieldName, label]) => [label, fieldName]));
  const idLabel = `${config.sheetName} ID`;

  return sheet.slice(1).map((cells) => {
    const row = {};
    headers.forEach((header, column) => {
      const value = text(cells?.[column]);
      if (header === idLabel) {
        row.id = value;
        return;
      }
      const fieldName = labelToField.get(header);
      if (fieldName) row[fieldName] = value;
      // Traceability columns carry no scored field and are left out.
    });
    return row;
  });
}

// Metrics a stage is expected to move. Tracked stage by stage so a pass that
// costs a model call but changes nothing — or makes things worse — is visible
// rather than hidden inside an end-of-pipeline number.
const TRACKED_METRICS = [
  ["applicabilityFalsePositives", (report) => report.applicability?.falsePositive ?? 0],
  ["applicabilityUndecided", (report) => report.applicability?.undecided ?? 0],
  ["applicabilityCorrect", (report) => (report.applicability?.truePositive ?? 0) + (report.applicability?.trueNegative ?? 0)],
  ["safetyOverClassifications", (report) => report.safetySignificance?.falsePositive ?? 0],
  ["distinctHazardStatements", (report) => report.canonicalization?.producedHazardStatementCount ?? 0],
  ["architecturalViolations", (report) => report.architecturalConsistency?.violationCount ?? 0],
];

function metricsFor(report) {
  return Object.fromEntries(TRACKED_METRICS.map(([name, read]) => [name, read(report)]));
}

export function buildStageDeltas(stageReports = []) {
  return stageReports.map((entry, index) => {
    const previous = index > 0 ? stageReports[index - 1].metrics : null;
    const deltas = previous
      ? Object.fromEntries(TRACKED_METRICS.map(([name]) => [name, entry.metrics[name] - previous[name]]))
      : null;
    return {
      stage: entry.stage,
      metrics: entry.metrics,
      deltas,
      // A stage that made no measured difference still cost a model call.
      changedNothing: Boolean(deltas) && Object.values(deltas).every((value) => value === 0),
    };
  });
}

/**
 * Runs one fixture and returns its score report.
 *
 * `generate` defaults to the production pipeline. Tests and offline runs pass a
 * build wired to a cassette transport so no live call is made.
 *
 * The returned `stages` array scores the rows after every pipeline stage, so a
 * regression can be attributed to the stage that introduced it.
 */
export async function runHazardEvalFixture({
  fixture,
  method = "STPA",
  generate = generateStandardCodeHazardAnalysisSheets,
  onProgress = () => {},
  signal = null,
  provider = "anthropic",
} = {}) {
  if (!fixture) throw new Error("runHazardEvalFixture needs a fixture.");
  const config = getStandardConfig(method);
  const sheets = buildFixtureSheets(fixture);
  const stageReports = [];

  const resultSheets = await generate({
    sheets,
    // The pipeline persists through setFolders; the eval keeps everything in
    // memory and reads the returned sheets instead.
    setFolders: () => {},
    currentFolder: `hazard-eval/${text(fixture.fixtureId)}`,
    method,
    operationalContext: text(fixture.operationalContext),
    organizationContext: text(fixture.organizationContext),
    onProgress,
    onStageComplete: ({ stage, rows: stageRows }) => {
      const report = scoreHazardEvalRun({ fixture, rows: stageRows });
      stageReports.push({ stage, metrics: metricsFor(report), report });
    },
    signal,
    provider,
  });

  const rows = sheetToRows(resultSheets?.[config.sheetName] || [], config);
  return {
    ...scoreHazardEvalRun({ fixture, rows }),
    method,
    labelStatus: text(fixture.labelStatus) || "proposed",
    rows,
    stages: buildStageDeltas(stageReports),
  };
}

export async function runHazardEvalSuite({ fixtures = [], ...options } = {}) {
  const reports = [];
  for (const fixture of fixtures) {
    // Sequential on purpose: the pipeline already runs its own bounded
    // concurrency internally, and a shared cassette is not safe to write from
    // parallel runs.
    reports.push(await runHazardEvalFixture({ fixture, ...options }));
  }
  const proposedCount = reports.filter((report) => report.labelStatus !== "approved").length;
  return {
    reports,
    totals: aggregateHazardEvalReports(reports),
    // Surfaced so a caller never reports an unapproved score as a quality result.
    proposedFixtureCount: proposedCount,
    approved: proposedCount === 0,
  };
}

function percent(value) {
  return value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function number(value, digits = 2) {
  return value === null || value === undefined ? "n/a" : value.toFixed(digits);
}

export function formatHazardEvalSummary(suite = {}) {
  const { totals = {}, reports = [], approved } = suite;
  const applicability = totals.applicability || {};
  const significance = totals.safetySignificance || {};
  const canonicalization = totals.canonicalization || {};
  const architectural = totals.architecturalConsistency || {};

  const lines = [
    `Fixtures: ${totals.fixtureCount || 0}   Items: ${totals.itemCount || 0}   Missing rows: ${totals.missingRows || 0}`,
    "",
    "Applicability",
    `  over-application rate  ${percent(applicability.falsePositiveRate)}  (${applicability.falsePositive || 0} of ${(applicability.falsePositive || 0) + (applicability.trueNegative || 0)} engineer-rejected deviations claimed)`,
    `  recall                 ${percent(applicability.recall)}`,
    `  accuracy               ${percent(applicability.accuracy)}   undecided: ${applicability.undecided || 0}`,
    "",
    "Safety significance",
    `  over-classification    ${percent(significance.falsePositiveRate)}  (${significance.falsePositive || 0} mission-only effects marked Safety)`,
    `  recall                 ${percent(significance.recall)}`,
    "",
    "Canonicalization",
    `  convergence ratio      ${number(canonicalization.convergenceRatio)}  (${canonicalization.producedHazardStatementCount || 0} statements / ${canonicalization.expectedHazardCount || 0} canonical hazards)`,
    `  mapping accuracy       ${percent(canonicalization.mappingAccuracy)}`,
    "",
    "Architectural consistency",
    `  violation rate         ${percent(architectural.violationRate)}  (${architectural.violationCount || 0} of ${architectural.checked || 0} checked)`,
  ];

  if (!approved) {
    lines.unshift(
      `WARNING: ${suite.proposedFixtureCount} fixture(s) carry proposed labels. These numbers exercise the harness and are not evidence of quality.`,
      "",
    );
  }
  lines.push("", "Per fixture:");
  reports.forEach((report) => {
    lines.push(
      `  ${report.fixtureId} (${report.labelStatus})  `
      + `over-application ${percent(report.applicability?.falsePositiveRate)}  `
      + `over-classification ${percent(report.safetySignificance?.falsePositiveRate)}  `
      + `convergence ${number(report.canonicalization?.convergenceRatio)}`,
    );
    (report.stages || []).forEach(({ stage, metrics, deltas, changedNothing }) => {
      const movement = deltas
        ? Object.entries(deltas)
          .filter(([, value]) => value !== 0)
          .map(([name, value]) => `${name} ${value > 0 ? "+" : ""}${value}`)
          .join(", ")
        : "baseline";
      lines.push(
        `    ${stage.padEnd(22)} `
        + `FP ${metrics.applicabilityFalsePositives}  `
        + `undecided ${metrics.applicabilityUndecided}  `
        + `${changedNothing ? "no measured change" : movement || "baseline"}`,
      );
    });
  });
  return lines.join("\n");
}
