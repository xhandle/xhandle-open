import {
  PROTECTION_STATUS,
  SAFETY_CLASSIFICATION,
  containsAffirmativeHarmPath,
  normalizeSafetyClassification,
  normalizeProtectionStatus,
  normalizeSafetyClassificationRule,
  normalizeSafetyPathType,
  safetyClassificationRollup,
  validateSafetyClassificationRecord,
  auditSafetyClassificationRecord,
} from "./safetySignificancePolicy";

describe("safety significance policy", () => {
  test("keeps direct and related classifications distinct while rolling both up to Safety", () => {
    expect(safetyClassificationRollup(SAFETY_CLASSIFICATION.DIRECT)).toBe("Safety");
    expect(safetyClassificationRollup(SAFETY_CLASSIFICATION.RELATED)).toBe("Safety");
    expect(normalizeSafetyClassification("Safety — Related")).toBe(SAFETY_CLASSIFICATION.RELATED);
  });

  test("repairs contradictory dependent classification fields without rewriting evidence", () => {
    const audited = auditSafetyClassificationRecord({
      guidePhraseApplicable: "Yes",
      safetyClassification: "Safety — Related",
      safetyClassificationRule: "D1",
      causalPathType: "Direct",
      causalEffect: "The monitor receives an invalid state.",
      resultingSystemState: "The controller retains an unsafe state.",
      hazards: "The machine can strike an exposed person.",
      losses: "L1 — Physical injury.",
      protectionAssessment: "Protection is unknown.",
    });
    expect(audited.safetyClassification).toBe("Needs Review");
    expect(audited.causalPathType).toBe("Uncertain");
    expect(audited.safetyClassificationRule).toMatch(/^U/);
    expect(audited.causalEffect).toBe("The monitor receives an invalid state.");
    expect(audited.validationFindings.length).toBeGreaterThan(0);
  });

  test("accepts a complete direct mishap path", () => {
    const result = validateSafetyClassificationRecord({
      guidePhraseApplicable: "Yes",
      safetyClassification: "Safety — Direct",
      safetyClassificationRule: "D1",
      causalPathType: "Direct",
      causalEffect: "The actuator applies unintended steering torque.",
      resultingSystemState: "The vehicle moves outside its controlled lane.",
      hazards: "The vehicle has uncontrolled lateral motion near workers.",
      losses: "L1 — Injury or loss of life.",
      protectionAssessment: "No independent protection is identified.",
    }, { to: "Steering Actuator" });

    expect(result).toMatchObject({ classification: SAFETY_CLASSIFICATION.DIRECT, findings: [] });
  });

  test("recognizes unsafe proximity and loss of separation as physical-harm exposure", () => {
    const result = validateSafetyClassificationRecord({
      guidePhraseApplicable: "Yes",
      safetyClassification: "Safety — Related",
      safetyClassificationRule: "R1",
      causalPathType: "Contributory",
      causalEffect: "An unsettled pose estimate offsets the commanded approach trajectory.",
      resultingSystemState: "The robot enters unsafe proximity to people or property.",
      intermediateSafetyFunction: "Obstacle and pedestrian avoidance",
      intermediateSafetyEffect: "The avoidance function receives an inconsistent pose-relative clearance estimate.",
      protectionAssessment: "Protection effectiveness for this pose-offset condition is unknown.",
    }, { to: "Maintain Local World Model" });

    expect(result.findings).toEqual([]);
  });

  test("requires a named intermediate mechanism for Safety — Related", () => {
    const incomplete = validateSafetyClassificationRecord({
      guidePhraseApplicable: "Yes",
      safetyClassification: "Safety — Related",
      safetyClassificationRule: "R1",
      causalPathType: "Contributory",
      causalEffect: "The status is stale.",
      resultingSystemState: "The controller retains an invalid readiness state.",
      hazards: "The machine can strike a nearby worker.",
      losses: "L1 — Injury or loss of life.",
      protectionAssessment: "No independent protection is identified.",
    });
    expect(incomplete.findings).toContain(
      "Safety — Related requires a named intermediate safety function, control, barrier, or response.",
    );

    const complete = validateSafetyClassificationRecord({
      guidePhraseApplicable: "Yes",
      safetyClassification: "Safety — Related",
      safetyClassificationRule: "R1",
      causalPathType: "Contributory",
      causalEffect: "The status is stale.",
      resultingSystemState: "The controller retains an invalid readiness state.",
      intermediateSafetyFunction: "Motion Enable Gate",
      intermediateSafetyEffect: "The gate permits motion before readiness is established.",
      hazards: "The machine can strike a nearby worker.",
      losses: "L1 — Injury or loss of life.",
      protectionAssessment: "No independent protection is identified.",
    });
    expect(complete.findings).toEqual([]);
  });

  test("does not accept placeholder text as required classification evidence", () => {
    const result = validateSafetyClassificationRecord({
      guidePhraseApplicable: "Yes",
      safetyClassification: "Safety — Related",
      safetyClassificationRule: "R1",
      causalPathType: "Contributory",
      causalEffect: "The target estimate is unavailable.",
      resultingSystemState: "The approach cannot be completed.",
      intermediateSafetyFunction: "Not applicable",
      intermediateSafetyEffect: "N/A",
      hazards: "The robot may collide with a nearby person.",
      losses: "L1 — Injury or loss of life.",
      protectionAssessment: "Protection effectiveness is unknown.",
    });
    expect(result.findings).toContain(
      "Safety — Related requires a named intermediate safety function, control, barrier, or response.",
    );
    expect(result.findings).toContain(
      "Safety — Related requires the effect on the intermediate safety function.",
    );
  });

  test("flags Mission/Reliability when the row still asserts a physical-harm path", () => {
    const result = validateSafetyClassificationRecord({
      guidePhraseApplicable: "Yes",
      safetyClassification: "Mission/Reliability",
      safetyClassificationRule: "M3",
      causalPathType: "None",
      physicalHarmChainTermination: "The receiver is reporting-only and cannot affect vehicle control.",
      hazards: "Delayed dispatch creates collision exposure for pedestrians.",
      losses: "L1 — Injury or loss of life.",
    }, { to: "Fleet Reporting Service" });
    expect(result.findings).toContain(
      "Mission/Reliability contradicts an asserted L1-L3 or physical-harm path.",
    );
  });

  test("normalizes a non-applicable row independently of its proposed rollup", () => {
    const result = validateSafetyClassificationRecord({
      guidePhraseApplicable: "No",
      proposedSafetyAssessment: "Safety",
      safetyClassification: "Safety — Direct",
    });
    expect(result).toMatchObject({
      classification: SAFETY_CLASSIFICATION.NOT_APPLICABLE,
      pathType: "None",
    });
  });

  test("applies the same direct-path test to an industrial process hazard", () => {
    const result = validateSafetyClassificationRecord({
      guidePhraseApplicable: "Yes",
      safetyClassification: "Safety — Direct",
      safetyClassificationRule: "D1",
      causalPathType: "Direct",
      causalEffect: "The valve remains open and releases process fluid.",
      resultingSystemState: "Personnel are exposed to a toxic release.",
      hazards: "Loss of containment in an occupied processing area.",
      losses: "L3 — Environmental harm or hazardous release.",
      protectionAssessment: "The independent isolation barrier is unavailable in this mode.",
    }, { to: "Isolation Valve" });

    expect(result.findings).toEqual([]);
  });

  test("does not accept a medical safety classification without assessing protection", () => {
    const result = validateSafetyClassificationRecord({
      guidePhraseApplicable: "Yes",
      safetyClassification: "Safety — Related",
      safetyClassificationRule: "R2",
      causalPathType: "Contributory",
      causalEffect: "The occlusion alarm is suppressed.",
      resultingSystemState: "The infusion fault remains undetected.",
      intermediateSafetyFunction: "Infusion Fault Response",
      intermediateSafetyEffect: "The response cannot stop delivery or alert clinical staff.",
      hazards: "Incorrect medication delivery can injure the patient.",
      losses: "L1 — Patient injury or loss of life.",
    }, { to: "Clinical Alarm Manager" });

    expect(result.findings).toContain(
      "Safety — Related requires an assessment of credited independent protections.",
    );
  });

  test("treats assumed or unconfirmed protection as Unknown", () => {
    expect(normalizeProtectionStatus("", "A fallback is assumed but not confirmed for this project."))
      .toBe(PROTECTION_STATUS.UNKNOWN);
    expect(normalizeProtectionStatus("", "No independent position cross-check is confirmed by row evidence."))
      .toBe(PROTECTION_STATUS.UNKNOWN);
    expect(normalizeProtectionStatus("", "The independent isolation valve is unavailable in this mode."))
      .toBe(PROTECTION_STATUS.INEFFECTIVE);
    expect(normalizeProtectionStatus("", "No independent protection is identified."))
      .toBe(PROTECTION_STATUS.ABSENT);
  });

  test("does not mistake an explicitly negated harm path for an asserted mishap", () => {
    expect(containsAffirmativeHarmPath({
      loss: "L4 — Loss of mission availability.",
      hazard: "Dispatch visibility is unavailable.",
      physicalHarmChainTermination: "No supplied evidence links this state to a physical-harm outcome.",
      proposedSafetyAssessmentRationale: "The row does not establish an L1-L3 mishap.",
    })).toBe(false);
    expect(containsAffirmativeHarmPath({
      loss: "L1 — Injury or loss of life.",
      hazard: "The robot can strike a nearby worker.",
    })).toBe(true);
  });

  test("forces path types and rule identifiers to agree with final classifications", () => {
    expect(normalizeSafetyPathType("Contributory", SAFETY_CLASSIFICATION.MISSION)).toBe("None");
    expect(normalizeSafetyPathType("Contributory", SAFETY_CLASSIFICATION.REVIEW)).toBe("Uncertain");
    expect(normalizeSafetyClassificationRule(
      "R2 — a long model explanation",
      SAFETY_CLASSIFICATION.RELATED,
    )).toBe("R2");
    expect(normalizeSafetyClassificationRule("D2", SAFETY_CLASSIFICATION.MISSION, {
      evidence: "Reporting-only status reaches fleet tracking.",
    })).toBe("M3");
  });
});
