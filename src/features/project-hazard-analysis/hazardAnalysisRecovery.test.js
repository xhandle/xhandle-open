import {
  buildHazardAnalysisRecovery,
  getProjectHazardSummaryReviewItems,
} from "./hazardAnalysisRecovery";

function reviewItem({ projectId, runId, rowIndex, updatedAt }) {
  return {
    projectId,
    sourceFeature: "AI Hazard Analysis",
    sourceMethod: "STPA-Textbook",
    sourceRunId: runId,
    artifactType: "hazard_summary_table",
    artifactId: `hazard-summary:${projectId}:row:${rowIndex}`,
    updatedAt,
    currentContent: {
      rowIndex,
      columns: ["Hazard", "Safety Constraint"],
      row: [`Hazard ${rowIndex}`, `Constraint ${rowIndex}`],
    },
  };
}

describe("hazard analysis recovery", () => {
  it("only returns review evidence for the active project", () => {
    const legacyItem = reviewItem({ projectId: "secondary-braking", runId: "run-1", rowIndex: 0, updatedAt: "2026-09-04T10:00:00Z" });
    delete legacyItem.projectId;
    const items = [
      legacyItem,
      reviewItem({ projectId: "other-project", runId: "run-2", rowIndex: 0, updatedAt: "2026-09-04T11:00:00Z" }),
    ];

    expect(getProjectHazardSummaryReviewItems(items, "secondary-braking")).toHaveLength(1);
  });

  it("rebuilds the latest completed run in row order", () => {
    const items = [
      reviewItem({ projectId: "secondary-braking", runId: "old-run", rowIndex: 0, updatedAt: "2026-09-04T09:00:00Z" }),
      reviewItem({ projectId: "secondary-braking", runId: "new-run", rowIndex: 1, updatedAt: "2026-09-04T11:00:00Z" }),
      reviewItem({ projectId: "secondary-braking", runId: "new-run", rowIndex: 0, updatedAt: "2026-09-04T10:00:00Z" }),
    ];

    const recovered = buildHazardAnalysisRecovery(items);
    expect(recovered.sourceRunId).toBe("new-run");
    expect(recovered.analysisResult.Summary).toEqual([
      ["Hazard", "Safety Constraint"],
      ["Hazard 0", "Constraint 0"],
      ["Hazard 1", "Constraint 1"],
    ]);
  });
});
