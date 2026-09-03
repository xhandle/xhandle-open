import {
  UNSPECIFIED_HAZARD_CONTEXT_ID,
  buildHazardOperationalContextPrompt,
  getEffectiveHazardOperationalContexts,
  getHazardContextRowKey,
  normalizeHazardOperationalContexts,
} from "./hazardOperationalContexts";

describe("hazard operational contexts", () => {
  it("uses a generic context when a project has no configured contexts", () => {
    expect(getEffectiveHazardOperationalContexts([])).toEqual([
      expect.objectContaining({ id: UNSPECIFIED_HAZARD_CONTEXT_ID }),
    ]);
  });

  it("normalizes valid scenario and mode combinations", () => {
    expect(normalizeHazardOperationalContexts([
      { id: "urban", scenario: " Urban intersection ", mode: " Autonomous ", conditions: " Rain " },
      { id: "invalid", scenario: "Missing mode" },
    ])).toEqual([
      { id: "urban", scenario: "Urban intersection", mode: "Autonomous", conditions: "Rain", assumptions: "" },
    ]);
  });

  it("uses context ids in stable row keys", () => {
    expect(getHazardContextRowKey(2, 3, "urban/autonomous"))
      .toBe("2:guide:3:context:urban%2Fautonomous");
  });

  it("formats scenario, mode, conditions, and assumptions for the model", () => {
    const prompt = buildHazardOperationalContextPrompt([
      { id: "urban", scenario: "Urban intersection", mode: "Autonomous", conditions: "Wet road", assumptions: "Map is current" },
    ]);
    expect(prompt).toContain("Urban intersection · Autonomous");
    expect(prompt).toContain("Operating conditions: Wet road");
    expect(prompt).toContain("Assumptions: Map is current");
  });
});
