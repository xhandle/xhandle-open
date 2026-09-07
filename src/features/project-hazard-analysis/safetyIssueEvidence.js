import { buildSafetyIssueSourceFamilies } from "./safetyIssueConsolidation";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const EVIDENCE_FIELDS = [
  ["Function (From)", [/^Function \(From\)$/i, /^From Function$/i, /^Controller$/i]],
  ["Control Action", [/^Control Action$/i, /^Action$/i]],
  ["Function (To)", [/^Function \(To\)$/i, /^To Function$/i, /^Controlled Process$/i]],
  ["Subsystem Allocation", [/^Subsystem Allocation$/i, /^Subsystem$/i]],
  ["Guide Phrase", [/^Guide Phrase$/i, /^Guide Word$/i, /^Guideword$/i]],
  ["Control Action Type", [/^Control Action Type$/i]],
  ["Raw Analysis Row ID", [/^Raw Analysis Row ID$/i, /^Analysis Row ID$/i]],
  ["Loss", [/^Loss(?:es)?$/i]],
  ["Hazard", [/^Hazards?$/i]],
  ["Canonical Loss ID", [/^Canonical Loss ID$/i]],
  ["Canonical Hazard ID", [/^Canonical Hazard ID$/i]],
  ["Unsafe Control Action", [/^Unsafe Control Actions?$/i, /^UCA$/i]],
  ["Causal Scenario", [/^Causal Scenario$/i]],
  ["Causal Factor", [/^Causal Factors?$/i]],
  ["Causal Factor Category", [/^Causal Factor Category$/i]],
  ["Mitigation Strategy", [/^Mitigation Strategy$/i, /^Mitigations?$/i]],
  ["Safety Constraint", [/^Safety Constraint$/i, /^Safety Requirements?\/?Constraints?$/i]],
  ["System Requirement", [/^System Requirement$/i]],
  ["Requirement Parameter Source", [/^Requirement Parameter Source$/i]],
  ["Proposed Safety Assessment", [/^Proposed Safety Assessment$/i, /^Safety Significant$/i]],
  ["Proposed Safety Assessment Rationale", [/^Proposed Safety Assessment Rationale$/i, /^Safety Significance Rationale$/i]],
  ["Operational Context ID", [/^Operational Context ID$/i, /^Context ID$/i]],
  ["Operational Scenario", [/^Operational Scenario$/i, /^Scenario$/i]],
  ["Operational Mode", [/^Operational Mode$/i, /^Mode$/i]],
  ["Operating Conditions", [/^Operating Conditions$/i, /^Conditions$/i]],
  ["Context Assumptions", [/^Context Assumptions$/i, /^Operational Assumptions$/i]],
];

function matchingCell(cells = {}, patterns = []) {
  for (const [label, value] of Object.entries(cells || {})) {
    if (patterns.some((pattern) => pattern.test(clean(label))) && clean(value)) return clean(value);
  }
  return "";
}

export function normalizeSafetyAssessment(value) {
  const assessment = clean(value).toLowerCase();
  if (/^(?:yes\b|safety\b|safety[-\s]?critical\b|safety\s*significant\b)/.test(assessment)) return "Safety";
  return "Mission/Reliability";
}

export function isSafetyIssueEvidenceRow(row = [], headers = []) {
  const cellValue = (patterns) => {
    const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(clean(header))));
    return index >= 0 ? clean(row?.[index]) : "";
  };
  const applicable = cellValue([/^Guide Phrase Applicable$/i]);
  if (/^(?:no\b|not applicable\b)/i.test(applicable)) return false;

  const proposed = cellValue([/^Proposed Safety Assessment$/i]);
  if (proposed) return normalizeSafetyAssessment(proposed) === "Safety";

  const significant = cellValue([/^Safety Significant$/i]);
  if (significant) return normalizeSafetyAssessment(significant) === "Safety";

  // Legacy/imported analyses did not always include a safety classifier. Keep
  // them available for review instead of silently emptying the risk tab.
  return true;
}

export function extractSafetyIssueEvidenceRows(summary = []) {
  if (!Array.isArray(summary?.[0])) return [];
  const headers = summary[0].map(clean);
  return summary.slice(1)
    .map((row, index) => ({ row, sourceIndex: index + 1 }))
    .filter(({ row }) => isSafetyIssueEvidenceRow(row, headers))
    .map(({ row, sourceIndex }) => {
      const cells = {};
      headers.forEach((header, column) => {
        const value = clean(row?.[column]);
        if (header && value) cells[header] = value;
      });
      return {
        sourceIndex,
        sourceRowId: matchingCell(cells, [/^Raw Analysis Row ID$/i, /^Analysis Row ID$/i]),
        cells,
      };
    });
}

export function compactSafetyIssueEvidenceRow(item = {}) {
  const cells = {};
  EVIDENCE_FIELDS.forEach(([canonicalLabel, patterns]) => {
    const value = matchingCell(item.cells, patterns);
    if (value) cells[canonicalLabel] = value;
  });
  return {
    sourceIndex: Number(item.sourceIndex),
    ...(clean(item.sourceRowId || cells["Raw Analysis Row ID"])
      ? { sourceRowId: clean(item.sourceRowId || cells["Raw Analysis Row ID"]) }
      : {}),
    cells,
  };
}

export function buildSafetyIssueConsolidationPayload(safetyRows = []) {
  return buildSafetyIssueSourceFamilies(safetyRows).map((family) => ({
    familyId: family.familyId,
    sourceIndexes: family.sourceIndexes,
    rows: family.rows.map(compactSafetyIssueEvidenceRow),
  }));
}

export function getEvidenceSourceRowId(item = {}) {
  return clean(item.sourceRowId || matchingCell(item.cells, [/^Raw Analysis Row ID$/i, /^Analysis Row ID$/i]));
}

export function resolveRiskSourceIndexes(risk = {}, availableRows = []) {
  const rows = Array.isArray(availableRows) ? availableRows : [];
  const sourceRowIds = new Set((Array.isArray(risk.sourceRowIds) ? risk.sourceRowIds : []).map(clean).filter(Boolean));
  if (sourceRowIds.size) {
    const resolved = rows
      .filter((row) => sourceRowIds.has(getEvidenceSourceRowId(row)))
      .map((row) => Number(row.sourceIndex))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (resolved.length) return Array.from(new Set(resolved)).sort((a, b) => a - b);
  }

  const available = new Set(rows.map((row) => Number(row.sourceIndex)).filter((value) => Number.isFinite(value) && value > 0));
  return Array.from(new Set([
    ...(Array.isArray(risk.sourceIndexes) ? risk.sourceIndexes : []),
    risk.sourceIndex,
  ].map(Number).filter((value) => Number.isFinite(value) && value > 0 && (!available.size || available.has(value)))))
    .sort((a, b) => a - b);
}
