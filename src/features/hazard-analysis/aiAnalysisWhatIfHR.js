/**
 * xHandle: WhatIfHR hazard-analysis pipeline.
 * This file contains one of xHandle's AI-assisted safety-analysis pipelines. It prepares prompt inputs from functional decomposition or worksheet data, calls the backend chat proxy, and normalizes the returned analysis into spreadsheet-friendly structures.
 * These modules are the bridge between system architecture data and the domain-specific artifacts that xHandle uses for hazard identification, control-action analysis, causal reasoning, mitigations, and derived requirements.
 * Related files: src/App.js, src/lib/api/backendConfig.js, src/lib/storage/indexedDB.js, src/components/generateAgenticReport.js.
 */

// aiAnalysisWhatIfHR.js
import { saveFoldersToDB, loadFoldersFromDB } from '../../lib/storage/indexedDB';
import { backendURL, buildAIAuthOpts } from "../../lib/api/backendConfig";
import { logger } from "../../lib/utils/logger";

/* ──────────────────────────────────────────────────────────────────────────
   Small utils (unchanged signatures)
────────────────────────────────────────────────────────────────────────── */
function getCellText(cell) {
  if (cell == null) return "";
  if (typeof cell === "object" && "value" in cell) return String(cell.value);
  return String(cell);
}

/**
 * sanitizeText prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param text Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function sanitizeText(text) {
  return String(text || "")
    .replace(/^[-–—•·\s"]+/, "")
    .replace(/["“”‘’]+$/, "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

/**
 * normalizeText prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param text Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/["'\-–—•·]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ──────────────────────────────────────────────────────────────────────────
   HR constants (namespace and taxonomy)
────────────────────────────────────────────────────────────────────────── */
const NS = " (HR)"; // appended to all HR sheet names

// 15 AI-in-HR scenarios (your list)
const AI_SCENARIOS = [
  "What if AI screening tools filter out qualified candidates due to biased training data or incomplete algorithm design?",
  "What if recruiters over-rely on AI recommendations and stop applying human judgment to candidate evaluation?",
  "What if AI integration into recruiting is implemented too quickly without adequate training for hiring managers?",
  "What if AI-generated performance ratings perpetuate historical biases present in the training data?",
  "What if managers bypass AI-assisted performance tools and revert to subjective, inconsistent rating methods?",
  "What if AI performance insights are delivered too late in the review cycle to be actionable?",
  "What if AI-recommended training paths don't align with actual business needs or emerging skill requirements?",
  "What if employees are assigned AI-driven training before they have foundational skills to understand it?",
  "What if AI learning platforms are inaccessible to certain employee populations (language, disability, tech literacy)?",
  "What if change management for AI adoption is inadequate, leading to employee resistance and low utilization?",
  "What if AI competency assessments are rolled out before employees understand what AI competency means for their roles?",
  "What if AI tools are integrated across talent functions without consistent data standards or interoperability?",
  "What if there's no clear accountability when AI systems make incorrect or harmful recommendations?",
  "What if AI-generated employee data and insights aren't properly secured or are misused?",
  "What if AI systems extend decision-making duration beyond appropriate time"
];

// Column headers = interaction + each scenario as a column
const HR_SCENARIO_HEADERS = [
  "HR/AI Interaction",
  ...AI_SCENARIOS
];

// Use the scenario text itself as guidephrase for the LLM prompt
const HR_GUIDEPHRASES = Object.fromEntries(AI_SCENARIOS.map(s => [s, s]));

// Updated examples to reflect AI risk flavors
const HR_IMPACT_EXAMPLES = [
  "Algorithmic screening bias",
  "Biased performance management",
  "Compensation inequity",
  "Hostile work environment",
  "Interoperability failure",
  "Access barrier to learning",
  "Change adoption failure",
  "Delayed feedback"
];

const HR_LOSS_CATEGORIES = [
  "Retention risk",
  "Legal/compliance exposure",
  "Reputation harm",
  "Engagement decline",
  "Productivity loss",
  "Equitable access degradation"
];

const HR_SYSTEM_ROLE = `You are an HR risk analyst focused on AI-enabled people systems (recruiting, performance, learning, change, data governance). Center fairness, access, and accountability. Prefer concise, plain language. Return only the requested fields.`;

