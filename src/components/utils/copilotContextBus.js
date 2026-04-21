/**
 * xHandle: copilot context bus shared UI utility.
 * This file provides shared helper logic used by frontend components, often as a compatibility layer while imports converge on the newer lib-oriented architecture.
 * Keeping reusable helpers in one place reduces duplication across feature surfaces and makes local-first data handling, exports, and copilot context easier to evolve safely.
 * Related files: src/lib/storage/indexedDB.js, src/lib/storage/requirementsStore.ts, src/components/XHandleCopilotView.jsx.
 */

// src/utils/copilotContextBus.js
const KEY = "xhandle.copilotRegionContext";

/**
 * pushRegionContext encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param payload Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function pushRegionContext(payload) {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    arr.push(payload);
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch {}
}

/**
 * popAllRegionContext encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns the value that the next step in this workflow consumes.
 */
export function popAllRegionContext() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    localStorage.removeItem(KEY);
    return arr;
  } catch {
    return [];
  }
}
