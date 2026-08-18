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
const FHA_MAX_ROWS_PER_PROMPT = 10;
const FHA_RETRY_ROWS_PER_PROMPT = 4;
const FHA_MISSING_ROW_RETRIES = 2;
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
const HARA_REPAIR_FIELDS = ["malfunction", "hazard", "hazardousEvent", "harm", "safetyGoal", "rationale"];
const FHA_REPAIR_FIELDS = [
  "functionalDegradationOrLoss",
  "hazard",
  "mishap",
  "effect",
  "causalFactors",
  "controls",
  "safetyRequirement",
  "verification",
  "rationale",
];
const CONCRETE_CAUSAL_CHAIN_GUIDANCE = `
Concrete causal-chain quality:
- Hazard, hazardous event, effect, mishap, degradation, and causal-factor wording must include a specific failure condition, local effect, system-level effect, and plausible consequence.
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

function compactFhaPromptRowsLength(items = []) {
  return JSON.stringify(compactFhaPromptRows(items)).length;
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

function chunkFhaItemsForPrompt(items = [], maxChars = FHA_CHUNK_PROMPT_MAX_CHARS) {
  const chunks = [];
  let current = [];

  items.forEach((item) => {
    const candidate = [...current, item];
    if (current.length && (candidate.length > FHA_MAX_ROWS_PER_PROMPT || compactFhaPromptRowsLength(candidate) > maxChars)) {
      chunks.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  });

  if (current.length) chunks.push(current);
  return chunks;
}

function chunkFhaItemsByCount(items = [], size = FHA_RETRY_ROWS_PER_PROMPT) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
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
  const source = item.from || "source function";
  const action = item.controlAction || "the intended control action";
  const target = item.to || "target function";
  return {
    id: `${item.id || `FD-${index + 1}`}-HZ`,
    itemFunction: `${source} provides ${action} to ${target}`,
    functionName: `${source} provides ${action} to ${target}`,
    malfunction: `Needs review: malfunction was not generated for ${item.id || `FD-${index + 1}`}.`,
    functionalDegradationOrLoss: `Needs review: functional degradation or loss was not generated for ${item.id || `FD-${index + 1}`}.`,
    hazard: `Needs review: hazard was not generated for ${item.id || `FD-${index + 1}`}.`,
    operationalSituation: `Needs review: operational situation was not generated for ${item.id || `FD-${index + 1}`}.`,
    hazardousEvent: `Needs review: hazardous event was not generated for ${item.id || `FD-${index + 1}`}.`,
    effect: `Needs review: effect was not generated for ${item.id || `FD-${index + 1}`}.`,
    mishap: `Needs review: mishap was not generated for ${item.id || `FD-${index + 1}`}.`,
    harm: `Needs review: potential harm was not generated for ${item.id || `FD-${index + 1}`}.`,
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
    instructions: "State the lost, degraded, wrong, late, stale, conflicting, or unintended behavior plus the affected data, command, state, interface, model input/output, or artifact from the row/context and credible trigger/context.",
  },
  {
    fieldName: "hazard",
    fieldLabel: "Hazard",
    instructions: "Describe the unsafe intermediate system state caused by that degradation or loss, naming the affected artifact, state, interface, and downstream consumer where supported, including the local effect, system-level effect, and plausible consequence.",
  },
  {
    fieldName: "effect",
    fieldLabel: "Effect",
    instructions: "Describe the causal chain from degradation or loss to local effect, system-level effect, and downstream consequence. Name concrete row/context artifacts and do not stop at generic processing errors.",
  },
  {
    fieldName: "mishap",
    fieldLabel: "Mishap",
    instructions: "Describe the credible end consequence if controls fail, tied to the project / operational context.",
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
    instructions: "Name concrete technical, data, timing, interface, human, or environmental contributors and how they create the failure condition in the affected row/context artifact, state, or interface.",
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
    instructions: "Name the initiating failure condition, such as missing, late, early, wrong, stale, conflicting, intermittent, or unintended control behavior, and identify the affected data, command, state, interface, model input/output, or artifact from the row/context.",
  },
  {
    fieldName: "hazard",
    fieldLabel: "Hazard",
    instructions: "Describe the unsafe system state that results from the malfunction, naming the affected artifact, state, interface, and downstream consumer where supported, including the local effect, system-level effect, and plausible consequence.",
  },
  {
    fieldName: "operationalSituation",
    fieldLabel: "Operational Situation",
    instructions: "State when or under what operating condition the malfunction becomes safety-relevant.",
  },
  {
    fieldName: "hazardousEvent",
    fieldLabel: "Hazardous Event",
    instructions: "Connect the malfunction, operating condition, affected row/context artifact or state, unsafe state, local effect, system-level effect, and credible consequence in one causal sentence.",
  },
  {
    fieldName: "harm",
    fieldLabel: "Potential Harm",
    instructions: "Describe the plausible end effect on people, mission, environment, asset, data, or trust in the project / operational context.",
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

function normalizeHaraRow(row, item, index) {
  const base = fallbackHazardRow(item, index);
  return {
    id: sanitizeText(row.id) || base.id,
    safetySignificant: normalizeSafetySignificance(row.safetySignificant || row["Safety Significant"]),
    safetySignificanceRationale: sanitizeText(row.safetySignificanceRationale || row["Safety Significance Rationale"]),
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
    safetySignificant: normalizeSafetySignificance(row.safetySignificant || row["Safety Significant"]),
    safetySignificanceRationale: sanitizeText(row.safetySignificanceRationale || row["Safety Significance Rationale"]),
    functionName: sanitizeText(row.functionName) || base.itemFunction,
    functionalDegradationOrLoss: sanitizeText(row.functionalDegradationOrLoss || row.failureCondition) || base.malfunction,
    hazard: sanitizeText(row.hazard) || base.hazard,
    mishap: sanitizeText(row.mishap) || base.harm,
    effect: sanitizeText(row.effect) || base.hazardousEvent,
    severity: FHA_SEVERITY_CATEGORIES[severityCategory],
    softwareControlCategory: FHA_SOFTWARE_CONTROL_CATEGORIES[softwareControlCategory],
    softwareCriticalityIndex: `SwCI ${swci}`,
    lorTasks: sanitizeText(row.lorTasks) || FHA_SWCI_LOR_TASKS[swci],
    causalFactors: sanitizeText(row.causalFactors) || `Needs review: causal factors were not generated for ${item.id || `FD-${index + 1}`}.`,
    controls: sanitizeText(row.controls) || `Needs review: controls were not generated for ${item.id || `FD-${index + 1}`}.`,
    safetyRequirement: sanitizeText(row.safetyRequirement) || `Needs review: safety requirement was not generated for ${item.id || `FD-${index + 1}`}.`,
    verification: sanitizeText(row.verification) || `Needs review: verification was not generated for ${item.id || `FD-${index + 1}`}.`,
    rationale: sanitizeText(row.rationale) || `Needs review: severity and software-control rationale were not generated for ${item.id || `FD-${index + 1}`}.`,
  };
}

function normalizeSafetySignificance(value) {
  const text = sanitizeText(value).toLowerCase();
  if (/^yes\b|^safety\s*significant\b|^significant\b/i.test(text)) return "Yes";
  return "Needs Review";
}

function genericHazardFields(fieldNames = [], row = {}) {
  return fieldNames.filter((fieldName) => GENERIC_HAZARD_PHRASE_RE.test(sanitizeText(row[fieldName])));
}

async function requestGenericHazardRepairs({
  analysisName,
  fieldNames,
  repairItems,
  contextOptions = {},
}) {
  const operationalContextBlock = formatHazardOperationalContext(contextOptions);
  const prompt = `
