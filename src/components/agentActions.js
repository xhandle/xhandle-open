/**
 * xHandle: agent actions shared application component.
 * This file implements a reusable application-level component or helper that participates in xHandle's end-to-end engineering workflows.
 * Shared components connect the main workspace, diagrams, copilot features, reporting, and local persistence so individual features can cooperate as one system.
 * Related files: src/App.js, src/lib/storage/indexedDB.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

// src/components/agentActions.js

/**
 * Dispatch a global event so other parts of xHandle can apply edits.
 * Listeners can subscribe, e.g.:
 *   window.addEventListener("xhandle:agent-apply", (e) => {
 *     const { actions, threadId } = e.detail;
 *     // mutate requirements/diagram/risk here...
 *   });
 */
export function dispatchAgentApply(detail) {
    window.dispatchEvent(new CustomEvent("xhandle:agent-apply", { detail }));
  }
  