function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function getSafetyEvidenceCell(cells = {}, candidates = []) {
  const entries = Object.entries(cells || {});
  for (const candidate of candidates) {
    const match = entries.find(([label]) => candidate.test(String(label || "")));
    if (match && String(match[1] || "").trim()) return String(match[1]).trim();
  }
  return "";
}

export function normalizeContextRiskRating(value, fallback = 3) {
  return Math.min(5, Math.max(1, Number(value) || Number(fallback) || 3));
}

export function buildSafetyIssueContextVariants(issue = {}, proposedVariants = []) {
  const groups = new Map();
  (issue.evidence || []).forEach((evidence) => {
    const cells = evidence?.cells || {};
    const contextId = getSafetyEvidenceCell(cells, [/^Operational Context ID$/i, /^Context ID$/i]) || "context-unspecified";
    const scenario = getSafetyEvidenceCell(cells, [/^Operational Scenario$/i, /^Scenario$/i]) || "Unspecified scenario";
    const mode = getSafetyEvidenceCell(cells, [/^Operational Mode$/i, /^Mode$/i]) || "Unspecified mode";
    const key = contextId !== "context-unspecified" ? contextId : `${normalize(scenario)}::${normalize(mode)}`;
    const current = groups.get(key) || {
      contextId,
      scenario,
      mode,
      conditions: [],
      assumptions: [],
      hazardVariations: [],
      sourceIndexes: [],
    };
    const conditions = getSafetyEvidenceCell(cells, [/^Operating Conditions$/i, /^Conditions$/i]);
    const assumptions = getSafetyEvidenceCell(cells, [/^Context Assumptions$/i, /^Operational Assumptions$/i]);
    const hazard = getSafetyEvidenceCell(cells, [/^Hazards?$/i, /^Unsafe Control Actions?$/i, /^Hazardous Event$/i, /^Failure Mode$/i]);
    if (conditions && !current.conditions.includes(conditions)) current.conditions.push(conditions);
    if (assumptions && !current.assumptions.includes(assumptions)) current.assumptions.push(assumptions);
    if (hazard && !current.hazardVariations.includes(hazard)) current.hazardVariations.push(hazard);
    const sourceIndex = Number(evidence?.sourceIndex);
    if (Number.isFinite(sourceIndex) && sourceIndex > 0 && !current.sourceIndexes.includes(sourceIndex)) current.sourceIndexes.push(sourceIndex);
    groups.set(key, current);
  });

  const proposals = Array.isArray(proposedVariants) ? proposedVariants : [];
  return Array.from(groups.values()).map((context) => {
    const proposal = proposals.find((candidate) => {
      const candidateId = String(candidate?.contextId || "").trim();
      if (candidateId && candidateId === context.contextId) return true;
      return normalize(candidate?.scenario) === normalize(context.scenario)
        && normalize(candidate?.mode) === normalize(context.mode);
    }) || {};
    const allowedSources = new Set(context.sourceIndexes);
    const proposedSources = (Array.isArray(proposal.sourceIndexes) ? proposal.sourceIndexes : [])
      .map(Number)
      .filter((sourceIndex) => allowedSources.has(sourceIndex));
    return {
      contextId: context.contextId,
      scenario: context.scenario,
      mode: context.mode,
      conditions: context.conditions.join("; "),
      assumptions: context.assumptions.join("; "),
      hazardVariation: context.hazardVariations.join("; ") || String(proposal.hazardVariation || "").trim() || issue.description || "",
      likelihood: normalizeContextRiskRating(proposal.likelihood, issue.likelihood),
      severity: normalizeContextRiskRating(proposal.severity, issue.severity),
      riskRationale: String(proposal.riskRationale || "").trim() || "Context-specific rating requires engineering review.",
      sourceIndexes: proposedSources.length ? proposedSources : context.sourceIndexes.sort((a, b) => a - b),
    };
  });
}

export function getBoundingSafetyIssueContext(contextVariants = []) {
  return (Array.isArray(contextVariants) ? contextVariants : []).reduce((highest, context) => {
    const score = normalizeContextRiskRating(context?.likelihood) * normalizeContextRiskRating(context?.severity);
    const highestScore = highest
      ? normalizeContextRiskRating(highest.likelihood) * normalizeContextRiskRating(highest.severity)
      : -1;
    return score > highestScore ? context : highest;
  }, null);
}
