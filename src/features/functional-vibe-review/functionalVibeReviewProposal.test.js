import { requestFunctionalVibeReviewProposal } from "./functionalVibeReviewProposal";

const row = {
  subsystem: "Planning",
  fromFunction: "Plan Route",
  fromDetails: "Builds a route.",
  controlAction: "Planned Route",
  controlDetails: "Route geometry and constraints.",
  toFunction: "Validate Route",
  toDetails: "Checks feasibility.",
};

afterEach(() => {
  jest.restoreAllMocks();
});

test("uses the selected provider, model, and effort for functional review", async () => {
  const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      decision: "Keep",
      explanation: "The interface connects two leaf functions.",
      rationale: "Direction and payload semantics are consistent.",
      confidence: "High",
      issues: [],
    }) } }] }),
  });

  const result = await requestFunctionalVibeReviewProposal({
    row,
    rowNumber: 1,
    projectName: "Test",
    provider: "anthropic",
    model: "claude-test",
    effort: "low",
  });

  expect(result.valid).toBe(true);
  const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
  expect(body).toMatchObject({
    provider: "anthropic",
    model: "claude-test",
    effort: "low",
    reasoning_effort: "low",
    xhandleWorkflow: "functional-vibe-review",
  });
});

