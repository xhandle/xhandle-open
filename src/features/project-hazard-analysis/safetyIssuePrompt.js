// Shared by Projects and Design Management. Keep the engineering clustering
// rules in one place; UI-specific state and persistence stay with the callers.
export function buildSafetyIssuePrompt({ projectName, hazardMethod, organizationContext, families }) {
  return `
You are consolidating hazard-analysis rows into a concise set of Consolidated Safety Issues.

Project: ${projectName || "Untitled project"}
Hazard method: ${hazardMethod || "Hazard analysis"}

${organizationContext || "No organization calibration profile is enabled for this project."}

Only the rows below are eligible because their canonical Safety Classification is Safety — Direct or Safety — Related. Do not use or infer from Mission/Reliability, Not Applicable, or Needs Review rows.

Safety hazard evidence, grouped only to reduce transport size (the grouping does not decide issue boundaries):
${JSON.stringify(families)}

Return strict JSON only with this schema:
{
  "issues": [
    {
      "title": "short consolidated safety issue title",
      "description": "specific actionable engineering concern shared by the referenced evidence families",
      "likelihood": 1,
      "severity": 1,
      "tags": "comma-separated tags",
      "sourceFamilyIds": ["family-1", "family-2"]
    }
  ]
}

Rules:
- You—not deterministic application code—must decide the semantic issue boundaries from the supplied engineering evidence.
- Review every row inside every supplied family before deciding the clusters.
- The familyId grouping is a lossless transport optimization for context and guide-phrase permutations. Merge families when they describe the same actionable unsafe condition, control strategy, design change, requirement set, or verification campaign.
- Return clustering decisions only. Do not repeat sourceIndexes, context variants, causal scenarios, constraints, losses, or hazards; xHandle materializes those details losslessly from every row in each selected family.
- Consolidate aggressively around actionable engineering concerns: rows belong together when an engineering team can address them through the same control strategy, requirement set, design change, or verification campaign.
- Merge across guide phrases, scenarios, modes, functions, and interfaces when they are manifestations of the same underlying unsafe condition or share the same engineering treatment.
- Treat guide phrases, scenarios, and modes as evidence or variants, not automatic reasons to create separate issues.
- Do not mirror the hazard worksheet structure and do not create one issue per row, guide phrase, context, or functional interface.
- Prefer the smallest defensible set of issues that remains technically coherent and actionable. A review backlog approaching the number of worksheet permutations is not adequately consolidated.
- Treat operational assumptions as architecture invariants. Do not require a controller, powered actuator, sensor, or communication channel in a context where the evidence says it is unavailable; account for stated passive or mechanical fallbacks.
- If a row has a credible physical-harm path such as collision, injury, loss of control, instability, unintended motion, or environmental harm, retain it as Safety even when it also affects mission or reliability.
- Keep unrelated safety hazards as separate issues.
- Never erase operational differences when consolidating rows. Use the issue description to call out material scenario or mode differences; xHandle preserves every represented context as linked evidence.
- Keep hazards separate when their scenario or mode produces a materially different unsafe state that cannot be explained clearly as a context variant of one issue.
- Include every supplied familyId in exactly one issue's sourceFamilyIds. Do not duplicate or omit family IDs.
- Use likelihood and severity integers from 1 to 5. If the rows do not provide enough evidence, choose conservative middle values based on the row severity wording.
- Do not invent hazards, controls, owners, dates, or numerical thresholds.
- Return only strict JSON. No Markdown. No code fences.
  `.trim();
}
