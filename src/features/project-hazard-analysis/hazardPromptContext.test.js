import {
  HAZARD_OPERATIONAL_CONTEXT_CHAR_BUDGET,
  HAZARD_ORGANIZATION_CONTEXT_CHAR_BUDGET,
  boundHazardPromptContext,
  formatGovernedHazardPromptContext,
  prioritizeHazardOrganizationContext,
} from "./hazardPromptContext";

test("keeps organization calibration separate and ahead of long operational context", () => {
  const organizationContext = `PROFILE-START\n${"governance ".repeat(2200)}\nPROJECT-OVERRIDE`;
  const operationalContext = `SCENARIO-START\n${"scenario ".repeat(2500)}\nSCENARIO-END`;
  const formatted = formatGovernedHazardPromptContext({ organizationContext, operationalContext });

  expect(formatted.indexOf("PROFILE-START")).toBeLessThan(formatted.indexOf("SCENARIO-START"));
  expect(formatted).toContain("PROJECT-OVERRIDE");
  expect(formatted).toContain("SCENARIO-END");
  expect(formatted).toContain("organization calibration");
  expect(formatted).toContain("operational context");
  expect(formatted.length).toBeLessThanOrEqual(
    HAZARD_ORGANIZATION_CONTEXT_CHAR_BUDGET
      + HAZARD_OPERATIONAL_CONTEXT_CHAR_BUDGET
      + 600,
  );
});

test("preserves short contexts without truncation markers", () => {
  const formatted = formatGovernedHazardPromptContext({
    organizationContext: "Use canonical project losses.",
    operationalContext: "Operate near workers during trailer movement.",
  });
  expect(formatted).toContain("Use canonical project losses.");
  expect(formatted).toContain("Operate near workers during trailer movement.");
  expect(formatted).not.toContain("shortened to its");
});

test("bounded context retains both governance preamble and trailing project override", () => {
  const bounded = boundHazardPromptContext(`PREAMBLE\n${"x".repeat(400)}\nOVERRIDE`, 180, "profile");
  expect(bounded).toHaveLength(180);
  expect(bounded).toContain("PREAMBLE");
  expect(bounded).toContain("OVERRIDE");
});

test("prioritizes the complete safety-classification section in a long organization profile", () => {
  const profile = [
    "# Organization and Products",
    "organization preamble",
    "x".repeat(20000),
    "# Safety Significance Classification",
    "DIRECT-RULE-D1",
    "RELATED-RULE-R1",
    "# Hazard and Loss Taxonomy",
    "CANONICAL-LOSS-L1",
    "# Engineering Rules",
    "y".repeat(10000),
    "# Project Profile Override",
    "PROJECT-SAFETY-OVERRIDE",
  ].join("\n");
  const prioritized = prioritizeHazardOrganizationContext(profile);

  expect(prioritized).toContain("DIRECT-RULE-D1");
  expect(prioritized).toContain("RELATED-RULE-R1");
  expect(prioritized).toContain("CANONICAL-LOSS-L1");
  expect(prioritized).toContain("PROJECT-SAFETY-OVERRIDE");
  expect(prioritized.length).toBeLessThanOrEqual(HAZARD_ORGANIZATION_CONTEXT_CHAR_BUDGET);
});

test('long profiles retain risk, engineering, standards and custom section guidance',()=>{
 const profile=['# Safety Philosophy','x'.repeat(25000),'# Risk Classification','RISK-RULE','# Engineering Rules','ENGINEERING-RULE','# Standards and Regulatory Context','STANDARD-RULE','# Custom Policy','CUSTOM-RULE','# Project Profile Override','OVERRIDE-RULE'].join('\n');
 const result=prioritizeHazardOrganizationContext(profile);
 for(const marker of ['RISK-RULE','ENGINEERING-RULE','STANDARD-RULE','CUSTOM-RULE','OVERRIDE-RULE']) expect(result).toContain(marker);
 expect(result.length).toBeLessThanOrEqual(HAZARD_ORGANIZATION_CONTEXT_CHAR_BUDGET);
 expect(result).toContain('[Section shortened]');
});