/* ──────────────────────────────────────────────────────────────────────────
   LLM proxy (HR role baked in)
────────────────────────────────────────────────────────────────────────── */
export const fetchLLMResponse = async (
  prompt,
  sysmlData = {},
  selectedContexts = ["google_drive"],
  additionalContextText = ""
) => {
  try {
    const contexts = [];
    let fullContext = contexts.map(ctx => `#### **${ctx.name} Context:**\n${ctx.content}`).join("\n\n");

    if (additionalContextText) {
      fullContext += `\n\n#### **Context Attachment:**\n${additionalContextText}`;
    }

    const isSysMLQuery = /\b(diagram|sysml|nodes|edges|architecture|blocks|connections)\b/i.test(prompt);
    let sysmlContextString = "";

    if (isSysMLQuery && sysmlData?.nodes?.length) {
      const diagramContext = {
        nodes: sysmlData.nodes.map((node) => ({
          id: node.id || "Unknown",
          label: node.label?.trim() || `Component ${node.id || "Unknown"}`,
        })),
        edges: sysmlData.edges.map((edge) => {
          const sourceNode = sysmlData.nodes.find((n) => n.id === edge.source);
          const targetNode = sysmlData.nodes.find((n) => n.id === edge.target);
          return {
            source: sourceNode?.label?.trim() || `Component ${edge.source || "Unknown"}`,
            target: targetNode?.label?.trim() || `Component ${edge.target || "Unknown"}`,
            label: edge.label?.trim() || "",
          };
        }),
      };

      sysmlContextString = `
### Structure Context (if relevant)

#### **Nodes:**
${diagramContext.nodes.map((n, index) => `${index + 1}. ${n.label}`).join("\n")}

#### **Edges:**
${diagramContext.edges.length > 0
  ? diagramContext.edges
      .map(
        (e, index) =>
          `${index + 1}. **${e.source} → ${e.target}**${e.label ? ` (labeled "${e.label}")` : ""}`
      )
      .join("\n")
  : "No connections defined."}
`;
      fullContext = `${sysmlContextString}\n\n${fullContext}`;
    }

     // small local helper
     const wait = (ms) => new Promise(r => setTimeout(r, ms));

     let response;
     for (let attempt = 1; attempt <= 5; attempt++) {
       response = await fetch(`${backendURL}/api/chat`, {
         method: "POST",
         ...buildAIAuthOpts({ "Content-Type": "application/json" }),
         body: JSON.stringify({
           model: "gpt-4o",
           messages: [
             { role: "system", content: HR_SYSTEM_ROLE },
             { role: "user", content: fullContext ? `${fullContext}\n\n${prompt}` : prompt },
           ],
           temperature: 0.3,
         }),
       });
 
       // 429 handling with Retry-After + jittered backoff
       if (response.status === 429) {
         logger.warn("🔁 429 Rate limit hit (attempt", attempt, ")");
         logger.debug("📦 Headers:", {
           limitTokens: response.headers.get("x-ratelimit-limit-tokens"),
           remainingTokens: response.headers.get("x-ratelimit-remaining-tokens"),
           limitRequests: response.headers.get("x-ratelimit-limit-requests"),
           remainingRequests: response.headers.get("x-ratelimit-remaining-requests"),
           resetTokens: response.headers.get("x-ratelimit-reset-tokens"),
           resetRequests: response.headers.get("x-ratelimit-reset-requests"),
           retryAfter: response.headers.get("retry-after"),
         });
 
         if (attempt === 5) break;
 
         const retryAfter = parseFloat(response.headers.get("retry-after"));
         const backoff = Number.isFinite(retryAfter)
           ? retryAfter * 1000
           : Math.min(30_000, 500 * Math.pow(2, attempt - 1) + Math.random() * 500);
 
         await wait(backoff);
         continue; // retry
       }
 
       // non-429: break and process below
       break;
     }
 
     if (!response.ok) {
       const errTxt = await response.text().catch(() => "");
       throw new Error(`LLM proxy error (${response.status}): ${errTxt}`);
     }
 
     const json = await response.json();
     logger.debug("📦 Raw LLM response JSON:", json);
     return json?.choices?.[0]?.message?.content?.trim() || "(empty)";
 
  } catch (error) {
    logger.error("🚨 Error in fetchLLMResponse:", error);
    return "(error)";
  }
};

