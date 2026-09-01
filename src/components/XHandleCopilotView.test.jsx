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

const {
  buildPromptContentFromContext,
  isDiagramFunctionalDecompositionRequest,
  renderCopilotContext,
} = require("./XHandleCopilotView");

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

describe("diagram functional decomposition prompting", () => {
  const imageContext = [{
    file: { name: "architecture.png", type: "image/png", size: 1234 },
    imageDataUrl: "data:image/png;base64,abc123",
  }];

  it("detects image-grounded functional decomposition requests", () => {
    expect(isDiagramFunctionalDecompositionRequest(
      imageContext,
      "Use this diagram to create a functional decomposition",
    )).toBe(true);
    expect(isDiagramFunctionalDecompositionRequest(
      imageContext,
      "Describe the colors in this image",
    )).toBe(false);
    expect(isDiagramFunctionalDecompositionRequest(
      [],
      "Create a functional decomposition",
    )).toBe(false);
  });

  it("injects the visual inventory and coverage contract before the image", () => {
    const content = buildPromptContentFromContext(
      imageContext,
      "Use this diagram to create a functional decomposition",
    );

    expect(Array.isArray(content)).toBe(true);
    expect(content[0].type).toBe("text");
    expect(content[0].text).toContain("Pass 1 — visual inventory");
    expect(content[0].text).toContain("every visible directed interface");
    expect(content[0].text).toContain("Never use connector text");
    expect(content[0].text).toContain("exactly those seven columns");
    expect(content[0].text).toContain("branched lines");
    expect(content[0].text).toContain("Coverage Check");
    expect(content.some((part) => part.type === "image_url")).toBe(true);
  });
});