You are repairing generated ${analysisName} rows that still contain generic hazard language.

${CONCRETE_CAUSAL_CHAIN_GUIDANCE}
${DOMAIN_NOUN_GUIDANCE}
${SPECIFICITY_SELF_CHECK_GUIDANCE}

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
- Valid repair fields are: ${fieldNames.join(", ")}.

Rows to repair:
${JSON.stringify(repairItems.map(({ item, row, fieldsToRepair }) => ({
  row: compactFhaPromptItem(item, 180),
  generated: row,
  fieldsToRepair,
})))}
  `.trim();

  const response = await fetchLLMResponse(prompt);
  return extractJsonArray(response);
}

async function repairGenericHazardRows({
  analysisName,
  rows,
  items,
  fieldNames,
  normalize,
  contextOptions = {},
}) {
  const weakRows = rows
    .map((row, index) => ({ row, item: items[index], index, fieldsToRepair: genericHazardFields(fieldNames, row) }))
    .filter(({ fieldsToRepair }) => fieldsToRepair.length);

  if (!weakRows.length) return rows;

  contextOptions.onProgress?.({
    message: `Repairing generic ${analysisName} wording for ${weakRows.length} row${weakRows.length === 1 ? "" : "s"}...`,
  });

  const repairedRows = [...rows];
  const repairChunks = chunkFhaItemsByCount(weakRows, FHA_RETRY_ROWS_PER_PROMPT);
  for (let chunkIndex = 0; chunkIndex < repairChunks.length; chunkIndex += 1) {
    const repairChunk = repairChunks[chunkIndex];
    contextOptions.onProgress?.({
      message: `Repairing generic ${analysisName} wording (${chunkIndex + 1}/${repairChunks.length})...`,
      completed: chunkIndex,
      total: repairChunks.length,
    });

    try {
      const repairs = await requestGenericHazardRepairs({
        analysisName,
        fieldNames,
        repairItems: repairChunk,
        contextOptions,
      });
      const repairsById = generatedRowsById(repairs);
      repairChunk.forEach(({ row, item, index, fieldsToRepair }) => {
        const repair = generatedRowForItem(repairsById, repairs, 0, item);
        const merged = { ...row };
        fieldsToRepair.forEach((fieldName) => {
          const value = sanitizeText(repair?.[fieldName]);
          if (value) merged[fieldName] = value;
        });
        repairedRows[index] = normalize(merged, item, index);
      });
    } catch (err) {
      console.warn(`⚠️ ${analysisName} generic wording repair failed for chunk ${chunkIndex + 1}.`, err);
    }
  }

  contextOptions.onProgress?.({
    message: `Generic ${analysisName} wording repair complete.`,
    completed: repairChunks.length,
    total: repairChunks.length,
  });

  return repairedRows;
}

async function requestSafetySignificanceTags({
  analysisName,
  tagItems,
  contextOptions = {},
}) {
  const operationalContextBlock = formatHazardOperationalContext(contextOptions);
  const prompt = `
