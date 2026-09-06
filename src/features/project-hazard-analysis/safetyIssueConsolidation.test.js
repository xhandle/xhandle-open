import {
  assessLLMConsolidationCoverage,
  buildDeterministicConsolidatedSafetyIssues,
  buildSafetyIssueSourceFamilies,
  enforceSafetyIssueFamilyConsolidation,
} from "./safetyIssueConsolidation";

function row(sourceIndex, contextId, hazard) {
  return {
    sourceIndex,
    cells: {
      "Function (From)": "Trajectory Planner",
      "Control Action": "Requested Trajectory",
      "Function (To)": "Motion Controller",
      "Subsystem Allocation": "Planning",
      "Guide Phrase": "The control action is provided too late",
      "Operational Context ID": contextId,
      "Operational Scenario": contextId === "urban" ? "Urban intersection" : "Highway merge",
      "Operational Mode": "Autonomous",
      Hazard: hazard,
    },
  };
}

describe("safety issue consolidation", () => {
  const safetyRows = [
    row(1, "urban", "Late trajectory causes a pedestrian conflict"),
    row(2, "highway", "Late trajectory causes a merge conflict"),
  ];

  it("groups context variants of the same functional hazard family", () => {
    expect(buildSafetyIssueSourceFamilies(safetyRows)).toHaveLength(1);
    expect(buildDeterministicConsolidatedSafetyIssues(safetyRows)[0].sourceIndexes).toEqual([1, 2]);
  });

  it("merges an LLM response that incorrectly returns one issue per context row", () => {
    const result = enforceSafetyIssueFamilyConsolidation([
      { title: "Urban issue", description: "Urban", likelihood: 3, severity: 4, sourceIndexes: [1] },
      { title: "Highway issue", description: "Highway", likelihood: 2, severity: 5, sourceIndexes: [2] },
    ], safetyRows);

    expect(result).toHaveLength(1);
    expect(result[0].sourceIndexes).toEqual([1, 2]);
    expect(result[0].likelihood * result[0].severity).toBe(12);
  });

  it("keeps unrelated functional hazard families separate", () => {
    const unrelated = {
      sourceIndex: 3,
      cells: {
        ...safetyRows[0].cells,
        "Function (From)": "Object Tracker",
        "Control Action": "Tracked Objects",
        "Function (To)": "Prediction",
      },
    };
    expect(buildSafetyIssueSourceFamilies([...safetyRows, unrelated])).toHaveLength(2);
  });

  it("collapses eight operational contexts even when the LLM emits eight issues", () => {
    const contextRows = Array.from({ length: 8 }, (_, index) => row(
      index + 1,
      `context-${index + 1}`,
      `Context-specific hazardous outcome ${index + 1}`
    ));
    const onePerRow = contextRows.map((item) => ({
      title: `Issue ${item.sourceIndex}`,
      description: `Context ${item.sourceIndex}`,
      likelihood: 3,
      severity: 3,
      sourceIndexes: [item.sourceIndex],
    }));

    const result = enforceSafetyIssueFamilyConsolidation(onePerRow, contextRows);
    expect(result).toHaveLength(1);
    expect(result[0].sourceIndexes).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("consolidates guide-phrase permutations of the same functional interface", () => {
    const omission = row(1, "urban", "Trajectory is not provided when required");
    omission.cells["Guide Phrase"] = "Not providing the control action causes a hazard";
    const late = row(2, "urban", "Trajectory is provided too late");
    late.cells["Guide Phrase"] = "The control action is provided too late";

    const result = enforceSafetyIssueFamilyConsolidation([
      { title: "Omitted trajectory", sourceIndexes: [1] },
      { title: "Late trajectory", sourceIndexes: [2] },
    ], [omission, late]);

    expect(result).toHaveLength(1);
    expect(result[0].sourceIndexes).toEqual([1, 2]);
  });

  it("keeps distinct functional interfaces as separate engineering concerns", () => {
    const trajectory = row(1, "urban", "Unsafe requested trajectory");
    const braking = row(2, "urban", "Unsafe braking request");
    braking.cells["Control Action"] = "Braking Request";
    braking.cells["Function (To)"] = "Brake Controller";

    expect(buildSafetyIssueSourceFamilies([trajectory, braking])).toHaveLength(2);
  });

  it("preserves the LLM's semantic grouping without deterministically merging issues", () => {
    const assessment = assessLLMConsolidationCoverage([
      { title: "Timing assurance", sourceIndexes: [1] },
      { title: "Independent release gating", sourceIndexes: [2] },
    ], safetyRows);

    expect(assessment.coverageComplete).toBe(true);
    expect(assessment.issues).toHaveLength(2);
  });

  it("reports source rows omitted by the LLM so they can be retried", () => {
    const assessment = assessLLMConsolidationCoverage([
      { title: "Partial result", sourceIndexes: [1] },
    ], safetyRows);

    expect(assessment.coverageComplete).toBe(false);
    expect(assessment.missingSourceIndexes).toEqual([2]);
  });
});
