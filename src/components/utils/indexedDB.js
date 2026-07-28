// utils/indexedDB.js

import { openDB } from 'idb';
import {
  TRACEABILITY_DB_NAME,
  TRACEABILITY_DB_VERSION,
  TRACEABILITY_STORES,
  createTraceabilityTransaction,
  ensureTraceabilitySchema,
  getTraceabilityStoreNames,
  openTraceabilityDB,
} from './traceabilityDb';
import { notifyBackupDataChanged } from '../../lib/localBackupEvents';

/**
 * ---------------------------------------------------------------------------
 * DB SETUP
 * ---------------------------------------------------------------------------
 * We keep your existing DBs and add robust stores for RequirementFolders/Requirements
 * inside TraceabilityDB (version bump to 2+). BaselinesDB and TraceabilityMeta
 * remain as you had them.
 */

const TRACE_DB_NAME = TRACEABILITY_DB_NAME;
const TRACE_DB_VERSION = TRACEABILITY_DB_VERSION;

// Legacy keys you already use for simple folder persistence
const LEGACY_STORE_NAME = TRACEABILITY_STORES.folders;
const LEGACY_KEY = 'traceabilityFolders';

// New hierarchical requirement stores
const REQ_FOLDER_STORE = TRACEABILITY_STORES.requirementFolders;
const REQUIREMENT_STORE = TRACEABILITY_STORES.requirements;

// --- helpers ---
const nowISO = () => new Date().toISOString();
const uuid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Run once at app startup to ensure schema exists at TRACE_DB_VERSION.
 * Call: await ensureTraceSchema() before any DB access.
 */
export async function ensureTraceSchema() {
  await ensureTraceabilitySchema();
}

/**
 * Routine opens should NOT pass a version — this attaches to the latest DB version
 * and avoids “requested version (x) is less than existing (y)” errors.
 */
async function openTraceDB() {
  return openTraceabilityDB();
}

/**
 * ---------------------------------------------------------------------------
 * LEGACY SIMPLE FOLDERS (kept intact for compatibility)
 * ---------------------------------------------------------------------------
 */
export async function saveFoldersToDB(folders) {
  try {
    const db = await openTraceDB();
    console.log('[IDB] Saving legacy folders payload.', {
      dbName: db.name,
      dbVersion: db.version,
      availableObjectStores: getTraceabilityStoreNames(db),
      requestedTransactionStores: [LEGACY_STORE_NAME],
      legacyKey: LEGACY_KEY,
    });
    const tx = createTraceabilityTransaction(db, LEGACY_STORE_NAME, 'readwrite');
    if (!tx) {
      console.error('[IDB] Unable to save folders because the legacy store is unavailable.', {
        dbName: db.name,
        dbVersion: db.version,
        availableObjectStores: getTraceabilityStoreNames(db),
        requestedTransactionStores: [LEGACY_STORE_NAME],
      });
      return false;
    }
    await tx.store.put(folders, LEGACY_KEY);
    await tx.done;
    return true;
  } catch (err) {
    console.error('[IDB] Failed while saving legacy folders payload.', {
      dbName: TRACE_DB_NAME,
      dbVersion: TRACE_DB_VERSION,
      requestedTransactionStores: [LEGACY_STORE_NAME],
      error: String(err?.message || err),
    });
    throw err;
  }
}

export async function loadFoldersFromDB() {
  try {
    const db = await openTraceDB();
    console.log('[IDB] Loading legacy folders payload.', {
      dbName: db.name,
      dbVersion: db.version,
      availableObjectStores: getTraceabilityStoreNames(db),
      requestedTransactionStores: [LEGACY_STORE_NAME],
      legacyKey: LEGACY_KEY,
    });
    const tx = createTraceabilityTransaction(db, LEGACY_STORE_NAME, 'readonly');
    if (!tx) return {};
    const res = await tx.store.get(LEGACY_KEY);
    await tx.done;
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

    try {
      const healed = await openTraceDB();
      const tx = createTraceabilityTransaction(healed, LEGACY_STORE_NAME, 'readonly');
      if (!tx) return {};
      const res = await tx.store.get(LEGACY_KEY);
      await tx.done;
      return res || {};
    } catch (retryErr) {
      console.error('[IDB] Failed to recover the legacy folders store after schema repair.', {
        dbName: TRACE_DB_NAME,
        dbVersion: TRACE_DB_VERSION,
        storeName: LEGACY_STORE_NAME,
        error: String(retryErr?.message || retryErr),
      });
      return {};
    }
  }
}

/**
 * ---------------------------------------------------------------------------
 * BASELINES (unchanged from your file)
 * ---------------------------------------------------------------------------
 */
const BASELINE_DB = 'BaselinesDB';
const BASELINE_STORE = 'Baselines';

