import {
  buildHumanGuidePhraseApplicabilityDecision,
  buildHumanVibeReviewDecision,
  coerceVibeReviewProposal,
  extractVibeReviewProviderText,
  normalizeVibeReviewProposal,
  normalizeGuidePhraseApplicabilityProposal,
  normalizeSafetyClassificationProposal,
  buildHumanSafetyClassificationDecision,
  buildDeterministicClassificationResolutionRepair,
  requestVibeReviewProposal,
} from "./vibeReviewProposal";

test("deterministically repairs Direct to Related only when the intermediate path is already documented", () => {
  const repaired = buildDeterministicClassificationResolutionRepair({
    "Raw Analysis Row ID": "RAW-POLICY",
    "Intermediate Safety Function": "Receive Haulage Mission",
    "Intermediate Safety Effect": "Validates and accepts a mission that can alter active maneuver execution.",
    "Classification Evidence": "The receiver participates between fleet dispatch and vehicle execution.",
  }, ["Safety — Direct cannot depend on an intermediate safety function; classify an established intermediate contribution as Safety — Related."]);
  expect(repaired).toMatchObject({
    normalizedDecision: "Safety — Related",
    "Safety Classification": "Safety — Related",
    "Safety Classification Rule": "R1",
    "Causal Path Type": "Contributory",
  });
  expect(buildDeterministicClassificationResolutionRepair({
    "Intermediate Safety Function": "Receive Haulage Mission",
  }, ["Safety — Direct cannot depend on an intermediate safety function."])).toBeNull();
  expect(buildDeterministicClassificationResolutionRepair({
    "Intermediate Safety Function": "None identified in row evidence",
    "Intermediate Safety Effect": "None credited",
  }, ["Safety — Direct cannot depend on an intermediate safety function."])).toBeNull();
});

test("deterministically repairs Related to Direct when absence sentinels document no intermediate path", () => {
  const repaired = buildDeterministicClassificationResolutionRepair({
    "Raw Analysis Row ID": "RAW-DIRECT",
    "Safety Classification": "Safety — Related",
    "Causal Effect": "Late mission intent interrupts the active lane-change trajectory.",
    "Resulting System State": "The vehicle remains partially across the lane boundary near adjacent traffic.",
    "Intermediate Safety Function": "None identified",
    "Intermediate Safety Effect": "None identified",
    Hazard: "Unsafe lane occupancy can lead to collision.",
    Loss: "Injury or property damage from collision.",
    "Classification Evidence": "The documented path reaches unsafe occupancy without an intervening response.",
  }, [
    "Safety — Related requires a named intermediate safety function, control, barrier, or response.",
    "Safety — Related requires the effect on the intermediate safety function.",
  ]);
  expect(repaired).toMatchObject({
    normalizedDecision: "Safety — Direct",
    "Safety Classification": "Safety — Direct",
    "Safety Classification Rule": "D1",
    "Causal Path Type": "Direct",
    "Intermediate Safety Function": "",
    "Intermediate Safety Effect": "",
  });
});

test("does not invent a Direct repair without an established harm path", () => {
  expect(buildDeterministicClassificationResolutionRepair({
    "Causal Effect": "A message is delayed.",
    "Resulting System State": "The display is stale.",
    "Intermediate Safety Function": "None identified",
    "Intermediate Safety Effect": "None identified",
  }, ["Safety — Related requires a named intermediate safety function."])).toBeNull();
});

test("rejects a manual Related classification without substantive intermediate evidence", () => {
  expect(() => buildHumanSafetyClassificationDecision({
    classification: "Safety — Related",
    rowFields: {
      "Raw Analysis Row ID": "RAW-RELATED",
      "Guide Phrase Applicable": "Yes",
      "Safety Significant": "Yes",
      "Intermediate Safety Function": "None identified",
      "Intermediate Safety Effect": "None credited",
    },
  })).toThrow(/requires a substantive named intermediate safety function/i);
});