You are reviewing generated ${analysisName} rows for safety significance after candidate hazard generation.

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
  row: compactFhaPromptItem(item, 180),
  generated: row,
})))}
  `.trim();

  const response = await fetchLLMResponse(prompt);
  return extractJsonArray(response);
}

async function tagSafetySignificanceForRows({
  analysisName,
  rows,
  items,
  normalize,
  contextOptions = {},
}) {
  if (!rows.length) return rows;

  contextOptions.onProgress?.({
    message: `Reviewing ${analysisName} rows for safety significance...`,
  });

  const taggedRows = [...rows];
  const tagItems = rows.map((row, index) => ({ row, item: items[index], index }));
  const tagChunks = chunkFhaItemsByCount(tagItems, FHA_RETRY_ROWS_PER_PROMPT);
  for (let chunkIndex = 0; chunkIndex < tagChunks.length; chunkIndex += 1) {
    const tagChunk = tagChunks[chunkIndex];
    contextOptions.onProgress?.({
      message: `Reviewing ${analysisName} safety significance (${chunkIndex + 1}/${tagChunks.length})...`,
      completed: chunkIndex,
      total: tagChunks.length,
    });
    try {
      const tags = await requestSafetySignificanceTags({ analysisName, tagItems: tagChunk, contextOptions });
      const tagsById = generatedRowsById(tags);
      tagChunk.forEach(({ row, item, index }) => {
        const tag = generatedRowForItem(tagsById, tags, 0, item);
        taggedRows[index] = normalize({
          ...row,
          safetySignificant: normalizeSafetySignificance(tag?.safetySignificant),
          safetySignificanceRationale: sanitizeText(tag?.safetySignificanceRationale) || "Needs review: safety significance rationale was not generated.",
        }, item, index);
      });
    } catch (err) {
      console.warn(`⚠️ ${analysisName} safety significance review failed for chunk ${chunkIndex + 1}.`, err);
      tagChunk.forEach(({ row, item, index }) => {
        taggedRows[index] = normalize({
          ...row,
          safetySignificant: "Needs Review",
          safetySignificanceRationale: "Needs review: safety significance classification was not generated.",
        }, item, index);
      });
    }
  }

  contextOptions.onProgress?.({
    message: `${analysisName} safety significance review complete.`,
    completed: tagChunks.length,
    total: tagChunks.length,
  });
  return taggedRows;
}

async function requestHaraRows(items, contextOptions = {}) {
  const operationalContextBlock = formatHazardOperationalContext(contextOptions);
  const retryInstruction = sanitizeText(contextOptions.retryReason);
  const prompt = `
You are performing a textbook Hazard Analysis and Risk Assessment (HARA) in the style used for ISO 26262 item-level safety analysis.