export function saveBaselineToDB(projectName, baselineData) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BASELINE_DB, 1);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(BASELINE_STORE)) {
        db.createObjectStore(BASELINE_STORE);
      }
    };

    request.onsuccess = function () {
      const db = request.result;
      const tx = db.transaction(BASELINE_STORE, 'readwrite');
      const store = tx.objectStore(BASELINE_STORE);
      store.put(baselineData, projectName);

      tx.oncomplete = () => {
        notifyBackupDataChanged({ db: BASELINE_DB, stores: [BASELINE_STORE] });
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };

    request.onerror = () => reject(request.error);
  });
}

export function loadBaselineFromDB(projectName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BASELINE_DB, 1);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(BASELINE_STORE)) {
        db.createObjectStore(BASELINE_STORE);
      }
    };

    request.onsuccess = function () {
      const db = request.result;
      const tx = db.transaction(BASELINE_STORE, 'readonly');
      const store = tx.objectStore(BASELINE_STORE);
      const getRequest = store.get(projectName);

      getRequest.onsuccess = () => resolve(getRequest.result || null);
      getRequest.onerror = () => reject(getRequest.error);
    };

    request.onerror = () => reject(request.error);
  });
}

export function loadAllBaselinesFromDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BASELINE_DB, 1);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(BASELINE_STORE)) {
        db.createObjectStore(BASELINE_STORE);
      }
    };

    request.onsuccess = function () {
      const db = request.result;
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
    upgrade(db) {
      if (!db.objectStoreNames.contains('shaStore')) {
        db.createObjectStore('shaStore');
      }
    }
  });
  await db.put('shaStore', sha, repoId);
  notifyBackupDataChanged({ db: 'TraceabilityMeta', stores: ['shaStore'] });
}

export async function loadLastProcessedSHA(repoId) {
  const db = await openDB('TraceabilityMeta', 1, {
    upgrade(db) {
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
  const tx = createTraceabilityTransaction(db, REQ_FOLDER_STORE, 'readonly');
  if (!tx) return null;
  const idx = tx.store.index('by_project_parent_order');

  // find last sibling to compute order
  let order = 0;
  let last = null;
  for await (const cursor of idx.iterate(IDBKeyRange.bound([projectId, parentId, -Infinity], [projectId, parentId, Infinity]), 'prev')) {
    last = cursor.value;
    break;
  }
  if (last) order = (last.order ?? 0) + 1;
  await tx.done;

  const folder = { id: uuid(), projectId, name, parentId, order, createdAt: nowISO(), updatedAt: nowISO() };
  await db.add(REQ_FOLDER_STORE, folder);
  return folder;
}

export async function renameRequirementFolder(folderId, name) {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, REQ_FOLDER_STORE, 'readwrite');
  if (!tx) return null;
  const s = tx.store;
  const f = await s.get(folderId);
  if (!f) return null;
  f.name = name;
  f.updatedAt = nowISO();
  await s.put(f);
  await tx.done;
  return f;
}

export async function moveRequirementFolder(folderId, newParentId = null) {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, REQ_FOLDER_STORE, 'readwrite');
  if (!tx) return null;
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
  const tx = createTraceabilityTransaction(db, [REQ_FOLDER_STORE, REQUIREMENT_STORE], 'readwrite');
  if (!tx) return;
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
  const tx = createTraceabilityTransaction(db, REQ_FOLDER_STORE, 'readonly');
  if (!tx) return [];
  const s = tx.store;
  const idx = s.index('by_project');

  const all = [];
  for await (const cur of idx.iterate(IDBKeyRange.only(projectId))) {
    all.push(cur.value);
  }
  await tx.done;

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
  const tx = createTraceabilityTransaction(db, REQUIREMENT_STORE, 'readwrite');
  if (!tx) return null;
  const s = tx.store;

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
  await tx.done;
  return rec;
}

export async function getRequirementsByFolder(projectId, folderId = null) {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, REQUIREMENT_STORE, 'readonly');
  if (!tx) return [];
  const s = tx.store;

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
  await tx.done;
  return out;
}

export async function updateRequirement(id, patch) {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, REQUIREMENT_STORE, 'readwrite');
  if (!tx) return null;
  const s = tx.store;
  const rec = await s.get(id);
  if (!rec) return null;
  Object.assign(rec, patch || {});
  rec.updatedAt = nowISO();
  await s.put(rec);
  await tx.done;
  return rec;
}

export async function updateRequirementFolder(id, folderId = null) {
  return updateRequirement(id, { folderId });
}

export async function deleteRequirement(id) {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, REQUIREMENT_STORE, 'readwrite');
  if (!tx) return false;
  await tx.store.delete(id);
  await tx.done;
  return true;
}

/**
 * Convenience: bulk upsert requirements (e.g., paste/import)
 */
export async function upsertRequirements(records = []) {
  if (!records.length) return 0;
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, REQUIREMENT_STORE, 'readwrite');
  if (!tx) return 0;
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
