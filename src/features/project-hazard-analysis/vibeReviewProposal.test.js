import {
  buildHumanVibeReviewDecision,
  coerceVibeReviewProposal,
  extractVibeReviewProviderText,
  normalizeVibeReviewProposal,
  requestVibeReviewProposal,
} from "./vibeReviewProposal";

test("turns an explicit reviewer Yes into an auditable Related disposition without inventing evidence", () => {
  const decision = buildHumanVibeReviewDecision({
    significance: "Yes",
    rowFields: {
      "Raw Analysis Row ID": "ROW-1",
      "Safety Classification": "Needs Review",
      "Safety Significance Rationale": "Safety — Related requires a traceable contributory path to physical harm.",
      "Causal Effect": "The world model accepts an unsettled pose estimate.",
      "Resulting System State": "The planned approach is offset from the rack slot.",
      "Protection Status": "Unknown",
    },
  });
  expect(decision).toMatchObject({
    normalizedDecision: "Safety — Related",
    humanAdjudication: true,
    "Safety Significant": "Yes",
    "Classification Confidence": "Low",
  });
  expect(decision["Safety Significance Rationale"]).toMatch(/Human-directed Vibe Review decision/i);
  expect(decision["Safety Significance Rationale"]).toMatch(/does not claim that missing architecture evidence was established/i);
  expect(decision["Intermediate Safety Function"]).toBe("");
});

test("turns an explicit reviewer No into a Mission disposition and preserves the unresolved basis", () => {
  const decision = buildHumanVibeReviewDecision({
    significance: "No",
    userFeedback: "The effect terminates at a passive operator display.",
    rowFields: {
      "Raw Analysis Row ID": "ROW-2",
      "Safety Classification": "Needs Review",
      "Safety Significance Rationale": "The physical-harm boundary was not confirmed.",
      "Guide Phrase Applicable": "Yes",
    },
  });
  expect(decision).toMatchObject({
    normalizedDecision: "Mission/Reliability",
    humanAdjudication: true,
    "Safety Significant": "No",
    "Classification Confidence": "Medium",
  });
  expect(decision["Classification Evidence"]).toMatch(/Reviewer-supplied rationale/i);
});

test.each([
  [{ choices: [{ message: { content: '{"normalizedDecision":"Mission/Reliability"}' } }] }],
  [{ content: [{ type: "text", text: '{"normalizedDecision":"Mission/Reliability"}' }] }],
  [{ candidates: [{ content: { parts: [{ text: '{"normalizedDecision":"Mission/Reliability"}' }] } }] }],
])("extracts OpenAI, Anthropic, and Gemini wrappers", (wrapper) => {
  expect(extractVibeReviewProviderText(wrapper)).toContain("Mission/Reliability");
});

test("rejects contradictory/incomplete proposals without forcing mutation", () => {
  const result = normalizeVibeReviewProposal({ normalizedDecision: "Safety — Related", "Classification Evidence": "Possible contribution." }, { "Raw Analysis Row ID": "r1", "Safety Classification Rule": "U4" });
  expect(result.valid).toBe(false);
  expect(result.errors.join(" ")).toMatch(/contributory path/i);
});

test("normalizes an evidence-grounded Mission decision atomically", () => {
  const result = normalizeVibeReviewProposal({ normalizedDecision: "Mission/Reliability", "Classification Evidence": "Effect remains in reporting.", "Physical-Harm Chain Termination": "No command authority or physical actuation path leaves reporting.", "Classification Confidence": "high" }, { "Raw Analysis Row ID": "r1", "Safety Classification Rule": "U4" }, "No");
  expect(result.valid).toBe(true);
  expect(result.proposal.governedDecision).toMatchObject({ "Safety Classification": "Mission/Reliability", "Safety Significant": "No", "Causal Path Type": "None" });
});

test("rejects a Mission proposal that credits an assumed, unverified protection against an asserted harm path", () => {
  const result = normalizeVibeReviewProposal({
    normalizedDecision: "Mission/Reliability",
    "Classification Evidence": "Obstacle avoidance is assumed to remain current and independent.",
    "Protection Assessment": "A separately maintained obstacle track list is assumed current.",
    "Protection Status": "Unknown",
    "Physical-Harm Chain Termination": "The chain terminates because obstacle avoidance is assumed current.",
    "Safety Significance Rationale": "The result is confined to target-acquisition failure.",
  }, {
    "Raw Analysis Row ID": "RAW-0QHHSOD",
    "Function (From)": "Detect Target Tote and Rack",
    "Control Action": "Target Detection",
    "Function (To)": "Maintain Local World Model",
    "Guide Phrase": "Not providing the control action causes a hazard",
    "Guide Phrase Applicable": "Yes",
    "Safety Classification Rule": "U4",
    "Causal Effect": "The world model lacks current target data.",
    "Resulting System State": "The planner may commit a misdirected approach.",
    "Protection Assessment": "Obstacle-track independence and effectiveness are unconfirmed.",
    "Protection Status": "Unknown",
    "Classification Evidence": "The backstop may share sensors, compute, or timing with the failed perception path.",
    "Safety Significance Rationale": "The chain toward L2 rack or tote contact remains open because protection independence is unproven.",
    Hazard: "The robot may enter unsafe proximity to equipment.",
    Loss: "Physical property damage.",
  });
  expect(result.valid).toBe(false);
  expect(result.errors.join(" ")).toMatch(/Mission\/Reliability contradicts an asserted L1-L3 or physical-harm path/i);
  expect(result.proposal.governedDecision).toMatchObject({
    "Safety Classification": "Needs Review",
    "Safety Significant": "Needs Review",
    "Classification Confidence": "Low",
  });
});

