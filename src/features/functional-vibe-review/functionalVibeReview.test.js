import {
  applyFunctionalSubsystemReallocation,
  applyFunctionalReviewToCodeArchitectureRow,
  buildFunctionalVibeReviewChoicePrompt,
  ensureFunctionalVibeReviewRowIds,
  isFunctionalVibeReviewIntent,
  normalizeCodeArchitectureFunctionalReviewRow,
  normalizeFunctionalVibeReviewProposal,
  resolveFunctionalVibeReviewScope,
} from "./functionalVibeReview";

const rows = [
  { rowId: "row-a", rowIndex: 0, row: { subsystem: "Planning", fromFunction: "Plan Route", fromDetails: "Builds a route.", controlAction: "Planned Route", controlDetails: "Route geometry and constraints.", toFunction: "Validate Route", toDetails: "Checks feasibility." } },
  { rowId: "row-b", rowIndex: 1, row: { subsystem: "Control", fromFunction: "Validate Route", fromDetails: "Checks feasibility.", controlAction: "Validated Route", controlDetails: "Approved route and limits.", toFunction: "Track Route", toDetails: "Generates commands." } },
];

test("recognizes functional vibe review without confusing ordinary generation", () => {
  expect(isFunctionalVibeReviewIntent("Vibe review the current functional decomposition one row at a time")).toBe(true);
  expect(isFunctionalVibeReviewIntent("Create a functional decomposition for a rover")).toBe(false);
  expect(isFunctionalVibeReviewIntent("Let's vibe review the CSU column items")).toBe(true);
  expect(isFunctionalVibeReviewIntent("lets vibe review the items marked Needs Review under Lifecycle Phase")).toBe(true);
  expect(isFunctionalVibeReviewIntent("Vibe review Needs Review items under Interface Type")).toBe(true);
  expect(isFunctionalVibeReviewIntent("Vibe review Needs Review items under Hazard Analysis Eligibility")).toBe(true);
});

test("reviews Code-Based Architecture hierarchy columns as functional-decomposition scope", () => {
  const cbaRows = [
    { rowId: "cba-1", rowIndex: 0, row: { ...rows[0].row, csci: "Runtime", csc: "Encoding", csu: "MLP Encoder" } },
    { rowId: "cba-2", rowIndex: 1, row: { ...rows[1].row, csci: "Runtime", csc: "Control", csu: "Route Tracker" } },
  ];
  const allCsus = resolveFunctionalVibeReviewScope("Vibe review the CSU column items", cbaRows);
  expect(allCsus.queue).toEqual(["cba-1", "cba-2"]);
  expect(allCsus.scopeLabel).toBe("CSU column items");

  const oneCsu = resolveFunctionalVibeReviewScope("Vibe review CSU Route Tracker", cbaRows);
  expect(oneCsu.queue).toEqual(["cba-2"]);
  expect(oneCsu.scopeLabel).toBe("CSU = Route Tracker");
});

test("prefers an exact CSU allocation over a shorter name contained within it", () => {
  const cbaRows = [
    { rowId: "short", rowIndex: 0, row: { ...rows[0].row, csu: "Alpamayo2Super" } },
    { rowId: "long", rowIndex: 1, row: { ...rows[1].row, csu: "Alpamayo2SuperConfig" } },
  ];
  const result = resolveFunctionalVibeReviewScope(
    "Vibe review functional-decomposition rows where CSU is Alpamayo2SuperConfig.",
    cbaRows,
  );
  expect(result.status).toBe("matched");
  expect(result.queue).toEqual(["long"]);
  expect(result.scopeLabel).toBe("CSU = Alpamayo2SuperConfig");
});

test("scopes a Code-Based Architecture functional review to eligibility items marked Needs Review", () => {
  const cbaRows = [
    { rowId: "include", rowIndex: 0, row: { ...rows[0].row, hazardAnalysisEligibility: "Include" } },
    { rowId: "review", rowIndex: 1, row: { ...rows[1].row, hazardAnalysisEligibility: "Needs Review" } },
    { rowId: "exclude", rowIndex: 2, row: { ...rows[0].row, hazardAnalysisEligibility: "Exclude" } },
  ];
  const result = resolveFunctionalVibeReviewScope(
    "Vibe review the functional decomposition Eligibility items marked Needs Review.",
    cbaRows,
  );
  expect(result.status).toBe("matched");
  expect(result.queue).toEqual(["review"]);
  expect(result.scopeLabel).toBe("Hazard Analysis Eligibility = Needs Review");
});

