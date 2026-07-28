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
      return Array.from(new Map(all.map((item) => [item.id, item])).values()).map(normalizeSafetyCase);
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
  } catch {}
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
    return (cases || []).map(normalizeSafetyCase).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
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
    return safetyCase ? normalizeSafetyCase(safetyCase) : null;
  } catch {
    return loadFallback(projectId).find((item) => item.id === id) || null;
  }
}

export async function saveSafetyCase(safetyCase) {
  const normalized = normalizeSafetyCase({ ...safetyCase, updatedAt: nowISO() });
  try {
    const db = await openTraceabilityDB();
    const tx = createTraceabilityTransaction(db, STORE, "readwrite");
    if (!tx) throw new Error("Safety Case store unavailable.");
    await tx.store.put(normalized);
    await tx.done;
  } catch (error) {
    const list = loadFallback(normalized.projectId);
    const next = [normalized, ...list.filter((item) => item.id !== normalized.id)];
    saveFallbackList(normalized.projectId, next);
  }
  const mirrored = loadFallback(normalized.projectId);
  saveFallbackList(normalized.projectId, [normalized, ...mirrored.filter((item) => item.id !== normalized.id)]);
  setActiveSafetyCaseId(normalized.id);
  window.dispatchEvent?.(new CustomEvent("xhandle:safety-case-updated", { detail: normalized }));
  return normalized;
}

export async function createSafetyCase({ projectId = getActiveProjectId(), sourceProjectId, folderId = null, name } = {}) {
  return saveSafetyCase({
    ...createBlankSafetyCase({ projectId: sourceProjectId ?? projectId, name: name || "Untitled Safety Case" }),
    sourceProjectId: sourceProjectId ?? projectId ?? null,
    folderId,
  });
}

export async function deleteSafetyCase(id, projectId = undefined) {
  if (!id) return false;
  try {
    const db = await openTraceabilityDB();
    const tx = createTraceabilityTransaction(db, STORE, "readwrite");
    if (!tx) throw new Error("Safety Case store unavailable.");
    await tx.store.delete(id);
    await tx.done;
  } catch {
    saveFallbackList(projectId, loadFallback(projectId).filter((item) => item.id !== id));
  }
  saveFallbackList(projectId, loadFallback(projectId).filter((item) => item.id !== id));
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
