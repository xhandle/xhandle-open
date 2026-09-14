const {
  clearCodeArchitectureHazardContexts,
  loadCodeArchitectureHazardContexts,
  saveCodeArchitectureHazardContexts,
} = require("./codeArchitectureHazardContextStore");

describe("code architecture hazard context store", () => {
  beforeEach(() => localStorage.clear());

  it("persists normalized contexts independently for each project repository", () => {
    const contexts = [
      { id: "normal", scenario: " Nominal route ", mode: " Automatic ", conditions: "Dry", assumptions: "Healthy" },
      { id: "invalid", scenario: "Missing mode", mode: "" },
    ];

    const saved = saveCodeArchitectureHazardContexts({ projectId: "project-a", repoId: "repo-a", contexts });

    expect(saved).toEqual([{
      id: "normal",
      scenario: "Nominal route",
      mode: "Automatic",
      conditions: "Dry",
      assumptions: "Healthy",
    }]);
    expect(loadCodeArchitectureHazardContexts({ projectId: "project-a", repoId: "repo-a" })).toEqual(saved);
    expect(loadCodeArchitectureHazardContexts({ projectId: "project-a", repoId: "repo-b" })).toEqual([]);
  });

  it("clears only the requested project repository contexts", () => {
    const contexts = [{ id: "normal", scenario: "Nominal route", mode: "Automatic" }];
    saveCodeArchitectureHazardContexts({ projectId: "project-a", repoId: "repo-a", contexts });
    saveCodeArchitectureHazardContexts({ projectId: "project-a", repoId: "repo-b", contexts });

    clearCodeArchitectureHazardContexts({ projectId: "project-a", repoId: "repo-a" });

    expect(loadCodeArchitectureHazardContexts({ projectId: "project-a", repoId: "repo-a" })).toEqual([]);
    expect(loadCodeArchitectureHazardContexts({ projectId: "project-a", repoId: "repo-b" })).toHaveLength(1);
  });
});
