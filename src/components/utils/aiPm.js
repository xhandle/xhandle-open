/**
 * xHandle: ai pm shared UI utility.
 * This file provides shared helper logic used by frontend components, often as a compatibility layer while imports converge on the newer lib-oriented architecture.
 * Keeping reusable helpers in one place reduces duplication across feature surfaces and makes local-first data handling, exports, and copilot context easier to evolve safely.
 * Related files: src/lib/storage/indexedDB.js, src/lib/storage/requirementsStore.ts, src/components/XHandleCopilotView.jsx.
 */

// src/components/utils/aiPm.js
import { backendURL, buildAIAuthOpts } from "../backendConfig";

/**
 * askAIPM encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param kind Input consumed by this step of the xHandle workflow.
 * @param payload Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function askAIPM(kind, payload) {
  const sys = {
    role: "system",
    content:
      "You are an AI project manager focused on risk mitigation. Always return concise, valid JSON."
  };

  let userContent = "";
  if (kind === "review_plan") {
    userContent = `
Return JSON: {"summary":string,"sessions":[{"when":string,"title":string,"owner":string,"scope":string}]}
Prioritize by severity*likelihood and urgency (due). Timebox 14 days.

Project: ${payload.projectName}
Risks: ${safe(payload.risks)}
ContextSummaryRows: ${safe(payload.context?.analysisSummary || [])}
`.trim();
  } else if (kind === "resolution_strategy") {
    userContent = `
Return JSON: {"summary":string,"steps":[string]}
Draft concrete steps for this risk using context.

Project: ${payload.projectName}
Risk: ${safe(payload.risk)}
ContextSummaryRows: ${safe(payload.context?.analysisSummary || [])}
`.trim();
  } else if (kind === "owner_suggestion") {
    userContent = `
Return JSON: {"owner":string,"rationale":string}
Pick the most appropriate owner; if unsure, suggest a team lead.

Project: ${payload.projectName}
Risk: ${safe(payload.risk)}
ContextSummaryRows: ${safe(payload.context?.analysisSummary || [])}
`.trim();
  } else {
    throw new Error("Unsupported AIPM kind");
  }

  // ✅ call your server proxy instead of OpenAI directly
  const resp = await fetch(`${backendURL}/api/chat`, {
    method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [sys, { role: "user", content: userContent }],
      temperature: 0.2,
      // Optional: enforce JSON if your server forwards response_format
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => "");
    throw new Error(`LLM proxy error (${resp.status}): ${errTxt}`);
  }

  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content || "";

  try {
    return JSON.parse(extractJson(raw));
  } catch {
    return { summary: String(raw).slice(0, 500) };
  }
}

// ---------- helpers ----------
function safe(x) {
  try {
    return JSON.stringify(x).slice(0, 20000);
  } catch {
    return "[]";
  }
}

/**
 * extractJson prepares raw input so downstream xHandle logic can rely on a predictable shape. Data-cleanup helpers like this are important because AI prompts, diagrams, and worksheet pipelines all depend on stable, human-readable text and identifiers.
 * @param txt Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
function extractJson(txt) {
  if (typeof txt !== "string") return "{}";
  const m = txt.match(/```json\s*([\s\S]*?)```/i);
  if (m) return m[1];
  const i = txt.indexOf("{");
  return i >= 0 ? txt.slice(i) : "{}";
}
