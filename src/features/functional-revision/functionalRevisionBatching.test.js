import {
  buildFunctionalRevisionBatches,
  isSystemicFunctionalRevisionRequest,
  mergeFunctionalRevisionPlans,
} from "./functionalRevisionBatching";

describe("functional revision batching", () => {
  it("recognizes systemic multi-level restructuring without capturing focused edits", () => {
    expect(isSystemicFunctionalRevisionRequest(
      "Apply the same child-level decomposition to every remaining internally owned parent group and replace superseded broad rows.",
    )).toBe(true);
    expect(isSystemicFunctionalRevisionRequest("Change row 4 Function To to Validate Route.")).toBe(false);
  });

  it("keeps owners together and preserves stable original row numbers", () => {
    const rows = [
      { subsystem: "A", fromFunction: "A1" },
      { subsystem: "A", fromFunction: "A2" },
      { subsystem: "B", fromFunction: "B1" },
      { subsystem: "C", fromFunction: "C1" },
    ];
    const batches = buildFunctionalRevisionBatches(rows, { maxRows: 2, maxChars: 10000 });
    expect(batches).toHaveLength(2);
    expect(batches[0].map((row) => row._revisionRowNumber)).toEqual([1, 2]);
    expect(batches[1].map((row) => row._revisionRowNumber)).toEqual([3, 4]);
  });

  it("merges successful plans and exposes partial batch failures", () => {
    const merged = mergeFunctionalRevisionPlans([
      { summary: "Updated A.", updateRows: [{ rowNumber: 1, changes: { fromFunction: "A1a" } }] },
      { summary: "Updated B.", removeRows: [{ rowNumber: 3 }] },
    ], [{ batchNumber: 3, message: "timed out" }]);
    expect(merged.updateRows).toHaveLength(1);
    expect(merged.removeRows).toHaveLength(1);
    expect(merged.questions).toContain("Revision batch 3 could not be completed: timed out");
  });
});