/* ──────────────────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────────────────── */
function flattenSheetData(sheetData) {
  return sheetData
    .map((row, rowIndex) =>
      row
        .map((cell, colIndex) => {
          const value = typeof cell === 'object' ? cell?.value : cell;
          return value ? `${String.fromCharCode(65 + colIndex)}${rowIndex + 1}: ${value}` : null;
        })
        .filter(Boolean)
        .join(" | ")
    )
    .filter(Boolean)
    .join("\n");
}

/* ──────────────────────────────────────────────────────────────────────────
   1) SEED SHEET (HR What-If with 15 AI scenarios)
────────────────────────────────────────────────────────────────────────── */
export async function generateWhatIfSeedSheet({ sheets, setFolders, currentFolder }) {
  logger.debug("📥 Entered generateWhatIfSeedSheet (HR with AI scenarios)");

  const decomposition = sheets["Functional Decomposition"];
  if (!decomposition || decomposition.length === 0) return;

  const headers = HR_SCENARIO_HEADERS.slice();
  const newSheet = [headers];

  // Build interaction strings from first three columns (from/action/to)
  for (let i = 1; i < decomposition.length; i++) {
    const row = decomposition[i];
    const from = getCellText(row[0]);
    const action = getCellText(row[1]);
    const to = getCellText(row[2]);

    if (from && action && to) {
      const interaction = `${from} performs "${action}" affecting ${to}`;
      // Dynamic number of blanks (15 scenarios)
      newSheet.push([interaction, ...Array(headers.length - 1).fill("")]);
    }
  }

  const key = `What-If Scenarios${NS}`;
  const updatedFolder = { ...sheets, [key]: newSheet };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: { ...prev[currentFolder], ...updatedFolder },
  }));

  logger.debug(`✅ Generated HR What-If seed sheet (15 AI scenarios) → ${key}`);
  return updatedFolder;
}

/* ──────────────────────────────────────────────────────────────────────────
   2) POPULATE WHAT-IF SCENARIOS (HR)
────────────────────────────────────────────────────────────────────────── */
export async function populateWhatIfScenariosWithLLM({
  sheets,
  setFolders,
  currentFolder,
  setChatPrompt,
  setChatResponse,
}) {
  logger.debug("📊 populateWhatIfScenariosWithLLM (HR) called");

  const sheetKey = `What-If Scenarios${NS}`;
  const sheet = sheets[sheetKey];
  if (!sheet || sheet.length < 2) {
    logger.warn(`⚠️ ${sheetKey} sheet is missing or empty.`);
    return;
  }

  const columnHeaders = sheet[0];
  const updatedSheet = [columnHeaders];

  let allScenarios = "";

  for (let rowIndex = 1; rowIndex < sheet.length; rowIndex++) {
    const row = sheet[rowIndex];
    const interaction = getCellText(row[0]);

    if (!interaction) {
      updatedSheet.push(new Array(columnHeaders.length).fill(""));
      continue;
    }

    const newRow = [interaction];

    for (let col = 1; col < columnHeaders.length; col++) {
      const phraseLabel = columnHeaders[col];
      const guidephrase = HR_GUIDEPHRASES[phraseLabel] || phraseLabel;

      // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
      const prompt = `
Given this HR/AI interaction:
"${interaction}"

What-if condition:
"${guidephrase}"

Return three single-sentence fields, concise and neutral:

Scenario: (restate the situation in HR + AI risk terms)
Impact: (primary impact on people/process fairness or security)
Trigger: (mechanism or condition causing the impact)

No bullets, no quotes, one sentence per field.
`.trim();

      let response = "";
      try {
        response = await fetchLLMResponse(prompt);
        response = response.trim();

        const scenario = /Scenario:\s*(.*)/i.exec(response)?.[1]?.trim() || "";
        const effect   = /Impact:\s*(.*)/i.exec(response)?.[1]?.trim() || "";
        const cause    = /Trigger:\s*(.*)/i.exec(response)?.[1]?.trim() || "";

        const combined = `${scenario} | ${effect} | ${cause}`;
        newRow.push(combined);
        allScenarios += combined + "; ";
      } catch (err) {
        logger.error(`❌ LLM error on row ${rowIndex}, col "${phraseLabel}"`, err);
        newRow.push("(error)");
      }
    }

    updatedSheet.push(newRow);
  }

  if (typeof setChatResponse === "function") setChatResponse(allScenarios.trim());

  const updatedSheets = { ...sheets, [sheetKey]: updatedSheet };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: { ...prev[currentFolder], ...updatedSheets },
  }));

  logger.debug("✅ Finished populating HR What-If scenario columns");
  return updatedSheets;
}

