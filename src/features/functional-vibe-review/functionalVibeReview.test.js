import {
  ensureFunctionalVibeReviewRowIds,
  isFunctionalVibeReviewIntent,
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
});

test("defaults a functional vibe review to all rows and supports a subsystem scope", () => {
  expect(resolveFunctionalVibeReviewScope("Vibe review the functional decomposition", rows).queue).toEqual(["row-a", "row-b"]);
  const scoped = resolveFunctionalVibeReviewScope("Vibe review functional decomposition rows in subsystem Planning", rows);
  expect(scoped.queue).toEqual(["row-a"]);
  expect(scoped.scopeLabel).toBe("Subsystem = Planning");
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

test("normalizes Keep and Remove decisions without fabricating revisions", () => {
  expect(normalizeFunctionalVibeReviewProposal({ decision: "Keep", rationale: "Sound." }, rows[0].row).proposal.decision).toBe("Keep");
  expect(normalizeFunctionalVibeReviewProposal({ decision: "Remove", rationale: "Duplicate." }, rows[0].row).proposal.decision).toBe("Remove");
});

