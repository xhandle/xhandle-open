import {
  buildSafetyIssueContextVariants,
  getBoundingSafetyIssueContext,
} from "./safetyIssueOperationalContexts";

describe("safety issue operational contexts", () => {
  const evidence = [
    {
      sourceIndex: 4,
      cells: {
        "Operational Context ID": "urban",
        "Operational Scenario": "Urban intersection",
        "Operational Mode": "Autonomous",
        "Operating Conditions": "Wet road",
        "Context Assumptions": "Map is current",
        Hazard: "Late braking creates insufficient stopping distance",
      },
    },
    {
      sourceIndex: 9,
      cells: {
        "Operational Context ID": "highway",
        "Operational Scenario": "Highway cruising",
        "Operational Mode": "Degraded perception",
        Hazard: "Late braking creates a high-speed closing conflict",
      },
    },
  ];

  it("groups evidence into traceable scenario-mode variants", () => {
    const variants = buildSafetyIssueContextVariants(
      { evidence, likelihood: 3, severity: 3 },
      [
        { contextId: "urban", likelihood: 3, severity: 4, sourceIndexes: [4, 999], riskRationale: "Pedestrian exposure" },
        { contextId: "highway", likelihood: 2, severity: 5, sourceIndexes: [9] },
      ]
    );

    expect(variants).toHaveLength(2);
    expect(variants[0]).toEqual(expect.objectContaining({
      scenario: "Urban intersection",
      mode: "Autonomous",
      conditions: "Wet road",
      assumptions: "Map is current",
      sourceIndexes: [4],
    }));
    expect(variants[1].hazardVariation).toContain("high-speed closing conflict");
  });

  it("selects the context with the highest likelihood-severity product", () => {
    expect(getBoundingSafetyIssueContext([
      { contextId: "a", likelihood: 4, severity: 3 },
      { contextId: "b", likelihood: 3, severity: 5 },
    ])).toEqual(expect.objectContaining({ contextId: "b" }));
  });
});
