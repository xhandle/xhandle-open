/**
 * xHandle: generate agentic report shared application component.
 * This file implements a reusable application-level component or helper that participates in xHandle's end-to-end engineering workflows.
 * Shared components connect the main workspace, diagrams, copilot features, reporting, and local persistence so individual features can cooperate as one system.
 * Related files: src/App.js, src/lib/storage/indexedDB.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

// generateAgenticReport.js
import { backendURL, buildAIAuthOpts } from "./backendConfig";
import { logger } from "./utils/logger";

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
 * extractJsonFromMarkdown prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param text Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function extractJsonFromMarkdown(text) {
  const match =
    text.match(/```json\s*([\s\S]*?)```/i) ||
    text.match(/```([\s\S]*?)```/i);
  return match ? match[1].trim() : text.trim();
}

const agentState = {
  method: "",
  summarySheet: [],
  chunkSize: 25,
  chunksCompleted: [],
  confidenceScores: [],
  failedChunks: [],
  auditObservations: [],
  mode: "interactive",
  onClarifyChunk: null,
  goalAssessment: null,
  revisionsMade: [],
  reportType: "Safety",
};

// --- Markdown helpers ---
function enforceListSpacing(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  let inCode = false;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
      out.push(line);
      continue;
    }
    if (!inCode) {
      const isListStart = /^(\s*[-*+]\s+|\s*\d+\.\s+)/.test(line);
      const prev = out.length ? out[out.length - 1] : "";
      if (isListStart && prev.trim() !== "") out.push("");
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * stripOuterMarkdownFence encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param text Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function stripOuterMarkdownFence(text) {
  const t = String(text || "").trim();
  const m = t.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1].trim() : t;
}

/**
 * chunkRows encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param rows Worksheet or table rows that this step transforms.
 * @param chunkSize Maximum number of rows to process per batch.
 * @returns the value that the next step in this workflow consumes.
 */
function chunkRows(rows, chunkSize = 25) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * fetchLLMResponse sends an xHandle prompt to the backend chat proxy and returns the model text needed by this module. In AI-heavy flows this is the boundary that packages local worksheet context, optional diagram context, and any user-authored prompt text into the request format expected by the server.
 * @param prompt Prompt text or prompt payload supplied to the AI step.
 * @param temperature Input consumed by this step of the xHandle workflow.
 * @param max_tokens Input consumed by this step of the xHandle workflow.
 * @param model Input consumed by this step of the xHandle workflow.
 * @param retries Input consumed by this step of the xHandle workflow.
 * @param system System instruction text that shapes the model response style or scope.
 * @returns Promise resolving to the model response text expected by the downstream pipeline step.
 */