/* ──────────────────────────────────────────────────────────────────────────
   3) CAUSAL FACTORS (HR)
────────────────────────────────────────────────────────────────────────── */
export async function generateWhatIfCausalFactorsSheet({
  sheets,
  setFolders,
  currentFolder,
}) {
  logger.debug("🧠 generateWhatIfCausalFactorsSheet (HR) called");

  const sheetKey = `What-If Scenarios${NS}`;
  const outKey = `Causal Factors (What-If)${NS}`;

  const sheet = sheets[sheetKey];
  if (!sheet || sheet.length < 2) {
    logger.warn(`⚠️ '${sheetKey}' sheet is missing or empty.`);
    return sheets;
  }

  const rows = [["What-If Scenario", "Causal Factor"]];

  for (let rowIndex = 1; rowIndex < sheet.length; rowIndex++) {
    const row = sheet[rowIndex];
    for (let colIndex = 1; colIndex < row.length; colIndex++) {
      const cell = getCellText(row[colIndex]);
      const [whatIfScenario, , cause] = cell.split("|").map((s) => sanitizeText((s || "").trim()));
      if (whatIfScenario && cause) rows.push([whatIfScenario, cause]);
    }
  }

  const updatedSheets = { ...sheets, [outKey]: rows };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: { ...prev[currentFolder], ...updatedSheets },
  }));

  logger.debug(`✅ Created HR Causal Factors sheet: ${rows.length - 1} rows`);
  return updatedSheets;
}

/* ──────────────────────────────────────────────────────────────────────────
   4) MITIGATIONS (HR) — policy/process controls
────────────────────────────────────────────────────────────────────────── */
export async function generateMitigationStrategiesSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalKey = `Causal Factors (What-If)${NS}`;
  const outKey = `Mitigation Strategies${NS}`;

  const causalSheet = sheets[causalKey];
  if (!causalSheet || causalSheet.length < 2) {
    logger.warn(`⚠️ '${causalKey}' sheet is missing or empty.`);
    return;
  }

  const header = ["Causal Factor", "Mitigation Strategy"];
  const rows = [header];

  for (let i = 1; i < causalSheet.length; i++) {
    const cause = getCellText(causalSheet[i][1]);
    if (!cause) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
You are defining an HR/Organizational control or policy intervention in response to the following causal factor:

${cause}

Write ONE sentence describing a specific, actionable, and measurable policy/process intervention that mitigates this cause. Avoid tool/implementation detail.
`.trim();

    let mitigation = "";
    try {
      mitigation = await fetchLLMResponse(prompt);
    } catch (err) {
      logger.error("LLM error for mitigation:", err);
      mitigation = "(error generating mitigation)";
    }

    rows.push([sanitizeText(cause), sanitizeText(mitigation)]);
  }

  const updatedSheets = { ...sheets, [outKey]: rows };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: { ...prev[currentFolder], ...updatedSheets },
  }));

  const nextUpdatedSheets = await generateSystemRequirementsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  return nextUpdatedSheets;
}

/* ──────────────────────────────────────────────────────────────────────────
   5) SYSTEM REQUIREMENTS (HR)
────────────────────────────────────────────────────────────────────────── */
export async function generateSystemRequirementsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const mitigationKey = `Mitigation Strategies${NS}`;
  const outKey = `System Requirements${NS}`;

  const mitigationSheet = sheets[mitigationKey];
  if (!mitigationSheet || mitigationSheet.length < 2) {
    logger.warn(`⚠️ '${mitigationKey}' sheet is missing or empty.`);
    return;
  }

  const header = ["Mitigation Strategy", "System Requirement"];
  const rows = [header];

  for (let i = 1; i < mitigationSheet.length; i++) {
    const mitigation = getCellText(mitigationSheet[i][1]);
    if (!mitigation) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
Write ONE requirement derived from this mitigation:

"${mitigation}"

Requirements:
- Begin with "The HR function shall..."
- Be clear, specific, and verifiable (measurable where possible)
- Avoid tooling/implementation detail
Return only the shall-statement.
`.trim();

    let requirement = "";
    try {
      requirement = await fetchLLMResponse(prompt);
    } catch (err) {
      logger.error("LLM error for system requirement:", err);
      requirement = "(error generating requirement)";
    }

    rows.push([sanitizeText(mitigation), sanitizeText(requirement)]);
  }

  const updatedSheets = { ...sheets, [outKey]: rows };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: { ...prev[currentFolder], ...updatedSheets },
  }));

  const nextUpdatedSheets = await generateBatchedRequirementsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  return nextUpdatedSheets;
}

