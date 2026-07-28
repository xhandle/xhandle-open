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
  return [
    truncateForPrompt(item.id, 32),
    truncateForPrompt(item.from, maxChars),
    truncateForPrompt(item.controlAction, maxChars),
    truncateForPrompt(item.to, maxChars),
  ];
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

function compactPromptRowsLength(items = []) {
  return JSON.stringify(compactPromptRows(items)).length;
}

function chunkItemsForPrompt(items = [], maxChars = STANDARD_CHUNK_PROMPT_MAX_CHARS) {
  const chunks = [];
  let current = [];

  items.forEach((item) => {
    const candidate = [...current, item];
    if (current.length && compactPromptRowsLength(candidate) > maxChars) {
      chunks.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  });

  if (current.length) chunks.push(current);
  return chunks;
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
- Hazard must describe the unsafe state created by the failure mode.
- Failure mode must name the missing, incorrect, late, stale, unintended, conflicting, or intermittent behavior.
- Causal factor must name concrete technical, data, timing, interface, human, or environmental contributors.
- Mitigation, system requirement, and consolidated requirement must be tailored and testable.
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
- Hazard must describe the unsafe impact category or state created by the scenario.
- What-if scenario must be phrased as a concrete "What if..." question.
- Causal factor must name concrete technical, data, timing, interface, human, or environmental contributors.
- Mitigation, system requirement, and consolidated requirement must be tailored and testable.
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
- Hazards must describe unsafe system states, not generic failures.
- Unsafe control action must name whether the action is missing, provided incorrectly, provided too early or late, stopped too soon, applied too long, or provided when not needed.
- Causal factors must name concrete technical, data, timing, interface, human, or environmental contributors.
- Safety requirement or constraint must be tailored and testable.
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

function fallbackRow(config, item, index) {
  const action = item.controlAction || "the intended control action";
  const source = item.from || "source function";
  const target = item.to || "target function";
  const common = {
    id: `${item.id || `FD-${index + 1}`}-${config.rowIdSuffix}`,
    loss: `Loss of safe or reliable operation involving ${target}`,
    losses: `Loss of safe or reliable operation involving ${target}`,
    hazard: `${target} enters an unsafe state because ${action} from ${source} is absent, incorrect, late, stale, or unintended`,
    hazards: `${target} enters an unsafe state because ${action} from ${source} is absent, incorrect, late, stale, or unintended`,
    causalFactor: `Faulty input, delayed control, incorrect state, or interface mismatch affecting ${action}`,
    causalFactors: `Faulty input, delayed control, incorrect state, or interface mismatch affecting ${action}`,
    mitigationStrategy: `Detect, reject, or mitigate unsafe ${action} before ${target} acts on it`,
    systemRequirement: `The software shall detect and mitigate unsafe ${action} before ${target} can enter a hazardous state.`,
    consolidatedRequirement: `The software shall maintain safe ${source} to ${target} control behavior for ${action}.`,
    safetyRequirementsConstraints: `The software shall prevent unsafe ${action} from causing ${target} to enter a hazardous state.`,
    failureMode: `${action} is missing, incorrect, late, stale, conflicting, or unintended`,
    whatIfScenario: `What if ${source} provides ${action} to ${target} incorrectly, late, or when not needed?`,
    unsafeControlActions: `${source} provides ${action} to ${target} when not safe, too late, not at all, or for too long`,
  };
  return common;
}

function normalizeRow(config, row, item, index) {
  const base = fallbackRow(config, item, index);
  const normalized = {
    id: sanitizeText(row.id) || base.id,
  };
  config.fields.forEach(([fieldName]) => {
    normalized[fieldName] = sanitizeText(row[fieldName]) || base[fieldName] || "";
  });
  return normalized;
}

async function requestStandardRows(config, items) {
  const fieldNames = ["id", ...config.fields.map(([fieldName]) => fieldName)];
  const prompt = `
You are performing ${config.analysisName} for software safety using a code-based functional decomposition.

${config.promptGuidance}

Do not use arrow notation or arrow-like symbols in any field. Use words such as "which causes", "which leads to", "resulting in", or "then" instead.

Return ONLY a JSON array. Each object must include:
${fieldNames.join(", ")}.

Functional decomposition rows are compact JSON arrays in this order:
[id, functionFrom, controlAction, functionTo]

Rows:
${JSON.stringify(compactPromptRows(items))}
  `.trim();

  const response = await fetchLLMResponse(prompt);
  return extractJsonArray(response);
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
      ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS,
    ],
    ...rows.map((row, index) => [
      row.id,
      ...config.fields.map(([fieldName]) => row[fieldName] || ""),
      ...traceabilityToSheetCells(items[index]?.traceability || {}),
    ]),
  ];

  const summary = [
    [
      ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS,
      ...config.fields.map(([, label]) => label),
    ],
    ...rows.map((row, index) => {
      const traceFields = traceabilityObjectToSummaryFields(items[index]?.traceability || {});
      return [
        ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS.map((column) => traceFields[column] || ""),
        ...config.fields.map(([fieldName]) => row[fieldName] || ""),
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
}) {
  const items = flattenDecomposition(sheets);
  if (!items.length) return sheets;

  const config = getStandardConfig(method);
  const promptChunks = compactPromptRowsLength(items) <= STANDARD_SINGLE_PROMPT_MAX_CHARS
    ? [items]
    : chunkItemsForPrompt(items);

  if (promptChunks.length > 1) {
    console.warn(`⚠️ ${config.sheetName} standard input is large; using ${promptChunks.length} bulk prompt chunks instead of one prompt.`);
  }

  const generatedRows = [];
  for (let start = 0, chunkIndex = 0; chunkIndex < promptChunks.length; chunkIndex += 1) {
    const chunk = promptChunks[chunkIndex];
    try {
      const chunkRows = await requestStandardRows(config, chunk);
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

  const normalizedRows = items.map((item, index) => normalizeRow(config, generatedRows[index] || {}, item, index));
  return saveSheets({
    sheets,
    setFolders,
    currentFolder,
    additions: buildStandardSheets(config, normalizedRows, items),
  });
}
