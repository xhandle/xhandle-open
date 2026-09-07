import { openDB } from "idb";

const DB_NAME = "xhandle-project-hazard-analysis";
const DB_VERSION = 1;
const STORE_NAME = "analyses";

async function openHazardDatabase() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "projectId" });
    },
  });
}

export async function loadProjectHazardAnalysisRecord(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return null;
  try {
    const db = await openHazardDatabase();
    if (!db) return null;
    return (await db.get(STORE_NAME, id)) || null;
  } catch (error) {
    console.warn("[project-hazard-storage] Unable to load hazard analysis artifact", error);
    return null;
  }
}

export async function saveProjectHazardAnalysisRecord(projectId, data = {}) {
  const id = String(projectId || "").trim();
  if (!id) return false;
  try {
    const db = await openHazardDatabase();
    if (!db) return false;
    await db.put(STORE_NAME, {
      projectId: id,
      analysisResult: data.analysisResult ?? null,
      draftHazardRowsByIndex: data.draftHazardRowsByIndex || {},
      riskRegister: Array.isArray(data.riskRegister) ? data.riskRegister : [],
      updatedAt: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.error("[project-hazard-storage] Unable to persist hazard analysis artifact", error);
    return false;
  }
}

export async function deleteProjectHazardAnalysisRecord(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return false;
  try {
    const db = await openHazardDatabase();
    if (!db) return false;
    await db.delete(STORE_NAME, id);
    return true;
  } catch (error) {
    console.warn("[project-hazard-storage] Unable to delete hazard analysis artifact", error);
    return false;
  }
}

export const PROJECT_HAZARD_ANALYSIS_DB_CONFIG = { name: DB_NAME, version: DB_VERSION, storeName: STORE_NAME };
