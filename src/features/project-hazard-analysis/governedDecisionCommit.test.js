import {
  GOVERNED_DECISION_FIELD,
  findRowIndexById,
  governedDecisionField,
  rowChanged,
  verifyGovernedDecision,
} from "./governedDecisionCommit";

const headers = [
  "Raw Analysis Row ID", "Guide Phrase Applicable", "Safety Significant", "Safety Classification",
];
const row = (overrides = {}) => headers.map((header) => ({
  "Raw Analysis Row ID": "RAW-1",
  "Guide Phrase Applicable": "Yes",
  "Safety Significant": "Yes",
  "Safety Classification": "Safety — Direct",
  ...overrides,
}[header]));

describe("governed decision field mapping", () => {
  it("maps each review target to the field it adjudicates", () => {
    expect(governedDecisionField("guidePhraseApplicable")).toBe("Guide Phrase Applicable");
    expect(governedDecisionField("safetySignificant")).toBe("Safety Significant");
    expect(governedDecisionField("safetyClassification")).toBe("Safety Classification");
    expect(governedDecisionField("classificationResolution")).toBe("Safety Classification");
  });

  it("falls back to safety significance for an unknown target", () => {
    expect(governedDecisionField("")).toBe(GOVERNED_DECISION_FIELD.safetySignificant);
    expect(governedDecisionField("somethingElse")).toBe(GOVERNED_DECISION_FIELD.safetySignificant);
  });
});

describe("verifyGovernedDecision", () => {
  it("passes when the adjudicated value is present in the committed row", () => {
    expect(verifyGovernedDecision({
      reviewTarget: "safetySignificant",
      update: { "Safety Significant": "No" },
      headers,
      committedRow: row({ "Safety Significant": "No" }),
    })).toMatchObject({ ok: true, field: "Safety Significant" });
  });

  it("fails when the write was silently dropped", () => {
    const result = verifyGovernedDecision({
      reviewTarget: "safetySignificant",
      update: { "Safety Significant": "No" },
      headers,
      committedRow: row({ "Safety Significant": "Yes" }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('should be "No"');
    expect(result.error).toContain('holds "Yes"');
    expect(result.error).toContain("No change was saved.");
  });

  it("fails when the committed row lost the value entirely", () => {
    const result = verifyGovernedDecision({
      reviewTarget: "safetyClassification",
      update: { "Safety Classification": "Not Applicable" },
      headers,
      committedRow: row({ "Safety Classification": "" }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("(empty)");
  });

  it("fails when the summary has no column for the governed field", () => {
    const result = verifyGovernedDecision({
      reviewTarget: "guidePhraseApplicable",
      update: { "Guide Phrase Applicable": "No" },
      headers: ["Raw Analysis Row ID", "Safety Significant"],
      committedRow: ["RAW-1", "Yes"],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no Guide Phrase Applicable column");
  });

  it("skips verification when the update adjudicated nothing", () => {
    expect(verifyGovernedDecision({
      reviewTarget: "safetySignificant",
      update: {},
      headers,
      committedRow: row(),
    })).toMatchObject({ ok: true, skipped: true });
  });

  it("ignores case and surrounding whitespace", () => {
    expect(verifyGovernedDecision({
      reviewTarget: "safetySignificant",
      update: { "Safety Significant": " no " },
      headers,
      committedRow: row({ "Safety Significant": "No" }),
    }).ok).toBe(true);
  });

  it("verifies classificationResolution against Safety Classification", () => {
    expect(verifyGovernedDecision({
      reviewTarget: "classificationResolution",
      update: { "Safety Classification": "Mission/Reliability" },
      headers,
      committedRow: row({ "Safety Classification": "Mission/Reliability" }),
    }).ok).toBe(true);
  });
});

describe("rowChanged", () => {
  it("detects a real change", () => {
    expect(rowChanged(row(), row({ "Safety Significant": "No" }))).toBe(true);
  });

  it("treats a re-affirmation of the same values as unchanged", () => {
    expect(rowChanged(row(), row())).toBe(false);
  });

  it("ignores insignificant whitespace differences", () => {
    expect(rowChanged(row(), row({ "Safety Significant": " Yes " }))).toBe(false);
  });

  it("treats a differing column count as changed", () => {
    expect(rowChanged(row(), [...row(), "Policy Validated"])).toBe(true);
  });
});

describe("findRowIndexById", () => {
  const summary = [headers, row({ "Raw Analysis Row ID": "RAW-1" }), row({ "Raw Analysis Row ID": "RAW-2" })];

  it("finds a row by its stable id", () => {
    expect(findRowIndexById(summary, "RAW-2")).toBe(2);
  });

  it("returns -1 for an unknown id", () => {
    expect(findRowIndexById(summary, "RAW-9")).toBe(-1);
  });

  it("returns -1 when the summary has no id column", () => {
    expect(findRowIndexById([["Safety Significant"], ["Yes"]], "RAW-1")).toBe(-1);
  });

  it("indexes against the supplied headers, not a remembered position", () => {
    // Normalization can drop or append columns; the id column moves with them.
    const reordered = [
      ["Safety Classification", "Raw Analysis Row ID"],
      ["Safety — Direct", "RAW-1"],
      ["Not Applicable", "RAW-2"],
    ];
    expect(findRowIndexById(reordered, "RAW-2")).toBe(2);
  });
});
