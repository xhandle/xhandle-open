jest.mock("react-markdown", () => function ReactMarkdownMock({ children }) {
  return <div>{children}</div>;
});
jest.mock("remark-gfm", () => jest.fn());
jest.mock("rehype-sanitize", () => ({
  __esModule: true,
  default: jest.fn(),
  defaultSchema: {},
}));
jest.mock("html2canvas", () => jest.fn());
jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});
jest.mock("./RegionLassoOverlay", () => ({ openRegionSelector: jest.fn() }));
jest.mock("./utils/copilotContextBus", () => ({
  pushRegionContext: jest.fn(),
  popAllRegionContext: jest.fn(() => []),
}));
jest.mock("../features/workspace-graph", () => ({
  buildWorkspaceLLMContext: jest.fn(),
}));

const { renderCopilotContext } = require("./XHandleCopilotView");

describe("renderCopilotContext", () => {
  it("renders canonical workspace graph context without crashing", () => {
    const rendered = renderCopilotContext({
      scope: {
        workspaceId: "workspace:local",
        projectId: "p1",
        activeView: { section: "code-architecture" },
        query: "review hazards",
      },
      workspaceSummary: {
        projectCount: 1,
        artifactCount: 2,
        relationshipCount: 1,
        relevantArtifactCount: 1,
      },
      projects: [{ id: "p1", name: "Project One" }],
      relevantArtifacts: [
        {
          id: "artifact:hazard-1",
          type: "hazard_analysis_row",
          projectId: "p1",
          title: "Hazard row",
          sourceStore: "indexedDB:xhandle-code-architecture-hazard-analysis/hazardAnalysisRuns",
        },
      ],
      relationships: [
        {
          id: "rel:1",
          type: "derived_from",
          fromArtifactId: "artifact:hazard-1",
          toArtifactId: "run:1",
        },
      ],
      runs: [],
      reviews: [],
      evidence: [],
      sourceFiles: [{ id: "artifact:file-1", path: "src/hazard.ts", title: "src/hazard.ts" }],
      citations: [
        { artifactId: "artifact:hazard-1", type: "hazard_analysis_row" },
        { artifactId: "artifact:file-1", type: "source_file", title: "src/hazard.ts" },
      ],
      diagnostics: {},
    });

    expect(rendered).toContain("canonical xHandle workspace graph");
    expect(rendered).toContain("artifact:hazard-1");
    expect(rendered).toContain("artifact:file-1");
    expect(rendered).toContain("source_file");
    expect(rendered).toContain("derived_from");
  });
});
