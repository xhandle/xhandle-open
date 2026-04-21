/**
 * xHandle: WhatIf hazard-analysis pipeline.
 * This file contains one of xHandle's AI-assisted safety-analysis pipelines. It prepares prompt inputs from functional decomposition or worksheet data, calls the backend chat proxy, and normalizes the returned analysis into spreadsheet-friendly structures.
 * These modules are the bridge between system architecture data and the domain-specific artifacts that xHandle uses for hazard identification, control-action analysis, causal reasoning, mitigations, and derived requirements.
 * Related files: src/App.js, src/lib/api/backendConfig.js, src/lib/storage/indexedDB.js, src/components/generateAgenticReport.js.
 */

import { saveFoldersToDB, loadFoldersFromDB } from '../../lib/storage/indexedDB'; 
import { backendURL, buildAIAuthOpts } from "../../lib/api/backendConfig";
import { logger } from "../../lib/utils/logger";

/**
 * getCellText reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param cell Input consumed by this step of the xHandle workflow.
 * @returns the normalized data requested by this module.
 */
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

/**
 * fetchLLMResponse sends an xHandle prompt to the backend chat proxy and returns the model text needed by this module. In AI-heavy flows this is the boundary that packages local worksheet context, optional diagram context, and any user-authored prompt text into the request format expected by the server.
 * @param prompt Prompt text or prompt payload supplied to the AI step.
 * @param sysmlData Diagram data passed in so AI steps can reference the current architecture model.
 * @param selectedContexts Enabled retrieval or integration contexts that can enrich the prompt.
 * @param additionalContextText Additional free-form system context appended to the prompt.
 * @returns Promise resolving to the model response text expected by the downstream pipeline step.
 */
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
    
    // Keep SysML support, but this pipeline is DEI-first; only inject if present
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

    // local helper
    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    let response;
    for (let attempt = 1; attempt <= 5; attempt++) {
      response = await fetch(`${backendURL}/api/chat`, {
        method: "POST",
        ...buildAIAuthOpts({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are a DEI (Diversity, Equity, and Inclusion) analyst evaluating social systems: policies, practices, norms, roles, and interpersonal interactions.
Center equity impacts across protected and marginalized groups. Prefer concise, plain language. Return only the requested fields.`,
            },
            {
              role: "user",
              content: fullContext ? `${fullContext}\n\n${prompt}` : prompt,
            },
          ],
          temperature: 0.3,
        }),
      });

      // 429 handling with Retry-After + jitter backoff
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
        continue; // try again
      }

      // non-429: break and process below
      break;
    }

    if (!response.ok) {
      const errTxt = await response.text().catch(() => "");
      throw new Error(`LLM proxy error (${response.status}): ${errTxt}`);
    }

    const json = await response.json(); // ✅ read body exactly once
    logger.debug("📦 Raw LLM response JSON:", json);

    return json?.choices?.[0]?.message?.content?.trim() || "(empty)";


  } catch (error) {
    logger.error("🚨 Error in fetchLLMResponse:", error);
    return "(error)";
  }
};

// ---------- utilities ----------
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

// ===================================================================
// SEED SHEET (DEI-social What-If)
// ===================================================================
export async function generateWhatIfSeedSheet({ sheets, setFolders, currentFolder }) {
  logger.debug("📥 Entered generateWhatIfSeedSheet (DEI)");

  const decomposition = sheets["Functional Decomposition"];
  if (!decomposition || decomposition.length === 0) return;

  // Keep sheet key stable: "What-If Scenarios"
  // Rename columns to DEI-centered prompts (count preserved)
  const headers = [
    "Policy/Practice or Interaction",
    "What if it excludes or overlooks certain groups?",
    "What if it is applied inconsistently across groups?",
    "What if it is biased toward dominant norms?",
    "What if it is delayed for some groups?",
    "What if communication is unclear or inaccessible?",
    "What if power dynamics reverse/overrule safeguards?",
    "What if intended support is missing?"
  ];

  const newSheet = [headers];

  for (let i = 1; i < decomposition.length; i++) {
    const row = decomposition[i];
    const from = getCellText(row[0]);
    const action = getCellText(row[1]);
    const to = getCellText(row[2]);

    if (from && action && to) {
      // Social-system phrasing
      const interaction = `${from} performs "${action}" affecting ${to}`;
      newSheet.push([interaction, "", "", "", "", "", "", ""]);
    }
  }

  const updatedFolder = {
    ...sheets,
    "What-If Scenarios": newSheet,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedFolder,
    },
  }));

  logger.debug("✅ Generated DEI What-If seed sheet");
  return updatedFolder;
}

// ===================================================================
// POPULATE WHAT-IF SCENARIOS (DEI)
// ===================================================================
export async function populateWhatIfScenariosWithLLM({
  sheets,
  setFolders,
  currentFolder,
  setChatPrompt,
  setChatResponse,
}) {
  logger.debug("📊 populateWhatIfScenariosWithLLM (DEI) called");

  const sheet = sheets["What-If Scenarios"];
  if (!sheet || sheet.length < 2) {
    logger.warn("⚠️ What-If Scenarios sheet is missing or empty.");
    return;
  }

  const columnHeaders = sheet[0];
  const updatedSheet = [columnHeaders];

  // Map each column header text to a DEI-oriented condition
  const guidephrases = {
    "What if it excludes or overlooks certain groups?": "excludes, overlooks, or fails to accommodate marginalized groups",
    "What if it is applied inconsistently across groups?": "is applied unevenly or inconsistently across groups",
    "What if it is biased toward dominant norms?": "reflects bias toward dominant cultural norms or standards",
    "What if it is delayed for some groups?": "is delayed or harder to access for some groups",
    "What if communication is unclear or inaccessible?": "is communicated unclearly or via inaccessible channels",
    "What if power dynamics reverse/overrule safeguards?": "power dynamics or gatekeeping overrule safeguards or fair process",
    "What if intended support is missing?": "intended support or accommodation is missing"
  };

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
      const guidephrase = guidephrases[phraseLabel] || phraseLabel;

      // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
      const prompt = `
You are performing a DEI What‑If analysis of a social system (policies, practices, norms, roles, interactions).

Given this interaction:
"${interaction}"

What‑if condition:
"${guidephrase}"

Return three single-sentence fields, concise and neutral:

Scenario: (restate the situation in DEI terms)
Impact: (primary equity impact on people/groups)
Trigger: (the mechanism or condition that causes the impact)

Do not use bullets, quotes, or lists. One sentence per field.
      `.trim();

      logger.debug(`🔍 DEI Prompt for row ${rowIndex}, column "${phraseLabel}"`, prompt);

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

  if (typeof setChatResponse === "function") {
    setChatResponse(allScenarios.trim());
  }

  const updatedSheets = {
    ...sheets,
    "What-If Scenarios": updatedSheet,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  logger.debug("✅ Finished populating DEI What‑If scenario columns");
  return updatedSheets;
}

// ===================================================================
// CAUSAL FACTORS (DEI)
// ===================================================================
export async function generateWhatIfCausalFactorsSheet({
  sheets,
  setFolders,
  currentFolder,
}) {
  logger.debug("🧠 generateWhatIfCausalFactorsSheet (DEI) called");

  const sheet = sheets["What-If Scenarios"];
  if (!sheet || sheet.length < 2) {
    logger.warn("⚠️ 'What-If Scenarios' sheet is missing or empty.");
    return sheets;
  }

  const rows = [["What-If Scenario", "Causal Factor"]];

  for (let rowIndex = 1; rowIndex < sheet.length; rowIndex++) {
    const row = sheet[rowIndex];
    for (let colIndex = 1; colIndex < row.length; colIndex++) {
      const cell = getCellText(row[colIndex]);
      const [whatIfScenario, , cause] = cell.split("|").map((s) => sanitizeText(s.trim()));
      if (whatIfScenario && cause) {
        rows.push([whatIfScenario, cause]);
      }
    }
  }

  const updatedSheets = {
    ...sheets,
    "Causal Factors (What-If)": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  logger.debug("✅ Created DEI Causal Factors sheet:", rows.length - 1, "rows");
  return updatedSheets;
}

// ===================================================================
// MITIGATIONS (DEI) → policy/process interventions
// ===================================================================
export async function generateMitigationStrategiesSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalSheet = sheets["Causal Factors (What-If)"];
  if (!causalSheet || causalSheet.length < 2) {
    logger.warn("⚠️ 'Causal Factors' sheet is missing or empty.");
    return;
  }

  const header = ["Causal Factor", "Mitigation Strategy"];
  const rows = [header];

  for (let i = 1; i < causalSheet.length; i++) {
    const cause = getCellText(causalSheet[i][1]);
    if (!cause) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
You are defining a DEI intervention in response to the following causal factor:

${cause}

Write ONE sentence describing an organizational/policy/process intervention that mitigates this cause.
- Focus on the outcome or constraint (not implementation details).
- Be specific, actionable, and measurable at a program/policy level.
- No lists or bullets.
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

  const updatedSheets = {
    ...sheets,
    "Mitigation Strategies": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  const nextUpdatedSheets = await generateSystemRequirementsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  return nextUpdatedSheets;
}

// ===================================================================
// ORG REQUIREMENTS (DEI) — keep sheet key, change wording
// ===================================================================
export async function generateSystemRequirementsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const mitigationSheet = sheets["Mitigation Strategies"];
  if (!mitigationSheet || mitigationSheet.length < 2) {
    logger.warn("⚠️ 'Mitigation Strategies' sheet is missing or empty.");
    return;
  }

  const header = ["Mitigation Strategy", "System Requirement"];
  const rows = [header];

  for (let i = 1; i < mitigationSheet.length; i++) {
    const mitigation = getCellText(mitigationSheet[i][1]);
    if (!mitigation) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
You are writing an organizational DEI requirement (policy/process requirement) derived from a mitigation.

Mitigation:
"${mitigation}"

Write ONE requirement that:
- Begins with "The organization shall..."
- Is clear, specific, and verifiable (measurable where possible)
- Avoids implementation detail (tools, UIs, internal tech)
- Uses plain language and active voice

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

  const updatedSheets = {
    ...sheets,
    "System Requirements": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  const nextUpdatedSheets = await generateBatchedRequirementsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  return nextUpdatedSheets;
}

// ===================================================================
// CONSOLIDATION (DEI phrasing, same structure)
// ===================================================================
export async function generateBatchedRequirementsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const systemReqs = sheets["System Requirements"] || sheets["Generated System Requirements"];
  if (!systemReqs || systemReqs.length < 2) {
    logger.warn("⚠️ 'System Requirements' sheet is missing or empty.");
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
    if (firstBracket === -1 || lastBracket === -1 || firstBracket >= lastBracket) {
      return text;
    }
    return text.slice(firstBracket, lastBracket + 1).trim();
  }

  for (const chunk of chunks) {
    const jsonArray = JSON.stringify(chunk, null, 2);

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `You are consolidating organizational DEI requirements (policy/process).

Here is a list of requirements:
${jsonArray}

Instructions:
1. Group by shared equity intent, mitigation theme, or target barrier.
2. Generalize where appropriate across similar harms (exclusion, inconsistency, bias, access barriers).
3. For each group, return ONE consolidated requirement that:
   - Begins with "The organization shall..."
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
        if (original === consolidated) {
          consolidated += " *";
        }
        finalRows.push([original, consolidated]);
      }
    }
  }

  const updatedSheets = {
    ...sheets,
    "Consolidated Requirements": finalRows,
  };

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

// ===================================================================
// IMPACT (formerly "Hazard") MAPPINGS (DEI)
// ===================================================================
export async function generateHazardMappingsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalSheet = sheets["Causal Factors (What-If)"];
  if (!causalSheet || causalSheet.length < 2) {
    logger.warn("⚠️ 'Causal Factors' sheet is missing or empty.");
    return;
  }

  const header = ["Causal Factor", "Impact Category"]; // keep sheet key name; change column label
  const rows = [header];

  for (let i = 1; i < causalSheet.length; i++) {
    const cause = getCellText(causalSheet[i][1]);
    if (!cause) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
You are categorizing equity impacts for the following causal factor:

"${cause}"

Return ONE short impact category label such as:
- "Access barrier"
- "Representation gap"
- "Biased evaluation"
- "Hostile environment"
- "Pay/benefit inequity"
- "Exclusion from decision-making"
- "Unequal opportunity progression"

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
    if (cleanImpact) {
      rows.push([sanitizeText(cause), sanitizeText(cleanImpact)]);
    }
  }

  const updatedSheets = {
    ...sheets,
    "Hazard Mappings": rows, // sheet key preserved
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets
    },
  }));

  const nextUpdatedSheets = await generateLossMappingsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  return nextUpdatedSheets;
}

