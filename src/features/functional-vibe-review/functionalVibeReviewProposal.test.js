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

test("includes the original reviewer instructions in every row proposal", async () => {
  const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      decision: "Keep",
      explanation: "The row is a consequential operational interface.",
      rationale: "The interface contributes to the operational inference path.",
      confidence: "High",
      issues: [],
    }) } }] }),
  });

  await requestFunctionalVibeReviewProposal({
    row,
    rowNumber: 1,
    projectName: "Test",
    reviewFocus: "Hazard Analysis Eligibility = Include",
    reviewInstructions: "Consolidate low-level tensor, geometry, token, and helper calls into their parent operational transformations.",
    provider: "openai",
    model: "test-model",
    effort: "low",
  });

  const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
  expect(body.messages[1].content).toContain("Reviewer instructions:");
  expect(body.messages[1].content).toContain("Consolidate low-level tensor, geometry, token, and helper calls");
});

test("times out a stalled functional review request instead of hanging the session", async () => {
  jest.spyOn(global, "fetch").mockImplementation((url, options = {}) => new Promise((resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    }, { once: true });
  }));

  await expect(requestFunctionalVibeReviewProposal({
    row,
    rowNumber: 1,
    projectName: "Test",
    provider: "anthropic",
    model: "claude-test",
    effort: "low",
    requestTimeoutMs: 5,
  })).rejects.toThrow("Functional vibe review timed out");
});

test("repairs a Lifecycle Phase proposal that keeps Needs Review", async () => {
  const scopedRow = {
    ...row,
    lifecyclePhase: "Needs Review",
    interfaceType: "Data",
    hazardAnalysisEligibility: "Exclude",
    hazardAnalysisEligibilityRationale: "No operational consequence is evidenced.",
  };
  const fetchSpy = jest.spyOn(global, "fetch")
    .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      decision: "Keep",
      explanation: "Keep lifecyclePhase as Needs Review.",
      rationale: "The phase is uncertain.",
      confidence: "High",
      issues: [],
    }) } }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      decision: "Revise",
      explanation: "The relationship constructs configuration metadata.",
      rationale: "The evidenced behavior occurs while configuration is assembled.",
      confidence: "Medium",
      issues: [],
      proposedRow: { ...scopedRow, lifecyclePhase: "Configuration" },
    }) } }] }) });

  const result = await requestFunctionalVibeReviewProposal({
    row: scopedRow,
    rowNumber: 1,
    projectName: "Test",
    reviewFocus: "Lifecycle Phase = Needs Review",
    reviewFields: ["lifecyclePhase"],
    provider: "openai",
    model: "test-model",
    effort: "low",
  });

  expect(fetchSpy).toHaveBeenCalledTimes(2);
  expect(result.valid).toBe(true);
  expect(result.proposal.changedFields).toEqual(["lifecyclePhase"]);
  expect(result.proposal.proposedRow.hazardAnalysisEligibility).toBe("Exclude");
});

test("allows revisions to multiple explicitly requested columns", async () => {
  const scopedRow = {
    ...row,
    lifecyclePhase: "Needs Review",
    interfaceType: "Needs Review",
    hazardAnalysisEligibility: "Exclude",
  };
  jest.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({
      decision: "Revise",
      explanation: "The source evidence shows a configuration data exchange.",
      rationale: "The call occurs while configuration is assembled and passes data.",
      confidence: "Medium",
      issues: [],
      proposedRow: { ...scopedRow, lifecyclePhase: "Configuration", interfaceType: "Data" },
    }) } }] }),
  });

  const result = await requestFunctionalVibeReviewProposal({
    row: scopedRow,
    rowNumber: 1,
    projectName: "Test",
    reviewFocus: "Lifecycle Phase = Needs Review; Interface Type = Needs Review",
    reviewFields: ["lifecyclePhase", "interfaceType"],
    provider: "openai",
    model: "test-model",
    effort: "low",
  });

  expect(result.valid).toBe(true);
  expect(result.proposal.changedFields).toEqual(["lifecyclePhase", "interfaceType"]);
  expect(result.proposal.proposedRow.hazardAnalysisEligibility).toBe("Exclude");
});
