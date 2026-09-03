jest.mock("./backendConfig", () => ({
  buildAuthOpts: (headers = {}) => ({ headers }),
  buildAIAuthOpts: (headers = {}) => ({ headers }),
}));

const { handleLitePromptSubmit } = require("./LitePromptHandler");

function mockJsonResponse(content, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
    text: async () => content,
  };
}

describe("handleLitePromptSubmit", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the chat proxy before the openai proxy for project decomposition", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      mockJsonResponse(JSON.stringify([
        {
          fromFunction: "Sensor",
          fromDetails: "Collects external measurements for the system.",
          controlAction: "sends measurements",
          controlDetails: "Delivers sampled measurement data to the controller.",
          toFunction: "Controller",
          toDetails: "Receives measurements and determines the next command.",
        },
      ]))
    );

    let response = "";
    await handleLitePromptSubmit(
      [
        "System Name: Test System",
        "Functional Components: Sensor, Controller",
        "Control Interactions: Sensor sends measurements to Controller",
      ].join("\n"),
      (value) => { response = value; },
      () => {}
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/chat");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/openai"))).toBe(false);
    const requestBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(requestBody.temperature).toBe(0);
    expect(requestBody.top_p).toBe(0.1);
    expect(JSON.parse(response)).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromFunction: "Sensor", toFunction: "Controller" }),
    ]));
  });

  it("sends overview, interactions, and operating modes as one integrated architecture request", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      mockJsonResponse(JSON.stringify([
        {
          subsystem: "Sensing",
          fromFunction: "Acquire Measurements",
          fromDetails: "Samples calibrated environmental measurements and tracks acquisition health.",
          controlAction: "Calibrated measurement stream",
          controlDetails: "Publishes timestamped measurements at the configured update rate with quality metadata.",
          toFunction: "Estimate System State",
          toDetails: "Fuses measurement streams into a current state estimate for downstream decisions.",
        },
      ]))
    );
    const prompt = JSON.stringify({
      mode: "structured",
      systemName: "Test Robot",
      abstractionLevel: "subsystem",
      systemOverview: "Operates near people and performs commanded tasks.",
      functionalComponents: "- Subsystem: Sensing | Function: Acquire Measurements | Description: Collects measurements.",
      interactions: "Acquire Measurements sends calibrated measurements to Estimate System State.",
      ops: "Nominal operation and degraded sensing mode.",
      evidenceProvenance: {
        aiGeneratedFields: ["functionalComponents", "interactions"],
      },
    });

    await handleLitePromptSubmit(prompt, () => {}, () => {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const blueprintBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const blueprintSystemPrompt = blueprintBody.messages.find((message) => message.role === "system")?.content || "";
    expect(blueprintSystemPrompt).toContain("architecture-planning stage");
    expect(blueprintSystemPrompt).toContain("domain-specific functional architecture");
    const blueprintUserPrompt = blueprintBody.messages.find((message) => message.role === "user")?.content || "";
    expect(blueprintUserPrompt).toContain("System Overview [user-authored evidence]");
    expect(blueprintUserPrompt).toContain("Wizard Functions and Allocations [AI-generated hypothesis; independently verify]");
    expect(blueprintUserPrompt).toContain("Wizard Interactions [AI-generated hypothesis; independently verify]");

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    const userPrompt = body.messages.find((message) => message.role === "user")?.content || "";
    const systemPrompt = body.messages.find((message) => message.role === "system")?.content || "";
    expect(userPrompt).toContain("System Overview [user-authored evidence]:");
    expect(userPrompt).toContain("Control Interactions [AI-generated hypothesis; independently verify]:");
    expect(userPrompt).toContain("Operational Scenarios [user-authored evidence]:");
    expect(userPrompt).toContain("Selected Decomposition Depth: Subsystem level");
    expect(userPrompt).toContain("Architecture Blueprint:");
    expect(systemPrompt).toContain("SUBSYSTEM-LEVEL DEPTH");
  });

  it("does not let AI-generated wizard allocations override reviewed blueprint ownership", async () => {
    const blueprint = {
      scopeBoundary: "Test Robot",
      externalActors: [],
      subsystems: [{
        name: "Reviewed Perception",
        functions: [{ name: "Acquire Measurements" }],
      }],
      missionThreads: [],
      feedbackLoops: [],
    };
    const generatedRows = [{
      subsystem: "Unverified Sensor Group",
      fromFunction: "Acquire Measurements",
      fromDetails: "Acquires timestamped measurements with calibration, freshness, and validity metadata for downstream estimation.",
      controlAction: "Calibrated Measurements",
      controlDetails: "Publishes calibrated measurement samples when acquisition completes so the estimator can update its state.",
      toFunction: "Estimate State",
      toDetails: "Consumes calibrated measurements and estimates the current system state with uncertainty and freshness metadata.",
    }];
    jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify(blueprint)))
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify(generatedRows)));
    let response = "";

    await handleLitePromptSubmit(
      JSON.stringify({
        mode: "structured",
        systemName: "Test Robot",
        abstractionLevel: "system",
        functionalComponents: "- Subsystem: Unverified Sensor Group | Function: Acquire Measurements | Description: Collects measurements.",
        evidenceProvenance: { aiGeneratedFields: ["functionalComponents"] },
      }),
      (value) => { response = value; },
      () => {}
    );

    expect(JSON.parse(response)[0].subsystem).toBe("Reviewed Perception");
  });

  it("deduplicates the same interface and retains the richer generated row", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      mockJsonResponse(JSON.stringify([
        {
          subsystem: "Control",
          fromFunction: "Generate Motion Command",
          fromDetails: "Generates commands.",
          controlAction: "Joint command setpoint",
          controlDetails: "Sends setpoints.",
          toFunction: "Regulate Joint Motion",
          toDetails: "Controls joints.",
        },
        {
          subsystem: "Control",
          fromFunction: "Generate Motion Command",
          fromDetails: "Transforms the approved motion trajectory into synchronized joint position, velocity, and torque targets.",
          controlAction: "Joint command setpoint",
          controlDetails: "Publishes synchronized position, velocity, torque, validity, and execution-time targets for the active control cycle.",
          toFunction: "Regulate Joint Motion",
          toDetails: "Closes each joint servo loop against measured actuator state while enforcing configured limits.",
        },
      ]))
    );
    let response = "";

    await handleLitePromptSubmit(
      "System Name: Test Robot\nFunctional Components: Generate Motion Command, Regulate Joint Motion\nControl Interactions: Generate Motion Command sends Joint command setpoint to Regulate Joint Motion",
      (value) => { response = value; },
      () => {}
    );

    const rows = JSON.parse(response);
    expect(rows).toHaveLength(1);
    expect(rows[0].fromDetails).toContain("synchronized joint position");
    expect(rows[0].controlDetails).toContain("validity");
  });

  it("normalizes conflicting source-function ownership without rejecting the result", async () => {
    const blueprint = JSON.stringify({
      scopeBoundary: "Test Robot",
      subsystems: [],
      missionThreads: [],
    });
    const generatedRows = JSON.stringify([
      {
        subsystem: "Motion Control",
        fromFunction: "Allocate Joint Torque",
        fromDetails: "Allocates bounded joint torque targets from the approved whole-body motion objective.",
        controlAction: "Joint torque targets",
        controlDetails: "Publishes synchronized torque targets with validity limits for the active control cycle.",
        toFunction: "Regulate Joint Motion",
        toDetails: "Closes joint servo loops using measured position, velocity, and torque feedback.",
      },
      {
        subsystem: "Mobility",
        fromFunction: "Allocate Joint Torque",
        fromDetails: "Allocates bounded joint torque targets from the approved whole-body motion objective.",
        controlAction: "Torque allocation status",
        controlDetails: "Reports saturation, validity, and allocation residuals to execution supervision each control cycle.",
        toFunction: "Supervise Motion Execution",
        toDetails: "Compares commanded and measured motion and initiates bounded recovery when execution diverges.",
      },
    ]);
    jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(mockJsonResponse(blueprint))
      .mockResolvedValueOnce(mockJsonResponse(generatedRows));
    let response = "";

    await handleLitePromptSubmit(
      JSON.stringify({
        mode: "structured",
        systemName: "Test Robot",
        abstractionLevel: "multi-level",
        systemOverview: "Performs embodied tasks under closed-loop control.",
      }),
      (value) => { response = value; },
      () => {}
    );

    const rows = JSON.parse(response);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.subsystem))).toEqual(new Set(["Motion Control"]));
  });

  it("accepts a model response that wraps decomposition rows in an object", async () => {
    const row = {
      subsystem: "Perception",
      fromFunction: "acquire-scene-measurements",
      fromDetails: "Acquires synchronized scene measurements with timestamps, calibration references, and validity metadata.",
      controlAction: "Calibrated scene measurements",
      controlDetails: "Publishes synchronized measurements when a sampling cycle completes so perception can estimate the environment.",
      toFunction: "Estimate Scene State",
      toDetails: "Estimates tracked environmental state while preserving uncertainty, freshness, and source provenance.",
    };
    jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(mockJsonResponse("[]"))
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify({ rows: [row] })));
    let response = "";

    await handleLitePromptSubmit(
      "System Name: Test Robot\nFunctional Components: Perception\nControl Interactions: Acquire measurements",
      (value) => { response = value; },
      () => {}
    );

    expect(JSON.parse(response)).toEqual([{
      ...row,
      fromFunction: "Acquire Scene Measurements",
    }]);
  });

  it("runs one non-blocking repair pass when a parsed blueprint is poorly represented", async () => {
    const functionNames = [
      "Acquire Input",
      "Estimate State",
      "Maintain World Model",
      "Plan Behavior",
      "Generate Command",
      "Execute Output",
      "Measure Outcome",
      "Supervise Health",
    ];
    const blueprint = {
      scopeBoundary: "Test Robot",
      externalActors: [],
      subsystems: [
        { name: "Perception", functions: functionNames.slice(0, 2).map((name) => ({ name })) },
        { name: "Cognition", functions: functionNames.slice(2, 4).map((name) => ({ name })) },
        { name: "Control", functions: functionNames.slice(4, 6).map((name) => ({ name })) },
        { name: "Assurance", functions: functionNames.slice(6).map((name) => ({ name })) },
      ],
      missionThreads: [functionNames],
      feedbackLoops: [["Measure Outcome", "Estimate State"]],
    };
    const makeRow = (fromFunction, toFunction, index) => ({
      subsystem: "Incorrect owner",
      fromFunction,
      fromDetails: `${fromFunction} performs a bounded domain responsibility with explicit inputs, outputs, state, and operational constraints.`,
      controlAction: `Specific interface ${index}`,
      controlDetails: `Transfers a typed payload on its defined trigger so ${toFunction} can update its behavior within the required timing constraints.`,
      toFunction,
      toDetails: `${toFunction} consumes the typed payload, updates owned state, and produces the next domain-specific output under defined constraints.`,
    });
    const weakRows = [
      makeRow(functionNames[0], functionNames[1], 1),
      makeRow(functionNames[2], functionNames[3], 2),
      makeRow(functionNames[4], functionNames[5], 3),
      makeRow(functionNames[6], functionNames[7], 4),
    ];
    const repairedRows = functionNames.map((name, index) => (
      makeRow(name, functionNames[(index + 1) % functionNames.length], index + 1)
    ));
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify(blueprint)))
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify(weakRows)))
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify(repairedRows)));
    let response = "";

    await handleLitePromptSubmit(
      JSON.stringify({
        mode: "structured",
        systemName: "Test Robot",
        abstractionLevel: "system",
        systemOverview: "Transforms external inputs into controlled physical outputs.",
      }),
      (value) => { response = value; },
      () => {}
    );

    const result = JSON.parse(response);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(8);
    expect(new Set(result.map((row) => row.subsystem))).toEqual(
      new Set(["Perception", "Cognition", "Control", "Assurance"])
    );
    const repairBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    const repairPrompt = repairBody.messages.find((message) => message.role === "user")?.content || "";
    expect(repairPrompt).toContain("Issues to repair:");
    expect(repairPrompt).toContain("fragmented");
  });

  it("uses an independent semantic rewrite for multi-level drafts that are structurally plausible", async () => {
    const functionNames = Array.from({ length: 19 }, (_, index) => `Core Function ${index + 1}`)
      .concat("Monitor User Wellness");
    const blueprint = {
      scopeBoundary: "Generic Embodied System",
      externalActors: [],
      subsystems: Array.from({ length: 5 }, (_, subsystemIndex) => ({
        name: `Subsystem ${subsystemIndex + 1}`,
        functions: functionNames
          .slice(subsystemIndex * 4, subsystemIndex * 4 + 4)
          .map((name) => ({ name })),
      })),
      missionThreads: [functionNames],
      feedbackLoops: [[functionNames[19], functionNames[0]]],
    };
    const ownerFor = (name) => {
      const index = functionNames.indexOf(name);
      return `Subsystem ${Math.floor(Math.max(0, index) / 4) + 1}`;
    };
    const makeRow = (fromFunction, toFunction, index) => ({
      subsystem: ownerFor(fromFunction),
      fromFunction,
      fromDetails: `${fromFunction} performs a bounded platform responsibility using explicit inputs, outputs, state, and operational constraints.`,
      controlAction: `Typed platform interface ${index}`,
      controlDetails: `Transfers a typed platform payload on a defined trigger so ${toFunction} can update its owned behavior within timing constraints.`,
      toFunction,
      toDetails: `${toFunction} consumes the typed payload, updates its owned state, and produces a bounded platform output under explicit constraints.`,
    });
    const draftRows = functionNames.map((name, index) => (
      makeRow(name, functionNames[(index + 1) % functionNames.length], index + 1)
    ));
    draftRows.push(
      makeRow(functionNames[0], functionNames[4], 21),
      makeRow(functionNames[4], functionNames[8], 22),
      makeRow(functionNames[8], functionNames[12], 23),
      makeRow(functionNames[12], functionNames[16], 24)
    );
    const replacementName = "Supervise Platform Faults";
    const semanticRows = draftRows.map((row) => ({
      ...row,
      subsystem: row.fromFunction === "Core Function 1"
        ? "Corrected Architecture Owner"
        : row.fromFunction === "Monitor User Wellness" ? "Subsystem 5" : row.subsystem,
      fromFunction: row.fromFunction === "Monitor User Wellness" ? replacementName : row.fromFunction,
      toFunction: row.toFunction === "Monitor User Wellness" ? replacementName : row.toFunction,
    }));
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify(blueprint)))
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify(draftRows)))
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify({
        reviewSummary: "Removed an unsupported application assumption.",
        originalDraftFindings: {
          unsupportedAssumptions: ["User wellness role"],
          missingIntrinsicCapabilities: [],
          invalidInterfaces: [],
          ownershipConflicts: [],
        },
        postCorrectionValidation: {
          domainFidelity: 2,
          decompositionDepth: 2,
          interfaceSemantics: 2,
          feedbackAndSafety: 2,
          systemBoundaries: 1,
          unsupportedAssumptionsRemaining: [],
          missingIntrinsicCapabilitiesRemaining: [],
          invalidInterfacesRemaining: [],
          ownershipConflictsRemaining: [],
        },
        rows: semanticRows,
      })));
    let response = "";

    await handleLitePromptSubmit(
      JSON.stringify({
        mode: "structured",
        systemName: "Generic Embodied System",
        abstractionLevel: "multi-level",
        systemOverview: "No application mission has been selected.",
      }),
      (value) => { response = value; },
      () => {}
    );

    const result = JSON.parse(response);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.some((row) => row.fromFunction === replacementName || row.toFunction === replacementName)).toBe(true);
    expect(result.some((row) => row.fromFunction === "Monitor User Wellness" || row.toFunction === "Monitor User Wellness")).toBe(false);
    expect(result.find((row) => row.fromFunction === "Core Function 1")?.subsystem).toBe("Corrected Architecture Owner");
    const reviewBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    const reviewSystemPrompt = reviewBody.messages.find((message) => message.role === "system")?.content || "";
    expect(reviewSystemPrompt).toContain("high row count or connected graph is not evidence of quality");
    expect(reviewSystemPrompt).toContain("source function must actually produce");
    expect(reviewSystemPrompt).toContain("postCorrectionValidation");
  });

  it("runs one bounded rescue pass when a semantic rewrite reports unresolved interface defects", async () => {
    const functionNames = Array.from({ length: 20 }, (_, index) => `Platform Function ${index + 1}`);
    const blueprint = {
      scopeBoundary: "Generic Platform",
      externalActors: [],
      subsystems: Array.from({ length: 5 }, (_, subsystemIndex) => ({
        name: `Subsystem ${subsystemIndex + 1}`,
        functions: functionNames
          .slice(subsystemIndex * 4, subsystemIndex * 4 + 4)
          .map((name) => ({ name })),
      })),
      missionThreads: [functionNames],
      feedbackLoops: [[functionNames[19], functionNames[0]]],
    };
    const makeRow = (fromFunction, toFunction, index) => ({
      subsystem: `Subsystem ${Math.floor(functionNames.indexOf(fromFunction) / 4) + 1}`,
      fromFunction,
      fromDetails: `${fromFunction} performs a bounded platform responsibility using explicit inputs, outputs, state, and operational constraints.`,
      controlAction: `Typed platform interface ${index}`,
      controlDetails: `Transfers a typed platform payload on a defined trigger so ${toFunction} can update its owned behavior within timing constraints.`,
      toFunction,
      toDetails: `${toFunction} consumes the typed payload, updates its owned state, and produces a bounded platform output under explicit constraints.`,
    });
    const draftRows = functionNames.map((name, index) => (
      makeRow(name, functionNames[(index + 1) % functionNames.length], index + 1)
    ));
    draftRows.push(
      makeRow(functionNames[0], functionNames[4], 21),
      makeRow(functionNames[4], functionNames[8], 22),
      makeRow(functionNames[8], functionNames[12], 23),
      makeRow(functionNames[12], functionNames[16], 24)
    );
    const rejectedRows = draftRows.map((row) => ({
      ...row,
      fromFunction: row.fromFunction === functionNames[0] ? "Invented Convenience Feature" : row.fromFunction,
      toFunction: row.toFunction === functionNames[0] ? "Invented Convenience Feature" : row.toFunction,
    }));
    const rescuedControlAction = "Recovered Platform State Contract";
    const rescuedRows = draftRows.map((row, index) => ({
      ...row,
      controlAction: index === 0 ? rescuedControlAction : row.controlAction,
    }));
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify(blueprint)))
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify(draftRows)))
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify({
        reviewSummary: "A defect remains.",
        originalDraftFindings: {
          unsupportedAssumptions: [],
          missingIntrinsicCapabilities: [],
          invalidInterfaces: [],
          ownershipConflicts: [],
        },
        postCorrectionValidation: {
          domainFidelity: 2,
          decompositionDepth: 2,
          interfaceSemantics: 3,
          feedbackAndSafety: 2,
          systemBoundaries: 1,
          unsupportedAssumptionsRemaining: [],
          missingIntrinsicCapabilitiesRemaining: [],
          invalidInterfacesRemaining: [{ rowIndex: 1, reason: "Payload is not consumed by its target." }],
          ownershipConflictsRemaining: [],
        },
        rows: rejectedRows,
      })))
      .mockResolvedValueOnce(mockJsonResponse(JSON.stringify({
        reviewSummary: "Replaced the unsupported feature and repaired its interface contract.",
        originalDraftFindings: {
          unsupportedAssumptions: ["Invented Convenience Feature"],
          missingIntrinsicCapabilities: [],
          invalidInterfaces: [{ rowIndex: 1, reason: "Payload was not consumed by its target." }],
          ownershipConflicts: [],
        },
        postCorrectionValidation: {
          domainFidelity: 2,
          decompositionDepth: 2,
          interfaceSemantics: 3,
          feedbackAndSafety: 2,
          systemBoundaries: 1,
          unsupportedAssumptionsRemaining: [],
          missingIntrinsicCapabilitiesRemaining: [],
          invalidInterfacesRemaining: [],
          ownershipConflictsRemaining: [],
        },
        rows: rescuedRows,
      })));
    let response = "";
    let qualityReport = null;

    await handleLitePromptSubmit(
      JSON.stringify({
        mode: "structured",
        systemName: "Generic Platform",
        abstractionLevel: "multi-level",
        systemOverview: "Performs closed-loop platform operations.",
      }),
      (value) => { response = value; },
      () => {},
      { onQuality: (quality) => { qualityReport = quality; } }
    );

    const result = JSON.parse(response);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.some((row) => row.fromFunction === "Invented Convenience Feature" || row.toFunction === "Invented Convenience Feature")).toBe(false);
    expect(result.some((row) => row.controlAction === rescuedControlAction)).toBe(true);
    const rescueBody = JSON.parse(fetchMock.mock.calls[3][1].body);
    const rescuePrompt = rescueBody.messages.find((message) => message.role === "user")?.content || "";
    const rescueSystemPrompt = rescueBody.messages.find((message) => message.role === "system")?.content || "";
    expect(rescuePrompt).toContain("invalidInterfacesRemaining: row 1");
    expect(rescueSystemPrompt).toContain("single bounded rescue pass");
    expect(qualityReport).toEqual(expect.objectContaining({
      meetsTarget: true,
      semanticReviewAccepted: true,
      semanticRescueAttempted: true,
    }));
  });
});
