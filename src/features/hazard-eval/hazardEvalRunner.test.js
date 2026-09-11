import {
  HAZARD_ANALYSIS_STAGE_KEYS,
  generateStandardCodeHazardAnalysisSheets,
} from "../../components/aiAnalysisCodeHazardStandard";
import { fetchLLMResponse } from "../../components/aiAnalysisSTPA";
import {
  CassetteMissError,
  cassetteKey,
  createCassetteTransport,
  createEmptyCassette,
  createScriptedTransport,
  hashPrompt,
} from "./hazardEvalCassette";
import {
  assertFixtureItemIds,
  buildFixtureSheets,
  formatHazardEvalSummary,
  runHazardEvalFixture,
  runHazardEvalSuite,
  sheetToRows,
} from "./hazardEvalRunner";

jest.mock("../../components/aiAnalysisSTPA", () => ({
  fetchLLMResponse: jest.fn(),
  getHazardAnalysisRequestTimeoutMs: jest.fn(() => 1000),
}));

// Both items use the same guide phrase and both cite a verbatim context
// excerpt, so both clear the pipeline's structural evidence gate. Only the
// engineering judgment separates them: FD-1's receiver has no independent stop
// capability, while FD-2's actuator reaches its fail-safe position with no
// command at all. That is exactly the distinction the harness has to measure,
// because no structural check can make it.
const STOP_ASSUMPTION = "The actuator has no independent stop capability.";
const FAIL_SAFE_ASSUMPTION = "On loss of controller power the brake actuator reverts to its mechanically applied fail-safe position with no controller command required.";
const STOP_EXCERPT = "no independent stop capability";
const FAIL_SAFE_EXCERPT = "reverts to its mechanically applied fail-safe position";

const smallFixture = {
  fixtureId: "runner-fixture-001",
  domain: "test",
  labelStatus: "proposed",
  operationalContext: "Test system operating in two contexts.",
  organizationContext: "",
  canonicalHazards: [{ id: "H-1", title: "Receiver enters an uncontrolled state" }],
  items: [
    {
      id: "FD-1",
      from: "Controller",
      fromDetails: "Sole stop authority.",
      controlAction: "Stop command",
      controlActionDetails: "Discrete stop command issued on demand.",
      to: "Actuator",
      toDetails: "Executes the stop command.",
      operationalContextId: "CTX-1",
      operationalScenario: "Nominal operation",
      operationalMode: "Running",
      operatingConditions: "All subsystems powered",
      contextAssumptions: STOP_ASSUMPTION,
      guidePhrase: "Not providing the control action causes a hazard",
      expected: {
        applicable: "yes",
        rationale: "The controller is the sole stop authority and the actuator cannot stop itself.",
        safetySignificant: "yes",
        canonicalHazardId: "H-1",
        forbiddenRequirementClaims: [],
      },
    },
    {
      id: "FD-2",
      from: "Brake Controller",
      fromDetails: "Pressure authority.",
      controlAction: "Brake pressure command",
      controlActionDetails: "Commanded hydraulic pressure setpoint.",
      to: "Brake Actuator",
      toDetails: "Applies pressure; reverts mechanically on power loss.",
      operationalContextId: "CTX-2",
      operationalScenario: "Controller power loss",
      operationalMode: "Degraded",
      operatingConditions: "Controller supply voltage lost",
      contextAssumptions: FAIL_SAFE_ASSUMPTION,
      guidePhrase: "Not providing the control action causes a hazard",
      expected: {
        applicable: "no",
        rationale: "The actuator reaches its fail-safe position without any controller command.",
        safetySignificant: null,
        canonicalHazardId: null,
        forbiddenRequirementClaims: ["shall command brake application on power loss"],
      },
    },
  ],
};

const generatedRow = (id, overrides = {}) => ({
  id,
  guidePhraseApplicable: "Yes",
  losses: "Loss of controlled shutdown.",
  hazards: "The actuator continues to run and the receiver enters an uncontrolled state.",
  unsafeControlActions: "The command is not provided when it is required.",
  causalScenario: "The controller's process model shows the actuator already stopped.",
  causalFactors: "Stale actuator state feedback.",
  causalFactorCategory: "Controller logic / process model",
  mitigationStrategy: "The Controller shall cross-check actuator state before suppressing a command.",
  safetyRequirementsConstraints: "The system shall not suppress a required command.",
  systemRequirement: "The Controller shall issue the command when it is required, verified by bench test.",
  requirementParameterSource: "TBD",
  ...overrides,
});