test("governed upstream decisions constrain classification without entering its write set", () => {
  const no = normalizeSafetyClassificationProposal({ normalizedDecision: "Safety — Direct", explanation: "Physical harm wording conflicts." }, {
    "Raw Analysis Row ID": "R-NO", "Guide Phrase Applicable": "Yes", "Safety Significant": "No",
  });
  expect(no.proposal.governedDecision).toMatchObject({ "Safety Classification": "Mission/Reliability", "Causal Path Type": "None" });
  expect(no.proposal.governedDecision).not.toHaveProperty("Safety Significant");
  expect(no.proposal.governedDecision).not.toHaveProperty("Guide Phrase Applicable");
  const na = normalizeSafetyClassificationProposal({ normalizedDecision: "Safety — Related" }, {
    "Raw Analysis Row ID": "R-NA", "Guide Phrase Applicable": "No", "Safety Significant": "Yes",
  });
  expect(na.proposal.governedDecision["Safety Classification"]).toBe("Not Applicable");
});

test("explicit classification selection cannot override governed significance", () => {
  const rowFields = { "Raw Analysis Row ID": "R-1", "Guide Phrase Applicable": "Yes", "Safety Significant": "No",
    "Safety Significance Rationale": "Authoritative human disposition." };
  expect(() => buildHumanSafetyClassificationDecision({ rowFields, classification: "Safety — Direct" })).toThrow(/permit only Mission\/Reliability/i);
  const decision = buildHumanSafetyClassificationDecision({ rowFields, classification: "Mission/Reliability" });
  expect(decision).not.toHaveProperty("Safety Significant");
  expect(decision).not.toHaveProperty("Safety Significance Rationale");
});

test("protection-only uncertainty does not withhold an otherwise established safety classification", () => {
  const rowFields = {
    "Raw Analysis Row ID": "RAW-0DKV2D2",
    "Function (From)": "Report Vehicle Status",
    "Control Action": "Vehicle Status Report",
    "Function (To)": "Manage Fleet Missions",
    "Guide Phrase": "Providing the control action causes a hazard",
    "Guide Phrase Applicable": "Yes",
    "Safety Significant": "Yes",
    Loss: "Collision causing physical harm.",
    Hazard: "An unsafe fleet command reaches the vehicle during a lateral transition.",
    "Causal Scenario": "Invalid status causes fleet mission management to issue an incompatible command during the maneuver.",
    "Causal Effect": "Manage Fleet Missions reasons from invalid vehicle status and issues an incompatible fleet command.",
    "Resulting System State": "The vehicle receives a command inconsistent with its current lateral-transition state.",
    "Protection Assessment": "Onboard arbitration may cross-check the command, but its existence and effectiveness are unconfirmed.",
    "Protection Status": "Unknown",
  };
  const result = normalizeSafetyClassificationProposal({
    normalizedDecision: "Needs Review",
    "Safety Classification Rule": "U2",
    "Causal Path Type": "Uncertain",
    "Causal Effect": rowFields["Causal Effect"],
    "Resulting System State": rowFields["Resulting System State"],
    "Protection Assessment": rowFields["Protection Assessment"],
    "Protection Status": "Unknown",
    "Classification Evidence": "The invalid report can drive an incompatible command into the active maneuver.",
    remainingEvidenceGap: "Whether onboard command arbitration validates incoming fleet commands is unconfirmed; this affects protection status only and does not unresolve the causal classification.",
  }, rowFields);
  expect(result.valid).toBe(true);
  expect(result.proposal.governedDecision).toMatchObject({
    "Safety Classification": "Safety — Direct",
    "Causal Path Type": "Direct",
  });
  expect(result.evidenceGap).toMatch(/protection status only/i);
});

test("material causal uncertainty still withholds a classification", () => {
  const result = normalizeSafetyClassificationProposal({
    normalizedDecision: "Needs Review",
    remainingEvidenceGap: "It is unknown whether the receiver can issue any command that affects vehicle motion.",
  }, {
    "Raw Analysis Row ID": "RAW-GAP",
    "Guide Phrase Applicable": "Yes",
    "Safety Significant": "Yes",
  });
  expect(result.valid).toBe(false);
  expect(result.proposal.governedDecision).toBeNull();
});

