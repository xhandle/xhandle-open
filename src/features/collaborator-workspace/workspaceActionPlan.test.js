import {
  buildWorkspaceActionPlannerMessages,
  extractWorkspaceActionJson,
  isWorkspaceAdvisoryIntent,
  isWorkspaceMutationIntent,
  isWorkspaceUndoIntent,
  normalizeWorkspaceActionPlan,
  validateWorkspaceActionPlan,
} from "./workspaceActionPlan";

describe("Collaborator workspace action planning", () => {
  test("recognizes explicit engineering data edits without treating questions as commands", () => {
    expect(isWorkspaceMutationIntent("Update the owner cell on the braking risk to Nick")).toBe(true);
    expect(isWorkspaceMutationIntent("Can you update the owner cell on the braking risk to Nick?")).toBe(true);
    expect(isWorkspaceMutationIntent("Delete that hazard row")).toBe(true);
    expect(isWorkspaceMutationIntent("Should we update the hazard table?")).toBe(false);
  });

  test("keeps project ideation and recommendations out of the mutation planner", () => {
    const showcasePrompt = "I want to create a project that really showcases xHandle's hazard analysis capabilities. Do you have any suggestions?";
    expect(isWorkspaceAdvisoryIntent(showcasePrompt)).toBe(true);
    expect(isWorkspaceMutationIntent(showcasePrompt)).toBe(false);
    expect(isWorkspaceMutationIntent("What project would you recommend I create?")).toBe(false);
    expect(isWorkspaceMutationIntent("Please create a project using your recommended option.")).toBe(true);
    expect(isWorkspaceMutationIntent("Can you create a project and suggest a concise name?")).toBe(true);
  });

  test("recognizes a narrow undo request", () => {
    expect(isWorkspaceUndoIntent("undo that")).toBe(true);
    expect(isWorkspaceUndoIntent("undo the last change")).toBe(true);
    expect(isWorkspaceUndoIntent("undo all project changes")).toBe(false);
  });

  test("extracts fenced JSON and rejects invented targets", () => {
    const parsed = extractWorkspaceActionJson('```json\n{"intent":"mutate","actions":[]}\n```');
    expect(parsed.intent).toBe("mutate");
    const candidates = [{ id: "artifact-1", type: "risk", title: "Brake risk" }];
    const plan = normalizeWorkspaceActionPlan({
      intent: "mutate",
      actions: [{ operation: "update", target: { artifactId: "invented" }, field: "owner", value: "Nick" }],
    }, candidates);
    expect(validateWorkspaceActionPlan(plan, candidates)).toContain("Action 1 references an artifact that was not in the retrieved source set.");
  });

  test("bounds retrieved evidence for large workspaces", () => {
    const candidates = Array.from({ length: 50 }, (_, index) => ({
      id: `artifact-${index}`,
      type: "report",
      title: `Report ${index}`,
      content: "x".repeat(20000),
      structuredData: { body: "y".repeat(20000) },
    }));
    const messages = buildWorkspaceActionPlannerMessages({ userText: "Update this report", candidates });
    const payload = JSON.parse(messages[1].content);
    expect(payload.retrievedSources.length).toBeLessThanOrEqual(32);
    expect(JSON.stringify(payload.retrievedSources).length).toBeLessThan(65000);
    expect(payload.retrievedSources[0].artifactId).toBe("artifact-0");
  });
});