// The audit stage — not generation — is where applicability is adjudicated, so
// a run is steered by scripting its tags.
const applicableTag = (id, evidenceQuote, overrides = {}) => ({
  id,
  guidePhraseApplicable: "Yes",
  applicabilityEvidenceField: "Context Assumptions",
  applicabilityEvidenceQuote: evidenceQuote,
  applicabilityMechanism: "The command becomes absent and the receiver cannot reach the commanded state on its own.",
  semanticMeaningful: "Yes",
  receiverCanBeAffected: "Yes",
  contextSupportsMechanism: "Yes",
  adverseStateSupported: "Yes",
  proposedSafetyAssessment: "Safety",
  proposedSafetyAssessmentRationale: "Uncontrolled actuator motion is a credible physical harm path.",
  safetySignificant: "Yes",
  safetySignificanceRationale: "Direct safety control with a physical harm path.",
  safetyEvidenceField: "Context Assumptions",
  safetyEvidenceQuote: evidenceQuote,
  safetyExposureCategory: "People",
  safetyExposurePath: "Uncontrolled actuator motion exposes nearby personnel to moving machinery.",
  safetyContributionType: "Direct safety control",
  causalNecessitySupported: "Yes",
  additionalFailureRequired: "No",
  safeguardPrecludesPath: "No",
  ...overrides,
});

const notApplicableTag = (id, evidenceQuote) => ({
  id,
  guidePhraseApplicable: "No",
  notApplicableReasonCode: "Architecture precludes deviation",
  strongestReasonForNo: "the actuator reaches its mechanically applied fail-safe position without any controller command",
  notApplicableEvidenceField: "Context Assumptions",
  notApplicableEvidenceQuote: evidenceQuote,
  semanticMeaningful: "Yes",
  receiverCanBeAffected: "No",
  contextSupportsMechanism: "No",
  adverseStateSupported: "No",
  proposedSafetyAssessment: "Mission/Reliability",
  proposedSafetyAssessmentRationale: "Not applicable in this context.",
  safetySignificant: "Needs Review",
  safetySignificanceRationale: "Not applicable in this context.",
});

function scriptedRun(auditTags, rowOverrides = {}) {
  return createScriptedTransport({
    "hazard-row-generation": [JSON.stringify([
      generatedRow("FD-1-STPA", rowOverrides.first),
      generatedRow("FD-2-STPA", rowOverrides.second),
    ])],
    "hazard-safety-audit": [JSON.stringify(auditTags)],
  }, { fallback: async () => "[]" });
}

function runWithTransport(transport, fixture = smallFixture) {
  fetchLLMResponse.mockImplementation(transport);
  return runHazardEvalFixture({
    fixture,
    method: "STPA",
    generate: generateStandardCodeHazardAnalysisSheets,
    provider: "openai",
  });
}

