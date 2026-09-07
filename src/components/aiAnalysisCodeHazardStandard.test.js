import {
  applyCanonicalRiskVocabulary,
  deriveStructuredApplicability,
  deriveStructuredSafetyAssessment,
  findApplicabilityCalibrationIndexes,
  findConsistencyReconciliationIndexes,
  materializeGeneratedHazardRows,
  normalizeGenericRequirementOwner,
  validateApplicabilityEvidence,
} from "./aiAnalysisCodeHazardStandard";

describe("standard hazard row materialization", () => {
  test("retains every requested row when an LLM response is incomplete", () => {
    const config = {
      rowIdSuffix: "STPA",
      fields: [
        ["guidePhrase", "Guide Phrase"],
        ["guidePhraseApplicable", "Guide Phrase Applicable"],
        ["hazards", "Hazards"],
      ],
    };
    const items = [
      {
        id: "FD-1",
        from: "Input Monitor",
        controlAction: "Validated input",
        to: "Decision Function",
        guidePhrase: "Not providing the control action causes a hazard",
      },
      {
        id: "FD-2",
        from: "Mode Manager",
        controlAction: "Active mode",
        to: "Processing Function",
        guidePhrase: "The control action is applied too long",
      },
    ];
    const rows = materializeGeneratedHazardRows(config, [{
      id: "FD-1-STPA",
      guidePhraseApplicable: "Yes",
      hazards: "Validated input is unavailable and the receiver enters an uncontrolled state.",
    }], items);

    expect(rows).toHaveLength(2);
    expect(rows[0].hazards).toContain("uncontrolled state");
    expect(rows[1].id).toBe("FD-2-STPA");
    expect(rows[1].hazards).toMatch(/^Needs review:/);
  });

  test("selects nearly-all-applicable interface sets for a final calibration review", () => {
    const guides = [
      "Not providing",
      "Providing causes",
      "Too early",
      "Too late",
      "Wrong order",
      "Stopped too soon",
      "Applied too long",
    ];
    const items = guides.map((guidePhrase, index) => ({
      id: `FD-1-GP-${index + 1}`,
      from: "Source Function",
      controlAction: "Operating state",
      to: "Receiving Function",
      operationalContextId: "context-1",
      guidePhrase,
    }));
    const rows = guides.map((_, index) => ({ guidePhraseApplicable: index === 6 ? "No" : "Yes" }));
    expect(findApplicabilityCalibrationIndexes(rows, items)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    rows[5].guidePhraseApplicable = "No";
    expect(findApplicabilityCalibrationIndexes(rows, items)).toEqual([]);
  });

  test("replaces invented requirement-owner placeholders with a real architectural endpoint", () => {
    expect(normalizeGenericRequirementOwner(
      "The Application Subsystem shall reject invalid inputs, verified by interface tests.",
      { from: "External Environment", to: "Input Validation" },
    )).toBe("The Input Validation shall reject invalid inputs, verified by interface tests.");

    expect(normalizeGenericRequirementOwner(
      "The State Publisher shall timestamp every output, verified by message inspection.",
      { from: "State Publisher", to: "External Consumer" },
    )).toBe("The State Publisher shall timestamp every output, verified by message inspection.");
    expect(normalizeGenericRequirementOwner(
      "The 'Input Validation' function shall reject invalid inputs, verified by interface tests.",
      { from: "External Environment", to: "Input Validation" },
    )).toBe("The Input Validation shall reject invalid inputs, verified by interface tests.");
  });

  test("derives applicability from structured evidence and produces a consistent rationale", () => {
    const supported = deriveStructuredApplicability({
      semanticMeaningful: "Yes",
      receiverCanBeAffected: "Yes",
      contextSupportsMechanism: "Yes",
      adverseStateSupported: "Yes",
      guidePhraseApplicable: "No",
      guidePhraseApplicabilityRationale: "This contradictory free-form answer should not win.",
      applicabilityMechanism: "The receiver retains the sample after its freshness interval.",
      contextEvidence: "The context requires bounded-latency state updates.",
    });
    expect(supported.guidePhraseApplicable).toBe("Yes");
    expect(supported.guidePhraseApplicabilityRationale).toContain("retains the sample");
    expect(supported.guidePhraseApplicabilityRationale).toContain("Context basis:");

    const unsupported = deriveStructuredApplicability({
      semanticMeaningful: "Yes",
      receiverCanBeAffected: "Yes",
      contextSupportsMechanism: "No",
      adverseStateSupported: "Yes",
      guidePhraseApplicable: "Yes",
      strongestReasonForNo: "the supplied context defines no ordering dependency",
    });
    expect(unsupported.guidePhraseApplicable).toBe("No");
    expect(unsupported.guidePhraseApplicabilityRationale).toBe("Not applicable because the supplied context defines no ordering dependency");
  });

  test("derives Safety versus Mission/Reliability from the supported exposure path", () => {
    expect(deriveStructuredSafetyAssessment({
      proposedSafetyAssessment: "Mission/Reliability",
      safetyExposureCategory: "People",
      safetyExposurePath: "Incorrect physical motion can strike an exposed person.",
      safetyEvidenceField: "Operational Scenario",
      safetyEvidenceQuote: "workers are nearby",
    }, {}, {
      applicable: true,
      requireEvidence: true,
      item: { operationalScenario: "The machine operates while workers are nearby." },
    })).toMatchObject({
      proposedSafetyAssessment: "Safety",
      safetySignificant: "Yes",
    });
    expect(deriveStructuredSafetyAssessment({
      proposedSafetyAssessment: "Safety",
      safetyExposureCategory: "None / unsupported",
      safetyExposurePath: "None / unsupported",
    }, {}, { applicable: true, requireEvidence: true })).toMatchObject({
      proposedSafetyAssessment: "Mission/Reliability",
      safetySignificant: "Needs Review",
    });
    expect(deriveStructuredSafetyAssessment({
      proposedSafetyAssessment: "Safety",
      safetyExposureCategory: "People",
      safetyExposurePath: "A person could be exposed to uncontrolled motion.",
      safetyEvidenceField: "Operational Scenario",
      safetyEvidenceQuote: "people are nearby",
    }, {}, {
      applicable: true,
      requireEvidence: true,
      item: { operationalScenario: "The machine performs an unattended diagnostic cycle." },
    })).toMatchObject({
      proposedSafetyAssessment: "Mission/Reliability",
      safetySignificant: "Needs Review",
    });
  });

  test("rejects fabricated citations and applies guide-specific evidence semantics", () => {
    const supportedTag = {
      semanticMeaningful: "Yes",
      receiverCanBeAffected: "Yes",
      contextSupportsMechanism: "Yes",
      adverseStateSupported: "Yes",
      applicabilityMechanism: "The receiver can retain a sample beyond the bounded update interval.",
      applicabilityEvidenceField: "Context Assumptions",
      applicabilityEvidenceQuote: "state updates with bounded latency",
    };
    const stateItem = {
      from: "State Estimation",
      controlAction: "Published state estimate",
      to: "Decision Function",
      controlActionType: "State estimate / data",
      guidePhrase: "The control action is applied too long",
      contextAssumptions: "Downstream decisions require state updates with bounded latency and synchronized timestamps.",
    };
    expect(validateApplicabilityEvidence(supportedTag, stateItem)).toMatchObject({
      guidePhraseApplicable: "Yes",
      evidenceGrounded: true,
    });
    expect(validateApplicabilityEvidence({
      ...supportedTag,
      applicabilityEvidenceQuote: "the system requires fresh certified data",
    }, stateItem)).toMatchObject({
      guidePhraseApplicable: "No",
      evidenceGrounded: false,
    });

    expect(validateApplicabilityEvidence({
      ...supportedTag,
      applicabilityEvidenceField: "Operating Conditions",
      applicabilityEvidenceQuote: "the platform is moving",
    }, {
      ...stateItem,
      from: "External Environment",
      controlAction: "Observation opportunity",
      controlActionType: "External input / disturbance",
      guidePhrase: "Not providing the control action causes a hazard",
      operatingConditions: "The platform is moving through the operating area.",
    })).toMatchObject({
      guidePhraseApplicable: "Yes",
      evidenceGrounded: true,
    });

    expect(validateApplicabilityEvidence({
      ...supportedTag,
      applicabilityEvidenceField: "Function To",
      applicabilityEvidenceQuote: "Time-Align Inputs",
    }, {
      ...stateItem,
      controlAction: "Raw measurement set",
      to: "Time-Align Inputs",
      guidePhrase: "The control action is provided too early",
    }).guidePhraseApplicable).toBe("No");

    expect(validateApplicabilityEvidence({
      ...supportedTag,
      applicabilityEvidenceQuote: "approved configuration is active and valid",
    }, {
      ...stateItem,
      controlAction: "Approved operating configuration",
      controlActionType: "Configuration / authority",
      guidePhrase: "The control action is applied too long",
      contextAssumptions: "The approved configuration is active and valid during steady operation.",
    }).guidePhraseApplicable).toBe("No");
  });

  test("uses stronger supplied evidence when a model cites a generic but genuine excerpt", () => {
    const tag = {
      semanticMeaningful: "Yes",
      receiverCanBeAffected: "Yes",
      contextSupportsMechanism: "Yes",
      adverseStateSupported: "Yes",
      applicabilityMechanism: "The receiver can consume stale state.",
      applicabilityEvidenceField: "Operating Conditions",
      applicabilityEvidenceQuote: "The platform is operating normally",
    };
    const item = {
      from: "State Producer",
      controlAction: "Published state",
      to: "Decision Function",
      controlActionType: "State estimate / data",
      guidePhrase: "The control action is applied too long",
      operatingConditions: "The platform is operating normally.",
      contextAssumptions: "Downstream decisions require state updates with bounded latency; published state timestamps are synchronized.",
    };
    const appliedTooLong = validateApplicabilityEvidence(tag, item);
    expect(appliedTooLong.guidePhraseApplicable).toBe("Yes");
    expect(appliedTooLong.guidePhraseApplicabilityRationale).toContain("Context Assumptions");
    expect(appliedTooLong.guidePhraseApplicabilityRationale).toContain("bounded latency");

    const wrongOrder = validateApplicabilityEvidence({
      ...tag,
      applicabilityMechanism: "The receiver can consume published state versions out of sequence.",
    }, {
      ...item,
      guidePhrase: "The control action is provided in the wrong order",
    });
    expect(wrongOrder.guidePhraseApplicable).toBe("Yes");
    expect(wrongOrder.guidePhraseApplicabilityRationale).toContain("timestamps are synchronized");
  });

  test("does not reuse an unrelated shared-context keyword as interface evidence", () => {
    const tag = {
      semanticMeaningful: "Yes",
      receiverCanBeAffected: "Yes",
      contextSupportsMechanism: "Yes",
      adverseStateSupported: "Yes",
      applicabilityMechanism: "The trajectory request stops before generation completes.",
      applicabilityEvidenceField: "Context Assumptions",
      applicabilityEvidenceQuote: "a remote service may monitor but does not continuously control the vehicle",
    };
    const result = validateApplicabilityEvidence(tag, {
      from: "Maneuver Planner",
      controlAction: "Request Trajectory Generation",
      to: "Generate Motion Trajectory",
      controlActionType: "Command / request",
      guidePhrase: "The control action is stopped too soon",
      contextAssumptions: "The autonomy stack controls motion; a remote service may monitor but does not continuously control the vehicle.",
    });
    expect(result.guidePhraseApplicable).toBe("No");
    expect(result.guidePhraseApplicabilityRationale).toContain("discrete action");
  });

  test("accepts order-dependent architecture evidence that is bound to the interface", () => {
    const result = validateApplicabilityEvidence({
      semanticMeaningful: "Yes",
      receiverCanBeAffected: "Yes",
      contextSupportsMechanism: "Yes",
      adverseStateSupported: "Yes",
      applicabilityMechanism: "The receiver can consume trajectory versions out of sequence.",
      applicabilityEvidenceField: "Control Action",
      applicabilityEvidenceQuote: "Publish Control-Ready Trajectory",
    }, {
      from: "Enforce Driving Constraints",
      controlAction: "Publish Control-Ready Trajectory",
      to: "Convert Trajectory to Control Targets",
      controlActionType: "State estimate / data",
      guidePhrase: "The control action is provided in the wrong order",
    });
    expect(result).toMatchObject({
      guidePhraseApplicable: "Yes",
      evidenceGrounded: true,
    });
  });

  test("keeps explicit physical-harm chains in the Safety classification", () => {
    expect(deriveStructuredSafetyAssessment({
      proposedSafetyAssessment: "Mission/Reliability",
      safetyExposureCategory: "People",
      safetyExposurePath: "Delayed roadway interpretation can cause a collision with a pedestrian.",
      safetyEvidenceField: "Operational Scenario",
      safetyEvidenceQuote: "an excerpt the model failed to copy exactly",
    }, {
      hazards: "The vehicle proceeds without current roadway context, which can cause a collision.",
    }, {
      applicable: true,
      requireEvidence: true,
      item: { operationalScenario: "Passenger trip through dense urban streets with pedestrians." },
    })).toMatchObject({
      proposedSafetyAssessment: "Safety",
      safetySignificant: "Yes",
    });
  });

  test("reconciles contradictory rows and suspicious all-No interface sets", () => {
    const guides = ["Not providing", "Providing causes", "Too early", "Too late", "Wrong order", "Stopped too soon", "Applied too long"];
    const items = guides.map((guidePhrase, index) => ({
      id: `FD-4-GP-${index + 1}`,
      from: "State Producer",
      controlAction: "Bounded-latency state",
      to: "Decision Function",
      operationalContextId: "context-a",
      guidePhrase,
    }));
    const rows = guides.map((_, index) => ({
      guidePhraseApplicable: "No",
      guidePhraseApplicabilityRationale: index === 6
        ? "Using the state beyond its validity can lead to an adverse decision."
        : "Not applicable because the review found no supported mechanism.",
      proposedSafetyAssessment: "Mission/Reliability",
    }));
    expect(findConsistencyReconciliationIndexes(rows, items)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test("maps raw candidates to canonical Losses and Hazards without discarding evidence", () => {
    const rows = [{
      guidePhraseApplicable: "Yes",
      losses: "Interface-specific collision wording.",
      hazards: "Late state at one receiver causes unsafe motion.",
    }, {
      guidePhraseApplicable: "Yes",
      losses: "Another collision wording.",
      hazards: "Missing state at another receiver causes unsafe motion.",
    }];
    const items = [{ id: "FD-1-GP-1" }, { id: "FD-2-GP-1" }];
    const result = applyCanonicalRiskVocabulary(rows, items, {
      losses: [{ id: "L-1", statement: "People are injured by system motion." }],
      hazards: [{ id: "H-1", statement: "The system commands motion without a sufficiently valid state estimate." }],
    }, [
      { id: "FD-1-GP-1", canonicalLossId: "L-1", canonicalHazardId: "H-1" },
      { id: "FD-2-GP-1", canonicalLossId: "L-1", canonicalHazardId: "H-1" },
    ]);
    expect(new Set(result.map((row) => row.losses))).toEqual(new Set(["People are injured by system motion."]));
    expect(new Set(result.map((row) => row.hazards))).toEqual(new Set(["The system commands motion without a sufficiently valid state estimate."]));
    expect(result[0].rawHazardCandidate).toBe("Late state at one receiver causes unsafe motion.");
    expect(result[1].rawHazardCandidate).toBe("Missing state at another receiver causes unsafe motion.");
  });
});
