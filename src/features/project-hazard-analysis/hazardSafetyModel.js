const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const normalized = (value) => text(value).toLowerCase();

function hashText(value) {
  let hash = 2166136261;
  const input = normalized(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(0, 7);
}

export function createSafetyModelId(prefix, value) {
  return `${prefix}-${hashText(value)}`;
}

export function inferControlActionType(controlAction = "", functionFrom = "", functionTo = "") {
  const value = normalized(`${controlAction} ${functionFrom} ${functionTo}`);
  if (/\b(mode|state)\s*(change|transition|selection|set)|enter\s+(?:\w+\s+){0,3}mode\b|switch\s+(?:\w+\s+){0,2}mode\b/.test(value)) return "Mode transition";
  if (/\b(requests?|commands?|demands?|submits?|submission|issues?|invokes?|authoriz(?:e|es|ation)|enabl(?:e|es)|disabl(?:e|es)|activat(?:e|es|ion)|deactivat(?:e|es|ion)|setpoints?|instructions?)\b/.test(value)) return "Command / request";
  if (/\b(events?|triggers?|notif(?:y|ies|ications?)|alerts?|interrupts?|signals?)\b/.test(value)) return "Event";
  if (/\b(configuration|calibration|parameter|constraint|permission|authority|policy|profile)\b/.test(value)) return "Configuration / authority";
  if (
    /\b(environment|external|surroundings|weather|terrain|infrastructure)\b/.test(normalized(functionFrom))
    && /\b(condition|disturbance|exposure|opportunity|availability|observation|input)\b/.test(normalized(controlAction))
  ) return "External input / disturbance";
  if (/\b(status|feedback|health|acknowledg|report|response|diagnostic)\b/.test(value)) return "Feedback / status";
  if (/\b(force|torque|pressure|voltage|current|power|energy|flow|brake|throttle|steering)\b/.test(value)) return "Force / resource flow";
  if (/\b(estimate|position|pose|velocity|trajectory|measurement|image|point cloud|map data)\b/.test(value)) return "State estimate / data";
  return "Information / data";
}

export function semanticGuidePhrase(controlActionType = "Information / data", guidePhrase = "") {
  const phrase = normalized(guidePhrase);
  const informationBearing = /feedback|status|state estimate|information|data|configuration|authority|mode transition/i.test(controlActionType);
  const externalInput = /external input|disturbance/i.test(controlActionType);
  if (/not providing/.test(phrase)) {
    if (externalInput) return "Required external input or observable condition is absent or unavailable";
    return informationBearing ? "Required information or update becomes unavailable or ceases" : "Action is not provided";
  }
  if (/providing the control action/.test(phrase)) {
    if (externalInput) return "External condition or disturbance occurs under hazardous conditions";
    return informationBearing ? "Information is consumed while invalid, unauthorized, inconsistent, or not required" : "Action is provided when hazardous or not required";
  }
  if (/too early/.test(phrase)) return informationBearing
    ? "Information is consumed before it is valid, before prerequisites hold, or before its acceptance window"
    : "Action occurs before its valid conditions or prerequisites";
  if (/too late/.test(phrase)) return informationBearing
    ? "Information or its required update becomes available after its decision point or freshness deadline"
    : "Action occurs after its required response point";
  if (/wrong order/.test(phrase)) return informationBearing
    ? "Information is consumed out of sequence, with an invalid version, or before prerequisite information"
    : "Action occurs in the wrong sequence";
  if (/stopped too soon/.test(phrase)) return informationBearing
    ? "Required updates cease before the availability or validity interval ends"
    : "Action stops before its required completion condition";
  if (/applied too long/.test(phrase)) return informationBearing
    ? "The same value, assertion, authority, or mode remains active or is consumed beyond its validity, freshness, or revocation interval"
    : "Action continues beyond its allowed duration or completion condition";
  return text(guidePhrase) || "Deviation requires review";
}

const NON_APPLICABLE_HAZARD_FIELDS = [
  "loss",
  "losses",
  "hazard",
  "hazards",
  "rawLossCandidate",
  "rawHazardCandidate",
  "unsafeControlAction",
  "unsafeControlActions",
  "causalScenario",
  "causalFactor",
  "causalFactors",
  "mitigationStrategy",
  "safetyConstraint",
  "safetyRequirementsConstraints",
  "systemRequirement",
];

export function normalizeNonApplicableHazardRecord(record = {}, rationale = "") {
  const reason = text(rationale)
    || text(record.guidePhraseApplicabilityRationale)
    || "The guide phrase is not applicable to this interface in the stated operational context.";
  const notApplicable = `Not applicable: ${reason.replace(/^not applicable:\s*/i, "")}`;
  const next = {
    ...record,
    guidePhraseApplicable: "No",
    guidePhraseApplicabilityRationale: reason.replace(/^not applicable:\s*/i, ""),
    causalFactorCategory: "Not applicable",
    requirementParameterSource: "Not applicable",
    proposedSafetyAssessment: "Mission/Reliability",
    proposedSafetyAssessmentRationale: reason.replace(/^not applicable:\s*/i, ""),
    safetySignificant: "Needs Review",
    safetySignificanceRationale: "The guide phrase is not applicable to this interface in the stated operational context.",
  };
  NON_APPLICABLE_HAZARD_FIELDS.forEach((fieldName) => {
    if (Object.prototype.hasOwnProperty.call(next, fieldName)) next[fieldName] = notApplicable;
  });
  return next;
}

export function inferCausalFactorCategory(value = "") {
  const cause = normalized(value);
  if (/power|voltage|current|energy|supply/.test(cause)) return "Power / energy";
  if (/sensor|measurement|feedback|detect|observe/.test(cause)) return "Sensor / feedback";
  if (/actuator|mechanical|valve|motor|brake|physical/.test(cause)) return "Actuator / physical process";
  if (/network|communication|message|bus|packet|latency|timeout/.test(cause)) return "Communication / interface";
  if (/mode|state transition|mode confusion/.test(cause)) return "Mode / state management";
  if (/configuration|parameter|calibrat|threshold/.test(cause)) return "Configuration / calibration";
  if (/operator|human|maintenance|procedure/.test(cause)) return "Human / procedure";
  if (/startup|shutdown|initializ|reset/.test(cause)) return "Initialization / lifecycle";
  if (/timing|late|early|stale|sequence|race/.test(cause)) return "Timing / sequencing";
  if (/common cause|shared|dependency/.test(cause)) return "Common-cause dependency";
  return "Controller logic / process model";
}

const SUPPORTED_NUMBER_CONTEXT = /\b(?:per|according to|derived from|allocated by)\s+(?:(?:requirement|specification|timing budget|safety budget)\s+[A-Z0-9][A-Z0-9._-]*|(?:iso|iec|sae|mil|do-|arp)\s*[A-Z0-9.-]+)/i;
const NUMERIC_REQUIREMENT = /\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|seconds?|hz|khz|mhz|%|percent|m|cm|mm|km\/h|mph|nm|n|v|a|w)\b/i;

