jest.mock("../../components/backendConfig", () => ({
  backendURL: "https://api.example.test",
  buildAuthOpts: () => ({ headers: {}, credentials: "include" }),
  buildAIAuthOpts: () => ({ headers: {}, credentials: "include" }),
}));

const {
  deriveDesignElements,
  deriveSubsystemRequirements,
  deriveSystemRequirements,
  deriveSoftwareRequirements,
  importHazardSoftwareRequirements,
  shouldSplitFunctionalChunkAfterFailure,
  splitSoftwareRequirementsBySource,
} = require("./artifactAI");

describe("code architecture assurance artifact AI helpers", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("splits functional and hazard-derived software requirements by provenance", () => {
    const rows = [
      { id: "SWR-001", source: "functional-derived" },
      { id: "SWR-002", source: "functional-derived-fallback" },
      { id: "SWR-003", source: "ai-generated" },
      { id: "SWR-004", source: "manual" },
      { id: "SWR-SAFE-001", source: "hazard-derived", hazardSummaryRef: "HZ-001" },
      { id: "SWR-SAFE-002", requirementType: "Safety-Related", hazardAnalysisRunId: "run-1" },
    ];

    const { functionalRows, hazardRows } = splitSoftwareRequirementsBySource(rows);

    expect(functionalRows.map((row) => row.id)).toEqual(["SWR-001", "SWR-002", "SWR-003", "SWR-004"]);
    expect(hazardRows.map((row) => row.id)).toEqual(["SWR-SAFE-001", "SWR-SAFE-002"]);
  });

  it("splits multi-row functional chunks after large transient failures", () => {
    expect(shouldSplitFunctionalChunkAfterFailure({ status: 503 }, 9000, 0, 4)).toBe(true);
    expect(shouldSplitFunctionalChunkAfterFailure({ status: 503 }, 2000, 0, 4)).toBe(false);
    expect(shouldSplitFunctionalChunkAfterFailure({ status: 503 }, 9000, 2, 4)).toBe(false);
    expect(shouldSplitFunctionalChunkAfterFailure({ status: 413 }, 1000, 2, 4)).toBe(true);
    expect(shouldSplitFunctionalChunkAfterFailure({ status: 413 }, 1000, 0, 1)).toBe(false);
  });

  it("imports hazard requirements even when functional AI rows fall back", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 413,
      text: () => Promise.resolve("payload too large"),
    });

    const hazardAnalysis = {
      id: "haz-run-1",
      hazardMethod: "STPA-Textbook",
      generatedSheets: {
        Summary: [
          ["Safety Requirements/Constraints", "Hazards", "Trace ID", "Control Action"],
          ["prevent unsafe stop command", "Unexpected stop", "FD-1", "stop command"],
        ],
      },
    };

    const rows = await deriveSoftwareRequirements({
      cbaRows: [{
        rowRef: "1",
        traceId: "FD-1",
        from: "Planner",
        action: "stop command",
        to: "Controller",
      }],
      hazardAnalysis,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].source).toBe("functional-derived-fallback");
    expect(rows[1].source).toBe("hazard-derived");
    expect(rows[1].hazardAnalysisRunId).toBe("haz-run-1");
  });

  it("reports functional and hazard software requirement counts during final import", async () => {
    global.fetch = jest.fn().mockImplementation((url, options = {}) => {
      const body = JSON.parse(options.body || "{}");
      const payload = JSON.parse(body.messages?.[1]?.content || "{}");
      const requirements = Array.from({ length: payload.rowCount || 0 }, (_, index) => ({
        id: `SWR-${index + 1}`,
        requirementText: `The software shall support behavior ${index + 1}.`,
        sourceTraceId: `FD-${index + 1}`,
      }));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ answer: JSON.stringify({ requirements }) }),
      });
    });
    const onProgress = jest.fn();

    await deriveSoftwareRequirements({
      cbaRows: [
        { rowRef: "1", traceId: "FD-1", from: "Planner", action: "plan", to: "Controller" },
        { rowRef: "2", traceId: "FD-2", from: "Controller", action: "command", to: "Actuator" },
      ],
      hazardAnalysis: {
        generatedSheets: {
          Summary: [
            ["Safety Requirements/Constraints", "Hazards", "Trace ID"],
            ["reject stale commands", "Stale command", "FD-2"],
          ],
        },
      },
      onProgress,
    });

    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: "Hazard requirement import",
      message: "Combining 2 functional software requirements with 1 hazard-derived software requirement (3 total before merge).",
    }));
  });

  it("renumbers repeated AI software requirement ids across prompt batches", async () => {
    global.fetch = jest.fn().mockImplementation((url, options = {}) => {
      const body = JSON.parse(options.body || "{}");
      const payload = JSON.parse(body.messages?.[1]?.content || "{}");
      const requirements = Array.from({ length: payload.rowCount || 0 }, (_, index) => ({
        id: `SW-${index + 1}`,
        requirementText: `The software shall handle generated behavior ${payload.rowStart + index}.`,
        derivedFromFunction: `Function ${payload.rowStart + index}`,
        derivedFromInterface: `action ${payload.rowStart + index}`,
        requirementType: "Functional",
        priority: "Medium",
        rationale: "AI generated test row",
        sourceTraceId: `FD-${payload.rowStart + index}`,
      }));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ answer: JSON.stringify({ requirements }) }),
      });
    });

    const rows = await deriveSoftwareRequirements({
      cbaRows: Array.from({ length: 7 }, (_, index) => ({
        rowRef: String(index + 1),
        traceId: `FD-${index + 1}`,
        from: `Function ${index + 1}`,
        action: `action ${index + 1}`,
        to: `Target ${index + 1}`,
      })),
    });

    expect(rows.map((row) => row.id)).toEqual([
      "SWR-001",
      "SWR-002",
      "SWR-003",
      "SWR-004",
      "SWR-005",
      "SWR-006",
      "SWR-007",
    ]);
    expect(new Set(rows.map((row) => row.internalId)).size).toBe(rows.length);
  });

  it("imports hazard software requirements from summary rows without AI", () => {
    const rows = importHazardSoftwareRequirements({
      hazardAnalysis: {
        generatedSheets: {
          Summary: [
            ["System Requirement", "Losses", "Trace ID"],
            ["The system shall prevent stale control data", "Loss of control", "FD-2"],
            ["The system must reject stale control data", "Loss of control", "FD-3"],
            ["The software shall the system must validate operator input", "Loss of control", "FD-4"],
          ],
        },
      },
    });

    expect(rows).toHaveLength(3);
    expect(rows[0].source).toBe("hazard-derived");
    expect(rows[0].requirementText).toMatch(/^The software shall prevent stale control data/);
    expect(rows[1].requirementText).toMatch(/^The software shall reject stale control data/);
    expect(rows[2].requirementText).toMatch(/^The software shall validate operator input/);
  });

  it("imports only Yes-tagged hazard requirements and excludes historical No or Needs Review tags", () => {
    const rows = importHazardSoftwareRequirements({
      hazardAnalysis: {
        generatedSheets: {
          Summary: [
            ["Safety Requirements/Constraints", "Hazards", "Trace ID", "Safety Significant", "Safety Significance Rationale"],
            ["prevent loss of control", "Loss of control", "FD-1", "Yes", "Credible safety consequence"],
            ["log malformed debug payloads", "Debug log issue", "FD-2", "No", "Routine reliability issue"],
            ["review ambiguous behavior", "Ambiguous issue", "FD-3", "Needs Review", "Insufficient context"],
          ],
        },
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].requirementText).toMatch(/^The software shall prevent loss of control/);
    expect(rows[0].safetySignificant).toBe("Yes");
    expect(rows[0].safetySignificanceRationale).toBe("Credible safety consequence");
  });

  it("derives stronger safety artifacts instead of raw code-symbol requirements", async () => {
    global.fetch = jest.fn().mockImplementation((url, options = {}) => {
      const body = JSON.parse(options.body || "{}");
      const payload = JSON.parse(body.messages?.[1]?.content || "{}");
      const json = (value) => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ answer: JSON.stringify(value) }),
      });
      if (payload.task === "derive_system_requirements_from_hazard_software_requirements") {
        return json({ requirements: [{
          id: "SYS-SAFE-001",
          requirementText: "The system shall reject out-of-range simulation configuration before execution commands are accepted by the execution controller.",
          derivedFrom: "Hazard-Derived Software Requirement",
          parentSwRequirement: "SWR-SAFE-001",
          rationale: "Prevents unsafe actuator behavior caused by invalid simulation parameters.",
          verificationMethod: "Test",
        }] });
      }
      if (payload.task === "categorize_system_requirements_for_subsystem_requirements" ||
        payload.task === "review_subsystem_requirements_categories") {
        return json({ categories: [{
          id: "CAT-SUB-001",
          categoryName: "Simulation Parameter Rejection",
          requirementIntent: "reject out-of-range simulation configuration before execution commands are accepted by the execution controller",
          parentSystemRequirement: "SYS-SAFE-001",
          subsystem: "Simulation Safety",
          allocatedFunction: "simulation parameter validation",
          allocatedArchitecture: "Runtime Validation / Parameter Gate / Range Check",
        }] });
      }
      if (payload.task === "derive_subsystem_requirements_from_reviewed_system_requirement_categories") {
        return json({ requirements: [{
          id: "SUB-SAFE-001",
          subsystem: "Simulation Safety",
          requirementText: "The Simulation Safety subsystem shall perform simulation parameter validation by checking parameter ranges and rejecting invalid configuration before enabling execution controller commands.",
          parentSystemRequirement: "SYS-SAFE-001",
          allocatedFunction: "simulation parameter validation",
          allocatedArchitecture: "Runtime Validation / Parameter Gate / Range Check",
          rationale: "Allocates the safety gate to the subsystem that owns simulation validation.",
          verificationMethod: "Test",
        }] });
      }
      if (payload.task === "categorize_subsystem_requirements_for_system_subsystem_design_elements" ||
        payload.task === "review_system_subsystem_design_elements_categories") {
        return json({ categories: [{
          id: "CAT-DES-001",
          categoryName: "Simulation Parameter Gate",
          requirementIntent: "validate simulation parameter ranges and reject invalid configuration before enabling execution controller commands",
          parentRequirement: "SUB-SAFE-001",
          subsystem: "Simulation Safety",
          allocatedFunction: "simulation parameter validation",
          allocatedArchitecture: "Runtime Validation / Parameter Gate / Range Check",
        }] });
      }
      if (payload.task === "derive_system_subsystem_design_from_reviewed_subsystem_requirement_categories") {
        return json({ designElements: [{
          id: "DES-SAFE-001",
          designElementName: "SimulationParameterGate",
          designLevel: "Subsystem",
          description: "The SimulationParameterGate component performs simulation parameter validation by checking configured simulation ranges, rejecting invalid values, and withholding execution-controller enablement until the configuration passes validation.",
          parentRequirement: "SUB-SAFE-001",
          allocatedFunction: "simulation parameter validation",
          allocatedArchitecture: "Runtime Validation / Parameter Gate / Range Check",
          interfaceDependencies: "Simulation Configuration, Execution Controller",
          designRationale: "Centralizes validation before execution control is enabled.",
          linkedSourceCode: "",
        }] });
      }
      return Promise.resolve({
        ok: false,
        status: 400,
        text: () => Promise.resolve(`unexpected task ${payload.task}`),
      });
    });

    const softwareRequirements = [{
      id: "SWR-SAFE-001",
      requirementText: "The software shall verify simulation parameters against expected ranges before execution.",
      requirementType: "Safety-Related",
      linkedHazards: "HZ-001",
      hazardSummaryRef: "HZ-001",
      parentHazard: "out-of-range simulation parameters causing unsafe actuator behavior",
      mitigationStrategy: "reject out-of-range, missing, or malformed simulation parameters before execution",
      linkedVerification: "Test",
      derivedFromFunction: "__init__",
      derivedFromInterface: "simulation parameter validation",
      source: "hazard-derived",
      sourceArchitectureRefs: [{
        rowIndex: 0,
        rowRef: "1",
        traceId: "FD-1",
        fromFunction: "Simulation Configuration",
        controlAction: "simulation parameter validation",
        toFunction: "Execution Controller",
        subsystem: "Simulation Safety",
        csci: "Runtime Validation",
        csc: "Parameter Gate",
        csu: "Range Check",
        mode: "edge",
      }],
    }];

    const systemRows = await deriveSystemRequirements({ softwareRequirements });
    expect(systemRows[0].requirementText).toContain("out-of-range simulation configuration");
    expect(systemRows[0].requirementText).toContain("execution controller");
    expect(systemRows[0].requirementText).not.toContain("__init__");
    expect(systemRows[0].requirementText).not.toMatch(/detect and control/i);
    expect(systemRows[0].requirementText).not.toMatch(/maintain safe operation for/i);
    expect(systemRows[0].requirementText).not.toMatch(/derived from code architecture hazard analysis/i);

    const subsystemRows = await deriveSubsystemRequirements({ systemRequirements: systemRows });
    expect(subsystemRows[0].requirementText).toContain("simulation parameter validation");
    expect(subsystemRows[0].requirementText).not.toContain("__init__");
    expect(subsystemRows[0].requirementText).not.toMatch(/maintain allocated safety behavior/i);

    const designRows = await deriveDesignElements({ subsystemRequirements: subsystemRows });
    expect(designRows[0].description).toContain("simulation parameter validation");
    expect(designRows[0].description).not.toContain("__init__");
    expect(designRows[0].description).not.toMatch(/satisfy __init__/i);
  });
});
