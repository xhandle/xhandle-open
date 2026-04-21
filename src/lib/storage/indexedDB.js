/**
 * xHandle: indexed db storage infrastructure.
 * This file owns part of xHandle's client-side persistence layer, including IndexedDB schema management, local-first records, and compatibility with older data layouts.
 * Storage modules are responsible for making engineering artifacts durable in the browser so the UI, analysis pipelines, and traceability tools can share stable project state without a central database.
 * Related files: src/components/RequirementsManager.jsx, src/features/traceability/VnVCenterPro.jsx, src/App.js.
 */

// utils/indexedDB.js

import { openDB } from 'idb';

/**
 * ---------------------------------------------------------------------------
 * DB SETUP
 * ---------------------------------------------------------------------------
 * We keep your existing DBs and add robust stores for RequirementFolders/Requirements
 * inside TraceabilityDB (version bump to 2+). BaselinesDB and TraceabilityMeta
 * remain as you had them.
 */

const TRACE_DB_NAME = 'TraceabilityDB';
const TRACE_DB_VERSION = 4; // ⬅️ bump when schema changes

// Legacy keys you already use for simple folder persistence
const LEGACY_STORE_NAME = 'Folders';
const LEGACY_KEY = 'traceabilityFolders';

// New hierarchical requirement stores
const REQ_FOLDER_STORE = 'RequirementFolders';
const REQUIREMENT_STORE = 'Requirements';
const TRACE_REQUIRED_STORES = [LEGACY_STORE_NAME, REQ_FOLDER_STORE, REQUIREMENT_STORE];

// --- helpers ---
const nowISO = () => new Date().toISOString();
/**
 * uuid encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns storage-backed data or completion state.
 */
const uuid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * applyTraceSchemaUpgrade encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param db IndexedDB or database handle used for storage operations.
 * @param tx Transaction object used to coordinate a related set of storage changes.
 * @returns storage-backed data or completion state.
 */
function applyTraceSchemaUpgrade(db, tx) {
  // Legacy simple "Folders" store (keep for backward compat)
  if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
    db.createObjectStore(LEGACY_STORE_NAME);
  }

  // RequirementFolders
  if (!db.objectStoreNames.contains(REQ_FOLDER_STORE)) {
    const s = db.createObjectStore(REQ_FOLDER_STORE, { keyPath: 'id' });
    s.createIndex('by_project', 'projectId', { unique: false });
    s.createIndex('by_parent', 'parentId', { unique: false });
    s.createIndex('by_project_parent_order', ['projectId', 'parentId', 'order'], { unique: false });
  } else {
    const s = tx.objectStore(REQ_FOLDER_STORE);
    if (!s.indexNames.contains('by_project')) s.createIndex('by_project', 'projectId', { unique: false });
    if (!s.indexNames.contains('by_parent')) s.createIndex('by_parent', 'parentId', { unique: false });
    if (!s.indexNames.contains('by_project_parent_order')) {
      s.createIndex('by_project_parent_order', ['projectId', 'parentId', 'order'], { unique: false });
    }
  }

  // Requirements
  if (!db.objectStoreNames.contains(REQUIREMENT_STORE)) {
    const s = db.createObjectStore(REQUIREMENT_STORE, { keyPath: 'id' });
    s.createIndex('by_project', 'projectId', { unique: false });
    s.createIndex('by_folder', 'folderId', { unique: false });
  } else {
    const s = tx.objectStore(REQUIREMENT_STORE);
    if (!s.indexNames.contains('by_project')) {
      s.createIndex('by_project', 'projectId', { unique: false });
    }
    if (!s.indexNames.contains('by_folder')) {
      s.createIndex('by_folder', 'folderId', { unique: false });
    }
  }
}

/**
 * Run once at app startup to ensure schema exists at TRACE_DB_VERSION.
 * Call: await ensureTraceSchema() before any DB access.
 */
export async function ensureTraceSchema() {
  await openDB(TRACE_DB_NAME, TRACE_DB_VERSION, {
    // idb's upgrade signature: (db, oldVersion, newVersion, transaction)
    upgrade(db, _oldVersion, _newVersion, tx) {
      applyTraceSchemaUpgrade(db, tx);
    }
  });
}

/**
 * Routine opens should NOT pass a version — this attaches to the latest DB version
 * and avoids “requested version (x) is less than existing (y)” errors.
 */
