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
  normalizeControlActionType,
  normalizeNonApplicableHazardRecord,
  parameterizeUnsupportedRequirement,
  semanticGuidePhrase,
} from "../features/project-hazard-analysis/hazardSafetyModel";
import { formatGovernedHazardPromptContext } from "../features/project-hazard-analysis/hazardPromptContext";
import {
  authorityPermitsSafety,
  classifyReceiverAuthority,
} from "../features/project-hazard-analysis/interfaceSafetyAuthority";
import {
  PROTECTION_STATUS,
  SAFETY_CLASSIFICATION,
  auditSafetyClassificationRecord,
  containsAffirmativeHarmPath,
  normalizeClassificationConfidence,
  normalizeProtectionStatus,
  normalizeSafetyClassification,
  normalizeSafetyClassificationRule,
  normalizeSafetyPathType,
  safetyClassificationRollup,
  safetySignificanceValue,
  validateSafetyClassificationRecord,
} from "../features/project-hazard-analysis/safetySignificancePolicy";
import { getStoredActiveAIProvider } from "../lib/aiProviderConfig";

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
  const fromDetailsIdx = findColumn(["Function (From) Details", "From Function Details", "Source Function Details"], -1);
  const actionIdx = findColumn(["Control Action", "Unsafe Control Action", "UCA", "Action"], 1);
  const actionDetailsIdx = findColumn(["Control Action Details", "Action Details", "Interface Details"], -1);
  const toIdx = findColumn(["Function (To)", "To Function", "Target Function"], 2);
  const toDetailsIdx = findColumn(["Function (To) Details", "To Function Details", "Target Function Details"], -1);
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
        fromDetails: fromDetailsIdx >= 0 ? sanitizeText(getCellText(row[fromDetailsIdx])) : "",
        controlAction,
        controlActionDetails: actionDetailsIdx >= 0 ? sanitizeText(getCellText(row[actionDetailsIdx])) : "",
        to,
        toDetails: toDetailsIdx >= 0 ? sanitizeText(getCellText(row[toDetailsIdx])) : "",
        controlActionType: normalizeControlActionType("", { controlAction, controlActionDetails: actionDetailsIdx >= 0 ? getCellText(row[actionDetailsIdx]) : "", from, fromDetails: fromDetailsIdx >= 0 ? getCellText(row[fromDetailsIdx]) : "", to, toDetails: toDetailsIdx >= 0 ? getCellText(row[toDetailsIdx]) : "" }),
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

export function isHazardAnalysisCancellation(error, signal) {
  return Boolean(signal?.aborted || error?.name === "AbortError");
}

function rethrowInterruptedRequest(error, signal) {
  // Caller cancellation stops the run. Provider timeouts are recoverable: the
  // generator retries the affected batch with fewer rows before using a local
  // reviewable fallback for only the rows the provider could not return.
  if (isHazardAnalysisCancellation(error, signal)) {
    throw error;
  }
}

function compactPromptItem(item = {}, maxChars = 120) {
  const trace = item.traceability || {};
  return {
    id: truncateForPrompt(item.id, 32),
    functionFrom: truncateForPrompt(item.from, maxChars),
    functionFromDetails: truncateForPrompt(item.fromDetails, maxChars * 2),
    controlAction: truncateForPrompt(item.controlAction, maxChars),
    controlActionDetails: truncateForPrompt(item.controlActionDetails, maxChars * 2),
    controlActionType: truncateForPrompt(item.controlActionType, 48),
    semanticDeviation: truncateForPrompt(semanticGuidePhrase(item.controlActionType, item.guidePhrase), maxChars),
    functionTo: truncateForPrompt(item.to, maxChars),
    functionToDetails: truncateForPrompt(item.toDetails, maxChars * 2),
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
const APPLICABILITY_PATTERN_REPAIR_ROWS_PER_PROMPT = 8;
const CANONICAL_MAPPING_ROWS_PER_PROMPT = 40;
const HAZARD_LLM_CONCURRENCY = 2;
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
  "ML model / uncertainty",
]);
export const SAFETY_SIGNIFICANCE_FIELDS = [
  ["proposedSafetyAssessment", "Proposed Safety Assessment"],
  ["proposedSafetyAssessmentRationale", "Proposed Safety Assessment Rationale"],
  ["safetyClassification", "Safety Classification"],
  ["safetyClassificationRule", "Safety Classification Rule"],
  ["causalPathType", "Causal Path Type"],
  ["causalEffect", "Causal Effect"],
  ["resultingSystemState", "Resulting System State"],
  ["intermediateSafetyFunction", "Intermediate Safety Function"],
  ["intermediateSafetyEffect", "Intermediate Safety Effect"],
  ["protectionAssessment", "Protection Assessment"],
  ["protectionStatus", "Protection Status"],
  ["physicalHarmChainTermination", "Physical-Harm Chain Termination"],
  ["classificationEvidence", "Classification Evidence"],
  ["classificationConfidence", "Classification Confidence"],
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

const formatHazardOperationalContext = formatGovernedHazardPromptContext;

function chunkItemsForPrompt(
  items = [],
  maxChars = STANDARD_CHUNK_PROMPT_MAX_CHARS,
  maxRows = STANDARD_MAX_ROWS_PER_PROMPT,
) {
  const chunks = [];
  let current = [];

  items.forEach((item) => {
    const candidate = [...current, item];
    if (current.length && (candidate.length > maxRows || compactPromptRowsLength(candidate) > maxChars)) {
      chunks.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  });

  if (current.length) chunks.push(current);
  return chunks;
}

export function getStandardHazardRowsPerPrompt(provider) {
  const normalizedProvider = String(provider || "openai").trim().toLowerCase();
  if (normalizedProvider === "anthropic" || normalizedProvider === "claude") {
    return STANDARD_RETRY_ROWS_PER_PROMPT;
  }
  return STANDARD_MAX_ROWS_PER_PROMPT;
}

function chunkItemsByCount(items = [], size = STANDARD_RETRY_ROWS_PER_PROMPT) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function mapWithConcurrency(items = [], concurrency = 1, worker) {
  const source = Array.isArray(items) ? items : [];
  const results = new Array(source.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(source.length || 1, Math.floor(concurrency) || 1));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < source.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(source[index], index);
    }
  }));
  return results;
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