async function fetchLLMResponse({
  prompt,
  temperature = 0.4,
  max_tokens = 1200,
  model = "gpt-4o",
  retries = 2,
  system = "You are a helpful, concise technical assistant.",
}) {
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature,
    max_tokens,             // ← pass through to your server
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${backendURL}/api/chat`, {
        method: "POST",
        ...buildAIAuthOpts({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`LLM Error (${res.status}): ${err}`);
      }

      const json = await res.json();
      const content = json.choices?.[0]?.message?.content || "";
      return content.trim();
    } catch (error) {
      logger.warn(`🔁 LLM retry ${attempt + 1} failed`, error);
      if (attempt === retries) throw error;
      await new Promise(r => setTimeout(r, 250 * (attempt + 1))); // tiny backoff
    }
  }
}

/** Tolerate 3- or 6-column FD rows */
function formatFDRow(row) {
  const a = getCellText(row[0]);
  const b = getCellText(row[1]);
  const c = getCellText(row[2]);
  const d = getCellText(row[3]);
  const e = getCellText(row[4]);
  const f = getCellText(row[5]);

  const hasRoles = row.length >= 6 && (b || d || f);
  if (hasRoles) {
    return `- From Function: "${a}" (${b})
→ Control Action: "${c}" (${d})
→ To Function: "${e}" (${f})`;
  }
  return `- From Function: "${a}"
→ Control Action: "${b}"
→ To Function: "${c}"`;
}

/**
 * describeFunctionalArchitecture executes one step of the workspace orchestration flow. This keeps the broader xHandle flow readable by isolating a named stage in the processing pipeline instead of mixing every transformation into one large procedure.
 * @param rows Worksheet or table rows that this step transforms.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function describeFunctionalArchitecture(rows) {
  if (!rows?.length) return "[No functional decomposition data provided]";

  // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
  const prompt = `
You are describing the system architecture based on the following functional decomposition table.
Each row represents a control interaction.

${rows.map(formatFDRow).join("\n\n")}

Write a clear, informative overview (2–3 short paragraphs) explaining:
- The major functions/components and their responsibilities
- How commands/data/signals flow between them
- Any coordination or timing mechanisms implied
- How the parts work together to achieve the system goal

Avoid repeating the row list; synthesize the architecture in plain English.
Do not wrap the entire output in code fences.
`.trim();

  const response = await fetchLLMResponse({ prompt });
  return stripOuterMarkdownFence(response);
}

/** Build a Markdown catalog of functions and interfaces from the FD rows. */
async function buildFunctionInterfaceCatalog(rows) {
  if (!rows?.length) {
    return "[No functional decomposition data available for catalog.]";
  }

  const normalized = rows.map(formatFDRow).join("\n");

  // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
  const prompt = `
You are producing a concise but complete Markdown catalog of functions and interfaces
from a functional decomposition. Use ONLY the information implicit in the rows.
Be consistent and avoid fabricating components not implied by the rows.

Rows:
${normalized}

Return Markdown with these sections:

## Functions

For each unique function, provide:

- **Function Name:** ...
- **Role & Purpose:** One or two sentences based on implied behavior
- **Inputs:** Bullet list of incoming control actions (Source → Action)
- **Outputs:** Bullet list of outgoing control actions (Action → Destination)
- **Dependencies/Constraints:** Any timing/ordering/assumptions implied by the rows

## Interfaces

For each unique interface (each control action row), provide:

- **Source Function:** ...
- **Control Action:** ...
- **Destination Function:** ...
- **Description:** Purpose/semantics of the interaction (one sentence)

Keep descriptions technical and specific, but concise. Do not include any extraneous sections.
Do not wrap the entire output in code fences.
`.trim();

  const md = await fetchLLMResponse({ prompt });
  return enforceListSpacing(stripOuterMarkdownFence(md));
}

/**
 * summarizeChunkInteractive executes one step of the workspace orchestration flow. This keeps the broader xHandle flow readable by isolating a named stage in the processing pipeline instead of mixing every transformation into one large procedure.
 * @param chunk Subset of rows processed as one AI or rendering batch.
 * @param headers Column headers used to label row values or generated output.
 * @param method Input consumed by this step of the xHandle workflow.
 * @param onClarifyChunk Callback used to notify the surrounding workflow about progress or user actions.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function summarizeChunkInteractive(
  chunk,
  headers,
  method,
  onClarifyChunk
) {
  const chunkInput = chunk
    .map((row) => headers.map((h, i) => `${h}: ${getCellText(row[i])}`).join("\n"))
    .join("\n\n");

  // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
  const basePrompt = `
You are a safety analysis expert.

Below is a section of a ${method} summary table. Summarize the key risks, failure modes, causal factors, mitigations, and requirements.

Also rate your confidence in this summary as a percentage (0-100), and return the result as:
{
  "summary": "...",
  "confidence": 85
}

Chunk:
${chunkInput}
  `.trim();

  try {
    const response = await fetchLLMResponse({ prompt: basePrompt });
    const cleanResponse = extractJsonFromMarkdown(response);
    const parsed = JSON.parse(cleanResponse);
    agentState.chunksCompleted.push(parsed.summary);
    agentState.confidenceScores.push(parsed.confidence);
    return { success: true, summary: parsed.summary };
  } catch (error) {
    if (typeof onClarifyChunk === "function") {
      const userAction = await onClarifyChunk({ chunkInput, headers, error });
      if (userAction?.action === "retry") {
        return await summarizeChunkInteractive(
          chunk,
          headers,
          method,
          onClarifyChunk
        );
      } else if (userAction?.action === "edit" && userAction?.editedPrompt) {
        const editedResponse = await fetchLLMResponse({
          prompt: userAction.editedPrompt,
        });
        agentState.chunksCompleted.push(editedResponse);
        agentState.confidenceScores.push(null);
        return { success: true, summary: editedResponse };
      }
    }
    return { success: false, error: error.message };
  }
}

/**
 * runGoalAssessment executes one step of the workspace orchestration flow. This keeps the broader xHandle flow readable by isolating a named stage in the processing pipeline instead of mixing every transformation into one large procedure.
 * @param summarySheet Input consumed by this step of the xHandle workflow.
 * @param method Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function runGoalAssessment(summarySheet, method) {
  const headers = summarySheet[0];
  const rows = summarySheet.slice(1);

  // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
  const prompt = `
You are an autonomous report-writing agent.

Your goal is to generate a high-quality safety analysis report that is:
1. Accurate
2. Clear and structured
3. Free from redundancy or gaps

Rate how well this can be achieved given the size and quality of the summary sheet below.
Return a JSON object with:
{
  "riskLevel": "low" | "medium" | "high",
  "expectedChunkCount": number,
  "recommendations": "string"
}

Summary Rows:
${rows
  .slice(0, 20)
  .map((row) => headers.map((h, i) => `${h}: ${getCellText(row[i])}`).join(", "))
  .join("\n")}
`.trim();

  const response = await fetchLLMResponse({ prompt });
  const cleanResponse = extractJsonFromMarkdown(response);
  const parsed = JSON.parse(cleanResponse);
  agentState.goalAssessment = parsed;

  if (parsed.riskLevel === "high") {
    agentState.chunkSize = 10;
  } else if (parsed.riskLevel === "medium") {
    agentState.chunkSize = 20;
  } else {
    agentState.chunkSize = 25;
  }
}

/**
 * runAgenticChunkLoop executes one step of the workspace orchestration flow. This keeps the broader xHandle flow readable by isolating a named stage in the processing pipeline instead of mixing every transformation into one large procedure.
 * @param summarySheet Input consumed by this step of the xHandle workflow.
 * @param method Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function runAgenticChunkLoop(summarySheet, method) {
  const headers = summarySheet[0];
  const rows = summarySheet.slice(1);
  const chunks = chunkRows(rows, agentState.chunkSize);

  for (const chunk of chunks) {
    const result = await summarizeChunkInteractive(
      chunk,
      headers,
      method,
      agentState.mode === "interactive" ? agentState.onClarifyChunk : null
    );

    if (!result.success) {
      agentState.failedChunks.push({ chunk, error: result.error });
      agentState.confidenceScores.push(null);
    }
  }
}

/**
 * auditChunkSummaries encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function auditChunkSummaries() {
  // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
  const auditPrompt = `
You are auditing safety report summaries.

Summaries:
${agentState.chunksCompleted.join("\n\n")}

Do any summaries appear low quality, vague, or redundant?
If so, return a list of indexes and suggestions to revise.

Return JSON:
{
  "needsRevision": boolean,
  "indexesToFix": [number],
  "revisionAdvice": [string]
}
`.trim();

  const audit = await fetchLLMResponse({ prompt: auditPrompt });
  const cleanAudit = extractJsonFromMarkdown(audit);
  const parsed = JSON.parse(cleanAudit);
  agentState.auditObservations.push(parsed);
  return parsed;
}

/**
 * reviseChunksFromAudit encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param audit Input consumed by this step of the xHandle workflow.
 * @param summarySheet Input consumed by this step of the xHandle workflow.
 * @param method Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function reviseChunksFromAudit(audit, summarySheet, method) {
  const headers = summarySheet[0];
  const rows = summarySheet.slice(1);

  for (const [i, advice] of audit.revisionAdvice.entries()) {
    const index = audit.indexesToFix[i];
    const start = index * agentState.chunkSize;
    const chunk = rows.slice(start, start + agentState.chunkSize);

    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const retryPrompt = `
Revise the following summary based on this advice: "${advice}"

Original summary:
${agentState.chunksCompleted[index]}

If needed, regenerate the summary from this chunk:
${chunk
  .map((row) => headers.map((h, i) => `${h}: ${getCellText(row[i])}`).join("\n"))
  .join("\n\n")}
`.trim();

    const revised = await fetchLLMResponse({ prompt: retryPrompt });
    agentState.chunksCompleted[index] = revised;
    agentState.revisionsMade.push({ index, advice });
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Report templates (instructions to avoid code fences)
   ──────────────────────────────────────────────────────────────────────────── */
const REPORT_TEMPLATES = {
  "System Design Document": ({ method, findings, notes, architectureDescription }) =>
    `
You are generating a **System Design Document (SDD)** in Markdown for engineering audiences.
Do not wrap the entire output in code fences.

# System Design Document

## 1. Introduction
- Purpose and scope of this document
- Audience and intended use
- Methodology used (${method}) and key inputs

## 2. System Overview
- Mission/Goals
- Operating environment and constraints
- High-level context and stakeholders

## 3. Architectural Design
[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]
${architectureDescription}

- Architecture style and rationale
- Major components/functions and responsibilities
- Control/data flow and sequencing/timing cues

## 4. Subsystem Decomposition
- Subsystems and their primary responsibilities
- Interfaces among subsystems
- Cross-cutting concerns (safety, reliability, security, performance)

## 5. Interfaces
- External interfaces (actors, services, hardware)
- Internal interfaces (between subsystems/components)
- Protocols, message schemas, and timing assumptions (if implied)

## 6. Data & State
- Key data objects and ownership
- Persistence/consistency considerations
- Telemetry/observability overview

## 7. Requirements Traceability (Summary)
- Mapping of major system requirements to design elements
- Notable gaps or open questions

## 8. Safety, Reliability, and Security
- Hazards/failure modes with brief context
- Mitigation patterns and design safeguards
- Defense-in-depth considerations

## 9. Verification & Validation Strategy
- Test levels (unit/integration/system/HIL/SIL/simulation)
- Acceptance criteria outline
- Tooling/automation cues

## 10. Risks & Assumptions
- Key risks and mitigations
- Assumptions and dependencies

---
Method: ${method}

Inputs summarized from findings (if any):
${findings || "[none]"}

Audit notes:
${notes}
`.trim(),

  "Subsystem Design Document": ({ method, findings, notes, architectureDescription }) =>
    `
You are generating a **Subsystem Design Document (SSDD)** in Markdown focused on a single subsystem.
Do not wrap the entire output in code fences.

# Subsystem Design Document: [Insert Subsystem Name]

## 1. Purpose & Scope
- Role of this subsystem in the overall system
- Boundaries, assumptions, dependencies
- Methodology (${method}) and inputs used

## 2. Subsystem Overview
- Responsibilities and key capabilities
- External interactions (who/what this subsystem talks to)

## 3. Internal Architecture
[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]
${architectureDescription}

- Internal components/functions and responsibilities
- Control/data flow within the subsystem
- Timing/sequencing and coordination

## 4. Interfaces
- Upstream interfaces (inputs: sources, contracts)
- Downstream interfaces (outputs: sinks, contracts)
- Data models, schemas, or message outlines (if implied)

## 5. Data Management
- Important state/data handled by the subsystem
- Ownership, lifecycle, and consistency notes
- Observability/telemetry hooks

## 6. Requirements Traceability (Local)
- Mapping of subsystem requirements to design elements
- Known gaps or TBD items

## 7. Safety & Reliability within the Subsystem
- Relevant hazards/failure modes (local view)
- Design mitigations, fail-safes, and diagnostics

## 8. Verification Strategy
- Test items traceable to requirements
- Environments and tooling
- Entry/exit criteria (local)

## 9. Risks, Assumptions, and Open Issues
- Key risks and mitigation plans
- Assumptions and dependencies
- Open technical questions

---
Method: ${method}

Inputs summarized from findings (if any):
${findings || "[none]"}

Audit notes:
${notes}
`.trim(),

  Safety: ({ method, findings, notes, architectureDescription }) =>
    `
You are generating a safety report in **Markdown**. Follow this exact structure and formatting.
Do not wrap the entire output in code fences.

# Safety Report

## 1. Executive Summary
[Plain-language summary of the analysis, ${method} used, key risks/failure modes, and safety goals.]

## 2. Analysis Scope
[Inclusions, exclusions, assumptions, boundaries, limitations.]

## 3. Functional Architecture
[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]
${architectureDescription}

## 4. Key Risks and Hazards
[For each relevant finding from "Findings", create a subsection:]

### [Hazard or Failure Mode]

**Hazard Description**
[Cause/evidence in one short sentence.]

**Potential Impacts**

- [Impact 1]
- [Impact 2]
- [Impact 3]

## 5. Mitigation Strategies & System Requirements
[For each hazard/failure mode:]

### [Hazard or Failure Mode]

**Mitigation Strategy**
- [High-level strategy]

**System Requirement**
- [Derived system requirement]

## 6. Lessons Learned & Recommendations

- [Actionable recommendation 1]
- [Actionable recommendation 2]

---
Method: ${method}

Findings:
${findings}

Audit notes:
${notes}
`.trim(),

  "Executive Brief": ({ method, findings, notes, architectureDescription }) =>
    `
You are generating an **Executive Brief** in Markdown aimed at VP/C-suite readers. Keep it crisp.
Do not wrap the entire output in code fences.

# Executive Brief

## Overview
[What the system does; why the analysis was run; ${method} used.]

## Top 5 Risks

- [Risk 1 • one sentence impact + likelihood cue]
- [Risk 2]
- [Risk 3]
- [Risk 4]
- [Risk 5]

## What We’re Doing About It

- [Key mitigation / control theme 1]
- [Key mitigation / control theme 2]
- [Key mitigation / control theme 3]

## Timeline & Dependencies

- [Near-term actions]
- [Medium-term]
- [Critical dependencies/owners]

## Appendix: System Snapshot
[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]
${architectureDescription}

---
Inputs summarized from findings:
${findings}

Audit notes:
${notes}
`.trim(),

  "Compliance Checklist": ({ method, findings, notes, architectureDescription }) =>
    `
You are generating a **Compliance Checklist** in Markdown. Use task-lists ([ ]/[x]).
Do not wrap the entire output in code fences.

# Compliance Checklist

## Target Standards & Clauses

- [ ] [Standard/Clause 1]: [Short description]
- [ ] [Standard/Clause 2]

## Evidence Mapping (from findings)
[Create grouped checklists that tie findings to controls.]

### [Control Area]

- [ ] Evidence present: [summary snippet]
- [ ] Gap: [describe]
- [ ] Action: [owner/date]

## Known Gaps & Remediations

- [Gap] → [Remediation] → [Owner] → [Due date]

## System Snapshot (Context)
[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]
${architectureDescription}

---
Method: ${method}

Findings:
${findings}

Audit notes:
${notes}
`.trim(),

  "Audit Readout": ({ method, findings, notes, architectureDescription }) =>
    `
Generate an **Audit Readout** in Markdown for an engineering review.
Do not wrap the entire output in code fences.

# Audit Readout

## Scope & Method

- Method: ${method}
- Scope: [components, boundaries]

## Observations
[Bullet major observations; tie to findings; cite issues/gaps clearly.]

- [Obs 1]
- [Obs 2]

## Nonconformities / Issues

- **NC-1:** [Title]  
  Summary: [1–2 sentences]  
  Evidence: [from findings]  
  Severity: [Low/Med/High]

- **NC-2:** [Title]  
  Summary: [...]  
  Evidence: [...]  
  Severity: [...]

## Recommendations

- [Recommendation 1]
- [Recommendation 2]

## Appendix: Architecture
[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]
${architectureDescription}

---
Findings:
${findings}

Audit notes:
${notes}
`.trim(),

  "Test Plan": ({ method, findings, notes, architectureDescription }) =>
    `
Produce a **high-level Test Plan** in Markdown. Derive target areas from findings.
Do not wrap the entire output in code fences.

# Test Plan

## Objectives

- Validate [safety/functional] requirements derived from ${method}.

## Scope

- In-scope: [subsystems, scenarios]
- Out-of-scope: [explicitly list]

## Test Strategy

- [Type: unit/integration/system/simulation/HIL/SIL]
- [Environments & data]

## Test Items (Traceable to Findings)
[Create grouped items. Each item: objective, brief method, expected result.]

### [Area/Feature]

- **TP-1:** Objective / Steps / Expected
- **TP-2:** ...

## Entry/Exit Criteria

- Entry: [...]
- Exit:  [...]

## Risks & Mitigations in Testing

- [Risk → mitigation]

## Traceability Matrix (sketch)

- [Requirement/Control] ↔ [Test Item(s)]

## Appendix: Architecture
[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]
${architectureDescription}

---
Derived from findings:
${findings}

Audit notes:
${notes}
`.trim(),

  "Risk Register": ({ method, findings, notes, architectureDescription }) =>
    `
Create a **Risk Register** in Markdown. Use a simple table.
Do not wrap the entire output in code fences.

# Risk Register

| ID | Risk / Failure Mode | Cause / Evidence | Impact | Mitigation | Owner | Status |
|---:|---|---|---|---|---|---|
| 1 | [Risk] | [Cause] | [Impact] | [Mitigation] | [Owner] | [Open] |
| 2 | ... | ... | ... | ... | ... | ... |

## Notes

- Prioritize by severity & detectability
- Review cadence and owners

## Context
[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]
${architectureDescription}

---
Method: ${method}

Summarized inputs:
${findings}

Audit notes:
${notes}
`.trim(),

  "Functional Architecture Definition": ({ method, findings, notes, architectureDescription }) =>
    `
You are generating a **Functional Architecture Definition** in Markdown.
Do not wrap the entire output in code fences.

# Functional Architecture Definition

## 1. Introduction
Describe the purpose of this document and the method (${method}) used to derive the architecture.

## 2. Functional Overview
Summarize how the system is organized functionally and the kinds of interactions (commands, signals, data).

## 3. Functional Elements
For each function in the decomposition, provide:

- **Function Name:** [Name]
- **Role & Purpose:** One–two sentences
- **Inputs:** Incoming control actions (Source → Action)
- **Outputs:** Outgoing control actions (Action → Destination)
- **Dependencies/Constraints:** Timing/sequencing/assumptions if implied

## 4. Interfaces
For each interface (each control-action row), provide:

- **Source Function**
- **Control Action**
- **Destination Function**
- **Description** (one sentence on semantics/purpose)

## 5. Architecture Narrative
[[FUNCTIONAL_DIAGRAM_PLACEHOLDER]]
${architectureDescription}

Explain how the functions collectively realize the mission and how interfaces coordinate safe/effective operation.

## 6. Assumptions & Notes

- [Assumption 1]
- [Assumption 2]

---
Catalog derived from decomposition:
${findings}

Audit notes (if any):
${notes}
`.trim(),
};

/**
 * buildSynthesisPrompt constructs the derived result needed by the feature for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param reportType Input consumed by this step of the xHandle workflow.
 * @param method Input consumed by this step of the xHandle workflow.
 * @param findings Input consumed by this step of the xHandle workflow.
 * @param notes Input consumed by this step of the xHandle workflow.
 * @param architectureDescription Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function buildSynthesisPrompt(reportType, { method, findings, notes, architectureDescription }) {
  const template = REPORT_TEMPLATES[reportType] || REPORT_TEMPLATES.Safety;
  return template({ method, findings, notes, architectureDescription });
}

/** Build a compact sample of summary rows (as JSON) to give the LLM context (for Custom Report) */
function sampleSummaryRows(summarySheet, maxRows = 25) {
  try {
    if (!Array.isArray(summarySheet) || summarySheet.length < 2) return [];
    const headers = summarySheet[0].map((h) => String(h || ""));
    const rows = summarySheet.slice(1).slice(0, maxRows);
    return rows.map((row) => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = getCellText(row[i])));
      return obj;
    });
  } catch {
    return [];
  }
}

/**
 * synthesizeCustomReport encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param customPrompt Prompt text or prompt-related value used by this workflow.
 * @param method Input consumed by this step of the xHandle workflow.
 * @param architectureDescription Input consumed by this step of the xHandle workflow.
 * @param findings Input consumed by this step of the xHandle workflow.
 * @param summarySheet Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function synthesizeCustomReport({
  customPrompt,
  method,
  architectureDescription,
  findings,
  summarySheet,
}) {
  if (!customPrompt || !customPrompt.trim()) {
    throw new Error("Custom report requires a non-empty customPrompt.");
  }

  const sampleRows = sampleSummaryRows(summarySheet, 25);
  // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
  const prompt = `
You are generating a custom Markdown report. Follow the user's instructions precisely.
Return clean, valid Markdown suitable for rendering.
Do not wrap the entire output in code fences.

User Instructions:
${customPrompt}

Context:
- Method: ${method}

Functional Architecture Narrative:
${architectureDescription || "[none]"}

Findings Summaries:
${findings || "[none]"}

Summary Sheet (sample rows as JSON):
\`\`\`json
${JSON.stringify(sampleRows, null, 2)}
\`\`\`

Formatting rules:
- Use proper headings
- Insert a blank line before any list
- Avoid nesting <ul> inside paragraphs
- Keep it concise and technical
`.trim();

  const out = await fetchLLMResponse({ prompt });
  return enforceListSpacing(stripOuterMarkdownFence(out));
}