async function openTraceDB() {
  const db = await openDB(TRACE_DB_NAME);
  const missing = TRACE_REQUIRED_STORES.filter((s) => !db.objectStoreNames.contains(s));
  if (missing.length === 0) return db;

  // Self-heal: if stores are missing, force an upgrade by bumping above current version.
  // This covers cases where another module created the DB at the same version but with fewer stores.
  const currentVersion = db.version || 1;
  const forcedVersion = Math.max(currentVersion + 1, TRACE_DB_VERSION + 1);
  db.close();
  await openDB(TRACE_DB_NAME, forcedVersion, {
    // Keep the schema and transaction boundaries explicit so project data can evolve without losing local-first compatibility.
    upgrade(upgradeDB, _oldVersion, _newVersion, tx) {
      applyTraceSchemaUpgrade(upgradeDB, tx);
    }
  });

  const healed = await openDB(TRACE_DB_NAME);
  const stillMissing = TRACE_REQUIRED_STORES.filter((s) => !healed.objectStoreNames.contains(s));
  if (stillMissing.length > 0) {
    healed.close();
    throw new Error(`TraceabilityDB is missing required stores: ${stillMissing.join(', ')}`);
  }
  return healed;
}

/**
 * ---------------------------------------------------------------------------
 * LEGACY SIMPLE FOLDERS (kept intact for compatibility)
 * ---------------------------------------------------------------------------
 */
export async function saveFoldersToDB(folders) {
  try {
    const db = await openTraceDB();
    await db.put(LEGACY_STORE_NAME, folders, LEGACY_KEY);
  } catch (err) {
    const msg = String(err?.message || err);
    const name = err?.name || '';
    const looksMissing =
      name === 'NotFoundError' ||
      msg.includes('One of the specified object stores was not found') ||
      msg.includes('not found');
    if (!looksMissing) throw err;

    await ensureTraceSchema();
    const healed = await openTraceDB();
    await healed.put(LEGACY_STORE_NAME, folders, LEGACY_KEY);
  }
}

/**
 * loadFoldersFromDB reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @returns Promise resolving to the normalized data requested by this module.
 */
export async function loadFoldersFromDB() {
  try {
    const db = await openTraceDB();
    const res = await db.get(LEGACY_STORE_NAME, LEGACY_KEY);
    return res || {};
  } catch (err) {
    // idb wraps DOMException; name/message vary by browser
    const msg = String(err?.message || err);
    const name = err?.name || '';
    const looksMissing =
      name === 'NotFoundError' ||
      msg.includes('One of the specified object stores was not found') ||
      msg.includes('not found');

    if (!looksMissing) throw err;

    // Self-heal: run canonical schema upgrade (to TRACE_DB_VERSION), then retry
    await ensureTraceSchema();

    const healed = await openTraceDB();
    const res = await healed.get(LEGACY_STORE_NAME, LEGACY_KEY);
    return res || {};
  }
}

/**
 * ---------------------------------------------------------------------------
 * BASELINES (unchanged from your file)
 * ---------------------------------------------------------------------------
 */
const BASELINE_DB = 'BaselinesDB';
const BASELINE_STORE = 'Baselines';

/**
 * saveBaselineToDB writes module state into the storage or backend boundary used by xHandle. Keeping persistence logic in a dedicated function makes it easier to reason about when engineering artifacts become durable.
 * @param projectName Input consumed by this step of the xHandle workflow.
 * @param baselineData Input consumed by this step of the xHandle workflow.
 * @returns completion of the persistence operation.
 */
