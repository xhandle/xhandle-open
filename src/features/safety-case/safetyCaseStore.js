import { openTraceabilityDB, createTraceabilityTransaction, TRACEABILITY_STORES } from "../../components/utils/traceabilityDb";
import { createBlankSafetyCase, normalizeSafetyCase, nowISO, uuid } from "./safetyCaseTypes";

const STORE = TRACEABILITY_STORES.safetyCases;
const ACTIVE_KEY = "xhandle:safety-case-active-id";
const FOLDERS_KEY = "xhandle:safety-case-folders";

function lsFallbackKey(projectId = "workspace") {
  return `xhandle:safety-cases:${projectId || "workspace"}`;
}

function getActiveProjectId() {
  try {
    return localStorage.getItem("xhandle.activeProjectId") || null;
  } catch {
    return null;
  }
}

function loadFallback(projectId) {
  try {
    if (projectId === undefined) {
      const all = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key?.startsWith("xhandle:safety-cases:")) {
          const list = JSON.parse(localStorage.getItem(key) || "[]");
          if (Array.isArray(list)) all.push(...list);
        }
      }
      const byId = new Map();
      all.forEach((item) => byId.set(item.id, latestCase(byId.get(item.id), item)));
      return [...byId.values()].map(normalizeSafetyCase);
    }
    const list = JSON.parse(localStorage.getItem(lsFallbackKey(projectId)) || "[]");
    return Array.isArray(list) ? list.map(normalizeSafetyCase) : [];
  } catch {
    return [];
  }
}

function saveFallbackList(projectId, list) {
  try {
    localStorage.setItem(lsFallbackKey(projectId), JSON.stringify(list));
    return true;
  } catch { return false; }
}

function latestCase(primary, fallback) {
  if (!primary) return fallback || null;
  if (!fallback) return primary;
  if (String(fallback.updatedAt) > String(primary.updatedAt)) return fallback;
  if (fallback.updatedAt === primary.updatedAt && String(fallback.evidenceAutomation?.lastSyncedAt || "") > String(primary.evidenceAutomation?.lastSyncedAt || "")) return fallback;
  return primary;
}

export function getActiveSafetyCaseId() {
  try {
    return localStorage.getItem(ACTIVE_KEY) || null;
  } catch {
    return null;
  }
}

export function setActiveSafetyCaseId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {}
}

export async function loadSafetyCases(projectId = undefined) {
  try {
    const db = await openTraceabilityDB();
    const tx = createTraceabilityTransaction(db, STORE, "readonly");
    if (!tx) return loadFallback(projectId);
    let cases;
    if (projectId && tx.store.indexNames?.contains?.("by_project")) {
      cases = await tx.store.index("by_project").getAll(projectId);
    } else {
      cases = await tx.store.getAll();
    }
    await tx.done;
    const merged = new Map((cases || []).map((item) => [item.id, item]));
    loadFallback(projectId).forEach((item) => merged.set(item.id, latestCase(merged.get(item.id), item)));
    return [...merged.values()].filter((item) => projectId == null || String(item.projectId) === String(projectId)).map(normalizeSafetyCase).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  } catch (error) {
    console.warn("[SafetyCase] IndexedDB unavailable; using localStorage fallback.", error);
    return loadFallback(projectId);
  }
}

export async function loadSafetyCase(id, projectId = undefined) {
  if (!id) return null;
  try {
    const db = await openTraceabilityDB();
    const tx = createTraceabilityTransaction(db, STORE, "readonly");
    if (!tx) return loadFallback(projectId).find((item) => item.id === id) || null;
    const safetyCase = await tx.store.get(id);
    await tx.done;
    const latest = latestCase(safetyCase, loadFallback(projectId).find((item) => item.id === id));
    return latest ? normalizeSafetyCase(latest) : null;
  } catch {
    return loadFallback(projectId).find((item) => item.id === id) || null;
  }
}

function announceSaved(normalized) {
  window.dispatchEvent?.(new CustomEvent("xhandle:safety-case-updated", { detail: normalized }));
}

function mirrorCase(normalized) {
  const mirrored = loadFallback(normalized.projectId);
  return saveFallbackList(normalized.projectId, [normalized, ...mirrored.filter((item) => item.id !== normalized.id)]);
}