// ===================================================================
// LOSS MAPPINGS (DEI outcomes)
// ===================================================================
export async function generateLossMappingsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const hazardSheet = sheets["Hazard Mappings"];
  if (!hazardSheet || hazardSheet.length < 2) {
    logger.warn("⚠️ 'Hazard Mappings' sheet is missing or empty.");
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
    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
You are mapping DEI impact categories to organizational losses.

Impact Category:
"${impact}"

Use only the following predefined loss categories:
- Equitable access degradation
- Psychological safety erosion
- Retention risk
- Legal/compliance exposure
- Reputation harm
- Inequitable outcomes

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
      .filter((l) =>
        l.length > 0 &&
        l.toLowerCase() !== "(error generating losses)"
      );

    for (const loss of losses) {
      rows.push([sanitizeText(impact), sanitizeText(loss)]);
    }
  }

  const updatedSheets = {
    ...sheets,
    "Loss Mappings": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  const nextUpdatedSheets = await generateSummarySheetFromMappings({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  return nextUpdatedSheets;
}

// ===================================================================
// SUMMARY (structure preserved; DEI semantics)
// ===================================================================
export async function generateSummarySheetFromMappings({
  sheets,
  setFolders,
  currentFolder
}) {
  logger.debug("🔍 [Summary Gen - DEI] Checking required sheets...");
  const causalSheet = sheets["Causal Factors (What-If)"];
  const hazardSheet = sheets["Hazard Mappings"]; // Impact Category in col 1
  const lossSheet = sheets["Loss Mappings"];
  const mitigationSheet = sheets["Mitigation Strategies"];
  const systemReqSheet = sheets["System Requirements"];
  const consolidatedReqSheet = sheets["Consolidated Requirements"];

  const sheetStatus = {
    "Causal Factors (What-If)": !!causalSheet && causalSheet.length >= 2,
    "Hazard Mappings": !!hazardSheet && hazardSheet.length >= 2,
    "Loss Mappings": !!lossSheet && lossSheet.length >= 2,
    "Mitigation Strategies": !!mitigationSheet && mitigationSheet.length >= 2,
    "System Requirements": !!systemReqSheet && systemReqSheet.length >= 2,
    "Consolidated Requirements": !!consolidatedReqSheet && consolidatedReqSheet.length >= 2,
  };
  
  logger.debug("🔍 [Summary Gen - DEI] Sheet presence check:", sheetStatus);
  
  const missingSheets = Object.entries(sheetStatus)
    .filter(([_, present]) => !present)
    .map(([name]) => name);
  
  if (missingSheets.length > 0) {
    logger.warn(`⚠️ [Summary Gen] Missing or insufficient sheets: ${missingSheets.join(", ")}`);
    return;
  }

  // Keep column names stable for downstream consumers
  const header = [
    "Loss",
    "Hazard",                // here "Hazard" = Impact Category (kept for compatibility)
    "What-If Scenario",
    "Causal Factor",
    "Mitigation Strategy",
    "System Requirement",
    "Consolidated Requirement"
  ];
  
  const rows = [header];

  const impactMap = new Map();              // Causal Factor → Impact Category
  const lossMap = new Map();                // Impact Category → [Loss]
  const mitigationMap = new Map();          // Causal Factor → Mitigation
  const mitigationToSystemReq = new Map();  // Mitigation → System Requirement
  const systemReqToConsolidated = new Map();// System Requirement → Consolidated

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
    const rawSystemReq = mitigationToSystemReq.get(mitigation.trim());
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

  const updatedSheets = {
    ...sheets,
    "Summary": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  await saveFoldersToDB({
    ...(await loadFoldersFromDB()),
    [currentFolder]: {
      ...updatedSheets[currentFolder] || updatedSheets,
      ...updatedSheets
    }
  });

  return updatedSheets;
}

export async function generateTextbookWhatIfSeedSheet({ sheets, setFolders, currentFolder }) {
  const decomposition = sheets["Functional Decomposition"];
  if (!decomposition || decomposition.length === 0) return;

  const headers = [
    "System Interaction or Operating Situation",
    "What if the action is omitted?",
    "What if the action is incorrect?",
    "What if timing is wrong?",
    "What if sequence or coordination is wrong?",
    "What if assumptions about inputs are wrong?",
    "What if a safeguard or feedback path is unavailable?",
    "What if external conditions degrade performance?"
  ];

  const newSheet = [headers];

  for (let i = 1; i < decomposition.length; i++) {
    const row = decomposition[i];
    const from = getCellText(row[0]);
    const action = getCellText(row[1]);
    const to = getCellText(row[2]);
    if (from && action && to) {
      newSheet.push([`${from} provides ${action} to ${to}`, "", "", "", "", "", "", ""]);
    }
  }

  const updatedSheets = {
    ...sheets,
    "What-If Scenarios": newSheet,
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

export async function populateTextbookWhatIfScenariosWithLLM({
  sheets,
  setFolders,
  currentFolder,
  setChatPrompt,
  setChatResponse,
}) {
  const sheet = sheets["What-If Scenarios"];
  if (!sheet || sheet.length < 2) {
    logger.warn("⚠️ What-If Scenarios sheet is missing or empty.");
    return;
  }

  const columnHeaders = sheet[0];
  const updatedSheet = [columnHeaders];

  const guidephrases = {
    "What if the action is omitted?": "the action is omitted or not provided when needed",
    "What if the action is incorrect?": "the action is incorrect, incomplete, or applied to the wrong target",
    "What if timing is wrong?": "the action occurs too early, too late, or for the wrong duration",
    "What if sequence or coordination is wrong?": "sequence, coordination, or mode logic is incorrect",
    "What if assumptions about inputs are wrong?": "inputs, process-model assumptions, or sensed conditions are wrong",
    "What if a safeguard or feedback path is unavailable?": "feedback, monitoring, or a safeguard is missing or unavailable",
    "What if external conditions degrade performance?": "environmental or operational conditions degrade performance"
  };

  let allScenarios = "";

  for (let rowIndex = 1; rowIndex < sheet.length; rowIndex++) {
    const row = sheet[rowIndex];
    const situation = getCellText(row[0]);
    if (!situation) {
      updatedSheet.push(new Array(columnHeaders.length).fill(""));
      continue;
    }

    const newRow = [situation];

    for (let col = 1; col < columnHeaders.length; col++) {
      const guidephrase = guidephrases[columnHeaders[col]] || columnHeaders[col];
      const prompt = `
You are performing a textbook engineering What-If analysis.

Base situation:
"${situation}"

Guideword / deviation:
"${guidephrase}"

Return three single-sentence fields:
Scenario: a concise what-if scenario statement
Consequence: the primary unsafe or undesirable consequence
Cause: the causal factor, triggering condition, or initiating mechanism

Do not use bullets, numbering, or quotes.
      `.trim();

      let response = "";
      try {
        response = await fetchLLMResponse(prompt);
        const scenario = /Scenario:\s*(.*)/i.exec(response)?.[1]?.trim() || "";
        const consequence = /Consequence:\s*(.*)/i.exec(response)?.[1]?.trim() || "";
        const cause = /Cause:\s*(.*)/i.exec(response)?.[1]?.trim() || "";
        const combined = `${scenario} | ${consequence} | ${cause}`;
        newRow.push(combined);
        allScenarios += combined + "; ";
      } catch (err) {
        logger.error(`❌ LLM error on textbook What-If row ${rowIndex}, col "${columnHeaders[col]}"`, err);
        newRow.push("(error)");
      }
    }

    updatedSheet.push(newRow);
  }

  if (typeof setChatPrompt === "function") setChatPrompt("Textbook What-If analysis");
  if (typeof setChatResponse === "function") setChatResponse(allScenarios.trim());

  const updatedSheets = {
    ...sheets,
    "What-If Scenarios": updatedSheet,
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

export async function generateTextbookWhatIfCausalFactorsSheet({
  sheets,
  setFolders,
  currentFolder,
}) {
  const sheet = sheets["What-If Scenarios"];
  if (!sheet || sheet.length < 2) {
    logger.warn("⚠️ 'What-If Scenarios' sheet is missing or empty.");
    return sheets;
  }

  const rows = [["What-If Scenario", "Causal Factor"]];

  for (let rowIndex = 1; rowIndex < sheet.length; rowIndex++) {
    const row = sheet[rowIndex];
    for (let colIndex = 1; colIndex < row.length; colIndex++) {
      const cell = getCellText(row[colIndex]);
      const [scenario, , cause] = cell.split("|").map((s) => sanitizeText(s.trim()));
      if (scenario && cause) rows.push([scenario, cause]);
    }
  }

  const updatedSheets = {
    ...sheets,
    "Causal Factors (What-If)": rows,
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

export async function generateTextbookWhatIfMitigationStrategiesSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalSheet = sheets["Causal Factors (What-If)"];
  if (!causalSheet || causalSheet.length < 2) {
    logger.warn("⚠️ 'Causal Factors (What-If)' sheet is missing or empty.");
    return;
  }

  const rows = [["Causal Factor", "Mitigation Strategy"]];

  for (let i = 1; i < causalSheet.length; i++) {
    const cause = getCellText(causalSheet[i][1]);
    if (!cause) continue;

    const prompt = `
You are defining a mitigation for a textbook engineering What-If analysis.

Causal factor:
${cause}

Write one concise sentence describing what the system must do, prevent, monitor, or constrain to mitigate this causal factor.
Focus on the intended control outcome, not implementation detail.
    `.trim();

    let mitigation = "";
    try {
      mitigation = await fetchLLMResponse(prompt);
    } catch (err) {
      logger.error("LLM error for textbook What-If mitigation:", err);
      mitigation = "(error generating mitigation)";
    }

    rows.push([sanitizeText(cause), sanitizeText(mitigation)]);
  }

  const updatedSheets = {
    ...sheets,
    "Mitigation Strategies": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  return generateTextbookWhatIfSystemRequirementsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder,
  });
}

export async function generateTextbookWhatIfSystemRequirementsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const mitigationSheet = sheets["Mitigation Strategies"];
  if (!mitigationSheet || mitigationSheet.length < 2) {
    logger.warn("⚠️ 'Mitigation Strategies' sheet is missing or empty.");
    return;
  }

  const rows = [["Mitigation Strategy", "System Requirement"]];

  for (let i = 1; i < mitigationSheet.length; i++) {
    const mitigation = getCellText(mitigationSheet[i][1]);
    if (!mitigation) continue;

    const prompt = `
You are writing a system requirement derived from a textbook engineering What-If analysis.

Mitigation:
"${mitigation}"

Write one system-level shall statement that:
- Begins with "The system shall..."
- Is clear, specific, and verifiable
- Avoids implementation detail

Return only the shall-statement.
    `.trim();

    let requirement = "";
    try {
      requirement = await fetchLLMResponse(prompt);
    } catch (err) {
      logger.error("LLM error for textbook What-If system requirement:", err);
      requirement = "(error generating requirement)";
    }

    rows.push([sanitizeText(mitigation), sanitizeText(requirement)]);
  }

  const updatedSheets = {
    ...sheets,
    "System Requirements": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  return generateTextbookWhatIfBatchedRequirementsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder,
  });
}

export async function generateTextbookWhatIfBatchedRequirementsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const systemReqs = sheets["System Requirements"] || sheets["Generated System Requirements"];
  if (!systemReqs || systemReqs.length < 2) {
    logger.warn("⚠️ 'System Requirements' sheet is missing or empty.");
    return;
  }

  const originalRequirements = systemReqs
    .slice(1)
    .map((row) => getCellText(row[1]))
    .filter((req) => req && req.length > 0);

  const finalRows = [["Original Requirement", "Consolidated Requirement"]];

  function chunkRequirements(list, maxChars = 6000) {
    const chunks = [];
    let currentChunk = [];
    let currentLength = 0;
    for (const req of list) {
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

  function extractJsonFromMarkdown(text) {
    const firstBracket = text.indexOf("[");
    const lastBracket = text.lastIndexOf("]");
    if (firstBracket === -1 || lastBracket === -1 || firstBracket >= lastBracket) return text;
    return text.slice(firstBracket, lastBracket + 1).trim();
  }

  for (const chunk of chunkRequirements(originalRequirements)) {
    const prompt = `You are consolidating system requirements derived from a textbook engineering What-If analysis.

Requirements:
${JSON.stringify(chunk, null, 2)}

Return JSON only:
[
  { "original": "<original requirement>", "consolidated": "<consolidated requirement>" }
]

Rules:
- Consolidated requirements must begin with "The system shall..."
- Consolidate only requirements with shared intent
- Keep each consolidated requirement focused on one behavior
- If a requirement is unique, return it unchanged with an asterisk (*) appended
`;

    const details = sheets?.["System Details"];
    const detailsText = details ? flattenSheetData(details).slice(0, 5000) : "";
    const response = await fetchLLMResponse(prompt, {}, ["google_drive"], detailsText);
    const cleanedResponse = extractJsonFromMarkdown(response);

    let parsed;
    try {
      parsed = JSON.parse(cleanedResponse);
    } catch (err) {
      logger.error("❌ Failed to parse textbook What-If consolidation JSON:", err);
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

  const updatedSheets = {
    ...sheets,
    "Consolidated Requirements": finalRows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: updatedSheets
  }));

  return generateTextbookWhatIfHazardMappingsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder,
  });
}

export async function generateTextbookWhatIfHazardMappingsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalSheet = sheets["Causal Factors (What-If)"];
  if (!causalSheet || causalSheet.length < 2) {
    logger.warn("⚠️ 'Causal Factors (What-If)' sheet is missing or empty.");
    return;
  }

  const rows = [["Causal Factor", "Hazard Category"]];

  for (let i = 1; i < causalSheet.length; i++) {
    const cause = getCellText(causalSheet[i][1]);
    if (!cause) continue;

    const prompt = `
Assign a concise engineering hazard category to the following causal factor.

Causal Factor:
"${cause}"

Return one short label only, such as "Loss of control", "Incorrect actuation", or "Unexpected shutdown".
    `.trim();

    let hazard = "";
    try {
      hazard = await fetchLLMResponse(prompt);
    } catch (err) {
      logger.error("LLM error generating textbook What-If hazard category:", err);
      hazard = "(error generating hazard)";
    }

    const cleanHazard = hazard.split(/;|\n/)[0].trim();
    if (cleanHazard) rows.push([sanitizeText(cause), sanitizeText(cleanHazard)]);
  }

  const updatedSheets = {
    ...sheets,
    "Hazard Mappings": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets
    },
  }));

  return generateTextbookWhatIfLossMappingsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });
}

export async function generateTextbookWhatIfLossMappingsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const hazardSheet = sheets["Hazard Mappings"];
  if (!hazardSheet || hazardSheet.length < 2) {
    logger.warn("⚠️ 'Hazard Mappings' sheet is missing or empty.");
    return;
  }

  const uniqueHazards = new Set();
  for (let i = 1; i < hazardSheet.length; i++) {
    const hazard = getCellText(hazardSheet[i][1]);
    if (hazard) uniqueHazards.add(hazard);
  }

  const rows = [["Hazard", "Loss"]];

  for (const hazard of uniqueHazards) {
    const prompt = `
Based on the hazard below, list the applicable system-level losses.
Use only these loss categories:
- Loss of System Performance or Functionality
- Loss of Operational Effectiveness
- Loss of Security
- Loss of Data Integrity or Quality
- Loss of Reliability or Trust
- Loss of Public Perception or Brand Value

Hazard:
"${hazard}"

List each applicable loss on its own line. No commentary.
    `.trim();

    let lossList = "";
    try {
      lossList = await fetchLLMResponse(prompt);
    } catch (err) {
      logger.error("LLM error for textbook What-If loss mapping:", err);
      lossList = "(error generating losses)";
    }

    const losses = lossList
      .split(/\n|;/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.toLowerCase() !== "(error generating losses)");

    for (const loss of losses) rows.push([sanitizeText(hazard), sanitizeText(loss)]);
  }

  const updatedSheets = {
    ...sheets,
    "Loss Mappings": rows,
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

export async function generateTextbookWhatIfTraceabilityMatrix({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalSheet = sheets["Causal Factors (What-If)"];
  const hazardSheet = sheets["Hazard Mappings"];
  const lossSheet = sheets["Loss Mappings"];
  const mitigationSheet = sheets["Mitigation Strategies"];
  const systemReqSheet = sheets["System Requirements"];
  const consolidatedReqSheet = sheets["Consolidated Requirements"];

  const sheetStatus = {
    "Causal Factors (What-If)": !!causalSheet && causalSheet.length >= 2,
    "Hazard Mappings": !!hazardSheet && hazardSheet.length >= 2,
    "Loss Mappings": !!lossSheet && lossSheet.length >= 2,
    "Mitigation Strategies": !!mitigationSheet && mitigationSheet.length >= 2,
    "System Requirements": !!systemReqSheet && systemReqSheet.length >= 2,
    "Consolidated Requirements": !!consolidatedReqSheet && consolidatedReqSheet.length >= 2,
  };

  const missingSheets = Object.entries(sheetStatus)
    .filter(([, present]) => !present)
    .map(([name]) => name);

  if (missingSheets.length > 0) {
    logger.warn(`⚠️ [What-If Textbook Summary Gen] Missing or insufficient sheets: ${missingSheets.join(", ")}`);
    return;
  }

  const header = [
    "Losses",
    "Hazards",
    "What-If Scenarios",
    "Causal Factors",
    "Safety Requirements/Constraints",
  ];

  const rows = [header];
  const hazardMap = new Map();
  const lossMap = new Map();
  const mitigationMap = new Map();
  const mitigationToSystemReq = new Map();
  const systemReqToConsolidated = new Map();
  const causalToScenario = new Map();

  for (let i = 1; i < hazardSheet.length; i++) {
    const cause = getCellText(hazardSheet[i][0]);
    const hazard = getCellText(hazardSheet[i][1]);
    if (cause && hazard) hazardMap.set(cause.trim(), hazard.trim());
  }

  for (let i = 1; i < lossSheet.length; i++) {
    const hazard = getCellText(lossSheet[i][0]);
    const loss = getCellText(lossSheet[i][1]);
    if (!hazard || !loss) continue;
    const key = hazard.trim();
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
    if (mitigation && systemReq) mitigationToSystemReq.set(mitigation.trim(), systemReq.trim());
  }

  for (let i = 1; i < consolidatedReqSheet.length; i++) {
    const original = getCellText(consolidatedReqSheet[i][0]);
    const consolidated = getCellText(consolidatedReqSheet[i][1]);
    if (original && consolidated) systemReqToConsolidated.set(normalizeText(original), consolidated.trim());
  }

  for (let i = 1; i < causalSheet.length; i++) {
    const scenario = getCellText(causalSheet[i][0]);
    const causalFactor = getCellText(causalSheet[i][1]);
    if (scenario && causalFactor) causalToScenario.set(causalFactor.trim(), scenario.trim());
  }

  for (const [causalFactor, scenario] of causalToScenario.entries()) {
    const hazard = hazardMap.get(causalFactor) || "(hazard not found)";
    const losses = lossMap.get(hazard) || ["(loss not found)"];
    const mitigation = mitigationMap.get(causalFactor) || "";
    const rawSystemReq = mitigation ? mitigationToSystemReq.get(mitigation.trim()) : "";
    const safetyRequirement =
      (rawSystemReq && (systemReqToConsolidated.get(normalizeText(rawSystemReq)) || rawSystemReq)) ||
      "(safety requirement/constraint not found)";

    for (const loss of losses) {
      rows.push([
        sanitizeText(loss),
        sanitizeText(hazard),
        sanitizeText(scenario),
        sanitizeText(causalFactor),
        sanitizeText(safetyRequirement),
      ]);
    }
  }

  const updatedSheets = {
    ...sheets,
    "Traceability Matrix": rows,
    Summary: rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  await saveFoldersToDB({
    ...(await loadFoldersFromDB()),
    [currentFolder]: {
      ...updatedSheets[currentFolder] || updatedSheets,
      ...updatedSheets
    }
  });

  return updatedSheets;
}
