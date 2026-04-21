/**
 * xHandle: view store shared UI utility.
 * This file provides shared helper logic used by frontend components, often as a compatibility layer while imports converge on the newer lib-oriented architecture.
 * Keeping reusable helpers in one place reduces duplication across feature surfaces and makes local-first data handling, exports, and copilot context easier to evolve safely.
 * Related files: src/lib/storage/indexedDB.js, src/lib/storage/requirementsStore.ts, src/components/XHandleCopilotView.jsx.
 */

const LS_PREFIX = "cba.views::";  // per-repo keyspace

function safeParse(json) { try { return JSON.parse(json); } catch { return null; } }

/**
 * listViews reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param viewKey Input consumed by this step of the xHandle workflow.
 * @returns the normalized data requested by this module.
 */
export function listViews(viewKey) {
  const raw = localStorage.getItem(LS_PREFIX + viewKey);
  const data = safeParse(raw) || { views: [], defaultId: null };
  return data;
}

/**
 * saveAll writes module state into the storage or backend boundary used by xHandle. Keeping persistence logic in a dedicated function makes it easier to reason about when engineering artifacts become durable.
 * @param viewKey Input consumed by this step of the xHandle workflow.
 * @param data Structured data payload associated with the current record or node.
 * @returns completion of the persistence operation.
 */
function saveAll(viewKey, data) {
  localStorage.setItem(LS_PREFIX + viewKey, JSON.stringify(data));
}

/**
 * upsertView encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param viewKey Input consumed by this step of the xHandle workflow.
 * @param view Input consumed by this step of the xHandle workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function upsertView(viewKey, view) {
  const data = listViews(viewKey);
  const existsIdx = data.views.findIndex(v => v.id === view.id);
  if (existsIdx >= 0) data.views[existsIdx] = { ...data.views[existsIdx], ...view };
  else data.views.push(view);
  saveAll(viewKey, data);
  return view.id;
}

/**
 * deleteView encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param viewKey Input consumed by this step of the xHandle workflow.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns completion of the persistence operation.
 */
export function deleteView(viewKey, id) {
  const data = listViews(viewKey);
  data.views = data.views.filter(v => v.id !== id);
  if (data.defaultId === id) data.defaultId = null;
  saveAll(viewKey, data);
}

/**
 * renameView encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param viewKey Input consumed by this step of the xHandle workflow.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @param name Human-readable name provided by the user or calling code.
 * @returns the value that the next step in this workflow consumes.
 */
export function renameView(viewKey, id, name) {
  const data = listViews(viewKey);
  const v = data.views.find(v => v.id === id);
  if (v) v.name = name;
  saveAll(viewKey, data);
}

/**
 * setDefaultView encapsulates a focused piece of workspace orchestration flow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param viewKey Input consumed by this step of the xHandle workflow.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns the value that the next step in this workflow consumes.
 */
export function setDefaultView(viewKey, id) {
  const data = listViews(viewKey);
  data.defaultId = id;
  saveAll(viewKey, data);
}

/**
 * getDefaultView reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param viewKey Input consumed by this step of the xHandle workflow.
 * @returns the normalized data requested by this module.
 */
export function getDefaultView(viewKey) {
  const data = listViews(viewKey);
  if (!data.defaultId) return null;
  return data.views.find(v => v.id === data.defaultId) || null;
}
