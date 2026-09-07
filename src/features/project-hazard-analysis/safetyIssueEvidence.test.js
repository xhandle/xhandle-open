import {
  buildSafetyIssueConsolidationPayload,
  compactSafetyIssueEvidenceRow,
  extractSafetyIssueEvidenceRows,
  isSafetyIssueEvidenceRow,
  resolveRiskSourceIndexes,
} from "./safetyIssueEvidence";

const headers = [
  "Raw Analysis Row ID",
  "Function (From)",
  "Control Action",
  "Function (To)",
  "Guide Phrase Applicable",
  "Proposed Safety Assessment",
  "Hazard",
  "Operational Scenario",
  "Operational Mode",
  "Verbose Audit Notes",
];

test("uses the revised safety assessment schema and excludes non-applicable rows", () => {
  expect(isSafetyIssueEvidenceRow(["R-1", "A", "CA", "B", "Yes", "Safety"], headers)).toBe(true);
  expect(isSafetyIssueEvidenceRow(["R-2", "A", "CA", "B", "No", "Safety"], headers)).toBe(false);
  expect(isSafetyIssueEvidenceRow(["R-3", "A", "CA", "B", "Yes", "Mission/Reliability"], headers)).toBe(false);
});

test("extracts eligible rows while retaining stable raw row identity", () => {
  const rows = extractSafetyIssueEvidenceRows([
    headers,
    ["R-1", "A", "CA", "B", "Yes", "Safety", "Unsafe state", "Normal", "Auto", "large audit"],
    ["R-2", "A", "CA", "B", "No", "Safety", "Ignored", "Normal", "Auto", "large audit"],
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ sourceIndex: 1, sourceRowId: "R-1" });
});

test("compacts expanded hazard rows to the risk-relevant contract", () => {
  const [row] = extractSafetyIssueEvidenceRows([
    headers,
    ["R-1", "A", "CA", "B", "Yes", "Safety", "Unsafe state", "Normal", "Auto", "large audit"],
  ]);
  expect(compactSafetyIssueEvidenceRow(row).cells).toEqual(expect.objectContaining({
    "Raw Analysis Row ID": "R-1",
    Hazard: "Unsafe state",
    "Operational Scenario": "Normal",
  }));
  expect(compactSafetyIssueEvidenceRow(row).cells["Verbose Audit Notes"]).toBeUndefined();
});

test("groups context permutations for compact LLM consolidation without losing coverage", () => {
  const rows = extractSafetyIssueEvidenceRows([
    headers,
    ["R-1", "A", "CA", "B", "Yes", "Safety", "H1", "Normal", "Auto", "x"],
    ["R-2", "A", "CA", "B", "Yes", "Safety", "H2", "Degraded", "Fallback", "x"],
  ]);
  const payload = buildSafetyIssueConsolidationPayload(rows);
  expect(payload).toHaveLength(1);
  expect(payload[0].sourceIndexes).toEqual([1, 2]);
  expect(payload[0].rows).toHaveLength(2);
});

test("resolves source links by stable raw row id after worksheet reordering", () => {
  const availableRows = [
    { sourceIndex: 1, sourceRowId: "R-2", cells: {} },
    { sourceIndex: 2, sourceRowId: "R-1", cells: {} },
  ];
  expect(resolveRiskSourceIndexes({ sourceIndexes: [1], sourceRowIds: ["R-1"] }, availableRows)).toEqual([2]);
});