test.each([
  [{ "Safety Classification": "Mission/Reliability" }, "Mission/Reliability"],
  [{ assessment: { safetyClassification: "Safety — Direct" } }, "Safety — Direct"],
  [[{ normalized_decision: "Needs Review" }], "Needs Review"],
  [{ review: { decision: "Not Applicable" } }, "Not Applicable"],
])("coerces provider-neutral decision aliases and wrappers", (value, expected) => {
  expect(coerceVibeReviewProposal(value).normalizedDecision).toBe(expected);
});

test("repairs a provider response that omitted normalizedDecision", async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"explanation":"Passive reporting effect."}' } }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      normalizedDecision: "Mission/Reliability",
      "Classification Evidence": "The effect remains inside a passive reporting boundary.",
      "Physical-Harm Chain Termination": "The reporting receiver has no command or physical actuation authority.",
    }) } }] }) });
  try {
    const result = await requestVibeReviewProposal({
      headers: ["Raw Analysis Row ID", "Safety Classification Rule"],
      row: ["ROW-1", "U4"],
      projectName: "Test",
      provider: "claude",
      model: "test-model",
      effort: "low",
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.valid).toBe(true);
    expect(result.proposal.normalizedDecision).toBe("Mission/Reliability");
  } finally {
    global.fetch = originalFetch;
  }
});

test("runs one policy-correction pass when a provider improperly credits an assumed protection", async () => {
  const originalFetch = global.fetch;
  const rowFields = {
    "Raw Analysis Row ID": "RAW-0QHHSOD",
    "Function (From)": "Detect Target Tote and Rack",
    "Control Action": "Target Detection",
    "Function (To)": "Maintain Local World Model",
    "Guide Phrase": "Not providing the control action causes a hazard",
    "Guide Phrase Applicable": "Yes",
    "Safety Classification Rule": "U4",
    "Causal Effect": "The world model lacks current target data.",
    "Resulting System State": "The planner may commit a misdirected approach.",
    "Protection Assessment": "Obstacle-track independence is unconfirmed.",
    "Protection Status": "Unknown",
    "Classification Evidence": "The backstop may share sensors and compute with the failed perception path.",
    "Safety Significance Rationale": "The chain toward L2 contact remains open because protection independence is unproven.",
    Hazard: "The robot may enter unsafe proximity to equipment.",
    Loss: "Physical property damage.",
  };
  const headers = Object.keys(rowFields);
  const row = headers.map((header) => rowFields[header]);
  const wrong = {
    normalizedDecision: "Mission/Reliability",
    "Classification Evidence": "Obstacle avoidance is assumed current.",
    "Protection Assessment": "The separately maintained obstacle list is assumed current.",
    "Protection Status": "Unknown",
    "Physical-Harm Chain Termination": "The chain terminates because obstacle avoidance is assumed current.",
  };
  const corrected = {
    normalizedDecision: "Safety — Related",
    "Safety Classification Rule": "R2",
    "Causal Path Type": "Contributory",
    "Causal Effect": "Missing target data can leave an unflagged stale target pose in the world model.",
    "Resulting System State": "The planner may commit a misdirected approach path.",
    "Intermediate Safety Function": "Independent obstacle and pedestrian avoidance",
    "Intermediate Safety Effect": "Unconfirmed independence means the protective response may be unavailable for the same failure.",
    "Protection Assessment": "Independence and effectiveness are unconfirmed and are not credited.",
    "Protection Status": "Unknown",
    "Classification Evidence": "The open misdirected-approach path can contribute to unsafe proximity or physical contact.",
    "Safety Significance Rationale": "The row has a contributory physical-harm path with an uncredited protective backstop.",
  };
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(wrong) } }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(corrected) } }] }) });
  try {
    const result = await requestVibeReviewProposal({ headers, row, projectName: "Warehouse robot", provider: "claude", model: "test", effort: "medium" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.valid).toBe(true);
    expect(result.proposal.governedDecision).toMatchObject({
      "Safety Classification": "Safety — Related",
      "Safety Significant": "Yes",
    });
    expect(global.fetch.mock.calls[1][1].body).toMatch(/failed these policy checks/i);
  } finally {
    global.fetch = originalFetch;
  }
});
