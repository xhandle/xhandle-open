/**
 * xHandle: lite prompt handler functional-architecture workflow.
 * This file supports xHandle's functional-architecture flow, where users describe a system, generate functional decomposition rows, and turn those rows into diagram-ready structure.
 * Functional decomposition is the upstream model that later feeds hazard analysis, reporting, traceability, and other AI-assisted engineering workflows throughout the application.
 * Related files: src/App.js, src/components/diagrams/LiteSummaryDiagramReactFlow.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

import { backendURL, buildAIAuthOpts } from "../../lib/api/backendConfig";
import { logger } from "../../lib/utils/logger";

/**
 * handleLitePromptSubmit encapsulates a focused piece of functional-architecture generation flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param prompt Prompt text or prompt payload supplied to the AI step.
 * @param setResponse React state setter supplied by the parent workflow.
 * @param setPrompt React state setter supplied by the parent workflow.
 * @param context Context object or text used to enrich this step.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export const handleLitePromptSubmit = async (prompt, setResponse, setPrompt, context = {}) => {
  if (!prompt || prompt.trim().length === 0) {
    setResponse(JSON.stringify([], null, 2));
    setPrompt("");
    return;
  }

  try {
    // This prompt packages the local xHandle context for the current AI step and documents the response shape the caller expects back.
    const systemPrompt = `You are an AI system engineering assistant. Based on the following system description, return a comprehensive JSON array representing a functional decomposition of the system. Each object in the array should include:
- fromFunction
- fromDetails
- controlAction
- controlDetails
- toFunction
- toDetails

Rules:
- Represent bidirectional interfaces as two separate objects (one per direction).
- Include interactions with external entities where relevant.
- Prioritize functional clarity over implementation details.
- Return ONLY a JSON array (no prose, no markdown).

System description:
${prompt}`;

    const resp = await fetch(`${backendURL}/api/chat`, {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        // optional knobs if you want them:
        temperature: 0.2,
        max_tokens: 2000,
      }),
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      throw new Error(`LLM proxy error (${resp.status}): ${errTxt}`);
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "[]";

    // Try to pretty-print JSON if it is valid; otherwise pass through raw text
    let pretty = "[]";
    try {
      const parsed = JSON.parse(content);
      pretty = Array.isArray(parsed) ? JSON.stringify(parsed, null, 2) : JSON.stringify([], null, 2);
    } catch {
      // sometimes models wrap JSON in backticks; try a basic extraction
      const match = content.match(/\[([\s\S]*?)\]/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          pretty = JSON.stringify(parsed, null, 2);
        } catch {
          pretty = "[]";
        }
      }
    }

    setResponse(pretty);
  } catch (err) {
    logger.error("❌ Failed to fetch LLM decomposition:", err);
    setResponse(JSON.stringify([], null, 2));
  } finally {
    setPrompt("");
  }
};
