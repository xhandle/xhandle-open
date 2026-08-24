import { fetchLLMResponse } from "./aiAnalysisSTPA";
import {
  CODE_ARCHITECTURE_TRACEABILITY_COLUMNS,
  HAZARD_SUMMARY_TRACEABILITY_COLUMNS,
  extractFunctionalDecompositionTrace,
  traceabilityObjectToSummaryFields,
  traceabilityToSheetCells,
} from "../features/code-architecture-hazard-analysis/codeArchitectureHazardUtils";

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
  return decomposition
    .slice(1)
    .map((row, index) => ({
      id: `FD-${index + 1}`,
      from: sanitizeText(getCellText(row[0])),
      controlAction: sanitizeText(getCellText(row[1])),
      to: sanitizeText(getCellText(row[2])),
      traceability: extractFunctionalDecompositionTrace(headers, row),
    }))
    .filter((row) => row.from || row.controlAction || row.to);
}

function extractJsonArray(text) {
  const raw = String(text || "").trim();
  const first = raw.indexOf("[");
  const last = raw.lastIndexOf("]");
  const candidate = first >= 0 && last > first ? raw.slice(first, last + 1) : raw;
  return JSON.parse(candidate);
}

function compactPromptItem(item = {}, maxChars = 120) {
  const trace = item.traceability || {};
  return {
    id: truncateForPrompt(item.id, 32),
    functionFrom: truncateForPrompt(item.from, maxChars),
    controlAction: truncateForPrompt(item.controlAction, maxChars),
    functionTo: truncateForPrompt(item.to, maxChars),
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
const STANDARD_MAX_ROWS_PER_PROMPT = 10;
const STANDARD_RETRY_ROWS_PER_PROMPT = 4;
const STANDARD_MISSING_ROW_RETRIES = 2;
const SAFETY_SIGNIFICANCE_FIELDS = [
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
- Losses must describe plausible adverse end states or consequences.
- Hazards must describe unsafe system states, not generic failures, and include the local effect, system-level effect, and plausible consequence.
- Unsafe control action must name whether the action is missing, wrong, provided too early or late, stopped too soon, applied too long, or provided when not needed, and identify the affected data, command, state, or interface.
- Causal factors must name concrete technical, data, timing, interface, human, or environmental contributors.
- Safety requirement or constraint must be tailored and testable.
${CONCRETE_CAUSAL_CHAIN_GUIDANCE}
${DOMAIN_NOUN_GUIDANCE}
${SPECIFICITY_SELF_CHECK_GUIDANCE}
`.trim(),
    fields: [
      ["losses", "Losses"],
      ["hazards", "Hazards"],
      ["unsafeControlActions", "Unsafe Control Actions"],
      ["causalFactors", "Causal Factors"],
      ["safetyRequirementsConstraints", "Safety Requirements/Constraints"],
    ],
  };
}

function generatedRowKey(row = {}) {
  const id = sanitizeText(row.id);
  const match = id.match(/\bFD-\d+\b/i);
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
    loss: `Needs review: loss was not generated for ${item.id || `FD-${index + 1}`}.`,
    losses: `Needs review: losses were not generated for ${item.id || `FD-${index + 1}`}.`,
    hazard: `Needs review: hazard was not generated for ${item.id || `FD-${index + 1}`}.`,
    hazards: `Needs review: hazards were not generated for ${item.id || `FD-${index + 1}`}.`,
    causalFactor: `Needs review: causal factor was not generated for ${item.id || `FD-${index + 1}`}.`,
    causalFactors: `Needs review: causal factors were not generated for ${item.id || `FD-${index + 1}`}.`,
    mitigationStrategy: `Needs review: mitigation was not generated for ${item.id || `FD-${index + 1}`}.`,
    systemRequirement: `Needs review: system requirement was not generated for ${item.id || `FD-${index + 1}`}.`,
    consolidatedRequirement: `Needs review: consolidated requirement was not generated for ${item.id || `FD-${index + 1}`}.`,
    safetyRequirementsConstraints: `Needs review: safety constraint was not generated for ${item.id || `FD-${index + 1}`}.`,
    failureMode: `Needs review: failure mode was not generated for ${item.id || `FD-${index + 1}`}.`,
    whatIfScenario: `Needs review: what-if scenario was not generated for ${item.id || `FD-${index + 1}`}.`,
    unsafeControlActions: `Needs review: unsafe control action was not generated for ${item.id || `FD-${index + 1}`}.`,
  };
  return common;
}

function normalizeRow(config, row, item, index) {
  const base = fallbackRow(config, item, index);
  const normalized = {
    id: sanitizeText(row.id) || base.id,
    safetySignificant: normalizeSafetySignificance(row.safetySignificant || row["Safety Significant"]),
    safetySignificanceRationale: sanitizeText(row.safetySignificanceRationale || row["Safety Significance Rationale"]),
  };
  config.fields.forEach(([fieldName]) => {
    normalized[fieldName] = sanitizeText(row[fieldName]) || base[fieldName] || "";
  });
  return normalized;
}

function normalizeSafetySignificance(value) {
  const text = sanitizeText(value).toLowerCase();
  if (/^yes\b|^safety\s*significant\b|^significant\b/i.test(text)) return "Yes";
  return "Needs Review";
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
  const fieldNames = ["id", ...config.fields.map(([fieldName]) => fieldName)];
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

Rows:
${JSON.stringify(compactPromptRows(items))}
  `.trim();

  const response = await fetchLLMResponse(prompt);
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

  const response = await fetchLLMResponse(prompt);
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
You are reviewing generated ${config.analysisName} rows for safety significance after candidate hazard generation.

Project / operational context:
${operationalContextBlock || "No explicit project or operational context was available. Infer cautiously from row evidence only."}

Return ONLY a JSON array. Each object must include:
id, safetySignificant, safetySignificanceRationale.

Safety significance rules:
- safetySignificant must be exactly one of: Yes or Needs Review. Never output No.
- Tag Yes when the generated row describes a credible path to harm involving people, operators, bystanders, mission-critical operation, environment, physical assets, security/safety controls, critical data integrity, or loss of control in the stated project context.
- Tag Needs Review when credible safety significance is not evident, including rows that appear to be routine reliability, developer experience, formatting, logging, non-critical latency, internal cleanup, recoverable behavior, ambiguous, insufficiently supported, or dependent on assumptions not present in the row/context.
- Do not change the hazard text or requirements. Only classify the row.
- Do not hardcode or assume any specific domain when context is absent.
- Base the rationale on the generated hazard/requirement text, functional decomposition row, traceability/source symbols/files, and project/operational context.

Rows to classify:
${JSON.stringify(tagItems.map(({ item, row }) => ({
  row: compactPromptItem(item, 180),
  generated: row,
})))}
  `.trim();

  const response = await fetchLLMResponse(prompt);
  return extractJsonArray(response);
}

async function tagSafetySignificanceForStandardRows(config, rows, items, contextOptions = {}) {
  if (!rows.length) return rows;

  contextOptions.onProgress?.({
    message: `Reviewing ${config.sheetName} rows for safety significance...`,
  });

  const taggedRows = [...rows];
  const tagItems = rows.map((row, index) => ({ row, item: items[index], index }));
  const tagChunks = chunkItemsByCount(tagItems, STANDARD_RETRY_ROWS_PER_PROMPT);
  for (let chunkIndex = 0; chunkIndex < tagChunks.length; chunkIndex += 1) {
    const tagChunk = tagChunks[chunkIndex];
    contextOptions.onProgress?.({
      message: `Reviewing safety significance (${chunkIndex + 1}/${tagChunks.length})...`,
      completed: chunkIndex,
      total: tagChunks.length,
    });
    try {
      const tags = await requestSafetySignificanceTags(config, tagChunk, contextOptions);
      const tagsById = generatedRowsById(tags);
      tagChunk.forEach(({ row, item, index }) => {
        const tag = generatedRowForItem(tagsById, tags, 0, item);
        taggedRows[index] = normalizeRow(config, {
          ...row,
          safetySignificant: normalizeSafetySignificance(tag?.safetySignificant),
          safetySignificanceRationale: sanitizeText(tag?.safetySignificanceRationale) || "Needs review: safety significance rationale was not generated.",
        }, item, index);
      });
    } catch (err) {
      console.warn(`⚠️ ${config.sheetName} safety significance review failed for chunk ${chunkIndex + 1}.`, err);
      tagChunk.forEach(({ row, item, index }) => {
        taggedRows[index] = normalizeRow(config, {
          ...row,
          safetySignificant: "Needs Review",
          safetySignificanceRationale: "Needs review: safety significance classification was not generated.",
        }, item, index);
      });
    }
  }

  contextOptions.onProgress?.({
    message: `${config.sheetName} safety significance review complete.`,
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
}) {
  const items = flattenDecomposition(sheets);
  if (!items.length) return sheets;

  const config = omitConsolidatedRequirement
    ? omitConsolidatedRequirementFromConfig(getStandardConfig(method))
    : getStandardConfig(method);
  const promptChunks = items.length <= STANDARD_MAX_ROWS_PER_PROMPT && compactPromptRowsLength(items) <= STANDARD_SINGLE_PROMPT_MAX_CHARS
    ? [items]
    : chunkItemsForPrompt(items);

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
        onProgress,
      });
      chunk.forEach((item, index) => {
        generatedRows[start + index] = chunkRows[index] || {};
      });
    } catch (err) {
      console.warn(`⚠️ ${config.sheetName} standard generation failed for chunk ${chunkIndex + 1}; using local fallback rows for that chunk.`, err);
      chunk.forEach((item, index) => {
        generatedRows[start + index] = fallbackRow(config, item, start + index);
      });
    }
    start += chunk.length;
  }

  let normalizedRows = items.map((item, index) => normalizeRow(config, generatedRows[index] || {}, item, index));
  normalizedRows = await repairGenericStandardRows(config, normalizedRows, items, {
    operationalContext,
    analysisContext,
    contextSources,
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
    onProgress: (patch) => onProgress({
      step: promptChunks.length + 1,
      total: promptChunks.length + 2,
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