test("reclassifies a direct proposal with a named intermediate safety function as Safety — Related", () => {
  const rowFields = {
    "Raw Analysis Row ID": "RAW-FLEET",
    "Guide Phrase Applicable": "Yes",
    "Safety Significant": "Needs Review",
    Loss: "Collision causing physical harm.",
    Hazard: "An incompatible command alters the active vehicle trajectory.",
    "Causal Scenario": "Invalid fleet status leads to a conflicting command during a lane change.",
    "Protection Assessment": "Arbitration effectiveness is unknown and is not credited.",
  };
  const result = normalizeVibeReviewProposal({
    normalizedDecision: "Safety — Direct",
    "Safety Classification Rule": "D1",
    "Causal Path Type": "Direct",
    "Causal Effect": "Manage Fleet Missions issues a command that conflicts with the active maneuver.",
    "Resulting System State": "The conflicting command reaches onboard command arbitration during active lateral motion.",
    "Intermediate Safety Function": "Onboard command arbitration",
    "Intermediate Safety Effect": "If accepted without a maneuver-state cross-check, the command causes an unsafe trajectory alteration.",
    "Protection Assessment": "Arbitration effectiveness is unknown and is not credited.",
    "Protection Status": "Unknown",
    "Classification Evidence": "The conflicting command propagates through the named arbitration function toward physical harm.",
    "Safety Significance Rationale": "The causal path to collision is established; protection uncertainty remains separate.",
    "Classification Confidence": "Medium",
  }, rowFields);
  expect(result.valid).toBe(true);
  expect(result.proposal.governedDecision).toMatchObject({
    "Safety Classification": "Safety — Related",
    "Causal Path Type": "Contributory",
    "Intermediate Safety Function": "Onboard command arbitration",
  });
});

const applicabilityRow = {
  "Raw Analysis Row ID": "RAW-APP-1",
  "Function (From)": "Classify Objects",
  "Function (From) Details": "Produces classified detections from current sensor observations.",
  "Control Action": "Classified Object Detections",
  "Control Action Details": "Provides classified objects and confidence to sensor fusion.",
  "Function (To)": "Fuse Sensor Detections",
  "Function (To) Details": "Uses classifications to maintain fused tracks.",
  "Guide Phrase": "The control action is provided too early",
  "Guide Phrase Applicable": "Needs Review",
  "Operational Scenario": "Dense urban traffic with pedestrians crossing unpredictably.",
};

test("accepts a Guide Phrase Applicable Yes while retaining a missing contract as a downstream evidence gap", () => {
  const result = normalizeGuidePhraseApplicabilityProposal({
    applicabilityDecision: "Yes",
    explanation: "A provisional classification can reach fusion before validation completes.",
    applicabilityMechanism: "Sensor fusion can incorporate a provisional class into a fused track before validation completes.",
    "Guide Phrase Applicability Rationale": "Early provisional classified detections can affect the receiver's fused track state.",
    "Classification Confidence": "Medium",
    remainingEvidenceGap: "The exact classification acceptance and validity contract is not documented.",
  }, applicabilityRow);
  expect(result.valid).toBe(true);
  expect(result.proposal.governedDecision).toEqual({
    "Guide Phrase Applicable": "Yes",
    "Guide Phrase Applicability Rationale": "Early provisional classified detections can affect the receiver's fused track state.",
  });
  expect(result.evidenceGap).toMatch(/acceptance and validity contract/i);
});

test("rejects a Guide Phrase Applicable No that only cites missing contract evidence", () => {
  const result = normalizeGuidePhraseApplicabilityProposal({
    applicabilityDecision: "No",
    explanation: "No contract was supplied.",
    "Guide Phrase Applicability Rationale": "The timing contract is unknown.",
  }, applicabilityRow);
  expect(result.valid).toBe(false);
  expect(result.errors.join(" ")).toMatch(/grounded non-applicability proof/i);
});

