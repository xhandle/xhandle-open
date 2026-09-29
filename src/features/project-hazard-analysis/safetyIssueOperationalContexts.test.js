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

test('saved single-context assessment uses manual issue ratings instead of stale cached ratings', () => {
 const contextVariants=[{contextId:'one',likelihood:3,severity:3}];
 const issue={likelihood:5,severity:5,contextVariants,evidence:[{sourceIndex:1,cells:{'Operational Context ID':'one'}}]};
 const result=buildSafetyIssueContextVariants(issue,contextVariants);
 expect(result[0].likelihood).toBe(5);
 expect(result[0].severity).toBe(5);
 expect(getBoundingSafetyIssueContext(result)).toMatchObject({likelihood:5,severity:5});
 expect(contextVariants[0].likelihood).toBe(3);
});

test('multi-context issue rating does not overwrite separately assessed contexts', () => {
 const contextVariants=[{contextId:'one',likelihood:2,severity:3},{contextId:'two',likelihood:4,severity:4}];
 const issue={likelihood:5,severity:5,contextVariants,evidence:contextVariants.map((c,i)=>({sourceIndex:i+1,cells:{'Operational Context ID':c.contextId}}))};
 expect(buildSafetyIssueContextVariants(issue,contextVariants).map(c=>[c.likelihood,c.severity])).toEqual([[2,3],[4,4]]);
});
