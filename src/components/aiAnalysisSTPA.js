

import { saveFoldersToDB, loadFoldersFromDB } from './utils/indexedDB'; 
import { buildAIAuthOpts } from "./backendConfig";
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
    .replace(/^[-–—•·\s"]+/, "")       // remove leading bullets, dashes, quotes
    .replace(/["“”‘’]+$/, "")         // remove trailing quotes
    .replace(/\s+/g, " ")             // normalize whitespace
    .replace(/[“”]/g, '"')            // convert smart quotes to standard quotes
    .replace(/[‘’]/g, "'")            // convert smart apostrophes
    .trim();
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/["'\-–—•·]+/g, "") // remove punctuation
    .replace(/\s+/g, " ")        // collapse extra whitespace
    .trim();
}

function traceCellsFromFunctionalRow(headers, row) {
  return traceabilityToSheetCells(extractFunctionalDecompositionTrace(headers, row));
}

function traceObjectFromSheetRow(headers, row) {
  const offset = headers.length - CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.length;
  const traceRow = ["", "", "", ...headers.slice(offset).map((_, index) => row[offset + index])];
  const traceHeaders = ["Function (From)", "Control Action", "Function (To)", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS];
  return extractFunctionalDecompositionTrace(traceHeaders, traceRow);
}

function traceCellsFromSheetRow(headers, row) {
  const offset = headers.length - CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.length;
  return offset >= 0 ? row.slice(offset, offset + CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.length) : [];
}

function hasTraceColumns(headers = []) {
  return CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.every((name) => headers.includes(name));
}

function traceSummaryCellsFromSheetRow(headers, row) {
  const traceFields = hasTraceColumns(headers)
    ? traceabilityObjectToSummaryFields(traceObjectFromSheetRow(headers, row))
    : traceabilityObjectToSummaryFields({});
  return HAZARD_SUMMARY_TRACEABILITY_COLUMNS.map((column) => traceFields[column] || "");
}

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
  response = await fetch("/api/chat", {
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
    console.warn("🔁 429 Rate limit hit (attempt", attempt, ")");
    console.log("📦 Headers:", {
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
console.log("📦 Raw LLM response JSON:", json); // (optional)

return json?.choices?.[0]?.message?.content?.trim() || "(empty)";


  } catch (error) {
    console.error("🚨 Error in fetchLLMResponse (via ClayPrompt logic):", error);
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

export async function generateUnsafeControlActionsSheet({ sheets, setFolders, currentFolder }) {
  console.log("📥 Entered generateUnsafeControlActionsSheet");

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
    ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS,
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
      // const llmResponse = await fetchLLMResponse(llmPrompt);

      newSheet.push([
        controlAction,
        "", "", "", "", "", "", "",
        ...traceCellsFromFunctionalRow(decomposition[0], row),
      ]);
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

  console.log("✅ Generated Unsafe Control Actions sheet with decomposition context");
  return updatedFolder;
}

export async function populateUCATimingColumnsWithLLM({
  sheets,
  setFolders,
  currentFolder,
  setChatPrompt,
  setChatResponse,
}) {
  console.log("📊 populateUCATimingColumnsWithLLM called");

  const sheet = sheets["Unsafe Control Actions"];
  console.log("🔍 Initial Unsafe Control Actions sheet:", sheet);
  console.log("🔎 Number of rows in Unsafe Control Actions sheet:", sheet?.length);
  if (!sheet || sheet.length < 2) {
    console.warn("⚠️ 'Unsafe Control Actions' sheet is missing or empty.");
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
      updatedSheet.push(new Array(columnHeaders.length).fill(""));
      continue;
    }

    const newRow = [controlAction];

    const ucaColumnEnd = hasTraceColumns(columnHeaders)
      ? columnHeaders.length - CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.length
      : columnHeaders.length;
    for (let col = 1; col < ucaColumnEnd; col++) {
      const modifier = promptModifiers[columnHeaders[col]];
      const phrasing = modifier
        ? controlAction.replace(" to ", ` to ${modifier} `)
        : controlAction;
    
      const prompt = `Create exactly one unsafe control action describing how "${phrasing}" leads to an undesired effect. 
Write the unsafe control action as a single sentence using clear and correct grammar. 
Use the following format: "[Actor] [verb phrase] [control action] to [recipient], leading to [hazard]." 
Do not use quotations, bullets, or dashes. Do not use awkward or repeated verb forms. 
Separate unsafe control actions using semicolons if needed, but generate only one per prompt.    
      `.trim();
    
      console.log(`🔍 Prompt for row ${rowIndex}, column "${columnHeaders[col]}"`, prompt);
    
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

        console.log("📥 LLM Response:", response);
    
        fullResponseText += response + "; ";
      } catch (err) {
        console.error(`LLM error for row ${rowIndex}, column ${col}`, err);
        response = "(LLM error)";
      }
    
      newRow.push(response.trim());
    }
    

    if (hasTraceColumns(columnHeaders)) {
      newRow.push(...traceCellsFromSheetRow(columnHeaders, row));
    }
    updatedSheet.push(newRow);
  }

  const ucaText = fullResponseText.trim();
  if (typeof setChatResponse === "function") {
    setChatResponse(ucaText);
  }
  

console.log("📝 Final updated Unsafe Control Actions sheet:", updatedSheet);
console.log("🔎 Final row count:", updatedSheet?.length);
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
console.log("✅ Saved updated Unsafe Control Actions sheet into folders:", updatedSheets);


// ✅ Automatically create the Causal Factors sheet too
const nextUpdatedSheets = await generateCausalFactorsSheet({
  ucaText,
  sheets: updatedSheets,
  setFolders,
  currentFolder
});

return nextUpdatedSheets;

}

export async function generateCausalFactorsSheet({
  ucaText = "",
  sheets,
  setFolders,
  currentFolder
}) {
  const sourceSheet = sheets["Unsafe Control Actions"];
  const sourceHeaders = sourceSheet?.[0] || [];
  const ucaColumnEnd = hasTraceColumns(sourceHeaders)
    ? sourceHeaders.length - CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.length
    : sourceHeaders.length;
  const header = ["Unsafe Control Action Identified", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS];
  const rows = [header];

  if (sourceSheet && sourceSheet.length > 1) {
    for (let rowIndex = 1; rowIndex < sourceSheet.length; rowIndex++) {
      const row = sourceSheet[rowIndex];
      const traceCells = hasTraceColumns(sourceHeaders) ? traceCellsFromSheetRow(sourceHeaders, row) : [];
      for (let colIndex = 1; colIndex < ucaColumnEnd; colIndex++) {
        const action = sanitizeText(getCellText(row[colIndex]));
        if (action && action !== "(LLM error)") {
          rows.push([action, ...traceCells]);
        }
      }
    }
  }

  if (rows.length === 1) {
    const actions = ucaText
    .split(/;|\n/) // Split on semicolons OR newlines
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

    for (const action of actions) {
      rows.push([sanitizeText(action), ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.map(() => "")]);
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
  



// ✅ Automatically create Mitigation Strategies
const nextUpdatedSheets = await generateMitigationStrategiesSheet({
  sheets: updatedSheets,
  setFolders,
  currentFolder
});

return nextUpdatedSheets;





}

export async function generateMitigationStrategiesSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalSheet = sheets["Causal Factors"];
  if (!causalSheet || causalSheet.length < 2) {
    console.warn("⚠️ 'Causal Factors' sheet is missing or empty.");
    return;
  }

  const causalHeaders = causalSheet[0] || [];
  const header = ["Unsafe Control Action", "Mitigation Strategy", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS];
  const rows = [header];

  for (let i = 1; i < causalSheet.length; i++) {
    const uca = getCellText(causalSheet[i][0]);
    const traceCells = hasTraceColumns(causalHeaders) ? traceCellsFromSheetRow(causalHeaders, causalSheet[i]) : [];
    if (!uca) continue;
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
      console.error("LLM error for mitigation:", err);
      mitigation = "(error generating mitigation)";
    }

    rows.push([sanitizeText(uca), sanitizeText(mitigation.trim()), ...traceCells]);
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

export async function generateSystemRequirementsSheet({
  sheets,
  setFolders,
  currentFolder
}) 

{
  const mitigationSheet = sheets["Mitigation Strategies"];
  if (!mitigationSheet || mitigationSheet.length < 2) {
    console.warn("⚠️ 'Mitigation Strategies' sheet is missing or empty.");
    return;
  }

  const mitigationHeaders = mitigationSheet[0] || [];
  const header = ["Mitigation Strategy", "System Requirement", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS];
  const rows = [header];

  for (let i = 1; i < mitigationSheet.length; i++) {
    const mitigation = getCellText(mitigationSheet[i][1]); // column 1 = Mitigation Strategy
    const traceCells = hasTraceColumns(mitigationHeaders) ? traceCellsFromSheetRow(mitigationHeaders, mitigationSheet[i]) : [];
    if (!mitigation) continue;
    const prompt = `
Write a system-level requirement for the following mitigation strategy. The requirement must begin with "The system shall..." and be written as a single, clear, and verifiable shall-statement.

${mitigation}
    `.trim();

    let requirement = "";
    try {
      requirement = await fetchLLMResponse(prompt);
    } catch (err) {
      console.error("LLM error for system requirement:", err);
      requirement = "(error generating requirement)";
    }

    rows.push([sanitizeText(mitigation), sanitizeText(requirement.trim()), ...traceCells]);
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

export async function generateBatchedRequirementsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const systemReqs = sheets["System Requirements"] || sheets["Generated System Requirements"];
  if (!systemReqs || systemReqs.length < 2) {
    console.warn("⚠️ 'System Requirements' sheet is missing or empty.");
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
  console.error("❌ Failed to parse LLM JSON response:", err);
  console.log("🔎 Raw LLM Response:", response);
  console.log("🧹 Cleaned Response:", cleanedResponse);
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

export async function generateHazardMappingsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const ucaSheet = sheets["Causal Factors"];
  if (!ucaSheet || ucaSheet.length < 2) {
    console.warn("⚠️ 'Causal Factors' sheet is missing or empty.");
    return;
  }

  const ucaHeaders = ucaSheet[0] || [];
  const header = ["Unsafe Control Action", "Hazard Category", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS];
  const rows = [header];

  for (let i = 1; i < ucaSheet.length; i++) {
    const uca = getCellText(ucaSheet[i][0]);
    const traceCells = hasTraceColumns(ucaHeaders) ? traceCellsFromSheetRow(ucaHeaders, ucaSheet[i]) : [];
    if (!uca) continue;
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
      console.error("LLM error generating hazard category:", err);
      hazard = "(error generating hazard)";
    }

    const cleanHazard = hazard.split(/;|\n/)[0].trim();
    if (cleanHazard) {
      rows.push([sanitizeText(uca), sanitizeText(cleanHazard), ...traceCells]);
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

export async function generateLossMappingsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const hazardSheet = sheets["Hazard Mappings"];
  if (!hazardSheet || hazardSheet.length < 2) {
    console.warn("⚠️ 'Hazard Mappings' sheet is missing or empty.");
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
      console.error("LLM error for loss mapping:", err);
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

export async function generateTextbookCausalFactorsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
  const ucaSheet = sheets["Causal Factors"];
  if (!ucaSheet || ucaSheet.length < 2) {
    console.warn("⚠️ 'Causal Factors' sheet is missing or empty.");
    return sheets;
  }

  const ucaHeaders = ucaSheet[0] || [];
  const header = ["Unsafe Control Action", "Causal Factor", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS];
  const rows = [header];
  const seen = new Set();

  for (let i = 1; i < ucaSheet.length; i++) {
    const uca = sanitizeText(getCellText(ucaSheet[i][0]));
    const traceCells = hasTraceColumns(ucaHeaders) ? traceCellsFromSheetRow(ucaHeaders, ucaSheet[i]) : [];
    if (!uca || seen.has(uca)) continue;
    seen.add(uca);
    const prompt = `
You are performing a textbook STPA causal analysis.

Unsafe Control Action:
${uca}

List 2 to 4 concise causal factors that could plausibly lead to this unsafe control action.
Focus on controller flaws, process model issues, actuator/sensor feedback problems, human interaction issues, timing/coordination issues, or environmental disturbances.
Return one causal factor per line.
Do not number the items.
    `.trim();

    let factorText = "";
    try {
      factorText = await fetchLLMResponse(prompt);
    } catch (err) {
      console.error("LLM error generating textbook causal factors:", err);
      factorText = "";
    }

    const factors = factorText
      .split(/\n|;/)
      .map((f) => sanitizeText(f))
      .filter(Boolean);

    if (!factors.length) {
      rows.push([uca, "(causal factor not found)", ...traceCells]);
      continue;
    }

    for (const factor of factors) {
      rows.push([uca, factor, ...traceCells]);
    }
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

export async function generateSummarySheetFromMappings({
  sheets,
  setFolders,
  currentFolder
}) {
  console.log("🔍 [Summary Gen] Checking required sheets...");
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
  
  console.log("🔍 [Summary Gen] Sheet presence check:", sheetStatus);
  
  const missingSheets = Object.entries(sheetStatus)
    .filter(([_, present]) => !present)
    .map(([name]) => name);
  
  if (missingSheets.length > 0) {
    console.warn(`⚠️ [Summary Gen] Missing or insufficient sheets: ${missingSheets.join(", ")}`);
    return;
  }
  

  const header = [
    ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS,
    "Loss",
    "Hazard",
    "Unsafe Control Action",
    "Mitigation Strategy",
    "System Requirement",
    "Consolidated Requirement"
  ];

  const rows = [header];

  const hazardMap = new Map();                // UCA → Hazard
  const traceMap = new Map();                 // UCA → Trace summary fields
  const lossMap = new Map();                  // Hazard → [Loss]
  const mitigationMap = new Map();            // UCA → Mitigation
  const mitigationToSystemReq = new Map();    // Mitigation → System Requirement
  const systemReqToConsolidated = new Map();  // System Requirement → Consolidated Requirement

  for (let i = 1; i < hazardSheet.length; i++) {
    const uca = getCellText(hazardSheet[i][0]);
    const hazard = getCellText(hazardSheet[i][1]);
    if (uca && hazard) hazardMap.set(uca.trim(), hazard.trim());
    if (uca && hasTraceColumns(hazardSheet[0] || [])) {
      traceMap.set(uca.trim(), traceSummaryCellsFromSheetRow(hazardSheet[0], hazardSheet[i]));
    }
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
    const traceFields = traceMap.get(uca.trim()) || traceSummaryCellsFromSheetRow(ucaSheet[0] || [], ucaSheet[i]);
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
        ...traceFields,
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

export async function generateTextbookSummarySheetFromMappings({
  sheets,
  setFolders,
  currentFolder
}) {
  const causalFactorsSheet = sheets["Causal Factors (Textbook)"];
  const hazardSheet = sheets["Hazard Mappings"];
  const lossSheet = sheets["Loss Mappings"];
  const mitigationSheet = sheets["Mitigation Strategies"];
  const systemReqSheet = sheets["System Requirements"];
  const consolidatedReqSheet = sheets["Consolidated Requirements"];

  const sheetStatus = {
    "Causal Factors (Textbook)": !!causalFactorsSheet && causalFactorsSheet.length >= 2,
    "Hazard Mappings": !!hazardSheet && hazardSheet.length >= 2,
    "Loss Mappings": !!lossSheet && lossSheet.length >= 2,
    "Mitigation Strategies": !!mitigationSheet && mitigationSheet.length >= 2,
    "System Requirements": !!systemReqSheet && systemReqSheet.length >= 2,
    "Consolidated Requirements": !!consolidatedReqSheet && consolidatedReqSheet.length >= 2,
  };

  const missingSheets = Object.entries(sheetStatus)
    .filter(([_, present]) => !present)
    .map(([name]) => name);

  if (missingSheets.length > 0) {
    console.warn(`⚠️ [Textbook Summary Gen] Missing or insufficient sheets: ${missingSheets.join(", ")}`);
    return sheets;
  }

  const header = [
    ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS,
    "Losses",
    "Hazards",
    "Unsafe Control Actions",
    "Causal Factors",
    "Safety Requirements/Constraints"
  ];

  const rows = [header];

  const hazardMap = new Map();
  const traceMap = new Map();
  const lossMap = new Map();
  const mitigationMap = new Map();
  const mitigationToSystemReq = new Map();
  const systemReqToConsolidated = new Map();

  for (let i = 1; i < hazardSheet.length; i++) {
    const uca = sanitizeText(getCellText(hazardSheet[i][0]));
    const hazard = sanitizeText(getCellText(hazardSheet[i][1]));
    if (uca && hazard) hazardMap.set(uca, hazard);
    if (uca && hasTraceColumns(hazardSheet[0] || [])) {
      traceMap.set(uca, traceSummaryCellsFromSheetRow(hazardSheet[0], hazardSheet[i]));
    }
  }

  for (let i = 1; i < lossSheet.length; i++) {
    const hazard = sanitizeText(getCellText(lossSheet[i][0]));
    const loss = sanitizeText(getCellText(lossSheet[i][1]));
    if (!hazard || !loss) continue;
    if (!lossMap.has(hazard)) lossMap.set(hazard, []);
    lossMap.get(hazard).push(loss);
  }

  for (let i = 1; i < mitigationSheet.length; i++) {
    const uca = sanitizeText(getCellText(mitigationSheet[i][0]));
    const mitigation = sanitizeText(getCellText(mitigationSheet[i][1]));
    if (uca && mitigation && !mitigationMap.has(uca)) mitigationMap.set(uca, mitigation);
  }

  for (let i = 1; i < systemReqSheet.length; i++) {
    const mitigation = sanitizeText(getCellText(systemReqSheet[i][0]));
    const systemReq = sanitizeText(getCellText(systemReqSheet[i][1]));
    if (mitigation && systemReq && !mitigationToSystemReq.has(mitigation)) {
      mitigationToSystemReq.set(mitigation, systemReq);
    }
  }

  for (let i = 1; i < consolidatedReqSheet.length; i++) {
    const original = sanitizeText(getCellText(consolidatedReqSheet[i][0]));
    const consolidated = sanitizeText(getCellText(consolidatedReqSheet[i][1]));
    if (original && consolidated && !systemReqToConsolidated.has(normalizeText(original))) {
      systemReqToConsolidated.set(normalizeText(original), consolidated);
    }
  }

  for (let i = 1; i < causalFactorsSheet.length; i++) {
    const uca = sanitizeText(getCellText(causalFactorsSheet[i][0]));
    const causalFactor = sanitizeText(getCellText(causalFactorsSheet[i][1])) || "(causal factor not found)";
    if (!uca) continue;
    const traceFields = traceMap.get(uca) || traceSummaryCellsFromSheetRow(causalFactorsSheet[0] || [], causalFactorsSheet[i]);
    const hazard = hazardMap.get(uca) || "(hazard not found)";
    const losses = lossMap.get(hazard) || ["(loss not found)"];
    const mitigation = mitigationMap.get(uca) || "";
    const rawSystemReq = mitigation ? mitigationToSystemReq.get(mitigation) : "";
    const safetyConstraint = rawSystemReq
      ? (systemReqToConsolidated.get(normalizeText(rawSystemReq)) || rawSystemReq)
      : "(safety requirement/constraint not found)";

    for (const loss of losses) {
      rows.push([
        ...traceFields,
        sanitizeText(loss),
        sanitizeText(hazard),
        sanitizeText(uca),
        causalFactor,
        sanitizeText(safetyConstraint)
      ]);
    }
  }

  const updatedSheets = {
    ...sheets,
    "STPA Traceability Matrix": rows,
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