export async function saveSafetyCase(safetyCase) {
  let normalized = normalizeSafetyCase({ ...safetyCase, updatedAt: nowISO() });
  try {
    const db = await openTraceabilityDB();
    const tx = createTraceabilityTransaction(db, STORE, "readwrite");
    if (!tx) throw new Error("Safety Case store unavailable.");
    tx.done.catch(() => {});
    const existing = latestCase(await tx.store.get(normalized.id), loadFallback(normalized.projectId).find((item) => item.id === normalized.id));
    // Automatic state is maintained independently of the editor's draft. Merge
    // it inside the write transaction so a stale UI save cannot replace it.
    if (existing) normalized.evidenceAutomation = String(existing.sourceProjectId ?? existing.projectId) === String(normalized.sourceProjectId ?? normalized.projectId) ? existing.evidenceAutomation || null : null;
    await tx.store.put(normalized);
    await tx.done;
  } catch (error) {
    const existing = loadFallback(normalized.projectId).find((item) => item.id === normalized.id);
    if (existing) normalized.evidenceAutomation = String(existing.sourceProjectId ?? existing.projectId) === String(normalized.sourceProjectId ?? normalized.projectId) ? existing.evidenceAutomation || null : null;
    if (!mirrorCase(normalized)) throw new Error("Safety case could not be saved to IndexedDB or browser storage.");
  }
  mirrorCase(normalized);
  setActiveSafetyCaseId(normalized.id);
  announceSaved(normalized);
  return normalized;
}

// The updater is synchronous and receives the latest committed manual content.
// It writes only automatic state; no node/title/link/status fields are replaced.
export async function updateSafetyCaseAutomation(id, reconcile) {
  const db = await openTraceabilityDB();
  const tx = createTraceabilityTransaction(db, STORE, "readwrite");
  if (!tx) throw new Error("Safety Case store unavailable.");
  tx.done.catch(() => {});
  const stored = await tx.store.get(id);
  const existing = latestCase(stored, loadFallback().find((item) => item.id === id));
  if (!existing) { await tx.done; return null; }
  const automatic = reconcile(existing);
  if (JSON.stringify(automatic) === JSON.stringify(existing.evidenceAutomation || null)) {
    await tx.done;
    return existing;
  }
  const next = { ...existing, evidenceAutomation: automatic };
  await tx.store.put(next);
  await tx.done;
  mirrorCase(next);
  announceSaved(next);
  return next;
}

export async function createSafetyCase({ projectId = getActiveProjectId(), sourceProjectId, folderId = null, name } = {}) {
  return saveSafetyCase({
    ...createBlankSafetyCase({ projectId: sourceProjectId ?? projectId, name: name || "Untitled Safety Case" }),
    sourceProjectId: sourceProjectId ?? projectId ?? null,
    folderId,
  });
}

export async function deleteSafetyCase(id) {
  if (!id) return false;
  const db = await openTraceabilityDB();
  const tx = createTraceabilityTransaction(db, STORE, "readwrite");
  if (!tx) throw new Error("Safety Case store unavailable.");
  tx.done.catch(() => {});
  await tx.store.delete(id);
  await tx.done;
  // Remove every mirror, including cases moved between projects. Otherwise the
  // fallback merge would resurrect a successfully deleted primary record.
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key) => key?.startsWith("xhandle:safety-cases:"));
  for (const key of keys) {
    const list = JSON.parse(localStorage.getItem(key) || "[]");
    if (Array.isArray(list) && list.some((item) => item.id === id)) localStorage.setItem(key, JSON.stringify(list.filter((item) => item.id !== id)));
  }
  if (getActiveSafetyCaseId() === id) setActiveSafetyCaseId(null);
  window.dispatchEvent?.(new CustomEvent("xhandle:safety-case-deleted", { detail: { id } }));
  return true;
}