test("requires a human No applicability override to explain why the deviation cannot affect the receiver", () => {
  expect(() => buildHumanGuidePhraseApplicabilityDecision({
    rowFields: applicabilityRow,
    proposal: {},
    applicable: "No",
  })).toThrow(/no — because/i);
  expect(buildHumanGuidePhraseApplicabilityDecision({
    rowFields: applicabilityRow,
    proposal: {},
    applicable: "No",
    userFeedback: "The receiver accepts only finalized snapshots and cannot observe provisional classifications.",
  })["Guide Phrase Applicable"]).toBe("No");
});

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

test("does not treat an unconfirmed safeguard as a blocker to a grounded Related path", async () => {
  const originalFetch = global.fetch;
  const rowFields = {
    "Raw Analysis Row ID": "RAW-HEALTH-1",
    "Function (From)": "Monitor Vehicle Health",
    "Control Action": "Vehicle Health Assessment",
    "Function (To)": "Manage Operating Readiness",
    "Guide Phrase": "The control action is stopped too soon",
    "Guide Phrase Applicable": "Yes",
    "Safety Classification Rule": "U4",
    "Causal Effect": "Readiness management continues using stale vehicle-health information.",
    "Resulting System State": "The vehicle continues an automated lane change with degraded actuation capability.",
    "Intermediate Safety Function": "Manage Operating Readiness motion inhibit",
    "Intermediate Safety Effect": "The inhibit is not issued while stale health data remains accepted.",
    "Protection Assessment": "No confirmed independent absence-detection timeout is documented.",
    "Protection Status": "Unknown",
    Hazard: "Loss of vehicle control during an automated lane change.",
    Loss: "Collision causing injury to occupants or nearby road users.",
    "Causal Scenario": "Health updates stop and a subsequent actuator fault is not reflected before motion authorization continues.",
  };
  const first = {
    normalizedDecision: "Needs Review",
    "Safety Classification Rule": "U4",
    "Causal Path Type": "Uncertain",
    "Protection Status": "Unknown",
    remainingEvidenceGap: "No evidence confirms whether an absence-detection timeout exists.",
  };
  const corrected = {
    normalizedDecision: "Safety — Related",
    "Safety Classification Rule": "R2",
    "Causal Path Type": "Contributory",
    "Causal Effect": rowFields["Causal Effect"],
    "Resulting System State": rowFields["Resulting System State"],
    "Intermediate Safety Function": rowFields["Intermediate Safety Function"],
    "Intermediate Safety Effect": rowFields["Intermediate Safety Effect"],
    "Protection Assessment": rowFields["Protection Assessment"],
    "Protection Status": "Unknown",
    "Classification Evidence": "The stopped health stream can prevent the readiness inhibit and contribute to collision.",
    "Safety Significance Rationale": "The row establishes a contributory path to physical harm; the unconfirmed timeout is not credited.",
    remainingEvidenceGap: "Whether an independent timeout exists remains unconfirmed.",
  };
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(first) } }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(corrected) } }] }) });
  try {
    const headers = Object.keys(rowFields);
    const result = await requestVibeReviewProposal({
      headers,
      row: headers.map((header) => rowFields[header]),
      projectName: "Autonomous vehicle",
      provider: "claude",
      model: "test",
      effort: "medium",
    });
    expect(result.valid).toBe(true);
    expect(result.proposal.governedDecision).toMatchObject({
      "Safety Classification": "Safety — Related",
      "Safety Significant": "Yes",
      "Protection Status": "Unknown",
    });
    expect(global.fetch.mock.calls[0][1].body).toMatch(/does not invalidate an otherwise complete/i);
    expect(global.fetch.mock.calls[1][1].body).toMatch(/unconfirmed safeguard cannot block/i);
    expect(global.fetch.mock.calls[1][1].body).toMatch(/do not require proof that no safeguard exists/i);
  } finally {
    global.fetch = originalFetch;
  }
});
