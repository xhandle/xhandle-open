import {
  applyNeedsReviewResolutionUpdates,
  buildNeedsReviewResolutionGroups,
  draftNeedsReviewAnswerWithAI,
  extractNeedsReviewRows,
  normalizeNeedsReviewClassificationDecision,
  resolveNeedsReviewGroupWithAI,
  stakeholderAnswerEstablishesEvidence,
} from "./needsReviewResolver";

const headers = [
  "Raw Analysis Row ID", "Function (From)", "Control Action", "Function (To)", "Operational Scenario", "Operational Mode", "Guide Phrase",
  "Safety Classification", "Safety Classification Rule", "Causal Path Type", "Protection Status", "Safety Significant",
  "Proposed Safety Assessment", "Classification Evidence",
];

const row = ({ id = "ROW-1", from = "Planner", action = "Route", to = "Controller", scenario = "Travel", mode = "Autonomous", guide = "Too late", classification = "Needs Review", rule = "U3" } = {}) => [
  id, from, action, to, scenario, mode, guide, classification, rule,
  classification === "Needs Review" ? "Uncertain" : "Direct",
  "Unknown",
  classification === "Needs Review" ? "Needs Review" : "Yes",
  classification === "Needs Review" ? "Mission/Reliability" : "Safety",
  "Timing contract is unknown",
];

