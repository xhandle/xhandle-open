/**
 * xHandle: copilot threads shared application component.
 * This file implements a reusable application-level component or helper that participates in xHandle's end-to-end engineering workflows.
 * Shared components connect the main workspace, diagrams, copilot features, reporting, and local persistence so individual features can cooperate as one system.
 * Related files: src/App.js, src/lib/storage/indexedDB.js, src/features/hazard-analysis/aiAnalysisLite.js.
 */

// src/components/copilotThreads.js
const KEY = "xhc.threads";

/**
 * loadThreads reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @returns the normalized data requested by this module.
 */
export function loadThreads() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
/**
 * saveThreads writes module state into the storage or backend boundary used by xHandle. Keeping persistence logic in a dedicated function makes it easier to reason about when engineering artifacts become durable.
 * @param threads Input consumed by this step of the xHandle workflow.
 * @returns completion of the persistence operation.
 */
export function saveThreads(threads) {
  localStorage.setItem(KEY, JSON.stringify(threads));
}
/**
 * newThread encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param title Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function newThread(title = "New topic") {
  const t = {
    id: crypto.randomUUID(),
    title,
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    autoTitleDone: false,
    messages: [{ role: "assistant", content: "New thread. How can I help?" }],
  };
  const all = loadThreads();
  all.unshift(t);
  saveThreads(all);
  return t;
}
/**
 * renameThread encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @param title Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function renameThread(id, title) {
  const all = loadThreads();
  const i = all.findIndex(t => t.id === id);
  if (i >= 0) { all[i].title = title || all[i].title; all[i].updatedAt = Date.now(); saveThreads(all); }
}
/**
 * deleteThread encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns completion of the persistence operation.
 */
export function deleteThread(id) {
  const all = loadThreads().filter(t => t.id !== id);
  saveThreads(all);
}
/**
 * togglePin encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function togglePin(id) {
  const all = loadThreads();
  const i = all.findIndex(t => t.id === id);
  if (i >= 0) { all[i].pinned = !all[i].pinned; all[i].updatedAt = Date.now(); saveThreads(all); }
}
/**
 * appendMessage encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @param msg Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function appendMessage(id, msg) {
  const all = loadThreads();
  const i = all.findIndex(t => t.id === id);
  if (i >= 0) {
    all[i].messages.push(msg);
    all[i].updatedAt = Date.now();
    saveThreads(all);
    return all[i];
  }
  return null;
}
/**
 * setMessages encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @param messages Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function setMessages(id, messages) {
  const all = loadThreads();
  const i = all.findIndex(t => t.id === id);
  if (i >= 0) {
    all[i].messages = messages;
    all[i].updatedAt = Date.now();
    saveThreads(all);
  }
}