Use these rating conventions:
- Severity: S0 no injuries, S1 light/moderate injuries, S2 severe/life-threatening survival probable, S3 life-threatening/fatal.
- Exposure: E0 incredible, E1 very low probability, E2 low, E3 medium, E4 high.
- Controllability: C0 controllable in general, C1 simply controllable, C2 normally controllable, C3 difficult/uncontrollable.
- ASIL: QM, ASIL A, ASIL B, ASIL C, or ASIL D, consistent with the S/E/C combination and conservative safety practice.

Project / operational context:
${operationalContextBlock || "No explicit project or operational context was available. Infer cautiously from row evidence only."}

Use this context to understand system purpose, operating environment, actors, assets, mission, interfaces, and credible harm categories. Context may orient safety relevance, but the current row must still support the causal path. Do not hardcode a domain when context is absent.

For each functional decomposition row, identify one credible hazardous event. Be specific about how the hazard happens and what effect it may produce:
- Malfunction must name the initiating failure condition, such as missing, late, early, wrong, stale, conflicting, intermittent, or unintended control behavior, and identify the affected data, command, state, or interface.
- Hazard must describe the unsafe system state that results, not just a generic "loss" label, and include the local effect, system-level effect, and plausible consequence.
- Operational situation must say when or under what operating condition the malfunction becomes safety-relevant.
- Hazardous event must connect the sequence in words, such as "the initiating failure affects the function or state, which then creates the unsafe outcome."
- Harm must describe the plausible end effect on people, mission, environment, asset, data, or trust.
- Rationale must explain why the S/E/C ratings match that scenario.
- Avoid vague phrases such as "unsafe behavior", "system failure", or "loss of safety" unless you add the concrete mechanism and consequence.
- Do not use arrow notation or arrow-like symbols in any field. Use words such as "which causes", "which leads to", "resulting in", or "then" instead.
${CONCRETE_CAUSAL_CHAIN_GUIDANCE}
${DOMAIN_NOUN_GUIDANCE}
${SPECIFICITY_SELF_CHECK_GUIDANCE}

Return ONLY a JSON array. Each object must include:
id, itemFunction, malfunction, hazard, operationalSituation, hazardousEvent, harm, severity, exposure, controllability, asil, safetyGoal, rationale.
${retryInstruction ? `\n${retryInstruction}\n` : ""}

Functional decomposition rows are compact JSON objects. Use the row id exactly as provided. Do not reorder rows or infer that a response for one id applies to another id.

Quality rules:
- Every returned object must use the matching input id.
- Keep the hazardous event tied to the exact functionFrom, controlAction, functionTo, file, symbol, and subsystem evidence for that row.
- Hazard-bearing fields should read like a causal chain: failure condition, then local effect, then system-level effect, then plausible consequence.
- Name concrete domain nouns from the row/context in hazard-bearing fields, including the affected artifact, state, interface, data, command, model input/output, file/symbol, or downstream consumer when evidence supports it.
- Do not recycle generic language such as "enters an unsafe state because the action is absent, incorrect, late, stale, or unintended" unless you add the concrete mechanism, context, and consequence from the row.
- Do not stop at vague claims like "incorrect configuration", "faulty processing", "not properly initialized", or "processing errors"; state what becomes wrong, who consumes it, how it propagates, and what consequence follows.
- Replace generic endpoints such as "system behavior", "communication errors", "degraded performance", or "downstream systems" with the named artifact/state/interface and consequence from the row/context.
- Before returning JSON, silently run the specificity self-check and rewrite any field that still contains generic filler without a named row/context artifact and consumer.
- If the row evidence is insufficient for a concrete field, write a short "Needs review:" note for that field instead of inventing a hazardous event.
- It is acceptable for different rows to have similar themes, but the wording must still be specific to each row's action, target, files, and operational context.

