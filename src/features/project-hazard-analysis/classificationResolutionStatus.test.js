import {
  CLASSIFICATION_RESOLUTION_STATUS,
  CLASSIFICATION_RESOLUTION_STATUS_HEADER,
  deriveClassificationResolutionStatus,
  ensureClassificationResolutionStatus,
  normalizeHazardAnalysisResolutionStatus,
} from "./classificationResolutionStatus";

const headers = [
  "Raw Analysis Row ID",
  "Function (From)",
  "Control Action",
  "Function (To)",
  "Guide Phrase",
  "Guide Phrase Applicable",
  "Safety Classification",
  "Safety Classification Rule",
  "Causal Path Type",
  "Causal Effect",
  "Resulting System State",
  "Intermediate Safety Function",
  "Intermediate Safety Effect",
  "Protection Assessment",
  "Protection Status",
  "Physical-Harm Chain Termination",
  "Classification Evidence",
  "Safety Significance Rationale",
  "Proposed Safety Assessment Rationale",
  "Proposed Safety Assessment",
  "Safety Significant",
  "Hazard",
  "Loss",
];

function row(overrides = {}) {
  const fields = {
    "Raw Analysis Row ID": "RAW-1",
    "Function (From)": "Monitor task completion",
    "Control Action": "Task completion report",
    "Function (To)": "Record mission status",
    "Guide Phrase": "Provided too late",
    "Guide Phrase Applicable": "Yes",
    "Safety Classification": "Mission/Reliability",
    "Safety Classification Rule": "M1",
    "Causal Path Type": "None",
    "Causal Effect": "The mission status record is delayed.",
    "Resulting System State": "The dashboard displays stale completion status.",
    "Intermediate Safety Function": "",
    "Intermediate Safety Effect": "",
    "Protection Assessment": "The reporting path has no control authority.",
    "Protection Status": "Absent",
    "Physical-Harm Chain Termination": "The effect terminates in the reporting dashboard, which cannot command motion.",
    "Classification Evidence": "The receiver is a reporting-only function.",
    "Safety Significance Rationale": "The effect is limited to mission reporting.",
    "Proposed Safety Assessment Rationale": "The effect is limited to mission reporting.",
    "Proposed Safety Assessment": "Mission/Reliability",
    "Safety Significant": "No",
    Hazard: "Mission completion status is unavailable.",
    Loss: "Delayed mission reporting.",
    ...overrides,
  };
  return headers.map((header) => fields[header] || "");
}

describe("classification resolution status", () => {
  test("marks a structurally coherent generated decision as policy validated", () => {
    expect(deriveClassificationResolutionStatus(headers, row())).toBe(
      CLASSIFICATION_RESOLUTION_STATUS.POLICY_VALIDATED,
    );
  });

  test("separates a human disposition with an unresolved evidence gap", () => {
    const reviewed = row({
      "Safety Classification": "Safety — Related",
      "Safety Classification Rule": "R1",
      "Causal Path Type": "Contributory",
      "Intermediate Safety Function": "Not applicable",
      "Intermediate Safety Effect": "Not applicable",
      "Physical-Harm Chain Termination": "",
      "Safety Significant": "Yes",
      "Proposed Safety Assessment": "Safety",
      "Hazard": "The robot may collide with a person.",
      "Loss": "A person may be injured.",
      "Classification Evidence": "Human reviewer disposition: Yes.",
      "Safety Significance Rationale": "Human-directed Vibe Review decision: the reviewer marked this row Yes.",
    });
    expect(deriveClassificationResolutionStatus(headers, reviewed)).toBe(
      CLASSIFICATION_RESOLUTION_STATUS.HUMAN_EVIDENCE_GAP,
    );
  });

  test("retains Needs Review as an unresolved status", () => {
    const unresolved = row({
      "Safety Classification": "Needs Review",
      "Safety Classification Rule": "U4",
      "Safety Significant": "Needs Review",
    });
    expect(deriveClassificationResolutionStatus(headers, unresolved)).toBe(
      CLASSIFICATION_RESOLUTION_STATUS.NEEDS_REVIEW,
    );
  });

  test("labels legacy partial schemas as not evaluated instead of inventing a review decision", () => {
    const legacyHeaders = ["Safety Significant", "Safety Significance Rationale"];
    expect(deriveClassificationResolutionStatus(legacyHeaders, ["Yes", "Legacy safety rationale."]))
      .toBe(CLASSIFICATION_RESOLUTION_STATUS.NOT_EVALUATED);
  });

  test("adds and deterministically refreshes the exported status column", () => {
    const first = ensureClassificationResolutionStatus([headers, row()]);
    expect(first[0].at(-1)).toBe(CLASSIFICATION_RESOLUTION_STATUS_HEADER);
    expect(first[1].at(-1)).toBe(CLASSIFICATION_RESOLUTION_STATUS.POLICY_VALIDATED);

    const staleHeaders = [...headers, CLASSIFICATION_RESOLUTION_STATUS_HEADER];
    const refreshed = ensureClassificationResolutionStatus([staleHeaders, [...row(), "Stale value"]]);
    expect(refreshed[0].filter((header) => header === CLASSIFICATION_RESOLUTION_STATUS_HEADER)).toHaveLength(1);
    expect(refreshed[1].at(-1)).toBe(CLASSIFICATION_RESOLUTION_STATUS.POLICY_VALIDATED);
  });

  test("normalizes only the Summary sheet on an analysis result", () => {
    const normalized = normalizeHazardAnalysisResolutionStatus({
      Summary: [headers, row()],
      Metadata: [["Name"], ["Example"]],
    });
    expect(normalized.Summary[0]).toContain(CLASSIFICATION_RESOLUTION_STATUS_HEADER);
    expect(normalized.Metadata).toEqual([["Name"], ["Example"]]);
  });
});
