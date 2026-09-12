import { isHazardVibeReviewIntent, resolveHazardVibeReviewScope } from "./vibeReviewScope";

const summary = [
  ["Raw Analysis Row ID", "Safety Significant", "Safety Classification", "Subsystem Allocation", "Function (From)", "Control Action", "Function (To)", "Guide Phrase", "Operational Scenario", "Operational Mode"],
  ["row-2", "Needs Review", "Needs Review", "Braking", "Planner", "Brake request", "Controller", "Not provided", "Wet road", "Auto"],
  ["row-1", "Yes", "Safety — Direct", "Steering", "Planner", "Steer request", "Controller", "Too late", "Wet road", "Auto"],
  ["row-2", "Needs Review", "Needs Review", "Braking", "Planner", "Brake request", "Controller", "Not provided", "Wet road", "Auto"],
  ["row-3", "No", "Mission/Reliability", "Telemetry", "Reporter", "Status", "Cloud", "Incorrect", "Depot", "Parked"],
];

test.each(["Vibe review the hazard-analysis rows where Safety Significance is Needs Review", "review these hazard results with me", "walk me through Needs Review safety significance rows"])("recognizes hazard review intent: %s", (prompt) => {
  expect(isHazardVibeReviewIntent(prompt)).toBe(true);
});

test("asks for scope instead of implicitly queueing an entire analysis", () => {
  const result = resolveHazardVibeReviewScope("review these hazard results with me", summary);
  expect(result.status).toBe("needs_scope");
  expect(result.queue).toEqual([]);
});

test("does not treat proposed Yes or No actions as Safety Significant filters", () => {
  const result = resolveHazardVibeReviewScope(
    "Vibe review the current project's hazard-analysis rows where Safety Significance is marked Needs Review. Review them one at a time, briefly explain each row, and propose an assessment of Yes or No.",
    summary,
  );
  expect(result.status).toBe("matched");
  expect(result.filters).toEqual([
    expect.objectContaining({ field: "safetySignificant", value: "Needs Review" }),
  ]);
});

test("accepts the canonical Safety Significant selector handoff", () => {
  const result = resolveHazardVibeReviewScope(
    "Vibe review hazard-analysis rows where Safety Significant is Needs Review.",
    summary,
  );
  expect(result.status).toBe("matched");
  expect(result.scopeLabel).toContain("Safety Significant = Needs Review");
});

test("accepts an explicit Yes Safety Significance scope", () => {
  const result = resolveHazardVibeReviewScope(
    "Vibe review hazard-analysis rows where Safety Significance is Yes.",
    summary,
  );
  expect(result.status).toBe("matched");
  expect(result.queue).toEqual(["row-1"]);
});

test("allows an explicit request to review every row", () => {
  const result = resolveHazardVibeReviewScope("Vibe review all hazard analysis rows", summary);
  expect(result.status).toBe("matched");
  expect(result.queue).toEqual(["row-2", "row-1", "row-3"]);
});

test("does not confuse Guide Phrase Applicable with the Guide Phrase column", () => {
  const applicableSummary = summary.map((row, index) => index === 0
    ? [...row, "Guide Phrase Applicable"]
    : [...row, index === 1 || index === 3 ? "Needs Review" : "Yes"]);
  const result = resolveHazardVibeReviewScope("Vibe review Guide Phrase Applicable Needs Review rows", applicableSummary);
  expect(result.status).toBe("matched");
  expect(result.queue).toEqual(["row-2"]);
  expect(result.filters.map((filter) => filter.field)).toEqual(["guidePhraseApplicable"]);
});

test("does not confuse functional decomposition creation with hazard review", () => {
  expect(isHazardVibeReviewIntent("create a functional decomposition for the braking subsystem")).toBe(false);
});

test("resolves canonical combined filters and snapshots stable IDs in table order", () => {
  const result = resolveHazardVibeReviewScope("Vibe review Safety Significant Needs Review in subsystem Braking for scenario Wet road", summary);
  expect(result.status).toBe("matched");
  expect(result.queue).toEqual(["row-2"]);
  expect(result.filters.map((filter) => filter.field)).toEqual(expect.arrayContaining(["safetySignificant", "subsystem", "scenario"]));
});

test("does not interpret arbitrary prose as a subsystem", () => {
  const result = resolveHazardVibeReviewScope("Vibe review the Needs Review rows and explain them briefly", summary);
  expect(result.status).toBe("matched");
  expect(result.filters).toHaveLength(1);
});

test("returns actual nearby values for an unmatched explicit scope", () => {
  const result = resolveHazardVibeReviewScope("Vibe review subsystem Propulsion", summary);
  expect(result.status).toBe("zero");
  expect(result.nearbyValues.subsystem).toContain("Braking");
});