export function getStandardConfig(method) {
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
- Consider controller/process-model error, algorithm/model inadequacy, sensor/feedback, actuator/physical process, communication/interface, timing/sequencing, mode/state confusion, initialization/lifecycle, configuration/calibration, power/resource exhaustion, environmental disturbance, human/procedure, common-cause/dependency, and ML uncertainty when relevant. Select only the best evidence-grounded mechanism; correctly delivered information processed by a wrong controller/model is not a communication failure.
- causalFactorCategory must be one of: Controller logic / process model; Sensor / feedback; Actuator / physical process; Communication / interface; Timing / sequencing; Power / energy; Initialization / lifecycle; Mode / state management; Configuration / calibration; Human / procedure; Common-cause dependency; ML model / uncertainty.
- For a non-applicable row only, causalFactorCategory and requirementParameterSource must be exactly Not applicable.
- mitigationStrategy must describe a design measure, detection mechanism, independence provision, fallback, constraint, or verification activity that reduces the cause or consequence.
- mitigationStrategy must name the responsible function or subsystem and the concrete mechanism it adds. Avoid generic imperatives such as "implement redundancy" or "add validation" without naming what is compared, detected, rejected, inhibited, isolated, or placed into a safe/degraded state.
- Safety requirement or constraint must be tailored and verifiable. systemRequirement should state the implementable obligation and safetyRequirementsConstraints should state the safety invariant it enforces.
- Write systemRequirement only as the normative obligation: "The [allocated system element] shall [observable behavior] when or while [condition]." Put the verification approach in verificationMethod and the observable pass/fail condition in acceptanceCriteria; never append "verified by" to the shall statement.
- verificationMethod must name an appropriate inspection, analysis, demonstration, or test approach. acceptanceCriteria must state the observable evidence that passes. Do not invent thresholds in either field; use named TBD parameters and identify their source/owner in requirementParameterSource.
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
      ["verificationMethod", "Verification Method"],
      ["acceptanceCriteria", "Acceptance Criteria"],
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
    verificationMethod: "Needs review: verification method was not generated.",
    acceptanceCriteria: "Needs review: acceptance criteria were not generated.",
    controlActionType: normalizeControlActionType(item.controlActionType, item),
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
  const guidePhraseApplicable = normalizeGuidePhraseApplicability(
    row.guidePhraseApplicable || row["Guide Phrase Applicable"] || item?.guidePhraseApplicable,
  );
  const requestedSafetyClassification = normalizeSafetyClassification(
    row.safetyClassification || row["Safety Classification"],
    {
      applicable: guidePhraseApplicable !== "No",
      proposedAssessment: row.proposedSafetyAssessment || row["Proposed Safety Assessment"],
      contributionType: row.safetyContributionType,
      causalPathType: row.causalPathType || row["Causal Path Type"],
    },
  );
  const protectionAssessment = sanitizeText(row.protectionAssessment || row["Protection Assessment"]);
  const protectionStatus = normalizeProtectionStatus(
    row.protectionStatus || row["Protection Status"],
    protectionAssessment,
  );
  const safetyClassification = requestedSafetyClassification;
  const safetyClassificationRule = normalizeSafetyClassificationRule(
    row.safetyClassificationRule || row["Safety Classification Rule"] || row.classificationRule,
    safetyClassification,
    {
      guidePhrase: item?.guidePhrase || row.guidePhrase,
      evidence: `${row.classificationEvidence || row["Classification Evidence"] || ""} ${protectionAssessment}`,
    },
  );
  const normalized = {
    id: sanitizeText(row.id) || base.id,
    proposedSafetyAssessment: safetyClassificationRollup(safetyClassification),
    proposedSafetyAssessmentRationale: sanitizeText(row.proposedSafetyAssessmentRationale || row["Proposed Safety Assessment Rationale"]),
    safetyClassification,
    safetyClassificationRule,
    causalPathType: normalizeSafetyPathType(row.causalPathType || row["Causal Path Type"], safetyClassification),
    causalEffect: sanitizeText(row.causalEffect || row["Causal Effect"]),
    resultingSystemState: sanitizeText(row.resultingSystemState || row["Resulting System State"]),
    intermediateSafetyFunction: sanitizeText(row.intermediateSafetyFunction || row["Intermediate Safety Function"]),
    intermediateSafetyEffect: sanitizeText(row.intermediateSafetyEffect || row["Intermediate Safety Effect"]),
    protectionAssessment,
    protectionStatus,
    physicalHarmChainTermination: sanitizeText(row.physicalHarmChainTermination || row["Physical-Harm Chain Termination"]),
    classificationEvidence: sanitizeText(row.classificationEvidence || row["Classification Evidence"]),
    classificationConfidence: normalizeClassificationConfidence(row.classificationConfidence || row["Classification Confidence"]),
    safetySignificant: safetySignificanceValue(safetyClassification),
    safetySignificanceRationale: sanitizeText(row.safetySignificanceRationale || row["Safety Significance Rationale"]),
  };
  config.fields.forEach(([fieldName]) => {
    if (fieldName === "rawAnalysisRowId") {
      normalized[fieldName] = base.rawAnalysisRowId;
    } else if (fieldName === "guidePhrase") {
      normalized[fieldName] = sanitizeText(item?.guidePhrase) || sanitizeText(row[fieldName] || row["Guide Phrase"]) || base[fieldName] || "";
    } else if (fieldName === "guidePhraseApplicable") {
      normalized[fieldName] = guidePhraseApplicable;
    } else if (fieldName === "guidePhraseApplicabilityRationale") {
      normalized[fieldName] = sanitizeText(row[fieldName] || row["Guide Phrase Applicability Rationale"] || item?.guidePhraseApplicabilityRationale) || base[fieldName] || "";
    } else if (fieldName === "unsafeControlActions") {
      normalized[fieldName] = buildGuidePhraseUnsafeControlAction(
        item,
        row[fieldName] || row["Unsafe Control Actions"] || base[fieldName],
        normalized.guidePhraseApplicable || row.guidePhraseApplicable || row["Guide Phrase Applicable"],
      );
    } else if (fieldName === "controlActionType") {
      normalized[fieldName] = normalizeControlActionType(
        row[fieldName] || row["Control Action Type"] || item?.controlActionType,
        item,
      );
    } else if (fieldName === "causalFactorCategory") {
      const category = sanitizeText(row[fieldName]);
      const proposedCategory = CAUSAL_FACTOR_CATEGORIES.has(category)
        ? category
        : inferCausalFactorCategory(row.causalFactors || row.causalScenario);
      normalized[fieldName] = reconcileCausalFactorCategory(
        proposedCategory,
        [row.causalFactors, row.causalFactor, row.causalScenario].map(sanitizeText).filter(Boolean).join(" "),
      );
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
  if (Object.prototype.hasOwnProperty.call(normalized, "systemRequirement")) {
    const legacyVerification = normalized.systemRequirement.match(/[,;]\s*verified by\s+(.+?)(?:\.|$)/i);
    if (legacyVerification) {
      normalized.systemRequirement = normalized.systemRequirement
        .replace(/[,;]\s*verified by\s+(.+?)(?:\.|$)/i, ".")
        .replace(/\.\.+$/, ".");
      if (!sanitizeText(row.verificationMethod || row["Verification Method"])) {
        normalized.verificationMethod = legacyVerification[1];
      }
    }
  }
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
  if (/^needs review\b|^uncertain\b|^indeterminate\b/.test(text)) return "Needs Review";
  return "Yes";
}

// "Needs Review" used to carry two different meanings — "not significant" and
// "could not decide" — which made the two indistinguishable downstream. "No" is
// now reserved for a determination the architecture supports: the receiving
// function holds no real-time authority, so this interface has no path to an
// exposed entity.
function normalizeSafetySignificance(value) {
  const text = sanitizeText(value).toLowerCase();
  if (/^yes\b|^safety\b|^safety\s*significant\b|^significant\b/i.test(text)) return "Yes";
  if (/^no\b|^not\s*safety\b|^non-?safety\b/i.test(text)) return "No";
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
  "function from details": "fromDetails",
  functionfromdetails: "fromDetails",
  "control action": "controlAction",
  controlaction: "controlAction",
  "control action details": "controlActionDetails",
  controlactiondetails: "controlActionDetails",
  "function to": "to",
  functionto: "to",
  "function to details": "toDetails",
  functiontodetails: "toDetails",
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

const NOT_APPLICABLE_REASON_CODES = new Set([
  "Semantic mismatch",
  "Receiver unaffected",
  "Architecture precludes deviation",
  "No adverse state in context",
]);

function validateNotApplicableProof(tag = {}, item = {}, structured = {}) {
  const reasonCode = sanitizeText(tag.notApplicableReasonCode);
  const strongestReason = sanitizeText(tag.strongestReasonForNo || tag.reasonNotApplicable);
  const evidence = groundedEvidence(
    tag.notApplicableEvidenceField,
    tag.notApplicableEvidenceQuote,
    item,
  );
  const unsupportedAbsenceClaim = /\b(?:no|insufficient|supplied|proposed) evidence\b|\bdoes not establish\b|\bnot (?:an )?exact excerpt\b|\boutside (?:the )?scope\b/i.test(strongestReason);
  const providingDeviation = /providing the control action/.test(normalizedEvidenceText(item.guidePhrase));

  if (
    !NOT_APPLICABLE_REASON_CODES.has(reasonCode)
    || !strongestReason
    || !evidence.grounded
    || unsupportedAbsenceClaim
    || (providingDeviation && reasonCode === "Semantic mismatch")
  ) {
    return {
      guidePhraseApplicable: "Needs Review",
      guidePhraseApplicabilityRationale: "Needs review: the proposed non-applicable decision did not include a valid, grounded proof that the deviation is impossible, contained, or unable to create an adverse receiver state.",
      hasCompleteDecision: structured.hasCompleteDecision,
      evidenceGrounded: evidence.grounded,
      negativeProofValid: false,
    };
  }

  return {
    guidePhraseApplicable: "No",
    guidePhraseApplicabilityRationale: `Not applicable (${reasonCode}): ${strongestReason.replace(/^not applicable because\s*/i, "")}`,
    hasCompleteDecision: structured.hasCompleteDecision,
    evidenceGrounded: true,
    negativeProofValid: true,
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
  "receive", "report", "request", "service", "system", "vehicle", "activation", "command", "constraint",
  "current", "estimate", "execution", "initialization", "measurement", "motion", "planning", "sequence",
  "state", "status", "timing", "valid", "value",
]);

function evidenceRelevanceTokens(value = "") {
  return normalizedEvidenceText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !EVIDENCE_RELEVANCE_STOP_WORDS.has(token));
}

function evidenceReferencesInterface(evidence = {}, item = {}) {
  if (["from", "fromDetails", "controlAction", "controlActionDetails", "to", "toDetails"].includes(evidence.itemField)) return true;
  const normalizedQuote = normalizedEvidenceText(evidence.evidenceQuote);
  const normalizedInterface = normalizedEvidenceText(
    `${item.from} ${item.fromDetails} ${item.controlAction} ${item.controlActionDetails} ${item.to} ${item.toDetails}`,
  );
  const interfaceLabels = [item.from, item.controlAction, item.to]
    .map(normalizedEvidenceText)
    .filter((label) => label.length >= 8);
  if (interfaceLabels.some((label) => normalizedQuote.includes(label))) return true;
  const domainAnchorFamilies = [
    /\b(?:state|estimate|pose|velocity|position)\w*\b/i,
    /\b(?:health|fault|readiness|diagnostic)\w*\b/i,
    /\b(?:power|energy|battery|voltage|current)\w*\b/i,
    /\b(?:route|trajectory|path|waypoint)\w*\b/i,
    /\b(?:mission|goal|authority|directive)\w*\b/i,
    /\b(?:contact|footstep|gait|foothold|joint)\w*\b/i,
    /\b(?:configur|parameter|calibrat|threshold)\w*\b/i,
    /\b(?:sensor|terrain|obstacle|observation)\w*\b/i,
  ];
  if (domainAnchorFamilies.some((pattern) => pattern.test(normalizedQuote) && pattern.test(normalizedInterface))) return true;
  const evidenceTokens = new Set(evidenceRelevanceTokens(normalizedQuote));
  const interfaceTokens = new Set(evidenceRelevanceTokens(
    normalizedInterface,
  ));
  let overlapCount = 0;
  evidenceTokens.forEach((token) => {
    if (interfaceTokens.has(token)) overlapCount += 1;
  });
  return overlapCount >= 2;
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
  const value = normalizedEvidenceText(`${item.controlAction} ${item.controlActionDetails} ${item.from} ${item.fromDetails} ${item.to} ${item.toDetails}`);
  return /mode transition|configuration|authority|command|request|state estimate|information|data|feedback|status/i.test(actionType)
    && /\b(?:align\w*|associat\w*|command\w*|configur\w*|constraint\w*|convert\w*|execut\w*|fus\w*|measurement\w*|mode\w*|plan\w*|predict\w*|reference\w*|route\w*|select\w*|state\w*|target\w*|trajector\w*|transform\w*|update\w*|version\w*)\b/i.test(value);
}

function actionSupportsDuration(item = {}, actionType = "") {
  const action = normalizedEvidenceText(item.controlAction);
  const interfaceText = normalizedEvidenceText(`${item.controlAction} ${item.controlActionDetails} ${item.from} ${item.fromDetails} ${item.to} ${item.toDetails}`);
  const discreteRequest = /command|request|event/i.test(actionType)
    && /\b(?:request\w*|submit\w*|notify\w*|acknowledg\w*|trigger\w*|alert\w*)\b/i.test(action)
    && !/\b(?:actuat\w*|brak\w*|steer\w*|throttle\w*|hold\w*|maintain\w*|motion\w*)\b/i.test(action);
  if (discreteRequest) return false;
  return /force|resource flow|mode transition/i.test(actionType)
    || /\b(?:actuat\w*|availability|continuous|feedback|health|maintain\w*|measurement\w*|monitor\w*|motion|observation\w*|periodic|publish\w*|regulat\w*|state|status|stream\w*|track\w*|updates?)\b/i.test(interfaceText);
}

function actionSupportsRetention(item = {}, actionType = "") {
  if (/event|external input|disturbance/i.test(actionType)) return false;
  const value = normalizedEvidenceText(`${item.controlAction} ${item.controlActionDetails} ${item.from} ${item.fromDetails} ${item.to} ${item.toDetails}`);
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
    ["Control Action Details", item.controlActionDetails],
    ["Function To Details", item.toDetails],
    ["Function From Details", item.fromDetails],
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
  if (structured.guidePhraseApplicable === "No") {
    return validateNotApplicableProof(tag, item, structured);
  }

  let evidence = groundedEvidence(
    tag.applicabilityEvidenceField || tag.evidenceField,
    tag.applicabilityEvidenceQuote || tag.evidenceQuote,
    item,
  );
  if (!evidence.grounded) {
    return {
      guidePhraseApplicable: "Needs Review",
      guidePhraseApplicabilityRationale: "Needs review: the proposed applicable decision cited evidence that was not an exact excerpt from the supplied interface or operational context.",
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
    const interfaceEvidence = ["from", "fromDetails", "controlAction", "controlActionDetails", "to", "toDetails"].includes(candidateEvidence.itemField);
    let supported = true;
    let reason = "the cited evidence does not establish the guide-phrase-specific mechanism for this interface";

    if (/not providing/.test(guidePhrase)) {
      supported = true;
      reason = "the structured review did not establish an adverse effect from the action becoming absent or unavailable";
    } else if (/providing the control action/.test(guidePhrase)) {
      supported = mechanismSpecific && evidenceRelevant && (evidenceSemantic || interfaceEvidence);
      reason = "the supplied evidence does not establish a hazardous value, command, authority, or external condition for this interface";
    } else if (/too early/.test(guidePhrase)) {
      const explicitEarlyBoundary = evidenceSemantic;
      const receiverNormallyAbsorbsEarlyArrival = /\b(?:align|buffer|queue|store|synchron|validate|filter)\b/.test(normalizedEvidenceText(item.to));
      supported = mechanismSpecific && evidenceRelevant && explicitEarlyBoundary
        && (!receiverNormallyAbsorbsEarlyArrival || /\b(?:before|prerequis|not ready|window|startup|activation)\b/.test(normalizedEvidenceText(candidateEvidence.evidenceQuote)));
      reason = receiverNormallyAbsorbsEarlyArrival
        ? "the receiver can align, buffer, store, validate, or filter early input and no unsafe precondition or acceptance window is established"
        : "the supplied evidence does not establish an unsafe prerequisite or acceptance window for early provision";
    } else if (/too late/.test(guidePhrase)) {
      supported = mechanismSpecific && evidenceRelevant && evidenceSemantic;
      reason = "the supplied evidence does not establish a deadline, freshness boundary, decision point, or time-sensitive receiver dependency";
    } else if (/wrong order/.test(guidePhrase)) {
      supported = mechanismSpecific && actionSupportsOrdering(item, actionType) && evidenceRelevant
        && evidenceSemantic;
      reason = actionSupportsOrdering(item, actionType)
        ? "the supplied evidence does not bind a sequence, version, dependency, or prerequisite to this interface"
        : "this action and receiver do not establish an order-dependent interaction";
    } else if (/stopped too soon/.test(guidePhrase)) {
      supported = mechanismSpecific && actionSupportsDuration(item, actionType) && evidenceRelevant
        && evidenceSemantic;
      reason = actionSupportsDuration(item, actionType)
        ? "the supplied evidence does not bind an ongoing stream, maintained assertion, transfer, or duration to this interface"
        : "this discrete action has no maintained duration or multi-part transfer that can stop too soon";
    } else if (/applied too long/.test(guidePhrase)) {
      supported = mechanismSpecific && actionSupportsRetention(item, actionType) && evidenceRelevant
        && evidenceSemantic;
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
  let architecturePrecludesDeviation = false;
  if (/configuration|authority/i.test(actionType)) {
    const steadyValidConfiguration = /\b(?:active|approved|valid|current)\b/.test(operationalContextText);
    const explicitConfigurationChange = /\b(?:expire|revok|timeout|revision|new version|required update|transition|supersed|change request|activation request)\b/.test(operationalContextText);
    if (steadyValidConfiguration && !explicitConfigurationChange && /providing the control action|too late|wrong order|stopped too soon|applied too long/i.test(guidePhrase)) {
      semanticSupport = false;
      architecturePrecludesDeviation = true;
      unsupportedReason = "the supplied context describes a valid active configuration and does not establish a change, replacement, revocation, or transition for this deviation";
    }
  }
  if (!semanticSupport) {
    const receiverAbsorbsEarlyArrival = /\b(?:align|buffer|queue|store|synchron|validate|filter)\b/.test(normalizedEvidenceText(item.to));
    const potentiallyContractual = (
      (/too early/.test(guidePhrase)
        && !receiverAbsorbsEarlyArrival
        && /command|request|configuration|authority|mode transition|state estimate|information|data|feedback|status|force|resource flow/i.test(actionType))
      || (/too late/.test(guidePhrase)
        && /command|request|configuration|authority|mode transition|state estimate|information|data|feedback|status|force|resource flow/i.test(actionType))
      || (/wrong order/.test(guidePhrase) && actionSupportsOrdering(item, actionType))
      || (/stopped too soon/.test(guidePhrase) && actionSupportsDuration(item, actionType))
      || (/applied too long/.test(guidePhrase) && actionSupportsRetention(item, actionType))
    );
    return {
      guidePhraseApplicable: potentiallyContractual && !architecturePrecludesDeviation ? "Needs Review" : "No",
      guidePhraseApplicabilityRationale: potentiallyContractual && !architecturePrecludesDeviation
        ? `Needs review: ${unsupportedReason}; do not invent the missing interface contract.`
        : `Not applicable because ${unsupportedReason}.`,
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
      safetyClassification: SAFETY_CLASSIFICATION.NOT_APPLICABLE,
      safetyClassificationRule: normalizeSafetyClassificationRule(
        tag.safetyClassificationRule || tag.classificationRule,
        SAFETY_CLASSIFICATION.NOT_APPLICABLE,
        { guidePhrase: item.guidePhrase },
      ),
      causalPathType: "None",
      causalEffect: "Not applicable",
      resultingSystemState: "Not applicable",
      intermediateSafetyFunction: "Not applicable",
      intermediateSafetyEffect: "Not applicable",
      protectionAssessment: "Not applicable",
      protectionStatus: PROTECTION_STATUS.ABSENT,
      physicalHarmChainTermination: "The guide-phrase deviation is not meaningful in this operational context.",
      classificationEvidence: sanitizeText(tag.classificationEvidence || tag.notApplicableEvidenceQuote),
      classificationConfidence: normalizeClassificationConfidence(tag.classificationConfidence),
      safetySignificant: "No",
    };
  }

  const exposureCategory = sanitizeText(tag.safetyExposureCategory);
  const exposurePath = sanitizeText(tag.safetyExposurePath);
  const exposureUnsupported = /^none\b|unsupported/i.test(exposureCategory) || /^none\b|unsupported/i.test(exposurePath);
  const safetyEvidence = groundedEvidence(tag.safetyEvidenceField, tag.safetyEvidenceQuote, item);
  const exposureSupported = Boolean(exposureCategory && exposurePath && !exposureUnsupported && (!requireEvidence || safetyEvidence.grounded));
  const contributionType = sanitizeText(tag.safetyContributionType);
  const causalNecessitySupported = normalizeAuditBoolean(tag.causalNecessitySupported);
  const additionalFailureRequired = normalizeAuditBoolean(tag.additionalFailureRequired);
  const safeguardPrecludesPath = normalizeAuditBoolean(tag.safeguardPrecludesPath);
  const causalEffect = sanitizeText(tag.causalEffect);
  const resultingSystemState = sanitizeText(tag.resultingSystemState);
  const intermediateSafetyFunction = sanitizeText(tag.intermediateSafetyFunction);
  const intermediateSafetyEffect = sanitizeText(tag.intermediateSafetyEffect);
  const protectionAssessment = sanitizeText(tag.protectionAssessment);
  const protectionStatus = normalizeProtectionStatus(tag.protectionStatus, protectionAssessment);
  const physicalHarmChainTermination = sanitizeText(tag.physicalHarmChainTermination);
  const requestedSafetyClassificationRule = sanitizeText(tag.safetyClassificationRule || tag.classificationRule);
  const requestedClassification = normalizeSafetyClassification(tag.safetyClassification, {
    applicable,
    proposedAssessment: tag.proposedSafetyAssessment,
    contributionType,
    causalPathType: tag.causalPathType,
  });
  const causalPathType = normalizeSafetyPathType(tag.causalPathType, requestedClassification);
  const explicitPhysicalHarmPath = containsAffirmativeHarmPath({
    ...fallback,
    ...tag,
    safetyExposurePath: exposurePath,
    causalEffect,
    resultingSystemState,
    intermediateSafetyEffect,
  });
  const receiverAuthority = classifyReceiverAuthority(item);
  const directSupportedPath = requestedClassification === SAFETY_CLASSIFICATION.DIRECT
    && causalPathType === "Direct"
    && Boolean(causalEffect && resultingSystemState)
    && exposureSupported
    && explicitPhysicalHarmPath
    && causalNecessitySupported === true
    && additionalFailureRequired === false
    && safeguardPrecludesPath === false
    && authorityPermitsSafety(receiverAuthority.authority);
  const relatedSupportedPath = requestedClassification === SAFETY_CLASSIFICATION.RELATED
    && causalPathType === "Contributory"
    && Boolean(causalEffect && resultingSystemState && intermediateSafetyFunction && intermediateSafetyEffect)
    && exposureSupported
    && explicitPhysicalHarmPath
    && safeguardPrecludesPath === false;
  const missionSupported = requestedClassification === SAFETY_CLASSIFICATION.MISSION
    && Boolean(physicalHarmChainTermination)
    && !explicitPhysicalHarmPath;

  let safetyClassification = SAFETY_CLASSIFICATION.REVIEW;
  if (!requireEvidence) {
    safetyClassification = requestedClassification;
  } else if (directSupportedPath) {
    safetyClassification = SAFETY_CLASSIFICATION.DIRECT;
  } else if (relatedSupportedPath) {
    safetyClassification = SAFETY_CLASSIFICATION.RELATED;
  } else if (missionSupported) {
    safetyClassification = SAFETY_CLASSIFICATION.MISSION;
  }

  const classificationEvidence = sanitizeText(tag.classificationEvidence)
    || (safetyEvidence.grounded ? `${tag.safetyEvidenceField}: “${safetyEvidence.evidenceQuote}”` : "")
    || sanitizeText(tag.safetyEvidenceQuote);
  const candidate = {
    ...fallback,
    ...tag,
    guidePhraseApplicable: "Yes",
    safetyClassification,
    safetyClassificationRule: requestedSafetyClassificationRule,
    causalPathType,
    causalEffect,
    resultingSystemState,
    intermediateSafetyFunction,
    intermediateSafetyEffect,
    protectionAssessment,
    protectionStatus,
    physicalHarmChainTermination,
    classificationEvidence,
  };
  const validation = validateSafetyClassificationRecord(candidate, item);
  const validationFindings = [...validation.findings];
  if (requireEvidence && requestedClassification === SAFETY_CLASSIFICATION.DIRECT && !directSupportedPath) {
    if (!causalEffect) validationFindings.push("the causal effect on the receiver or controlled process is missing");
    if (!resultingSystemState) validationFindings.push("the resulting hazardous system state is missing");
    if (!exposureSupported) validationFindings.push("the exposure path is not grounded in supplied evidence");
    if (!explicitPhysicalHarmPath) validationFindings.push("a complete path to an L1-L3 mishap or physical harm is not established");
    if (!protectionAssessment) validationFindings.push("credited independent protections were not assessed");
    if (additionalFailureRequired !== false) validationFindings.push("the proposed direct path depends on another failure or did not resolve that question");
    if (safeguardPrecludesPath !== false) validationFindings.push("the effect of credited safeguards is unresolved or breaks the proposed path");
  }
  if (requireEvidence && requestedClassification === SAFETY_CLASSIFICATION.RELATED && !relatedSupportedPath) {
    if (!intermediateSafetyFunction) validationFindings.push("the intermediate safety function, control, barrier, or response is missing");
    if (!intermediateSafetyEffect) validationFindings.push("the contributory effect on the intermediate safety function is missing");
    if (!exposureSupported) validationFindings.push("the exposure path is not grounded in supplied evidence");
    if (!explicitPhysicalHarmPath) validationFindings.push("a complete contributory path to an L1-L3 mishap or physical harm is not established");
    if (!protectionAssessment) validationFindings.push("credited independent protections were not assessed");
    if (safeguardPrecludesPath !== false) validationFindings.push("the effect of credited safeguards is unresolved or breaks the proposed path");
  }
  if (requireEvidence && requestedClassification === SAFETY_CLASSIFICATION.MISSION && !missionSupported) {
    if (!physicalHarmChainTermination) validationFindings.push("the point where the physical-harm chain terminates is missing");
    if (explicitPhysicalHarmPath) validationFindings.push("the Mission/Reliability decision contradicts an asserted L1-L3 or physical-harm path");
  }
  if (requestedClassification === SAFETY_CLASSIFICATION.DIRECT && !authorityPermitsSafety(receiverAuthority.authority)) {
    validationFindings.push(`${receiverAuthority.basis} A direct safety path through this receiver is not established.`);
  }
  if (validationFindings.length && safetyClassification !== SAFETY_CLASSIFICATION.REVIEW) {
    safetyClassification = SAFETY_CLASSIFICATION.REVIEW;
  }

  const resolvedClassificationRule = normalizeSafetyClassificationRule(
    safetyClassification === SAFETY_CLASSIFICATION.REVIEW && protectionStatus === PROTECTION_STATUS.UNKNOWN
      ? "U2"
      : requestedSafetyClassificationRule,
    safetyClassification,
    {
      guidePhrase: item.guidePhrase,
      evidence: `${classificationEvidence} ${protectionAssessment} ${validationFindings.join(" ")}`,
    },
  );

  const assessment = safetyClassificationRollup(safetyClassification);
  const resolvedCausalPathType = normalizeSafetyPathType(causalPathType, safetyClassification);
  const primaryValidationFinding = validationFindings.find((finding) => !/^Needs Review requires/i.test(finding))
    || validationFindings[0];
  const rationale = safetyClassification === SAFETY_CLASSIFICATION.REVIEW
    ? `Needs review: ${primaryValidationFinding || "the audit did not establish a complete, internally consistent causal-path classification."}`
    : sanitizeText(tag.proposedSafetyAssessmentRationale)
      || sanitizeText(tag.safetySignificanceRationale)
      || (safetyClassification === SAFETY_CLASSIFICATION.MISSION
        ? `Mission/Reliability: the supported physical-harm chain terminates at ${physicalHarmChainTermination}.`
        : `${safetyClassification}: ${exposurePath}`);
  return {
    proposedSafetyAssessment: assessment,
    proposedSafetyAssessmentRationale: rationale,
    safetyClassification,
    safetyClassificationRule: resolvedClassificationRule,
    causalPathType: resolvedCausalPathType,
    causalEffect,
    resultingSystemState,
    intermediateSafetyFunction,
    intermediateSafetyEffect,
    protectionAssessment,
    protectionStatus,
    physicalHarmChainTermination,
    classificationEvidence,
    classificationConfidence: normalizeClassificationConfidence(tag.classificationConfidence),
    safetySignificant: safetySignificanceValue(safetyClassification),
    receiverAuthority: receiverAuthority.authority,
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
  return /\b(?:L[1-3]|collision|injur|fatal|physical harm|physical (?:asset|property|equipment|infrastructure) damage|hazardous energy|loss of control|unintended (?:motion|movement)|instability|environmental harm|safety[- ]critical asset|security control|critical data integrity|bystander|occupant|resident)\b/i.test([
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
    if (validateSafetyClassificationRecord(row, items[index]).findings.length) indexes.add(index);
  });
  groups.forEach((groupIndexes) => {
    const guideCount = new Set(groupIndexes.map((index) => sanitizeText(items[index]?.guidePhrase).toLowerCase()).filter(Boolean)).size;
    if (guideCount < 5) return;
    const yesCount = groupIndexes.filter((index) => normalizeGuidePhraseApplicability(rows[index]?.guidePhraseApplicable) === "Yes").length;
    if (yesCount === 0 || yesCount >= 6) groupIndexes.forEach((index) => indexes.add(index));
  });
  return Array.from(indexes).sort((left, right) => left - right);
}

function guidePhraseSupportsPatternChallenge(item = {}) {
  const guidePhrase = normalizedEvidenceText(item.guidePhrase);
  const actionType = sanitizeText(item.controlActionType || inferControlActionType(item.controlAction, item.from, item.to));
  if (/not providing|providing the control action/.test(guidePhrase)) return true;
  if (/too early/.test(guidePhrase)) {
    return /command|request|configuration|authority|mode transition|state estimate|information|data|feedback|status|force|resource flow/i.test(actionType)
      || /initiali|startup|activation|transition|prerequis|validity|ready/i.test(normalizedEvidenceText(`${item.controlActionDetails} ${item.toDetails}`));
  }
  if (/too late/.test(guidePhrase)) {
    return actionSupportsDuration(item, actionType)
      || contextIsTimeCritical(item)
      || /command|request|event|state estimate|information|data|feedback|status|force|resource flow/i.test(actionType);
  }
  if (/wrong order/.test(guidePhrase)) return actionSupportsOrdering(item, actionType);
  if (/stopped too soon/.test(guidePhrase)) return actionSupportsDuration(item, actionType);
  if (/applied too long/.test(guidePhrase)) {
    return actionSupportsRetention(item, actionType)
      || /force|resource flow|mode transition/i.test(actionType)
      || /validity|fresh|expire|withdraw|completion|duration|maintain/i.test(normalizedEvidenceText(item.controlActionDetails));
  }
  return false;
}

function missingSafetyCriticalFeedbackNeedsReview(item = {}) {
  if (!/not providing/.test(normalizedEvidenceText(item.guidePhrase))) return false;
  const contract = normalizedEvidenceText(
    `${item.controlAction} ${item.controlActionDetails} ${item.fromDetails} ${item.to} ${item.toDetails}`,
  );
  const safetyRelevantSignal = /\b(?:authority|confidence|constraint|contact|emergency|energy|fault|health|limit|power|protect|readiness|safe|support|validity)\b/.test(contract);
  const decisionOrGate = /\b(?:accept|assess|authoriz|coordinate|decid|detect|enable|evaluate|inhibit|monitor|plan|protect|recover|reject|select|validate)\w*\b/.test(contract);
  return safetyRelevantSignal && decisionOrGate;
}

const CAUSAL_CATEGORY_SIGNAL_PATTERNS = {
  "Controller logic / process model": /\b(?:algorithm|decision logic|process model|controller logic|state machine|gating|arbitration)\b/gi,
  "Sensor / feedback": /\b(?:sensor|measurement|feedback|encoder|camera|lidar|radar|imu|observation|detection)\b/gi,
  "Actuator / physical process": /\b(?:actuator|mechanical|motor|valve|brake|physical process|contact force|joint drive)\b/gi,
  "Communication / interface": /\b(?:communication|network|message|packet|bus|link|interface|transmission|delivery acknowledgement)\b/gi,
  "Timing / sequencing": /\b(?:timing|late|early|stale|sequence|sequencing|race|deadline|latency|schedule|before|after)\b/gi,
  "Power / energy": /\b(?:power|energy|voltage|electrical|battery|supply|undervoltage|overcurrent)\b/gi,
  "Initialization / lifecycle": /\b(?:startup|shutdown|initialization|initialize|reset|boot|commissioning|lifecycle)\b/gi,
  "Mode / state management": /\b(?:mode confusion|mode transition|operating mode|state transition|wrong mode|mode manager)\b/gi,
  "Configuration / calibration": /\b(?:configuration|parameter|calibration|calibrate|threshold|tuning|configured)\b/gi,
  "Human / procedure": /\b(?:operator|human|maintenance|procedure|technician|supervisor|training)\b/gi,
  "Common-cause dependency": /\b(?:common cause|shared dependency|shared resource|single point|coupled failure)\b/gi,
};

function causalCategorySignalCount(category, value = "") {
  const pattern = CAUSAL_CATEGORY_SIGNAL_PATTERNS[category];
  if (!pattern) return 0;
  return (sanitizeText(value).match(pattern) || []).length;
}

export function reconcileCausalFactorCategory(category = "", causalText = "") {
  const currentCategory = CAUSAL_FACTOR_CATEGORIES.has(sanitizeText(category))
    ? sanitizeText(category)
    : inferCausalFactorCategory(causalText);
  const scores = Object.keys(CAUSAL_CATEGORY_SIGNAL_PATTERNS)
    .map((candidate) => [candidate, causalCategorySignalCount(candidate, causalText)])
    .sort((left, right) => right[1] - left[1]);
  const [strongestCategory, strongestScore] = scores[0] || [currentCategory, 0];
  const currentScore = causalCategorySignalCount(currentCategory, causalText);
  return strongestCategory !== currentCategory && strongestScore >= 2 && currentScore === 0
    ? strongestCategory
    : currentCategory;
}

export function findCausalFactorCategoryReviewIndexes(rows = []) {
  const indexes = [];
  rows.forEach((row, index) => {
    if (normalizeGuidePhraseApplicability(row?.guidePhraseApplicable) !== "Yes") return;
    const currentCategory = sanitizeText(row?.causalFactorCategory);
    if (!CAUSAL_FACTOR_CATEGORIES.has(currentCategory)) {
      indexes.push(index);
      return;
    }
    const causalText = [row?.causalFactors, row?.causalFactor, row?.causalScenario]
      .map(sanitizeText)
      .filter(Boolean)
      .join(" ");
    if (!causalText) return;
    if (reconcileCausalFactorCategory(currentCategory, causalText) !== currentCategory) indexes.push(index);
  });
  return indexes;
}

export function findApplicabilityPatternRepairIndexes(rows = [], items = []) {
  if (rows.length < 6 || rows.length !== items.length) return [];
  const indexes = new Set([
    ...findApplicabilityCalibrationIndexes(rows, items),
    ...findConsistencyReconciliationIndexes(rows, items),
    ...findCausalFactorCategoryReviewIndexes(rows),
  ]);
  const guideGroups = new Map();
  rows.forEach((row, index) => {
    const guidePhrase = normalizedEvidenceText(items[index]?.guidePhrase || row?.guidePhrase);
    if (!guidePhrase) return;
    if (!guideGroups.has(guidePhrase)) guideGroups.set(guidePhrase, []);
    guideGroups.get(guidePhrase).push(index);
    if (
      normalizeGuidePhraseApplicability(row?.guidePhraseApplicable) === "No"
      && missingSafetyCriticalFeedbackNeedsReview(items[index])
    ) indexes.add(index);
  });

  const collapsedGuideGroups = [];
  guideGroups.forEach((groupIndexes, guidePhrase) => {
    const interfaceCount = new Set(groupIndexes.map((index) => hazardInterfaceKey(items[index]))).size;
    if (interfaceCount < 3) return;
    const yesCount = groupIndexes.filter((index) => normalizeGuidePhraseApplicability(rows[index]?.guidePhraseApplicable) === "Yes").length;
    const yesRatio = yesCount / groupIndexes.length;
    const nearlyUniform = yesCount === 0 || yesCount === groupIndexes.length || yesRatio <= 0.1;
    if (!nearlyUniform) return;
    const challengeIndexes = yesCount === groupIndexes.length
      ? groupIndexes
      : groupIndexes.filter((index) => (
        normalizeGuidePhraseApplicability(rows[index]?.guidePhraseApplicable) !== "Yes"
        && guidePhraseSupportsPatternChallenge(items[index])
      ));
    if (challengeIndexes.length < 2) return;
    collapsedGuideGroups.push({ guidePhrase, indexes: challengeIndexes, yesRatio });
  });
  if (collapsedGuideGroups.length >= 2) {
    collapsedGuideGroups.flatMap((group) => group.indexes).forEach((index) => indexes.add(index));
  } else {
    collapsedGuideGroups
      .filter((group) => /^providing the control action/.test(group.guidePhrase) && group.yesRatio <= 0.1)
      .flatMap((group) => group.indexes)
      .forEach((index) => indexes.add(index));
  }

  return Array.from(indexes).sort((left, right) => left - right);
}

function applicabilityDistributionSummary(rows = [], items = []) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const guidePhrase = sanitizeText(items[index]?.guidePhrase || row?.guidePhrase) || "Unspecified guide phrase";
    if (!groups.has(guidePhrase)) groups.set(guidePhrase, { yes: 0, no: 0 });
    const counts = groups.get(guidePhrase);
    if (normalizeGuidePhraseApplicability(row?.guidePhraseApplicable) === "Yes") counts.yes += 1;
    else counts.no += 1;
  });
  return Array.from(groups.entries()).map(([guidePhrase, counts]) => ({ guidePhrase, ...counts }));
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
- safetyClassification must be exactly Safety — Direct, Safety — Related, Mission/Reliability, Needs Review, or Not Applicable and must apply the supplied organization policy when present.
- Safety — Direct requires a complete path from causalEffect through resultingSystemState to an L1-L3 mishap/loss without another undocumented failure. Safety — Related requires a named intermediateSafetyFunction and intermediateSafetyEffect on the supported path to L1-L3.
- proposedSafetyAssessment remains the compatibility rollup: Safety for either Safety classification and Mission/Reliability otherwise.
- For Mission/Reliability, physicalHarmChainTermination must identify where the physical-harm path ends. If required evidence is missing, use Needs Review rather than inventing a path.
- safetyClassificationRule must use a matching governed D1-D3, R1-R4, M1-M4, N1-N4, or U1-U4 rule. causalPathType must be Direct, Contributory, None, or Uncertain.
- protectionAssessment must identify credited protections. protectionStatus must be exactly Effective, Ineffective/Unavailable, Absent, or Unknown for this context. An assumed, unconfirmed, unevidenced, or TBD protection is Unknown, not Effective. classificationEvidence must cite supplied evidence or an explicitly labeled assumption; classificationConfidence must be High, Medium, or Low.
- safetySignificant must be Yes for Safety — Direct or Safety — Related, No for Mission/Reliability or Not Applicable, and Needs Review for Needs Review.

Rows:
${JSON.stringify(compactPromptRows(items))}
  `.trim();

  const response = await fetchLLMResponse(prompt, {}, undefined, "", {
    signal: contextOptions.signal,
    maxTokens: 12_000,
    workflow: "hazard-row-generation",
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
    const retrySize = attempt === 0
      ? Math.max(1, Math.min(STANDARD_RETRY_ROWS_PER_PROMPT, Math.ceil(missing.length / 2)))
      : 1;
    const retryChunks = chunkItemsByCount(missing, retrySize);
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
    workflow: "hazard-language-repair",
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
  let completedRepairChunks = 0;
  await mapWithConcurrency(repairChunks, HAZARD_LLM_CONCURRENCY, async (repairChunk, chunkIndex) => {
    contextOptions.onProgress?.({
      message: `Repairing generic ${config.sheetName} wording (${chunkIndex + 1}/${repairChunks.length})...`,
      completed: completedRepairChunks,
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
    } finally {
      completedRepairChunks += 1;
    }
  });

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
id, semanticMeaningful, receiverCanBeAffected, contextSupportsMechanism, adverseStateSupported, guidePhraseApplicable, guidePhraseApplicabilityRationale, applicabilityMechanism, applicabilityEvidenceField, applicabilityEvidenceQuote, strongestReasonForNo, notApplicableReasonCode, notApplicableEvidenceField, notApplicableEvidenceQuote, proposedSafetyAssessment, proposedSafetyAssessmentRationale, safetyClassification, safetyClassificationRule, causalPathType, causalEffect, resultingSystemState, intermediateSafetyFunction, intermediateSafetyEffect, protectionAssessment, protectionStatus, physicalHarmChainTermination, classificationEvidence, classificationConfidence, safetyExposureCategory, safetyExposurePath, safetyEvidenceField, safetyEvidenceQuote, safetyContributionType, causalNecessitySupported, additionalFailureRequired, safeguardPrecludesPath, safetySignificant, safetySignificanceRationale.

Applicability and safety rules:
- Re-decide applicability independently; do not defer to generated.guidePhraseApplicable or let the candidate Hazard/Loss create facts that are absent from the functional row and operational context. Decide applicability from row semantics and context first, then use generated text only to classify a supported adverse path.
- semanticMeaningful, receiverCanBeAffected, contextSupportsMechanism, and adverseStateSupported must each be exactly Yes or No. guidePhraseApplicable must be Yes only when all four are Yes; otherwise it must be No.
- guidePhraseApplicable must be exactly Yes or No.
- Mark Yes only if the exact guide-phrase deviation is semantically meaningful for the action type in the exact scenario/mode and a concrete causal path connects it to an adverse system state. A merely conceivable deviation or generic restatement is insufficient.
- Mark No when the deviation is semantically inapplicable, precluded by the stated architecture/conditions, cannot affect the receiver in that mode, or lacks a credible adverse consequence. Explain the specific reason in guidePhraseApplicabilityRationale.
- Every No decision has a proof obligation. notApplicableReasonCode must be exactly one of: Semantic mismatch; Receiver unaffected; Architecture precludes deviation; No adverse state in context. strongestReasonForNo must state the concrete interface-specific proof. notApplicableEvidenceField and notApplicableEvidenceQuote must identify a short exact excerpt from an allowed supplied field that supports that proof.
- Lack of explicit failure language is not proof of non-applicability. Never use “no evidence establishes an invalid value”, “the contract does not say incorrect”, a malformed citation, or absence of a literal failure adjective as the reason for No. If the proof cannot be established, reconsider the decision rather than defaulting to No.
- Treat row.semanticDeviation as the intended meaning of the guide phrase for that action type.
- For Yes, applicabilityMechanism must name the receiver behavior that makes this exact deviation consequential.
- applicabilityEvidenceField must be exactly one of: Function From; Function From Details; Control Action; Control Action Details; Function To; Function To Details; Operational Scenario; Operational Mode; Operating Conditions; Context Assumptions.
- applicabilityEvidenceQuote must be a short exact verbatim excerpt copied from that supplied field. Do not paraphrase, combine fields, or invent evidence. The application verifies the excerpt against the source and rejects ungrounded Yes decisions.
- Choose the excerpt that establishes the specific semantic discriminator: a prerequisite/window for early, a deadline/latency for late, sequence/version for wrong order, continuity/duration for stopped too soon, or freshness/expiry/revocation for applied too long. A generic statement that the system is operating or safety-relevant is insufficient.
- Bind evidence to this row. A shared context sentence about another actor, channel, function, or interface is not evidence merely because it shares a generic word such as sequence, state, execution, initialization, continuous, active, current, control, update, or monitor. Prefer the interface contract fields; otherwise the context excerpt must name this interface's artifact, endpoint, or at least two distinctive interface concepts.
- "Providing causes" asks whether provision under an unsafe system condition, or provision of an incorrect, unauthorized, inconsistent, out-of-range, or unwanted value, can affect the receiver. Do not evaluate only a correct nominal value under safe conditions.
- A contract carrying a governed goal, authority, bound, constraint, mode, state, estimate, target, command, force, resource, or confidence value may establish consequential variants even when it does not literally say "invalid". Cite the exact contract and explain the unsafe variant and receiver effect.
- For "not providing", do not assume safe shutdown. Explicitly evaluate missing health, fault, readiness, power, energy, protective, authority, validity, confidence, limit, or constraint feedback used by a receiver to assess, authorize, enable, inhibit, plan, coordinate, or select behavior.
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
- If guidePhraseApplicable is No, safetyClassification must be Not Applicable, proposedSafetyAssessment must be Mission/Reliability, and safetySignificant must be No.
- Keep each rationale to one concrete sentence of no more than 30 words so every supplied row fits in the response.
- proposedSafetyAssessment must be exactly one of: Safety or Mission/Reliability.
- proposedSafetyAssessmentRationale must briefly explain why the row belongs in Safety or Mission/Reliability, using the generated row text and supplied project/code context.
- safetyClassification must be exactly one of: Safety — Direct; Safety — Related; Mission/Reliability; Needs Review; Not Applicable. Both Safety classifications roll up to proposedSafetyAssessment Safety; every other classification rolls up to Mission/Reliability.
- causalPathType must be exactly Direct, Contributory, None, or Uncertain.
- Safety — Direct means the causal effect itself creates a hazardous system state that can directly result in a supported L1-L3 mishap/loss in this context, without another undocumented failure.
- Safety — Related means the causal effect credibly contributes to, enables, masks, delays detection of, or prevents mitigation of a named causal condition that can directly result in a supported L1-L3 mishap/loss. Name the intermediate safety function/control/barrier/response and the effect on it.
- Mission/Reliability means the supported chain ends at mission, availability, performance, quality, maintenance, financial, or operational effects. physicalHarmChainTermination must identify exactly where and why the path to L1-L3 terminates.
- Use Needs Review when architecture, authority, timing, exposure, downstream effect, fallback, or protection evidence required for classification is missing. State the missing evidence rather than inventing it.
- safetyClassificationRule must contain the applicable organization-profile rule id when supplied. Otherwise use the generic compatible ids D1-D3, R1-R4, M1-M4, N1-N4, or U1-U4 described by the classification policy.
- causalEffect must state the effect on the receiver or controlled process. resultingSystemState must state the system-level condition that follows.
- For Safety — Related, intermediateSafetyFunction and intermediateSafetyEffect are mandatory. For other outcomes use an empty string when no intermediate path exists.
- protectionAssessment must explain each credited protection. protectionStatus must be exactly Effective, Ineffective/Unavailable, Absent, or Unknown in this exact context. Assumed, unconfirmed, not evidenced, TBD, or pending-confirmation protection is Unknown and requires Needs Review rather than a definitive Safety classification.
- classificationEvidence must cite the project/interface/context evidence or explicitly labeled assumption supporting the classification. classificationConfidence must be High, Medium, or Low.
- safetyExposureCategory must be exactly one of: People; Environment; Physical asset; Safety or security control; Critical data integrity; None / unsupported.
- safetyExposurePath must name the concrete exposed entity/control/integrity property and the context-supported path from the adverse state. Use "None / unsupported" when the candidate stops at an internal error, degraded accuracy, mission loss, or generic downstream impact.
- safetyContributionType must be exactly one of: Direct safety control; Safety-critical feedback / constraint; Indirect safety contributor; Mission / reliability.
- causalNecessitySupported, additionalFailureRequired, and safeguardPrecludesPath must each be exactly Yes or No. Test the exact interface deviation: whether it can create the hazardous state through the named receiver, whether an additional undocumented failure is required, and whether a stated architectural safeguard contains the path.
- Classify Safety — Direct only when the interface directly creates the hazardous state, causalNecessitySupported is Yes, additionalFailureRequired is No, safeguardPrecludesPath is No, and exposure evidence is grounded.
- Classify Safety — Related when the interface has a grounded, architecture-supported contributory path through a named intermediate safety function or causal condition to the mishap. An additional causal step is allowed only when that step is explicitly identified and supported; a theoretical downstream possibility is insufficient.
- When the system is explicitly required to remain safe without an external report, dispatch update, remote service, or advisory input, treat loss of that interface as contained unless the supplied architecture establishes failure of the local safeguard.
- For Safety, safetyEvidenceField must use the same allowed field names as applicabilityEvidenceField, and safetyEvidenceQuote must be an exact verbatim excerpt establishing the exposed entity, safety-critical operation, or harm-relevant operating condition. Without an exact supporting excerpt, classify Mission/Reliability.
- Mark Safety only when the row describes a complete Direct or Related path to harm involving people, operators, bystanders, environment, physical assets, loss of control, or another safety-relevant hazardous state in the stated project context.
- If the generated Loss, Hazard, UCA, causal scenario, or exposure path explicitly reaches collision, injury, fatality, physical harm, hazardous energy, unintended physical motion, or loss of physical control, classify Safety. Do not label such a row Mission/Reliability merely because mission or availability effects also exist.
- Mark Mission/Reliability when the row is mainly about routine reliability, mission availability/performance, developer experience, formatting, logging, non-critical latency, internal cleanup, recoverable behavior, ambiguity, insufficient support, or assumptions not present in the row/context.
- Applicable does not imply Safety. Require a credible safety-relevant system state and exposure or harm path; otherwise use Mission/Reliability.
- safetySignificant must be exactly one of: Yes, No, or Needs Review. Use Yes for Safety — Direct or Safety — Related, No for Mission/Reliability or Not Applicable, and Needs Review only for Needs Review.
- A reporting-only receiver normally supports M3 Mission/Reliability. It may be Safety — Related only when the architecture establishes a named protective response, the report is necessary to initiate or sustain it, and the response can occur within time-to-harm.
- Do not assume a remote operator, fleet service, status consumer, or external stakeholder has protective authority. Missing authority evidence requires Needs Review, not a fabricated Safety or Mission conclusion.
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
    maxTokens: 10_000,
    workflow: "hazard-safety-audit",
  });
  return extractJsonArray(response);
}

function mergeAuditTag(config, row, item, index, tag = {}, { requireChallengeEvidence = false } = {}) {
  const structuredDecision = requireChallengeEvidence
    ? validateApplicabilityEvidence(tag, item)
    : deriveStructuredApplicability(tag, row);
  const auditedApplicability = structuredDecision.guidePhraseApplicable;
  const auditedRationale = structuredDecision.guidePhraseApplicabilityRationale;

  const safetyAssessment = auditedApplicability === "Needs Review"
    ? {
      proposedSafetyAssessment: "Mission/Reliability",
      proposedSafetyAssessmentRationale: "Needs review: guide-phrase applicability could not be validated without a grounded positive decision or a valid non-applicability proof.",
      safetyClassification: SAFETY_CLASSIFICATION.REVIEW,
      safetyClassificationRule: "U4",
      causalPathType: "Uncertain",
      causalEffect: sanitizeText(tag.causalEffect),
      resultingSystemState: sanitizeText(tag.resultingSystemState),
      intermediateSafetyFunction: sanitizeText(tag.intermediateSafetyFunction),
      intermediateSafetyEffect: sanitizeText(tag.intermediateSafetyEffect),
      protectionAssessment: sanitizeText(tag.protectionAssessment) || "Unknown",
      protectionStatus: PROTECTION_STATUS.UNKNOWN,
      physicalHarmChainTermination: sanitizeText(tag.physicalHarmChainTermination),
      classificationEvidence: sanitizeText(tag.classificationEvidence),
      classificationConfidence: normalizeClassificationConfidence(tag.classificationConfidence),
      safetySignificant: "Needs Review",
    }
    : deriveStructuredSafetyAssessment(tag, row, {
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
    safetyClassification: safetyAssessment.safetyClassification,
    safetyClassificationRule: safetyAssessment.safetyClassificationRule,
    causalPathType: safetyAssessment.causalPathType,
    causalEffect: safetyAssessment.causalEffect,
    resultingSystemState: safetyAssessment.resultingSystemState,
    intermediateSafetyFunction: safetyAssessment.intermediateSafetyFunction,
    intermediateSafetyEffect: safetyAssessment.intermediateSafetyEffect,
    protectionAssessment: safetyAssessment.protectionAssessment,
    protectionStatus: safetyAssessment.protectionStatus,
    physicalHarmChainTermination: safetyAssessment.physicalHarmChainTermination,
    classificationEvidence: safetyAssessment.classificationEvidence,
    classificationConfidence: safetyAssessment.classificationConfidence,
    safetySignificant: safetyAssessment.safetySignificant,
    safetySignificanceRationale: safetyAssessment.proposedSafetyAssessmentRationale,
  }, item, index);
}

function hasCompleteStructuredApplicabilityDecision(tag = {}) {
  return [
    "semanticMeaningful",
    "receiverCanBeAffected",
    "contextSupportsMechanism",
    "adverseStateSupported",
  ].every((fieldName) => normalizeAuditBoolean(tag[fieldName]) !== null);
}

function hasCompleteApplicableRepair(config, repair = {}) {
  const requiredByMethod = config.rowIdSuffix === "STPA"
    ? ["losses", "hazards", "unsafeControlActions", "causalScenario", "causalFactors", "mitigationStrategy", "safetyRequirementsConstraints", "systemRequirement"]
    : config.fields.map(([fieldName]) => fieldName).filter((fieldName) => ![
      "rawAnalysisRowId",
      "guidePhrase",
      "guidePhraseApplicable",
      "guidePhraseApplicabilityRationale",
      "controlActionType",
      "rawLossCandidate",
      "rawHazardCandidate",
      "canonicalLossId",
      "canonicalHazardId",
      "requirementParameterSource",
    ].includes(fieldName));
  return requiredByMethod.every((fieldName) => {
    const value = sanitizeText(repair[fieldName]);
    return value && !/^not applicable\b/i.test(value);
  });
}

async function requestApplicabilityPatternRepairs(config, repairItems, distribution, contextOptions = {}) {
  const operationalContextBlock = formatHazardOperationalContext(contextOptions);
  const fieldNames = [
    "id",
    ...config.fields.map(([fieldName]) => fieldName).filter((fieldName) => !DERIVED_STPA_FIELDS.has(fieldName)),
    ...SAFETY_SIGNIFICANCE_FIELDS.map(([fieldName]) => fieldName),
    "semanticMeaningful",
    "receiverCanBeAffected",
    "contextSupportsMechanism",
    "adverseStateSupported",
    "applicabilityMechanism",
    "applicabilityEvidenceField",
    "applicabilityEvidenceQuote",
    "strongestReasonForNo",
    "notApplicableReasonCode",
    "notApplicableEvidenceField",
    "notApplicableEvidenceQuote",
    "safetyExposureCategory",
    "safetyExposurePath",
    "safetyEvidenceField",
    "safetyEvidenceQuote",
    "safetyContributionType",
    "causalNecessitySupported",
    "additionalFailureRequired",
    "safeguardPrecludesPath",
  ];
  const prompt = `
You are repairing a completed ${config.analysisName} decision matrix after a deterministic quality check detected a suspiciously uniform guide-phrase pattern or a causal-category mismatch.

This is a focused independent reconsideration, not a request to manufacture diversity. A uniform result may be correct. Preserve it when supported, but reconsider each supplied interface independently and change it when the exact action contract and operational context support a different decision.

Project / operational context:
${operationalContextBlock || "No explicit project or operational context was available. Infer cautiously from the supplied functional contracts only."}

Completed-run applicability distribution:
${JSON.stringify(distribution)}

Return ONLY a JSON array with one complete object for every supplied row. Preserve each row id exactly. Each object must include:
${fieldNames.join(", ")}.

Repair rules:
- Evaluate the exact semantic deviation for this control-action type. Do not copy the completed-run majority decision and do not force a quota.
- Use Function From Details, Control Action Details, and Function To Details as authoritative interface contracts when present.
- Distinguish absence, invalid or unwanted provision, early consumption, late arrival, wrong sequence/version, premature cessation, and stale or overlong retention. Do not collapse all of them into absence.
- "Providing causes" asks whether provision under an unsafe system condition, or provision of an incorrect, unauthorized, inconsistent, out-of-range, or unwanted command/value, can affect the receiver. Do not interpret it as provision of a correct nominal value under safe conditions.
- The functional contract does not need to literally contain words such as "invalid" or "unsafe". A contract that carries a governed goal, authority, bound, constraint, mode, state, estimate, target, command, force, resource, or confidence value can establish that consequential variants exist. Cite that exact contract, then explain the unsafe variant and receiver effect without inventing unsupported architecture.
- For "not providing", explicitly reconsider absent health, fault, readiness, power, energy, protective, authority, validity, confidence, limit, or constraint feedback when the receiver assesses, authorizes, enables, inhibits, plans, coordinates, or selects behavior. Safe shutdown on missing input must be established by supplied evidence; do not assume it.
- "Too late" may be applicable when a receiver decision, control cycle, freshness boundary, response point, or initialization gate can be missed.
- "Wrong order" may be applicable when a plan, command, state, version, prerequisite, transition, or feedback item can be consumed in an unsafe sequence.
- "Stopped too soon" may be applicable to maintained control, physical/resource flow, periodic feedback, multi-part transfer, or a stream that ends before its required availability interval.
- "Applied too long" may be applicable when a command, constraint, authority, state, sample, plan, physical action, or resource flow persists beyond completion, revocation, replacement, or validity.
- semanticMeaningful, receiverCanBeAffected, contextSupportsMechanism, and adverseStateSupported must each be Yes or No. guidePhraseApplicable is Yes only when all four are Yes.
- For a Yes decision, applicabilityEvidenceField must name exactly one supplied field and applicabilityEvidenceQuote must be a short exact excerpt copied from it. Allowed fields: Function From; Function From Details; Control Action; Control Action Details; Function To; Function To Details; Operational Scenario; Operational Mode; Operating Conditions; Context Assumptions.
- For a No decision, strongestReasonForNo must state the interface-specific reason. Do not use the completed distribution as evidence.
- Every No decision must satisfy the same proof obligation as the independent audit. Set notApplicableReasonCode to exactly one of: Semantic mismatch; Receiver unaffected; Architecture precludes deviation; No adverse state in context. Cite a short exact supporting excerpt in notApplicableEvidenceField and notApplicableEvidenceQuote. Lack of literal failure wording is not proof.
- Set safetyContributionType to exactly one of: Direct safety control; Safety-critical feedback / constraint; Indirect safety contributor; Mission / reliability. Set causalNecessitySupported, additionalFailureRequired, and safeguardPrecludesPath to Yes or No after testing the exact receiver path and stated safeguards.
- Set safetyClassification to exactly one of: Safety — Direct; Safety — Related; Mission/Reliability; Needs Review; Not Applicable. Set causalPathType to Direct, Contributory, None, or Uncertain and supply the matching D1-D3, R1-R4, M1-M4, N1-N4, or U1-U4 rule id.
- Safety — Direct requires causalEffect, resultingSystemState, a grounded exposure and L1-L3 path, and no additional undocumented failure or effective independent protection.
- Safety — Related requires causalEffect, resultingSystemState, intermediateSafetyFunction, intermediateSafetyEffect, a grounded contributory path to L1-L3, and no effective independent protection that breaks the path.
- Mission/Reliability requires physicalHarmChainTermination. Do not retain L1-L3 or physical-harm wording while classifying Mission/Reliability unless the rationale explicitly identifies why that proposed chain is unsupported and removes it from the repaired Hazard/Loss.
- Use Needs Review when required architecture, authority, exposure, timing, downstream-effect, or protection evidence is unavailable. Do not force a definitive classification.
- A reporting-only receiver may be Safety — Related only when a named, evidenced protective response depends on that interface within time-to-harm. Otherwise use Mission/Reliability or Needs Review.
- Do not classify an indirect contributor as Safety merely because people or physical assets are present in the shared operational context. A theoretical downstream possibility without a named, supported intermediate mechanism is insufficient.
- If the repaired decision is Yes, regenerate every hazard-bearing field as a complete, concrete row; do not leave Not applicable text in Loss, Hazard, UCA, causal, mitigation, constraint, or requirement fields.
- If the repaired applicability decision is No, use Not Applicable and No for safety significance. The application will normalize hazard-bearing fields to Not applicable.
- causalFactorCategory must match the primary initiating mechanism, not a secondary consequence. Use only the allowed category vocabulary from the original analysis instructions.
- Preserve TBD parameter discipline and allocate requirements to an exact source function, target function, or named subsystem.

Rows to repair:
${JSON.stringify(repairItems.map(({ item, row }) => ({
    row: compactPromptItem(item, 220),
    currentGenerated: row,
  })))}
  `.trim();

  const response = await fetchLLMResponse(prompt, {}, undefined, "", {
    signal: contextOptions.signal,
    maxTokens: 10_000,
    workflow: "hazard-applicability-pattern-repair",
  });
  return extractJsonArray(response);
}

async function repairHazardAuditAnomalies(config, rows, items, contextOptions = {}) {
  if (config.rowIdSuffix !== "STPA" || rows.length < 6) return rows;
  const repairIndexes = findApplicabilityPatternRepairIndexes(rows, items);
  if (!repairIndexes.length) return rows;

  const distribution = applicabilityDistributionSummary(rows, items);
  const repairGroups = new Map();
  repairIndexes.forEach((index) => {
    const guidePhrase = sanitizeText(items[index]?.guidePhrase || rows[index]?.guidePhrase) || "Unspecified guide phrase";
    if (!repairGroups.has(guidePhrase)) repairGroups.set(guidePhrase, []);
    repairGroups.get(guidePhrase).push({ row: rows[index], item: items[index], index });
  });
  const repairChunks = Array.from(repairGroups.values()).flatMap((group) => (
    chunkItemsByCount(group, APPLICABILITY_PATTERN_REPAIR_ROWS_PER_PROMPT)
  ));
  const repairedRows = [...rows];
  let completedChunks = 0;
  contextOptions.onProgress?.({
    message: `Rechecking ${repairIndexes.length} suspicious hazard-audit decisions...`,
    completed: 0,
    total: repairChunks.length,
  });

  await mapWithConcurrency(repairChunks, HAZARD_LLM_CONCURRENCY, async (repairChunk, chunkIndex) => {
    contextOptions.onProgress?.({
      message: `Repairing applicability pattern (${chunkIndex + 1}/${repairChunks.length})...`,
      completed: completedChunks,
      total: repairChunks.length,
    });
    try {
      const repairs = await requestApplicabilityPatternRepairs(config, repairChunk, distribution, contextOptions);
      const repairsById = generatedRowsById(repairs);
      repairChunk.forEach(({ row, item, index }, localIndex) => {
        const repair = generatedRowForItem(repairsById, repairs, localIndex, item);
        if (!hasCompleteStructuredApplicabilityDecision(repair)) return;
        const applicability = validateApplicabilityEvidence(repair, item).guidePhraseApplicable;
        const wasApplicable = normalizeGuidePhraseApplicability(row.guidePhraseApplicable) === "Yes";
        if (applicability === "Needs Review") {
          // Preserve the pre-repair candidate evidence. A failed adjudication
          // must not overwrite it with the repair response's Not applicable
          // placeholders merely because the negative proof was insufficient.
          repairedRows[index] = mergeAuditTag(config, row, item, index, repair, { requireChallengeEvidence: true });
          return;
        }
        if (applicability === "Yes" && !wasApplicable && !hasCompleteApplicableRepair(config, repair)) return;
        const previousRow = applicability === "Yes" && !wasApplicable
          ? {
            ...row,
            rawLossCandidate: "",
            rawHazardCandidate: "",
            canonicalLossId: "",
            canonicalHazardId: "",
          }
          : row;
        const repairedCandidate = normalizeRow(config, { ...previousRow, ...repair }, item, index);
        repairedRows[index] = mergeAuditTag(config, repairedCandidate, item, index, repair, { requireChallengeEvidence: true });
      });
    } catch (err) {
      rethrowInterruptedRequest(err, contextOptions.signal);
      console.warn(`⚠️ ${config.sheetName} applicability pattern repair failed for chunk ${chunkIndex + 1}; retaining independently audited rows.`, err);
    } finally {
      completedChunks += 1;
    }
  });

  contextOptions.onProgress?.({
    message: "Applicability pattern repair complete.",
    completed: repairChunks.length,
    total: repairChunks.length,
  });
  return repairedRows;
}

const LOSS_CONSEQUENCE_CLASSES = [
  {
    key: "people",
    preferredId: "L1",
    pattern: /\b(?:L1|injur\w*|fatal\w*|death|loss of life|physical harm|casualt\w*)\b/i,
    statement: "People suffer injury or loss of life.",
  },
  {
    key: "asset",
    preferredId: "L2",
    pattern: /\b(?:L2|property|equipment|infrastructure|payload|physical asset|asset damage|vehicle damage|machine damage)\b/i,
    statement: "Property, equipment, infrastructure, or other physical assets are damaged.",
  },
  {
    key: "environment",
    preferredId: "L3",
    pattern: /\b(?:L3|environmental harm|environmental damage|contaminat\w*|pollut\w*|toxic release|spill)\b/i,
    statement: "The environment is harmed or contaminated.",
  },
  {
    key: "mission",
    preferredId: "L4",
    pattern: /\b(?:L4|loss of mission|mission loss|loss of service|service loss|loss of mobility|immobili\w*|production loss|loss of production|loss of operational (?:control|capability)|operational capability is lost)\b/i,
    statement: "Mission, service, mobility, production, or operational capability is lost.",
  },
  {
    key: "security",
    preferredId: "L5",
    pattern: /\b(?:L5|security compromise|security control|protected information|confidential\w*|privacy|unauthorized disclosure|unauthorized access|critical data integrity|safety-critical data|loss of data integrity|integrity of critical)\b/i,
    statement: "Protected information, security controls, or critical information integrity is compromised.",
  },
  {
    key: "business",
    preferredId: "L6",
    pattern: /\b(?:L6|trust|reputation|commercial harm|business loss)\b/i,
    statement: "Trust, reputation, or commercial value is harmed.",
  },
];

function lossConsequenceClassKeys(value = "") {
  const text = sanitizeText(value);
  return LOSS_CONSEQUENCE_CLASSES
    .filter(({ pattern }) => pattern.test(text))
    .map(({ key }) => key);
}

export function ensureCanonicalLossClassCoverage(catalogInput = {}, applicableItems = []) {
  const catalog = normalizedCanonicalCatalog(catalogInput);
  const supportedClasses = new Set();
  const explicitlyGovernedClasses = new Set();
  applicableItems.forEach(({ row }) => {
    const rawLoss = row?.rawLossCandidate || row?.losses || row?.loss;
    lossConsequenceClassKeys(rawLoss)
      .forEach((key) => supportedClasses.add(key));
    LOSS_CONSEQUENCE_CLASSES.forEach(({ key, preferredId }) => {
      if (new RegExp(`\\b${preferredId}\\b`, "i").test(sanitizeText(rawLoss))) explicitlyGovernedClasses.add(key);
    });
  });
  catalog.losses.forEach(({ statement }) => {
    lossConsequenceClassKeys(statement).forEach((key) => supportedClasses.add(key));
  });
  const entriesByClass = new Map();
  catalog.losses.forEach((entry) => {
    const keys = lossConsequenceClassKeys(entry.statement);
    if (keys.length === 1 && !entriesByClass.has(keys[0])) entriesByClass.set(keys[0], entry);
  });
  const governedLosses = LOSS_CONSEQUENCE_CLASSES
    .filter(({ key }) => supportedClasses.has(key))
    .map(({ key, preferredId, statement }) => ({
      id: explicitlyGovernedClasses.has(key) ? preferredId : (entriesByClass.get(key)?.id || preferredId),
      statement: entriesByClass.get(key)?.statement || statement,
    }));
  const unclassifiedLosses = catalog.losses
    .filter((entry) => lossConsequenceClassKeys(entry.statement).length === 0)
    .slice(0, 4)
    .map((entry, index) => ({ ...entry, id: `L${LOSS_CONSEQUENCE_CLASSES.length + index + 1}` }));
  catalog.losses = [...governedLosses, ...unclassifiedLosses];
  return catalog;
}

const CANONICAL_HAZARD_FAMILIES = [
  { key: "UNSAFE_MOTION", pattern: /\b(?:collision|crash|strike|rollover|instability|unsafe motion|uncontrolled motion|loss of (?:vehicle|machine|motion|physical) control|trajectory deviation)\b/i, statement: "The controlled system has unsafe or uncontrolled motion while people, property, or the environment are exposed." },
  { key: "UNINTENDED_ACTUATION", pattern: /\b(?:unintended|unexpected|spurious|unauthorized|incorrect)\b.{0,50}\b(?:actuat|command|force|torque|brak|steer|throttle|movement)\w*/i, statement: "The controlled system applies an unintended or incorrect physical action." },
  { key: "CONTROL_UNAVAILABLE", pattern: /\b(?:unable|unavailable|insufficient|missing|loss of)\b.{0,55}\b(?:control|actuat|brak|steer|stop|response|command|maneuver)\w*/i, statement: "The controlled system cannot provide a required control or protective response when needed." },
  { key: "INVALID_STATE", pattern: /\b(?:invalid|incorrect|stale|inconsistent|corrupt|uncertain|unconfirmed|misaligned)\b.{0,60}\b(?:state|estimate|position|pose|map|perception|status|data|information|model)\w*/i, statement: "The system operates using an invalid, inconsistent, or stale representation of its state or environment." },
  { key: "UNSAFE_PLAN", pattern: /\b(?:invalid|incorrect|unsafe|stale|unconfirmed|unauthorized)\b.{0,60}\b(?:plan|route|trajectory|goal|decision|behavior|task|mission)\w*/i, statement: "The system selects or executes behavior that is inconsistent with the current mission, constraints, or environment." },
  { key: "PROTECTION_DEGRADED", pattern: /\b(?:protect|barrier|safeguard|monitor|fault detection|warning|recovery|minimum.?risk|safe.?state)\w*.{0,60}\b(?:unavailable|degraded|disabled|masked|bypassed|late|ineffective|fails?)\b/i, statement: "A required protective, monitoring, containment, or recovery function is unavailable or ineffective when demanded." },
  { key: "UNSAFE_MODE_AUTHORITY", pattern: /\b(?:mode|authority|authorization|responsibility|control transition|configuration)\b.{0,65}\b(?:invalid|incorrect|unsafe|ambiguous|conflict|stale|unauthorized)\w*/i, statement: "The system operates with an unsafe or ambiguous mode, authority, responsibility, or configuration state." },
  { key: "HAZARDOUS_ENERGY_RELEASE", pattern: /\b(?:hazardous energy|toxic release|loss of containment|spill|overpressure|overheat|fire|electrical hazard|uncontrolled release)\b/i, statement: "People, property, or the environment are exposed to uncontrolled hazardous energy or material." },
  { key: "UNSAFE_EXPOSURE", pattern: /\b(?:expos|separation|clearance|occupied|conflict point|obstruction|blocked|travel lane|work envelope)\w*/i, statement: "The system or an exposed entity occupies an unsafe location or lacks required separation or clearance." },
  { key: "SECURITY_INTEGRITY", pattern: /\b(?:security|cyber|unauthorized access|protected information|critical data integrity)\b/i, statement: "Security or critical information integrity is compromised in a way that can affect system operation." },
  { key: "MISSION_AVAILABILITY", pattern: /\b(?:mission|service|production|availability|dispatch|tracking|reporting|operational capability)\b/i, statement: "Required mission or operational capability is unavailable, degraded, or incorrectly coordinated." },
];

function hazardFamily(value = "") {
  const source = sanitizeText(value);
  return CANONICAL_HAZARD_FAMILIES.find(({ pattern }) => pattern.test(source))
    || { key: "OTHER", statement: "The system enters a hazardous or operationally unacceptable state." };
}

const CANONICAL_TOKEN_STOP_WORDS = new Set(["about", "after", "before", "because", "being", "causes", "causing", "control", "during", "function", "hazard", "resulting", "system", "through", "while", "with", "without"]);

function canonicalTokens(value = "") {
  return new Set(normalizedEvidenceText(value).split(" ").filter((token) => token.length >= 4 && !CANONICAL_TOKEN_STOP_WORDS.has(token)));
}

function lexicalCanonicalScore(left = "", right = "") {
  const leftTokens = canonicalTokens(left);
  const rightTokens = canonicalTokens(right);
  let overlap = 0;
  leftTokens.forEach((token) => { if (rightTokens.has(token)) overlap += 1; });
  return overlap / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

function fallbackCanonicalHazard(rawHazardCandidate = "", catalogHazards = []) {
  const family = hazardFamily(rawHazardCandidate);
  const sameFamily = catalogHazards.filter((entry) => hazardFamily(entry.statement).key === family.key);
  const candidates = sameFamily.length ? sameFamily : catalogHazards;
  const best = [...candidates]
    .sort((left, right) => lexicalCanonicalScore(rawHazardCandidate, right.statement) - lexicalCanonicalScore(rawHazardCandidate, left.statement))[0];
  return best || { id: `H-${family.key}`, statement: family.statement };
}

export function findCanonicalVocabularyReviewIndexes(rows = []) {
  const applicable = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => normalizeGuidePhraseApplicability(row.guidePhraseApplicable) === "Yes");
  if (applicable.length < 20) return [];
  const hazardGroups = new Map();
  applicable.forEach(({ row, index }) => {
    const id = sanitizeText(row.canonicalHazardId);
    if (!hazardGroups.has(id)) hazardGroups.set(id, []);
    hazardGroups.get(id).push(index);
  });
  const suspiciousCatalogSize = hazardGroups.size > Math.max(15, Math.ceil(applicable.length * 0.5));
  if (!suspiciousCatalogSize) return [];
  return Array.from(hazardGroups.values())
    .filter((indexes) => indexes.length <= 2)
    .flat()
    .sort((left, right) => left - right);
}

export function reconcileCanonicalVocabulary(rows = []) {
  const reviewIndexes = new Set(findCanonicalVocabularyReviewIndexes(rows));
  if (!reviewIndexes.size) return rows;
  return rows.map((row, index) => {
    if (!reviewIndexes.has(index)) return row;
    const rawHazardCandidate = sanitizeText(row.rawHazardCandidate || row.hazards || row.hazard);
    const family = hazardFamily(rawHazardCandidate);
    const rawLossClasses = lossConsequenceClassKeys(row.rawLossCandidate || row.losses || row.loss);
    const canonicalLosses = LOSS_CONSEQUENCE_CLASSES.filter(({ key }) => rawLossClasses.includes(key));
    return {
      ...row,
      hazards: family.statement,
      canonicalHazardId: `H-${family.key}`,
      losses: canonicalLosses.length ? canonicalLosses.map(({ statement }) => statement).join("; ") : row.losses,
      canonicalLossId: canonicalLosses.length ? canonicalLosses.map(({ preferredId }) => preferredId).join(", ") : "L-UNCLASSIFIED",
    };
  });
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
    workflow: "hazard-canonical-catalog",
  });
  return extractJsonObject(response);
}

async function requestCanonicalRiskMappings(config, catalog, mappingItems, contextOptions = {}) {
  const prompt = `
Map each applicable ${config.analysisName} row to exactly one canonical Loss and one canonical Hazard from the supplied catalogs.

Return ONLY a JSON array with one object per row containing id, canonicalLossIds, canonicalHazardId. Preserve each row id exactly. canonicalLossIds must be an array containing every catalog Loss explicitly supported by that row's raw Loss candidate; canonicalHazardId must contain exactly one Hazard id. Use only catalog ids; do not create or rewrite catalog entries.

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
    workflow: "hazard-canonical-mapping",
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
  const applicableItems = rows
    .map((row, index) => ({ row, item: items[index] }))
    .filter(({ row }) => normalizeGuidePhraseApplicability(row.guidePhraseApplicable) === "Yes");
  const catalog = ensureCanonicalLossClassCoverage(catalogInput, applicableItems);
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
    const requestedLossIds = (Array.isArray(mapping.canonicalLossIds)
      ? mapping.canonicalLossIds
      : sanitizeText(mapping.canonicalLossId).split(/\s*[,;]\s*/))
      .map((id) => {
        const requestedId = sanitizeText(id).toUpperCase();
        if (lossesById.has(requestedId)) return requestedId;
        return requestedId.replace(/^L-(\d+)$/, "L$1");
      })
      .filter((id) => lossesById.has(id));
    const rawLossClasses = new Set(lossConsequenceClassKeys(rawLossCandidate));
    catalog.losses.forEach((entry) => {
      const entryClasses = lossConsequenceClassKeys(entry.statement);
      if (entryClasses.some((key) => rawLossClasses.has(key))) requestedLossIds.push(entry.id.toUpperCase());
    });
    const canonicalLossIds = Array.from(new Set(requestedLossIds));
    const requestedCanonicalHazardId = sanitizeText(mapping.canonicalHazardId).toUpperCase();
    const canonicalLosses = canonicalLossIds.map((id) => lossesById.get(id)).filter(Boolean);
    const requestedCanonicalHazard = hazardsById.get(requestedCanonicalHazardId);
    const rawFamily = hazardFamily(rawHazardCandidate).key;
    const requestedFamily = hazardFamily(requestedCanonicalHazard).key;
    const canonicalHazardEntry = requestedCanonicalHazard
      && (rawFamily === "OTHER" || requestedFamily === rawFamily)
      ? { id: requestedCanonicalHazardId, statement: requestedCanonicalHazard }
      : fallbackCanonicalHazard(rawHazardCandidate, catalog.hazards);
    return {
      ...row,
      rawLossCandidate,
      rawHazardCandidate,
      losses: canonicalLosses.length ? Array.from(new Set(canonicalLosses)).join("; ") : rawLossCandidate,
      hazards: canonicalHazardEntry.statement,
      canonicalLossId: canonicalLossIds.length ? canonicalLossIds.join(", ") : "L-UNCLASSIFIED",
      canonicalHazardId: canonicalHazardEntry.id,
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
    const catalog = ensureCanonicalLossClassCoverage(
      await requestCanonicalRiskCatalog(config, applicableItems, contextOptions),
      applicableItems,
    );
    if (!catalog.losses.length || !catalog.hazards.length) throw new Error("Canonical catalog response was empty.");
    const chunks = chunkItemsByCount(applicableItems, CANONICAL_MAPPING_ROWS_PER_PROMPT);
    let completedMappingChunks = 0;
    const mappingChunks = await mapWithConcurrency(chunks, HAZARD_LLM_CONCURRENCY, async (chunk, chunkIndex) => {
      contextOptions.onProgress?.({
        message: `Mapping raw evidence to canonical Losses and Hazards (${chunkIndex + 1}/${chunks.length})...`,
        completed: completedMappingChunks,
        total: chunks.length,
      });
      try {
        return await requestCanonicalRiskMappings(config, catalog, chunk, contextOptions);
      } finally {
        completedMappingChunks += 1;
      }
    });
    const mappings = mappingChunks.flat();
    const canonicalRows = applyCanonicalRiskVocabulary(rows, items, catalog, mappings);
    const reviewIndexes = findCanonicalVocabularyReviewIndexes(canonicalRows);
    if (reviewIndexes.length) {
      contextOptions.onProgress?.({
        message: `Reconciling ${reviewIndexes.length} near-unique canonical mappings...`,
      });
    }
    return reconcileCanonicalVocabulary(canonicalRows);
  } catch (err) {
    rethrowInterruptedRequest(err, contextOptions.signal);
    console.warn(`⚠️ ${config.sheetName} canonical vocabulary generation failed; retaining raw Loss and Hazard candidates.`, err);
    return reconcileCanonicalVocabulary(applyCanonicalRiskVocabulary(rows, items));
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
  let completedTagChunks = 0;
  await mapWithConcurrency(tagChunks, HAZARD_LLM_CONCURRENCY, async (tagChunk, chunkIndex) => {
    contextOptions.onProgress?.({
      message: `Auditing guide-phrase applicability and safety significance (${chunkIndex + 1}/${tagChunks.length})...`,
      completed: completedTagChunks,
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
    } finally {
      completedTagChunks += 1;
    }
  });

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

// The repair stages that run after generation, in order. Each has the same
// (config, rows, items, contextOptions) shape and returns the next rows, so the
// sequence is data rather than four hand-written awaits.
export const HAZARD_ANALYSIS_REPAIR_STAGES = [
  ["language-repair", repairGenericStandardRows],
  ["safety-audit", tagSafetySignificanceForStandardRows],
  ["audit-anomaly-repair", repairHazardAuditAnomalies],
  ["canonicalization", canonicalizeStpaRiskVocabulary],
];

export const HAZARD_ANALYSIS_STAGE_KEYS = [
  "generation",
  ...HAZARD_ANALYSIS_REPAIR_STAGES.map(([stage]) => stage),
];

/**
 * Runs generation followed by every repair stage and returns the final rows.
 *
 * `onStageComplete({ stage, rows })` fires after each stage with that stage's
 * output, which lets a caller attribute a change in quality to the stage that
 * caused it instead of only seeing the end of the pipeline.
 */
export async function runStandardHazardAnalysisStages({
  config,
  items,
  operationalContext = "",
  organizationContext = "",
  analysisContext = null,
  contextSources = null,
  onProgress = () => {},
  onStageComplete = () => {},
  signal = null,
  provider = getStoredActiveAIProvider(),
}) {
  const maximumRowsPerPrompt = getStandardHazardRowsPerPrompt(provider);
  const promptChunks = items.length <= maximumRowsPerPrompt && compactPromptRowsLength(items) <= STANDARD_SINGLE_PROMPT_MAX_CHARS
    ? [items]
    : chunkItemsForPrompt(items, STANDARD_CHUNK_PROMPT_MAX_CHARS, maximumRowsPerPrompt);

  if (promptChunks.length > 1) {
    console.warn(`⚠️ ${config.sheetName} standard input is large; using ${promptChunks.length} bulk prompt chunks instead of one prompt.`);
  }

  const contextOptions = {
    operationalContext,
    organizationContext,
    analysisContext,
    contextSources,
    signal,
  };

  let completedGenerationChunks = 0;
  const totalProgressSteps = promptChunks.length + HAZARD_ANALYSIS_REPAIR_STAGES.length;
  const generatedChunks = await mapWithConcurrency(promptChunks, HAZARD_LLM_CONCURRENCY, async (chunk, chunkIndex) => {
    onProgress({
      step: chunkIndex + 1,
      total: totalProgressSteps,
      message: `Generating ${config.sheetName} rows (${chunkIndex + 1}/${promptChunks.length})...`,
    });
    try {
      const chunkRows = await requestStandardRowsWithRetries(config, chunk, {
        ...contextOptions,
        onProgress,
      });
      return chunkRows;
    } catch (err) {
      rethrowInterruptedRequest(err, signal);
      console.warn(`⚠️ ${config.sheetName} standard generation failed for chunk ${chunkIndex + 1}; using local fallback rows for that chunk.`, err);
      return chunk.map((item, index) => fallbackRow(config, item, chunkIndex * maximumRowsPerPrompt + index));
    } finally {
      completedGenerationChunks += 1;
      onProgress({
        step: completedGenerationChunks,
        total: totalProgressSteps,
        message: `Generated ${completedGenerationChunks}/${promptChunks.length} ${config.sheetName} row batches...`,
      });
    }
  });

  let normalizedRows = materializeGeneratedHazardRows(config, generatedChunks.flat(), items);
  await onStageComplete({ stage: "generation", rows: normalizedRows });

  for (let index = 0; index < HAZARD_ANALYSIS_REPAIR_STAGES.length; index += 1) {
    const [stage, runStage] = HAZARD_ANALYSIS_REPAIR_STAGES[index];
    normalizedRows = await runStage(config, normalizedRows, items, {
      ...contextOptions,
      onProgress: (patch) => onProgress({
        step: promptChunks.length + index + 1,
        total: totalProgressSteps,
        ...patch,
      }),
    });
    await onStageComplete({ stage, rows: normalizedRows });
  }

  // Enforce the governed classification contract on the final output, after
  // every LLM repair/canonicalization stage has had an opportunity to modify a
  // row. This is intentionally last so inconsistent dependent fields cannot be
  // persisted merely because a later stage reintroduced them.
  normalizedRows = normalizedRows.map((row, index) => {
    const audited = auditSafetyClassificationRecord(row, items[index]);
    const { validationFindings, ...auditedRow } = audited;
    if (!validationFindings.length) return auditedRow;
    const finding = validationFindings[0];
    return {
      ...auditedRow,
      proposedSafetyAssessmentRationale: `Needs review: ${finding}`,
      safetySignificanceRationale: `Needs review: ${finding}`,
    };
  });

  return normalizedRows;
}

export async function generateStandardCodeHazardAnalysisSheets({
  sheets,
  setFolders,
  currentFolder,
  method = "STPA",
  operationalContext = "",
  organizationContext = "",
  analysisContext = null,
  contextSources = null,
  onProgress = () => {},
  onStageComplete = () => {},
  omitConsolidatedRequirement = false,
  signal = null,
  provider = getStoredActiveAIProvider(),
}) {
  const items = flattenDecomposition(sheets);
  if (!items.length) return sheets;

  const config = omitConsolidatedRequirement
    ? omitConsolidatedRequirementFromConfig(getStandardConfig(method))
    : getStandardConfig(method);

  const normalizedRows = await runStandardHazardAnalysisStages({
    config,
    items,
    operationalContext,
    organizationContext,
    analysisContext,
    contextSources,
    onProgress,
    onStageComplete,
    signal,
    provider,
  });

  return saveSheets({
    sheets,
    setFolders,
    currentFolder,
    additions: buildStandardSheets(config, normalizedRows, items),
  });
}