test("treats Include as the eligibility scope even when the review instructions use exclude as a verb", () => {
  const cbaRows = [
    { rowId: "include-a", rowIndex: 0, row: { ...rows[0].row, controlAction: "Call", hazardAnalysisEligibility: "Include" } },
    { rowId: "exclude", rowIndex: 1, row: { ...rows[1].row, hazardAnalysisEligibility: "Exclude" } },
    { rowId: "include-b", rowIndex: 2, row: { ...rows[1].row, controlAction: "Trajectory Output", hazardAnalysisEligibility: "Include" } },
  ];
  const prompt = "Vibe review all functional-decomposition rows marked Include for Hazard Analysis Eligibility. Determine whether each row represents a consequential operational interface suitable for STPA rather than an internal library call or implementation detail. Consolidate low-level tensor, geometry, token, and helper calls into their parent operational transformations where appropriate. Verify interface direction, remove semantic duplicates, exclude test/training-only behavior unless explicitly in scope.";
  const result = resolveFunctionalVibeReviewScope(
    prompt,
    cbaRows,
  );
  expect(result.status).toBe("matched");
  expect(result.queue).toEqual(["include-a", "include-b"]);
  expect(result.scopeLabel).toBe("Hazard Analysis Eligibility = Include");
});

test("replays a functional scope choice with a user-facing field label", () => {
  const prompt = buildFunctionalVibeReviewChoicePrompt("hazardAnalysisEligibility", "Include");
  expect(prompt).toBe("Vibe review functional-decomposition rows where Hazard Analysis Eligibility is Include.");
  const result = resolveFunctionalVibeReviewScope(prompt, [
    { rowId: "include", rowIndex: 0, row: { ...rows[0].row, hazardAnalysisEligibility: "Include" } },
    { rowId: "exclude", rowIndex: 1, row: { ...rows[1].row, hazardAnalysisEligibility: "Exclude" } },
  ]);
  expect(result.queue).toEqual(["include"]);
});

test("scopes a quoted Lifecycle Phase column request to Needs Review only", () => {
  const cbaRows = [
    { rowId: "configuration", rowIndex: 0, row: { ...rows[0].row, lifecyclePhase: "Configuration" } },
    { rowId: "review-a", rowIndex: 1, row: { ...rows[1].row, lifecyclePhase: "Needs Review" } },
    { rowId: "runtime", rowIndex: 2, row: { ...rows[0].row, lifecyclePhase: "Runtime" } },
    { rowId: "review-b", rowIndex: 3, row: { ...rows[1].row, lifecyclePhase: "Needs Review" } },
  ];
  const result = resolveFunctionalVibeReviewScope(
    'Vibe review the functional decomposition table column "Lifecycle Phase=NEEDS REVIEW"',
    cbaRows,
  );
  expect(result.status).toBe("matched");
  expect(result.queue).toEqual(["review-a", "review-b"]);
  expect(result.scopeLabel).toBe("Lifecycle Phase = Needs Review");
  expect(result.reviewFields).toEqual(["lifecyclePhase"]);
});

test("scopes the conversational Lifecycle Phase request used by Collaborator", () => {
  const cbaRows = [
    { rowId: "static", rowIndex: 0, row: { ...rows[0].row, lifecyclePhase: "Static Structure" } },
    { rowId: "review", rowIndex: 1, row: { ...rows[1].row, lifecyclePhase: "Needs Review" } },
  ];
  const result = resolveFunctionalVibeReviewScope(
    "lets vibe review the items marked Needs Review under Lifecycle Phase",
    cbaRows,
  );
  expect(result.status).toBe("matched");
  expect(result.queue).toEqual(["review"]);
  expect(result.scopeLabel).toBe("Lifecycle Phase = Needs Review");
});

test("uses the table's Needs Review default when lifecycle classification is blank", () => {
  const cbaRows = [
    { rowId: "unclassified", rowIndex: 0, row: { ...rows[0].row, lifecyclePhase: "" } },
    { rowId: "runtime", rowIndex: 1, row: { ...rows[1].row, lifecyclePhase: "Runtime" } },
  ];
  const result = resolveFunctionalVibeReviewScope(
    'Vibe review the functional decomposition table column "Lifecycle Phase=NEEDS REVIEW"',
    cbaRows,
  );
  expect(result.status).toBe("matched");
  expect(result.queue).toEqual(["unclassified"]);
  expect(result.scopeLabel).toBe("Lifecycle Phase = Needs Review");
});

