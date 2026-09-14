import { normalizeHazardOperationalContexts } from "../project-hazard-analysis/hazardOperationalContexts";

const STORAGE_PREFIX = "xhandle:code-architecture-hazard-contexts:v1";

function storageKey(projectId = "", repoId = "") {
  return `${STORAGE_PREFIX}:${encodeURIComponent(String(projectId || "default"))}:${encodeURIComponent(String(repoId || "repo"))}`;
}

export function loadCodeArchitectureHazardContexts({ projectId = "", repoId = "" } = {}) {
  if (typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(projectId, repoId)) || "[]");
    return normalizeHazardOperationalContexts(value);
  } catch {
    return [];
  }
}

export function saveCodeArchitectureHazardContexts({ projectId = "", repoId = "", contexts = [] } = {}) {
  const normalized = normalizeHazardOperationalContexts(contexts);
  if (typeof localStorage === "undefined") return normalized;
  localStorage.setItem(storageKey(projectId, repoId), JSON.stringify(normalized));
  try {
    window.dispatchEvent(new CustomEvent("xhandle:data-changed", {
      detail: { key: storageKey(projectId, repoId), projectId, repoId },
    }));
  } catch {}
  return normalized;
}

export function clearCodeArchitectureHazardContexts({ projectId = "", repoId = "" } = {}) {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(storageKey(projectId, repoId));
}

export { storageKey as codeArchitectureHazardContextStorageKey };