describe("Needs Review resolver", () => {
  const canonical = (normalizedDecision, fields = {}) => normalizeNeedsReviewClassificationDecision({
    normalizedDecision,
    "Classification Evidence": "Architecture evidence establishes this row-specific decision.",
    ...fields,
  }).decision;

  test.each([
    ["Safety — Direct", { "Causal Effect": "Deviation reaches the actuator.", "Resulting System State": "Uncontrolled motion can cause physical harm." }, "Safety", "Direct", "Yes", "D"],
    ["Safety — Related", { "Causal Effect": "Feedback is lost.", "Resulting System State": "Protective action is unavailable before physical harm.", "Intermediate Safety Function": "Independent trip function", "Intermediate Safety Effect": "The trip cannot initiate." }, "Safety", "Contributory", "Yes", "R"],
    ["Mission/Reliability", { "Physical-Harm Chain Termination": "The output ends at a reporting-only archive with no control authority." }, "Mission/Reliability", "None", "No", "M"],
    ["Not Applicable", { "Guide Phrase Applicable": "No" }, "Mission/Reliability", "None", "No", "N"],
  ])("atomically normalizes the %s decision", (classification, fields, assessment, path, significant, ruleFamily) => {
    const decision = canonical(classification, fields);
    expect(decision).toMatchObject({
      "Safety Classification": classification,
      "Proposed Safety Assessment": assessment,
      "Causal Path Type": path,
      "Safety Significant": significant,
    });
    expect(decision["Safety Classification Rule"]).toMatch(new RegExp(`^${ruleFamily}`));
  });

  test("requires a named material gap for Needs Review", () => {
    const invalid = normalizeNeedsReviewClassificationDecision({ normalizedDecision: "Needs Review", "Classification Evidence": "Still uncertain." });
    expect(invalid.errors.join(" ")).toMatch(/named material evidence gap/i);
    const valid = normalizeNeedsReviewClassificationDecision({ normalizedDecision: "Needs Review", "Classification Evidence": "Interface evidence is incomplete.", remainingEvidenceGap: "Receiver fail-safe behavior in maintenance mode" });
    expect(valid.errors).toEqual([]);
    expect(valid.decision["Safety Classification"]).toBe("Needs Review");
  });

  test("treats confirmed absence of a safeguard as evidence, not an automatic review decision", () => {
    const decision = canonical("Safety — Direct", {
      "Causal Effect": "The deviation commands hazardous energy release.",
      "Resulting System State": "Exposed people can suffer physical harm.",
      "Protection Status": "Absent",
      "Protection Assessment": "No safeguard or interlock is documented for this operating mode.",
    });
    expect(decision["Safety Classification"]).toBe("Safety — Direct");
    expect(decision["Protection Status"]).toBe("Absent");
  });
  test("distinguishes unknown or undocumented answers from affirmative evidence", () => {
    expect(stakeholderAnswerEstablishesEvidence("Not documented in the available architecture; status is unknown.")).toBe(false);
    expect(stakeholderAnswerEstablishesEvidence("The receiver rejects records whose version does not match the active configuration.")).toBe(true);
  });
  test("clusters unresolved rows into reusable governed questions", () => {
    const summary = [headers, row(), row({ id: "ROW-2", action: "Brake demand", rule: "U2" }), row({ classification: "Safety — Direct", rule: "D1" })];
    const groups = buildNeedsReviewResolutionGroups(summary, {});
    expect(groups.map((group) => group.id)).toEqual(["U2", "U3"]);
    expect(groups.find((group) => group.id === "U3").affectedRowIndexes).toEqual([1]);
    expect(extractNeedsReviewRows(summary)).toHaveLength(2);
  });

  test("marks retained answers stale when the affected scope changes", () => {
    const first = buildNeedsReviewResolutionGroups([headers, row()], {});
    const saved = { U3: { answer: "Frames expire at the configured validity boundary.", scopeSignature: first[0].scopeSignature } };
    expect(buildNeedsReviewResolutionGroups([headers, row()], saved)[0].scopeChanged).toBe(false);
    expect(buildNeedsReviewResolutionGroups([headers, row({ action: "Updated route" })], saved)[0].scopeChanged).toBe(true);
  });

  test("updates only allowed classification fields and enforces a coherent rollup", () => {
    const summary = [headers, row(), row({ id: "ROW-2", action: "Other", rule: "U2" })];
    const result = applyNeedsReviewResolutionUpdates(summary, [{
      sourceRowId: "ROW-1", normalizedDecision: "Safety — Related",
      "Function (From)": "Injected identity",
      "Safety Classification": "Safety — Related",
      "Safety Classification Rule": "U3",
      "Causal Path Type": "Direct",
      "Causal Effect": "The monitor loses the confirmed status input.",
      "Resulting System State": "The protective response is unavailable on demand.",
      "Intermediate Safety Function": "Protective status monitor",
      "Intermediate Safety Effect": "The monitor cannot initiate the required protective response.",
      "Protection Status": "Absent",
      "Classification Evidence": "The stakeholder confirmed the monitor dependency.",
    }], ["ROW-1"]);
    expect(result.updatedRowIndexes).toEqual([1]);
    expect(result.summary[1][1]).toBe("Planner");
    expect(result.summary[1][7]).toBe("Safety — Related");
    expect(result.summary[1][8]).toBe("R1");
    expect(result.summary[1][9]).toBe("Contributory");
    expect(result.summary[1][11]).toBe("Yes");
    expect(result.summary[1][12]).toBe("Safety");
    expect(result.summary[2].slice(0, summary[2].length)).toEqual(summary[2]);
    expect(result.summary[0].at(-1)).toBe("Classification Resolution Status");
  });

  test("ignores updates outside the selected question scope", () => {
    const summary = [headers, row(), row({ id: "ROW-2", action: "Other" })];
    const result = applyNeedsReviewResolutionUpdates(summary, [{ sourceRowId: "ROW-2", normalizedDecision: "Mission/Reliability", "Safety Classification": "Mission/Reliability" }], ["ROW-1"]);
    expect(result.updatedRowIndexes).toEqual([]);
    expect(result.rejectedUpdates).toHaveLength(1);
    expect(result.summary).toEqual(summary);
  });

  test("resolves a complete direct harm path even when independent protection remains unknown", () => {
    const summary = [headers, row()];
    const result = applyNeedsReviewResolutionUpdates(summary, [{
      sourceRowId: "ROW-1", normalizedDecision: "Safety — Direct",
      "Safety Classification": "Safety — Direct",
      "Safety Classification Rule": "D1",
      "Causal Effect": "The controller receives stale route data.",
      "Resulting System State": "The vehicle follows an unsafe path.",
      "Protection Status": "Unknown",
    }], ["ROW-1"]);
    expect(result.summary[1][7]).toBe("Safety — Direct");
    expect(result.summary[1][8]).toBe("D1");
    expect(result.summary[1][9]).toBe("Direct");
    expect(result.summary[1][11]).toBe("Yes");
    expect(result.resolvedRowIndexes).toEqual([1]);
    expect(result.changedRowIndexes).toEqual([1]);
  });

  test("keeps protection status orthogonal to an otherwise supported direct causal path", () => {
    const summary = [headers, row()];
    const result = applyNeedsReviewResolutionUpdates(summary, [{
      sourceRowId: "ROW-1", normalizedDecision: "Safety — Direct",
      "Safety Classification": "Safety — Direct",
      "Safety Classification Rule": "D1",
      "Causal Effect": "The controller receives stale route data.",
      "Resulting System State": "The vehicle follows an unsafe path.",
      "Protection Status": "Effective",
    }], ["ROW-1"]);
    expect(result.summary[1][7]).toBe("Safety — Direct");
    expect(result.summary[1][8]).toBe("D1");
    expect(result.resolvedRowIndexes).toEqual([1]);
  });

  test("uses existing causal evidence when the model returns a compact classification update", () => {
    const compactHeaders = [...headers, "Causal Effect", "Resulting System State", "Protection Status"];
    const summary = [[...compactHeaders], [
      ...row(),
      "The unsafe command changes receiver behavior.",
      "The controlled process enters a hazardous state.",
      "Unknown",
    ]];
    const result = applyNeedsReviewResolutionUpdates(summary, [{
      sourceRowId: "ROW-1", normalizedDecision: "Safety — Direct",
      "Safety Classification": "Safety — Direct",
      "Safety Classification Rule": "D1",
    }], ["ROW-1"]);
    expect(result.summary[1][7]).toBe("Safety — Direct");
    expect(result.resolvedRowIndexes).toEqual([1]);
  });

  test("applies an explicit human disposition while retaining incomplete-evidence validation notes", () => {
    const completeHeaders = [
      ...headers,
      "Guide Phrase Applicable", "Guide Phrase Applicability Rationale",
      "Causal Effect", "Resulting System State", "Intermediate Safety Function", "Intermediate Safety Effect",
      "Protection Assessment", "Physical-Harm Chain Termination", "Classification Confidence",
      "Safety Significance Rationale", "Proposed Safety Assessment Rationale", "Hazard", "Loss",
    ];
    const base = row();
    const summary = [completeHeaders, [
      ...base,
      "Yes", "The timing deviation is meaningful.",
      "The receiver uses an unsettled estimate.", "The approach path is offset.", "", "",
      "Protection effectiveness is unknown.", "", "Medium",
      "Safety — Related requires more architecture evidence.", "Safety — Related requires more architecture evidence.",
      "The robot may enter unsafe proximity to a person.", "Physical injury.",
    ]];
    const result = applyNeedsReviewResolutionUpdates(summary, [{
      sourceRowId: "ROW-1",
      normalizedDecision: "Safety — Related",
      humanAdjudication: true,
      "Safety Classification": "Safety — Related",
      "Safety Significant": "Yes",
      "Safety Classification Rule": "R1",
      "Causal Path Type": "Contributory",
      "Causal Effect": "The receiver uses an unsettled estimate.",
      "Resulting System State": "The approach path is offset.",
      "Classification Evidence": "Human reviewer disposition: Yes.",
      "Safety Significance Rationale": "Human-directed Vibe Review decision: the reviewer marked Safety Significant = Yes.",
      "Classification Confidence": "Low",
    }], ["ROW-1"], { allowHumanAdjudication: true });
    expect(result.rejectedUpdates).toEqual([]);
    expect(result.resolvedRowIndexes).toEqual([1]);
    const fields = Object.fromEntries(completeHeaders.map((header, index) => [header, result.summary[1][index]]));
    expect(fields["Safety Classification"]).toBe("Safety — Related");
    expect(fields["Safety Significant"]).toBe("Yes");
    expect(fields["Classification Confidence"]).toBe("Low");
    expect(fields["Classification Evidence"]).toMatch(/Human adjudication validation note/i);
    expect(fields["Classification Evidence"]).toMatch(/intermediate safety function/i);
    expect(result.summary[1][result.summary[0].indexOf("Classification Resolution Status")])
      .toBe("Human Disposition — Evidence Gap");
  });

  test("continues to reject an incomplete provider decision without human adjudication", () => {
    const result = applyNeedsReviewResolutionUpdates([headers, row()], [{
      sourceRowId: "ROW-1",
      normalizedDecision: "Safety — Related",
      "Classification Evidence": "Possible contribution.",
    }], ["ROW-1"]);
    expect(result.rejectedUpdates).toHaveLength(1);
    expect(result.resolvedRowIndexes).toEqual([]);
  });

  test("does not let an untrusted provider self-assert human adjudication", () => {
    const result = applyNeedsReviewResolutionUpdates([headers, row()], [{
      sourceRowId: "ROW-1",
      normalizedDecision: "Safety — Related",
      humanAdjudication: true,
      "Classification Evidence": "Possible contribution.",
    }], ["ROW-1"]);
    expect(result.rejectedUpdates).toHaveLength(1);
    expect(result.resolvedRowIndexes).toEqual([]);
  });

  test("turns a provider content-block response with evidence gaps into an editable fallback draft", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: [{
              type: "text",
              text: JSON.stringify({
                evidenceGaps: ["No independent fallback behavior is documented."],
              }),
            }],
          },
        }],
      }),
    });

    try {
      const group = buildNeedsReviewResolutionGroups([headers, row({ rule: "U2" })], {})[0];
      const result = await draftNeedsReviewAnswerWithAI({
        group,
        projectName: "Test project",
        functionalDecomposition: [],
      });

      expect(result.fallback).toBe(true);
      expect(result.answer).toContain("Not established in the available project evidence");
      expect(result.answer).toContain("No independent fallback behavior is documented.");
      const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(requestBody).toEqual(expect.objectContaining({
        provider: expect.any(String),
        model: expect.any(String),
        effort: expect.any(String),
        reasoning_effort: expect.any(String),
        xhandleWorkflow: "hazard-needs-review-evidence-draft",
      }));
      expect(requestBody.reasoning_effort).toBe(requestBody.effort);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("accepts a plain-language provider response when strict JSON is unavailable", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "No credited safeguard is established for the affected mode." } }],
      }),
    });

    try {
      const group = buildNeedsReviewResolutionGroups([headers, row({ rule: "U2" })], {})[0];
      const result = await draftNeedsReviewAnswerWithAI({
        group,
        projectName: "Test project",
        functionalDecomposition: [],
      });

      expect(result.fallback).toBe(false);
      expect(result.answer).toBe("No credited safeguard is established for the affected mode.");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("accepts a root-array update response from a provider", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify([{
          sourceRowId: "ROW-1", normalizedDecision: "Safety — Direct",
          "Safety Classification": "Safety — Direct",
          "Causal Effect": "The receiver acts on stale data.",
          "Resulting System State": "The controlled process enters a hazardous state.",
          "Protection Status": "Unknown",
        }]) } }],
      }),
    });

    try {
      const group = buildNeedsReviewResolutionGroups([headers, row()], {})[0];
      const result = await resolveNeedsReviewGroupWithAI({ group, answer: "The causal path is confirmed." });
      expect(result.updates).toHaveLength(1);
      expect(result.missingRowIds).toEqual([]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test.each([
    ["Anthropic", (text) => ({ content: [{ type: "text", text }] })],
    ["Gemini", (text) => ({ candidates: [{ content: { parts: [{ text }] } }] })],
  ])("accepts %s response wrappers", async (_provider, wrap) => {
    const originalFetch = global.fetch;
    const content = JSON.stringify({ updates: [{
      sourceRowId: "ROW-1",
      normalizedDecision: "Mission/Reliability",
      "Safety Classification": "Mission/Reliability",
      "Classification Evidence": "The effect is confined to a passive report.",
      "Physical-Harm Chain Termination": "The chain ends at a passive reporting boundary with no control authority.",
    }] });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => wrap(content) });
    try {
      const group = buildNeedsReviewResolutionGroups([headers, row()], {})[0];
      const result = await resolveNeedsReviewGroupWithAI({ group, answer: "The architecture confirms a passive reporting boundary." });
      expect(result.updates[0].sourceRowId).toBe("ROW-1");
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("automatically subdivides a malformed batch and recovers valid row updates", async () => {
    const originalFetch = global.fetch;
    const response = (content) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response('{"updates":['))
      .mockResolvedValueOnce(response(JSON.stringify({ updates: [{ sourceRowId: "ROW-1", normalizedDecision: "Mission/Reliability", "Safety Classification": "Mission/Reliability", "Physical-Harm Chain Termination": "The effect terminates at a diagnostic display." }] })))
      .mockResolvedValueOnce(response(JSON.stringify({ updates: [{ sourceRowId: "ROW-2", normalizedDecision: "Safety — Direct", "Safety Classification": "Safety — Direct", "Causal Effect": "Unsafe command reaches the receiver.", "Resulting System State": "The process enters a hazardous state.", "Protection Status": "Unknown" }] })));

    try {
      const group = buildNeedsReviewResolutionGroups([headers, row(), row({ id: "ROW-2", action: "Brake demand" })], {})[0];
      const result = await resolveNeedsReviewGroupWithAI({
        group,
        answer: "The affected behavior has been reviewed.",
        chunkSize: 2,
      });
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(result.updates.map((update) => update.sourceRowId)).toEqual(["ROW-1", "ROW-2"]);
      expect(result.missingRowIds).toEqual([]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("reports completed chunks before a later provider failure", async () => {
    const originalFetch = global.fetch;
    const valid = JSON.stringify({ updates: [{ sourceRowId: "ROW-1", normalizedDecision: "Mission/Reliability", "Classification Evidence": "Passive boundary confirmed.", "Physical-Harm Chain Termination": "The chain ends at a passive display." }] });
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: valid } }] }) })
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "provider unavailable" });
    const completed = [];
    const progress = [];
    try {
      const group = buildNeedsReviewResolutionGroups([headers, row(), row({ id: "ROW-2", action: "Brake demand" })], {})[0];
      await expect(resolveNeedsReviewGroupWithAI({
        group,
        answer: "The architecture behavior is confirmed.",
        chunkSize: 1,
        concurrency: 1,
        onChunk: ({ rowIds }) => completed.push(...rowIds),
        onProgress: (value) => progress.push(value.completedRows),
      })).rejects.toThrow(/503/);
      expect(completed).toEqual(["ROW-1"]);
      expect(progress).toContain(1);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
