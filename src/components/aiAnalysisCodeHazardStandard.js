import { fetchLLMResponse } from "./aiAnalysisSTPA";
import {
  CODE_ARCHITECTURE_TRACEABILITY_COLUMNS,
  HAZARD_SUMMARY_TRACEABILITY_COLUMNS,
  extractFunctionalDecompositionTrace,
  traceabilityObjectToSummaryFields,
  traceabilityToSheetCells,
} from "../features/code-architecture-hazard-analysis/codeArchitectureHazardUtils";
import {
  createSafetyModelId,
  inferCausalFactorCategory,
  inferControlActionType,
  normalizeNonApplicableHazardRecord,
  parameterizeUnsupportedRequirement,
  semanticGuidePhrase,
} from "../features/project-hazard-analysis/hazardSafetyModel";

function getCellText(cell) {
  if (cell == null) return "";
  if (typeof cell === "object" && "value" in cell) return String(cell.value);
  return String(cell);
}

function sanitizeText(text) {
  return String(text || "")
    .replace(/^[-–—•·\s"]+/, "")
    .replace(/["“”‘’]+$/, "")
    .replace(/\s*(?:->|→|➔|➡)\s*/g, " which leads to ")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function truncateForPrompt(value, maxChars = 120) {
  const text = sanitizeText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function flattenDecomposition(sheets) {
  const decomposition = sheets["Functional Decomposition"] || [];
  const headers = decomposition[0] || [];
  const findColumn = (candidates, fallback) => {
    const normalized = headers.map((header) => sanitizeText(header).toLowerCase());
    const index = candidates
      .map((candidate) => normalized.indexOf(String(candidate).toLowerCase()))
      .find((candidateIndex) => candidateIndex >= 0);
    return index >= 0 ? index : fallback;
  };
  const fromIdx = findColumn(["Function (From)", "From Function", "Source Function"], 0);
  const actionIdx = findColumn(["Control Action", "Unsafe Control Action", "UCA", "Action"], 1);
  const toIdx = findColumn(["Function (To)", "To Function", "Target Function"], 2);
  const guidePhraseIdx = findColumn(["Guide Phrase", "Guide Word", "Guideword", "STPA Guide Phrase"], -1);
  const guideApplicableIdx = findColumn(["Guide Phrase Applicable", "Guide Applicable", "Applicability", "Applicable"], -1);
  const guideRationaleIdx = findColumn(["Guide Phrase Applicability Rationale", "Applicability Rationale", "Guide Phrase Rationale"], -1);
  const scenarioIdx = findColumn(["Operational Scenario", "Scenario", "Operating Scenario"], -1);
  const contextIdIdx = findColumn(["Operational Context ID", "Context ID"], -1);
  const modeIdx = findColumn(["Operational Mode", "Mode", "System Mode"], -1);
  const conditionsIdx = findColumn(["Operating Conditions", "Conditions", "Environmental Conditions"], -1);
  const assumptionsIdx = findColumn(["Context Assumptions", "Operational Assumptions", "Assumptions"], -1);
  return decomposition
    .slice(1)
    .map((row, index) => {
      const from = sanitizeText(getCellText(row[fromIdx]));
      const controlAction = sanitizeText(getCellText(row[actionIdx]));
      const to = sanitizeText(getCellText(row[toIdx]));
      return {
        id: `FD-${index + 1}`,
        from,
        controlAction,
        to,
        controlActionType: inferControlActionType(controlAction, from, to),
        guidePhrase: guidePhraseIdx >= 0 ? sanitizeText(getCellText(row[guidePhraseIdx])) : "",
        guidePhraseApplicable: guideApplicableIdx >= 0 ? sanitizeText(getCellText(row[guideApplicableIdx])) : "",
        guidePhraseApplicabilityRationale: guideRationaleIdx >= 0 ? sanitizeText(getCellText(row[guideRationaleIdx])) : "",
        operationalScenario: scenarioIdx >= 0 ? sanitizeText(getCellText(row[scenarioIdx])) : "",
        operationalContextId: contextIdIdx >= 0 ? sanitizeText(getCellText(row[contextIdIdx])) : "",
        operationalMode: modeIdx >= 0 ? sanitizeText(getCellText(row[modeIdx])) : "",
        operatingConditions: conditionsIdx >= 0 ? sanitizeText(getCellText(row[conditionsIdx])) : "",
        contextAssumptions: assumptionsIdx >= 0 ? sanitizeText(getCellText(row[assumptionsIdx])) : "",
        traceability: extractFunctionalDecompositionTrace(headers, row),
      };
    })
    .filter((row) => row.from || row.controlAction || row.to);
}

function extractJsonArray(text) {
  const raw = String(text || "").trim();
  const first = raw.indexOf("[");
  const last = raw.lastIndexOf("]");
  const candidate = first >= 0 && last > first ? raw.slice(first, last + 1) : raw;
  return JSON.parse(candidate);
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  const candidate = first >= 0 && last > first ? raw.slice(first, last + 1) : raw;
  return JSON.parse(candidate);
}

function rethrowInterruptedRequest(error, signal) {
  if (signal?.aborted || error?.name === "AbortError" || error?.name === "TimeoutError") {
    throw error;
  }
}

function compactPromptItem(item = {}, maxChars = 120) {
  const trace = item.traceability || {};
  return {
    id: truncateForPrompt(item.id, 32),
    functionFrom: truncateForPrompt(item.from, maxChars),
    controlAction: truncateForPrompt(item.controlAction, maxChars),
    controlActionType: truncateForPrompt(item.controlActionType, 48),
    semanticDeviation: truncateForPrompt(semanticGuidePhrase(item.controlActionType, item.guidePhrase), maxChars),
    functionTo: truncateForPrompt(item.to, maxChars),
    guidePhrase: truncateForPrompt(item.guidePhrase, maxChars),
    guidePhraseApplicable: truncateForPrompt(item.guidePhraseApplicable, 24),
    guidePhraseApplicabilityRationale: truncateForPrompt(item.guidePhraseApplicabilityRationale, maxChars),
    operationalScenario: truncateForPrompt(item.operationalScenario, maxChars),
    operationalContextId: truncateForPrompt(item.operationalContextId, 100),
    operationalMode: truncateForPrompt(item.operationalMode, maxChars),
    operatingConditions: truncateForPrompt(item.operatingConditions, maxChars),
    contextAssumptions: truncateForPrompt(item.contextAssumptions, maxChars),
    fromFile: truncateForPrompt(trace.fromFile, maxChars),
    toFile: truncateForPrompt(trace.toFile, maxChars),
    sourceFiles: truncateForPrompt(trace.sourceFiles, maxChars),
    sourceSymbols: truncateForPrompt(trace.sourceSymbols, maxChars),
    subsystem: truncateForPrompt(trace.subsystem, 80),
  };
}

function compactPromptRows(items = []) {
  const rowCharBudgets = [160, 120, 80, 48, 32];
  for (const maxChars of rowCharBudgets) {
    const rows = items.map((item) => compactPromptItem(item, maxChars));
    const json = JSON.stringify(rows);
    if (json.length <= 240000 || maxChars === rowCharBudgets[rowCharBudgets.length - 1]) {
      return rows;
    }
  }
  return items.map((item) => compactPromptItem(item, 32));
}

const STANDARD_SINGLE_PROMPT_MAX_CHARS = 80000;
const STANDARD_CHUNK_PROMPT_MAX_CHARS = 60000;
const STANDARD_MAX_ROWS_PER_PROMPT = 8;
const STANDARD_RETRY_ROWS_PER_PROMPT = 4;
const STANDARD_MISSING_ROW_RETRIES = 2;
const APPLICABILITY_REVIEW_ROWS_PER_PROMPT = 12;
const CANONICAL_MAPPING_ROWS_PER_PROMPT = 40;
const DERIVED_STPA_FIELDS = new Set([
  "rawLossCandidate",
  "rawHazardCandidate",
  "canonicalLossId",
  "canonicalHazardId",
]);
const CAUSAL_FACTOR_CATEGORIES = new Set([
  "Controller logic / process model",
  "Sensor / feedback",
  "Actuator / physical process",
  "Communication / interface",
  "Timing / sequencing",
  "Power / energy",
  "Initialization / lifecycle",
  "Mode / state management",
  "Configuration / calibration",
  "Human / procedure",
  "Common-cause dependency",
]);
const SAFETY_SIGNIFICANCE_FIELDS = [
  ["proposedSafetyAssessment", "Proposed Safety Assessment"],
  ["proposedSafetyAssessmentRationale", "Proposed Safety Assessment Rationale"],
  ["safetySignificant", "Safety Significant"],
  ["safetySignificanceRationale", "Safety Significance Rationale"],
];
const GENERIC_HAZARD_PHRASES = [
  "processing errors",
  "communication errors",
  "system errors",
  "operational failures",
  "incorrect data handling",
  "degraded performance",
  "degraded model output",
  "incorrect decision-making",
  "downstream systems",
  "system misconfiguration",
  "system failure",
  "incorrect output",
  "miscommunication",
  "faulty processing",
  "system damage",
  "improper data processing",
];
const GENERIC_HAZARD_PHRASE_RE = new RegExp(
  `\\b(${GENERIC_HAZARD_PHRASES.map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i",
);
const CONCRETE_CAUSAL_CHAIN_GUIDANCE = `
Concrete causal-chain quality:
- Hazard/failure/effect wording must include a specific failure condition, local effect, system-level effect, and plausible consequence.
- Avoid standalone vague phrases such as "incorrect", "faulty", "not properly", "processing errors", "configuration usage", "system failure", or "unsafe behavior". If one of these words is necessary, immediately explain what is wrong, where it propagates, and what consequence it creates.
- Prefer concrete chains that name the affected row/context artifacts, states, interfaces, and downstream consumers instead of abstract failure labels.
- Ground every chain in the supplied row evidence, file/symbol names, and project / operational context.
`.trim();

const DOMAIN_NOUN_GUIDANCE = `
Domain-bearing noun quality:
- Extract and reuse concrete nouns from the row evidence and project / operational context, such as affected data, command, model input/output, interface, artifact, state, file/symbol, protocol/message payload, coordinate frame, token span, trajectory, processor, action bounds, or their domain-specific equivalents when present.
- Do not hardcode a domain. If those examples are not present in the row/context, use the concrete nouns that are present.
- Avoid generic endpoints such as "system behavior", "communication errors", "processing errors", "degraded performance", "incorrect decision-making", or "downstream systems" unless immediately tied to a named artifact, state, interface, and consequence.
- Each hazard-bearing field should name at least one concrete affected artifact, state, or interface from the row/context and one downstream consumer or effect when evidence supports it.
`.trim();

const SPECIFICITY_SELF_CHECK_GUIDANCE = `
Specificity self-check before returning:
- Review each hazard-bearing field before output. If it could apply unchanged to another software project, rewrite it.
- Replace phrases like "processing errors", "communication errors", "system errors", "operational failures", "incorrect data handling", "degraded performance", "degraded model output", "incorrect decision-making", or "downstream systems" with the concrete mechanism named by the row/context.
- The rewritten field should answer: what artifact/state/interface is wrong, which function/component consumes it, how it propagates, and what consequence follows.
- Prefer named row evidence over broad categories. Reuse function names, control actions, source symbols, file concepts, subsystem names, and user-provided context terms when they are relevant.
- If the row/context does not provide enough evidence to make the field concrete, return a short "Needs review:" note for that field instead of using generic filler.
`.trim();

function compactPromptRowsLength(items = []) {
  return JSON.stringify(compactPromptRows(items)).length;
}

function formatHazardOperationalContext({
  operationalContext = "",
  analysisContext = null,
  contextSources = null,
} = {}) {
  const parts = [];
  const context = sanitizeText(operationalContext).slice(0, 5000);
  if (context) parts.push(`Derived project / operational context:\n${context}`);

  const userText = sanitizeText(analysisContext?.text).slice(0, 2500);
  if (userText) parts.push(`User-provided context text:\n${userText}`);

  const fileSummaries = (analysisContext?.files || [])
    .map((file, index) => {
      const name = sanitizeText(file?.name || `context-${index + 1}.txt`).slice(0, 120);
      const content = sanitizeText(file?.content).slice(0, 1200);
      return content ? `Attached context file ${name}:\n${content}` : "";
    })
    .filter(Boolean)
    .slice(0, 3);
  parts.push(...fileSummaries);

  if (contextSources) {
    const sources = [];
    if (contextSources.readmePath) sources.push(`README: ${sanitizeText(contextSources.readmePath)}`);
    if (Array.isArray(contextSources.userContextFiles) && contextSources.userContextFiles.length) {
      sources.push(`User files: ${contextSources.userContextFiles.map((name) => sanitizeText(name)).filter(Boolean).join(", ")}`);
    }
    if (sources.length) parts.push(`Context sources:\n${sources.join("\n")}`);
  }

  return parts.join("\n\n").slice(0, 9000);
}

function chunkItemsForPrompt(items = [], maxChars = STANDARD_CHUNK_PROMPT_MAX_CHARS) {
  const chunks = [];
  let current = [];

  items.forEach((item) => {
    const candidate = [...current, item];
    if (current.length && (candidate.length > STANDARD_MAX_ROWS_PER_PROMPT || compactPromptRowsLength(candidate) > maxChars)) {
      chunks.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  });

  if (current.length) chunks.push(current);
  return chunks;
}

function chunkItemsByCount(items = [], size = STANDARD_RETRY_ROWS_PER_PROMPT) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function omitConsolidatedRequirementFromConfig(config) {
  if (!config) return config;
  return {
    ...config,
    promptGuidance: String(config.promptGuidance || "")
      .replace(/,?\s*and consolidated requirement/gi, "")
      .replace(/consolidated requirement,?\s*/gi, ""),
    fields: (config.fields || []).filter(([fieldName, label]) => (
      fieldName !== "consolidatedRequirement" &&
      label !== "Consolidated Requirement"
    )),
  };
}

function getStandardConfig(method) {
  if (method === "FMEA") {
    return {
      sheetName: "FMEA",
      analysisName: "Failure Modes and Effects Analysis (FMEA)",
      rowIdSuffix: "FMEA",
      promptGuidance: `
For each functional decomposition row, identify one credible software or interface failure mode. Be specific:
- Loss must describe the plausible adverse end state or consequence.
- Hazard must describe the unsafe state created by the failure mode and include the local effect, system-level effect, and plausible consequence.
- Failure mode must name the missing, wrong, late, stale, unintended, conflicting, or intermittent behavior and state what data, command, state, or interface is affected.
- Causal factor must name concrete technical, data, timing, interface, human, or environmental contributors.
- Mitigation, system requirement, and consolidated requirement must be tailored and testable.
${CONCRETE_CAUSAL_CHAIN_GUIDANCE}
${DOMAIN_NOUN_GUIDANCE}
${SPECIFICITY_SELF_CHECK_GUIDANCE}
`.trim(),
      fields: [
        ["loss", "Loss"],
        ["hazard", "Hazard"],
        ["failureMode", "Failure Mode"],
        ["causalFactor", "Causal Factor"],
        ["mitigationStrategy", "Mitigation Strategy"],
        ["systemRequirement", "System Requirement"],
        ["consolidatedRequirement", "Consolidated Requirement"],
      ],
    };
  }

  if (method === "WhatIf") {
    return {
      sheetName: "What-If",
      analysisName: "What-If Hazard Analysis",
      rowIdSuffix: "WI",
      promptGuidance: `
For each functional decomposition row, identify one credible what-if scenario. Be specific:
- Loss must describe the plausible adverse end state or consequence.
- Hazard must describe the unsafe impact category or state created by the scenario and include the local effect, system-level effect, and plausible consequence.
- What-if scenario must be phrased as a concrete "What if..." question that names the affected data, command, state, or interface.
- Causal factor must name concrete technical, data, timing, interface, human, or environmental contributors.
- Mitigation, system requirement, and consolidated requirement must be tailored and testable.
${CONCRETE_CAUSAL_CHAIN_GUIDANCE}
${DOMAIN_NOUN_GUIDANCE}
${SPECIFICITY_SELF_CHECK_GUIDANCE}
`.trim(),
      fields: [
        ["loss", "Loss"],
        ["hazard", "Hazard"],
        ["whatIfScenario", "What-If Scenario"],
        ["causalFactor", "Causal Factor"],
        ["mitigationStrategy", "Mitigation Strategy"],
        ["systemRequirement", "System Requirement"],
        ["consolidatedRequirement", "Consolidated Requirement"],
      ],
    };
  }

  return {
    sheetName: "STPA Traceability Matrix",
    analysisName: "STPA textbook hazard analysis",
    rowIdSuffix: "STPA",
    promptGuidance: `
For each functional decomposition row, identify one credible unsafe control action and the safety constraint. Be specific:
- If a Guide Phrase is supplied, first decide whether that guide phrase is applicable to the exact Function From / Control Action / Function To interface.
- guidePhraseApplicable must be exactly Yes or No.
- guidePhraseApplicabilityRationale must briefly explain the applicability decision for that guide phrase and interface.
- Mark Yes only when the exact deviation described by the guide phrase is meaningful for this control-action type in the exact operational scenario/mode and has a credible causal path to an adverse state. Abstract possibility, generic failure language, or merely being able to restate the guide phrase is insufficient.
- Mark No when the deviation has no meaningful semantics for the control-action type, is precluded by an authoritative context assumption, cannot affect the target in that mode, or has no credible adverse consequence. Normal, stationary, startup, shutdown, maintenance, degraded, and recovery contexts often differ; assess rather than assuming all seven guide phrases apply.
- Do not force a quota or distribution, but treat an all-Yes result as a warning and re-check each interface/context combination independently.
- Only assess applicable guide phrases. If guidePhraseApplicable is No, set hazard-bearing fields to "Not applicable:" with a short reason and classify the row as Mission/Reliability during safety significance review.
- Losses must describe plausible adverse end states or consequences.
- Keep Losses at the system level and reusable. Do not encode the guide phrase, causal mechanism, interface name, or operational-context detail in a Loss. Reuse the same concise Loss wording when multiple rows lead to the same adverse end state.
- Hazards must describe unsafe system states, not generic failures, and include the local effect, system-level effect, and plausible consequence.
- Keep Hazards reusable across rows that reach the same unsafe system state. Put interface-specific deviation and context detail in the unsafe control action and causal scenario instead of creating a differently worded Hazard for every row.
- Unsafe control action must be phrased as the supplied Control Action combined with the applicable Guide Phrase. For example, if controlAction is "send braking command" and guidePhrase is "The control action is provided too late", write "Send braking command is provided too late..." and then add the affected data, command, state, or interface.
- Unsafe control action must name whether the control action is missing, provided when hazardous, too early, too late, in the wrong order, stopped too soon, or applied too long.
- Causal factors must name concrete technical, data, timing, interface, human, or environmental contributors.
- Keep causalScenario, causalFactors, mitigationStrategy, safetyRequirementsConstraints, and systemRequirement distinct. A failure, error, delay, stale state, or loss belongs in causalScenario/causalFactors—not mitigationStrategy.
- causalFactorCategory must be one of: Controller logic / process model; Sensor / feedback; Actuator / physical process; Communication / interface; Timing / sequencing; Power / energy; Initialization / lifecycle; Mode / state management; Configuration / calibration; Human / procedure; Common-cause dependency.
- For a non-applicable row only, causalFactorCategory and requirementParameterSource must be exactly Not applicable.
- mitigationStrategy must describe a design measure, detection mechanism, independence provision, fallback, constraint, or verification activity that reduces the cause or consequence.
- mitigationStrategy must name the responsible function or subsystem and the concrete mechanism it adds. Avoid generic imperatives such as "implement redundancy" or "add validation" without naming what is compared, detected, rejected, inhibited, isolated, or placed into a safe/degraded state.
- Safety requirement or constraint must be tailored and verifiable. systemRequirement should state the implementable obligation and safetyRequirementsConstraints should state the safety invariant it enforces.
- Write systemRequirement as: "The [allocated system element] shall [observable behavior] when or while [condition], verified by [observable evidence or verification approach]." Do not return a bare design suggestion beginning only with Implement, Ensure, or Optimize.
- The allocated system element must be an exact functionFrom, functionTo, or subsystem name from the supplied row. Never invent placeholders such as "Application Subsystem", "System Component", or "Relevant Module". Prefer the receiver for validation/consumption behavior and the sender for publication/delivery behavior.
- Allocate requirements to an element that can control the required behavior. When the source is an external input or disturbance, require detection, validation, degraded operation, inhibition, fallback, or safe response rather than guaranteeing the external condition.
- Do not invent numerical thresholds. Use a named parameter such as [TBD-response-time] unless the supplied evidence includes a requirement, specification, calculation, standard, or allocated safety/timing budget. Record that basis in requirementParameterSource; otherwise write TBD.
- Treat contextAssumptions as architecture invariants. Check controller, sensor, communication, power, actuator, and mechanical-fallback availability before proposing a control or requirement; never require an unavailable channel or powered action.
${CONCRETE_CAUSAL_CHAIN_GUIDANCE}
${DOMAIN_NOUN_GUIDANCE}
${SPECIFICITY_SELF_CHECK_GUIDANCE}
`.trim(),
    fields: [
      ["rawAnalysisRowId", "Raw Analysis Row ID"],
      ["guidePhrase", "Guide Phrase"],
      ["guidePhraseApplicable", "Guide Phrase Applicable"],
      ["guidePhraseApplicabilityRationale", "Guide Phrase Applicability Rationale"],
      ["controlActionType", "Control Action Type"],
      ["losses", "Losses"],
      ["hazards", "Hazards"],
      ["rawLossCandidate", "Raw Loss Candidate"],
      ["rawHazardCandidate", "Raw Hazard Candidate"],
      ["canonicalLossId", "Canonical Loss ID"],
      ["canonicalHazardId", "Canonical Hazard ID"],
      ["unsafeControlActions", "Unsafe Control Actions"],
      ["causalScenario", "Causal Scenario"],
      ["causalFactors", "Causal Factors"],
      ["causalFactorCategory", "Causal Factor Category"],
      ["mitigationStrategy", "Mitigation Strategy"],
      ["safetyRequirementsConstraints", "Safety Requirements/Constraints"],
      ["systemRequirement", "System Requirement"],
      ["requirementParameterSource", "Requirement Parameter Source"],
    ],
  };
}

function generatedRowKey(row = {}) {
  const id = sanitizeText(row.id);
    const match = id.match(/\bFD-\d+(?:-GP-\d+)?\b/i);
  return match ? match[0].toUpperCase() : id.toUpperCase();
}

function generatedRowsById(rows = []) {
  const byId = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = generatedRowKey(row);
    if (key) byId.set(key, row);
  });
  return byId;
}

function generatedRowForItem(rowsById, rows, index, item) {
  const itemKey = String(item?.id || "").toUpperCase();
  const matched = rowsById.get(itemKey);
  if (matched) return matched;
  const candidate = Array.isArray(rows) ? rows[index] : null;
  const candidateKey = generatedRowKey(candidate);
  if (!candidateKey || candidateKey === itemKey) return candidate || {};
  return {};
}

function fallbackRow(config, item, index) {
  const common = {
    id: `${item.id || `FD-${index + 1}`}-${config.rowIdSuffix}`,
    rawAnalysisRowId: createSafetyModelId("RAW", `${item.from}|${item.controlAction}|${item.to}|${item.guidePhrase}|${item.operationalContextId}`),
    guidePhrase: sanitizeText(item.guidePhrase),
    guidePhraseApplicable: normalizeGuidePhraseApplicability(item.guidePhraseApplicable),
    guidePhraseApplicabilityRationale: sanitizeText(item.guidePhraseApplicabilityRationale) || "Needs review: guide phrase applicability was not generated.",
    loss: `Needs review: loss was not generated for ${item.id || `FD-${index + 1}`}.`,
    losses: `Needs review: losses were not generated for ${item.id || `FD-${index + 1}`}.`,
    hazard: `Needs review: hazard was not generated for ${item.id || `FD-${index + 1}`}.`,
    hazards: `Needs review: hazards were not generated for ${item.id || `FD-${index + 1}`}.`,
    rawLossCandidate: "",
    rawHazardCandidate: "",
    canonicalLossId: "",
    canonicalHazardId: "",
    causalFactor: `Needs review: causal factor was not generated for ${item.id || `FD-${index + 1}`}.`,
    causalFactors: `Needs review: causal factors were not generated for ${item.id || `FD-${index + 1}`}.`,
    causalScenario: `Needs review: causal scenario was not generated for ${item.id || `FD-${index + 1}`}.`,
    causalFactorCategory: "Controller logic / process model",
    mitigationStrategy: `Needs review: mitigation was not generated for ${item.id || `FD-${index + 1}`}.`,
    systemRequirement: `Needs review: system requirement was not generated for ${item.id || `FD-${index + 1}`}.`,
    consolidatedRequirement: `Needs review: consolidated requirement was not generated for ${item.id || `FD-${index + 1}`}.`,
    safetyRequirementsConstraints: `Needs review: safety constraint was not generated for ${item.id || `FD-${index + 1}`}.`,
    requirementParameterSource: "TBD",
    controlActionType: item.controlActionType || inferControlActionType(item.controlAction, item.from, item.to),
    failureMode: `Needs review: failure mode was not generated for ${item.id || `FD-${index + 1}`}.`,
    whatIfScenario: `Needs review: what-if scenario was not generated for ${item.id || `FD-${index + 1}`}.`,
    unsafeControlActions: `Needs review: unsafe control action was not generated for ${item.id || `FD-${index + 1}`}.`,
  };
  return common;
}

function formatControlActionForUca(controlAction = "") {
  const action = sanitizeText(controlAction);
  if (!action) return "The control action";
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function buildGuidePhraseUnsafeControlAction(item = {}, generatedValue = "", guidePhraseApplicableValue = "") {
  const guidePhrase = sanitizeText(item?.guidePhrase);
  const controlAction = formatControlActionForUca(item?.controlAction);
  const generated = sanitizeText(generatedValue);
  const applicable = normalizeGuidePhraseApplicability(guidePhraseApplicableValue || item?.guidePhraseApplicable);

  if (applicable === "No") {
    return generated.startsWith("Not applicable:")
      ? generated
      : `Not applicable: ${guidePhrase || "the guide phrase"} is not applicable to ${sanitizeText(item?.controlAction) || "this control action"} for this interface.`;
  }

  if (!guidePhrase) {
    return generated || `Needs review: unsafe control action was not generated for ${item.id || "this row"}.`;
  }
  const actionType = item.controlActionType || inferControlActionType(item.controlAction, item.from, item.to);
  const requiredPrefix = `${controlAction}: ${semanticGuidePhrase(actionType, guidePhrase)}`;

  const normalizedGenerated = generated.toLowerCase();
  if (generated && normalizedGenerated.includes(requiredPrefix.toLowerCase())) return generated;
  if (!generated || /^needs review:/i.test(generated)) {
    return `${requiredPrefix} for ${sanitizeText(item?.to) || "the target function"}.`;
  }
  return `${requiredPrefix}: ${generated}`;
}

function normalizeRow(config, row, item, index) {
  const base = fallbackRow(config, item, index);
  const normalized = {
    id: sanitizeText(row.id) || base.id,
    proposedSafetyAssessment: normalizeProposedSafetyAssessment(
      row.proposedSafetyAssessment || row["Proposed Safety Assessment"] || row.safetyAssessment || row["Safety Assessment"],
      row.safetySignificant || row["Safety Significant"],
    ),
    proposedSafetyAssessmentRationale: sanitizeText(row.proposedSafetyAssessmentRationale || row["Proposed Safety Assessment Rationale"]),
    safetySignificant: normalizeSafetySignificance(row.safetySignificant || row["Safety Significant"]),
    safetySignificanceRationale: sanitizeText(row.safetySignificanceRationale || row["Safety Significance Rationale"]),
  };
  config.fields.forEach(([fieldName]) => {
    if (fieldName === "rawAnalysisRowId") {
      normalized[fieldName] = base.rawAnalysisRowId;
    } else if (fieldName === "guidePhrase") {
      normalized[fieldName] = sanitizeText(item?.guidePhrase) || sanitizeText(row[fieldName] || row["Guide Phrase"]) || base[fieldName] || "";
    } else if (fieldName === "guidePhraseApplicable") {
      normalized[fieldName] = normalizeGuidePhraseApplicability(row[fieldName] || row["Guide Phrase Applicable"] || item?.guidePhraseApplicable);
    } else if (fieldName === "guidePhraseApplicabilityRationale") {
      normalized[fieldName] = sanitizeText(row[fieldName] || row["Guide Phrase Applicability Rationale"] || item?.guidePhraseApplicabilityRationale) || base[fieldName] || "";
    } else if (fieldName === "unsafeControlActions") {
      normalized[fieldName] = buildGuidePhraseUnsafeControlAction(
        item,
        row[fieldName] || row["Unsafe Control Actions"] || base[fieldName],
        normalized.guidePhraseApplicable || row.guidePhraseApplicable || row["Guide Phrase Applicable"],
      );
    } else if (fieldName === "controlActionType") {
      normalized[fieldName] = item?.controlActionType || inferControlActionType(item?.controlAction, item?.from, item?.to);
    } else if (fieldName === "causalFactorCategory") {
      const category = sanitizeText(row[fieldName]);
      normalized[fieldName] = CAUSAL_FACTOR_CATEGORIES.has(category)
        ? category
        : inferCausalFactorCategory(row.causalFactors || row.causalScenario);
    } else if (fieldName === "systemRequirement" || fieldName === "safetyRequirementsConstraints") {
      const parameterized = parameterizeUnsupportedRequirement(
        sanitizeText(row[fieldName]) || base[fieldName] || "",
        row.requirementParameterSource,
      );
      normalized[fieldName] = fieldName === "systemRequirement"
        ? normalizeGenericRequirementOwner(parameterized, item)
        : parameterized;
    } else {
      normalized[fieldName] = sanitizeText(row[fieldName]) || base[fieldName] || "";
    }
  });
  return normalized.guidePhraseApplicable === "No"
    ? normalizeNonApplicableHazardRecord(normalized, normalized.guidePhraseApplicabilityRationale)
    : normalized;
}

export function materializeGeneratedHazardRows(config, generatedRows = [], items = []) {
  return items.map((item, index) => normalizeRow(config, generatedRows[index] || {}, item, index));
}

function normalizeGuidePhraseApplicability(value) {
  const text = sanitizeText(value).toLowerCase();
  if (/^yes\b|^applicable\b|^true\b/.test(text)) return "Yes";
  if (/^no\b|^not applicable\b|^false\b/.test(text)) return "No";
  return "Yes";
}

function normalizeSafetySignificance(value) {
  const text = sanitizeText(value).toLowerCase();
  if (/^yes\b|^safety\b|^safety\s*significant\b|^significant\b/i.test(text)) return "Yes";
  return "Needs Review";
}

function normalizeProposedSafetyAssessment(value, safetySignificantValue = "") {
  const text = sanitizeText(value).toLowerCase();
  if (/^safety\b|safety[-\s]?critical|safety\s*significant/.test(text)) return "Safety";
  if (!text && normalizeSafetySignificance(safetySignificantValue) === "Yes") return "Safety";
  return "Mission/Reliability";
}

function normalizeAuditBoolean(value) {
  const normalizedValue = sanitizeText(value).toLowerCase();
  if (/^(?:yes|true|supported|present)\b/.test(normalizedValue)) return true;
  if (/^(?:no|false|unsupported|absent)\b/.test(normalizedValue)) return false;
  return null;
}

export function deriveStructuredApplicability(tag = {}, fallback = {}) {
  const dimensions = [
    "semanticMeaningful",
    "receiverCanBeAffected",
    "contextSupportsMechanism",
    "adverseStateSupported",
  ].map((fieldName) => normalizeAuditBoolean(tag[fieldName]));
  const hasCompleteDecision = dimensions.every((value) => value !== null);
  const applicable = hasCompleteDecision
    ? dimensions.every(Boolean)
    : normalizeGuidePhraseApplicability(tag.guidePhraseApplicable || fallback.guidePhraseApplicable) === "Yes";
  const mechanism = sanitizeText(tag.applicabilityMechanism);
  const contextEvidence = sanitizeText(tag.contextEvidence);
  const noReason = sanitizeText(tag.strongestReasonForNo || tag.reasonNotApplicable);
  let rationale = sanitizeText(tag.guidePhraseApplicabilityRationale || fallback.guidePhraseApplicabilityRationale);
  if (hasCompleteDecision && applicable) {
    rationale = [mechanism, contextEvidence ? `Context basis: ${contextEvidence}` : ""].filter(Boolean).join(" ")
      || rationale;
  } else if (hasCompleteDecision && !applicable) {
    rationale = noReason ? `Not applicable because ${noReason.replace(/^not applicable because\s*/i, "")}` : rationale;
  }
  return {
    guidePhraseApplicable: applicable ? "Yes" : "No",
    guidePhraseApplicabilityRationale: rationale || (applicable
      ? "Needs review: supporting mechanism was not returned."
      : "Not applicable because the structured review did not establish every required applicability dimension."),
    hasCompleteDecision,
  };
}

const APPLICABILITY_EVIDENCE_FIELDS = {
  "function from": "from",
  functionfrom: "from",
  "control action": "controlAction",
  controlaction: "controlAction",
  "function to": "to",
  functionto: "to",
  "operational scenario": "operationalScenario",
  operationalscenario: "operationalScenario",
  "operational mode": "operationalMode",
  operationalmode: "operationalMode",
  "operating conditions": "operatingConditions",
  operatingconditions: "operatingConditions",
  "context assumptions": "contextAssumptions",
  contextassumptions: "contextAssumptions",
};

function normalizedEvidenceText(value = "") {
  return sanitizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function groundedEvidence(fieldValue = "", quoteValue = "", item = {}) {
  const requestedField = normalizedEvidenceText(fieldValue).replace(/\s+/g, " ");
  const itemField = APPLICABILITY_EVIDENCE_FIELDS[requestedField];
  const evidenceQuote = sanitizeText(quoteValue);
  const sourceValue = sanitizeText(itemField ? item[itemField] : "");
  const normalizedQuote = normalizedEvidenceText(evidenceQuote);
  return {
    evidenceQuote,
    itemField,
    grounded: Boolean(
      itemField
      && normalizedQuote.length >= 8
      && normalizedEvidenceText(sourceValue).includes(normalizedQuote)
    ),
  };
}

function guideSpecificEvidencePattern(guidePhrase = "", actionType = "") {
  const guide = normalizedEvidenceText(guidePhrase);
  if (/not providing/.test(guide)) return null;
  if (/providing the control action/.test(guide)) {
    return /external input|disturbance/i.test(actionType)
      ? /\b(?:hazard|adverse|obstacle|person|environment|weather|terrain|condition|disturbance|exposure|unavailable|occlud|degrad)\b/i
      : /\b(?:invalid|incorrect|untrusted|unauthoriz\w*|inconsistent|conflict\w*|corrupt\w*|out[ -]of[ -]range|low[ -]quality|insufficient confidence|excessive uncertainty)\b/i;
  }
  if (/too early/.test(guide)) return /\b(?:before|prerequis|ready|readiness|window|startup|initiali|activation|phase|transition)\b/i;
  if (/too late/.test(guide)) return /\b(?:latency|deadline|timely|real[ -]?time|response[ -]time|update[ -]interval|freshness|time[ -]critical|decision[ -]point)\b/i;
  if (/wrong order/.test(guide)) return /\b(?:orders?|sequences?|versions?|priors?|timestamps?|synchron\w*|align\w*|transitions?|dependencies|dependency|frames?)\b/i;
  if (/stopped too soon/.test(guide)) return /\b(?:continuous(?:ly)?|ongoing|maintain\w*|stream\w*|periodic|updates? cease|availability interval|duration|held|sustain\w*)\b/i;
  if (/applied too long/.test(guide)) return /\b(?:freshness|stale|validity interval|expire\w*|revok\w*|timeouts?|bounded latency|maximum duration|completion boundary|supersed\w*|data age)\b/i;
  return null;
}

const EVIDENCE_RELEVANCE_STOP_WORDS = new Set([
  "acquire", "action", "active", "apply", "autonomy", "available", "control", "data", "environment",
  "function", "generate", "information", "manage", "monitor", "operation", "operating", "provide", "publish",
  "receive", "report", "request", "service", "system", "vehicle",
]);

function evidenceRelevanceTokens(value = "") {
  return normalizedEvidenceText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !EVIDENCE_RELEVANCE_STOP_WORDS.has(token));
}

function evidenceReferencesInterface(evidence = {}, item = {}) {
  if (["from", "controlAction", "to"].includes(evidence.itemField)) return true;
  const evidenceTokens = new Set(evidenceRelevanceTokens(evidence.evidenceQuote));
  const interfaceTokens = evidenceRelevanceTokens(`${item.from} ${item.controlAction} ${item.to}`);
  return interfaceTokens.some((token) => evidenceTokens.has(token));
}

function guideMechanismPattern(guidePhrase = "") {
  const guide = normalizedEvidenceText(guidePhrase);
  if (/not providing/.test(guide)) return /\b(?:absent|missing|unavailable|not provided|ceases?|lost|omitted)\b/i;
  if (/providing the control action/.test(guide)) return /\b(?:invalid|incorrect|unsafe|unwanted|unauthoriz\w*|inconsistent|conflict\w*|corrupt\w*|not required|out[ -]of[ -]range)\b/i;
  if (/too early/.test(guide)) return /\b(?:early|before|prerequis|not ready|window|premature|startup|activation|transition)\b/i;
  if (/too late/.test(guide)) return /\b(?:late|delay\w*|latency|deadline|stale|after|missed|response time|decision point)\b/i;
  if (/wrong order/.test(guide)) return /\b(?:wrong order|out of order|out of sequence|sequence|version|prior|timestamp|synchron\w*|dependency|before prerequisite)\b/i;
  if (/stopped too soon/.test(guide)) return /\b(?:stopped|ceases?|terminat\w*|ends? early|incomplete|interrupted|premature|updates? stop)\b/i;
  if (/applied too long/.test(guide)) return /\b(?:too long|stale|outdated|expired|beyond.*valid|not revoked|persists?|retains?|held|superseded)\b/i;
  return null;
}

function actionSupportsOrdering(item = {}, actionType = "") {
  const value = normalizedEvidenceText(`${item.controlAction} ${item.from} ${item.to}`);
  return /mode transition|configuration|authority|command|request|state estimate|information|data|feedback|status/i.test(actionType)
    && /\b(?:align\w*|associat\w*|command\w*|configur\w*|constraint\w*|convert\w*|execut\w*|fus\w*|measurement\w*|mode\w*|plan\w*|predict\w*|reference\w*|route\w*|select\w*|state\w*|target\w*|trajector\w*|transform\w*|update\w*|version\w*)\b/i.test(value);
}

function actionSupportsDuration(item = {}, actionType = "") {
  const action = normalizedEvidenceText(item.controlAction);
  const interfaceText = normalizedEvidenceText(`${item.controlAction} ${item.from} ${item.to}`);
  const discreteRequest = /command|request|event/i.test(actionType)
    && /\b(?:request\w*|submit\w*|notify\w*|acknowledg\w*|trigger\w*|alert\w*)\b/i.test(action)
    && !/\b(?:actuat\w*|brak\w*|steer\w*|throttle\w*|hold\w*|maintain\w*|motion\w*)\b/i.test(action);
  if (discreteRequest) return false;
  return /force|resource flow|mode transition/i.test(actionType)
    || /\b(?:actuat\w*|availability|continuous|feedback|health|maintain\w*|measurement\w*|monitor\w*|motion|observation\w*|periodic|publish\w*|regulat\w*|state|status|stream\w*|track\w*|updates?)\b/i.test(interfaceText);
}

function actionSupportsRetention(item = {}, actionType = "") {
  if (/event|external input|disturbance/i.test(actionType)) return false;
  const value = normalizedEvidenceText(`${item.controlAction} ${item.from} ${item.to}`);
  return /configuration|authority|mode transition|state estimate|information|data|feedback|status/i.test(actionType)
    && /\b(?:configur\w*|constraint\w*|estimate\w*|forecast\w*|map\w*|measurement\w*|mode\w*|plan\w*|prediction\w*|reference\w*|state\w*|status|target\w*|trajector\w*|transform\w*|updates?|world model)\b/i.test(value);
}

function contextIsTimeCritical(item = {}) {
  return /\b(?:moving|in motion|traffic|real[ -]?time|dynamic|continuous operation|active operation|operating speed|dense urban|pedestrian|cyclist|machinery running)\b/i.test([
    item.operationalScenario,
    item.operationalMode,
    item.operatingConditions,
    item.contextAssumptions,
  ].map(sanitizeText).join(" "));
}

function findGuideSpecificEvidence(item = {}, guidePhrase = "", actionType = "") {
  const pattern = guideSpecificEvidencePattern(guidePhrase, actionType);
  if (!pattern) return null;
  const candidates = [
    ["Context Assumptions", item.contextAssumptions],
    ["Operating Conditions", item.operatingConditions],
    ["Operational Scenario", item.operationalScenario],
    ["Operational Mode", item.operationalMode],
    ["Control Action", item.controlAction],
    ["Function From", item.from],
    ["Function To", item.to],
  ];
  for (const [field, source] of candidates) {
    const exactSource = sanitizeText(source);
    const clauses = exactSource.split(/[;\n]+/).map((clause) => clause.trim()).filter(Boolean);
    const quote = clauses.find((clause) => {
      if (!pattern.test(clause)) return false;
      return evidenceReferencesInterface({
        evidenceQuote: clause,
        itemField: APPLICABILITY_EVIDENCE_FIELDS[normalizedEvidenceText(field)],
      }, item);
    });
    if (quote) return { field, quote };
  }
  return null;
}

export function validateApplicabilityEvidence(tag = {}, item = {}) {
  const structured = deriveStructuredApplicability(tag, item);
  if (structured.guidePhraseApplicable === "No") return structured;

  let evidence = groundedEvidence(
    tag.applicabilityEvidenceField || tag.evidenceField,
    tag.applicabilityEvidenceQuote || tag.evidenceQuote,
    item,
  );
  if (!evidence.grounded) {
    return {
      guidePhraseApplicable: "No",
      guidePhraseApplicabilityRationale: "Not applicable because the proposed supporting evidence was not an exact excerpt from the supplied interface or operational context.",
      hasCompleteDecision: structured.hasCompleteDecision,
      evidenceGrounded: false,
    };
  }

  const guidePhrase = sanitizeText(item.guidePhrase).toLowerCase();
  const actionType = sanitizeText(item.controlActionType || inferControlActionType(item.controlAction, item.from, item.to));
  const operationalContextText = [
    item.operationalScenario,
    item.operationalMode,
    item.operatingConditions,
    item.contextAssumptions,
  ].map(normalizedEvidenceText).join(" ");
  const mechanismTerms = normalizedEvidenceText(tag.applicabilityMechanism);
  const mechanismPattern = guideMechanismPattern(guidePhrase);
  const mechanismSpecific = !mechanismPattern || mechanismPattern.test(mechanismTerms);
  const evaluateEvidence = (candidateEvidence) => {
    const evidenceTerms = normalizedEvidenceText(candidateEvidence.evidenceQuote);
    const evidencePattern = guideSpecificEvidencePattern(guidePhrase, actionType);
    const evidenceSemantic = !evidencePattern || evidencePattern.test(evidenceTerms);
    const evidenceRelevant = evidenceReferencesInterface(candidateEvidence, item);
    const interfaceEvidence = ["from", "controlAction", "to"].includes(candidateEvidence.itemField);
    let supported = true;
    let reason = "the cited evidence does not establish the guide-phrase-specific mechanism for this interface";

    if (/not providing/.test(guidePhrase)) {
      supported = true;
      reason = "the structured review did not establish an adverse effect from the action becoming absent or unavailable";
    } else if (/providing the control action/.test(guidePhrase)) {
      supported = mechanismSpecific && evidenceRelevant && (evidenceSemantic || interfaceEvidence);
      reason = "the supplied evidence does not establish a hazardous value, command, authority, or external condition for this interface";
    } else if (/too early/.test(guidePhrase)) {
      const explicitEarlyBoundary = evidenceSemantic || /\b(?:before|prerequis|not ready|window|premature|startup|activation|transition)\b/.test(mechanismTerms);
      const receiverNormallyAbsorbsEarlyArrival = /\b(?:align|buffer|queue|store|synchron|validate|filter)\b/.test(normalizedEvidenceText(item.to));
      supported = mechanismSpecific && evidenceRelevant && explicitEarlyBoundary
        && (!receiverNormallyAbsorbsEarlyArrival || /\b(?:before|prerequis|not ready|window|startup|activation)\b/.test(mechanismTerms));
      reason = receiverNormallyAbsorbsEarlyArrival
        ? "the receiver can align, buffer, store, validate, or filter early input and no unsafe precondition or acceptance window is established"
        : "the supplied evidence does not establish an unsafe prerequisite or acceptance window for early provision";
    } else if (/too late/.test(guidePhrase)) {
      supported = mechanismSpecific && (evidenceRelevant || contextIsTimeCritical(item)) && (evidenceSemantic || interfaceEvidence || contextIsTimeCritical(item));
      reason = "the supplied evidence does not establish a deadline, freshness boundary, decision point, or time-sensitive receiver dependency";
    } else if (/wrong order/.test(guidePhrase)) {
      supported = mechanismSpecific && actionSupportsOrdering(item, actionType) && evidenceRelevant
        && (evidenceSemantic || interfaceEvidence);
      reason = actionSupportsOrdering(item, actionType)
        ? "the supplied evidence does not bind a sequence, version, dependency, or prerequisite to this interface"
        : "this action and receiver do not establish an order-dependent interaction";
    } else if (/stopped too soon/.test(guidePhrase)) {
      supported = mechanismSpecific && actionSupportsDuration(item, actionType) && evidenceRelevant
        && (evidenceSemantic || interfaceEvidence);
      reason = actionSupportsDuration(item, actionType)
        ? "the supplied evidence does not bind an ongoing stream, maintained assertion, transfer, or duration to this interface"
        : "this discrete action has no maintained duration or multi-part transfer that can stop too soon";
    } else if (/applied too long/.test(guidePhrase)) {
      supported = mechanismSpecific && actionSupportsRetention(item, actionType) && evidenceRelevant
        && (evidenceSemantic || interfaceEvidence);
      reason = actionSupportsRetention(item, actionType)
        ? "the supplied evidence does not bind a freshness, validity, revocation, timeout, or completion boundary to this interface"
        : "this action does not establish a retained value, state, authority, mode, or duration that can remain active too long";
    }
    return { supported, reason };
  };

  let evidenceEvaluation = evaluateEvidence(evidence);
  let semanticSupport = evidenceEvaluation.supported;
  let unsupportedReason = evidenceEvaluation.reason;
  if (!semanticSupport && /too late|wrong order|stopped too soon|applied too long/i.test(guidePhrase)) {
    const fallbackEvidence = findGuideSpecificEvidence(item, guidePhrase, actionType);
    if (fallbackEvidence) {
      const candidateEvidence = {
        evidenceQuote: fallbackEvidence.quote,
        itemField: APPLICABILITY_EVIDENCE_FIELDS[normalizedEvidenceText(fallbackEvidence.field)],
        grounded: true,
        field: fallbackEvidence.field,
      };
      evidenceEvaluation = evaluateEvidence(candidateEvidence);
      if (evidenceEvaluation.supported) {
        evidence = candidateEvidence;
        semanticSupport = true;
      } else {
        unsupportedReason = evidenceEvaluation.reason;
      }
    }
  }
  if (/configuration|authority/i.test(actionType)) {
    const steadyValidConfiguration = /\b(?:active|approved|valid|current)\b/.test(operationalContextText);
    const explicitConfigurationChange = /\b(?:expire|revok|timeout|revision|new version|required update|transition|supersed|change request|activation request)\b/.test(operationalContextText);
    if (steadyValidConfiguration && !explicitConfigurationChange && /providing the control action|too late|wrong order|stopped too soon|applied too long/i.test(guidePhrase)) {
      semanticSupport = false;
      unsupportedReason = "the supplied context describes a valid active configuration and does not establish a change, replacement, revocation, or transition for this deviation";
    }
  }
  if (!semanticSupport) {
    return {
      guidePhraseApplicable: "No",
      guidePhraseApplicabilityRationale: `Not applicable because ${unsupportedReason}.`,
      hasCompleteDecision: structured.hasCompleteDecision,
      evidenceGrounded: true,
    };
  }

  const mechanism = sanitizeText(tag.applicabilityMechanism);
  return {
    guidePhraseApplicable: "Yes",
    guidePhraseApplicabilityRationale: `${mechanism || "The cited interface mechanism can affect the receiver."} Evidence: ${evidence.field || tag.applicabilityEvidenceField || tag.evidenceField} — “${evidence.evidenceQuote}”.`,
    hasCompleteDecision: structured.hasCompleteDecision,
    evidenceGrounded: true,
  };
}

export function deriveStructuredSafetyAssessment(tag = {}, fallback = {}, { applicable = true, requireEvidence = false, item = {} } = {}) {
  if (!applicable) {
    return {
      proposedSafetyAssessment: "Mission/Reliability",
      proposedSafetyAssessmentRationale: "The guide phrase is not applicable in the stated operational context.",
      safetySignificant: "Needs Review",
    };
  }
  let assessment = normalizeProposedSafetyAssessment(tag.proposedSafetyAssessment, tag.safetySignificant);
  const exposureCategory = sanitizeText(tag.safetyExposureCategory);
  const exposurePath = sanitizeText(tag.safetyExposurePath);
  const exposureUnsupported = /^none\b|unsupported/i.test(exposureCategory) || /^none\b|unsupported/i.test(exposurePath);
  const safetyEvidence = groundedEvidence(tag.safetyEvidenceField, tag.safetyEvidenceQuote, item);
  const exposureSupported = Boolean(exposureCategory && exposurePath && !exposureUnsupported && (!requireEvidence || safetyEvidence.grounded));
  const generatedSafetyChain = [
    exposurePath,
    tag.proposedSafetyAssessmentRationale,
    tag.safetySignificanceRationale,
    fallback.loss,
    fallback.losses,
    fallback.hazard,
    fallback.hazards,
    fallback.unsafeControlAction,
    fallback.unsafeControlActions,
    fallback.causalScenario,
    fallback.proposedSafetyAssessmentRationale,
  ].map(sanitizeText).join(" ");
  const explicitPhysicalHarmPath = /\b(?:collision|crash|injur\w*|fatal\w*|death|physical harm|strik(?:e|ing)|crush\w*|burn\w*|electrocut\w*|toxic release|environmental harm|loss of (?:vehicle|machine|motion|physical) control|unintended (?:physical )?(?:motion|movement|actuation)|vehicle instability|rollover|hazardous energy|damage to (?:a )?safety[- ]critical asset)\b/i.test(generatedSafetyChain);
  if (requireEvidence && exposureUnsupported) assessment = "Mission/Reliability";
  if (requireEvidence && !safetyEvidence.grounded) assessment = "Mission/Reliability";
  if (requireEvidence && exposureSupported) assessment = "Safety";
  // A generated causal chain that explicitly reaches physical harm is itself
  // safety-significant. Do not create a contradictory Mission/Reliability row
  // merely because the auditor cited the wrong context field for that exposure.
  if (explicitPhysicalHarmPath) assessment = "Safety";
  const harmRationale = [
    exposurePath && !exposureUnsupported ? exposurePath : "",
    tag.proposedSafetyAssessmentRationale,
    fallback.proposedSafetyAssessmentRationale,
    fallback.hazards,
    fallback.hazard,
    fallback.losses,
    fallback.loss,
  ].map(sanitizeText).find((value) => value && /\b(?:collision|crash|injur\w*|fatal\w*|death|physical harm|strik(?:e|ing)|crush\w*|burn\w*|electrocut\w*|toxic release|environmental harm|loss of (?:vehicle|machine|motion|physical) control|unintended (?:physical )?(?:motion|movement|actuation)|vehicle instability|rollover|hazardous energy|safety[- ]critical asset)\b/i.test(value));
  const rationale = requireEvidence && assessment === "Safety" && explicitPhysicalHarmPath
    ? `Safety: ${(harmRationale || "The generated causal chain reaches a credible physical-harm state.").replace(/^(?:safety|mission\/reliability):\s*/i, "")}`
    : requireEvidence && exposurePath
      ? `${assessment}: ${exposurePath.replace(/^(?:safety|mission\/reliability):\s*/i, "")}`
    : sanitizeText(tag.proposedSafetyAssessmentRationale)
      || sanitizeText(tag.safetySignificanceRationale)
      || sanitizeText(fallback.proposedSafetyAssessmentRationale)
      || "Needs review: proposed safety assessment rationale was not generated.";
  return {
    proposedSafetyAssessment: assessment,
    proposedSafetyAssessmentRationale: rationale,
    safetySignificant: assessment === "Safety" ? "Yes" : "Needs Review",
  };
}

function hazardInterfaceKey(item = {}) {
  return [
    item.from,
    item.controlAction,
    item.to,
    item.operationalContextId,
    item.operationalScenario,
    item.operationalMode,
  ].map((value) => sanitizeText(value).toLowerCase()).join("|");
}

export function findApplicabilityCalibrationIndexes(rows = [], items = []) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = hazardInterfaceKey(items[index]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });

  const indexes = new Set();
  groups.forEach((groupIndexes) => {
    const guideCount = new Set(groupIndexes.map((index) => sanitizeText(items[index]?.guidePhrase).toLowerCase()).filter(Boolean)).size;
    const yesCount = groupIndexes.filter((index) => normalizeGuidePhraseApplicability(rows[index]?.guidePhraseApplicable) === "Yes").length;
    const suspicious = guideCount >= 5
      && (yesCount >= 6 || yesCount / Math.max(1, groupIndexes.length) >= 0.85);
    if (suspicious) groupIndexes.forEach((index) => indexes.add(index));
  });
  return Array.from(indexes).sort((left, right) => left - right);
}

function rationaleClaimsAdverseMechanism(value = "") {
  const rationale = sanitizeText(value);
  if (/\b(?:does not|do not|cannot|no meaningful|not meaningful|safely buffered|precluded|unsupported)\b/i.test(rationale)) return false;
  return /\b(?:can|could|may|would|will)\s+(?:lead|cause|result)|\b(?:leading|resulting)\s+(?:in|to)|\bcausing\b/i.test(rationale);
}

function hasExplicitSafetyExposure(row = {}) {
  return /\b(?:collision|injur|fatal|physical harm|loss of control|unintended (?:motion|movement)|instability|environmental harm|safety[- ]critical asset|security control|critical data integrity|bystander|occupant|resident)\b/i.test([
    row.losses,
    row.loss,
    row.hazards,
    row.hazard,
    row.proposedSafetyAssessmentRationale,
  ].map(sanitizeText).join(" "));
}

export function findConsistencyReconciliationIndexes(rows = [], items = []) {
  const indexes = new Set();
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = hazardInterfaceKey(items[index]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
    const applicable = normalizeGuidePhraseApplicability(row.guidePhraseApplicable) === "Yes";
    const rationale = sanitizeText(row.guidePhraseApplicabilityRationale);
    if (!applicable && rationaleClaimsAdverseMechanism(rationale)) indexes.add(index);
    if (applicable && /\b(?:does not|no meaningful|not applicable|unsupported|precluded)\b/i.test(rationale)) indexes.add(index);
    if (applicable && normalizeProposedSafetyAssessment(row.proposedSafetyAssessment, row.safetySignificant) === "Mission/Reliability" && hasExplicitSafetyExposure(row)) indexes.add(index);
    if (!applicable && /applied too long/i.test(sanitizeText(items[index]?.guidePhrase)) && /\b(?:stale|outdated|expired|beyond (?:its )?validity|revoked)\b/i.test(rationale)) indexes.add(index);
  });
  groups.forEach((groupIndexes) => {
    const guideCount = new Set(groupIndexes.map((index) => sanitizeText(items[index]?.guidePhrase).toLowerCase()).filter(Boolean)).size;
    if (guideCount < 5) return;
    const yesCount = groupIndexes.filter((index) => normalizeGuidePhraseApplicability(rows[index]?.guidePhraseApplicable) === "Yes").length;
    if (yesCount === 0 || yesCount >= 6) groupIndexes.forEach((index) => indexes.add(index));
  });
  return Array.from(indexes).sort((left, right) => left - right);
}

function isExternalEndpoint(value = "") {
  return /\b(?:operator|user|stakeholder|environment|external|infrastructure|resident|bystander|occupant|customer|authority)\b/i.test(sanitizeText(value));
}

function preferredRequirementOwner(item = {}) {
  const from = sanitizeText(item.from);
  const to = sanitizeText(item.to);
  const subsystem = sanitizeText(item.traceability?.subsystem);
  if (to && !isExternalEndpoint(to)) return to;
  if (from && !isExternalEndpoint(from)) return from;
  return subsystem || to || from || "Allocated system element";
}

export function normalizeGenericRequirementOwner(requirement = "", item = {}) {
  const value = sanitizeText(requirement);
  const match = value.match(/^The\s+(.+?)\s+shall\b/i);
  if (!match) return value;
  const owner = sanitizeText(match[1]);
  const comparableOwner = owner.replace(/^['"]|['"]$/g, "").replace(/\s+(?:function|subsystem|module|component|element)$/i, "").replace(/^['"]|['"]$/g, "").trim().toLowerCase();
  const exactOwner = [item.from, item.to, item.traceability?.subsystem]
    .map(sanitizeText)
    .find((candidate) => candidate.toLowerCase() === comparableOwner);
  if (exactOwner) return value.replace(match[1], exactOwner);
  const genericOwner = /^(?:application|system|relevant|responsible|appropriate|allocated|receiving|target|source)(?:\s+system)?\s+(?:subsystem|module|component|element|function)$|^(?:application subsystem|system component|system element|allocated system element)$/i;
  if (!genericOwner.test(owner)) return value;
  return value.replace(match[1], preferredRequirementOwner(item));
}

function rowContainsGenericHazardLanguage(config, row = {}) {
  return config.fields.some(([fieldName]) => GENERIC_HAZARD_PHRASE_RE.test(sanitizeText(row[fieldName])));
}

function genericHazardFields(config, row = {}) {
  return config.fields
    .map(([fieldName]) => fieldName)
    .filter((fieldName) => GENERIC_HAZARD_PHRASE_RE.test(sanitizeText(row[fieldName])));
}

async function requestStandardRows(config, items, contextOptions = {}) {
  const fieldNames = [
    "id",
    ...config.fields.map(([fieldName]) => fieldName).filter((fieldName) => !DERIVED_STPA_FIELDS.has(fieldName)),
    ...SAFETY_SIGNIFICANCE_FIELDS.map(([fieldName]) => fieldName),
  ];
  const operationalContextBlock = formatHazardOperationalContext(contextOptions);
  const retryInstruction = sanitizeText(contextOptions.retryReason);
  const prompt = `
You are performing ${config.analysisName} for software safety using a code-based functional decomposition.

${config.promptGuidance}

Project / operational context:
${operationalContextBlock || "No explicit project or operational context was available. Infer cautiously from row evidence only."}

Use the project / operational context to understand system purpose, operating environment, actors, assets, mission, interfaces, and credible harm categories. Context may orient safety relevance, but each hazard still needs support from the supplied architecture row and traceability. Do not hardcode or assume any specific domain when context is absent.

Do not use arrow notation or arrow-like symbols in any field. Use words such as "which causes", "which leads to", "resulting in", or "then" instead.

Return ONLY a JSON array. Each object must include:
${fieldNames.join(", ")}.
${retryInstruction ? `\n${retryInstruction}\n` : ""}

Functional decomposition rows are compact JSON objects. Use the row id exactly as provided. Do not reorder rows or infer that a response for one id applies to another id.

Quality rules:
- Every returned object must use the matching input id.
- Keep the hazard, causal factor, and requirement tied to the exact functionFrom, controlAction, functionTo, file, symbol, and subsystem evidence for that row.
- Each hazard-bearing field should read like a causal chain: failure condition, then local effect, then system-level effect, then plausible consequence.
- Name concrete domain nouns from the row/context in hazard-bearing fields, including the affected artifact, state, interface, data, command, model input/output, file/symbol, or downstream consumer when evidence supports it.
- Do not recycle generic language such as "enters an unsafe state because the action is absent, incorrect, late, stale, or unintended" unless you add the concrete mechanism, context, and consequence from the row.
- Do not stop at vague claims like "incorrect configuration", "faulty processing", "not properly initialized", or "processing errors"; state what becomes wrong, who consumes it, how it propagates, and what consequence follows.
- Replace generic endpoints such as "system behavior", "communication errors", "degraded performance", or "downstream systems" with the named artifact/state/interface and consequence from the row/context.
- Before returning JSON, silently run the specificity self-check and rewrite any field that still contains generic filler without a named row/context artifact and consumer.
- If the row evidence is insufficient for a concrete field, write a short "Needs review:" note for that field instead of inventing a hazard.
- It is acceptable for different rows to have similar themes, but the wording must still be specific to each row's action, target, files, and operational context.
- Treat each row's operationalScenario, operationalMode, operatingConditions, and contextAssumptions as authoritative context for that row. Analyze its guide phrase independently even when another row has the same functional interface.
- Do not add a hidden event or transition using phrases such as "if needed", "when required", or "if a fault occurs" unless that event is explicitly established by the row context. Do not convert steady-state operation into startup, update, shutdown, recovery, or maintenance behavior.
- Use semanticDeviation as the action-type-specific meaning of the guide phrase. For continuous information, distinguish fresh updates from the same stale value remaining active or consumed beyond its validity interval.
- Distinguish hazards whose mechanism, system state, exposure, or consequence changes across operational contexts. Do not collapse contextual variants into generic wording.
- A hazard must name the resulting system state and exposure or consequence; do not stop at "navigation error", "processing error", "degraded performance", "incorrect behavior", "system failure", or "unsafe state".
- proposedSafetyAssessment must be exactly Safety or Mission/Reliability, with a concise proposedSafetyAssessmentRationale grounded in the generated hazard and operational context.
- If the generated chain includes a credible path to injury, collision, loss of control, instability, unintended physical motion, environmental harm, or damage to safety-critical assets, classify it as Safety even if reliability or mission effects also exist.
- safetySignificant must be exactly Yes when proposedSafetyAssessment is Safety, otherwise Needs Review, with a concise safetySignificanceRationale.

Rows:
${JSON.stringify(compactPromptRows(items))}
  `.trim();

  const response = await fetchLLMResponse(prompt, {}, undefined, "", {
    signal: contextOptions.signal,
    maxTokens: 12_000,
  });
  return extractJsonArray(response);
}

async function requestStandardRowsWithRetries(config, chunk, contextOptions = {}) {
  const rowsById = new Map();
  const missingFor = (items) => items.filter((item) => !rowsById.has(String(item.id || "").toUpperCase()));
  const mergeRows = (rows) => {
    generatedRowsById(rows).forEach((row, key) => {
      rowsById.set(key, row);
    });
  };

  try {
    mergeRows(await requestStandardRows(config, chunk, contextOptions));
  } catch (err) {
    rethrowInterruptedRequest(err, contextOptions.signal);
    console.warn(`⚠️ ${config.sheetName} generation failed for ${chunk.length} rows; retrying smaller subchunks.`, err);
  }

  for (let attempt = 0; attempt < STANDARD_MISSING_ROW_RETRIES; attempt += 1) {
    const missing = missingFor(chunk);
    if (!missing.length) break;
    const retryChunks = chunkItemsByCount(missing, attempt === 0 ? STANDARD_RETRY_ROWS_PER_PROMPT : 1);
    for (const retryChunk of retryChunks) {
      contextOptions.onProgress?.({
        message: `Retrying ${config.sheetName} missing rows (${retryChunk.map((item) => item.id).join(", ")})...`,
      });
      try {
        mergeRows(await requestStandardRows(config, retryChunk, {
          ...contextOptions,
          retryReason: `Retry ${attempt + 1}: return exactly these missing row ids: ${retryChunk.map((item) => item.id).join(", ")}`,
        }));
      } catch (err) {
        rethrowInterruptedRequest(err, contextOptions.signal);
        console.warn(`⚠️ ${config.sheetName} retry ${attempt + 1} failed for ${retryChunk.map((item) => item.id).join(", ")}.`, err);
      }
    }
  }

  return chunk.map((item, index) => generatedRowForItem(rowsById, [], index, item));
}

async function requestStandardRowRepairs(config, repairItems, contextOptions = {}) {
  const operationalContextBlock = formatHazardOperationalContext(contextOptions);
  const prompt = `
You are repairing generated ${config.analysisName} rows that still contain generic hazard language.

${config.promptGuidance}

Project / operational context:
${operationalContextBlock || "No explicit project or operational context was available. Infer cautiously from row evidence only."}

Return ONLY a JSON array. Each object must include id plus ONLY the fields listed in fieldsToRepair for that row. Preserve each id exactly.

Repair rules:
- Rewrite only fieldsToRepair. Do not change fields that are not listed.
- Replace generic phrases such as ${GENERIC_HAZARD_PHRASES.map((phrase) => `"${phrase}"`).join(", ")} with a concrete mechanism and consequence from the row/context.
- Each repaired field must name the affected artifact, state, interface, data, command, model input/output, source symbol, file concept, or downstream consumer when evidence supports it.
- If a concrete repair is not supported by the row/context, return a short "Needs review:" note for that field.
- Do not use arrow notation or arrow-like symbols. Use words such as "which causes", "which leads to", "resulting in", or "then".
- Do not hardcode or assume any specific domain when context is absent.

Rows to repair:
${JSON.stringify(repairItems.map(({ item, row, fieldsToRepair }) => ({
  row: compactPromptItem(item, 180),
  generated: row,
  fieldsToRepair,
})))}
  `.trim();

  const response = await fetchLLMResponse(prompt, {}, undefined, "", {
    signal: contextOptions.signal,
    maxTokens: 5_000,
  });
  return extractJsonArray(response);
}

async function repairGenericStandardRows(config, rows, items, contextOptions = {}) {
  const weakRows = rows
    .map((row, index) => ({ row, item: items[index], index, fieldsToRepair: genericHazardFields(config, row) }))
    .filter(({ row }) => rowContainsGenericHazardLanguage(config, row));

  if (!weakRows.length) return rows;

  contextOptions.onProgress?.({
    message: `Repairing generic ${config.sheetName} wording for ${weakRows.length} row${weakRows.length === 1 ? "" : "s"}...`,
  });

  const repairedRows = [...rows];
  const repairChunks = chunkItemsByCount(weakRows, STANDARD_RETRY_ROWS_PER_PROMPT);
  for (let chunkIndex = 0; chunkIndex < repairChunks.length; chunkIndex += 1) {
    const repairChunk = repairChunks[chunkIndex];
    contextOptions.onProgress?.({
      message: `Repairing generic ${config.sheetName} wording (${chunkIndex + 1}/${repairChunks.length})...`,
      completed: chunkIndex,
      total: repairChunks.length,
    });
    try {
      const repairs = await requestStandardRowRepairs(config, repairChunk, contextOptions);
      const repairsById = generatedRowsById(repairs);
      repairChunk.forEach(({ row, item, index, fieldsToRepair }) => {
        const repair = generatedRowForItem(repairsById, repairs, 0, item);
        const merged = { ...row };
        fieldsToRepair.forEach((fieldName) => {
          const value = sanitizeText(repair?.[fieldName]);
          if (value) merged[fieldName] = value;
        });
        repairedRows[index] = normalizeRow(config, merged, item, index);
      });
    } catch (err) {
      rethrowInterruptedRequest(err, contextOptions.signal);
      console.warn(`⚠️ ${config.sheetName} generic wording repair failed for chunk ${chunkIndex + 1}.`, err);
    }
  }

  contextOptions.onProgress?.({
    message: `Generic ${config.sheetName} wording repair complete.`,
    completed: repairChunks.length,
    total: repairChunks.length,
  });
  return repairedRows;
}

async function requestSafetySignificanceTags(config, tagItems, contextOptions = {}) {
  const operationalContextBlock = formatHazardOperationalContext(contextOptions);
  const prompt = `
You are independently auditing generated ${config.analysisName} rows for guide-phrase applicability and safety significance after candidate hazard generation.

Project / operational context:
${operationalContextBlock || "No explicit project or operational context was available. Infer cautiously from row evidence only."}

Return ONLY a JSON array. Each object must include:
id, semanticMeaningful, receiverCanBeAffected, contextSupportsMechanism, adverseStateSupported, guidePhraseApplicable, guidePhraseApplicabilityRationale, applicabilityMechanism, applicabilityEvidenceField, applicabilityEvidenceQuote, strongestReasonForNo, proposedSafetyAssessment, proposedSafetyAssessmentRationale, safetyExposureCategory, safetyExposurePath, safetyEvidenceField, safetyEvidenceQuote, safetySignificant, safetySignificanceRationale.

Applicability and safety rules:
- Re-decide applicability independently; do not defer to generated.guidePhraseApplicable or let the candidate Hazard/Loss create facts that are absent from the functional row and operational context. Decide applicability from row semantics and context first, then use generated text only to classify a supported adverse path.
- semanticMeaningful, receiverCanBeAffected, contextSupportsMechanism, and adverseStateSupported must each be exactly Yes or No. guidePhraseApplicable must be Yes only when all four are Yes; otherwise it must be No.
- guidePhraseApplicable must be exactly Yes or No.
- Mark Yes only if the exact guide-phrase deviation is semantically meaningful for the action type in the exact scenario/mode and a concrete causal path connects it to an adverse system state. A merely conceivable deviation or generic restatement is insufficient.
- Mark No when the deviation is semantically inapplicable, precluded by the stated architecture/conditions, cannot affect the receiver in that mode, or lacks a credible adverse consequence. Explain the specific reason in guidePhraseApplicabilityRationale.
- Treat row.semanticDeviation as the intended meaning of the guide phrase for that action type.
- For Yes, applicabilityMechanism must name the receiver behavior that makes this exact deviation consequential.
- applicabilityEvidenceField must be exactly one of: Function From; Control Action; Function To; Operational Scenario; Operational Mode; Operating Conditions; Context Assumptions.
- applicabilityEvidenceQuote must be a short exact verbatim excerpt copied from that supplied field. Do not paraphrase, combine fields, or invent evidence. The application verifies the excerpt against the source and rejects ungrounded Yes decisions.
- Choose the excerpt that establishes the specific semantic discriminator: a prerequisite/window for early, a deadline/latency for late, sequence/version for wrong order, continuity/duration for stopped too soon, or freshness/expiry/revocation for applied too long. A generic statement that the system is operating or safety-relevant is insufficient.
- Bind evidence to this row. A shared context sentence about another actor, channel, function, or interface is not evidence merely because it contains words such as continuous, active, current, control, update, or monitor. Prefer Function From, Control Action, or Function To when their names establish the relevant interface semantics; otherwise the context excerpt must refer to this interface's artifact, endpoint, dependency, or operating constraint.
- "Providing causes" requires a context-supported hazardous value, authority, state, or operating condition; the abstract possibility of invalid data is insufficient by itself.
- "Too early" requires consumption before a named prerequisite, validity boundary, or acceptance window. Safe buffering or early arrival alone is not hazardous.
- "Wrong order" requires a version, sequence, dependency, or prerequisite whose order affects the receiver. A generic processing pipeline is insufficient.
- "Stopped too soon" requires an ongoing stream, maintained assertion, multi-part transfer, or action duration that the receiver depends on in this context.
- Do not apply "stopped too soon" to atomic requests, submissions, notifications, acknowledgements, triggers, or other instantaneous events. For those actions, analyze omission, commission, timing, or ordering instead.
- "Applied too long" requires a held value/state, freshness limit, revocation, timeout, or completion boundary. Do not turn a persistent valid configuration into a temporary command.
- For continuous information, "applied too long" means the same value, assertion, authority, configuration, state, mode, or sample remains active or is consumed after its freshness, validity, or revocation interval. It does not mean a stream continues to deliver fresh valid updates.
- For continuous information, "stopped too soon" means required updates cease before their availability interval ends. "Too early" means information is consumed before it is valid or before prerequisites hold, not merely that it arrived early and was safely buffered.
- Do not declare a deviation inapplicable merely because an interface is continuous, periodically updated, or processed in real time.
- Treat operationalScenario, operationalMode, operatingConditions, and contextAssumptions as authoritative. Do not introduce a hidden demand, update, fault, transition, or prerequisite using "if needed", "when required", or similar language.
- If a valid configuration, map, authority, mode, or other state is already active in a steady-state scenario, do not assume that a new update is required unless the supplied row/context says so.
- When the action type is External input / disturbance, assess the system's ability to detect and respond; do not assume the system controls the external condition.
- Assess each context independently. Do not assume all guide phrases apply, and do not manufacture balance or satisfy a quota.
- If guidePhraseApplicable is No, proposedSafetyAssessment must be Mission/Reliability and safetySignificant must be Needs Review.
- Keep each rationale to one concrete sentence of no more than 30 words so every supplied row fits in the response.
- proposedSafetyAssessment must be exactly one of: Safety or Mission/Reliability.
- proposedSafetyAssessmentRationale must briefly explain why the row belongs in Safety or Mission/Reliability, using the generated row text and supplied project/code context.
- safetyExposureCategory must be exactly one of: People; Environment; Physical asset; Safety or security control; Critical data integrity; None / unsupported.
- safetyExposurePath must name the concrete exposed entity/control/integrity property and the context-supported path from the adverse state. Use "None / unsupported" when the candidate stops at an internal error, degraded accuracy, mission loss, or generic downstream impact.
- For Safety, safetyEvidenceField must use the same allowed field names as applicabilityEvidenceField, and safetyEvidenceQuote must be an exact verbatim excerpt establishing the exposed entity, safety-critical operation, or harm-relevant operating condition. Without an exact supporting excerpt, classify Mission/Reliability.
- Mark Safety when the row describes a credible path to harm involving people, operators, bystanders, environment, physical assets, security/safety controls, critical data integrity, loss of control, or another safety-relevant hazardous state in the stated project context.
- If the generated Loss, Hazard, UCA, causal scenario, or exposure path explicitly reaches collision, injury, fatality, physical harm, hazardous energy, unintended physical motion, or loss of physical control, classify Safety. Do not label such a row Mission/Reliability merely because mission or availability effects also exist.
- Mark Mission/Reliability when the row is mainly about routine reliability, mission availability/performance, developer experience, formatting, logging, non-critical latency, internal cleanup, recoverable behavior, ambiguity, insufficient support, or assumptions not present in the row/context.
- Applicable does not imply Safety. Require a credible safety-relevant system state and exposure or harm path; otherwise use Mission/Reliability.
- safetySignificant must be exactly one of: Yes or Needs Review. Never output No.
- Set safetySignificant to Yes when proposedSafetyAssessment is Safety.
- Set safetySignificant to Needs Review when proposedSafetyAssessment is Mission/Reliability.
- Do not change the hazard text or requirements. Only classify the row.
- Do not hardcode or assume any specific domain when context is absent.
- Base the rationale on the generated hazard/requirement text, functional decomposition row, traceability/source symbols/files, and project/operational context.

Rows to classify:
${JSON.stringify(tagItems.map(({ item, row }) => ({
  row: compactPromptItem(item, 180),
  generated: row,
})))}
  `.trim();

  const response = await fetchLLMResponse(prompt, {}, undefined, "", {
    signal: contextOptions.signal,
    maxTokens: 7_000,
  });
  return extractJsonArray(response);
}

function mergeAuditTag(config, row, item, index, tag = {}, { requireChallengeEvidence = false } = {}) {
  const structuredDecision = requireChallengeEvidence
    ? validateApplicabilityEvidence(tag, item)
    : deriveStructuredApplicability(tag, row);
  const auditedApplicability = structuredDecision.guidePhraseApplicable;
  const auditedRationale = structuredDecision.guidePhraseApplicabilityRationale;

  const safetyAssessment = deriveStructuredSafetyAssessment(tag, row, {
    applicable: auditedApplicability === "Yes",
    requireEvidence: requireChallengeEvidence,
    item,
  });

  return normalizeRow(config, {
    ...row,
    guidePhraseApplicable: auditedApplicability,
    guidePhraseApplicabilityRationale: auditedRationale,
    proposedSafetyAssessment: safetyAssessment.proposedSafetyAssessment,
    proposedSafetyAssessmentRationale: safetyAssessment.proposedSafetyAssessmentRationale,
    safetySignificant: safetyAssessment.safetySignificant,
    safetySignificanceRationale: safetyAssessment.proposedSafetyAssessmentRationale,
  }, item, index);
}

function canonicalCandidate(row = {}, item = {}) {
  return {
    id: sanitizeText(item.id || row.id),
    functionFrom: truncateForPrompt(item.from, 80),
    controlAction: truncateForPrompt(item.controlAction, 100),
    functionTo: truncateForPrompt(item.to, 80),
    controlActionType: truncateForPrompt(item.controlActionType, 48),
    guidePhrase: truncateForPrompt(item.guidePhrase, 100),
    operationalScenario: truncateForPrompt(item.operationalScenario, 100),
    operationalMode: truncateForPrompt(item.operationalMode, 80),
    lossCandidate: truncateForPrompt(row.losses || row.loss, 220),
    hazardCandidate: truncateForPrompt(row.hazards || row.hazard, 260),
  };
}

function evenlySample(items = [], maximum = 240) {
  if (items.length <= maximum) return items;
  const sampled = [];
  for (let index = 0; index < maximum; index += 1) {
    sampled.push(items[Math.floor(index * items.length / maximum)]);
  }
  return sampled;
}

async function requestCanonicalRiskCatalog(config, applicableItems, contextOptions = {}) {
  const operationalContextBlock = formatHazardOperationalContext(contextOptions);
  const candidates = evenlySample(applicableItems.map(({ row, item }) => canonicalCandidate(row, item)));
  const prompt = `
You are normalizing applicable rows from a ${config.analysisName} into a reviewable STPA Loss and Hazard catalog.

Project / operational context:
${operationalContextBlock || "No explicit project context was supplied. Infer cautiously from the functional evidence."}

Return ONLY one JSON object with arrays losses and hazards.
- Each loss object must contain id and statement. Use sequential ids L-1, L-2, and so on.
- Each hazard object must contain id and statement. Use sequential ids H-1, H-2, and so on.
- A Loss is an unacceptable system-level outcome involving people, environment, mission, assets, security, or critical integrity. It must not mention a guide phrase, interface, causal mechanism, or individual function.
- State each Loss directly as the unacceptable outcome, such as injury, environmental damage, loss of mission, asset damage, or loss of protected information. Do not write "leading to", "potential", a hazard precursor, or a chain of consequences in a Loss.
- A Hazard is a reusable system-level state or condition that, with plausible environmental conditions, can lead to one or more Losses. It must not merely restate an individual UCA or causal factor.
- Phrase each Hazard as a controlled-system state, preferably "The system [is/does] ... while ...". Do not begin with "Failure to", "Lack of", "Absence of", "Delayed", or an interface-specific event, and do not append the resulting Loss to the Hazard statement.
- Produce the smallest catalog that preserves materially different outcomes and hazardous states. Prefer roughly 3-10 Losses and 5-15 Hazards for one operational context; exceed that only when the evidence contains genuinely distinct system-level states.
- Merge wording variants and interface-specific descriptions that represent the same underlying outcome/state.
- Merge hazards that differ only by missing, late, stopped, stale, or out-of-order delivery when those deviations create the same controlled-system state. Those deviations belong in UCAs and causal scenarios, not separate canonical Hazards.
- Do not erase meaningful distinctions between loss of control, unintended actuation, unavailable safety function, incorrect state estimation, hazardous energy, security compromise, environmental harm, or their domain-specific equivalents when supported.
- Do not invent project-specific conditions absent from the evidence.

Applicable raw candidates:
${JSON.stringify(candidates)}
  `.trim();
  const response = await fetchLLMResponse(prompt, {}, undefined, "", {
    signal: contextOptions.signal,
    maxTokens: 8_000,
  });
  return extractJsonObject(response);
}

async function requestCanonicalRiskMappings(config, catalog, mappingItems, contextOptions = {}) {
  const prompt = `
Map each applicable ${config.analysisName} row to exactly one canonical Loss and one canonical Hazard from the supplied catalogs.

Return ONLY a JSON array with one object per row containing id, canonicalLossId, canonicalHazardId. Preserve each row id exactly. Use only catalog ids; do not create or rewrite catalog entries.

Choose by the underlying unacceptable outcome and hazardous system state, not superficial wording, guide phrase, interface name, or causal mechanism. Different UCAs and scenarios should share a canonical mapping when they reach the same system-level state.

Loss catalog:
${JSON.stringify(catalog.losses)}

Hazard catalog:
${JSON.stringify(catalog.hazards)}

Rows:
${JSON.stringify(mappingItems.map(({ row, item }) => canonicalCandidate(row, item)))}
  `.trim();
  const response = await fetchLLMResponse(prompt, {}, undefined, "", {
    signal: contextOptions.signal,
    maxTokens: 5_000,
  });
  return extractJsonArray(response);
}

function normalizedCanonicalCatalog(catalog = {}) {
  const normalizeEntries = (entries, prefix) => (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({
      id: sanitizeText(entry?.id) || `${prefix}-${index + 1}`,
      statement: sanitizeText(entry?.statement || entry?.title || entry?.description),
    }))
    .filter((entry) => entry.statement);
  return {
    losses: normalizeEntries(catalog.losses, "L"),
    hazards: normalizeEntries(catalog.hazards, "H"),
  };
}

export function applyCanonicalRiskVocabulary(rows = [], items = [], catalogInput = {}, mappings = []) {
  const catalog = normalizedCanonicalCatalog(catalogInput);
  const lossesById = new Map(catalog.losses.map((entry) => [entry.id.toUpperCase(), entry.statement]));
  const hazardsById = new Map(catalog.hazards.map((entry) => [entry.id.toUpperCase(), entry.statement]));
  const mappingsById = generatedRowsById(mappings);
  return rows.map((row, index) => {
    const rawLossCandidate = sanitizeText(row.rawLossCandidate || row.losses || row.loss);
    const rawHazardCandidate = sanitizeText(row.rawHazardCandidate || row.hazards || row.hazard);
    if (normalizeGuidePhraseApplicability(row.guidePhraseApplicable) === "No") {
      return {
        ...row,
        rawLossCandidate,
        rawHazardCandidate,
        canonicalLossId: "Not applicable",
        canonicalHazardId: "Not applicable",
      };
    }
    const mapping = mappingsById.get(String(items[index]?.id || "").toUpperCase())
      || mappings[index]
      || {};
    const canonicalLossId = sanitizeText(mapping.canonicalLossId).toUpperCase();
    const canonicalHazardId = sanitizeText(mapping.canonicalHazardId).toUpperCase();
    const canonicalLoss = lossesById.get(canonicalLossId);
    const canonicalHazard = hazardsById.get(canonicalHazardId);
    return {
      ...row,
      rawLossCandidate,
      rawHazardCandidate,
      losses: canonicalLoss || rawLossCandidate,
      hazards: canonicalHazard || rawHazardCandidate,
      canonicalLossId: canonicalLoss ? canonicalLossId : createSafetyModelId("L", rawLossCandidate),
      canonicalHazardId: canonicalHazard ? canonicalHazardId : createSafetyModelId("H", rawHazardCandidate),
    };
  });
}

async function canonicalizeStpaRiskVocabulary(config, rows, items, contextOptions = {}) {
  if (config.rowIdSuffix !== "STPA") return rows;
  const applicableItems = rows
    .map((row, index) => ({ row, item: items[index], index }))
    .filter(({ row }) => normalizeGuidePhraseApplicability(row.guidePhraseApplicable) === "Yes");
  if (!applicableItems.length) return applyCanonicalRiskVocabulary(rows, items);

  contextOptions.onProgress?.({ message: "Building canonical STPA Loss and Hazard catalogs..." });
  try {
    const catalog = normalizedCanonicalCatalog(await requestCanonicalRiskCatalog(config, applicableItems, contextOptions));
    if (!catalog.losses.length || !catalog.hazards.length) throw new Error("Canonical catalog response was empty.");
    const mappings = [];
    const chunks = chunkItemsByCount(applicableItems, CANONICAL_MAPPING_ROWS_PER_PROMPT);
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      contextOptions.onProgress?.({
        message: `Mapping raw evidence to canonical Losses and Hazards (${chunkIndex + 1}/${chunks.length})...`,
        completed: chunkIndex,
        total: chunks.length,
      });
      const chunkMappings = await requestCanonicalRiskMappings(config, catalog, chunk, contextOptions);
      mappings.push(...chunkMappings);
    }
    return applyCanonicalRiskVocabulary(rows, items, catalog, mappings);
  } catch (err) {
    rethrowInterruptedRequest(err, contextOptions.signal);
    console.warn(`⚠️ ${config.sheetName} canonical vocabulary generation failed; retaining raw Loss and Hazard candidates.`, err);
    return applyCanonicalRiskVocabulary(rows, items);
  }
}

async function tagSafetySignificanceForStandardRows(config, rows, items, contextOptions = {}) {
  if (!rows.length) return rows;

  contextOptions.onProgress?.({
    message: `Reviewing ${config.sheetName} rows for safety significance...`,
  });

  const taggedRows = [...rows];
  const tagItems = rows.map((row, index) => ({ row, item: items[index], index }));
  const tagChunks = chunkItemsByCount(tagItems, APPLICABILITY_REVIEW_ROWS_PER_PROMPT);
  for (let chunkIndex = 0; chunkIndex < tagChunks.length; chunkIndex += 1) {
    const tagChunk = tagChunks[chunkIndex];
    contextOptions.onProgress?.({
      message: `Auditing guide-phrase applicability and safety significance (${chunkIndex + 1}/${tagChunks.length})...`,
      completed: chunkIndex,
      total: tagChunks.length,
    });
    try {
      const tags = await requestSafetySignificanceTags(config, tagChunk, contextOptions);
      const tagsById = generatedRowsById(tags);
      tagChunk.forEach(({ row, item, index }, localIndex) => {
        const tag = generatedRowForItem(tagsById, tags, localIndex, item);
        taggedRows[index] = mergeAuditTag(config, row, item, index, tag, { requireChallengeEvidence: true });
      });
    } catch (err) {
      rethrowInterruptedRequest(err, contextOptions.signal);
      console.warn(`⚠️ ${config.sheetName} safety significance review failed for chunk ${chunkIndex + 1}.`, err);
      tagChunk.forEach(({ row, item, index }) => {
        taggedRows[index] = normalizeRow(config, row, item, index);
      });
    }
  }

  contextOptions.onProgress?.({
    message: `${config.sheetName} applicability and safety significance review complete.`,
    completed: tagChunks.length,
    total: tagChunks.length,
  });
  return taggedRows;
}

async function saveSheets({ sheets, setFolders, currentFolder, additions }) {
  const updatedSheets = {
    ...sheets,
    ...additions,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  return updatedSheets;
}

function buildStandardSheets(config, rows, items) {
  const methodSheet = [
    [
      `${config.sheetName} ID`,
      ...config.fields.map(([, label]) => label),
      ...SAFETY_SIGNIFICANCE_FIELDS.map(([, label]) => label),
      ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS,
    ],
    ...rows.map((row, index) => [
      row.id,
      ...config.fields.map(([fieldName]) => row[fieldName] || ""),
      ...SAFETY_SIGNIFICANCE_FIELDS.map(([fieldName]) => row[fieldName] || ""),
      ...traceabilityToSheetCells(items[index]?.traceability || {}),
    ]),
  ];

  const summary = [
    [
      ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS,
      ...config.fields.map(([, label]) => label),
      ...SAFETY_SIGNIFICANCE_FIELDS.map(([, label]) => label),
    ],
    ...rows.map((row, index) => {
      const traceFields = traceabilityObjectToSummaryFields(items[index]?.traceability || {});
      return [
        ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS.map((column) => traceFields[column] || ""),
        ...config.fields.map(([fieldName]) => row[fieldName] || ""),
        ...SAFETY_SIGNIFICANCE_FIELDS.map(([fieldName]) => row[fieldName] || ""),
      ];
    }),
  ];

  return {
    [config.sheetName]: methodSheet,
    Summary: summary,
  };
}

export async function generateStandardCodeHazardAnalysisSheets({
  sheets,
  setFolders,
  currentFolder,
  method = "STPA",
  operationalContext = "",
  analysisContext = null,
  contextSources = null,
  onProgress = () => {},
  omitConsolidatedRequirement = false,
  generationMode = "standard",
  signal = null,
}) {
  const items = flattenDecomposition(sheets);
  if (!items.length) return sheets;

  const config = omitConsolidatedRequirement
    ? omitConsolidatedRequirementFromConfig(getStandardConfig(method))
    : getStandardConfig(method);
  const maximumRowsPerPrompt = generationMode === "detailed" ? STANDARD_RETRY_ROWS_PER_PROMPT : STANDARD_MAX_ROWS_PER_PROMPT;
  const promptChunks = items.length <= maximumRowsPerPrompt && compactPromptRowsLength(items) <= STANDARD_SINGLE_PROMPT_MAX_CHARS
    ? [items]
    : (generationMode === "detailed" ? chunkItemsByCount(items, maximumRowsPerPrompt) : chunkItemsForPrompt(items));

  if (promptChunks.length > 1) {
    console.warn(`⚠️ ${config.sheetName} standard input is large; using ${promptChunks.length} bulk prompt chunks instead of one prompt.`);
  }

  const generatedRows = [];
  for (let start = 0, chunkIndex = 0; chunkIndex < promptChunks.length; chunkIndex += 1) {
    const chunk = promptChunks[chunkIndex];
    onProgress({
      step: chunkIndex + 1,
      total: promptChunks.length + 1,
      message: `Generating ${config.sheetName} rows (${chunkIndex + 1}/${promptChunks.length})...`,
    });
    try {
      const chunkRows = await requestStandardRowsWithRetries(config, chunk, {
        operationalContext,
        analysisContext,
        contextSources,
        signal,
        onProgress,
      });
      chunk.forEach((item, index) => {
        generatedRows[start + index] = chunkRows[index] || {};
      });
    } catch (err) {
      rethrowInterruptedRequest(err, signal);
      console.warn(`⚠️ ${config.sheetName} standard generation failed for chunk ${chunkIndex + 1}; using local fallback rows for that chunk.`, err);
      chunk.forEach((item, index) => {
        generatedRows[start + index] = fallbackRow(config, item, start + index);
      });
    }
    start += chunk.length;
  }

  let normalizedRows = materializeGeneratedHazardRows(config, generatedRows, items);
  normalizedRows = await repairGenericStandardRows(config, normalizedRows, items, {
    operationalContext,
    analysisContext,
    contextSources,
    signal,
    onProgress: (patch) => onProgress({
      step: promptChunks.length + 1,
      total: promptChunks.length + 1,
      ...patch,
    }),
  });
  normalizedRows = await tagSafetySignificanceForStandardRows(config, normalizedRows, items, {
    operationalContext,
    analysisContext,
    contextSources,
    signal,
    onProgress: (patch) => onProgress({
      step: promptChunks.length + 1,
      total: promptChunks.length + 2,
      ...patch,
    }),
  });
  normalizedRows = await canonicalizeStpaRiskVocabulary(config, normalizedRows, items, {
    operationalContext,
    analysisContext,
    contextSources,
    signal,
    onProgress: (patch) => onProgress({
      step: promptChunks.length + 2,
      total: promptChunks.length + 3,
      ...patch,
    }),
  });
  return saveSheets({
    sheets,
    setFolders,
    currentFolder,
    additions: buildStandardSheets(config, normalizedRows, items),
  });
}
