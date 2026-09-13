const mockGetArtifact = jest.fn();
const mockMigrate = jest.fn(async () => ({}));
const mockRecordChange = jest.fn(async () => ({}));
const mockDeleteArtifacts = jest.fn(async () => 0);
const mockLoadArtifactRowsAsync = jest.fn(async () => []);
const mockSaveArtifactRowsAsync = jest.fn(async () => true);
const mockGetCodeArchitectureHazardRunById = jest.fn(async () => null);
const mockSaveCodeArchitectureHazardRun = jest.fn(async () => true);

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
jest.mock("../code-architecture-assurance/artifactUtils", () => ({
  loadArtifactRowsAsync: (...args) => mockLoadArtifactRowsAsync(...args),
  saveArtifactRowsAsync: (...args) => mockSaveArtifactRowsAsync(...args),
}));
jest.mock("../code-architecture-hazard-analysis/codeArchitectureHazardStore", () => ({
  getCodeArchitectureHazardRunById: (...args) => mockGetCodeArchitectureHazardRunById(...args),
  saveCodeArchitectureHazardRun: (...args) => mockSaveCodeArchitectureHazardRun(...args),
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

  test("updates a code-architecture hazard row in its hazard run instead of the project hazard store", async () => {
    const { saveProjectHazardAnalysisRecord } = require("../project-hazard-analysis/projectHazardAnalysisStorage");
    mockGetArtifact.mockResolvedValue({
      id: "cba-hazard-row-1",
      type: "code_architecture_hazard_row",
      projectId: "cba-project-1",
      sourceStore: "indexedDB:xhandle-code-architecture-hazard-analysis/hazardAnalysisRuns",
      sourceId: "cba-run-1:summary:0",
      structuredData: { rowIndex: 0, columns: ["Hazard", "Safety Significant"], row: ["Unexpected motion", "Needs Review"] },
    });
    mockGetCodeArchitectureHazardRunById.mockResolvedValue({
      id: "cba-run-1",
      projectId: "cba-project-1",
      repoId: "repo-1",
      generatedSheets: { Summary: [["Hazard", "Safety Significant"], ["Unexpected motion", "Needs Review"]] },
    });

    await executeWorkspaceActionPlan({
      summary: "Resolve the CBA hazard classification",
      actions: [{
        id: "action-cba-hazard",
        operation: "update",
        target: { artifactId: "cba-hazard-row-1", type: "code_architecture_hazard_row", projectId: "cba-project-1" },
        field: "Safety Significant",
        value: "Yes",
      }],
    });

    expect(mockSaveCodeArchitectureHazardRun).toHaveBeenCalledWith(expect.objectContaining({
      id: "cba-run-1",
      generatedSheets: { Summary: [["Hazard", "Safety Significant"], ["Unexpected motion", "Yes"]] },
    }));
    expect(saveProjectHazardAnalysisRecord).not.toHaveBeenCalled();
  });

  test("updates and undoes a code-architecture assurance row in its repository table", async () => {
    mockGetArtifact.mockResolvedValue({
      id: "cba-system-requirement-1",
      type: "code_architecture_system_requirement",
      projectId: "cba-project-1",
      sourceStore: "indexedDB:xhandle-code-architecture-assurance/artifactRows",
      sourceKey: "xhandle:cba-system-requirements:cba-project-1:repo-1",
      sourceId: "xhandle:cba-system-requirements:cba-project-1:repo-1:SYS-1",
      structuredData: { id: "SYS-1", requirementText: "The system shall stop.", _rowIndex: 0 },
    });
    mockLoadArtifactRowsAsync.mockResolvedValue([{ id: "SYS-1", requirementText: "The system shall stop." }]);

    await executeWorkspaceActionPlan({
      summary: "Clarify a CBA system requirement",
      actions: [{
        id: "action-cba-requirement",
        operation: "update",
        target: { artifactId: "cba-system-requirement-1", type: "code_architecture_system_requirement", projectId: "cba-project-1" },
        field: "requirementText",
        value: "The system shall enter a controlled stop.",
      }],
    });

    expect(mockSaveArtifactRowsAsync).toHaveBeenCalledWith(
      "system-requirements",
      "cba-project-1",
      "repo-1",
      [{ id: "SYS-1", requirementText: "The system shall enter a controlled stop." }],
    );

    await undoLastWorkspaceAction();
    expect(mockSaveArtifactRowsAsync).toHaveBeenLastCalledWith(
      "system-requirements",
      "cba-project-1",
      "repo-1",
      [{ id: "SYS-1", requirementText: "The system shall stop." }],
    );
  });

  test("renames a code-architecture project without changing the functional-project catalog", async () => {
    localStorage.setItem("xhandle.codeArchitectureProjects", JSON.stringify([
      { id: "cba-project-1", name: "Old CBA name", repos: [] },
    ]));
    localStorage.setItem("xhandle.projects", JSON.stringify([{ id: "project-1", name: "Functional project" }]));
    mockGetArtifact.mockResolvedValue({
      id: "artifact-project-cba-1",
      type: "project",
      projectId: "cba-project-1",
      sourceStore: "localStorage:xhandle.codeArchitectureProjects",
      sourceId: "cba-project-1",
      structuredData: { id: "cba-project-1", projectType: "code-based-architecture" },
    });

    await executeWorkspaceActionPlan({
      summary: "Rename the visible CBA project",
      actions: [{
        id: "action-cba-project",
        operation: "update",
        target: { artifactId: "artifact-project-cba-1", type: "project", projectId: "cba-project-1" },
        field: "name",
        value: "New CBA name",
      }],
    });

    expect(JSON.parse(localStorage.getItem("xhandle.codeArchitectureProjects"))[0].name).toBe("New CBA name");
    expect(JSON.parse(localStorage.getItem("xhandle.projects"))[0].name).toBe("Functional project");
  });
});
