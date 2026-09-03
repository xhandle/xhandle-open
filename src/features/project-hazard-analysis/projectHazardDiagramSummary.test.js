import {
  buildProjectHazardDiagramSummary,
  resolveProjectHazardArtifactNavigation,
} from "./projectHazardDiagramSummary";

describe("buildProjectHazardDiagramSummary", () => {
  const headers = ["Function (From)", "Control Action", "Function (To)", "Guide Phrase"];

  it("publishes a single generated guide-phrase row before any full analysis exists", () => {
    const generatedRow = ["Planner", "Issue trajectory", "Controller", "Provided too late"];
    const result = buildProjectHazardDiagramSummary(headers, [
      { originalIndex: 0, rowKey: "0:guide:0", generated: false, row: ["Planner", "", "Controller", "Not provided"] },
      { originalIndex: 4, rowKey: "0:guide:4", generated: true, row: generatedRow },
    ]);

    expect(result.summary).toEqual([headers, generatedRow]);
    expect(result.sourceIndexes).toEqual([4]);
  });

  it("keeps mixed full and incremental results ordered and removes duplicate identities", () => {
    const completedRow = ["Sensors", "Publish data", "Fusion", "Not provided"];
    const staleDraft = ["Planner", "Issue trajectory", "Controller", "Provided late"];
    const regeneratedDraft = ["Planner", "Issue trajectory", "Controller", "Provided too late"];
    const result = buildProjectHazardDiagramSummary(headers, [
      { originalIndex: 0, rowKey: "0:guide:0", generated: true, row: completedRow },
      { originalIndex: 6, rowKey: "0:guide:6", generated: true, row: staleDraft },
      { originalIndex: 6, rowKey: "0:guide:6", generated: true, row: regeneratedDraft },
      { originalIndex: 7, rowKey: "1:guide:0", generated: false, row: ["Map", "", "Planner", ""] },
    ]);

    expect(result.summary).toEqual([headers, completedRow, regeneratedDraft]);
    expect(result.sourceIndexes).toEqual([0, 6]);
  });
});

describe("resolveProjectHazardArtifactNavigation", () => {
  it("opens an incremental STPA guide phrase at its canonical draft-table index", () => {
    expect(resolveProjectHazardArtifactNavigation({
      type: "hazard_analysis_row",
      sourceId: "p1:draftHazardRowsByIndex:2:guide:3",
      structuredData: { draft: true },
    }, "STPA-Textbook")).toEqual({
      rowIndex: 17,
      artifactType: "hazard_summary_draft_table",
    });
  });

  it("opens completed and structured hazard rows at their stored indexes", () => {
    expect(resolveProjectHazardArtifactNavigation({
      type: "hazard_analysis_row",
      sourceId: "p1:analysisResult:Summary:4",
    })).toEqual({ rowIndex: 4, artifactType: "hazard_summary_table" });
    expect(resolveProjectHazardArtifactNavigation({
      type: "hazard_analysis_row",
      sourceId: "stale-source",
      structuredData: { rowIndex: 9, draft: true },
    })).toEqual({ rowIndex: 9, artifactType: "hazard_summary_draft_table" });
  });
});
