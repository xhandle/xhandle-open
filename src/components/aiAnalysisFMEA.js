

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
    .replace(/\s*(?:->|→|➔|➡)\s*/g, " which leads to ")
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

function hasTraceColumns(headers = []) {
  return CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.every((name) => headers.includes(name));
}

function traceCellsFromFunctionalRow(headers, row) {
  return traceabilityToSheetCells(extractFunctionalDecompositionTrace(headers, row));
}

function traceObjectFromSheetRow(headers, row) {
  if (!hasTraceColumns(headers)) return {};
  const offset = headers.length - CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.length;
  const traceRow = ["", "", "", ...headers.slice(offset).map((_, index) => row[offset + index])];
  const traceHeaders = ["Function (From)", "Control Action", "Function (To)", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS];
  return extractFunctionalDecompositionTrace(traceHeaders, traceRow);
}

function traceCellsFromSheetRow(headers, row) {
  if (!hasTraceColumns(headers)) return [];
  const offset = headers.length - CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.length;
  return row.slice(offset, offset + CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.length);
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

    // small local helper
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

    const json = await response.json(); // ✅ read body exactly once
    console.log("📦 Raw LLM response JSON:", json);

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

export async function generateFailureModeSeedSheet({ sheets, setFolders, currentFolder }) {
  console.log("📥 Entered generateFailureModeSeedSheet");

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
        "", "", "", "", "", "", "", "", "",
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

export async function populateFMEAColumnsWithLLM({
  sheets,
  setFolders,
  currentFolder,
  setChatPrompt,
  setChatResponse,
}) {
  console.log("📊 populateFMEAColumnsWithLLM called");

  const sheet = sheets["Unsafe Control Actions"]; // Or "Failure Modes and Effects" if renamed
  if (!sheet || sheet.length < 2) {
    console.warn("⚠️ Failure Modes sheet is missing or empty.");
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

    const guideColumnEnd = hasTraceColumns(columnHeaders)
      ? columnHeaders.length - CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.length
      : columnHeaders.length;
    for (let col = 1; col < guideColumnEnd; col++) {
      const phraseLabel = columnHeaders[col];
      const guidephrase = guidephrases[phraseLabel] || phraseLabel;

      const prompt = `
You are performing a Failure Modes and Effects Analysis (FMEA).

Given the control action: "${controlAction}"
and the failure condition: "${guidephrase}"

Respond with a concise but specific failure mode, its potential effect, and its cause. Explain how the hazard happens and what the effect may be.

Write each field as one sentence:
- Failure Mode: name the concrete degraded behavior and the affected receiver/state.
- Effect: describe the causal chain from local effect to system-level consequence, including the operating context when possible.
- Cause: name a plausible mechanism such as stale data, timing fault, invalid state transition, sensor/input error, interface mismatch, resource exhaustion, operator command conflict, or environmental condition.

Avoid generic wording like "system failure", "unsafe behavior", "incorrect output", or "loss of function" unless the sentence also explains the mechanism and consequence.
Do not use arrow notation or arrow-like symbols in any field. Use words such as "which causes", "which leads to", "resulting in", or "then" instead.

Use this format exactly:

Failure Mode: ...
Effect: ...
Cause: ...

Do not include quotes, bullets, or extra explanation.
      `.trim();

      console.log(`🔍 Prompt for row ${rowIndex}, column "${phraseLabel}"`, prompt);

      let response = "";
      try {
        response = await fetchLLMResponse(prompt);
        response = response.trim();

        // Normalize to a compact string (Failure Mode | Effect | Cause)
        const failureMode = sanitizeText(/Failure Mode:\s*(.*)/i.exec(response)?.[1]?.trim() || "");
        const effect = sanitizeText(/Effect:\s*(.*)/i.exec(response)?.[1]?.trim() || "");
        const cause = sanitizeText(/Cause:\s*(.*)/i.exec(response)?.[1]?.trim() || "");

        const combined = `${failureMode} | ${effect} | ${cause}`;
        newRow.push(combined);
        allFailureModes += combined + "; ";
      } catch (err) {
        console.error(`❌ LLM error on row ${rowIndex}, col "${phraseLabel}"`, err);
        newRow.push("(error)");
      }
    }

    if (hasTraceColumns(columnHeaders)) {
      newRow.push(...traceCellsFromSheetRow(columnHeaders, row));
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

  console.log("✅ Finished populating FMEA failure mode columns");
  return updatedSheets;
}

export async function generateFMEACausalFactorsSheet({
  sheets,
  setFolders,
  currentFolder,
}) {
  console.log("🧠 generateFMEACausalFactorsSheet called");

  const sheet = sheets["Unsafe Control Actions"];
  if (!sheet || sheet.length < 2) {
    console.warn("⚠️ 'Unsafe Control Actions' sheet is missing or empty.");
    return sheets;
  }

  const headers = sheet[0] || [];
  const guideColumnEnd = hasTraceColumns(headers)
    ? headers.length - CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.length
    : headers.length;
  const rows = [["Failure Mode", "Causal Factor", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS]];

  for (let rowIndex = 1; rowIndex < sheet.length; rowIndex++) {
    const row = sheet[rowIndex];
    const traceCells = hasTraceColumns(headers) ? traceCellsFromSheetRow(headers, row) : [];
    for (let colIndex = 1; colIndex < guideColumnEnd; colIndex++) {
      const cell = getCellText(row[colIndex]);
      const [failureMode, , cause] = cell.split("|").map((s) => sanitizeText(s.trim()));
      if (failureMode && cause) {
        rows.push([failureMode, cause, ...traceCells]);
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

  console.log("✅ Created Causal Factors sheet:", rows.length - 1, "rows");
  return updatedSheets;
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
  const header = ["Causal Factor", "Mitigation Strategy", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS];
  const rows = [header];

  for (let i = 1; i < causalSheet.length; i++) {
    const cause = getCellText(causalSheet[i][1]); // ✅ column 1 = "Causal Factor"
    const traceCells = hasTraceColumns(causalHeaders) ? traceCellsFromSheetRow(causalHeaders, causalSheet[i]) : [];
    if (!cause) continue;
    const prompt = `
    You are developing a performance-based, system-level mitigation strategy as part of an FMEA analysis.

    Causal factor:
    ${cause}

    Describe what the system must do or prevent in order to break the causal chain from this cause to the hazardous effect.
    Avoid describing how it should be implemented — focus on the intended outcome or behavior.
    Be specific about the failed condition, the affected state/control action, and the unsafe effect being mitigated.
    Do not include lists, bullets, or implementation details.
    Do not use arrow notation or arrow-like symbols; use words such as "which causes", "which leads to", "resulting in", or "then" instead.

    Write your answer as one sentence.
    `.trim();

    let mitigation = "";
    try {
      mitigation = await fetchLLMResponse(prompt);
    } catch (err) {
      console.error("LLM error for mitigation:", err);
      mitigation = "(error generating mitigation)";
    }

    rows.push([sanitizeText(cause), sanitizeText(mitigation), ...traceCells]);
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

export async function generateSystemRequirementsSheet({
  sheets,
  setFolders,
  currentFolder
}) {
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
You are writing a verifiable system requirement for a safety mitigation derived from an FMEA analysis.

Mitigation Strategy:
"${mitigation}"

Write one system-level requirement that addresses this mitigation. The requirement must:
- Begin with "The system shall..."
- Be clear, specific, and verifiable
- Not include implementation details or vague language
- Avoid passive voice and generic placeholders
- Not use arrow notation or arrow-like symbols

Output only the shall-statement.
    `.trim();

    let requirement = "";
    try {
      requirement = await fetchLLMResponse(prompt);
    } catch (err) {
      console.error("LLM error for system requirement:", err);
      requirement = "(error generating requirement)";
    }

    rows.push([sanitizeText(mitigation), sanitizeText(requirement), ...traceCells]);
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
   - Does not use arrow notation or arrow-like symbols
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
          consolidated += " *";
        }
        finalRows.push([sanitizeText(original), sanitizeText(consolidated)]);
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

export async function generateHazardMappingsSheet({
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
  const header = ["Causal Factor", "Hazard Category", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS];
  const rows = [header];

  for (let i = 1; i < causalSheet.length; i++) {
    const cause = getCellText(causalSheet[i][1]);
    const traceCells = hasTraceColumns(causalHeaders) ? traceCellsFromSheetRow(causalHeaders, causalSheet[i]) : [];
    if (!cause) continue;
    const prompt = `
You are performing a hazard identification step in a Failure Mode and Effects Analysis (FMEA).

Given the following **causal factor**:
"${cause}"

Assign the most appropriate hazard category that could result from this cause. The label must name the unsafe state and hint at how it happens, such as:
- "Uncommanded motion from stale position data"
- "Loss of braking from delayed actuator command"
- "Incorrect output signal from invalid mode transition"

Do not return lists, numbers, or quotes — only one short label.
Do not use arrow notation or arrow-like symbols.
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
      rows.push([sanitizeText(cause), sanitizeText(cleanHazard), ...traceCells]);
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
    const hazard = getCellText(hazardSheet[i][1]);
    if (hazard) uniqueHazards.add(hazard);
  }

  const header = ["Hazard", "Loss"];
  const rows = [header];

  for (const hazard of uniqueHazards) {
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

Select the loss categories that match the plausible effects of this hazard. Consider whether the hazard could degrade control, produce an unsafe output, corrupt data/state, interrupt mission operations, reduce trust, or expose a security weakness.

List each applicable loss on its own line. Do not add commentary or explanations. Return only valid loss categories.
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

export async function generateSummarySheetFromMappings({
  sheets,
  setFolders,
  currentFolder
}) {
  console.log("🔍 [Summary Gen] Checking required sheets...");
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
    "Failure Mode",
    "Causal Factor",
    "Mitigation Strategy",
    "System Requirement",
    "Consolidated Requirement"
  ];
  

  const rows = [header];

  const hazardMap = new Map();                // Causal Factor → Hazard
  const traceMap = new Map();                 // Causal Factor → Trace summary fields
  const lossMap = new Map();                  // Hazard → [Loss]
  const mitigationMap = new Map();            // Causal Factor → Mitigation
  const mitigationToSystemReq = new Map();    // Mitigation → System Requirement
  const systemReqToConsolidated = new Map();  // System Requirement → Consolidated Requirement

  for (let i = 1; i < hazardSheet.length; i++) {
    const cause = getCellText(hazardSheet[i][0]);
    const hazard = getCellText(hazardSheet[i][1]);
    if (cause && hazard) hazardMap.set(cause.trim(), hazard.trim());
    if (cause && hasTraceColumns(hazardSheet[0] || [])) {
      traceMap.set(cause.trim(), traceSummaryCellsFromSheetRow(hazardSheet[0], hazardSheet[i]));
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
    if (!traceMap.has(causalFactor.trim())) {
      traceMap.set(causalFactor.trim(), traceSummaryCellsFromSheetRow(causalSheet[0] || [], causalSheet[i]));
    }
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
  const traceFields = traceMap.get(causalFactor) || traceabilityObjectToSummaryFields({});

  for (const loss of losses) {
    rows.push([
      ...(Array.isArray(traceFields)
        ? traceFields
        : HAZARD_SUMMARY_TRACEABILITY_COLUMNS.map((column) => traceFields[column] || "")),
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
