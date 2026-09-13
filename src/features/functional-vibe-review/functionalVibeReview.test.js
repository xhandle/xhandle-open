import {
  applyFunctionalReviewToCodeArchitectureRow,
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

test("normalizes and reapplies Code-Based Architecture functional rows without losing hierarchy", () => {
  const source = {
    from: "Encode Input",
    fromDetails: "Encodes input features.",
    action: "Feature Embedding",
    controlActionDetails: "Embedding vector.",
    to: "Run Inference",
    toDetails: "Consumes the embedding.",
    architecture: { subsystem: "Inference", csci: "Runtime", csc: "Encoding", csu: "Old CSU", rationale: "Initial allocation." },
    traceId: "FD-CBA-1",
  };
  const normalized = normalizeCodeArchitectureFunctionalReviewRow(source);
  expect(normalized).toMatchObject({ fromFunction: "Encode Input", csu: "Old CSU", csci: "Runtime" });

  const updated = applyFunctionalReviewToCodeArchitectureRow(source, { ...normalized, csu: "MLP Encoder", architectureRationale: "Owns feature projection." });
  expect(updated.architecture).toMatchObject({ csci: "Runtime", csc: "Encoding", csu: "MLP Encoder", rationale: "Owns feature projection." });
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

test("normalizes Keep and Remove decisions without fabricating revisions", () => {
  expect(normalizeFunctionalVibeReviewProposal({ decision: "Keep", rationale: "Sound." }, rows[0].row).proposal.decision).toBe("Keep");
  expect(normalizeFunctionalVibeReviewProposal({ decision: "Remove", rationale: "Duplicate." }, rows[0].row).proposal.decision).toBe("Remove");
});