Rows:
${JSON.stringify(compactFhaPromptRows(items))}
  `.trim();

  const response = await fetchLLMResponse(prompt);
  return extractJsonArray(response);
}

async function requestHaraRowsWithRetries(items, contextOptions = {}) {
  const rowsById = new Map();
  const missingFor = (targetItems) => targetItems.filter((item) => !rowsById.has(String(item.id || "").toUpperCase()));
  const mergeRows = (rows) => {
    generatedRowsById(rows).forEach((row, key) => {
      rowsById.set(key, row);
    });
  };

  try {
    mergeRows(await requestHaraRows(items, contextOptions));
  } catch (err) {
    console.warn(`⚠️ HARA generation failed for ${items.length} rows; retrying smaller subchunks.`, err);
  }

  for (let attempt = 0; attempt < FHA_MISSING_ROW_RETRIES; attempt += 1) {
    const missing = missingFor(items);
    if (!missing.length) break;
    const retryChunks = chunkFhaItemsByCount(missing, attempt === 0 ? FHA_RETRY_ROWS_PER_PROMPT : 1);
    for (const retryChunk of retryChunks) {
      contextOptions.onProgress?.({
        message: `Retrying HARA missing rows (${retryChunk.map((item) => item.id).join(", ")})...`,
      });
      try {
        mergeRows(await requestHaraRows(retryChunk, {
          ...contextOptions,
          retryReason: `Retry ${attempt + 1}: return exactly these missing row ids: ${retryChunk.map((item) => item.id).join(", ")}`,
        }));
      } catch (err) {
        console.warn(`⚠️ HARA retry ${attempt + 1} failed for ${retryChunk.map((item) => item.id).join(", ")}.`, err);
      }
    }
  }

  return items.map((item, index) => generatedRowForItem(rowsById, [], index, item));
}

async function requestFhaRows(items, contextOptions = {}) {
  const operationalContextBlock = formatHazardOperationalContext(contextOptions);
  const retryInstruction = sanitizeText(contextOptions.retryReason);
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

Project / operational context:
${operationalContextBlock || "No explicit project or operational context was available. Infer cautiously from row evidence only."}

Use this context to understand system purpose, operating environment, actors, assets, mission, interfaces, and credible harm categories. Context may orient safety relevance, but the current row must still support the causal path. Do not hardcode a domain when context is absent.

For each functional decomposition row, identify one credible functional degradation or loss and its hazard/mishap consequence. Be specific about how the hazard happens and what effect it may produce:
- Functional degradation or loss must state the lost, degraded, wrong, late, stale, conflicting, or unintended behavior, the affected data/command/state/interface, and the trigger/context that makes it credible.
- Hazard must state the unsafe intermediate system state created by that failure condition and include the local effect, system-level effect, and plausible consequence.
- Effect must describe the causal chain from functional degradation/loss to local effect, system-level effect, and possible downstream consequence.
- Mishap must describe the credible end consequence if controls fail.
- Severity must classify the mishap consequence, not the likelihood.
- Software Control Category must classify software's role/control authority in the degraded or lost function.
- Software Criticality Index must be consistent with the severity and software control category matrix above.
- Causal factors must name plausible technical, human, data, timing, interface, or environmental contributors.
- Controls, safety requirement, and verification must be tailored to that causal chain.
- Avoid generic phrases such as "component failure", "incorrect output", or "system damage" unless you add the concrete mechanism and consequence.
- Do not use arrow notation or arrow-like symbols in any field. Use words such as "which causes", "which leads to", "resulting in", or "then" instead.
${CONCRETE_CAUSAL_CHAIN_GUIDANCE}
${DOMAIN_NOUN_GUIDANCE}
${SPECIFICITY_SELF_CHECK_GUIDANCE}

Return ONLY a JSON array. Each object must include:
id, functionName, functionalDegradationOrLoss, hazard, mishap, effect, severity, softwareControlCategory, softwareCriticalityIndex, lorTasks, causalFactors, controls, safetyRequirement, verification, rationale.
${retryInstruction ? `\n${retryInstruction}\n` : ""}

Functional decomposition rows are compact JSON objects. Use the row id exactly as provided. Do not reorder rows or infer that a response for one id applies to another id.

Quality rules:
- Every returned object must use the matching input id.
- Keep the functional degradation, hazard, effect, and mishap tied to the exact functionFrom, controlAction, functionTo, file, symbol, and subsystem evidence for that row.
- Hazard-bearing fields should read like a causal chain: failure condition, then local effect, then system-level effect, then plausible consequence.
- Name concrete domain nouns from the row/context in hazard-bearing fields, including the affected artifact, state, interface, data, command, model input/output, file/symbol, or downstream consumer when evidence supports it.
- Do not recycle generic language such as "enters an unsafe state because the action is absent, incorrect, late, stale, or unintended" unless you add the concrete mechanism, context, and consequence from the row.
- Do not stop at vague claims like "incorrect configuration", "faulty processing", "not properly initialized", or "processing errors"; state what becomes wrong, who consumes it, how it propagates, and what consequence follows.
- Replace generic endpoints such as "system behavior", "communication errors", "degraded performance", or "downstream systems" with the named artifact/state/interface and consequence from the row/context.
- Before returning JSON, silently run the specificity self-check and rewrite any field that still contains generic filler without a named row/context artifact and consumer.
- If the row evidence is insufficient for a concrete field, write a short "Needs review:" note for that field instead of inventing a functional hazard.
- It is acceptable for different rows to have similar themes, but the wording must still be specific to each row's action, target, files, and operational context.

Rows:
${JSON.stringify(compactFhaPromptRows(items))}
  `.trim();

  const response = await fetchLLMResponse(prompt);
  return extractJsonArray(response);
}

