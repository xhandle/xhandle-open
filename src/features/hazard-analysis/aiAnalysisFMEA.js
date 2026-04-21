/**
 * xHandle: FMEA hazard-analysis pipeline.
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
    .replace(/^[-–—•·\s"]+/, "")       // remove leading bullets, dashes, quotes
    .replace(/["“”‘’]+$/, "")         // remove trailing quotes
    .replace(/\s+/g, " ")             // normalize whitespace
    .replace(/[“”]/g, '"')            // convert smart quotes to standard quotes
    .replace(/[‘’]/g, "'")            // convert smart apostrophes
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
    .replace(/["'\-–—•·]+/g, "") // remove punctuation
    .replace(/\s+/g, " ")        // collapse extra whitespace
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
//export const fetchLLMResponse = async (prompt, sysmlData = {}, selectedContexts = ["google_drive", "jira", "github"]) => {
  try {
    const contexts = [];

    let fullContext = contexts.map(ctx => `#### **${ctx.name} Context:**\n${ctx.content}`).join("\n\n");

    if (additionalContextText) {
      fullContext += `\n\n#### **System Details Sheet:**\n${additionalContextText}`;
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
### SysML Diagram Context

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
            { role: "system", content: fullContext },
            { role: "user", content: prompt },
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
    logger.error("🚨 Error in fetchLLMResponse (via xhandle prompt logic):", error);
    return "(error)";
  }
};





// Optional: You can customize how much spreadsheet data to include
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

/**
 * generateFailureModeSeedSheet constructs the analysis rows, prompt payload, or report fragment needed by the active hazard-analysis method for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function generateFailureModeSeedSheet({ sheets, setFolders, currentFolder }) {
  logger.debug("📥 Entered generateFailureModeSeedSheet");

  const decomposition = sheets["Functional Decomposition"];
  if (!decomposition || decomposition.length === 0) return;

  const headers = [
    "Control Action",
    "No / Not",
    "More",
    "Less",
    "Early",
    "Late",
    "Wrong",
    "Reverse",
    "Intermittent",
    "Unintended",
  ];  

  const newSheet = [headers];

  for (let i = 1; i < decomposition.length; i++) {
    const row = decomposition[i];
    const from = getCellText(row[0]);
    const action = getCellText(row[1]);
    const to = getCellText(row[2]);

    if (from && action && to) {
      const controlAction = `${from} provides the ${action} control action to ${to}`;
      
      // Optionally use LLM here to refine phrasing, validate control semantics, or pre-check hazards
      // const llmPrompt = `Given this functional control action: "${controlAction}", identify any obvious unsafe characteristics...`
      // const llmResponse = await fetchLLMResponse(llmPrompt, {}, [], flattenedDecomposition);

      newSheet.push([controlAction, "", "", "", "", "", "", "", "", ""]);
    }
  }

  // ✅ Save updated sheet into current folder
  const updatedFolder = {
    ...sheets,
    "Unsafe Control Actions": newSheet,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedFolder,
    },
  }));

  logger.debug("✅ Generated Unsafe Control Actions sheet with decomposition context");
  return updatedFolder;
}

/**
 * populateFMEAColumnsWithLLM executes one step of the hazard-analysis pipeline. This keeps the broader xHandle flow readable by isolating a named stage in the processing pipeline instead of mixing every transformation into one large procedure.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @param setChatPrompt UI state setter used to expose the generated prompt for user review.
 * @param setChatResponse UI state setter used to surface model output or analysis progress.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function populateFMEAColumnsWithLLM({
  sheets,
  setFolders,
  currentFolder,
  setChatPrompt,
  setChatResponse,
}) {
  logger.debug("📊 populateFMEAColumnsWithLLM called");

  const sheet = sheets["Unsafe Control Actions"]; // Or "Failure Modes and Effects" if renamed
  if (!sheet || sheet.length < 2) {
    logger.warn("⚠️ Failure Modes sheet is missing or empty.");
    return;
  }

  const columnHeaders = sheet[0];
  const updatedSheet = [columnHeaders];

  const guidephrases = {
    "No / Not": "not delivered or missing",
    "More": "more than required",
    "Less": "less than required",
    "Early": "delivered earlier than required",
    "Late": "delivered later than needed",
    "Wrong": "the wrong control or format",
    "Reverse": "in the reverse direction or function",
    "Intermittent": "intermittent or unstable",
    "Unintended": "triggered unintentionally",
  };

  let allFailureModes = "";

  for (let rowIndex = 1; rowIndex < sheet.length; rowIndex++) {
    const row = sheet[rowIndex];
    const controlAction = getCellText(row[0]);

    if (!controlAction) {
      updatedSheet.push(new Array(columnHeaders.length).fill(""));
      continue;
    }

    const newRow = [controlAction];

    for (let col = 1; col < columnHeaders.length; col++) {
      const phraseLabel = columnHeaders[col];
      const guidephrase = guidephrases[phraseLabel] || phraseLabel;

      // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
      const prompt = `
You are performing a Failure Modes and Effects Analysis (FMEA).

Given the control action: "${controlAction}"
and the failure condition: "${guidephrase}"

Respond with a concise failure mode, its potential effect, and its cause — in this format:

Failure Mode: ...
Effect: ...
Cause: ...

Use single sentences. Do not include quotes, bullets, or explanation.
      `.trim();

      logger.debug(`🔍 Prompt for row ${rowIndex}, column "${phraseLabel}"`, prompt);

      let response = "";
      try {
        response = await fetchLLMResponse(prompt);
        response = response.trim();

        // Normalize to a compact string (Failure Mode | Effect | Cause)
        const failureMode = /Failure Mode:\s*(.*)/i.exec(response)?.[1]?.trim() || "";
        const effect = /Effect:\s*(.*)/i.exec(response)?.[1]?.trim() || "";
        const cause = /Cause:\s*(.*)/i.exec(response)?.[1]?.trim() || "";

        const combined = `${failureMode} | ${effect} | ${cause}`;
        newRow.push(combined);
        allFailureModes += combined + "; ";
      } catch (err) {
        logger.error(`❌ LLM error on row ${rowIndex}, col "${phraseLabel}"`, err);
        newRow.push("(error)");
      }
    }

    updatedSheet.push(newRow);
  }

  if (typeof setChatResponse === "function") {
    setChatResponse(allFailureModes.trim());
  }

  const updatedSheets = {
    ...sheets,
    "Unsafe Control Actions": updatedSheet, // Or renamed sheet name
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  logger.debug("✅ Finished populating FMEA failure mode columns");
  return updatedSheets;
}

/**
 * generateFMEACausalFactorsSheet constructs the analysis rows, prompt payload, or report fragment needed by the active hazard-analysis method for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function generateFMEACausalFactorsSheet({
  sheets,
  setFolders,
  currentFolder,
}) {
  logger.debug("🧠 generateFMEACausalFactorsSheet called");

  const sheet = sheets["Unsafe Control Actions"];
  if (!sheet || sheet.length < 2) {
    logger.warn("⚠️ 'Unsafe Control Actions' sheet is missing or empty.");
    return sheets;
  }

  const rows = [["Failure Mode", "Causal Factor"]];

  for (let rowIndex = 1; rowIndex < sheet.length; rowIndex++) {
    const row = sheet[rowIndex];
    for (let colIndex = 1; colIndex < row.length; colIndex++) {
      const cell = getCellText(row[colIndex]);
      const [failureMode, , cause] = cell.split("|").map((s) => sanitizeText(s.trim()));
      if (failureMode && cause) {
        rows.push([failureMode, cause]);
      }
    }
  }

  const updatedSheets = {
    ...sheets,
    "Causal Factors": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  logger.debug("✅ Created Causal Factors sheet:", rows.length - 1, "rows");
  return updatedSheets;
}

/**
 * generateMitigationStrategiesSheet constructs the analysis rows, prompt payload, or report fragment needed by the active hazard-analysis method for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function generateMitigationStrategiesSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalSheet = sheets["Causal Factors"];
  if (!causalSheet || causalSheet.length < 2) {
    logger.warn("⚠️ 'Causal Factors' sheet is missing or empty.");
    return;
  }

  const header = ["Causal Factor", "Mitigation Strategy"];
  const rows = [header];

  for (let i = 1; i < causalSheet.length; i++) {
    const cause = getCellText(causalSheet[i][1]); // ✅ column 1 = "Causal Factor"
    if (!cause) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
    You are developing a performance-based, system-level mitigation strategy as part of an FMEA analysis.

    Causal factor:
    ${cause}

    Describe what the system must do or prevent in order to mitigate this cause. 
    Avoid describing how it should be implemented — focus on the intended outcome or behavior.
    Do not include lists, bullets, or implementation details.

    Write your answer as one sentence.
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

  // 🔁 Continue to system requirements step
  const nextUpdatedSheets = await generateSystemRequirementsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  return nextUpdatedSheets;
}

/**
 * generateSystemRequirementsSheet constructs the analysis rows, prompt payload, or report fragment needed by the active hazard-analysis method for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
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
    const mitigation = getCellText(mitigationSheet[i][1]); // column 1 = Mitigation Strategy
    if (!mitigation) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
You are writing a verifiable system requirement for a safety mitigation derived from an FMEA analysis.

Mitigation Strategy:
"${mitigation}"

Write one system-level requirement that addresses this mitigation. The requirement must:
- Begin with "The system shall..."
- Be clear, specific, and verifiable
- Not include implementation details or vague language
- Avoid passive voice and generic placeholders

Output only the shall-statement.
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

  // 🔁 Continue to batching
  const nextUpdatedSheets = await generateBatchedRequirementsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  return nextUpdatedSheets;
}

/**
 * generateBatchedRequirementsSheet constructs the analysis rows, prompt payload, or report fragment needed by the active hazard-analysis method for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
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

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
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
    const prompt = `You are a systems engineer reviewing system-level safety requirements derived from an FMEA analysis.

Here is a list of requirements:
${jsonArray}

Instructions:
1. Group requirements by shared safety intent, failure mitigation, or function.
2. Generalize requirements where possible across:
   - Similar control failures (e.g., delay, omission, reverse action)
   - Redundant language or phrasing
   - Related mitigations for different causes of the same hazard

3. For each group, return a single consolidated requirement that:
   - Begins with "The system shall..."
   - Describes one system-level behavior or responsibility
   - Is clear, specific, and testable
   - Avoids implementation details (UI, protocols, APIs)
   - ❗️DO NOT combine unrelated behaviors into one statement

If a requirement cannot be consolidated, return it unchanged and append an asterisk (*) to mark it as unique.

Output format:
[
  {
    "original": "<original requirement>",
    "consolidated": "<consolidated requirement>"
  },
  ...
]`;

    const systemDetailsSheet = sheets?.["System Details"];
    const systemDetailsText = systemDetailsSheet
      ? flattenSheetData(systemDetailsSheet).slice(0, 5000)
      : "";

    const response = await fetchLLMResponse(prompt, {}, ["google_drive"], systemDetailsText);
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

/**
 * generateHazardMappingsSheet constructs the analysis rows, prompt payload, or report fragment needed by the active hazard-analysis method for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function generateHazardMappingsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalSheet = sheets["Causal Factors"];
  if (!causalSheet || causalSheet.length < 2) {
    logger.warn("⚠️ 'Causal Factors' sheet is missing or empty.");
    return;
  }

  const header = ["Causal Factor", "Hazard Category"];
  const rows = [header];

  for (let i = 1; i < causalSheet.length; i++) {
    const cause = getCellText(causalSheet[i][1]);
    if (!cause) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
You are performing a hazard identification step in a Failure Mode and Effects Analysis (FMEA).

Given the following **causal factor**:
"${cause}"

Assign the most appropriate hazard category that could result from this cause. Return a short descriptive label only, such as:
- "Unintended motion"
- "Loss of braking"
- "Incorrect output signal"

Do not return lists, numbers, or quotes — only one short label.
    `.trim();

    let hazard = "";
    try {
      hazard = await fetchLLMResponse(prompt);
    } catch (err) {
      logger.error("LLM error generating hazard category:", err);
      hazard = "(error generating hazard)";
    }

    const cleanHazard = hazard.split(/;|\n/)[0].trim();
    if (cleanHazard) {
      rows.push([sanitizeText(cause), sanitizeText(cleanHazard)]);
    }
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

  // Continue to Loss Mappings
  const nextUpdatedSheets = await generateLossMappingsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  return nextUpdatedSheets;
}

/**
 * generateLossMappingsSheet constructs the analysis rows, prompt payload, or report fragment needed by the active hazard-analysis method for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
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

  // Get unique hazards from the sheet
  const uniqueHazards = new Set();
  for (let i = 1; i < hazardSheet.length; i++) {
    const hazard = getCellText(hazardSheet[i][1]);
    if (hazard) uniqueHazards.add(hazard);
  }

  const header = ["Hazard", "Loss"];
  const rows = [header];

  for (const hazard of uniqueHazards) {
    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
You are conducting a Failure Mode and Effects Analysis (FMEA). Given the following hazard, identify the types of system-level loss that could occur if this hazard were realized.

Use only the following predefined loss categories:
- Loss of System Performance or Functionality
- Loss of Operational Effectiveness
- Loss of Security
- Loss of Data Integrity or Quality
- Loss of Reliability or Trust
- Loss of Public Perception or Brand Value

Hazard:
"${hazard}"

List each applicable loss on its own line. Do not add commentary or explanations. Return only valid loss categories.
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
      rows.push([sanitizeText(hazard), sanitizeText(loss)]);
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

  // Proceed to summary sheet generation
  const nextUpdatedSheets = await generateSummarySheetFromMappings({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  return nextUpdatedSheets;
}

/**
 * generateSummarySheetFromMappings constructs the analysis rows, prompt payload, or report fragment needed by the active hazard-analysis method for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function generateSummarySheetFromMappings({
  sheets,
  setFolders,
  currentFolder
}) {
  logger.debug("🔍 [Summary Gen] Checking required sheets...");
  const causalSheet = sheets["Causal Factors"];
  const hazardSheet = sheets["Hazard Mappings"];
  const lossSheet = sheets["Loss Mappings"];
  const mitigationSheet = sheets["Mitigation Strategies"];
  const systemReqSheet = sheets["System Requirements"];
  const consolidatedReqSheet = sheets["Consolidated Requirements"];

  const sheetStatus = {
    "Causal Factors": !!causalSheet && causalSheet.length >= 2,
    "Hazard Mappings": !!hazardSheet && hazardSheet.length >= 2,
    "Loss Mappings": !!lossSheet && lossSheet.length >= 2,
    "Mitigation Strategies": !!mitigationSheet && mitigationSheet.length >= 2,
    "System Requirements": !!systemReqSheet && systemReqSheet.length >= 2,
    "Consolidated Requirements": !!consolidatedReqSheet && consolidatedReqSheet.length >= 2,
  };
  
  logger.debug("🔍 [Summary Gen] Sheet presence check:", sheetStatus);
  
  const missingSheets = Object.entries(sheetStatus)
    .filter(([_, present]) => !present)
    .map(([name]) => name);
  
  if (missingSheets.length > 0) {
    logger.warn(`⚠️ [Summary Gen] Missing or insufficient sheets: ${missingSheets.join(", ")}`);
    return;
  }

  const header = [
    "Loss",
    "Hazard",
    "Failure Mode",
    "Causal Factor",
    "Mitigation Strategy",
    "System Requirement",
    "Consolidated Requirement"
  ];
  

  const rows = [header];

  const hazardMap = new Map();                // Causal Factor → Hazard
  const lossMap = new Map();                  // Hazard → [Loss]
  const mitigationMap = new Map();            // Causal Factor → Mitigation
  const mitigationToSystemReq = new Map();    // Mitigation → System Requirement
  const systemReqToConsolidated = new Map();  // System Requirement → Consolidated Requirement

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

  const causalToFailureMode = new Map();

for (let i = 1; i < causalSheet.length; i++) {
  const failureMode = getCellText(causalSheet[i][0]);
  const causalFactor = getCellText(causalSheet[i][1]);
  if (failureMode && causalFactor) {
    causalToFailureMode.set(causalFactor.trim(), failureMode.trim());
  }
}

for (const [causalFactor, failureMode] of causalToFailureMode.entries()) {
  const hazard = hazardMap.get(causalFactor) || "(hazard not found)";
  const losses = lossMap.get(hazard) || ["(loss not found)"];
  const mitigation = mitigationMap.get(causalFactor) || "(mitigation not found)";
  const rawSystemReq = mitigationToSystemReq.get(mitigation.trim());
  const systemReq = rawSystemReq || "(requirement not found)";
  const consolidated = rawSystemReq
    ? systemReqToConsolidated.get(normalizeText(rawSystemReq)) || "(consolidated requirement not found)"
    : "(requirement not found)";

  for (const loss of losses) {
    rows.push([
      sanitizeText(loss),
      sanitizeText(hazard),
      sanitizeText(failureMode),
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

  // ✅ Persist to IndexedDB
  await saveFoldersToDB({
    ...(await loadFoldersFromDB()),
    [currentFolder]: {
      ...updatedSheets[currentFolder] || updatedSheets,
      ...updatedSheets
    }
  });

  return updatedSheets;
}

export async function generateTextbookTraceabilityMatrix({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalSheet = sheets["Causal Factors"];
  const hazardSheet = sheets["Hazard Mappings"];
  const lossSheet = sheets["Loss Mappings"];
  const mitigationSheet = sheets["Mitigation Strategies"];
  const systemReqSheet = sheets["System Requirements"];
  const consolidatedReqSheet = sheets["Consolidated Requirements"];

  const sheetStatus = {
    "Causal Factors": !!causalSheet && causalSheet.length >= 2,
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
    logger.warn(`⚠️ [FMEA Textbook Summary Gen] Missing or insufficient sheets: ${missingSheets.join(", ")}`);
    return;
  }

  const header = [
    "Losses",
    "Hazards",
    "Failure Modes",
    "Causal Factors",
    "Safety Requirements/Constraints",
  ];

  const rows = [header];
  const hazardMap = new Map();
  const lossMap = new Map();
  const mitigationMap = new Map();
  const mitigationToSystemReq = new Map();
  const systemReqToConsolidated = new Map();
  const causalToFailureMode = new Map();

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
    if (original && consolidated) {
      systemReqToConsolidated.set(normalizeText(original), consolidated.trim());
    }
  }

  for (let i = 1; i < causalSheet.length; i++) {
    const failureMode = getCellText(causalSheet[i][0]);
    const causalFactor = getCellText(causalSheet[i][1]);
    if (failureMode && causalFactor) causalToFailureMode.set(causalFactor.trim(), failureMode.trim());
  }

  for (const [causalFactor, failureMode] of causalToFailureMode.entries()) {
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
        sanitizeText(failureMode),
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
