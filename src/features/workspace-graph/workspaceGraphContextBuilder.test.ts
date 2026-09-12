jest.mock("./legacyWorkspaceGraphMigrator", () => ({
  getLatestWorkspaceGraphMigrationDiagnostics: jest.fn(() => ({
    artifactCount: 1,
    relationshipCount: 1,
    errors: [],
  })),
  migrateLegacyStorageToWorkspaceGraph: jest.fn(async () => ({
    artifactCount: 1,
    relationshipCount: 1,
    errors: [],
  })),
  migrateLegacyStorageToWorkspaceGraphIfStale: jest.fn(async () => ({
    artifactCount: 1,
    relationshipCount: 1,
    errors: [],
  })),
}));

const { buildWorkspaceLLMContext } = require("./workspaceGraphContextBuilder");
const repository = require("./workspaceGraphRepository");
const search = require("./workspaceGraphSearch");
const migrator = require("./legacyWorkspaceGraphMigrator");

jest.mock("./workspaceGraphSearch", () => ({
  searchArtifacts: jest.fn(async () => [
    {
      id: "artifact:req-1",
      type: "requirement",
      projectId: "p1",
      title: "Brake requirement",
      sourceStore: "localStorage:xhandle:requirements",
      sourceId: "REQ-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    },
  ]),
}));

jest.mock("./workspaceGraphRepository", () => ({
  getArtifact: jest.fn(),
  getNeighborhood: jest.fn(async () => ({
    artifacts: [
      {
        id: "artifact:req-1",
        type: "requirement",
        projectId: "p1",
        title: "Brake requirement",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      },
    ],
    relationships: [
      {
        id: "rel:contains",
        type: "contains",
        projectId: "p1",
        fromArtifactId: "artifact:project:p1",
        toArtifactId: "artifact:req-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  })),
  listArtifacts: jest.fn(async () => [
    {
      id: "artifact:req-1",
      type: "requirement",
      projectId: "p1",
      title: "Brake requirement",
      sourceStore: "localStorage:xhandle:requirements",
      sourceId: "REQ-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    },
  ]),
  listEvidence: jest.fn(async () => []),
  listProjects: jest.fn(async () => [
    {
      id: "p1",
      projectId: "p1",
      name: "Project One",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    },
  ]),
  listRelationships: jest.fn(async () => [
    {
      id: "rel:contains",
      type: "contains",
      projectId: "p1",
      fromArtifactId: "artifact:project:p1",
      toArtifactId: "artifact:req-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]),
  listReviews: jest.fn(async () => []),
  listRuns: jest.fn(async () => []),
  listSourceFiles: jest.fn(async () => [
    {
      id: "artifact:file-1",
      projectId: "p1",
      path: "src/brake.ts",
      title: "src/brake.ts",
      sourceStore: "indexedDB:xhandle/code_index",
      sourceId: "code:file:repo:src/brake.ts",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    },
  ]),
}));

describe("buildWorkspaceLLMContext", () => {
  it("returns canonical projects, artifacts, relationships, citations, and diagnostics", async () => {
    repository.listProjects.mockResolvedValue([
      {
        id: "p1",
        projectId: "p1",
        name: "Project One",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      },
    ]);
    repository.listArtifacts.mockResolvedValue([
      {
        id: "artifact:req-1",
        type: "requirement",
        projectId: "p1",
        title: "Brake requirement",
        sourceStore: "localStorage:xhandle:requirements",
        sourceId: "REQ-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      },
    ]);
    search.searchArtifacts.mockResolvedValue([
      {
        id: "artifact:req-1",
        type: "requirement",
        projectId: "p1",
        title: "Brake requirement",
        sourceStore: "localStorage:xhandle:requirements",
        sourceId: "REQ-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      },
    ]);
    repository.listRelationships.mockResolvedValue([
      {
        id: "rel:contains",
        type: "contains",
        projectId: "p1",
        fromArtifactId: "artifact:project:p1",
        toArtifactId: "artifact:req-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    repository.listRuns.mockResolvedValue([]);
    repository.listReviews.mockResolvedValue([]);
    repository.listEvidence.mockResolvedValue([]);
    repository.listSourceFiles.mockResolvedValue([
      {
        id: "artifact:file-1",
        projectId: "p1",
        path: "src/brake.ts",
        title: "src/brake.ts",
        sourceStore: "indexedDB:xhandle/code_index",
        sourceId: "code:file:repo:src/brake.ts",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      },
    ]);
    repository.getNeighborhood.mockResolvedValue({
      artifacts: [
        {
          id: "artifact:req-1",
          type: "requirement",
          projectId: "p1",
          title: "Brake requirement",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          version: 1,
        },
      ],
      relationships: [
        {
          id: "rel:contains",
          type: "contains",
          projectId: "p1",
          fromArtifactId: "artifact:project:p1",
          toArtifactId: "artifact:req-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    migrator.migrateLegacyStorageToWorkspaceGraphIfStale.mockResolvedValue({
      artifactCount: 1,
      relationshipCount: 1,
      errors: [],
    });

    const context = await buildWorkspaceLLMContext({
      projectId: "p1",
      query: "brake requirement",
      activeView: { section: "requirements", hugeState: { ignored: true } },
      tokenBudget: 6000,
    });

    expect(context.projects).toHaveLength(1);
    expect(context.relevantArtifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "artifact:req-1", type: "requirement" }),
    ]));
    expect(context.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "contains" }),
    ]));
    expect(context.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactId: "artifact:req-1" }),
      expect.objectContaining({ artifactId: "artifact:file-1", type: "source_file" }),
    ]));
    expect(context.diagnostics).toEqual(expect.objectContaining({
      migration: expect.objectContaining({ artifactCount: 1 }),
      truncation: expect.any(Object),
    }));
    expect(context.scope.activeView).toEqual(expect.objectContaining({ section: "requirements" }));
    expect(context.scope.activeView.hugeState).toBeUndefined();
  });

  it("prioritizes generated hazard evidence for hazard-analysis questions", async () => {
    const hazardArtifact = {
      id: "artifact:hazard-1",
      type: "hazard_analysis_row",
      projectId: "p1",
      title: "Trajectory command provided too late",
      structuredData: {
        rowKey: "0:guide:3",
        columns: ["Function (From)", "Control Action", "Function (To)", "Guide Phrase", "Unsafe Control Action"],
        row: ["Plan Motion", "Issue trajectory", "Control Motion", "Provided too late", "Trajectory arrives after the safe braking point"],
        draft: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    };
    repository.listArtifacts.mockResolvedValue([
      hazardArtifact,
      {
        id: "artifact:req-1",
        type: "requirement",
        projectId: "p1",
        title: "Brake requirement",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      },
    ]);
    search.searchArtifacts.mockResolvedValue([
      {
        id: "artifact:req-1",
        type: "requirement",
        projectId: "p1",
        title: "Brake requirement",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      },
    ]);

    const context = await buildWorkspaceLLMContext({
      projectId: "p1",
      query: "What guide phrase was analyzed for the trajectory hazard?",
      tokenBudget: 6000,
    });

    expect(context.relevantArtifacts[0]).toEqual(expect.objectContaining({
      id: "artifact:hazard-1",
      type: "hazard_analysis_row",
    }));
    expect(context.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactId: "artifact:hazard-1" }),
    ]));
    expect(context.diagnostics.selection).toEqual(expect.objectContaining({
      hazardFocused: true,
      hazardEvidenceCount: 1,
    }));
  });

  it("preserves active cell context and prioritizes its authoritative table row", async () => {
    const selectedRowArtifact = {
      id: "artifact:function-row-4",
      type: "functional_decomposition_row",
      projectId: "p1",
      title: "Issue trajectory",
      sourceStore: "localStorage:xhandle:projects",
      sourceId: "project:p1:responseRows:3",
      structuredData: {
        rowIndex: 3,
        row: ["Plan Motion", "Trajectory Command", "Control Motion"],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    };
    repository.listArtifacts.mockResolvedValue([
      {
        id: "artifact:req-1",
        type: "requirement",
        projectId: "p1",
        title: "Brake requirement",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        version: 1,
      },
      selectedRowArtifact,
    ]);
    search.searchArtifacts.mockResolvedValue([]);

    const context = await buildWorkspaceLLMContext({
      projectId: "p1",
      query: "Explain why this control action exists",
      activeView: {
        section: "projects",
        activeTab: "functional",
        activeSelections: [{
          kind: "table-cell",
          source: "table",
          tableId: "functional-decomposition",
          tableLabel: "Functional Decomposition",
          projectId: "p1",
          primary: {
            rowId: "functional:p1:3",
            rowIndex: 3,
            rowNumber: 4,
            columnIndex: 1,
            columnLabel: "Control Action",
            value: "Trajectory Command",
          },
          selectedRows: [{
            rowId: "functional:p1:3",
            rowIndex: 3,
            rowNumber: 4,
            values: {
              "Function (From)": "Plan Motion",
              "Control Action": "Trajectory Command",
              "Function (To)": "Control Motion",
            },
          }],
        }],
      },
      tokenBudget: 6000,
    });

    expect(context.scope.activeView.activeSelections[0]).toEqual(expect.objectContaining({
      kind: "table-cell",
      tableId: "functional-decomposition",
      primary: expect.objectContaining({ columnLabel: "Control Action", value: "Trajectory Command" }),
    }));
    expect(context.relevantArtifacts[0]).toEqual(expect.objectContaining({
      id: "artifact:function-row-4",
    }));
    expect(context.diagnostics.selection.activeSelectionArtifactCount).toBe(1);
  });
});