/* ──────────────────────────────────────────────────────────────────────────
   6) CONSOLIDATION (HR)
────────────────────────────────────────────────────────────────────────── */
export async function generateBatchedRequirementsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const systemReqKey = `System Requirements${NS}`;
  const outKey = `Consolidated Requirements${NS}`;

  const systemReqs = sheets[systemReqKey] || sheets[`Generated System Requirements${NS}`];
  if (!systemReqs || systemReqs.length < 2) {
    logger.warn(`⚠️ '${systemReqKey}' sheet is missing or empty.`);
    return;
  }

  const originalRequirements = systemReqs
    .slice(1)
    .map((row) => getCellText(row[1]))
    .filter((req) => req && req.length > 0);

  function chunkRequirements(list, maxChars = 6000) {
    const chunks = [];
    let currentChunk = [];
    let currentLength = 0;

    for (let req of list) {
      const reqLength = req.length + 5;
      if (currentLength + reqLength > maxChars) {
        chunks.push(currentChunk);
        currentChunk = [req];
        currentLength = reqLength;
      } else {
        currentChunk.push(req);
        currentLength += reqLength;
      }
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);
    return chunks;
  }

  const chunks = chunkRequirements(originalRequirements);
  const finalRows = [["Original Requirement", "Consolidated Requirement"]];

  function extractJsonFromMarkdown(text) {
    const firstBracket = text.indexOf("[");
    const lastBracket = text.lastIndexOf("]");
    if (firstBracket === -1 || lastBracket === -1 || firstBracket >= lastBracket) return text;
    return text.slice(firstBracket, lastBracket + 1).trim();
  }

  for (const chunk of chunks) {
    const jsonArray = JSON.stringify(chunk, null, 2);

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `You are consolidating HR policy/process requirements.

Here is a list of requirements:
${jsonArray}

Instructions:
1. Group by shared HR intent, mitigation theme, or barrier.
2. Generalize where appropriate across similar HR + AI issues (hiring, performance, learning, change, data).
3. For each group, return ONE consolidated requirement that:
   - Begins with "The HR function shall..."
   - Describes a single policy/process obligation
   - Is clear, specific, and testable
   - Avoids implementation detail

If a requirement cannot be consolidated, return it unchanged and append an asterisk (*).

Output format:
[
  { "original": "<original requirement>", "consolidated": "<consolidated requirement>" }
]`;

    const details = sheets?.["System Details"];
    const detailsText = details ? flattenSheetData(details).slice(0, 5000) : "";

    const response = await fetchLLMResponse(prompt, {}, ["google_drive"], detailsText);
    const cleanedResponse = extractJsonFromMarkdown(response);

    let parsed;
    try {
      parsed = JSON.parse(cleanedResponse);
    } catch (err) {
      logger.error("❌ Failed to parse LLM JSON response:", err);
      logger.debug("🔎 Raw LLM Response:", response);
      logger.debug("🧹 Cleaned Response:", cleanedResponse);
      continue;
    }

    for (const item of parsed) {
      const original = item.original?.trim();
      let consolidated = item.consolidated?.trim();
      if (original && consolidated) {
        if (original === consolidated) consolidated += " *";
        finalRows.push([original, consolidated]);
      }
    }
  }

  const updatedSheets = { ...sheets, [outKey]: finalRows };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: updatedSheets
  }));

  const nextUpdatedSheets = await generateHazardMappingsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder,
  });

  return nextUpdatedSheets;
}

