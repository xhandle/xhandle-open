/**
 * xHandle: STPASEC hazard-analysis pipeline.
 * This file contains one of xHandle's AI-assisted safety-analysis pipelines. It prepares prompt inputs from functional decomposition or worksheet data, calls the backend chat proxy, and normalizes the returned analysis into spreadsheet-friendly structures.
 * These modules are the bridge between system architecture data and the domain-specific artifacts that xHandle uses for hazard identification, control-action analysis, causal reasoning, mitigations, and derived requirements.
 * Related files: src/App.js, src/lib/api/backendConfig.js, src/lib/storage/indexedDB.js, src/components/generateAgenticReport.js.
 */

import { saveFoldersToDB, loadFoldersFromDB } from '../../lib/storage/indexedDB'; 
import { generateBatchedRequirementsSheet } from "./aiAnalysisSTPA";
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
 * sleep encapsulates a focused piece of hazard-analysis pipeline logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param ms Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let totalTokensUsed = 0;
let tokenWindowStart = Date.now();
const MAX_TOKENS_PER_MINUTE = 5000; // Adjust for your GPT-4o tier

let lastLLMCallTimestamp = 0;
// ~9–10 requests per minute
const MIN_DELAY_MS = 6_500; // one call every ~6.5s

function estimateTokens(text) {
  return Math.ceil((text || "").length / 4); // crude but effective
}

/**
 * throttleLLMCall encapsulates a focused piece of hazard-analysis pipeline logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param prompt Prompt text or prompt payload supplied to the AI step.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function throttleLLMCall(prompt) {
  const now = Date.now();
  const estimatedTokens = estimateTokens(prompt);

  // Log estimated token usage
  logger.debug(`🧮 Prompt length: ${prompt.length}, ~Tokens: ${estimatedTokens}`);

  // Reset token window every minute
  if (now - tokenWindowStart > 60_000) { // reset every 60s
    tokenWindowStart = now;
    totalTokensUsed = 0;
  }

  // Throttle if token usage would exceed TPM
  while (totalTokensUsed + estimatedTokens > MAX_TOKENS_PER_MINUTE) {
    logger.debug(`⏳ Waiting for token budget to reset... (${totalTokensUsed}/${MAX_TOKENS_PER_MINUTE})`);
    await sleep(300);
  }

  // RPM-based delay
  const timeSinceLastCall = now - lastLLMCallTimestamp;
  if (timeSinceLastCall < MIN_DELAY_MS) {
    const waitTime = MIN_DELAY_MS - timeSinceLastCall;
    logger.debug(`⏱️ Waiting ${waitTime}ms to respect 10 RPM limit`);
    await sleep(waitTime);
  }

  lastLLMCallTimestamp = Date.now();
  totalTokensUsed += estimatedTokens;

  return await fetchLLMResponse(prompt);
}

/**
 * fetchWithRetry encapsulates a focused piece of hazard-analysis pipeline logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param prompt Prompt text or prompt payload supplied to the AI step.
 * @param retries Input consumed by this step of the xHandle workflow.
 * @param delay Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function fetchWithRetry(prompt, retries = 3, delay = 300) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await throttleLLMCall(prompt);

      if (!response || typeof response !== "string" || response.trim() === "") {
        throw new Error("Empty or invalid response");
      }

      return response;
    } catch (err) {
      logger.warn(`🔁 Retry ${attempt}/${retries} after error:`, err.message);
      if (attempt < retries) {
        await sleep(delay * attempt);
      }
    }
  }

  logger.error("🚨 Failed after max retries.");
  return "(error)";
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

    const json = await response.json();             // ✅ read body exactly once
    logger.debug("📦 Raw LLM response JSON:", json); // (optional)

    return json?.choices?.[0]?.message?.content?.trim() || "(empty)";

  } catch (error) {
    logger.error("🚨 Error in fetchLLMResponse (via xhandle prompt logic):", error);
    return "(error)";
  }
};

/** ----------------------------- STPA-SEC: Step 1 ------------------------------
 * Build the Vulnerable Control Actions (VCA) seed sheet from Functional Decomposition
 * Uses security-oriented guidewords (integrity, availability, confidentiality, routing/recipient)
 ------------------------------------------------------------------------------*/
