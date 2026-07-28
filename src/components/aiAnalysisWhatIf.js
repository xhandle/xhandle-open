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
    .replace(/^[-–—•·\s"]+/, "")
    .replace(/["“”‘’]+$/, "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/["'\-–—•·]+/g, "")
    .replace(/\s+/g, " ")
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
      response = await fetch("/api/chat", {
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
    console.error("🚨 Error in fetchLLMResponse:", error);
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
  console.log("📥 Entered generateWhatIfSeedSheet (DEI)");

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
    "What if intended support is missing?",
    ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS,
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
      newSheet.push([
        interaction,
        "", "", "", "", "", "", "",
        ...traceCellsFromFunctionalRow(decomposition[0], row),
      ]);
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

  console.log("✅ Generated DEI What-If seed sheet");
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
  console.log("📊 populateWhatIfScenariosWithLLM (DEI) called");

  const sheet = sheets["What-If Scenarios"];
  if (!sheet || sheet.length < 2) {
    console.warn("⚠️ What-If Scenarios sheet is missing or empty.");
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

    const guideColumnEnd = hasTraceColumns(columnHeaders)
      ? columnHeaders.length - CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.length
      : columnHeaders.length;
    for (let col = 1; col < guideColumnEnd; col++) {
      const phraseLabel = columnHeaders[col];
      const guidephrase = guidephrases[phraseLabel] || phraseLabel;

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

      console.log(`🔍 DEI Prompt for row ${rowIndex}, column "${phraseLabel}"`, prompt);

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

  console.log("✅ Finished populating DEI What‑If scenario columns");
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
  console.log("🧠 generateWhatIfCausalFactorsSheet (DEI) called");

  const sheet = sheets["What-If Scenarios"];
  if (!sheet || sheet.length < 2) {
    console.warn("⚠️ 'What-If Scenarios' sheet is missing or empty.");
    return sheets;
  }

  const headers = sheet[0] || [];
  const guideColumnEnd = hasTraceColumns(headers)
    ? headers.length - CODE_ARCHITECTURE_TRACEABILITY_COLUMNS.length
    : headers.length;
  const rows = [["What-If Scenario", "Causal Factor", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS]];

  for (let rowIndex = 1; rowIndex < sheet.length; rowIndex++) {
    const row = sheet[rowIndex];
    const traceCells = hasTraceColumns(headers) ? traceCellsFromSheetRow(headers, row) : [];
    for (let colIndex = 1; colIndex < guideColumnEnd; colIndex++) {
      const cell = getCellText(row[colIndex]);
      const [whatIfScenario, , cause] = cell.split("|").map((s) => sanitizeText(s.trim()));
      if (whatIfScenario && cause) {
        rows.push([whatIfScenario, cause, ...traceCells]);
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

  console.log("✅ Created DEI Causal Factors sheet:", rows.length - 1, "rows");
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
    console.warn("⚠️ 'Causal Factors' sheet is missing or empty.");
    return;
  }

  const causalHeaders = causalSheet[0] || [];
  const header = ["Causal Factor", "Mitigation Strategy", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS];
  const rows = [header];

  for (let i = 1; i < causalSheet.length; i++) {
    const cause = getCellText(causalSheet[i][1]);
    const traceCells = hasTraceColumns(causalHeaders) ? traceCellsFromSheetRow(causalHeaders, causalSheet[i]) : [];
    if (!cause) continue;
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
    console.warn("⚠️ 'Mitigation Strategies' sheet is missing or empty.");
    return;
  }

  const mitigationHeaders = mitigationSheet[0] || [];
  const header = ["Mitigation Strategy", "System Requirement", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS];
  const rows = [header];

  for (let i = 1; i < mitigationSheet.length; i++) {
    const mitigation = getCellText(mitigationSheet[i][1]);
    const traceCells = hasTraceColumns(mitigationHeaders) ? traceCellsFromSheetRow(mitigationHeaders, mitigationSheet[i]) : [];
    if (!mitigation) continue;
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
    console.warn("⚠️ 'Causal Factors' sheet is missing or empty.");
    return;
  }

  const causalHeaders = causalSheet[0] || [];
  const header = ["Causal Factor", "Impact Category", ...CODE_ARCHITECTURE_TRACEABILITY_COLUMNS]; // keep sheet key name; change column label
  const rows = [header];

  for (let i = 1; i < causalSheet.length; i++) {
    const cause = getCellText(causalSheet[i][1]);
    const traceCells = hasTraceColumns(causalHeaders) ? traceCellsFromSheetRow(causalHeaders, causalSheet[i]) : [];
    if (!cause) continue;
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
      console.error("LLM error generating impact category:", err);
      impact = "(error generating impact)";
    }

    const cleanImpact = impact.split(/;|\n/)[0].trim();
    if (cleanImpact) {
      rows.push([sanitizeText(cause), sanitizeText(cleanImpact), ...traceCells]);
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
    console.warn("⚠️ 'Hazard Mappings' sheet is missing or empty.");
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
  console.log("🔍 [Summary Gen - DEI] Checking required sheets...");
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
  
  console.log("🔍 [Summary Gen - DEI] Sheet presence check:", sheetStatus);
  
  const missingSheets = Object.entries(sheetStatus)
    .filter(([_, present]) => !present)
    .map(([name]) => name);
  
  if (missingSheets.length > 0) {
    console.warn(`⚠️ [Summary Gen] Missing or insufficient sheets: ${missingSheets.join(", ")}`);
    return;
  }

  // Keep column names stable for downstream consumers
  const header = [
    ...HAZARD_SUMMARY_TRACEABILITY_COLUMNS,
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
  const traceMap = new Map();               // Causal Factor → Trace summary fields
  const lossMap = new Map();                // Impact Category → [Loss]
  const mitigationMap = new Map();          // Causal Factor → Mitigation
  const mitigationToSystemReq = new Map();  // Mitigation → System Requirement
  const systemReqToConsolidated = new Map();// System Requirement → Consolidated

  for (let i = 1; i < hazardSheet.length; i++) {
    const cause = getCellText(hazardSheet[i][0]);
    const impact = getCellText(hazardSheet[i][1]);
    if (cause && impact) impactMap.set(cause.trim(), impact.trim());
    if (cause && hasTraceColumns(hazardSheet[0] || [])) {
      traceMap.set(cause.trim(), traceSummaryCellsFromSheetRow(hazardSheet[0], hazardSheet[i]));
    }
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
      if (!traceMap.has(causalFactor.trim())) {
        traceMap.set(causalFactor.trim(), traceSummaryCellsFromSheetRow(causalSheet[0] || [], causalSheet[i]));
      }
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
    const traceFields = traceMap.get(causalFactor) || HAZARD_SUMMARY_TRACEABILITY_COLUMNS.map(() => "");

    for (const loss of losses) {
      rows.push([
        ...traceFields,
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