/* ──────────────────────────────────────────────────────────────────────────
   7) IMPACT (“Hazard”) MAPPINGS (HR)
────────────────────────────────────────────────────────────────────────── */
export async function generateHazardMappingsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalKey = `Causal Factors (What-If)${NS}`;
  const outKey = `Hazard Mappings${NS}`;

  const causalSheet = sheets[causalKey];
  if (!causalSheet || causalSheet.length < 2) {
    logger.warn(`⚠️ '${causalKey}' sheet is missing or empty.`);
    return;
  }

  const header = ["Causal Factor", "Impact Category"];
  const rows = [header];

  for (let i = 1; i < causalSheet.length; i++) {
    const cause = getCellText(causalSheet[i][1]);
    if (!cause) continue;

    const examples = HR_IMPACT_EXAMPLES.map((x) => `- "${x}"`).join("\n");
    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
You are categorizing HR impact for the following causal factor:

"${cause}"

Return ONE short impact category label similar to:
${examples}

Return only the label (no numbering, quotes, or extra text).
`.trim();

    let impact = "";
    try {
      impact = await fetchLLMResponse(prompt);
    } catch (err) {
      logger.error("LLM error generating impact category:", err);
      impact = "(error generating impact)";
    }

    const cleanImpact = impact.split(/;|\n/)[0].trim();
    if (cleanImpact) rows.push([sanitizeText(cause), sanitizeText(cleanImpact)]);
  }

  const updatedSheets = { ...sheets, [outKey]: rows };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: { ...prev[currentFolder], ...updatedSheets }
  }));

  const nextUpdatedSheets = await generateLossMappingsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  return nextUpdatedSheets;
}

/* ──────────────────────────────────────────────────────────────────────────
   8) LOSS MAPPINGS (HR)
────────────────────────────────────────────────────────────────────────── */
export async function generateLossMappingsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const hazardKey = `Hazard Mappings${NS}`;
  const outKey = `Loss Mappings${NS}`;

  const hazardSheet = sheets[hazardKey];
  if (!hazardSheet || hazardSheet.length < 2) {
    logger.warn(`⚠️ '${hazardKey}' sheet is missing or empty.`);
    return;
  }

  const uniqueImpacts = new Set();
  for (let i = 1; i < hazardSheet.length; i++) {
    const impact = getCellText(hazardSheet[i][1]);
    if (impact) uniqueImpacts.add(impact);
  }

  const header = ["Impact Category", "Loss"];
  const rows = [header];

  for (const impact of uniqueImpacts) {
    const allowed = HR_LOSS_CATEGORIES.map((x) => `- ${x}`).join("\n");
    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
Map the impact category below to applicable organizational losses.

Impact Category:
"${impact}"

Use only the following predefined loss categories:
${allowed}

List each applicable loss on its own line. No commentary.
`.trim();

    let lossList = "";
    try {
      lossList = await fetchLLMResponse(prompt);
    } catch (err) {
      logger.error("LLM error for loss mapping:", err);
      lossList = "(error generating losses)";
    }

    const losses = lossList
      .split(/\n|;/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.toLowerCase() !== "(error generating losses)");

    for (const loss of losses) rows.push([sanitizeText(impact), sanitizeText(loss)]);
  }

  const updatedSheets = { ...sheets, [outKey]: rows };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: { ...prev[currentFolder], ...updatedSheets },
  }));

  const nextUpdatedSheets = await generateSummarySheetFromMappings({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  return nextUpdatedSheets;
}

/* ──────────────────────────────────────────────────────────────────────────
   9) SUMMARY (HR)
────────────────────────────────────────────────────────────────────────── */
export async function generateSummarySheetFromMappings({
  sheets,
  setFolders,
  currentFolder
}) {
  logger.debug("🔍 [Summary Gen - HR] Checking required sheets...");

  const causalKey = `Causal Factors (What-If)${NS}`;
  const hazardKey = `Hazard Mappings${NS}`;
  const lossKey = `Loss Mappings${NS}`;
  const mitigationKey = `Mitigation Strategies${NS}`;
  const systemReqKey = `System Requirements${NS}`;
  const consolidatedKey = `Consolidated Requirements${NS}`;
  const outKey = `Summary${NS}`;

  const causalSheet = sheets[causalKey];
  const hazardSheet = sheets[hazardKey];
  const lossSheet = sheets[lossKey];
  const mitigationSheet = sheets[mitigationKey];
  const systemReqSheet = sheets[systemReqKey];
  const consolidatedReqSheet = sheets[consolidatedKey];

  const sheetStatus = {
    [causalKey]: !!causalSheet && causalSheet.length >= 2,
    [hazardKey]: !!hazardSheet && hazardSheet.length >= 2,
    [lossKey]: !!lossSheet && lossSheet.length >= 2,
    [mitigationKey]: !!mitigationSheet && mitigationSheet.length >= 2,
    [systemReqKey]: !!systemReqSheet && systemReqSheet.length >= 2,
    [consolidatedKey]: !!consolidatedReqSheet && consolidatedReqSheet.length >= 2,
  };
  logger.debug("🔍 [Summary Gen - HR] Sheet presence check:", sheetStatus);

  const missingSheets = Object.entries(sheetStatus).filter(([, ok]) => !ok).map(([k]) => k);
  if (missingSheets.length) {
    logger.warn(`⚠️ [Summary Gen] Missing/insufficient sheets: ${missingSheets.join(", ")}`);
    return;
  }

  const header = [
    "Loss",
    "Hazard",                // kept for compatibility; here = Impact Category
    "What-If Scenario",
    "Causal Factor",
    "Mitigation Strategy",
    "System Requirement",
    "Consolidated Requirement"
  ];
  const rows = [header];

  const impactMap = new Map();              // Causal Factor → Impact
  const lossMap = new Map();                // Impact → [Loss]
  const mitigationMap = new Map();          // Causal Factor → Mitigation
  const mitigationToSystemReq = new Map();  // Mitigation → System Req
  const systemReqToConsolidated = new Map();// System Req → Consolidated

  for (let i = 1; i < hazardSheet.length; i++) {
    const cause = getCellText(hazardSheet[i][0]);
    const impact = getCellText(hazardSheet[i][1]);
    if (cause && impact) impactMap.set(cause.trim(), impact.trim());
  }

  for (let i = 1; i < lossSheet.length; i++) {
    const impact = getCellText(lossSheet[i][0]);
    const loss = getCellText(lossSheet[i][1]);
    if (!impact || !loss) continue;
    const key = impact.trim();
    if (!lossMap.has(key)) lossMap.set(key, []);
    lossMap.get(key).push(loss.trim());
  }

  for (let i = 1; i < mitigationSheet.length; i++) {
    const cause = getCellText(mitigationSheet[i][0]);
    const mitigation = getCellText(mitigationSheet[i][1]);
    if (cause && mitigation) mitigationMap.set(cause.trim(), mitigation.trim());
  }

  for (let i = 1; i < systemReqSheet.length; i++) {
    const mitigation = getCellText(systemReqSheet[i][0]);
    const systemReq = getCellText(systemReqSheet[i][1]);
    if (mitigation && systemReq) {
      mitigationToSystemReq.set(mitigation.trim(), systemReq.trim());
    }
  }

  for (let i = 1; i < consolidatedReqSheet.length; i++) {
    const original = getCellText(consolidatedReqSheet[i][0]);
    const consolidated = getCellText(consolidatedReqSheet[i][1]);
    if (original && consolidated) {
      systemReqToConsolidated.set(normalizeText(original), consolidated.trim());
    }
  }

  const causalToScenario = new Map();
  for (let i = 1; i < causalSheet.length; i++) {
    const scenario = getCellText(causalSheet[i][0]); // "What-If Scenario" text
    const causalFactor = getCellText(causalSheet[i][1]);
    if (scenario && causalFactor) {
      causalToScenario.set(causalFactor.trim(), scenario.trim());
    }
  }

  for (const [causalFactor, scenario] of causalToScenario.entries()) {
    const impact = impactMap.get(causalFactor) || "(impact not found)";
    const losses = lossMap.get(impact) || ["(loss not found)"];
    const mitigation = mitigationMap.get(causalFactor) || "(mitigation not found)";
    const rawSystemReq = mitigationToSystemReq.get((mitigation || "").trim());
    const systemReq = rawSystemReq || "(requirement not found)";
    const consolidated = rawSystemReq
      ? systemReqToConsolidated.get(normalizeText(rawSystemReq)) || "(consolidated requirement not found)"
      : "(requirement not found)";

    for (const loss of losses) {
      rows.push([
        sanitizeText(loss),
        sanitizeText(impact),
        sanitizeText(scenario),
        sanitizeText(causalFactor),
        sanitizeText(mitigation),
        sanitizeText(systemReq),
        sanitizeText(consolidated)
      ]);
    }
  }

  const updatedSheets = { ...sheets, [outKey]: rows };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: { ...prev[currentFolder], ...updatedSheets },
  }));

  await saveFoldersToDB({
    ...(await loadFoldersFromDB()),
    [currentFolder]: {
      ...(updatedSheets[currentFolder] || updatedSheets),
      ...updatedSheets
    }
  });

  return updatedSheets;
}