test("carries multiple explicitly requested review columns", () => {
  const cbaRows = [
    { rowId: "both", rowIndex: 0, row: { ...rows[0].row, lifecyclePhase: "Needs Review", interfaceType: "Needs Review" } },
    { rowId: "lifecycle-only", rowIndex: 1, row: { ...rows[1].row, lifecyclePhase: "Needs Review", interfaceType: "Data" } },
  ];
  const result = resolveFunctionalVibeReviewScope(
    "Vibe review the Lifecycle Phase and Interface Type columns where both are Needs Review",
    cbaRows,
  );
  expect(result.status).toBe("matched");
  expect(result.queue).toEqual(["both"]);
  expect(result.reviewFields).toEqual(["lifecyclePhase", "interfaceType"]);
});

test("normalizes and reapplies Code-Based Architecture functional rows without losing hierarchy", () => {
  const source = {
    from: "Encode Input",
    fromDetails: "Encodes input features.",
    action: "Feature Embedding",
    controlActionDetails: "Embedding vector.",
    to: "Run Inference",
    toDetails: "Consumes the embedding.",
    architecture: { subsystem: "Inference", csci: "Runtime", csc: "Encoding", csu: "Old CSU", rationale: "Initial allocation." },
    lifecyclePhase: "Needs Review",
    interfaceType: "Function Call",
    hazardAnalysisEligibility: "Needs Review",
    hazardAnalysisEligibilityRationale: "Operational consequence is unclear.",
    hazardAnalysisEligibilitySource: "deterministic",
    traceId: "FD-CBA-1",
  };
  const normalized = normalizeCodeArchitectureFunctionalReviewRow(source);
  expect(normalized).toMatchObject({
    fromFunction: "Encode Input",
    csu: "Old CSU",
    csci: "Runtime",
    hazardAnalysisEligibility: "Needs Review",
  });

  const updated = applyFunctionalReviewToCodeArchitectureRow(source, {
    ...normalized,
    csu: "MLP Encoder",
    architectureRationale: "Owns feature projection.",
    lifecyclePhase: "Runtime",
    hazardAnalysisEligibility: "Include",
    hazardAnalysisEligibilityRationale: "Runtime feature projection affects inference outputs.",
  });
  expect(updated.architecture).toMatchObject({ csci: "Runtime", csc: "Encoding", csu: "MLP Encoder", rationale: "Owns feature projection." });
  expect(updated).toMatchObject({
    lifecyclePhase: "Runtime",
    interfaceType: "Function Call",
    hazardAnalysisEligibility: "Include",
    hazardAnalysisEligibilitySource: "analyst-override",
  });
  expect(updated.traceId).toBe("FD-CBA-1");
});

test("defaults a functional vibe review to all rows and supports a subsystem scope", () => {
  expect(resolveFunctionalVibeReviewScope("Vibe review the functional decomposition", rows).queue).toEqual(["row-a", "row-b"]);
  const scoped = resolveFunctionalVibeReviewScope("Vibe review functional decomposition rows in subsystem Planning", rows);
  expect(scoped.queue).toEqual(["row-a"]);
  expect(scoped.scopeLabel).toBe("Subsystem = Planning");
});

test("supports free-form contextual content and row-range scopes", () => {
  const contentScope = resolveFunctionalVibeReviewScope(
    "Vibe review the current functional decomposition one row at a time. Limit the review to this user-specified scope: validated route with approved route limits",
    rows,
  );
  expect(contentScope.queue).toEqual(["row-b"]);

  const rangeScope = resolveFunctionalVibeReviewScope(
    "Vibe review the current functional decomposition one row at a time. Limit the review to this user-specified scope: rows 1 through 1",
    rows,
  );
  expect(rangeScope.queue).toEqual(["row-a"]);
});

test("adds stable internal review IDs without replacing existing IDs", () => {
  const existing = { ...rows[0].row, _functionalVibeReviewId: "existing" };
  const result = ensureFunctionalVibeReviewRowIds([existing, rows[1].row]);
  expect(result.changed).toBe(true);
  expect(result.rows[0]._functionalVibeReviewId).toBe("existing");
  expect(result.rows[1]._functionalVibeReviewId).toMatch(/^FDR-/);
});