export function hasUnsupportedNumericRequirement(requirement = "", parameterSource = "") {
  const source = text(parameterSource);
  const hasSupportedSource = source && !/^(?:tbd|unknown|none|not specified|needs review)$/i.test(source);
  return NUMERIC_REQUIREMENT.test(text(requirement)) && !hasSupportedSource && !SUPPORTED_NUMBER_CONTEXT.test(text(requirement));
}

export function parameterizeUnsupportedRequirement(requirement = "", parameterSource = "") {
  const value = text(requirement);
  if (!hasUnsupportedNumericRequirement(value, parameterSource)) return value;
  return value.replace(/\b\d+(?:\.\d+)?\s*(ms|milliseconds?|s|seconds?|hz|khz|mhz|%|percent|m|cm|mm|km\/h|mph|nm|n|v|a|w)\b/gi, "[TBD-$1]");
}

export function buildHazardQualityFindings(cells = {}) {
  const findings = [];
  const applicable = !/^no\b|^not applicable\b/i.test(text(cells["Guide Phrase Applicable"]));
  const mitigation = text(cells["Mitigation Strategy"]);
  const causal = text(cells["Causal Factor"] || cells["Causal Factors"] || cells["Causal Scenario"]);
  const requirement = text(cells["System Requirement"] || cells["Safety Requirements/Constraints"] || cells["Safety Constraint"]);
  const parameterSource = text(cells["Requirement Parameter Source"]);
  const assessment = text(cells["Proposed Safety Assessment"]);
  const hazard = text(cells.Hazard || cells.Hazards);
  const assumptions = text(cells["Context Assumptions"]);
  const operationalContext = text([
    cells["Operational Scenario"],
    cells["Operational Mode"],
    cells["Operating Conditions"],
    cells["Context Assumptions"],
  ].filter(Boolean).join(" "));
  const applicabilityRationale = text(cells["Guide Phrase Applicability Rationale"]);
  const actionType = text(cells["Control Action Type"]);

  if (
    !applicable
    && !/\b(?:does not|cannot|no meaningful|not meaningful|unsupported|precluded|safely buffered)\b/i.test(applicabilityRationale)
    && /\b(?:can|could|may|would|will)\s+(?:lead|cause|result)|\b(?:leading|resulting)\s+(?:in|to)|\bcausing\b/i.test(applicabilityRationale)
  ) {
    findings.push("Non-applicable decision contradicts a rationale that describes an adverse causal mechanism.");
  }

  if (applicable && mitigation && /^(?:software|hardware|sensor|communication|network|operator|configuration|initialization|timing|power)\b.*(?:error|failure|fault|delay|loss|problem)/i.test(mitigation)) {
    findings.push("Mitigation appears to describe a causal factor; separate the cause from the design measure.");
  }
  if (applicable && !mitigation && causal) findings.push("A causal factor is present without a distinct mitigation or design measure.");
  if (applicable && hasUnsupportedNumericRequirement(requirement, parameterSource)) findings.push("Requirement contains an unsupported numeric threshold; use a TBD parameter and record its source.");
  if (applicable && /mission|reliability/i.test(assessment) && /collision|injur|fatal|loss of control|unintended movement|instability|physical harm|hazardous/i.test(hazard)) {
    findings.push("Potential physical-harm path is classified as Mission/Reliability; safety classification needs review.");
  }
  if (applicable && /loss of .*power|power loss|without powered control|passive/i.test(assumptions) && /must (?:send|transmit|assert|command)|communication .*required/i.test(requirement)) {
    findings.push("Requirement may conflict with the stated power or communication availability assumptions.");
  }
  if (applicable && /\b(?:if|when) (?:needed|required|a hazard occurs|an unsafe condition occurs)\b/i.test(applicabilityRationale)) {
    findings.push("Applicability rationale introduces a conditional event that is not established by the supplied operational context.");
  }
  if (applicable && /(?:results?|resulting|leads?|leading|caus(?:es|ing))\s+(?:in|to)?\s*(?:navigation|processing|operational|system|performance|behavioral?)\s+(?:errors?|issues?|problems?|failures?|degradation)\.?$/i.test(hazard)) {
    findings.push("Hazard ends at a generic failure effect; identify the resulting system state, exposure, and plausible loss or harm.");
  }
  if (applicable && requirement && !/\bshall\b/i.test(requirement)) {
    findings.push("System requirement is not expressed as an allocated, verifiable shall statement.");
  }
  if (
    applicable
    && /external input|disturbance/i.test(actionType)
    && /\b(?:ensure|guarantee|maintain)\b.*\b(?:continuous|always|availability|opportunity|environment|condition)\b/i.test(requirement)
  ) {
    findings.push("Requirement attempts to control an external condition; allocate detection, degraded operation, inhibition, or safe response instead.");
  }
  if (
    applicable
    && /configuration|authority/i.test(actionType)
    && /\b(?:valid|current|approved|active)\b/i.test(operationalContext)
    && /\b(?:missing|absent|delay(?:ed)?|late|not provid\w*|outdated)\b.*\b(?:update|configuration|authority|policy|profile|map)\b/i.test(applicabilityRationale)
    && !/\b(?:update|required update|transition|change|revision|new version)\b/i.test(text(cells["Operational Scenario"]))
  ) {
    findings.push("Applicability assumes an unstated configuration or authority update even though the supplied steady-state context says the active value is valid.");
  }
  return findings;
}

