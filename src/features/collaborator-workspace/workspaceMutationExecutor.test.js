const mockGetArtifact = jest.fn();
const mockMigrate = jest.fn(async () => ({}));
const mockRecordChange = jest.fn(async () => ({}));
const mockDeleteArtifacts = jest.fn(async () => 0);

jest.mock("../workspace-graph", () => ({
  getArtifact: (...args) => mockGetArtifact(...args),
  migrateLegacyStorageToWorkspaceGraphIfStale: (...args) => mockMigrate(...args),
  recordChange: (...args) => mockRecordChange(...args),
  deleteArtifacts: (...args) => mockDeleteArtifacts(...args),
}));

jest.mock("../project-hazard-analysis/projectHazardAnalysisStorage", () => ({
  loadProjectHazardAnalysisRecord: jest.fn(async () => null),
  saveProjectHazardAnalysisRecord: jest.fn(async () => true),
}));
jest.mock("../project-hazard-analysis/safetyIssueReportStorage", () => ({
  loadSafetyIssueReportRecord: jest.fn(async () => null),
  saveSafetyIssueReportRecord: jest.fn(async () => true),
}));
jest.mock("../requirements/actions/requirementsState", () => ({
  loadRequirements: jest.fn(() => []),
  saveRequirementRecord: jest.fn(),
  saveRequirements: jest.fn(),
}));
jest.mock("../code-architecture-assurance/codeArchitectureStorage", () => ({
  readCbaRowsFromIndexedDB: jest.fn(async () => []),
  writeCbaRowsToIndexedDB: jest.fn(async () => true),
}));
jest.mock("../results-review/reviewStore", () => ({
  loadReviewItems: jest.fn(async () => []),
  saveReviewItems: jest.fn(async () => []),
}));
jest.mock("../safety-case/safetyCaseStore", () => ({
  createSafetyCase: jest.fn(),
  deleteSafetyCase: jest.fn(),
  loadSafetyCase: jest.fn(),
  saveSafetyCase: jest.fn(),
}));

import { executeWorkspaceActionPlan, undoLastWorkspaceAction } from "./workspaceMutationExecutor";

describe("Collaborator authoritative workspace mutations", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockGetArtifact.mockResolvedValue({
      id: "functional-row-1",
      type: "functional_decomposition_row",
      projectId: "project-1",
      sourceId: "project-1:responseRows:0",
      structuredData: { subsystem: "Braking", fromFunction: "Assess demand", toFunction: "Apply brake" },
    });
    localStorage.setItem("xhandle.projectData", JSON.stringify({
      "project-1": {
        responseRows: [{ subsystem: "Braking", fromFunction: "Assess demand", toFunction: "Apply brake" }],
      },
    }));
  });

  test("persists an approved field update, records it, and restores it with undo", async () => {
    const result = await executeWorkspaceActionPlan({
      summary: "Correct subsystem ownership",
      actions: [{
        id: "action-1",
        operation: "update",
        target: { artifactId: "functional-row-1", type: "functional_decomposition_row", projectId: "project-1", title: "Assess demand -> Apply brake" },
        field: "subsystem",
        value: "Brake Control",
      }],
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(localStorage.getItem("xhandle.projectData"))["project-1"].responseRows[0].subsystem).toBe("Brake Control");
    expect(mockRecordChange).toHaveBeenCalledWith(expect.objectContaining({ action: "update", entityId: "functional-row-1" }));
    expect(mockMigrate).toHaveBeenCalledWith({ force: true, mode: "full" });

    const undo = await undoLastWorkspaceAction();
    expect(undo.ok).toBe(true);
    expect(JSON.parse(localStorage.getItem("xhandle.projectData"))["project-1"].responseRows[0].subsystem).toBe("Braking");
  });

  test("rolls back an entire plan when a later source is stale", async () => {
    mockGetArtifact
      .mockResolvedValueOnce({
        id: "functional-row-1",
        type: "functional_decomposition_row",
        projectId: "project-1",
        sourceId: "project-1:responseRows:0",
        structuredData: { subsystem: "Braking", fromFunction: "Assess demand", toFunction: "Apply brake" },
      })
      .mockResolvedValueOnce(null);

    await expect(executeWorkspaceActionPlan({
      summary: "Apply two related corrections",
      actions: [
        {
          id: "action-1",
          operation: "update",
          target: { artifactId: "functional-row-1", type: "functional_decomposition_row", projectId: "project-1" },
          field: "subsystem",
          value: "Brake Control",
        },
        {
          id: "action-2",
          operation: "delete",
          target: { artifactId: "stale-row", type: "functional_decomposition_row", projectId: "project-1" },
        },
      ],
    })).rejects.toThrow(/rolled back/i);

    expect(JSON.parse(localStorage.getItem("xhandle.projectData"))["project-1"].responseRows[0].subsystem).toBe("Braking");
  });
});