export function saveBaselineToDB(projectName, baselineData) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BASELINE_DB, 1);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
// Create stores lazily during upgrades so older browser data can be migrated forward in place.
      if (!db.objectStoreNames.contains(BASELINE_STORE)) {
        db.createObjectStore(BASELINE_STORE);
      }
    };

    request.onsuccess = function () {
      const db = request.result;
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
      const tx = db.transaction(BASELINE_STORE, 'readwrite');
      const store = tx.objectStore(BASELINE_STORE);
      store.put(baselineData, projectName);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * loadBaselineFromDB reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param projectName Input consumed by this step of the xHandle workflow.
 * @returns the normalized data requested by this module.
 */
export function loadBaselineFromDB(projectName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BASELINE_DB, 1);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
// Create stores lazily during upgrades so older browser data can be migrated forward in place.
      if (!db.objectStoreNames.contains(BASELINE_STORE)) {
        db.createObjectStore(BASELINE_STORE);
      }
    };

    request.onsuccess = function () {
      const db = request.result;
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
      const tx = db.transaction(BASELINE_STORE, 'readonly');
      const store = tx.objectStore(BASELINE_STORE);
      const getRequest = store.get(projectName);

      getRequest.onsuccess = () => resolve(getRequest.result || null);
      getRequest.onerror = () => reject(getRequest.error);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * loadAllBaselinesFromDB reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @returns the normalized data requested by this module.
 */
export function loadAllBaselinesFromDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BASELINE_DB, 1);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
// Create stores lazily during upgrades so older browser data can be migrated forward in place.
      if (!db.objectStoreNames.contains(BASELINE_STORE)) {
        db.createObjectStore(BASELINE_STORE);
      }
    };

    request.onsuccess = function () {
      const db = request.result;
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
      const tx = db.transaction(BASELINE_STORE, 'readonly');
      const store = tx.objectStore(BASELINE_STORE);

      const getAllKeys = store.getAllKeys();
      const getAllValues = store.getAll();

      getAllKeys.onsuccess = () => {
        getAllValues.onsuccess = () => {
          const keys = getAllKeys.result;
          const values = getAllValues.result;
          const result = Object.fromEntries(keys.map((k, i) => [k, values[i]]));
          resolve(result);
        };
        getAllValues.onerror = () => reject(getAllValues.error);
      };
      getAllKeys.onerror = () => reject(getAllKeys.error);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * ---------------------------------------------------------------------------
 * META (unchanged): last processed SHA
 * ---------------------------------------------------------------------------
 */
export async function saveLastProcessedSHA(repoId, sha) {
  const db = await openDB('TraceabilityMeta', 1, {
    // Keep the schema and transaction boundaries explicit so project data can evolve without losing local-first compatibility.
    upgrade(db) {
// Create stores lazily during upgrades so older browser data can be migrated forward in place.
      if (!db.objectStoreNames.contains('shaStore')) {
        db.createObjectStore('shaStore');
      }
    }
  });
  await db.put('shaStore', sha, repoId);
}

/**
 * loadLastProcessedSHA reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param repoId Stable identifier for the entity this step works with.
 * @returns Promise resolving to the normalized data requested by this module.
 */
export async function loadLastProcessedSHA(repoId) {
  const db = await openDB('TraceabilityMeta', 1, {
    // Keep the schema and transaction boundaries explicit so project data can evolve without losing local-first compatibility.
    upgrade(db) {
// Create stores lazily during upgrades so older browser data can be migrated forward in place.
      if (!db.objectStoreNames.contains('shaStore')) {
        db.createObjectStore('shaStore');
      }
    }
  });
  return db.get('shaStore', repoId);
}

/**
 * ---------------------------------------------------------------------------
 * NEW: REQUIREMENT FOLDERS (hierarchical, per-project)
 * ---------------------------------------------------------------------------
 */

// Create a folder (root if parentId === null). Auto-assigns next order in siblings.
export async function createRequirementFolder(projectId, name = 'New Folder', parentId = null) {
  const db = await openTraceDB();
  const idx = db.transaction(REQ_FOLDER_STORE).store.index('by_project_parent_order');

  // find last sibling to compute order
  let order = 0;
  let last = null;
  for await (const cursor of idx.iterate(IDBKeyRange.bound([projectId, parentId, -Infinity], [projectId, parentId, Infinity]), 'prev')) {
    last = cursor.value;
    break;
  }
  if (last) order = (last.order ?? 0) + 1;

  const folder = { id: uuid(), projectId, name, parentId, order, createdAt: nowISO(), updatedAt: nowISO() };
  await db.add(REQ_FOLDER_STORE, folder);
  return folder;
}

/**
 * renameRequirementFolder encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param folderId Folder identifier used to scope hierarchical requirement records.
 * @param name Human-readable name provided by the user or calling code.
 * @returns Promise resolving to storage-backed data or completion state.
 */
export async function renameRequirementFolder(folderId, name) {
  const db = await openTraceDB();
  const s = db.transaction(REQ_FOLDER_STORE, 'readwrite').store;
  const f = await s.get(folderId);
  if (!f) return null;
  f.name = name;
  f.updatedAt = nowISO();
  await s.put(f);
  return f;
}

/**
 * moveRequirementFolder encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param folderId Folder identifier used to scope hierarchical requirement records.
 * @param newParentId Stable identifier for the entity this step works with.
 * @returns Promise resolving to storage-backed data or completion state.
 */
export async function moveRequirementFolder(folderId, newParentId = null) {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction(REQ_FOLDER_STORE, 'readwrite');
  const s = tx.store;

  const f = await s.get(folderId);
  if (!f) return null;

  const idx = s.index('by_project_parent_order');
  let order = 0;
  for await (const cursor of idx.iterate(IDBKeyRange.bound([f.projectId, newParentId, -Infinity], [f.projectId, newParentId, Infinity]), 'prev')) {
    order = (cursor.value.order ?? 0) + 1;
    break;
  }

  f.parentId = newParentId;
  f.order = order;
  f.updatedAt = nowISO();
  await s.put(f);
  await tx.done;
  return f;
}

// Delete a folder and EVERYTHING under it (subfolders + requirements)
export async function deleteRequirementFolderRecursive(folderId) {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction([REQ_FOLDER_STORE, REQUIREMENT_STORE], 'readwrite');
  const fs = tx.objectStore(REQ_FOLDER_STORE);
  const rs = tx.objectStore(REQUIREMENT_STORE);

  async function gatherAndDelete(ids) {
    const childIds = [];

    // delete requirements in these folders
    const idxR = rs.index('by_folder');
    for (const id of ids) {
      for await (const cur of idxR.iterate(IDBKeyRange.only(id))) {
        await rs.delete(cur.primaryKey);
      }
      // gather subfolders
      const idxF = fs.index('by_parent');
      for await (const c of idxF.iterate(IDBKeyRange.only(id))) {
        childIds.push(c.value.id);
      }
      await fs.delete(id);
    }
    if (childIds.length) await gatherAndDelete(childIds);
  }

  await gatherAndDelete([folderId]);
  await tx.done;
}

// Return a nested array tree of folders for a project
export async function listRequirementFolderTree(projectId) {
  const db = await openTraceDB();
  const s = db.transaction(REQ_FOLDER_STORE).store;
  const idx = s.index('by_project');

  const all = [];
  for await (const cur of idx.iterate(IDBKeyRange.only(projectId))) {
    all.push(cur.value);
  }

  const byParent = new Map();
  for (const f of all) {
    const key = f.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  function build(parentId = null) {
    return (byParent.get(parentId) || []).map(f => ({ ...f, children: build(f.id) }));
  }
  return build(null);
}

/**
 * ---------------------------------------------------------------------------
 * NEW: REQUIREMENTS (records stored per folder or uncategorized)
 * ---------------------------------------------------------------------------
 */

export async function createRequirement(projectId, folderId = null, partial = {}) {
  const db = await openTraceDB();
  const s = db.transaction(REQUIREMENT_STORE, 'readwrite').store;

  const rec = {
    id: partial.id ?? uuid(),
    projectId,
    folderId, // null = uncategorized (shows under "All Requirements")
    title: partial.title ?? 'New Requirement',
    module: partial.module ?? 'Requirement',
    attributes: partial.attributes ?? {},
    links: partial.links ?? [],
    parentId: partial.parentId ?? null, // optional hierarchical requirement
    status: partial.status ?? 'Proposed',
    version: partial.version ?? 1,
    baselineVersion: partial.baselineVersion ?? 1,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  await s.add(rec);
  return rec;
}

/**
 * getRequirementsByFolder reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param projectId Project identifier used to scope data access within local storage.
 * @param folderId Folder identifier used to scope hierarchical requirement records.
 * @returns Promise resolving to the normalized data requested by this module.
 */
export async function getRequirementsByFolder(projectId, folderId = null) {
  const db = await openTraceDB();
  const s = db.transaction(REQUIREMENT_STORE).store;

  const out = [];
  if (folderId === null) {
    // All requirements for project
    const idx = s.index('by_project');
    for await (const cur of idx.iterate(IDBKeyRange.only(projectId))) {
      out.push(cur.value);
    }
  } else {
    const idx = s.index('by_folder');
    for await (const cur of idx.iterate(IDBKeyRange.only(folderId))) {
      if (cur.value.projectId === projectId) out.push(cur.value);
    }
  }
  return out;
}

/**
 * updateRequirement encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @param patch Input consumed by this step of the xHandle workflow.
 * @returns Promise resolving to storage-backed data or completion state.
 */
export async function updateRequirement(id, patch) {
  const db = await openTraceDB();
  const s = db.transaction(REQUIREMENT_STORE, 'readwrite').store;
  const rec = await s.get(id);
  if (!rec) return null;
  Object.assign(rec, patch || {});
  rec.updatedAt = nowISO();
  await s.put(rec);
  return rec;
}

/**
 * updateRequirementFolder encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @param folderId Folder identifier used to scope hierarchical requirement records.
 * @returns Promise resolving to storage-backed data or completion state.
 */
export async function updateRequirementFolder(id, folderId = null) {
  return updateRequirement(id, { folderId });
}

/**
 * deleteRequirement encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns Promise resolving to completion of the persistence operation.
 */
export async function deleteRequirement(id) {
  const db = await openTraceDB();
  await db.delete(REQUIREMENT_STORE, id);
}

/**
 * Convenience: bulk upsert requirements (e.g., paste/import)
 */
export async function upsertRequirements(records = []) {
  if (!records.length) return 0;
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction(REQUIREMENT_STORE, 'readwrite');
  for (const r of records) {
    const rec = { ...r };
    if (!rec.id) rec.id = uuid();
    if (!rec.createdAt) rec.createdAt = nowISO();
    rec.updatedAt = nowISO();
    await tx.store.put(rec);
  }
  await tx.done;
  return records.length;
}
