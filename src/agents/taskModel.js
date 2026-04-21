/**
 * xHandle: task model agent infrastructure.
 * This file defines the runtime-side structures that support xHandle's agent model, including task descriptions, monitoring hooks, and capability metadata.
 * These modules provide the shared contract between agent UIs and the orchestration logic that decides what an AI assistant should do, how it reports progress, and how task state is represented.
 * Related files: src/features/agents/xAgent/XAgentCenter.jsx, src/components/agentController.js, src/components/agentActions.js.
 */

// Simple localStorage-backed task store. Swap to IndexedDB anytime.
// Task shape:
// { id, kind, title, prompt, payload, status, assignedTo, priority, dueAt, createdAt, updatedAt }

const KEY = "xhandle:agentTasks";

/**
 * loadAll reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @returns the normalized data requested by this module.
 */
function loadAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
/**
 * saveAll writes module state into the storage or backend boundary used by xHandle. Keeping persistence logic in a dedicated function makes it easier to reason about when engineering artifacts become durable.
 * @param list Input consumed by this step of the xHandle workflow.
 * @returns completion of the persistence operation.
 */
function saveAll(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

/**
 * listTasks reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param kind Input consumed by this step of the xHandle workflow.
 * @returns the normalized data requested by this module.
 */
export function listTasks(kind) {
  return loadAll().filter(t => !kind || t.kind === kind).sort((a,b)=>b.createdAt - a.createdAt);
}

/**
 * createTask constructs the task or UI state used by the agent workspace for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param kind Input consumed by this step of the xHandle workflow.
 * @param title Input consumed by this step of the xHandle workflow.
 * @param prompt Prompt text or prompt payload supplied to the AI step.
 * @param payload Input consumed by this step of the xHandle workflow.
 * @param assignedTo Input consumed by this step of the xHandle workflow.
 * @param priority Input consumed by this step of the xHandle workflow.
 * @param dueAt Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function createTask({ kind, title, prompt, payload = {}, assignedTo = "", priority = "Normal", dueAt = null }) {
  const now = Date.now();
  const id = `${kind}-${now}`;
  const t = { id, kind, title, prompt, payload, status: "Open", assignedTo, priority, dueAt, createdAt: now, updatedAt: now };
  const all = loadAll();
  all.push(t);
  saveAll(all);
  return t;
}

/**
 * updateTask encapsulates a focused piece of agent orchestration workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @param patch Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function updateTask(id, patch) {
  const all = loadAll();
  const i = all.findIndex(t => t.id === id);
  if (i >= 0) {
    all[i] = { ...all[i], ...patch, updatedAt: Date.now() };
    saveAll(all);
    return all[i];
  }
  return null;
}

/**
 * deleteTask encapsulates a focused piece of agent orchestration workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns completion of the persistence operation.
 */
export function deleteTask(id) {
  const all = loadAll().filter(t => t.id !== id);
  saveAll(all);
}