export async function generateVulnerableControlActionsSheet_STPASEC({ sheets, setFolders, currentFolder }) {
  logger.debug("📥 Entered generateVulnerableControlActionsSheet_STPASEC");

  const decomposition = sheets["Functional Decomposition"];
  if (!decomposition || decomposition.length === 0) return;

  // VCA header uses security guidewords aligned with STPA timing/order + CIA + routing/leakage
  const headers = [
    "Control Action (or Info Flow)",
    "Corrupted/Tampered (Integrity)",
    "Missing/Not Provided (Availability)",
    "Provided Too Early (Timing)",
    "Provided Too Late (Timing)",
    "Wrong Order/Sequence",
    "Stopped Too Soon",
    "Applied Too Long",
    "Sent to Wrong Recipient/Interface (Routing)",
    "Exposed/Leaked (Confidentiality)"
  ];

  const newSheet = [headers];

  // (Context prepared if you want to use later)
  // const flattenedDecomposition = flattenSheetData(decomposition).slice(0, 5000);

  for (let i = 1; i < decomposition.length; i++) {
    const row = decomposition[i];
    const from = getCellText(row[0]);
    const action = getCellText(row[1]);
    const to = getCellText(row[2]);

    if (from && action && to) {
      const controlAction = `${from} issues ${action} to ${to}`;
      newSheet.push([controlAction, "", "", "", "", "", "", "", "", ""]);
    }
  }

  const updatedFolder = {
    ...sheets,
    "Vulnerable Control Actions (STPA-SEC)": newSheet,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedFolder,
    },
  }));

  logger.debug("✅ Generated VCA sheet (STPA-SEC) with decomposition context");
  return updatedFolder;
}

/** ----------------------------- STPA-SEC: Step 2 ------------------------------
 * Populate each VCA column using LLM with a single concise VCA → USC mapping
 ------------------------------------------------------------------------------*/
