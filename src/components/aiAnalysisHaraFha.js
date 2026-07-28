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

function truncateForPrompt(value, maxChars = 120) {
  const text = sanitizeText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function compactFhaPromptItem(item = {}, maxChars = 120) {
  return [
    truncateForPrompt(item.id, 32),
    truncateForPrompt(item.from, maxChars),
    truncateForPrompt(item.controlAction, maxChars),
    truncateForPrompt(item.to, maxChars),
  ];
}

function compactFhaPromptRows(items = []) {
  const rowCharBudgets = [160, 120, 80, 48, 32];
  for (const maxChars of rowCharBudgets) {
    const rows = items.map((item) => compactFhaPromptItem(item, maxChars));
    const json = JSON.stringify(rows);
    if (json.length <= 240000 || maxChars === rowCharBudgets[rowCharBudgets.length - 1]) {
      return rows;
    }
  }
  return items.map((item) => compactFhaPromptItem(item, 32));
}

const FHA_SINGLE_PROMPT_MAX_CHARS = 80000;
const FHA_CHUNK_PROMPT_MAX_CHARS = 60000;

function compactFhaPromptRowsLength(items = []) {
  return JSON.stringify(compactFhaPromptRows(items)).length;
}

function chunkFhaItemsForPrompt(items = [], maxChars = FHA_CHUNK_PROMPT_MAX_CHARS) {
  const chunks = [];
  let current = [];

  items.forEach((item) => {
    const candidate = [...current, item];
    if (current.length && compactFhaPromptRowsLength(candidate) > maxChars) {
      chunks.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  });

  if (current.length) chunks.push(current);
  return chunks;
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

function fallbackHazardRow(item, index) {
  const action = item.controlAction || "the intended control action";
  const source = item.from || "source function";
  const target = item.to || "target function";
  return {
    id: `${item.id || `FD-${index + 1}`}-HZ`,
    itemFunction: `${source} provides ${action} to ${target}`,
    malfunction: `${action} is absent, incorrect, mistimed, or unintended while ${target} depends on it`,
    hazard: `${target} enters an unsafe state because ${action} does not match the required operating condition`,
    operationalSituation: `${target} is relying on ${source} for timely and correct ${action} during normal operation`,
    hazardousEvent: `${source} provides ${action} incorrectly, late, not at all, or when not needed, causing ${target} to act on an unsafe command or stale state`,
    harm: "Degraded or lost system control that could cause unsafe operation, mission loss, or user harm depending on the operating context",
  };
}

const FHA_SEVERITY_CATEGORIES = {
  1: "I - Catastrophic",
  2: "II - Critical",
  3: "III - Marginal",
  4: "IV - Negligible",
};

const FHA_SOFTWARE_CONTROL_CATEGORIES = {
  1: "1 - Autonomous (AT)",
  2: "2 - Semi-Autonomous (SAT)",
  3: "3 - Redundant Fault Tolerant (RFT)",
  4: "4 - Influential",
  5: "5 - No Safety Impact (NSI)",
};

const FHA_SWCI_MATRIX = {
  1: { 1: 1, 2: 1, 3: 3, 4: 4 },
  2: { 1: 1, 2: 2, 3: 3, 4: 4 },
  3: { 1: 2, 2: 3, 3: 4, 4: 4 },
  4: { 1: 3, 2: 4, 3: 4, 4: 4 },
  5: { 1: 5, 2: 5, 3: 5, 4: 5 },
};

const FHA_SWCI_LOR_TASKS = {
  1: "Analyze requirements, architecture, design, and code; conduct in-depth safety-specific testing.",
  2: "Analyze requirements, architecture, and design; conduct in-depth safety-specific testing.",
  3: "Analyze requirements and architecture; conduct in-depth safety-specific testing.",
  4: "Conduct safety-specific testing.",
  5: "No safety-specific analysis or verification required after safety engineering assesses no safety impact.",
};

const FHA_GENERATION_MODES = {
  STANDARD: "standard",
  DETAILED: "detailed",
};

const FHA_RATING_CONVENTIONS = `
Use these rating conventions:
- Severity categories: I - Catastrophic, II - Critical, III - Marginal, IV - Negligible.
- Software Control Categories:
  - 1 - Autonomous (AT): software exercises autonomous control authority over potentially safety-significant hardware/systems without predetermined safe detection and intervention.
  - 2 - Semi-Autonomous (SAT): software exercises control authority, but independent safety mechanisms or operator/control-entity actions can detect, mitigate, or control the hazard in time.
  - 3 - Redundant Fault Tolerant (RFT): software participates in safety-significant control with redundant/fault-tolerant design features.
  - 4 - Influential: software provides safety-related information used for decisions, but does not require immediate action to avoid a mishap.
  - 5 - No Safety Impact (NSI): software has no safety-significant command/control authority and does not provide time-sensitive safety-significant information.
- Software Safety Criticality Matrix:
  - SCC 1: Catastrophic SwCI 1, Critical SwCI 1, Marginal SwCI 3, Negligible SwCI 4.
  - SCC 2: Catastrophic SwCI 1, Critical SwCI 2, Marginal SwCI 3, Negligible SwCI 4.
  - SCC 3: Catastrophic SwCI 2, Critical SwCI 3, Marginal SwCI 4, Negligible SwCI 4.
  - SCC 4: Catastrophic SwCI 3, Critical SwCI 4, Marginal SwCI 4, Negligible SwCI 4.
  - SCC 5: SwCI 5 for all severity categories.
- Treat SwCI as a software criticality / level-of-rigor index, not a probability-based RAC or residual risk rating.
`.trim();

const FHA_CELL_FIELDS = [
  {
    fieldName: "functionName",
    fieldLabel: "Function",
    instructions: "Provide a concise description of the analyzed software function or interaction.",
  },
  {
    fieldName: "functionalDegradationOrLoss",
    fieldLabel: "Functional Degradation / Loss",
    instructions: "State the lost, degraded, incorrect, late, stale, conflicting, or unintended behavior plus the credible trigger or context.",
  },
  {
    fieldName: "hazard",
    fieldLabel: "Hazard",
    instructions: "Describe the unsafe intermediate system state caused by that degradation or loss.",
  },
  {
    fieldName: "effect",
    fieldLabel: "Effect",
    instructions: "Describe the causal chain from degradation or loss to local effect, system-level effect, and downstream consequence.",
  },
  {
    fieldName: "mishap",
    fieldLabel: "Mishap",
    instructions: "Describe the credible end consequence if controls fail.",
  },
  {
    fieldName: "severity",
    fieldLabel: "Severity Category",
    instructions: "Return exactly one of: I - Catastrophic, II - Critical, III - Marginal, IV - Negligible.",
  },
  {
    fieldName: "softwareControlCategory",
    fieldLabel: "Software Control Category",
    instructions: "Return exactly one of the Software Control Category labels from the rating conventions.",
  },
  { fieldName: "softwareCriticalityIndex", fieldLabel: "Software Criticality Index", local: true },
  { fieldName: "lorTasks", fieldLabel: "LOR Tasks", local: true },
  {
    fieldName: "causalFactors",
    fieldLabel: "Causal Factors",
    instructions: "Name concrete technical, data, timing, interface, human, or environmental contributors.",
  },
  {
    fieldName: "controls",
    fieldLabel: "Controls / Mitigations",
    instructions: "Provide tailored detection, prevention, or mitigation controls.",
  },
  {
    fieldName: "safetyRequirement",
    fieldLabel: "Software Safety Requirement",
    instructions: "Write one testable software safety requirement using the word shall.",
  },
  {
    fieldName: "verification",
    fieldLabel: "Verification",
    instructions: "Provide an analysis, inspection, simulation, or test approach tied to the control.",
  },
  {
    fieldName: "rationale",
    fieldLabel: "Rationale",
    instructions: "Give a concise explanation for the severity and Software Control Category choices.",
  },
];

const HARA_RATING_CONVENTIONS = `
Use these rating conventions:
- Severity: S0 no injuries, S1 light/moderate injuries, S2 severe/life-threatening survival probable, S3 life-threatening/fatal.
- Exposure: E0 incredible, E1 very low probability, E2 low, E3 medium, E4 high.
- Controllability: C0 controllable in general, C1 simply controllable, C2 normally controllable, C3 difficult/uncontrollable.
- ASIL: QM, ASIL A, ASIL B, ASIL C, or ASIL D, consistent with the S/E/C combination and conservative safety practice.
`.trim();

const HARA_CELL_FIELDS = [
  {
    fieldName: "itemFunction",
    fieldLabel: "Item / Function",
    instructions: "Provide a concise description of the analyzed item, software function, or interaction.",
  },
  {
    fieldName: "malfunction",
    fieldLabel: "Malfunction",
    instructions: "Name the initiating failure condition, such as missing, late, early, wrong, stale, conflicting, intermittent, or unintended control behavior.",
  },
  {
    fieldName: "hazard",
    fieldLabel: "Hazard",
    instructions: "Describe the unsafe system state that results from the malfunction.",
  },
  {
    fieldName: "operationalSituation",
    fieldLabel: "Operational Situation",
    instructions: "State when or under what operating condition the malfunction becomes safety-relevant.",
  },
  {
    fieldName: "hazardousEvent",
    fieldLabel: "Hazardous Event",
    instructions: "Connect the malfunction, operating condition, unsafe state, and credible consequence in one causal sentence.",
  },
  {
    fieldName: "harm",
    fieldLabel: "Potential Harm",
    instructions: "Describe the plausible end effect on people, mission, environment, asset, data, or trust.",
  },
  {
    fieldName: "severity",
    fieldLabel: "Severity",
    instructions: "Return one HARA severity label: S0, S1, S2, or S3, with a short descriptor if useful.",
  },
  {
    fieldName: "exposure",
    fieldLabel: "Exposure",
    instructions: "Return one HARA exposure label: E0, E1, E2, E3, or E4, with a short descriptor if useful.",
  },
  {
    fieldName: "controllability",
    fieldLabel: "Controllability",
    instructions: "Return one HARA controllability label: C0, C1, C2, or C3, with a short descriptor if useful.",
  },
  {
    fieldName: "asil",
    fieldLabel: "ASIL",
    instructions: "Return one ASIL value: QM, ASIL A, ASIL B, ASIL C, or ASIL D.",
  },
  {
    fieldName: "safetyGoal",
    fieldLabel: "Safety Goal",
    instructions: "Write one concise safety goal using the word shall.",
  },
  {
    fieldName: "rationale",
    fieldLabel: "Rationale",
    instructions: "Explain concisely why the S/E/C ratings and ASIL match the hazardous event.",
  },
];

function parseFhaSeverityCategory(value) {
  const text = sanitizeText(value).toLowerCase();
  if (/\bcatastrophic\b|\bcategory\s*1\b|\bcat\s*1\b|^\s*i\s*(?:-|$)/i.test(text)) return 1;
  if (/\bcritical\b|\bcategory\s*2\b|\bcat\s*2\b|^\s*ii\s*(?:-|$)/i.test(text)) return 2;
  if (/\bmarginal\b|\bcategory\s*3\b|\bcat\s*3\b|^\s*iii\s*(?:-|$)/i.test(text)) return 3;
  if (/\bnegligible\b|\bcategory\s*4\b|\bcat\s*4\b|^\s*iv\s*(?:-|$)/i.test(text)) return 4;
  const number = Number(String(value || "").match(/[1-4]/)?.[0]);
  return number || 2;
}

function parseFhaSoftwareControlCategory(value) {
  const text = sanitizeText(value).toLowerCase();
  if (/\bno\s+safety\s+impact\b|\bnsi\b/.test(text)) return 5;
  if (/\binfluential\b/.test(text)) return 4;
  if (/\bredundant\b|\bfault\s*tolerant\b|\brft\b/.test(text)) return 3;
  if (/\bsemi[-\s]?autonomous\b|\bsat\b/.test(text)) return 2;
  if (/\bautonomous\b|\bat\b/.test(text)) return 1;
  const number = Number(String(value || "").match(/[1-5]/)?.[0]);
  return number || 2;
}

function deriveFhaSwci(severityCategory, softwareControlCategory) {
  return FHA_SWCI_MATRIX[softwareControlCategory]?.[severityCategory] || 2;
}

function normalizeHaraRow(row, item, index) {
  const base = fallbackHazardRow(item, index);
  return {
    id: sanitizeText(row.id) || base.id,
    itemFunction: sanitizeText(row.itemFunction) || base.itemFunction,
    malfunction: sanitizeText(row.malfunction) || base.malfunction,
    hazard: sanitizeText(row.hazard) || base.hazard,
    operationalSituation: sanitizeText(row.operationalSituation) || base.operationalSituation,
    hazardousEvent: sanitizeText(row.hazardousEvent) || base.hazardousEvent,
    harm: sanitizeText(row.harm) || base.harm,
    severity: sanitizeText(row.severity) || "S2",
    exposure: sanitizeText(row.exposure) || "E3",
    controllability: sanitizeText(row.controllability) || "C2",
    asil: sanitizeText(row.asil) || "ASIL B",
    safetyGoal: sanitizeText(row.safetyGoal) || `The system shall prevent or control ${base.hazard.toLowerCase()}.`,
    rationale: sanitizeText(row.rationale) || "Ratings are based on the stated hazardous event and operating context.",
  };
}

function normalizeFhaRow(row, item, index) {
  const base = fallbackHazardRow(item, index);
  const severityCategory = parseFhaSeverityCategory(row.severityCategory || row.severity);
  const softwareControlCategory = parseFhaSoftwareControlCategory(
    row.softwareControlCategory || row.controlCategory || row.scc
  );
  const swci = deriveFhaSwci(severityCategory, softwareControlCategory);
  return {
    id: sanitizeText(row.id) || base.id,
    functionName: sanitizeText(row.functionName) || base.itemFunction,
    functionalDegradationOrLoss: sanitizeText(row.functionalDegradationOrLoss || row.failureCondition) || base.malfunction,
    hazard: sanitizeText(row.hazard) || base.hazard,
    mishap: sanitizeText(row.mishap) || base.harm,
    effect: sanitizeText(row.effect) || base.hazardousEvent,
    severity: FHA_SEVERITY_CATEGORIES[severityCategory],
    softwareControlCategory: FHA_SOFTWARE_CONTROL_CATEGORIES[softwareControlCategory],
    softwareCriticalityIndex: `SwCI ${swci}`,
    lorTasks: sanitizeText(row.lorTasks) || FHA_SWCI_LOR_TASKS[swci],
    causalFactors: sanitizeText(row.causalFactors) || "Faulty input, delayed control, incorrect state, or operator/system interface mismatch",
    controls: sanitizeText(row.controls) || `Provide controls that detect, prevent, or mitigate ${base.hazard.toLowerCase()}.`,
    safetyRequirement: sanitizeText(row.safetyRequirement) || `The software shall detect, prevent, or mitigate ${base.hazard.toLowerCase()} before it can produce a mishap.`,
    verification: sanitizeText(row.verification) || "Analysis, inspection, simulation, or test of the credited control.",
    rationale: sanitizeText(row.rationale) || "Severity reflects the credible mishap consequence; software control category reflects the degree of software authority over the safety-significant function.",
  };
}

async function requestHaraRows(items) {
  const prompt = `
You are performing a textbook Hazard Analysis and Risk Assessment (HARA) in the style used for ISO 26262 item-level safety analysis.

Use these rating conventions:
- Severity: S0 no injuries, S1 light/moderate injuries, S2 severe/life-threatening survival probable, S3 life-threatening/fatal.
- Exposure: E0 incredible, E1 very low probability, E2 low, E3 medium, E4 high.
- Controllability: C0 controllable in general, C1 simply controllable, C2 normally controllable, C3 difficult/uncontrollable.
- ASIL: QM, ASIL A, ASIL B, ASIL C, or ASIL D, consistent with the S/E/C combination and conservative safety practice.

For each functional decomposition row, identify one credible hazardous event. Be specific about how the hazard happens and what effect it may produce:
- Malfunction must name the initiating failure condition, such as missing, late, early, wrong, stale, conflicting, intermittent, or unintended control behavior.
- Hazard must describe the unsafe system state that results, not just a generic "loss" label.
- Operational situation must say when or under what operating condition the malfunction becomes safety-relevant.
- Hazardous event must connect the sequence in words, such as "the initiating failure affects the function or state, which then creates the unsafe outcome."
- Harm must describe the plausible end effect on people, mission, environment, asset, data, or trust.
- Rationale must explain why the S/E/C ratings match that scenario.
- Avoid vague phrases such as "unsafe behavior", "system failure", or "loss of safety" unless you add the concrete mechanism and consequence.
- Do not use arrow notation or arrow-like symbols in any field. Use words such as "which causes", "which leads to", "resulting in", or "then" instead.

Return ONLY a JSON array. Each object must include:
id, itemFunction, malfunction, hazard, operationalSituation, hazardousEvent, harm, severity, exposure, controllability, asil, safetyGoal, rationale.

Functional decomposition rows are compact JSON arrays in this order:
[id, functionFrom, controlAction, functionTo]

Rows:
${JSON.stringify(compactFhaPromptRows(items))}
  `.trim();

  const response = await fetchLLMResponse(prompt);
  return extractJsonArray(response);
}

async function requestFhaRows(items) {
  const prompt = `
You are performing a MIL-STD-882E-style Functional Hazard Analysis (FHA) for software safety.

The FHA intent is to identify credible functional degradation or loss scenarios and determine the Software Criticality Index (SwCI) from:
1. the mishap severity category of the degradation or loss, and
2. the Software Control Category (SCC), meaning the degree of software control over the safety-significant function.

Use these rating conventions:
- Severity categories: I - Catastrophic, II - Critical, III - Marginal, IV - Negligible.
- Software Control Categories:
  - 1 - Autonomous (AT): software exercises autonomous control authority over potentially safety-significant hardware/systems without predetermined safe detection and intervention.
  - 2 - Semi-Autonomous (SAT): software exercises control authority, but independent safety mechanisms or operator/control-entity actions can detect, mitigate, or control the hazard in time.
  - 3 - Redundant Fault Tolerant (RFT): software participates in safety-significant control with redundant/fault-tolerant design features.
  - 4 - Influential: software provides safety-related information used for decisions, but does not require immediate action to avoid a mishap.
  - 5 - No Safety Impact (NSI): software has no safety-significant command/control authority and does not provide time-sensitive safety-significant information.
- Software Safety Criticality Matrix:
  - SCC 1: Catastrophic SwCI 1, Critical SwCI 1, Marginal SwCI 3, Negligible SwCI 4.
  - SCC 2: Catastrophic SwCI 1, Critical SwCI 2, Marginal SwCI 3, Negligible SwCI 4.
  - SCC 3: Catastrophic SwCI 2, Critical SwCI 3, Marginal SwCI 4, Negligible SwCI 4.
  - SCC 4: Catastrophic SwCI 3, Critical SwCI 4, Marginal SwCI 4, Negligible SwCI 4.
  - SCC 5: SwCI 5 for all severity categories.
- Treat SwCI as a software criticality / level-of-rigor index, not a probability-based RAC or residual risk rating.

For each functional decomposition row, identify one credible functional degradation or loss and its hazard/mishap consequence. Be specific about how the hazard happens and what effect it may produce:
- Functional degradation or loss must state the lost, degraded, incorrect, late, stale, conflicting, or unintended behavior and the trigger/context that makes it credible.
- Hazard must state the unsafe intermediate system state created by that failure condition.
- Effect must describe the causal chain from functional degradation/loss to local effect, system-level effect, and possible downstream consequence.
- Mishap must describe the credible end consequence if controls fail.
- Severity must classify the mishap consequence, not the likelihood.
- Software Control Category must classify software's role/control authority in the degraded or lost function.
- Software Criticality Index must be consistent with the severity and software control category matrix above.
- Causal factors must name plausible technical, human, data, timing, interface, or environmental contributors.
- Controls, safety requirement, and verification must be tailored to that causal chain.
- Avoid generic phrases such as "component failure", "incorrect output", or "system damage" unless you add the concrete mechanism and consequence.
- Do not use arrow notation or arrow-like symbols in any field. Use words such as "which causes", "which leads to", "resulting in", or "then" instead.

Return ONLY a JSON array. Each object must include:
id, functionName, functionalDegradationOrLoss, hazard, mishap, effect, severity, softwareControlCategory, softwareCriticalityIndex, lorTasks, causalFactors, controls, safetyRequirement, verification, rationale.

Functional decomposition rows are compact JSON arrays in this order:
[id, functionFrom, controlAction, functionTo]

Rows:
${JSON.stringify(compactFhaPromptRows(items))}
  `.trim();

  const response = await fetchLLMResponse(prompt);
  return extractJsonArray(response);
}

function normalizeFhaGenerationMode(mode) {
  return mode === FHA_GENERATION_MODES.DETAILED ? FHA_GENERATION_MODES.DETAILED : FHA_GENERATION_MODES.STANDARD;
}

function fallbackHaraField(fieldName, rowDraft, item, index) {
  const normalized = normalizeHaraRow(rowDraft || {}, item, index);
  return normalized[fieldName] || "";
}

function normalizeHaraPartialRow(rowDraft, item, index) {
  const normalized = normalizeHaraRow(rowDraft || {}, item, index);
  const partial = { id: normalized.id };
  HARA_CELL_FIELDS.forEach(({ fieldName }) => {
    partial[fieldName] = Object.prototype.hasOwnProperty.call(rowDraft || {}, fieldName)
      ? normalized[fieldName]
      : "";
  });
  return partial;
}

async function requestHaraCell({ item, rowDraft, fieldName, fieldLabel, instructions }) {
  const prompt = `
You are performing a textbook Hazard Analysis and Risk Assessment (HARA) in the style used for ISO 26262 item-level safety analysis.

${HARA_RATING_CONVENTIONS}

Current functional decomposition row:
${JSON.stringify({
  id: item.id,
  from: truncateForPrompt(item.from, 240),
  controlAction: truncateForPrompt(item.controlAction, 240),
  to: truncateForPrompt(item.to, 240),
}, null, 2)}

Already generated HARA cells for this row:
${JSON.stringify(rowDraft || {}, null, 2)}

Requested field: ${fieldLabel} (${fieldName})
Instructions: ${instructions}

Return only the cell value as plain text. Do not return JSON, markdown, labels, quotes, bullets, or commentary.
  `.trim();

  const response = await fetchLLMResponse(prompt);
  return sanitizeText(response);
}

async function generateHaraRowCellByCell(item, index, onCellUpdate = () => {}) {
  const rowDraft = {
    id: `${item.id || `FD-${index + 1}`}-HARA`,
  };

  try {
    for (const field of HARA_CELL_FIELDS) {
      try {
        const value = await requestHaraCell({
          item,
          rowDraft,
          fieldName: field.fieldName,
          fieldLabel: field.fieldLabel,
          instructions: field.instructions,
        });
        rowDraft[field.fieldName] = value || fallbackHaraField(field.fieldName, rowDraft, item, index);
      } catch (err) {
        console.warn(`⚠️ HARA cell generation failed for ${item.id || `FD-${index + 1}`} ${field.fieldName}; using fallback.`, err);
        rowDraft[field.fieldName] = fallbackHaraField(field.fieldName, rowDraft, item, index);
      }

      await onCellUpdate({ ...rowDraft });
    }
  } catch (err) {
    console.warn(`⚠️ HARA row generation failed for ${item.id || `FD-${index + 1}`}; using fallback row.`, err);
    return normalizeHaraRow({}, item, index);
  }

  return normalizeHaraRow(rowDraft, item, index);
}

function deriveFhaRowCriticalityFields(rowDraft) {
  const severityCategory = parseFhaSeverityCategory(rowDraft.severity);
  const softwareControlCategory = parseFhaSoftwareControlCategory(rowDraft.softwareControlCategory);
  const swci = deriveFhaSwci(severityCategory, softwareControlCategory);
  return {
    softwareCriticalityIndex: `SwCI ${swci}`,
    lorTasks: FHA_SWCI_LOR_TASKS[swci],
  };
}

function fallbackFhaField(fieldName, rowDraft, item, index) {
  const normalized = normalizeFhaRow(rowDraft || {}, item, index);
  return normalized[fieldName] || "";
}

function normalizeFhaPartialRow(rowDraft, item, index) {
  const normalized = normalizeFhaRow(rowDraft || {}, item, index);
  const partial = { id: normalized.id };
  FHA_CELL_FIELDS.forEach(({ fieldName }) => {
    partial[fieldName] = Object.prototype.hasOwnProperty.call(rowDraft || {}, fieldName)
      ? normalized[fieldName]
      : "";
  });
  return partial;
}

async function requestFhaCell({ item, rowDraft, fieldName, fieldLabel, instructions }) {
  const prompt = `
You are performing a MIL-STD-882E-style Functional Hazard Analysis (FHA) for software safety.

The FHA intent is to identify credible functional degradation or loss scenarios and determine the Software Criticality Index (SwCI) from:
1. the mishap severity category of the degradation or loss, and
2. the Software Control Category (SCC), meaning the degree of software control over the safety-significant function.

${FHA_RATING_CONVENTIONS}

Current functional decomposition row:
${JSON.stringify({
  id: item.id,
  from: truncateForPrompt(item.from, 240),
  controlAction: truncateForPrompt(item.controlAction, 240),
  to: truncateForPrompt(item.to, 240),
}, null, 2)}

Already generated FHA cells for this row:
${JSON.stringify(rowDraft || {}, null, 2)}

Requested field: ${fieldLabel} (${fieldName})
Instructions: ${instructions}

Return only the cell value as plain text. Do not return JSON, markdown, labels, quotes, bullets, or commentary.
  `.trim();

  const response = await fetchLLMResponse(prompt);
  return sanitizeText(response);
}

async function generateFhaRowCellByCell(item, index, onCellUpdate = () => {}) {
  const rowDraft = {
    id: `${item.id || `FD-${index + 1}`}-FHA`,
  };

  try {
    for (const field of FHA_CELL_FIELDS) {
      if (field.local) {
        const derived = deriveFhaRowCriticalityFields(rowDraft);
        rowDraft[field.fieldName] = derived[field.fieldName] || fallbackFhaField(field.fieldName, rowDraft, item, index);
        await onCellUpdate({ ...rowDraft });
        continue;
      }

      try {
        const value = await requestFhaCell({
          item,
          rowDraft,
          fieldName: field.fieldName,
          fieldLabel: field.fieldLabel,
          instructions: field.instructions,
        });
        rowDraft[field.fieldName] = value || fallbackFhaField(field.fieldName, rowDraft, item, index);
      } catch (err) {
        console.warn(`⚠️ FHA cell generation failed for ${item.id || `FD-${index + 1}`} ${field.fieldName}; using fallback.`, err);
        rowDraft[field.fieldName] = fallbackFhaField(field.fieldName, rowDraft, item, index);
      }

      if (field.fieldName === "severity" || field.fieldName === "softwareControlCategory") {
        const derived = deriveFhaRowCriticalityFields(rowDraft);
        rowDraft.softwareCriticalityIndex = derived.softwareCriticalityIndex;
        rowDraft.lorTasks = derived.lorTasks;
      }

      await onCellUpdate({ ...rowDraft });
    }
  } catch (err) {
    console.warn(`⚠️ FHA row generation failed for ${item.id || `FD-${index + 1}`}; using fallback row.`, err);
    return normalizeFhaRow({}, item, index);
  }

  return normalizeFhaRow(rowDraft, item, index);
}

const FHA_SHEET_HEADERS = [
  "FHA ID",
  "Function",
  "Functional Degradation / Loss",
  "Hazard",
  "Mishap",
  "Effect",
  "Severity Category",
  "Software Control Category",
  "Software Criticality Index",
  "LOR Tasks",
  "Causal Factors",
  "Controls / Mitigations",
  "Software Safety Requirement",
  "Verification",
  "Rationale",
  ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS,
];

const FHA_SUMMARY_HEADERS = [
  ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS,
  "Function",
  "Functional Degradation / Loss",
  "Hazard",
  "Mishap",
  "Effect",
  "Severity Category",
  "Software Control Category",
  "Software Criticality Index",
  "LOR Tasks",
  "Causal Factors",
  "Mitigation Strategy",
  "Software Safety Requirement",
  "Verification",
  "Rationale",
];

function buildFhaAnalysisSheets(normalizedRows, items) {
  const fhaSheet = [
    FHA_SHEET_HEADERS,
    ...normalizedRows.map((row, index) => [
      row.id,
      row.functionName,
      row.functionalDegradationOrLoss,
      row.hazard,
      row.mishap,
      row.effect,
      row.severity,
      row.softwareControlCategory,
      row.softwareCriticalityIndex,
      row.lorTasks,
      row.causalFactors,
      row.controls,
      row.safetyRequirement,
      row.verification,
      row.rationale,
      ...traceabilityToSheetCells(items[index]?.traceability || {}),
    ]),
  ];

  const summary = [
    FHA_SUMMARY_HEADERS,
    ...normalizedRows.map((row, index) => {
      const traceFields = traceabilityObjectToSummaryFields(items[index]?.traceability || {});
      return [
        ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS.map((column) => traceFields[column] || ""),
        row.functionName,
        row.functionalDegradationOrLoss,
        row.hazard,
        row.mishap,
        row.effect,
        row.severity,
        row.softwareControlCategory,
        row.softwareCriticalityIndex,
        row.lorTasks,
        row.causalFactors,
        row.controls,
        row.safetyRequirement,
        row.verification,
        row.rationale,
      ];
    }),
  ];

  return { FHA: fhaSheet, Summary: summary };
}

async function saveFhaAnalysisSheets({ sheets, setFolders, currentFolder, normalizedRows, items }) {
  return saveSheets({
    sheets,
    setFolders,
    currentFolder,
    additions: buildFhaAnalysisSheets(normalizedRows, items),
  });
}

const HARA_SHEET_HEADERS = [
  "HARA ID",
  "Item / Function",
  "Malfunction",
  "Hazard",
  "Operational Situation",
  "Hazardous Event",
  "Potential Harm",
  "Severity",
  "Exposure",
  "Controllability",
  "ASIL",
  "Safety Goal",
  "Rationale",
  ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS,
];

const HARA_SUMMARY_HEADERS = [
  ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS,
  "Item / Function",
  "Loss",
  "Hazard",
  "Hazardous Event",
  "Malfunction",
  "Severity",
  "Exposure",
  "Controllability",
  "ASIL",
  "Safety Goal",
  "Rationale",
];

function buildHaraAnalysisSheets(normalizedRows, items) {
  const haraSheet = [
    HARA_SHEET_HEADERS,
    ...normalizedRows.map((row, index) => [
      row.id,
      row.itemFunction,
      row.malfunction,
      row.hazard,
      row.operationalSituation,
      row.hazardousEvent,
      row.harm,
      row.severity,
      row.exposure,
      row.controllability,
      row.asil,
      row.safetyGoal,
      row.rationale,
      ...traceabilityToSheetCells(items[index]?.traceability || {}),
    ]),
  ];

  const summary = [
    HARA_SUMMARY_HEADERS,
    ...normalizedRows.map((row, index) => {
      const traceFields = traceabilityObjectToSummaryFields(items[index]?.traceability || {});
      return [
        ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS.map((column) => traceFields[column] || ""),
        row.itemFunction,
        row.harm,
        row.hazard,
        row.hazardousEvent,
        row.malfunction,
        row.severity,
        row.exposure,
        row.controllability,
        row.asil,
        row.safetyGoal,
        row.rationale,
      ];
    }),
  ];

  return { HARA: haraSheet, Summary: summary };
}

async function saveHaraAnalysisSheets({ sheets, setFolders, currentFolder, normalizedRows, items }) {
  return saveSheets({
    sheets,
    setFolders,
    currentFolder,
    additions: buildHaraAnalysisSheets(normalizedRows, items),
  });
}

export async function generateHaraAnalysisSheets({
  sheets,
  setFolders,
  currentFolder,
  haraGenerationMode = FHA_GENERATION_MODES.STANDARD,
}) {
  const items = flattenDecomposition(sheets);
  if (!items.length) return sheets;

  const mode = normalizeFhaGenerationMode(haraGenerationMode);

  if (mode === FHA_GENERATION_MODES.STANDARD) {
    const promptChunks = compactFhaPromptRowsLength(items) <= FHA_SINGLE_PROMPT_MAX_CHARS
      ? [items]
      : chunkFhaItemsForPrompt(items);
    if (promptChunks.length > 1) {
      console.warn(`⚠️ HARA standard input is large; using ${promptChunks.length} bulk prompt chunks instead of one prompt.`);
    }

    const generatedRows = [];
    for (let start = 0, chunkIndex = 0; chunkIndex < promptChunks.length; chunkIndex += 1) {
      const chunk = promptChunks[chunkIndex];
      try {
        const chunkRows = await requestHaraRows(chunk);
        chunk.forEach((item, index) => {
          generatedRows[start + index] = chunkRows[index] || {};
        });
      } catch (err) {
        console.warn(`⚠️ HARA generation failed for standard chunk ${chunkIndex + 1}; using local fallback rows for that chunk.`, err);
        chunk.forEach((item, index) => {
          generatedRows[start + index] = fallbackHazardRow(item, start + index);
        });
      }
      start += chunk.length;
    }

    const normalizedRows = items.map((item, index) => normalizeHaraRow(generatedRows[index] || {}, item, index));
    return saveHaraAnalysisSheets({ sheets, setFolders, currentFolder, normalizedRows, items });
  }

  const normalizedRows = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    try {
      normalizedRows[index] = await generateHaraRowCellByCell(item, index, async (rowDraft) => {
        normalizedRows[index] = normalizeHaraPartialRow(rowDraft, item, index);
        await saveHaraAnalysisSheets({
          sheets,
          setFolders,
          currentFolder,
          normalizedRows: normalizedRows.filter(Boolean),
          items,
        });
      });
    } catch (err) {
      console.warn(`⚠️ HARA detailed row failed for ${item.id || `FD-${index + 1}`}; using fallback row.`, err);
      normalizedRows[index] = normalizeHaraRow({}, item, index);
    }

    await saveHaraAnalysisSheets({
      sheets,
      setFolders,
      currentFolder,
      normalizedRows: normalizedRows.filter(Boolean),
      items,
    });
  }

  const finalRows = items.map((item, index) => normalizedRows[index] || normalizeHaraRow({}, item, index));
  return saveHaraAnalysisSheets({ sheets, setFolders, currentFolder, normalizedRows: finalRows, items });
}

export async function generateFhaAnalysisSheets({
  sheets,
  setFolders,
  currentFolder,
  fhaGenerationMode = FHA_GENERATION_MODES.STANDARD,
}) {
  const items = flattenDecomposition(sheets);
  if (!items.length) return sheets;

  const mode = normalizeFhaGenerationMode(fhaGenerationMode);

  if (mode === FHA_GENERATION_MODES.STANDARD) {
    const promptChunks = compactFhaPromptRowsLength(items) <= FHA_SINGLE_PROMPT_MAX_CHARS
      ? [items]
      : chunkFhaItemsForPrompt(items);
    if (promptChunks.length > 1) {
      console.warn(`⚠️ FHA standard input is large; using ${promptChunks.length} bulk prompt chunks instead of one prompt.`);
    }

    const generatedRows = [];
    for (let start = 0, chunkIndex = 0; chunkIndex < promptChunks.length; chunkIndex += 1) {
      const chunk = promptChunks[chunkIndex];
      try {
        const chunkRows = await requestFhaRows(chunk);
        chunk.forEach((item, index) => {
          generatedRows[start + index] = chunkRows[index] || {};
        });
      } catch (err) {
        console.warn(`⚠️ FHA generation failed for standard chunk ${chunkIndex + 1}; using local fallback rows for that chunk.`, err);
        chunk.forEach((item, index) => {
          generatedRows[start + index] = fallbackHazardRow(item, start + index);
        });
      }
      start += chunk.length;
    }

    const normalizedRows = items.map((item, index) => normalizeFhaRow(generatedRows[index] || {}, item, index));
    return saveFhaAnalysisSheets({ sheets, setFolders, currentFolder, normalizedRows, items });
  }

  const normalizedRows = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    try {
      normalizedRows[index] = await generateFhaRowCellByCell(item, index, async (rowDraft) => {
        normalizedRows[index] = normalizeFhaPartialRow(rowDraft, item, index);
        await saveFhaAnalysisSheets({
          sheets,
          setFolders,
          currentFolder,
          normalizedRows: normalizedRows.filter(Boolean),
          items,
        });
      });
    } catch (err) {
      console.warn(`⚠️ FHA detailed row failed for ${item.id || `FD-${index + 1}`}; using fallback row.`, err);
      normalizedRows[index] = normalizeFhaRow({}, item, index);
    }

    await saveFhaAnalysisSheets({
      sheets,
      setFolders,
      currentFolder,
      normalizedRows: normalizedRows.filter(Boolean),
      items,
    });
  }

  const finalRows = items.map((item, index) => normalizedRows[index] || normalizeFhaRow({}, item, index));
  return saveFhaAnalysisSheets({ sheets, setFolders, currentFolder, normalizedRows: finalRows, items });
}
