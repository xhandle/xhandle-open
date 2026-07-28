jest.mock("./legacyWorkspaceGraphMigrator", () => ({
  getLatestWorkspaceGraphMigrationDiagnostics: jest.fn(() => ({
    version: 1,
    artifactCount: 2,
    relationshipCount: 2,
    errors: [],
  })),
}));

function mockCreateStore(storeName: string, rows: any[]) {
  return {
    indexNames: {
      contains: (indexName: string) => [
        "by_workspace",
        "by_source",
        "by_source_key",
        "by_project",
        "by_parent",
        "by_type",
        "by_project_type",
        "by_updated",
        "by_from",
        "by_to",
        "by_repo",
        "by_path",
        "by_status",
        "by_artifact",
        "by_entity",
        "by_at",
      ].includes(indexName),
      [Symbol.iterator]: function* iterator() {
        yield "by_project";
      },
    },
    count: jest.fn(async () => rows.length),
    name: storeName,
  };
}

function mockDb() {
    const mockArtifacts = [
      { id: "artifact:project:p1", type: "project", title: "Project", createdAt: "", updatedAt: "" },
      { id: "artifact:req-1", type: "requirement", parentId: "artifact:project:p1", title: "Requirement", sourceStore: "localStorage:xhandle:requirements", sourceId: "REQ-1", createdAt: "", updatedAt: "" },
      { id: "artifact:orphan-parent", type: "risk", parentId: "artifact:project:p1", title: "Risk", createdAt: "", updatedAt: "" },
    ];
    const mockRelationships = [
      { id: "rel:contains", type: "contains", fromArtifactId: "artifact:project:p1", toArtifactId: "artifact:req-1", createdAt: "", updatedAt: "" },
      { id: "rel:orphan", type: "references", fromArtifactId: "artifact:req-1", toArtifactId: "artifact:missing", createdAt: "", updatedAt: "" },
    ];
    const mockSourceFiles = [
      { id: "artifact:file-missing", path: "src/missing.ts", title: "src/missing.ts", createdAt: "", updatedAt: "" },
    ];
    const rowsByStore: Record<string, any[]> = {
      workspaces: [],
      projects: [],
      folders: [],
      artifacts: mockArtifacts,
      relationships: mockRelationships,
      runs: [],
      reviews: [],
      evidence: [],
      sourceFiles: mockSourceFiles,
      summaries: [],
      changeLog: [],
    };
  return {
      objectStoreNames: {
        contains: (storeName: string) => Object.prototype.hasOwnProperty.call(rowsByStore, storeName),
      },
      transaction: (storeName: string) => ({
        objectStore: () => mockCreateStore(storeName, rowsByStore[storeName] || []),
        done: Promise.resolve(),
      }),
      getAll: jest.fn(async (storeName: string) => rowsByStore[storeName] || []),
      close: jest.fn(),
    };
}

jest.mock("./workspaceGraphDb", () => ({
  openWorkspaceGraphDB: jest.fn(),
}));

const { validateWorkspaceGraphRuntime } = require("./workspaceGraphRuntimeValidator");
const graphDb = require("./workspaceGraphDb");

describe("validateWorkspaceGraphRuntime", () => {
  it("detects orphan relationships, missing parent contains links, and source file artifact gaps", async () => {
    graphDb.openWorkspaceGraphDB.mockResolvedValue(mockDb());
    const diagnostics = await validateWorkspaceGraphRuntime({ sampleLimit: 5 });

    expect(diagnostics.opened).toBe(true);
    expect(diagnostics.ok).toBe(false);
    expect(diagnostics.orphanRelationships).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "rel:orphan" }),
    ]));
    expect(diagnostics.missingContainsForParent).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "artifact:orphan-parent" }),
    ]));
    expect(diagnostics.sourceFilesMissingArtifact).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "artifact:file-missing" }),
    ]));
  });
});