export async function populateVCAThreatColumnsWithLLM_STPASEC({
  sheets,
  setFolders,
  currentFolder,
  setChatResponse,
}) {
  logger.debug("📊 populateVCAThreatColumnsWithLLM_STPASEC called");

  const sheet = sheets["Vulnerable Control Actions (STPA-SEC)"];
  if (!sheet || sheet.length < 2) {
    logger.warn("⚠️ 'Vulnerable Control Actions (STPA-SEC)' is missing or empty.");
    return;
  }

  const columnHeaders = sheet[0];
  const updatedSheet = [columnHeaders];

  // Simple label→phrase hints for better LLM phrasing
  const guidewordHints = {
    "Corrupted/Tampered (Integrity)": "is corrupted or tampered with",
    "Missing/Not Provided (Availability)": "is missing or not provided",
    "Provided Too Early (Timing)": "is provided too early",
    "Provided Too Late (Timing)": "is provided too late",
    "Wrong Order/Sequence": "is issued in the wrong sequence",
    "Stopped Too Soon": "is stopped too soon",
    "Applied Too Long": "is applied for too long",
    "Sent to Wrong Recipient/Interface (Routing)": "is sent to an unintended recipient or interface",
    "Exposed/Leaked (Confidentiality)": "is exposed or leaked"
  };

  let fullVcaText = "";

  for (let r = 1; r < sheet.length; r++) {
    const row = sheet[r];
    const controlAction = getCellText(row[0]);
    if (!controlAction) {
      updatedSheet.push(Array(columnHeaders.length).fill(""));
      continue;
    }

    const newRow = [controlAction];

    for (let c = 1; c < columnHeaders.length; c++) {
      const header = columnHeaders[c];
      const hint = guidewordHints[header] || "is vulnerable";

      // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
      const prompt = `
You are performing an STPA-SEC analysis.

Task: Produce exactly **one** concise “Vulnerable Control Action (VCA)” statement that shows how:
- Control action: "${controlAction}"
- Under the condition: "${header}" (i.e., it ${hint})

Format the response as **one sentence**:
"[Actor] [vulnerably performs control action] to/with [recipient/component], enabling [Unacceptable Security Condition]."

Rules:
- Do NOT use lists, bullets, or multiple sentences.
- Use a crisp security outcome as the Unacceptable Security Condition (e.g., "unauthorized actuator actuation", "data exfiltration", "command spoofing", "replay enabling unintended motion").
- Keep it specific and security-focused (integrity, availability, confidentiality, routing/recipient errors, timing/order issues).
      `.trim();

      let resp = "";
      try {
        // use throttled+retry path to reduce 429s
        resp = await fetchWithRetry(prompt);
        resp = resp.replace(/\n+/g, " ").trim();
      } catch (err) {
        logger.error(`LLM error for row ${r}, column ${c}`, err);
        resp = "(LLM error)";
      }

      newRow.push(resp);
      if (resp && resp !== "(LLM error)") fullVcaText += resp + "; ";

      // tiny pacing to avoid bursts
      await sleep(300);
    }

    updatedSheet.push(newRow);
  }

  if (typeof setChatResponse === "function") {
    setChatResponse(fullVcaText.trim());
  }

  const updatedSheets = {
    ...sheets,
    "Vulnerable Control Actions (STPA-SEC)": updatedSheet,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  // Move to Threat Scenarios
  const next = await generateThreatScenariosSheet_STPASEC({
    vcaText: fullVcaText,
    sheets: updatedSheets,
    setFolders,
    currentFolder,
  });

  return next;
}

/** ----------------------------- STPA-SEC: Step 3 ------------------------------
 * Turn VCA lines into Threat Scenarios (Attack Paths)
 ------------------------------------------------------------------------------*/
export async function generateThreatScenariosSheet_STPASEC({
  vcaText = "",
  sheets,
  setFolders,
  currentFolder
}) {
  const header = ["Vulnerable Control Action (VCA)"];
  const rows = [header];

  const actions = vcaText
    .split(/;|\n/)
    .map((a) => a.trim())
    .filter(Boolean);

  for (const vca of actions) {
    rows.push([sanitizeText(vca)]);
  }

  const updatedSheets = {
    ...sheets,
    "Threat Scenarios": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  // Next: Security Controls
  return await generateSecurityControlsSheet_STPASEC({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });
}

/** ----------------------------- STPA-SEC: Step 4 ------------------------------
 * Security Controls (system-level mitigations)
 ------------------------------------------------------------------------------*/
export async function generateSecurityControlsSheet_STPASEC({
  sheets,
  setFolders,
  currentFolder
}) {
  const ts = sheets["Threat Scenarios"];
  if (!ts || ts.length < 2) {
    logger.warn("⚠️ 'Threat Scenarios' sheet is missing or empty.");
    return;
  }

  const header = ["Vulnerable Control Action", "Security Control"];
  const rows = [header];

  for (let i = 1; i < ts.length; i++) {
    const vca = getCellText(ts[i][0]);
    if (!vca) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
You are developing **system-level security controls** (not implementation detail) for the following VCA:

VCA:
${vca}

Write **one** concise security control as a single sentence describing what the system must ensure or prevent to neutralize the attack path. Avoid technology specifics (e.g., "TLS 1.3"). Keep it performance-/behavior-based.
`.trim();

    let control = "";
    try {
      control = await fetchWithRetry(prompt);
    } catch (err) {
      logger.error("LLM error for security control:", err);
      control = "(error generating security control)";
    }

    rows.push([sanitizeText(vca), sanitizeText(control.trim())]);

    await sleep(200);
  }

  const updatedSheets = {
    ...sheets,
    "Security Controls": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  // Next: System Security Requirements
  return await generateSystemSecurityRequirementsSheet_STPASEC({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });
}

/** ----------------------------- STPA-SEC: Step 5 ------------------------------
 * System Security Requirements ("The system shall ...")
 ------------------------------------------------------------------------------*/
export async function generateSystemSecurityRequirementsSheet_STPASEC({
  sheets,
  setFolders,
  currentFolder
}) {
  const controls = sheets["Security Controls"];
  if (!controls || controls.length < 2) {
    logger.warn("⚠️ 'Security Controls' sheet is missing or empty.");
    return;
  }

  const header = ["Security Control", "System Security Requirement"];
  const rows = [header];

  for (let i = 1; i < controls.length; i++) {
    const ctrl = getCellText(controls[i][1]);
    if (!ctrl) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
Write a **system security requirement** for the following control.
It must start with "The system shall..." and be **one** clear, verifiable shall-statement.

${ctrl}
`.trim();

    let req = "";
    try {
      req = await fetchWithRetry(prompt);
    } catch (err) {
      logger.error("LLM error for security requirement:", err);
      req = "(error generating requirement)";
    }

    rows.push([sanitizeText(ctrl), sanitizeText(req.trim())]);

    await sleep(200);
  }

  // Save under both keys so the shared consolidator can find it
  const updatedSheets = {
    ...sheets,
    "System Security Requirements": rows,
    "System Requirements": rows, // ← alias for the consolidator
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  // ✅ Consolidate via shared function
  const next = await generateBatchedRequirementsSheet({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });

  // ---- Fallback: if Consolidated Requirements missing or empty, create a passthrough ----
  const sheetsAfterCons = next || updatedSheets;
  const cons = sheetsAfterCons["Consolidated Requirements"];
  const needsFallback = !cons || cons.length < 2;

  let sheetsForNext = sheetsAfterCons;

  if (needsFallback) {
    const src = sheetsAfterCons["System Security Requirements"]?.slice(1) || [];
    const fallback = [["Original Requirement", "Consolidated Requirement"]];
    for (const r of src) {
      const reqTxt = getCellText(r[1]);
      if (reqTxt) fallback.push([reqTxt, reqTxt + " *"]); // mark as unconsolidated
    }

    sheetsForNext = {
      ...sheetsAfterCons,
      "Consolidated Requirements": fallback,
    };

    await setFolders((prev) => ({
      ...prev,
      [currentFolder]: {
        ...prev[currentFolder],
        ...sheetsForNext,
      },
    }));
  }

  // Then continue with STPA-SEC mappings
  return await generateSecurityCategoryMappingsSheet_STPASEC({
    sheets: sheetsForNext,
    setFolders,
    currentFolder
  });
}

/** ----------------------------- STPA-SEC: Step 6 ------------------------------
 * Map each VCA to a Security Category (CIA + A/N + Privacy + Mission)
 ------------------------------------------------------------------------------*/
export async function generateSecurityCategoryMappingsSheet_STPASEC({
  sheets,
  setFolders,
  currentFolder
}) {
  const ts = sheets["Threat Scenarios"];
  if (!ts || ts.length < 2) {
    logger.warn("⚠️ 'Threat Scenarios' sheet is missing or empty.");
    return;
  }

  const header = ["Vulnerable Control Action", "Security Category (CIA/A/N/Privacy/Mission)"];
  const rows = [header];

  for (let i = 1; i < ts.length; i++) {
    const vca = getCellText(ts[i][0]);
    if (!vca) continue;

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
Assign **one** concise security category to the following VCA.
Choose from:
- Confidentiality
- Integrity
- Availability
- Authenticity
- Non-repudiation
- Privacy
- Mission Degradation

VCA:
${vca}

Return only the category label, no commentary.
`.trim();

    let cat = "";
    try {
      cat = await fetchWithRetry(prompt);
    } catch (err) {
      logger.error("LLM error generating security category:", err);
      cat = "(error)";
    }

    const clean = (cat || "").split(/;|\n/)[0].trim();
    if (clean) rows.push([sanitizeText(vca), sanitizeText(clean)]);

    await sleep(150);
  }

  const updatedSheets = {
    ...sheets,
    "Security Category Mappings": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  // Next: map categories to business/operational losses
  return await generateSecurityLossMappingsSheet_STPASEC({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });
}

/** ----------------------------- STPA-SEC: Step 7 ------------------------------
 * Map Security Category → Business/Operational Losses
 ------------------------------------------------------------------------------*/
export async function generateSecurityLossMappingsSheet_STPASEC({
  sheets,
  setFolders,
  currentFolder
}) {
  const secCat = sheets["Security Category Mappings"];
  if (!secCat || secCat.length < 2) {
    logger.warn("⚠️ 'Security Category Mappings' sheet is missing or empty.");
    return;
  }

  const uniqueCats = new Set();
  for (let i = 1; i < secCat.length; i++) {
    const cat = getCellText(secCat[i][1]);
    if (cat) uniqueCats.add(cat);
  }

  const header = ["Security Category", "Business/Operational Loss"];
  const rows = [header];

  for (const cat of uniqueCats) {
    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const prompt = `
For the security category "${cat}", list distinct **business/operational losses** that could occur.
Choose concise labels such as:
- Operational Disruption
- Data Breach
- Financial Loss
- Safety Impact
- Regulatory Non-compliance
- Reputational Damage

Return one loss per line, no commentary.
`.trim();

    let lossList = "";
    try {
      lossList = await fetchWithRetry(prompt);
    } catch (err) {
      logger.error("LLM error for loss mapping:", err);
      lossList = "(error)";
    }

    const losses = (lossList || "")
      .split(/\n|;/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (const loss of losses) {
      rows.push([sanitizeText(cat), sanitizeText(loss)]);
    }

    await sleep(150);
  }

  const updatedSheets = {
    ...sheets,
    "Security Loss Mappings": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  // Final: Summary
  return await generateSecuritySummarySheet_STPASEC({
    sheets: updatedSheets,
    setFolders,
    currentFolder
  });
}

/** ----------------------------- STPA-SEC: Step 8 ------------------------------
 * Build the Security Summary table (Loss → USC → VCA → Control → SecReq → Consolidated)
 ------------------------------------------------------------------------------*/
export async function generateSecuritySummarySheet_STPASEC({
  sheets,
  setFolders,
  currentFolder
}) {
  const vcaSheet = sheets["Threat Scenarios"];                    // VCA list
  const catSheet = sheets["Security Category Mappings"];          // VCA → Security Category
  const lossSheet = sheets["Security Loss Mappings"];             // Sec Category → Losses
  const controlSheet = sheets["Security Controls"];               // VCA → Security Control
  const secReqSheet = sheets["System Security Requirements"];     // Control → Sec Req
  const consolidatedReqSheet = sheets["Consolidated Requirements"];

  const ok = {
    vca: !!vcaSheet && vcaSheet.length >= 2,
    cat: !!catSheet && catSheet.length >= 2,
    loss: !!lossSheet && lossSheet.length >= 2,
    ctrl: !!controlSheet && controlSheet.length >= 2,
    req: !!secReqSheet && secReqSheet.length >= 2,
    cons: !!consolidatedReqSheet && consolidatedReqSheet.length >= 2,
  };
  if (Object.values(ok).some(v => !v)) {
    logger.warn("⚠️ Missing sheets for Security Summary (detail):", {
      vcaPresent: !!vcaSheet, vcaLen: vcaSheet?.length,
      catPresent: !!catSheet, catLen: catSheet?.length,
      lossPresent: !!lossSheet, lossLen: lossSheet?.length,
      ctrlPresent: !!controlSheet, ctrlLen: controlSheet?.length,
      reqPresent: !!secReqSheet, reqLen: secReqSheet?.length,
      consPresent: !!consolidatedReqSheet, consLen: consolidatedReqSheet?.length,
    });
    logger.warn("⚠️ Missing sheets for Security Summary:", ok);
    return;
  }

  const header = [
    "Security Loss",
    "Unacceptable Security Condition",
    "Vulnerable Control Action",
    "Security Control",
    "System Security Requirement",
    "Consolidated Requirement"
  ];
  const rows = [header];

  // Build maps
  const vcaToCat = new Map();      // VCA → Security Category
  const catToLosses = new Map();   // Category → [Loss]
  const vcaToControl = new Map();  // VCA → Security Control
  const controlToReq = new Map();  // Control → Security Requirement
  const sysReqToConsolidated = new Map(); // Sec Req (normalized) → Consolidated

  for (let i = 1; i < catSheet.length; i++) {
    const vca = getCellText(catSheet[i][0]);
    const cat = getCellText(catSheet[i][1]);
    if (vca && cat) vcaToCat.set(vca.trim(), cat.trim());
  }

  for (let i = 1; i < lossSheet.length; i++) {
    const cat = getCellText(lossSheet[i][0]);
    const loss = getCellText(lossSheet[i][1]);
    if (!cat || !loss) continue;
    const key = cat.trim();
    if (!catToLosses.has(key)) catToLosses.set(key, []);
    catToLosses.get(key).push(loss.trim());
  }

  for (let i = 1; i < controlSheet.length; i++) {
    const vca = getCellText(controlSheet[i][0]);
    const ctrl = getCellText(controlSheet[i][1]);
    if (vca && ctrl) vcaToControl.set(vca.trim(), ctrl.trim());
  }

  for (let i = 1; i < secReqSheet.length; i++) {
    const ctrl = getCellText(secReqSheet[i][0]);
    const req = getCellText(secReqSheet[i][1]);
    if (ctrl && req) controlToReq.set(ctrl.trim(), req.trim());
  }

  for (let i = 1; i < consolidatedReqSheet.length; i++) {
    const original = getCellText(consolidatedReqSheet[i][0]);
    const consolidated = getCellText(consolidatedReqSheet[i][1]);
    if (original && consolidated) {
      sysReqToConsolidated.set(normalizeText(original), consolidated.trim());
    }
  }

  // Derive a concise USC from the VCA sentence (text after "enabling ...")
  function extractUSC(vcaSentence) {
    const m = /enabling\s+(.+?)\.?$/i.exec(vcaSentence || "");
    return m ? m[1].trim() : "(unacceptable security condition not found)";
    // If your model phrasing differs, adjust this extractor.
  }

  for (let i = 1; i < vcaSheet.length; i++) {
    const vca = getCellText(vcaSheet[i][0]);
    if (!vca) continue;

    const category = vcaToCat.get(vca.trim()) || "(security category not found)";
    const losses = catToLosses.get(category) || ["(loss not found)"];
    const control = vcaToControl.get(vca.trim()) || "(security control not found)";
    const rawReq = controlToReq.get(control.trim());
    const secReq = rawReq || "(security requirement not found)";
    const consolidated = rawReq
      ? (sysReqToConsolidated.get(normalizeText(rawReq)) || "(consolidated requirement not found)")
      : "(security requirement not found)";

    const usc = extractUSC(vca);

    for (const loss of losses) {
      rows.push([
        sanitizeText(loss),
        sanitizeText(usc),
        sanitizeText(vca),
        sanitizeText(control),
        sanitizeText(secReq),
        sanitizeText(consolidated)
      ]);
    }
  }

  const updatedSheets = {
    ...sheets,
    "Security Summary": rows,
  };

  await setFolders((prev) => ({
    ...prev,
    [currentFolder]: {
      ...prev[currentFolder],
      ...updatedSheets,
    },
  }));

  // Persist to IndexedDB (same pattern you already use)
  await saveFoldersToDB({
    ...(await loadFoldersFromDB()),
    [currentFolder]: {
      ...(updatedSheets[currentFolder] || updatedSheets),
      ...updatedSheets
    }
  });

  return updatedSheets;
}
