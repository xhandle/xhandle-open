import {
  buildHazardAnalysisPatternFindings,
  buildHazardSafetyModel,
  buildHazardQualityFindings,
  createSafetyModelId,
  inferControlActionType,
  normalizeNonApplicableHazardRecord,
  parameterizeUnsupportedRequirement,
  semanticGuidePhrase,
} from "./hazardSafetyModel";

describe("hazard safety model", () => {
  test("creates stable content-derived identifiers", () => {
    expect(createSafetyModelId("H", " Loss of control ")).toBe(createSafetyModelId("H", "loss of control"));
  });

  test("classifies actions and translates guide phrases semantically", () => {
    expect(inferControlActionType("Primary brake status")).toBe("Feedback / status");
    expect(semanticGuidePhrase("Feedback / status", "The control action is stopped too soon"))
      .toContain("cease before");
    expect(semanticGuidePhrase("State estimate / data", "The control action is applied too long"))
      .toContain("beyond its validity");
    expect(semanticGuidePhrase("State estimate / data", "The control action is provided too early"))
      .toContain("before it is valid");
    expect(semanticGuidePhrase("State estimate / data", "The control action is provided too late"))
      .toContain("freshness deadline");
    expect(semanticGuidePhrase("State estimate / data", "The control action is provided in the wrong order"))
      .toContain("invalid version");
  });

  test("classifies configuration authority and external disturbances without domain-specific rules", () => {
    expect(inferControlActionType("Approved operating policy", "Configuration Authority", "Decision Function"))
      .toBe("Configuration / authority");
    expect(inferControlActionType("Ambient observation availability", "External Environment", "Input Monitor"))
      .toBe("External input / disturbance");
    expect(inferControlActionType("Authorize operation", "External Operator", "Mode Manager"))
      .toBe("Command / request");
    expect(inferControlActionType("Apply Motion Commands", "Control Target Conversion", "Execute Vehicle Motion"))
      .toBe("Command / request");
    expect(inferControlActionType("Enter Degraded Operating Mode", "Safety Envelope Validation", "Degraded Operation"))
      .toBe("Mode transition");
    expect(inferControlActionType("Submit Planning Objective", "Trip Manager", "Maneuver Planner"))
      .toBe("Command / request");
    expect(inferControlActionType("Notify Fleet Operations", "Status Reporter", "Remote Service"))
      .toBe("Event");
  });

  test("does not preserve invented numeric thresholds as facts", () => {
    expect(parameterizeUnsupportedRequirement("Respond within 50 ms", "")).toBe("Respond within [TBD-ms]");
    expect(parameterizeUnsupportedRequirement("Respond within 50 ms", "TBD")).toBe("Respond within [TBD-ms]");
    expect(parameterizeUnsupportedRequirement("Respond within 50 ms", "Timing budget TB-12")).toBe("Respond within 50 ms");
  });

  test("flags cause/mitigation confusion, architecture conflicts, and safety underclassification", () => {
    const findings = buildHazardQualityFindings({
      "Mitigation Strategy": "Communication failure prevents delivery",
      "System Requirement": "The controller must assert the command within 30 ms",
      "Context Assumptions": "Total power loss; passive engagement without powered control or communication",
      "Hazard": "Unintended movement creates a collision hazard",
      "Proposed Safety Assessment": "Mission/Reliability",
    });
    expect(findings).toContain("Mitigation appears to describe a causal factor; separate the cause from the design measure.");
    expect(findings).toContain("Requirement may conflict with the stated power or communication availability assumptions.");
    expect(findings).toContain("System requirement is not expressed as an allocated, verifiable shall statement.");
  });

  test("normalizes non-applicable evidence without leaving misleading causes or parameter sources", () => {
    const normalizedRow = normalizeNonApplicableHazardRecord({
      hazard: "Candidate hazard",
      causalFactor: "Timing fault",
      causalFactorCategory: "Timing / sequencing",
      systemRequirement: "The controller shall react",
      requirementParameterSource: "TBD",
    }, "The receiver does not consume this input in the stated mode.");
    expect(normalizedRow.guidePhraseApplicable).toBe("No");
    expect(normalizedRow.hazard).toMatch(/^Not applicable:/);
    expect(normalizedRow.causalFactor).toMatch(/^Not applicable:/);
    expect(normalizedRow.causalFactorCategory).toBe("Not applicable");
    expect(normalizedRow.requirementParameterSource).toBe("Not applicable");
    expect(normalizedRow.proposedSafetyAssessment).toBe("Mission/Reliability");
  });

  test("flags hidden conditions, generic endpoints, and attempts to control external conditions", () => {
    const findings = buildHazardQualityFindings({
      "Guide Phrase Applicable": "Yes",
      "Guide Phrase Applicability Rationale": "The update could be missing when required.",
      "Control Action Type": "External input / disturbance",
      Hazard: "The receiver uses incomplete input, resulting in operational errors.",
      "System Requirement": "Ensure continuous availability of the environmental condition.",
    });
    expect(findings).toContain("Applicability rationale introduces a conditional event that is not established by the supplied operational context.");
    expect(findings).toContain("Hazard ends at a generic failure effect; identify the resulting system state, exposure, and plausible loss or harm.");
    expect(findings).toContain("Requirement attempts to control an external condition; allocate detection, degraded operation, inhibition, or safe response instead.");
  });

  test("flags an invented update need when a steady-state configuration is already valid", () => {
    const findings = buildHazardQualityFindings({
      "Guide Phrase Applicable": "Yes",
      "Control Action Type": "Configuration / authority",
      "Operational Scenario": "Steady-state processing",
      "Context Assumptions": "The approved operating configuration is active and valid.",
      "Guide Phrase Applicability Rationale": "Not providing the approved configuration update can leave an outdated configuration.",
      Hazard: "The receiver uses an inconsistent operating state, exposing the controlled process to an unbounded output.",
      "System Requirement": "The configuration manager shall preserve the approved active version while steady-state processing continues, verified by version telemetry.",
    });
    expect(findings).toContain("Applicability assumes an unstated configuration or authority update even though the supplied steady-state context says the active value is valid.");
  });

  test("reports suspicious applicability patterns without removing source rows", () => {
    const headers = [
      "Function (From)", "Control Action", "Function (To)", "Guide Phrase",
      "Guide Phrase Applicable", "Proposed Safety Assessment",
    ];
    const guides = ["Not provided", "Provided when hazardous", "Applied too long"];
    const summary = [headers];
    ["Input A", "Input B", "Input C"].forEach((action, index) => {
      guides.forEach((guide) => summary.push([
        `Source ${index + 1}`,
        action,
        `Receiver ${index + 1}`,
        guide,
        guide === "Applied too long" ? "No" : "Yes",
        "Safety",
      ]));
    });
    const findings = buildHazardAnalysisPatternFindings(summary);
    expect(findings.some((finding) => finding.message.includes("Every “Applied too long” row"))).toBe(true);
    expect(findings.some((finding) => finding.message.includes("Every applicable row is classified Safety"))).toBe(true);
    expect(findings.some((finding) => finding.message.includes("same applicability pattern"))).toBe(true);
    expect(summary).toHaveLength(10);
  });

  test("reports broad applicability, unconverged hazards, and generic requirement ownership", () => {
    const headers = [
      "Function (From)", "Control Action", "Function (To)", "Guide Phrase",
      "Guide Phrase Applicable", "Loss", "Hazard", "System Requirement",
      "Proposed Safety Assessment",
    ];
    const summary = [headers];
    for (let interfaceIndex = 0; interfaceIndex < 4; interfaceIndex += 1) {
      for (let guideIndex = 0; guideIndex < 5; guideIndex += 1) {
        const rowNumber = interfaceIndex * 5 + guideIndex;
        summary.push([
          `Source ${interfaceIndex}`,
          `Action ${interfaceIndex}`,
          `Receiver ${interfaceIndex}`,
          `Guide ${guideIndex}`,
          rowNumber < 18 ? "Yes" : "No",
          `Loss ${rowNumber}`,
          `Hazard ${rowNumber}`,
          "The Application Subsystem shall validate the interface, verified by test evidence.",
          "Safety",
        ]);
      }
    }
    const findings = buildHazardAnalysisPatternFindings(summary);
    expect(findings.some((finding) => finding.message.includes("18 of 20 guide-phrase rows"))).toBe(true);
    expect(findings.some((finding) => finding.message.includes("mark every guide phrase applicable"))).toBe(true);
    expect(findings.some((finding) => finding.message.includes("converge them into reusable system-level Losses and Hazards"))).toBe(true);
    expect(findings.some((finding) => finding.message.includes("use a generic owner"))).toBe(true);
  });

  test("flags near-universal interface safety without requiring every row to be Safety", () => {
    const headers = [
      "Function (From)", "Control Action", "Function (To)", "Guide Phrase",
      "Guide Phrase Applicable", "Proposed Safety Assessment",
    ];
    const summary = [headers];
    for (let interfaceIndex = 0; interfaceIndex < 10; interfaceIndex += 1) {
      summary.push([
        `Source ${interfaceIndex}`,
        `Action ${interfaceIndex}`,
        `Receiver ${interfaceIndex}`,
        "Not providing the control action causes a hazard",
        "Yes",
        interfaceIndex < 9 ? "Safety" : "Mission/Reliability",
      ]);
      summary.push([
        `Source ${interfaceIndex}`,
        `Action ${interfaceIndex}`,
        `Receiver ${interfaceIndex}`,
        "The control action is provided too early",
        "No",
        "Mission/Reliability",
      ]);
    }

    const findings = buildHazardAnalysisPatternFindings(summary);
    expect(findings.some((finding) => finding.message.includes("interfaces have at least one Safety result"))).toBe(true);
  });

  test("builds a canonical trace while preserving links to every raw row", () => {
    const summary = [
      ["Function (From)", "Control Action", "Function (To)", "Guide Phrase", "Guide Phrase Applicable", "Unsafe Control Actions", "Context Assumptions"],
      ["Controller", "Send demand", "Actuator", "Not providing the control action causes a hazard", "Yes", "Demand is absent", "Independent fallback is available"],
      ["Controller", "Send demand", "Actuator", "The control action is provided too late", "Yes", "Demand arrives late", "Independent fallback is available"],
    ];
    const risks = [{
      id: "issue-1",
      title: "Unsafe actuation",
      sourceIndexes: [1, 2],
      canonicalLosses: [{ title: "Loss of safe operation" }],
      canonicalHazards: [{ title: "Actuation unavailable when required" }],
      causalScenarios: [{ description: "Controller process model is stale", sourceIndexes: [1, 2] }],
      safetyConstraints: [{ statement: "The system shall preserve safe actuation", sourceIndexes: [1, 2] }],
    }];
    const model = buildHazardSafetyModel(summary, risks, "Example");
    expect(model.losses).toHaveLength(1);
    expect(model.unsafeControlActions).toHaveLength(2);
    expect(model.architectureAssumptions[0].sourceIndexes).toEqual([1, 2]);
    expect(model.traceability[0].sourceIndexes).toEqual([1, 2]);
    expect(model.traceability[0].safetyConstraintIds).toHaveLength(1);
  });
});
