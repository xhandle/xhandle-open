const {
  generateRepositoryAnalysisContext,
  normalizeGeneratedRepositoryAnalysisContext,
} = require("./repositoryAnalysisContextAi");

describe("repository analysis context AI", () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses repository evidence and returns editable plain text", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "```markdown\nAutonomy runtime for off-road vehicles.\n```" } }] }),
    });

    const result = await generateRepositoryAnalysisContext({
      repositoryUrl: "https://github.com/example/autonomy",
      repositoryContext: {
        repoName: "autonomy",
        readmePath: "README.md",
        readmeText: "An autonomous vehicle runtime.",
        folderSummary: "- runtime/ (20 files)",
      },
    });

    expect(result).toBe("Autonomy runtime for off-road vehicles.");
    const request = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(request.messages[1].content).toContain("https://github.com/example/autonomy");
    expect(request.messages[1].content).toContain("An autonomous vehicle runtime.");
  });

  it("rejects generation when repository evidence is unavailable", async () => {
    await expect(generateRepositoryAnalysisContext({
      repositoryUrl: "https://github.com/example/empty",
      repositoryContext: {},
    })).rejects.toThrow("enough README or structure evidence");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("removes optional Markdown fences", () => {
    expect(normalizeGeneratedRepositoryAnalysisContext("```text\nContext\n```"))
      .toBe("Context");
  });
});


it('generates local context without requiring or inventing a GitHub URL', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ content: 'Local controller.' }) }));
  const result = await generateRepositoryAnalysisContext({ sourceName: 'controller', repositoryContext: { readmeText: 'A vehicle controller.', repoName: 'controller' } });
  expect(result).toBe('Local controller.');
  const body = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(body.messages[1].content).toContain('Local project: controller');
  expect(body.messages[1].content).not.toContain('Repository URL:');
});