export function buildHazardAnalysisPatternFindings(summary = []) {
  const rows = sourceCells(summary);
  if (rows.length < 2) return [];
  const applicableValue = ({ cells }) => /^yes\b|^applicable\b/i.test(text(cells["Guide Phrase Applicable"]));
  const findings = [];
  const sourceIndexes = rows.map(({ sourceIndex }) => sourceIndex);
  if (rows.every(applicableValue)) {
    findings.push({
      id: createSafetyModelId("QF", "all-guide-phrases-applicable"),
      message: "Every generated guide-phrase row is marked applicable. Review whether exact action semantics and operational context were evaluated independently.",
      sourceIndexes,
    });
  }
  const applicableRows = rows.filter(applicableValue);
  if (rows.length >= 20 && applicableRows.length / rows.length >= 0.8) {
    findings.push({
      id: createSafetyModelId("QF", "over-broad-applicability-rate"),
      message: `${applicableRows.length} of ${rows.length} guide-phrase rows are marked applicable. Challenge whether hypothetical faults or generic consequences replaced context-supported interface semantics.`,
      sourceIndexes: applicableRows.map(({ sourceIndex }) => sourceIndex),
    });
  }
  if (applicableRows.length >= 3 && applicableRows.every(({ cells }) => /^safety\b/i.test(text(cells["Proposed Safety Assessment"])))) {
    findings.push({
      id: createSafetyModelId("QF", "all-applicable-rows-safety"),
      message: "Every applicable row is classified Safety. Review whether mission/reliability effects were automatically escalated without a credible harm path.",
      sourceIndexes: applicableRows.map(({ sourceIndex }) => sourceIndex),
    });
  }
  const guideGroups = new Map();
  rows.forEach((entry) => {
    const guide = text(entry.cells["Guide Phrase"]);
    if (!guide) return;
    if (!guideGroups.has(guide)) guideGroups.set(guide, []);
    guideGroups.get(guide).push(entry);
  });
  guideGroups.forEach((entries, guide) => {
    const interfaceCount = new Set(entries.map(({ cells }) => [
      cells["Function (From)"],
      cells["Control Action"],
      cells["Function (To)"],
    ].map(normalized).join("|"))).size;
    if (interfaceCount >= 3 && entries.every((entry) => !applicableValue(entry))) {
      findings.push({
        id: createSafetyModelId("QF", `all-not-applicable|${guide}`),
        message: `Every “${guide}” row is marked non-applicable across ${interfaceCount} interfaces. Review for a systemic action-semantics blind spot.`,
        sourceIndexes: entries.map(({ sourceIndex }) => sourceIndex),
      });
    }
  });
  const interfaceGroups = new Map();
  rows.forEach(({ cells, sourceIndex }) => {
    const key = [cells["Function (From)"], cells["Control Action"], cells["Function (To)"]].map(normalized).join("|");
    if (!interfaceGroups.has(key)) interfaceGroups.set(key, []);
    interfaceGroups.get(key).push({ cells, sourceIndex });
  });
  const safetyInterfaces = Array.from(interfaceGroups.values()).filter((entries) => (
    entries.some(({ cells }) => /^safety\b/i.test(text(cells["Proposed Safety Assessment"])))
  ));
  if (interfaceGroups.size >= 10 && safetyInterfaces.length / interfaceGroups.size >= 0.85) {
    findings.push({
      id: createSafetyModelId("QF", "near-universal-interface-safety"),
      message: `${safetyInterfaces.length} of ${interfaceGroups.size} interfaces have at least one Safety result. Recheck whether indirect mission failures were promoted by shared exposure context instead of a direct, necessary safety-control or safety-critical feedback path.`,
      sourceIndexes: safetyInterfaces.flatMap((entries) => entries.map(({ sourceIndex }) => sourceIndex)),
    });
  }
  const signatures = Array.from(interfaceGroups.values()).map((entries) => entries
    .map(({ cells }) => `${normalized(cells["Guide Phrase"])}:${applicableValue({ cells }) ? "yes" : "no"}`)
    .sort()
    .join("|"));
  if (interfaceGroups.size >= 3 && guideGroups.size >= 3 && new Set(signatures).size === 1) {
    findings.push({
      id: createSafetyModelId("QF", "identical-interface-applicability"),
      message: "Every interface has the same applicability pattern. Review whether interface-specific semantics were replaced by a template decision.",
      sourceIndexes,
    });
  }
  const allApplicableInterfaces = Array.from(interfaceGroups.values()).filter((entries) => (
    new Set(entries.map(({ cells }) => normalized(cells["Guide Phrase"])).filter(Boolean)).size >= 5
    && entries.every(applicableValue)
  ));
  if (allApplicableInterfaces.length >= 3 && allApplicableInterfaces.length / interfaceGroups.size >= 0.25) {
    findings.push({
      id: createSafetyModelId("QF", "many-all-applicable-interfaces"),
      message: `${allApplicableInterfaces.length} of ${interfaceGroups.size} interfaces mark every guide phrase applicable. Recheck each interface as a complete semantic decision table.`,
      sourceIndexes: allApplicableInterfaces.flatMap((entries) => entries.map(({ sourceIndex }) => sourceIndex)),
    });
  }
  const allNotApplicableInterfaces = Array.from(interfaceGroups.values()).filter((entries) => (
    new Set(entries.map(({ cells }) => normalized(cells["Guide Phrase"])).filter(Boolean)).size >= 5
    && entries.every((entry) => !applicableValue(entry))
  ));
  if (allNotApplicableInterfaces.length >= 3 && allNotApplicableInterfaces.length / interfaceGroups.size >= 0.25) {
    findings.push({
      id: createSafetyModelId("QF", "many-all-not-applicable-interfaces"),
      message: `${allNotApplicableInterfaces.length} of ${interfaceGroups.size} interfaces reject every guide phrase. Recheck whether active information, command, state, timing, or duration semantics were suppressed.`,
      sourceIndexes: allNotApplicableInterfaces.flatMap((entries) => entries.map(({ sourceIndex }) => sourceIndex)),
    });
  }
  const uniqueApplicableValues = (fieldNames) => new Set(applicableRows
    .map(({ cells }) => fieldNames.map((fieldName) => text(cells[fieldName])).find(Boolean))
    .filter(Boolean));
  const uniqueLosses = uniqueApplicableValues(["Loss", "Losses"]);
  const uniqueHazards = uniqueApplicableValues(["Hazard", "Hazards"]);
  if (applicableRows.length >= 10 && (uniqueLosses.size / applicableRows.length >= 0.75 || uniqueHazards.size / applicableRows.length >= 0.75)) {
    findings.push({
      id: createSafetyModelId("QF", "unconverged-loss-hazard-vocabulary"),
      message: `Raw applicable rows use ${uniqueLosses.size} Loss statements and ${uniqueHazards.size} Hazard statements across ${applicableRows.length} rows. Preserve raw traceability, but converge them into reusable system-level Losses and Hazards for review.`,
      sourceIndexes: applicableRows.map(({ sourceIndex }) => sourceIndex),
    });
  }
  const genericOwnerRows = applicableRows.filter(({ cells }) => /^The\s+(?:Application Subsystem|System Component|System Element|Relevant Module|Responsible Component)\s+shall\b/i.test(text(cells["System Requirement"])));
  if (genericOwnerRows.length >= 3 && genericOwnerRows.length / applicableRows.length >= 0.2) {
    findings.push({
      id: createSafetyModelId("QF", "generic-requirement-ownership"),
      message: `${genericOwnerRows.length} applicable requirements use a generic owner instead of an architectural function or subsystem. Reallocate them to a responsible source, receiver, or named subsystem.`,
      sourceIndexes: genericOwnerRows.map(({ sourceIndex }) => sourceIndex),
    });
  }
  return findings;
}