/**
 * synthesizeFinalReport encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param auditNotes Input consumed by this step of the xHandle workflow.
 * @param method Input consumed by this step of the xHandle workflow.
 * @param reportType Input consumed by this step of the xHandle workflow.
 * @param functionalDiagramImage Input consumed by this step of the xHandle workflow.
 * @param architectureDescription Input consumed by this step of the xHandle workflow.
 * @param customPrompt Prompt text or prompt-related value used by this workflow.
 * @param summarySheet Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
async function synthesizeFinalReport(
  auditNotes,
  method,
  reportType = "Safety",
  functionalDiagramImage = null,
  architectureDescription = "",
  customPrompt = "",
  summarySheet = []
) {
  const findings = agentState.chunksCompleted.length
    ? agentState.chunksCompleted.join("\n\n")
    : "";

  // CUSTOM REPORT path
  if (reportType === "Custom Report") {
    return await synthesizeCustomReport({
      customPrompt,
      method,
      architectureDescription,
      findings,
      summarySheet,
    });
  }

  const notes = auditNotes ? JSON.stringify(auditNotes) : "[No audit notes provided]";

  const synthesisPrompt = buildSynthesisPrompt(reportType, {
    method,
    findings: findings || "[No findings available]",
    notes,
    architectureDescription,
  });

  const noChunksOk = ["Functional Architecture Definition", "System Design Document", "Subsystem Design Document"];
  if (!agentState.chunksCompleted.length && !noChunksOk.includes(reportType)) {
    throw new Error("No analysis chunks were completed — unable to synthesize report.");
  }
  

  const finalReport = await fetchLLMResponse({ prompt: synthesisPrompt });
  return enforceListSpacing(stripOuterMarkdownFence(finalReport));
}

/**
 * generateAgenticRiskReport constructs the report content for the current workflow for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param summarySheet Input consumed by this step of the xHandle workflow.
 * @param method Input consumed by this step of the xHandle workflow.
 * @param mode Input consumed by this step of the xHandle workflow.
 * @param onClarifyChunk Callback used to notify the surrounding workflow about progress or user actions.
 * @param setProgress React state setter supplied by the parent workflow.
 * @param functionalDiagramImage Input consumed by this step of the xHandle workflow.
 * @param functionalDecomposition Input consumed by this step of the xHandle workflow.
 * @param reportType Input consumed by this step of the xHandle workflow.
 * @param customPrompt Prompt text or prompt-related value used by this workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function generateAgenticRiskReport({
  summarySheet,
  method,
  mode = "interactive",
  onClarifyChunk = null,
  setProgress = () => {},
  functionalDiagramImage = null,
  functionalDecomposition = [],
  reportType = "Safety",
  customPrompt = "",
}) {
  agentState.summarySheet = summarySheet;
  agentState.chunksCompleted = [];
  agentState.confidenceScores = [];
  agentState.failedChunks = [];
  agentState.auditObservations = [];
  agentState.revisionsMade = [];
  agentState.mode = mode;
  agentState.onClarifyChunk = onClarifyChunk;
  agentState.reportType = reportType;

  const totalSteps = 5;
  let step = 0;
  const updateProgress = () => setProgress({ step, total: totalSteps });

  if (reportType === "Functional Architecture Definition") {
    step++; updateProgress();

    const catalog = await buildFunctionInterfaceCatalog(functionalDecomposition);
    agentState.chunksCompleted.push(catalog);
    step++; updateProgress();

    const audit = { needsRevision: false, indexesToFix: [], revisionAdvice: [] };
    agentState.auditObservations.push(audit);
    step++; updateProgress();

    step++; updateProgress(); // no revisions

    const architectureDescription = await describeFunctionalArchitecture(functionalDecomposition);
    const finalReport = await synthesizeFinalReport(
      audit,
      method,
      reportType,
      functionalDiagramImage,
      architectureDescription,
      "",
      summarySheet
    );
    step++; updateProgress();

    return {
      report: finalReport,
      audit,
      state: agentState,
    };
  }

  // DEFAULT / CUSTOM REPORT pipeline
  await runGoalAssessment(summarySheet, method);
  step++; updateProgress();

  await runAgenticChunkLoop(summarySheet, method);
  step++; updateProgress();

  const audit = await auditChunkSummaries();
  step++; updateProgress();

  if (audit.needsRevision) {
    await reviseChunksFromAudit(audit, summarySheet, method);
  }
  step++; updateProgress();

  const architectureDescription = await describeFunctionalArchitecture(
    functionalDecomposition
  );

  const finalReport = await synthesizeFinalReport(
    audit,
    method,
    reportType,
    functionalDiagramImage,
    architectureDescription,
    customPrompt,
    summarySheet
  );
  step++; updateProgress();

  return {
    report: finalReport,
    audit,
    state: agentState,
  };
}