// The scripted transport deliberately returns an empty payload for stages a
// test is not steering, which makes the pipeline take its documented fallback
// path and warn. That is the behaviour under test, not a problem to report.
let warnSpy;
beforeEach(() => {
  jest.clearAllMocks();
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe("fixture sheet construction", () => {
  test("builds a decomposition sheet the pipeline can flatten", () => {
    const sheets = buildFixtureSheets(smallFixture);
    const sheet = sheets["Functional Decomposition"];
    expect(sheet[0]).toContain("Guide Phrase");
    expect(sheet).toHaveLength(smallFixture.items.length + 1);
    expect(sheet[1][0]).toBe("Controller");
  });

  test("leaves applicability blank so the pipeline is not handed its own answer", () => {
    const sheet = buildFixtureSheets(smallFixture)["Functional Decomposition"];
    const applicableColumn = sheet[0].indexOf("Guide Phrase Applicable");
    expect(sheet[1][applicableColumn]).toBe("");
    expect(sheet[2][applicableColumn]).toBe("");
  });

  test("rejects fixture ids that do not match the pipeline's positional ids", () => {
    const misnumbered = { ...smallFixture, items: [{ ...smallFixture.items[0], id: "FD-7" }] };
    expect(() => assertFixtureItemIds(misnumbered)).toThrow(/FD-7 should be FD-1/);
    expect(() => buildFixtureSheets(misnumbered)).toThrow(/positional ids/);
  });
});

describe("sheet to row conversion", () => {
  test("maps labelled columns back to the scored field names", () => {
    const config = {
      sheetName: "STPA",
      fields: [["guidePhrase", "Guide Phrase"], ["guidePhraseApplicable", "Guide Phrase Applicable"]],
    };
    const rows = sheetToRows([
      ["STPA ID", "Guide Phrase", "Guide Phrase Applicable", "Proposed Safety Assessment", "Source Files"],
      ["FD-1-STPA", "Not providing", "Yes", "Safety", "src/brake.js"],
    ], config);
    expect(rows).toEqual([{
      id: "FD-1-STPA",
      guidePhrase: "Not providing",
      guidePhraseApplicable: "Yes",
      proposedSafetyAssessment: "Safety",
    }]);
  });

  test("returns nothing for an empty or header-only sheet", () => {
    expect(sheetToRows([], {})).toEqual([]);
    expect(sheetToRows([["STPA ID"]], { sheetName: "STPA" })).toEqual([]);
  });
});

describe("cassette transport", () => {
  test("keys entries by workflow and prompt hash", () => {
    expect(cassetteKey("abc", { workflow: "hazard-row-generation" }))
      .toBe(`hazard-row-generation:${hashPrompt("abc")}`);
    expect(hashPrompt("abc")).toBe(hashPrompt("abc"));
    expect(hashPrompt("abc")).not.toBe(hashPrompt("abd"));
  });

  test("replays a recorded response without touching the network", async () => {
    const cassette = createEmptyCassette("f-1");
    cassette.entries[cassetteKey("prompt", { workflow: "hazard-row-generation" })] = "[]";
    const transport = createCassetteTransport({ cassette, mode: "replay" });
    await expect(transport("prompt", {}, undefined, "", { workflow: "hazard-row-generation" }))
      .resolves.toBe("[]");
    expect(transport.stats()).toMatchObject({ total: 1, fromCassette: 1, fromLive: 0 });
  });

  test("throws on a miss instead of silently making a live call", async () => {
    const transport = createCassetteTransport({ mode: "replay" });
    await expect(transport("unseen", {}, undefined, "", { workflow: "hazard-row-generation" }))
      .rejects.toThrow(CassetteMissError);
  });

  test("refuses a recording mode with no live transport", () => {
    expect(() => createCassetteTransport({ mode: "record" })).toThrow(/refusing to make unrecorded calls/);
  });

  test("records a live response and replays it thereafter", async () => {
    const live = jest.fn(async () => "[{\"id\":\"FD-1-STPA\"}]");
    const cassette = createEmptyCassette("f-1");
    const transport = createCassetteTransport({ cassette, mode: "refresh", liveTransport: live });
    const options = { workflow: "hazard-row-generation" };
    await transport("prompt", {}, undefined, "", options);
    await transport("prompt", {}, undefined, "", options);
    expect(live).toHaveBeenCalledTimes(1);
    expect(transport.stats()).toMatchObject({ fromLive: 1, fromCassette: 1 });
  });
});

describe("end-to-end fixture run", () => {
  test("scores a run in which the pipeline claims every deviation", async () => {
    const report = await runWithTransport(scriptedRun([
      applicableTag("FD-1-STPA", STOP_EXCERPT),
      applicableTag("FD-2-STPA", FAIL_SAFE_EXCERPT),
    ]));

    expect(report.itemCount).toBe(2);
    expect(report.missingRows).toBe(0);
    // FD-2 is labelled non-applicable, so claiming it is a false positive.
    expect(report.applicability.truePositive).toBe(1);
    expect(report.applicability.falsePositive).toBe(1);
    expect(report.applicability.falsePositiveRate).toBe(1);
    expect(report.applicability.disagreements[0]).toMatchObject({ itemId: "FD-2", produced: "yes" });
  });

  test("catches an over-application whose evidence quote argues against it", async () => {
    // The cited excerpt is a verbatim quote, so the structural gate passes it —
    // but the quote says the actuator reaches fail-safe with no command, which
    // contradicts the applicable verdict it is offered to support. Only the
    // labels catch this.
    const report = await runWithTransport(scriptedRun([
      applicableTag("FD-1-STPA", STOP_EXCERPT),
      applicableTag("FD-2-STPA", FAIL_SAFE_EXCERPT),
    ]));

    const disagreement = report.applicability.disagreements[0];
    expect(disagreement.itemId).toBe("FD-2");
    expect(disagreement.producedRationale).toContain(FAIL_SAFE_EXCERPT);
  });

  test("scores a run that correctly declines the non-applicable deviation", async () => {
    const report = await runWithTransport(scriptedRun([
      applicableTag("FD-1-STPA", STOP_EXCERPT),
      notApplicableTag("FD-2-STPA", FAIL_SAFE_EXCERPT),
    ]));

    expect(report.applicability.falsePositive).toBe(0);
    expect(report.applicability.trueNegative).toBe(1);
    expect(report.applicability.truePositive).toBe(1);
    expect(report.applicability.falsePositiveRate).toBe(0);
    expect(report.applicability.accuracy).toBe(1);
  });

  test("flags a requirement that contradicts the fixture's fail-safe assumption", async () => {
    const report = await runWithTransport(scriptedRun([
      applicableTag("FD-1-STPA", STOP_EXCERPT),
      applicableTag("FD-2-STPA", FAIL_SAFE_EXCERPT),
    ], {
      second: {
        systemRequirement: "The Brake Controller shall command brake application on power loss, verified by test.",
      },
    }));

    expect(report.architecturalConsistency.violationCount).toBe(1);
    expect(report.architecturalConsistency.violations[0]).toMatchObject({
      itemId: "FD-2",
      claim: "shall command brake application on power loss",
    });
  });

  test("scores every pipeline stage so a regression can be attributed", async () => {
    const report = await runWithTransport(scriptedRun([
      applicableTag("FD-1-STPA", STOP_EXCERPT),
      applicableTag("FD-2-STPA", FAIL_SAFE_EXCERPT),
    ]));

    expect(report.stages.map(({ stage }) => stage)).toEqual(HAZARD_ANALYSIS_STAGE_KEYS);
    const [generation] = report.stages;
    expect(generation.deltas).toBeNull();
    expect(report.stages.slice(1).every(({ deltas }) => deltas !== null)).toBe(true);
  });

  test("attributes to generation an applicability the model never stated", async () => {
    // normalizeGuidePhraseApplicability falls back to "Yes" for any value it
    // cannot parse, so a row that returns no applicability at all enters the
    // pipeline already counted as applicable. Stage attribution shows the false
    // positive existing at generation, before any adjudication has run.
    const report = await runWithTransport(scriptedRun([
      applicableTag("FD-1-STPA", STOP_EXCERPT),
      notApplicableTag("FD-2-STPA", FAIL_SAFE_EXCERPT),
    ], {
      first: { guidePhraseApplicable: "" },
      second: { guidePhraseApplicable: "" },
    }));

    const byStage = Object.fromEntries(report.stages.map((entry) => [entry.stage, entry]));
    expect(byStage.generation.metrics.applicabilityUndecided).toBe(0);
    expect(byStage.generation.metrics.applicabilityFalsePositives).toBe(1);
    // The audit stage then correctly declines FD-2, removing the false positive
    // that generation's default introduced.
    expect(byStage["safety-audit"].metrics.applicabilityFalsePositives).toBe(0);
    expect(byStage["safety-audit"].deltas.applicabilityFalsePositives).toBe(-1);
  });

  test("marks a stage that cost a call but moved no metric", async () => {
    const report = await runWithTransport(scriptedRun([
      applicableTag("FD-1-STPA", STOP_EXCERPT),
      notApplicableTag("FD-2-STPA", FAIL_SAFE_EXCERPT),
    ]));

    const languageRepair = report.stages.find(({ stage }) => stage === "language-repair");
    expect(languageRepair.changedNothing).toBe(true);
  });

  test("reports the fixture's label status so proposed scores are not mistaken for evidence", async () => {
    const transport = scriptedRun([
      applicableTag("FD-1-STPA", STOP_EXCERPT),
      applicableTag("FD-2-STPA", FAIL_SAFE_EXCERPT),
    ]);

    fetchLLMResponse.mockImplementation(transport);
    const suite = await runHazardEvalSuite({
      fixtures: [smallFixture],
      method: "STPA",
      generate: generateStandardCodeHazardAnalysisSheets,
      provider: "openai",
    });

    expect(suite.approved).toBe(false);
    expect(suite.proposedFixtureCount).toBe(1);
    expect(suite.totals.itemCount).toBe(2);
    expect(formatHazardEvalSummary(suite)).toContain("WARNING");
    expect(formatHazardEvalSummary(suite)).toContain("over-application rate");
  });
});