test("atomically reallocates every row owned by the same source function", () => {
  const sourceRows = [
    {
      ...rows[0].row,
      _functionalVibeReviewId: "health-a",
      subsystem: "Health & Fault Management",
      fromFunction: "Monitor Vehicle Health",
      controlAction: "Vehicle Health Status",
      toFunction: "Coordinate Vehicle Operation",
    },
    {
      ...rows[0].row,
      _functionalVibeReviewId: "health-b",
      subsystem: "Health & Fault Management",
      fromFunction: "Monitor Vehicle Health",
      controlAction: "Fault Alert",
      toFunction: "Enter Minimum Risk State",
    },
    {
      ...rows[1].row,
      _functionalVibeReviewId: "unrelated",
      subsystem: "Motion Control",
    },
  ];
  const nextRow = { ...sourceRows[0], subsystem: "Vehicle Control & Safety" };
  const result = applyFunctionalSubsystemReallocation(sourceRows, { rowIndex: 0, nextRow });

  expect(result.propagated).toBe(true);
  expect(result.rows.map((row) => row.subsystem)).toEqual([
    "Vehicle Control & Safety",
    "Vehicle Control & Safety",
    "Motion Control",
  ]);
  expect(result.rows[1].controlAction).toBe("Fault Alert");
  expect(result.affectedRows).toHaveLength(2);
  expect(result.affectedRows[0].propagated).toBe(false);
  expect(result.affectedRows[1]).toMatchObject({ rowId: "health-b", propagated: true });
  expect(result.affectedRows[1].previousRow.subsystem).toBe("Health & Fault Management");
});

test("does not propagate a subsystem edit when the proposed function label also changes", () => {
  const sourceRows = [
    { ...rows[0].row, _functionalVibeReviewId: "one", subsystem: "Planning" },
    { ...rows[0].row, _functionalVibeReviewId: "two", subsystem: "Planning", controlAction: "Alternate Route" },
  ];
  const nextRow = { ...sourceRows[0], subsystem: "Vehicle Control", fromFunction: "Command Vehicle Motion" };
  const result = applyFunctionalSubsystemReallocation(sourceRows, { rowIndex: 0, nextRow });

  expect(result.propagated).toBe(false);
  expect(result.rows[0]).toEqual(nextRow);
  expect(result.rows[1].subsystem).toBe("Planning");
  expect(result.affectedRows).toHaveLength(1);
});

test("requires a complete changed row for a Revise proposal", () => {
  const current = rows[0].row;
  const valid = normalizeFunctionalVibeReviewProposal({
    decision: "Revise",
    rationale: "The receiver should be the leaf validator.",
    proposedRow: { ...current, toFunction: "Check Route Feasibility" },
  }, current);
  expect(valid.valid).toBe(true);
  expect(valid.proposal.changedFields).toEqual(["toFunction"]);

  const incomplete = normalizeFunctionalVibeReviewProposal({ decision: "Revise", proposedRow: { toFunction: "Check Route" } }, current);
  expect(incomplete.valid).toBe(false);
  expect(incomplete.errors[0]).toMatch(/omitted/i);
});

test("accepts a grounded CSU-only revision while preserving the seven interface fields", () => {
  const current = { ...rows[0].row, csci: "Runtime", csc: "Planning", csu: "Generic Unit", architectureRationale: "Initial." };
  const result = normalizeFunctionalVibeReviewProposal({
    decision: "Revise",
    rationale: "The source behavior belongs to route validation.",
    proposedRow: { ...current, csu: "Route Validation" },
  }, current);
  expect(result.valid).toBe(true);
  expect(result.proposal.changedFields).toEqual(["csu"]);
});

test("accepts an eligibility-only revision while preserving the functional interface", () => {
  const current = {
    ...rows[0].row,
    lifecyclePhase: "Needs Review",
    interfaceType: "Function Call",
    hazardAnalysisEligibility: "Needs Review",
    hazardAnalysisEligibilityRationale: "Operational consequence is unclear.",
  };
  const result = normalizeFunctionalVibeReviewProposal({
    decision: "Revise",
    rationale: "The runtime call affects route validation.",
    proposedRow: {
      ...current,
      lifecyclePhase: "Runtime",
      hazardAnalysisEligibility: "Include",
      hazardAnalysisEligibilityRationale: "Runtime validation can affect the route consumed by control.",
    },
  }, current);
  expect(result.valid).toBe(true);
  expect(result.proposal.changedFields).toEqual([
    "lifecyclePhase",
    "hazardAnalysisEligibility",
    "hazardAnalysisEligibilityRationale",
  ]);
});

test("normalizes Keep and Remove decisions without fabricating revisions", () => {
  expect(normalizeFunctionalVibeReviewProposal({ decision: "Keep", rationale: "Sound." }, rows[0].row).proposal.decision).toBe("Keep");
  expect(normalizeFunctionalVibeReviewProposal({ decision: "Remove", rationale: "Duplicate." }, rows[0].row).proposal.decision).toBe("Remove");
});
