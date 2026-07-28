jest.mock("./workspaceGraphRepository", () => ({
  getArtifact: jest.fn(async (id) => ({
    id,
    type: "requirement",
    projectId: "p1",
    title: "Brake requirement",
    summary: "Vehicle shall stop safely.",
    content: "A".repeat(10000),
    sourceStore: "localStorage:xhandle:requirements",
    sourceId: "REQ-1",
    tags: ["safety"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  })),
  listArtifacts: jest.fn(async () => [
    {
      id: "artifact:req-1",
      type: "requirement",
      projectId: "p1",
      title: "Brake requirement",
      summary: "Vehicle shall stop safely.",
      content: "A".repeat(10000),
      sourceStore: "localStorage:xhandle:requirements",
      sourceId: "REQ-1",
      tags: ["safety"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    },
  ]),
  listRelationships: jest.fn(async () => [
    {
      id: "rel:1",
      type: "satisfies",
      fromArtifactId: "artifact:req-1",
      toArtifactId: "artifact:test-1",
      createdAt: "",
      updatedAt: "",
    },
  ]),
}));

const {
  getArtifactRetrievalDocument,
  getWorkspaceRetrievalCorpus,
} = require("./workspaceGraphRetrieval");
const repository = require("./workspaceGraphRepository");

const artifact = {
  id: "artifact:req-1",
  type: "requirement",
  projectId: "p1",
  title: "Brake requirement",
  summary: "Vehicle shall stop safely.",
  content: "A".repeat(10000),
  sourceStore: "localStorage:xhandle:requirements",
  sourceId: "REQ-1",
  tags: ["safety"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
};
const relationship = {
  id: "rel:1",
  type: "satisfies",
  fromArtifactId: "artifact:req-1",
  toArtifactId: "artifact:test-1",
  createdAt: "",
  updatedAt: "",
};

describe("workspace graph retrieval", () => {
  it("returns bounded retrieval corpus documents with citations and relationship hints", async () => {
    repository.listArtifacts.mockResolvedValue([artifact]);
    repository.listRelationships.mockResolvedValue([relationship]);
    const docs = await getWorkspaceRetrievalCorpus({ projectId: "p1", artifactTypes: ["requirement"], limit: 10 });

    expect(docs).toHaveLength(1);
    expect(docs[0]).toEqual(expect.objectContaining({
      id: "workspace-graph:artifact:req-1",
      artifactId: "artifact:req-1",
      metadata: expect.objectContaining({ type: "requirement", projectId: "p1" }),
      citations: [expect.objectContaining({ artifactId: "artifact:req-1" })],
      relationshipHints: [expect.objectContaining({ type: "satisfies" })],
    }));
    expect(docs[0].text.length).toBeLessThanOrEqual(6003);
  });

  it("returns a bounded single artifact retrieval document", async () => {
    repository.getArtifact.mockResolvedValue(artifact);
    repository.listRelationships.mockResolvedValue([relationship]);
    const doc = await getArtifactRetrievalDocument("artifact:req-1");

    expect(doc).toEqual(expect.objectContaining({
      artifactId: "artifact:req-1",
      citations: [expect.objectContaining({ sourceId: "REQ-1" })],
    }));
    expect(doc.text.length).toBeLessThanOrEqual(6003);
  });
});
