/**
 * xHandle: STPA hazard-analysis pipeline.
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

function parseLineOrSemicolonList(text) {
  return String(text || "")
    .split(/\n|;/)
    .map((item) => sanitizeText(item))
    .filter((item) => item.length > 0)
    .filter((item) => !/^\(error/i.test(item));
}

function dedupeList(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = normalizeText(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function collectUnsafeControlActions(sheet = []) {
  const out = [];
  for (let rowIndex = 1; rowIndex < sheet.length; rowIndex++) {
    const row = sheet[rowIndex] || [];
    for (let colIndex = 1; colIndex < row.length; colIndex++) {
      const value = sanitizeText(getCellText(row[colIndex]));
      if (value && !/^\(llm error\)$/i.test(value)) out.push(value);
    }
  }
  return dedupeList(out);
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

    // small helper local to this function
const wait = (ms) => new Promise(r => setTimeout(r, ms));

let response;
for (let attempt = 1; attempt <= 5; attempt++) {
  const requestInit = {
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
  };

  try {
    response = await fetch(`${backendURL}/api/chat`, requestInit);
  } catch (err) {
    const msg = String(err?.message || err);
    const isNetworkFailure = /failed to fetch|networkerror|load failed/i.test(msg);
    if (!isNetworkFailure) throw err;
    // Fall back to the CRA dev proxy when the explicit backend URL is unreachable.
    response = await fetch("/api/chat", requestInit);
  }

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

const json = await response.json();             // ✅ read body exactly once
logger.debug("📦 Raw LLM response JSON:", json); // (optional)

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
 * generateUnsafeControlActionsSheet constructs the analysis rows, prompt payload, or report fragment needed by the active hazard-analysis method for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function generateUnsafeControlActionsSheet({ sheets, setFolders, currentFolder }) {
  logger.debug("📥 Entered generateUnsafeControlActionsSheet");

  const decomposition = sheets["Functional Decomposition"];
  if (!decomposition || decomposition.length === 0) return;

  const headers = [
    "Control Action",
    "Providing Causes Hazard",
    "Not Providing Causes Hazard",
    "Provide Too Soon",
    "Provided too Late",
    "Provided in The wrong order",
    "Stopped Too Soon",
    "Applied Too Long",
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

      newSheet.push([controlAction, "", "", "", "", "", "", ""]);
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
 * populateUCATimingColumnsWithLLM executes one step of the hazard-analysis pipeline. This keeps the broader xHandle flow readable by isolating a named stage in the processing pipeline instead of mixing every transformation into one large procedure.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @param setChatPrompt UI state setter used to expose the generated prompt for user review.
 * @param setChatResponse UI state setter used to surface model output or analysis progress.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function populateUCATimingColumnsWithLLM({
  sheets,
  setFolders,
  currentFolder,
  setChatPrompt,
  setChatResponse,
}) {
  logger.debug("📊 populateUCATimingColumnsWithLLM called");

  const sheet = sheets["Unsafe Control Actions"];
  logger.debug("🔍 Initial Unsafe Control Actions sheet:", sheet);
  logger.debug("🔎 Number of rows in Unsafe Control Actions sheet:", sheet?.length);
  if (!sheet || sheet.length < 2) {
    logger.warn("⚠️ 'Unsafe Control Actions' sheet is missing or empty.");
    return;
  }

  const columnHeaders = sheet[0]; // First row = header row
  const updatedSheet = [columnHeaders]; // Start with header row

  const promptModifiers = {
    "Providing Causes Hazard": [
      "provides",
      "provided",
      "issued"
    ],
    "Not Providing Causes Hazard": [
      "failed to provide",
      "did not provide",
      "omitted"
    ],
    "Provide Too Soon": [
      "provided too early",
      "issued prematurely",
      "sent before appropriate timing"
    ],
    "Provided too Late": [
      "provided too late",
      "issued with delay",
      "sent after required time"
    ],
    "Provided in The wrong order": [
      "provided out of sequence",
      "issued in incorrect order",
      "sent before dependent control"
    ],
    "Stopped Too Soon": [
      "stopped providing too soon",
      "terminated prematurely",
      "halted before completion"
    ],
    "Applied Too Long": [
      "provided for too long",
      "continued unnecessarily",
      "extended beyond safe duration"
    ]
  };

  let fullResponseText = "";

  for (let rowIndex = 1; rowIndex < sheet.length; rowIndex++) {
    //await sleep(300); // ⏳ Wait 3 seconds before processing each row

    const row = sheet[rowIndex];
    const controlAction = getCellText(row[0]);

    if (!controlAction) {
      updatedSheet.push(["", "", "", "", "", "", "", ""]);
      continue;
    }

    const newRow = [controlAction];

    for (let col = 1; col < columnHeaders.length; col++) {
      const modifier = promptModifiers[columnHeaders[col]];
      const phrasing = modifier
        ? controlAction.replace(" to ", ` to ${modifier} `)
        : controlAction;
    
      // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
      const prompt = `Create exactly one unsafe control action describing how "${phrasing}" leads to an undesired effect. 
Write the unsafe control action as a single sentence using clear and correct grammar. 
Use the following format: "[Actor] [verb phrase] [control action] to [recipient], leading to [hazard]." 
Do not use quotations, bullets, or dashes. Do not use awkward or repeated verb forms. 
Separate unsafe control actions using semicolons if needed, but generate only one per prompt.    
      `.trim();
    
      logger.debug(`🔍 Prompt for row ${rowIndex}, column "${columnHeaders[col]}"`, prompt);
    
      let response = "";
    
      try {
        response = await fetchLLMResponse(prompt);
    
        response = response
          .replace(/^.*?(?=\[|\w+\s+\()/s, "")
          .replace(/^.*?(?=User|Operator|System|\[)/s, "")
          .replace(/^(.*?:\s*)/, "")
          .replace(/^(.*?Here is a comprehensive list:)/i, "")
          .replace(/^(.*?can lead to several unsafe control actions[^:]*:)/i, "")
          .trim();
    
        logger.debug("📥 LLM Response:", response);
    
        fullResponseText += response + "; ";
      } catch (err) {
        logger.error(`LLM error for row ${rowIndex}, column ${col}`, err);
        response = "(LLM error)";
      }
    
      newRow.push(response.trim());
    }
    


    updatedSheet.push(newRow);
  }

  const ucaText = fullResponseText.trim();
  if (typeof setChatResponse === "function") {
    setChatResponse(ucaText);
  }
  

logger.debug("📝 Final updated Unsafe Control Actions sheet:", updatedSheet);
logger.debug("🔎 Final row count:", updatedSheet?.length);
const updatedSheets = {
  ...sheets,
  "Unsafe Control Actions": updatedSheet,
};

// Save Unsafe Control Actions sheet
await setFolders((prev) => ({
  ...prev,
  [currentFolder]: {
    ...prev[currentFolder],
    ...updatedSheets,
  },
}));
logger.debug("✅ Saved updated Unsafe Control Actions sheet into folders:", updatedSheets);


// ✅ Automatically create the Causal Factors sheet too
const nextUpdatedSheets = await generateCausalFactorsSheet({
  ucaText,
  sheets: updatedSheets,
  setFolders,
  currentFolder
});

return nextUpdatedSheets;

}

/**
 * generateCausalFactorsSheet constructs the analysis rows, prompt payload, or report fragment needed by the active hazard-analysis method for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param ucaText Input consumed by this step of the xHandle workflow.
 * @param sheets Workbook-style sheet map for the active project.
 * @param setFolders State setter used to persist updated workbook data back into the active folder collection.
 * @param currentFolder Identifier for the folder or workbook branch currently being updated.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function generateCausalFactorsSheet({
  ucaText = "",
  sheets,
  setFolders,
  currentFolder
}) {
  const header = ["Unsafe Control Action Identified"];
  const rows = [header];

  const actions = ucaText
  .split(/;|\n/) // Split on semicolons OR newlines
  .map((a) => a.trim())
  .filter((a) => a.length > 0);

  for (const action of actions) {
    rows.push([sanitizeText(action)]);
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
  



// ✅ Automatically create Mitigation Strategies
const nextUpdatedSheets = await generateMitigationStrategiesSheet({
  sheets: updatedSheets,
  setFolders,
  currentFolder
});

return nextUpdatedSheets;





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

  const header = ["Unsafe Control Action", "Mitigation Strategy"];
  const rows = [header];

  for (let i = 1; i < causalSheet.length; i++) {
    const uca = getCellText(causalSheet[i][0]);
    if (!uca) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
    You are developing performance-based, system-level mitigation strategies for the following Unsafe Control Action (UCA).

    Unsafe Control Action:
    ${uca}

    Write one concise sentence describing what the system must do or prevent to mitigate this UCA. 
    Do not describe how the mitigation should be implemented.
    Avoid bulleted lists, technical details, or specific technologies.

    Write your answer as one sentence.
    `.trim();

    let mitigation = "";
    try {
      mitigation = await fetchLLMResponse(prompt);
    } catch (err) {
      logger.error("LLM error for mitigation:", err);
      mitigation = "(error generating mitigation)";
    }

    rows.push([sanitizeText(uca), sanitizeText(mitigation.trim())]);
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
}) 

{
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
Write a system-level requirement for the following mitigation strategy. The requirement must begin with "The system shall..." and be written as a single, clear, and verifiable shall-statement.

${mitigation}
    `.trim();

    let requirement = "";
    try {
      requirement = await fetchLLMResponse(prompt);
    } catch (err) {
      logger.error("LLM error for system requirement:", err);
      requirement = "(error generating requirement)";
    }

    rows.push([sanitizeText(mitigation), sanitizeText(requirement.trim())]);
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
  

  // ✅ THEN generate the batched sheet
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
    .slice(1)  // Skip header row
    .map((row) => getCellText(row[1])) // Column 1: System Requirement
    .filter((req) => req && req.length > 0); // Filter out empty requirements

  // Function to chunk requirements into batches (based on character length)
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
  const finalRows = [["Original Requirement", "Consolidated Requirement"]]; // Header

  function extractJsonFromMarkdown(text) {
    const firstBracket = text.indexOf("[");
    const lastBracket = text.lastIndexOf("]");
    if (firstBracket === -1 || lastBracket === -1 || firstBracket >= lastBracket) {
      return text; // return as-is for visibility in error logs
    }
    return text.slice(firstBracket, lastBracket + 1).trim();
  }  

  for (const chunk of chunks) {
    const jsonArray = JSON.stringify(chunk, null, 2);

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `You are a systems engineer. Your task is to aggressively consolidate system-level requirements by grouping them according to common control-related failure modes.

Here is a list of system requirements:
${jsonArray}

Instructions:
1. Group requirements by shared intent, function, or outcome.
2. Identify opportunities to generalize over:
   - Specific parameters (e.g., thresholds, devices, roles)
   - Multiple similar functions (e.g., sensors, alerts, logs)
   - Redundant phrasing or duplicated behavior
3. For each group, write **one abstracted requirement** that:
   - Uses clear, system-level language
   - Reflects a single system behavior or responsibility
   - Avoids implementation specifics (e.g., UI buttons, HTTP methods)
   - ❗️**Avoids compound requirements** — do not combine multiple behaviors (e.g., "log and alert") into one statement.
   - ❗️**Each requirement must express only one system-level function**, so it can be tested and traced independently.

- Consolidate requirements that share similar failure intent, even if they are worded differently or reference different signals.
- Prefer abstract, generalized requirements that can cover multiple similar concerns in one statement.
- Minimize the number of unique consolidated requirements.
- If a requirement is completely unique and cannot be merged, return it unchanged (you may add an asterisk to the consolidated version).
- For each original requirement, return the consolidated version it maps to.

Respond using this JSON format:
[
  {
    "original": "<original requirement>",
    "consolidated": "<consolidated requirement>"
  },
  ...
]`;

const systemDetailsSheet = sheets?.["System Details"];
const systemDetailsText = systemDetailsSheet
  ? flattenSheetData(systemDetailsSheet).slice(0, 5000)  // limit to ~5K characters
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
      consolidated += " *"; // Add asterisk to mark as unconsolidated
    }
    finalRows.push([original, consolidated]);
  }
}
  }

  // Update the sheet with the new consolidated results
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
  const ucaSheet = sheets["Causal Factors"];
  if (!ucaSheet || ucaSheet.length < 2) {
    logger.warn("⚠️ 'Causal Factors' sheet is missing or empty.");
    return;
  }

  const header = ["Unsafe Control Action", "Hazard Category"];
  const rows = [header];

  for (let i = 1; i < ucaSheet.length; i++) {
    const uca = getCellText(ucaSheet[i][0]);
    if (!uca) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
Assign a concise hazard category to the following unsafe control action.

Return a short label only (e.g., "Loss of braking", "Unintended motion", "Incorrect actuation").

Do not use numbered labels like "H1" or "Hazard 2".

Unsafe Control Action:
${uca}
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
      rows.push([sanitizeText(uca), sanitizeText(cleanHazard)]);
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
    const hazard = getCellText(hazardSheet[i][1]); // Column 1 = Hazard
    if (hazard) uniqueHazards.add(hazard);
  }

  const header = ["Hazard", "Loss"];
  const rows = [header];

  for (const hazard of uniqueHazards) {
    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
You are performing a system safety analysis. Based on the following hazard, list all distinct losses that could occur if this hazard were realized.
Only the following losses should be used as possible categories:
Loss of System Performance or Functionality
Loss of Operational Effectiveness
Loss of Security
Loss of Data Integrity or Quality
Loss of Reliability or Trust
Loss of Public Perception or Brand Value

Hazard:
"${hazard}"

List each loss on a new line. Do not explain or add commentary.
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
      .filter((l) => l.length > 0);

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
  const ucaSheet = sheets["Causal Factors"];
  const hazardSheet = sheets["Hazard Mappings"];
  const lossSheet = sheets["Loss Mappings"];
  const mitigationSheet = sheets["Mitigation Strategies"];
  const systemReqSheet = sheets["System Requirements"];
  const consolidatedReqSheet = sheets["Consolidated Requirements"];

  const sheetStatus = {
    "Causal Factors": !!ucaSheet && ucaSheet.length >= 2,
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
    "Unsafe Control Action",
    "Mitigation Strategy",
    "System Requirement",
    "Consolidated Requirement"
  ];

  const rows = [header];

  const hazardMap = new Map();                // UCA → Hazard
  const lossMap = new Map();                  // Hazard → [Loss]
  const mitigationMap = new Map();            // UCA → Mitigation
  const mitigationToSystemReq = new Map();    // Mitigation → System Requirement
  const systemReqToConsolidated = new Map();  // System Requirement → Consolidated Requirement

  for (let i = 1; i < hazardSheet.length; i++) {
    const uca = getCellText(hazardSheet[i][0]);
    const hazard = getCellText(hazardSheet[i][1]);
    if (uca && hazard) hazardMap.set(uca.trim(), hazard.trim());
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
    const uca = getCellText(mitigationSheet[i][0]);
    const mitigation = getCellText(mitigationSheet[i][1]);
    if (uca && mitigation) mitigationMap.set(uca.trim(), mitigation.trim());
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

  for (let i = 1; i < ucaSheet.length; i++) {
    const uca = getCellText(ucaSheet[i][0]);
    if (!uca) continue;

    const hazard = hazardMap.get(uca.trim()) || "(hazard not found)";
    const losses = lossMap.get(hazard) || ["(loss not found)"];
    const mitigation = mitigationMap.get(uca.trim()) || "(mitigation not found)";
    const rawSystemReq = mitigationToSystemReq.get(mitigation.trim());
    const systemReq = rawSystemReq || "(requirement not found)";

    const consolidated = rawSystemReq
      ? systemReqToConsolidated.get(normalizeText(rawSystemReq)) || "(consolidated requirement not found)"
      : "(requirement not found)";

    for (const loss of losses) {
      rows.push([
        sanitizeText(loss),
        sanitizeText(hazard),
        sanitizeText(uca),
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
  
    // ✅ Automatically persist to IndexedDB
    await saveFoldersToDB({
      ...(await loadFoldersFromDB()),
      [currentFolder]: {
        ...updatedSheets[currentFolder] || updatedSheets,
        ...updatedSheets
      }
    });
  
  return updatedSheets;
  
}

export async function generateTextbookCausalFactorsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const unsafeControlActionsSheet = sheets["Unsafe Control Actions"];
  if (!unsafeControlActionsSheet || unsafeControlActionsSheet.length < 2) {
    logger.warn("⚠️ 'Unsafe Control Actions' sheet is missing or empty.");
    return;
  }

  const unsafeControlActions = collectUnsafeControlActions(unsafeControlActionsSheet);
  if (unsafeControlActions.length === 0) {
    logger.warn("⚠️ No unsafe control actions were found for textbook causal-factor generation.");
    return;
  }

  const rows = [["Unsafe Control Actions", "Causal Factors"]];

  for (const unsafeControlAction of unsafeControlActions) {
    const prompt = `
You are performing STPA using a textbook-style causal analysis.

For the unsafe control action below, identify 2 to 4 concise causal factors or scenarios that could lead to it.
Focus on controller flaws, incorrect or missing feedback, process-model mismatch, actuator or sensor issues, timing problems, coordination gaps, or environmental conditions.

Return each causal factor on its own line.
Do not number the list.
Do not repeat the unsafe control action.

Unsafe Control Action:
${unsafeControlAction}
    `.trim();

    let factorsResponse = "";
    try {
      factorsResponse = await fetchLLMResponse(prompt);
    } catch (err) {
      logger.error("LLM error generating textbook causal factors:", err);
      factorsResponse = "(error generating causal factors)";
    }

    const factors = dedupeList(parseLineOrSemicolonList(factorsResponse));
    if (factors.length === 0) {
      rows.push([sanitizeText(unsafeControlAction), "(causal factor not found)"]);
      continue;
    }

    factors.forEach((factor) => {
      rows.push([sanitizeText(unsafeControlAction), sanitizeText(factor)]);
    });
  }

  const updatedSheets = {
    ...sheets,
    "Causal Factors (Textbook)": rows,
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

export async function generateTextbookTraceabilityMatrix({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalSheet = sheets["Causal Factors (Textbook)"];
  const hazardSheet = sheets["Hazard Mappings"];
  const lossSheet = sheets["Loss Mappings"];
  const mitigationSheet = sheets["Mitigation Strategies"];
  const systemReqSheet = sheets["System Requirements"];
  const consolidatedReqSheet = sheets["Consolidated Requirements"];

  const sheetStatus = {
    "Causal Factors (Textbook)": !!causalSheet && causalSheet.length >= 2,
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
    logger.warn(`⚠️ [Textbook Summary Gen] Missing or insufficient sheets: ${missingSheets.join(", ")}`);
    return;
  }

  const header = [
    "Losses",
    "Hazards",
    "Unsafe Control Actions",
    "Causal Factors",
    "Safety Requirements/Constraints",
  ];

  const rows = [header];
  const hazardMap = new Map();
  const lossMap = new Map();
  const mitigationMap = new Map();
  const mitigationToSystemReq = new Map();
  const systemReqToConsolidated = new Map();
  const causalFactorMap = new Map();

  for (let i = 1; i < hazardSheet.length; i++) {
    const unsafeControlAction = getCellText(hazardSheet[i][0]);
    const hazard = getCellText(hazardSheet[i][1]);
    if (unsafeControlAction && hazard) hazardMap.set(unsafeControlAction.trim(), hazard.trim());
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
    const unsafeControlAction = getCellText(mitigationSheet[i][0]);
    const mitigation = getCellText(mitigationSheet[i][1]);
    if (unsafeControlAction && mitigation) mitigationMap.set(unsafeControlAction.trim(), mitigation.trim());
  }

  for (let i = 1; i < systemReqSheet.length; i++) {
    const mitigation = getCellText(systemReqSheet[i][0]);
    const systemRequirement = getCellText(systemReqSheet[i][1]);
    if (mitigation && systemRequirement) {
      mitigationToSystemReq.set(mitigation.trim(), systemRequirement.trim());
    }
  }

  for (let i = 1; i < consolidatedReqSheet.length; i++) {
    const original = getCellText(consolidatedReqSheet[i][0]);
    const consolidated = getCellText(consolidatedReqSheet[i][1]);
    if (original && consolidated) {
      systemReqToConsolidated.set(normalizeText(original), consolidated.trim());
    }
  }

  for (let i = 1; i < causalSheet.length; i++) {
    const unsafeControlAction = getCellText(causalSheet[i][0]);
    const causalFactor = getCellText(causalSheet[i][1]);
    if (!unsafeControlAction) continue;
    const key = unsafeControlAction.trim();
    if (!causalFactorMap.has(key)) causalFactorMap.set(key, []);
    if (causalFactor) causalFactorMap.get(key).push(causalFactor.trim());
  }

  for (const [unsafeControlAction, factors] of causalFactorMap.entries()) {
    const hazard = hazardMap.get(unsafeControlAction) || "(hazard not found)";
    const losses = dedupeList(lossMap.get(hazard) || ["(loss not found)"]);
    const mitigation = mitigationMap.get(unsafeControlAction) || "";
    const rawSystemReq = mitigation ? mitigationToSystemReq.get(mitigation.trim()) : "";
    const safetyRequirement =
      (rawSystemReq && (systemReqToConsolidated.get(normalizeText(rawSystemReq)) || rawSystemReq)) ||
      "(safety requirement/constraint not found)";
    const causalFactors = dedupeList(factors.length ? factors : ["(causal factor not found)"]);

    for (const loss of losses) {
      for (const causalFactor of causalFactors) {
        rows.push([
          sanitizeText(loss),
          sanitizeText(hazard),
          sanitizeText(unsafeControlAction),
          sanitizeText(causalFactor),
          sanitizeText(safetyRequirement),
        ]);
      }
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