export async function duplicateSafetyCase(id, projectId = undefined) {
  const existing = await loadSafetyCase(id, projectId);
  if (!existing) throw new Error("Safety case not found.");
  const timestamp = nowISO();
  const nodeIdMap = new Map(existing.nodes.map((node) => [node.id, uuid("scn")]));
  const copy = normalizeSafetyCase({
    ...existing,
    id: uuid("safety-case"),
    name: `${existing.name || "Safety Case"} Copy`,
    createdAt: timestamp,
    updatedAt: timestamp,
    evidenceAutomation: existing.evidenceAutomation ? {
      ...existing.evidenceAutomation,
      allocations: (existing.evidenceAutomation.allocations || []).map((item) => ({ ...item, nodeId: nodeIdMap.get(item.nodeId) })).filter((item) => item.nodeId),
    } : null,
    nodes: existing.nodes.map((node) => ({
      ...node,
      id: nodeIdMap.get(node.id),
      parentId: node.parentId ? nodeIdMap.get(node.parentId) || null : null,
      metadata: { ...node.metadata, createdAt: timestamp, updatedAt: timestamp, lastModifiedBy: "user" },
    })),
    edges: existing.edges.map((edge) => ({
      ...edge,
      id: uuid("sce"),
      source: nodeIdMap.get(edge.source),
      target: nodeIdMap.get(edge.target),
    })),
  });
  return saveSafetyCase(copy);
}

export function loadSafetyCaseFolders() {
  try {
    const list = JSON.parse(localStorage.getItem(FOLDERS_KEY) || "[]");
    if (!Array.isArray(list)) return [];
    const filtered = list.filter((folder) => String(folder?.name || "").trim().toLowerCase() !== "unfiled");
    if (filtered.length !== list.length) {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(filtered));
    }
    return filtered;
  } catch {
    return [];
  }
}

export function saveSafetyCaseFolders(folders) {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders || []));
  } catch {}
  window.dispatchEvent?.(new CustomEvent("xhandle:safety-case-folders-updated", { detail: folders || [] }));
  return folders || [];
}

export function createSafetyCaseFolder({ name, parentId = null } = {}) {
  const folderName = String(name || "New Folder").trim() || "New Folder";
  if (folderName.toLowerCase() === "unfiled") return null;
  const folder = {
    id: uuid("sc-folder"),
    name: folderName,
    parentId: parentId || null,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  saveSafetyCaseFolders([...loadSafetyCaseFolders(), folder]);
  return folder;
}

export function renameSafetyCaseFolder(id, name) {
  const cleanName = String(name || "").trim();
  if (cleanName.toLowerCase() === "unfiled") return loadSafetyCaseFolders();
  const next = loadSafetyCaseFolders().map((folder) => folder.id === id ? { ...folder, name: cleanName || folder.name, updatedAt: nowISO() } : folder);
  return saveSafetyCaseFolders(next);
}

export async function removeLegacyUnfiledSafetyCaseFolders() {
  let rawFolders = [];
  try {
    rawFolders = JSON.parse(localStorage.getItem(FOLDERS_KEY) || "[]");
  } catch {
    rawFolders = [];
  }
  if (!Array.isArray(rawFolders)) return false;
  const legacyIds = new Set(rawFolders.filter((folder) => String(folder?.name || "").trim().toLowerCase() === "unfiled").map((folder) => folder.id));
  if (!legacyIds.size) return false;
  const nextFolders = rawFolders.filter((folder) => !legacyIds.has(folder.id));
  saveSafetyCaseFolders(nextFolders);
  const cases = await loadSafetyCases();
  await Promise.all(cases.filter((item) => legacyIds.has(item.folderId)).map((item) => saveSafetyCase({ ...item, folderId: null })));
  return true;
}

export function moveSafetyCaseFolder(id, parentId = null) {
  const folders = loadSafetyCaseFolders();
  const folder = folders.find((item) => item.id === id);
  if (!folder) return folders;

  const nextParentId = parentId || null;
  if (nextParentId === id) return folders;

  const descendantIds = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of folders) {
      if ((item.parentId === id || descendantIds.has(item.parentId)) && !descendantIds.has(item.id)) {
        descendantIds.add(item.id);
        changed = true;
      }
    }
  }
  if (nextParentId && descendantIds.has(nextParentId)) return folders;

  const next = folders.map((item) => item.id === id ? { ...item, parentId: nextParentId, updatedAt: nowISO() } : item);
  return saveSafetyCaseFolders(next);
}

export async function deleteSafetyCaseFolder(id) {
  const folders = loadSafetyCaseFolders();
  const childIds = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && childIds.has(folder.parentId) && !childIds.has(folder.id)) {
        childIds.add(folder.id);
        changed = true;
      }
    }
  }
  saveSafetyCaseFolders(folders.filter((folder) => !childIds.has(folder.id)));
  const cases = await loadSafetyCases();
  await Promise.all(cases.filter((item) => childIds.has(item.folderId)).map((item) => saveSafetyCase({ ...item, folderId: null })));
  return true;
}