async function requestFhaRowsWithRetries(items, contextOptions = {}) {
  const rowsById = new Map();
  const missingFor = (targetItems) => targetItems.filter((item) => !rowsById.has(String(item.id || "").toUpperCase()));
  const mergeRows = (rows) => {
    generatedRowsById(rows).forEach((row, key) => {
      rowsById.set(key, row);
    });
  };

  try {
    mergeRows(await requestFhaRows(items, contextOptions));
  } catch (err) {
    console.warn(`⚠️ FHA generation failed for ${items.length} rows; retrying smaller subchunks.`, err);
  }

  for (let attempt = 0; attempt < FHA_MISSING_ROW_RETRIES; attempt += 1) {
    const missing = missingFor(items);
    if (!missing.length) break;
    const retryChunks = chunkFhaItemsByCount(missing, attempt === 0 ? FHA_RETRY_ROWS_PER_PROMPT : 1);
    for (const retryChunk of retryChunks) {
      contextOptions.onProgress?.({
        message: `Retrying FHA missing rows (${retryChunk.map((item) => item.id).join(", ")})...`,
      });
      try {
        mergeRows(await requestFhaRows(retryChunk, {
          ...contextOptions,
          retryReason: `Retry ${attempt + 1}: return exactly these missing row ids: ${retryChunk.map((item) => item.id).join(", ")}`,
        }));
      } catch (err) {
        console.warn(`⚠️ FHA retry ${attempt + 1} failed for ${retryChunk.map((item) => item.id).join(", ")}.`, err);
      }
    }
  }

  return items.map((item, index) => generatedRowForItem(rowsById, [], index, item));
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

async function requestHaraCell({ item, rowDraft, fieldName, fieldLabel, instructions, contextOptions = {} }) {
  const operationalContextBlock = formatHazardOperationalContext(contextOptions);
  const prompt = `
You are performing a textbook Hazard Analysis and Risk Assessment (HARA) in the style used for ISO 26262 item-level safety analysis.

${HARA_RATING_CONVENTIONS}

Project / operational context:
${operationalContextBlock || "No explicit project or operational context was available. Infer cautiously from row evidence only."}

Use this context to understand system purpose, operating environment, actors, assets, mission, interfaces, and credible harm categories. Context may orient safety relevance, but the current row must still support the causal path. Do not hardcode a domain when context is absent.

${CONCRETE_CAUSAL_CHAIN_GUIDANCE}
${DOMAIN_NOUN_GUIDANCE}
${SPECIFICITY_SELF_CHECK_GUIDANCE}

Current functional decomposition row:
${JSON.stringify({
  id: item.id,
  from: truncateForPrompt(item.from, 240),
  controlAction: truncateForPrompt(item.controlAction, 240),
  to: truncateForPrompt(item.to, 240),
  fromFile: truncateForPrompt(item.traceability?.fromFile, 240),
  toFile: truncateForPrompt(item.traceability?.toFile, 240),
  sourceFiles: truncateForPrompt(item.traceability?.sourceFiles, 240),
  sourceSymbols: truncateForPrompt(item.traceability?.sourceSymbols, 500),
  subsystem: truncateForPrompt(item.traceability?.subsystem, 120),
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

async function generateHaraRowCellByCell(item, index, onCellUpdate = () => {}, contextOptions = {}) {
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
          contextOptions,
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

async function requestFhaCell({ item, rowDraft, fieldName, fieldLabel, instructions, contextOptions = {} }) {
  const operationalContextBlock = formatHazardOperationalContext(contextOptions);
  const prompt = `
You are performing a MIL-STD-882E-style Functional Hazard Analysis (FHA) for software safety.

The FHA intent is to identify credible functional degradation or loss scenarios and determine the Software Criticality Index (SwCI) from:
1. the mishap severity category of the degradation or loss, and
2. the Software Control Category (SCC), meaning the degree of software control over the safety-significant function.

${FHA_RATING_CONVENTIONS}

Project / operational context:
${operationalContextBlock || "No explicit project or operational context was available. Infer cautiously from row evidence only."}

Use this context to understand system purpose, operating environment, actors, assets, mission, interfaces, and credible harm categories. Context may orient safety relevance, but the current row must still support the causal path. Do not hardcode a domain when context is absent.

${CONCRETE_CAUSAL_CHAIN_GUIDANCE}
${DOMAIN_NOUN_GUIDANCE}
${SPECIFICITY_SELF_CHECK_GUIDANCE}

Current functional decomposition row:
${JSON.stringify({
  id: item.id,
  from: truncateForPrompt(item.from, 240),
  controlAction: truncateForPrompt(item.controlAction, 240),
  to: truncateForPrompt(item.to, 240),
  fromFile: truncateForPrompt(item.traceability?.fromFile, 240),
  toFile: truncateForPrompt(item.traceability?.toFile, 240),
  sourceFiles: truncateForPrompt(item.traceability?.sourceFiles, 240),
  sourceSymbols: truncateForPrompt(item.traceability?.sourceSymbols, 500),
  subsystem: truncateForPrompt(item.traceability?.subsystem, 120),
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

async function generateFhaRowCellByCell(item, index, onCellUpdate = () => {}, contextOptions = {}) {
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
          contextOptions,
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
  ...SAFETY_SIGNIFICANCE_FIELDS.map(([, label]) => label),
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
  ...SAFETY_SIGNIFICANCE_FIELDS.map(([, label]) => label),
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
      ...SAFETY_SIGNIFICANCE_FIELDS.map(([fieldName]) => row[fieldName] || ""),
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
        ...SAFETY_SIGNIFICANCE_FIELDS.map(([fieldName]) => row[fieldName] || ""),
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
  ...SAFETY_SIGNIFICANCE_FIELDS.map(([, label]) => label),
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
  ...SAFETY_SIGNIFICANCE_FIELDS.map(([, label]) => label),
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
      ...SAFETY_SIGNIFICANCE_FIELDS.map(([fieldName]) => row[fieldName] || ""),
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
        ...SAFETY_SIGNIFICANCE_FIELDS.map(([fieldName]) => row[fieldName] || ""),
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
  operationalContext = "",
  analysisContext = null,
  contextSources = null,
  onProgress = () => {},
}) {
  const items = flattenDecomposition(sheets);
  if (!items.length) return sheets;

  const mode = normalizeFhaGenerationMode(haraGenerationMode);
  const contextOptions = { operationalContext, analysisContext, contextSources };

  if (mode === FHA_GENERATION_MODES.STANDARD) {
    const promptChunks = items.length <= FHA_MAX_ROWS_PER_PROMPT && compactFhaPromptRowsLength(items) <= FHA_SINGLE_PROMPT_MAX_CHARS
      ? [items]
      : chunkFhaItemsForPrompt(items);
    if (promptChunks.length > 1) {
      console.warn(`⚠️ HARA standard input is large; using ${promptChunks.length} bulk prompt chunks instead of one prompt.`);
    }

    const generatedRows = [];
    for (let start = 0, chunkIndex = 0; chunkIndex < promptChunks.length; chunkIndex += 1) {
      const chunk = promptChunks[chunkIndex];
      onProgress({
        step: chunkIndex + 1,
        total: promptChunks.length + 1,
        message: `Generating HARA rows (${chunkIndex + 1}/${promptChunks.length})...`,
      });
      try {
        const chunkRows = await requestHaraRowsWithRetries(chunk, { ...contextOptions, onProgress });
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

    let normalizedRows = items.map((item, index) => normalizeHaraRow(generatedRows[index] || {}, item, index));
    normalizedRows = await repairGenericHazardRows({
      analysisName: "HARA",
      rows: normalizedRows,
      items,
      fieldNames: HARA_REPAIR_FIELDS,
      normalize: normalizeHaraRow,
      contextOptions: {
        ...contextOptions,
        onProgress: (patch) => onProgress({
          step: promptChunks.length + 1,
          total: promptChunks.length + 1,
          ...patch,
        }),
      },
    });
    normalizedRows = await tagSafetySignificanceForRows({
      analysisName: "HARA",
      rows: normalizedRows,
      items,
      normalize: normalizeHaraRow,
      contextOptions: {
        ...contextOptions,
        onProgress: (patch) => onProgress({
          step: promptChunks.length + 1,
          total: promptChunks.length + 2,
          ...patch,
        }),
      },
    });
    return saveHaraAnalysisSheets({ sheets, setFolders, currentFolder, normalizedRows, items });
  }

  const normalizedRows = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    onProgress({
      step: index + 1,
      total: items.length,
      message: `Generating detailed HARA row ${index + 1}/${items.length}...`,
    });
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
      }, contextOptions);
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

  let finalRows = items.map((item, index) => normalizedRows[index] || normalizeHaraRow({}, item, index));
  finalRows = await repairGenericHazardRows({
    analysisName: "HARA",
    rows: finalRows,
    items,
    fieldNames: HARA_REPAIR_FIELDS,
    normalize: normalizeHaraRow,
    contextOptions: {
      ...contextOptions,
      onProgress: (patch) => onProgress({
        step: items.length,
        total: items.length,
        ...patch,
      }),
    },
  });
  finalRows = await tagSafetySignificanceForRows({
    analysisName: "HARA",
    rows: finalRows,
    items,
    normalize: normalizeHaraRow,
    contextOptions: {
      ...contextOptions,
      onProgress: (patch) => onProgress({
        step: items.length,
        total: items.length + 1,
        ...patch,
      }),
    },
  });
  return saveHaraAnalysisSheets({ sheets, setFolders, currentFolder, normalizedRows: finalRows, items });
}

export async function generateFhaAnalysisSheets({
  sheets,
  setFolders,
  currentFolder,
  fhaGenerationMode = FHA_GENERATION_MODES.STANDARD,
  operationalContext = "",
  analysisContext = null,
  contextSources = null,
  onProgress = () => {},
}) {
  const items = flattenDecomposition(sheets);
  if (!items.length) return sheets;

  const mode = normalizeFhaGenerationMode(fhaGenerationMode);
  const contextOptions = { operationalContext, analysisContext, contextSources };

  if (mode === FHA_GENERATION_MODES.STANDARD) {
    const promptChunks = items.length <= FHA_MAX_ROWS_PER_PROMPT && compactFhaPromptRowsLength(items) <= FHA_SINGLE_PROMPT_MAX_CHARS
      ? [items]
      : chunkFhaItemsForPrompt(items);
    if (promptChunks.length > 1) {
      console.warn(`⚠️ FHA standard input is large; using ${promptChunks.length} bulk prompt chunks instead of one prompt.`);
    }

    const generatedRows = [];
    for (let start = 0, chunkIndex = 0; chunkIndex < promptChunks.length; chunkIndex += 1) {
      const chunk = promptChunks[chunkIndex];
      onProgress({
        step: chunkIndex + 1,
        total: promptChunks.length + 1,
        message: `Generating FHA rows (${chunkIndex + 1}/${promptChunks.length})...`,
      });
      try {
        const chunkRows = await requestFhaRowsWithRetries(chunk, { ...contextOptions, onProgress });
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

    let normalizedRows = items.map((item, index) => normalizeFhaRow(generatedRows[index] || {}, item, index));
    normalizedRows = await repairGenericHazardRows({
      analysisName: "FHA",
      rows: normalizedRows,
      items,
      fieldNames: FHA_REPAIR_FIELDS,
      normalize: normalizeFhaRow,
      contextOptions: {
        ...contextOptions,
        onProgress: (patch) => onProgress({
          step: promptChunks.length + 1,
          total: promptChunks.length + 1,
          ...patch,
        }),
      },
    });
    normalizedRows = await tagSafetySignificanceForRows({
      analysisName: "FHA",
      rows: normalizedRows,
      items,
      normalize: normalizeFhaRow,
      contextOptions: {
        ...contextOptions,
        onProgress: (patch) => onProgress({
          step: promptChunks.length + 1,
          total: promptChunks.length + 2,
          ...patch,
        }),
      },
    });
    return saveFhaAnalysisSheets({ sheets, setFolders, currentFolder, normalizedRows, items });
  }

  const normalizedRows = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    onProgress({
      step: index + 1,
      total: items.length,
      message: `Generating detailed FHA row ${index + 1}/${items.length}...`,
    });
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
      }, contextOptions);
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

  let finalRows = items.map((item, index) => normalizedRows[index] || normalizeFhaRow({}, item, index));
  finalRows = await repairGenericHazardRows({
    analysisName: "FHA",
    rows: finalRows,
    items,
    fieldNames: FHA_REPAIR_FIELDS,
    normalize: normalizeFhaRow,
    contextOptions: {
      ...contextOptions,
      onProgress: (patch) => onProgress({
        step: items.length,
        total: items.length,
        ...patch,
      }),
    },
  });
  finalRows = await tagSafetySignificanceForRows({
    analysisName: "FHA",
    rows: finalRows,
    items,
    normalize: normalizeFhaRow,
    contextOptions: {
      ...contextOptions,
      onProgress: (patch) => onProgress({
        step: items.length,
        total: items.length + 1,
        ...patch,
      }),
    },
  });
  return saveFhaAnalysisSheets({ sheets, setFolders, currentFolder, normalizedRows: finalRows, items });
}