function sourceCells(summary) {
  if (!Array.isArray(summary?.[0])) return [];
  const headers = summary[0].map(text);
  return summary.slice(1).map((row, index) => {
    const cells = {};
    headers.forEach((header, column) => {
      if (header) cells[header] = text(row?.[column]);
    });
    return { sourceIndex: index + 1, cells };
  });
}

function uniqueById(items) {
  const byId = new Map();
  items.filter(Boolean).forEach((item) => {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, { ...item, sourceIndexes: Array.from(new Set(item.sourceIndexes || [])) });
      return;
    }
    byId.set(item.id, {
      ...existing,
      sourceIndexes: Array.from(new Set([...(existing.sourceIndexes || []), ...(item.sourceIndexes || [])])).sort((a, b) => a - b),
    });
  });
  return Array.from(byId.values());
}

function normalizedIssueEntries(issue, key, fallback = []) {
  const entries = Array.isArray(issue?.[key]) ? issue[key] : [];
  return entries.length ? entries : fallback;
}

export function buildHazardSafetyModel(summary = [], riskRegister = [], projectName = "Project") {
  const rows = sourceCells(summary);
  const rowsByIndex = new Map(rows.map((row) => [row.sourceIndex, row]));
  const architectureAssumptions = uniqueById(rows
    .map(({ cells, sourceIndex }) => {
      const statement = text(cells["Context Assumptions"]);
      if (!statement) return null;
      return { id: createSafetyModelId("A", statement), statement, sourceIndexes: [sourceIndex] };
    }));

  const losses = [];
  const hazards = [];
  const causalScenarios = [];
  const safetyConstraints = [];

  (riskRegister || []).forEach((issue) => {
    const sourceIndexes = Array.from(new Set((issue.sourceIndexes || [issue.sourceIndex]).map(Number).filter(Number.isFinite)));
    const evidence = sourceIndexes.map((index) => rowsByIndex.get(index)).filter(Boolean);
    const fallbackLoss = evidence.map(({ cells }) => cells.Loss || cells.Losses).filter(Boolean).slice(0, 1);
    const fallbackHazard = evidence.map(({ cells }) => cells.Hazard || cells.Hazards).filter(Boolean).slice(0, 1);
    normalizedIssueEntries(issue, "canonicalLosses", fallbackLoss.map((statement) => ({ title: statement, description: statement }))).forEach((entry) => {
      const title = text(entry?.title || entry?.description || entry);
      if (title) losses.push({ id: createSafetyModelId("L", title), title, description: text(entry?.description || title), sourceIndexes });
    });
    normalizedIssueEntries(issue, "canonicalHazards", fallbackHazard.map((statement) => ({ title: statement, description: statement }))).forEach((entry) => {
      const title = text(entry?.title || entry?.description || entry);
      if (title) hazards.push({ id: createSafetyModelId("H", title), title, description: text(entry?.description || title), sourceIndexes });
    });
    normalizedIssueEntries(issue, "causalScenarios").forEach((entry) => {
      const description = text(entry?.description || entry);
      if (!description) return;
      causalScenarios.push({
        id: createSafetyModelId("CS", description),
        description,
        category: text(entry?.category) || inferCausalFactorCategory(description),
        sourceIndexes: (entry?.sourceIndexes || sourceIndexes).map(Number).filter(Number.isFinite),
      });
    });
    normalizedIssueEntries(issue, "safetyConstraints").forEach((entry) => {
      const statement = parameterizeUnsupportedRequirement(entry?.statement || entry?.description || entry, entry?.parameterSource);
      if (!statement) return;
      safetyConstraints.push({
        id: createSafetyModelId("SC", statement),
        statement,
        verification: text(entry?.verification),
        parameterSource: text(entry?.parameterSource),
        sourceIndexes: (entry?.sourceIndexes || sourceIndexes).map(Number).filter(Number.isFinite),
      });
    });
  });

  const unsafeControlActions = rows
    .filter(({ cells }) => !/^no$/i.test(cells["Guide Phrase Applicable"]) && text(cells["Unsafe Control Action"] || cells["Unsafe Control Actions"]))
    .map(({ sourceIndex, cells }) => {
      const statement = text(cells["Unsafe Control Action"] || cells["Unsafe Control Actions"]);
      const actionType = text(cells["Control Action Type"]) || inferControlActionType(cells["Control Action"], cells["Function (From)"], cells["Function (To)"]);
      return {
        id: createSafetyModelId("UCA", `${cells["Function (From)"]}|${cells["Control Action"]}|${cells["Function (To)"]}|${cells["Guide Phrase"]}|${cells["Operational Context ID"]}`),
        statement,
        controlActionType: actionType,
        semanticDeviation: semanticGuidePhrase(actionType, cells["Guide Phrase"]),
        sourceIndexes: [sourceIndex],
      };
    });

  const findings = [
    ...rows.flatMap(({ sourceIndex, cells }) => buildHazardQualityFindings(cells)
      .map((message) => ({ id: createSafetyModelId("QF", `${sourceIndex}|${message}`), message, sourceIndexes: [sourceIndex] }))),
    ...buildHazardAnalysisPatternFindings(summary),
  ];

  const normalizedLosses = uniqueById(losses);
  const normalizedHazards = uniqueById(hazards);
  const normalizedUcas = uniqueById(unsafeControlActions);
  const normalizedCausalScenarios = uniqueById(causalScenarios);
  const normalizedSafetyConstraints = uniqueById(safetyConstraints);
  const intersects = (left = [], right = new Set()) => left.some((value) => right.has(Number(value)));
  const traceability = (riskRegister || []).map((issue, index) => {
    const sourceIndexes = Array.from(new Set((issue.sourceIndexes || [issue.sourceIndex]).map(Number).filter(Number.isFinite)));
    const sourceSet = new Set(sourceIndexes);
    return {
      id: createSafetyModelId("TRACE", `${issue.id || issue.title || index}|${sourceIndexes.join(",")}`),
      issueId: issue.id || "",
      title: text(issue.title) || `Safety issue ${index + 1}`,
      lossIds: normalizedLosses.filter((item) => intersects(item.sourceIndexes, sourceSet)).map((item) => item.id),
      hazardIds: normalizedHazards.filter((item) => intersects(item.sourceIndexes, sourceSet)).map((item) => item.id),
      unsafeControlActionIds: normalizedUcas.filter((item) => intersects(item.sourceIndexes, sourceSet)).map((item) => item.id),
      causalScenarioIds: normalizedCausalScenarios.filter((item) => intersects(item.sourceIndexes, sourceSet)).map((item) => item.id),
      safetyConstraintIds: normalizedSafetyConstraints.filter((item) => intersects(item.sourceIndexes, sourceSet)).map((item) => item.id),
      sourceIndexes,
    };
  });

  return {
    version: 1,
    projectName: text(projectName) || "Project",
    counts: { rawRows: rows.length },
    losses: normalizedLosses,
    hazards: normalizedHazards,
    unsafeControlActions: normalizedUcas,
    causalScenarios: normalizedCausalScenarios,
    safetyConstraints: normalizedSafetyConstraints,
    architectureAssumptions,
    qualityFindings: findings,
    traceability,
  };
}
