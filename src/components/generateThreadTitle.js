/**
 * xHandle: generate thread title shared application component.
 * This file implements a reusable application-level component or helper that participates in xHandle's end-to-end engineering workflows.
 * Shared components connect the main workspace, diagrams, copilot features, reporting, and local persistence so individual features can cooperate as one system.
 * Related files: src/App.js, src/lib/storage/indexedDB.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

// src/components/generateThreadTitle.js
import { backendURL, buildAIAuthOpts } from "./backendConfig";

/**
 * generateThreadTitle constructs the derived result needed by the feature for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param messages Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to the value that the next step in this workflow consumes.
 */
export async function generateThreadTitle(messages) {
    const slice = messages.slice(-8).map(m => `${m.role}: ${m.content}`).join("\n\n");
    const prompt = `Name this chat thread in 3–5 words.
  Rules:
  - Title Case
  - No quotes
  - Be specific if possible
  - If unclear, output: General Copilot Chat
  
  Conversation:
  ${slice}
  
  ONLY OUTPUT THE TITLE TEXT.`;
  
    const resp = await fetch(`${backendURL}/api/chat`, {
      method: "POST",
      ...buildAIAuthOpts({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });
    if (!resp.ok) throw new Error("title_generation_failed");
    const data = await resp.json();
    return (data?.choices?.[0]?.message?.content || "").trim();
  }
  
