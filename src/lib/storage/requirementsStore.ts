/**
 * xHandle: requirements store storage infrastructure.
 * This file owns part of xHandle's client-side persistence layer, including IndexedDB schema management, local-first records, and compatibility with older data layouts.
 * Storage modules are responsible for making engineering artifacts durable in the browser so the UI, analysis pipelines, and traceability tools can share stable project state without a central database.
 * Related files: src/components/RequirementsManager.jsx, src/features/traceability/VnVCenterPro.jsx, src/App.js.
 */

import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import { logger } from '../utils/logger';

// ---------- Project ----------
export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

// ---------- Types ----------
export type RequirementFolder = {
  id: string;
  projectId: string;
  name: string;
  parentId: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type RequirementLinkType = 'derives' | 'verifies' | 'refines' | 'satisfies' | 'blocks';

export type Requirement = {
  id: string;
  projectId: string;
  folderId: string | null;
  title: string;
  module: 'Requirement' | 'System' | 'Subsystem' | 'Interface' | 'Test' | string;
  attributes: Record<string, unknown>;
  links: Array<{ toId: string; type: RequirementLinkType }>;
  parentId: string | null;
  status: 'Proposed' | 'Approved' | 'Rejected';
  version: number;
  baselineVersion: number;
  createdAt: string;
  updatedAt: string;
};

// ---------- IDB Schema ----------
interface TraceabilityDB extends DBSchema {
  Projects: {
    key: string;
    value: Project;
    indexes: {
      by_name: string;   // name
      by_updated: string; // updatedAt
    };
  };
  RequirementFolders: {
    key: string;
    value: RequirementFolder;
    indexes: {
      by_project: string;                     // projectId
      by_parent: string;                      // parentId
      by_project_parent_order: [string, string, number]; // (projectId, parentId, order)
    };
  };
  Requirements: {
    key: string;
    value: Requirement;
    indexes: {
      by_project: string;  // projectId
      by_folder: string;   // folderId
    };
  };
}

// ---------- DB open with schema ----------
const DB_NAME = 'TraceabilityDB';
const DB_VERSION = 4; // <-- match your other module; previously 3

let dbPromise: Promise<IDBPDatabase<TraceabilityDB>> | null = null;

/**
 * openTraceDB establishes the prerequisite runtime state this module needs before higher-level work can proceed. In xHandle that usually means preparing storage, event bridges, or shared runtime infrastructure before a feature starts using it.
 * @returns storage-backed data or completion state.
 */
function openTraceDB() {
  if (!dbPromise) {
    dbPromise = openDB<TraceabilityDB>(DB_NAME, DB_VERSION, {
    // Keep the schema and transaction boundaries explicit so project data can evolve without losing local-first compatibility.
      upgrade(db, oldVersion, _newVersion, tx) {
        // Projects
        if (!db.objectStoreNames.contains('Projects')) {
          const p = db.createObjectStore('Projects', { keyPath: 'id' });
          p.createIndex('by_name', 'name', { unique: false });
          p.createIndex('by_updated', 'updatedAt', { unique: false });
        } else {
          const p = tx.objectStore('Projects');
          if (!p.indexNames.contains('by_name')) p.createIndex('by_name', 'name', { unique: false });
          if (!p.indexNames.contains('by_updated')) p.createIndex('by_updated', 'updatedAt', { unique: false });
        }

        // RequirementFolders
        if (!db.objectStoreNames.contains('RequirementFolders')) {
          const s = db.createObjectStore('RequirementFolders', { keyPath: 'id' });
          s.createIndex('by_project', 'projectId');
          s.createIndex('by_parent', 'parentId');
          s.createIndex('by_project_parent_order', ['projectId', 'parentId', 'order']);
        } else {
          const s = tx.objectStore('RequirementFolders');
          if (!s.indexNames.contains('by_project')) s.createIndex('by_project', 'projectId');
          if (!s.indexNames.contains('by_parent')) s.createIndex('by_parent', 'parentId');
          if (!s.indexNames.contains('by_project_parent_order')) {
            s.createIndex('by_project_parent_order', ['projectId', 'parentId', 'order']);
          }
        }

        // Requirements
        if (!db.objectStoreNames.contains('Requirements')) {
          const s = db.createObjectStore('Requirements', { keyPath: 'id' });
          s.createIndex('by_project', 'projectId');
          s.createIndex('by_folder', 'folderId');
        } else {
          const s = tx.objectStore('Requirements');
          if (!s.indexNames.contains('by_project')) s.createIndex('by_project', 'projectId');
          if (!s.indexNames.contains('by_folder')) s.createIndex('by_folder', 'folderId');
        }
      }
    })
    // 🔒 Fallback: if someone bumps the DB elsewhere (e.g., to v5) and we’re still at 4,
    // opening with 4 would throw "requested version is less than existing".
    // In that case, attach to the existing version without specifying one.
    .catch(async (err) => {
      const name = (err && (err as any).name) || '';
      const msg = String((err as any)?.message || err);
      const versionMismatch =
        name === 'VersionError' || msg.includes('less than the existing version');
      if (versionMismatch) {
        logger.warn('[IDB] Version mismatch; opening existing DB without specifying version.');
        return openDB<TraceabilityDB>(DB_NAME); // attach to latest existing
      }
      throw err;
    });
  }
  return dbPromise!;
}

/**
 * now encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns storage-backed data or completion state.
 */
const now = () => new Date().toISOString();
/**
 * newId encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @returns storage-backed data or completion state.
 */
const newId = () =>
  (globalThis.crypto && 'randomUUID' in globalThis.crypto)
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// =============== PROJECTS ===============
export async function listProjects(): Promise<Project[]> {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction('Projects', 'readonly');
  const s = tx.store;
  const byUpdated = s.index('by_updated');
  const projects = await byUpdated.getAll();
  await tx.done;
  return projects.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

/**
 * getProject reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param projectId Project identifier used to scope data access within local storage.
 * @returns Promise resolving to the normalized data requested by this module.
 */
export async function getProject(projectId: string): Promise<Project | undefined> {
  const db = await openTraceDB();
  return (await db.get('Projects', projectId)) ?? undefined;
}

/**
 * createProject constructs the persistent record or storage-aware object graph for this part of xHandle. It exists so the rest of the system can ask for a derived artifact, UI structure, or persisted record without duplicating the transformation logic.
 * @param name Human-readable name provided by the user or calling code.
 * @returns Promise resolving to storage-backed data or completion state.
 */
export async function createProject(name: string): Promise<Project> {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction('Projects', 'readwrite');
  const s = tx.store;
  const proj: Project = {
    id: newId(),
    name: name.trim(),
    createdAt: now(),
    updatedAt: now(),
  };
  await s.add(proj);
  await tx.done;
  return proj;
}

/**
 * renameProject encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param projectId Project identifier used to scope data access within local storage.
 * @param name Human-readable name provided by the user or calling code.
 * @returns Promise resolving to storage-backed data or completion state.
 */
export async function renameProject(projectId: string, name: string): Promise<Project | null> {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction('Projects', 'readwrite');
  const s = tx.store;
  const proj = await s.get(projectId);
  if (!proj) return null;
  proj.name = name.trim();
  proj.updatedAt = now();
  await s.put(proj);
  await tx.done;
  return proj;
}

// Delete a project and everything under it
export async function deleteProjectCascade(projectId: string): Promise<void> {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction(['Projects', 'RequirementFolders', 'Requirements'], 'readwrite');
  const ps = tx.objectStore('Projects');
  const fs = tx.objectStore('RequirementFolders');
  const rs = tx.objectStore('Requirements');

  const reqs = await rs.index('by_project').getAll(projectId);
  for (const r of reqs) await rs.delete(r.id);

  const folds = await fs.index('by_project').getAll(projectId);
  for (const f of folds) await fs.delete(f.id);

  await ps.delete(projectId);
  await tx.done;
}

// Internal helper: bump project's updatedAt on changes
async function touchProject(projectId: string): Promise<void> {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction('Projects', 'readwrite');
  const s = tx.store;
  const proj = await s.get(projectId);
  if (!proj) return;
  proj.updatedAt = now();
  await s.put(proj);
  await tx.done;
}

// =============== FOLDERS ===============
export async function createFolder(projectId: string, name: string, parentId: string | null) {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction('RequirementFolders', 'readwrite');
  const store = tx.store;

  let order = 0;
  if (parentId === null) {
    const allInProject = await store.index('by_project').getAll(projectId);
    const rootSiblings = allInProject
      .filter(f => f.parentId === null)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const last = rootSiblings[rootSiblings.length - 1];
    order = last ? (last.order ?? 0) + 1 : 0;
  } else {
    const idx = store.index('by_project_parent_order');
    const siblings = await idx.getAll(
      IDBKeyRange.bound([projectId, parentId, -Infinity], [projectId, parentId, Infinity])
    );
    const last = siblings[siblings.length - 1];
    order = last ? (last.order ?? 0) + 1 : 0;
  }

  const folder: RequirementFolder = {
    id: newId(),
    projectId,
    name,
    parentId,
    order,
    createdAt: now(),
    updatedAt: now(),
  };

  await store.add(folder);
  await tx.done;
  await touchProject(projectId);
  return folder;
}

/**
 * renameFolder encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param folderId Folder identifier used to scope hierarchical requirement records.
 * @param name Human-readable name provided by the user or calling code.
 * @returns Promise resolving to storage-backed data or completion state.
 */
export async function renameFolder(folderId: string, name: string) {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction('RequirementFolders', 'readwrite');
  const s = tx.store;
  const f = await s.get(folderId);
  if (!f) return null;
  f.name = name;
  f.updatedAt = now();
  await s.put(f);
  await tx.done;
  return f;
}

/**
 * moveFolder encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param folderId Folder identifier used to scope hierarchical requirement records.
 * @param newParentId Stable identifier for the entity this step works with.
 * @returns Promise resolving to storage-backed data or completion state.
 */
export async function moveFolder(folderId: string, newParentId: string | null) {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction('RequirementFolders', 'readwrite');
  const s = tx.store;

  const f = await s.get(folderId);
  if (!f) return null;

  let order = 0;
  if (newParentId === null) {
    const allInProject = await s.index('by_project').getAll(f.projectId);
    const rootSiblings = allInProject
      .filter(x => x.parentId === null)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const last = rootSiblings[rootSiblings.length - 1];
    order = last ? (last.order ?? 0) + 1 : 0;
  } else {
    const idx = s.index('by_project_parent_order');
    const siblings = await idx.getAll(
      IDBKeyRange.bound([f.projectId, newParentId, -Infinity], [f.projectId, newParentId, Infinity])
    );
    const last = siblings[siblings.length - 1];
    order = last ? (last.order ?? 0) + 1 : 0;
  }

  f.parentId = newParentId;
  f.order = order;
  f.updatedAt = now();
  await s.put(f);
  await tx.done;
  return f;
}

/**
 * deleteFolderRecursive encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param folderId Folder identifier used to scope hierarchical requirement records.
 * @returns Promise resolving to completion of the persistence operation.
 */
export async function deleteFolderRecursive(folderId: string) {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction(['RequirementFolders', 'Requirements'], 'readwrite');
  const fs = tx.objectStore('RequirementFolders');
  const rs = tx.objectStore('Requirements');

  async function recurse(ids: string[]) {
    const next: string[] = [];
    for (const id of ids) {
      const reqs = await rs.index('by_folder').getAll(IDBKeyRange.only(id));
      for (const r of reqs) await rs.delete(r.id);

      const subs = await fs.index('by_parent').getAll(IDBKeyRange.only(id));
      next.push(...subs.map(s => s.id));

      await fs.delete(id);
    }
    if (next.length) await recurse(next);
  }

  await recurse([folderId]);
  await tx.done;
}

/**
 * listFolderTree reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param projectId Project identifier used to scope data access within local storage.
 * @returns Promise resolving to the normalized data requested by this module.
 */
export async function listFolderTree(projectId: string) {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction('RequirementFolders', 'readonly');
  const s = tx.store;

  const items = await s.index('by_project').getAll(projectId);

  const byParent = new Map<string | null, RequirementFolder[]>();
  for (const f of items) {
    const key = f.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(f);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const build = (parentId: string | null): (RequirementFolder & { children: any[] })[] =>
    (byParent.get(parentId) || []).map(f => ({ ...f, children: build(f.id) }));

  await tx.done;
  return build(null);
}

// =============== REQUIREMENTS ===============
export async function createRequirement(
  projectId: string,
  folderId: string | null,
  partial: Partial<Requirement> = {}
) {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction('Requirements', 'readwrite');
  const s = tx.store;

  const rec: Requirement = {
    id: newId(),
    projectId,
    folderId,
    title: partial.title ?? 'New Requirement',
    module: partial.module ?? 'Requirement',
    attributes: partial.attributes ?? {},
    links: partial.links ?? [],
    parentId: partial.parentId ?? null,
    status: partial.status ?? 'Proposed',
    version: partial.version ?? 1,
    baselineVersion: partial.baselineVersion ?? 1,
    createdAt: now(),
    updatedAt: now(),
  };

  await s.add(rec);
  await touchProject(projectId);
  await tx.done;
  return rec;
}

/**
 * listRequirementsByFolder reads normalized data for this module from the source of truth it depends on. These accessor-style helpers keep the rest of the feature focused on workflow behavior rather than storage or transport details.
 * @param projectId Project identifier used to scope data access within local storage.
 * @param folderId Folder identifier used to scope hierarchical requirement records.
 * @returns Promise resolving to the normalized data requested by this module.
 */
export async function listRequirementsByFolder(projectId: string, folderId: string | null) {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction('Requirements', 'readonly');
  const s = tx.store;

  let rows: Requirement[];
  if (folderId == null) {
    rows = await s.index('by_project').getAll(projectId);
  } else {
    rows = (await s.index('by_folder').getAll(IDBKeyRange.only(folderId)))
      .filter(r => r.projectId === projectId);
  }

  await tx.done;
  return rows;
}

// List *all* requirements that belong to a project (ignores folders)
export async function listRequirementsByProject(projectId: string) {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction('Requirements', 'readonly');
  const s = tx.store;
  const rows = await s.index('by_project').getAll(projectId);
  await tx.done;
  return rows;
}

// Optional helpers
export async function updateRequirement(id: string, patch: Partial<Requirement>) {
  const db = await openTraceDB();
// Group related reads and writes in one transaction so the UI sees a consistent snapshot of project state.
  const tx = db.transaction('Requirements', 'readwrite');
  const s = tx.store;
  const rec = await s.get(id);
  if (!rec) return null;
  Object.assign(rec, patch);
  rec.updatedAt = now();
  await s.put(rec);
  await touchProject(rec.projectId);
  await tx.done;
  return rec;
}

/**
 * updateRequirementFolder encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @param folderId Folder identifier used to scope hierarchical requirement records.
 * @returns Promise resolving to storage-backed data or completion state.
 */
export async function updateRequirementFolder(id: string, folderId: string | null) {
  return updateRequirement(id, { folderId });
}

/**
 * deleteRequirement encapsulates a focused piece of client-side persistence workflow logic for xHandle. Giving this behavior a named function makes the surrounding module easier to scan and helps new contributors see where one responsibility ends and the next begins.
 * @param id Stable identifier used to match records or nodes across the workflow.
 * @returns Promise resolving to completion of the persistence operation.
 */
export async function deleteRequirement(id: string) {
  const db = await openTraceDB();
  const rec = await db.get('Requirements', id);
  await db.delete('Requirements', id);
  if (rec?.projectId) await touchProject(rec.projectId);
}

/**
 * Copy requirements from a source project into a target project/folder.
 * We preserve important fields, and tag the copy with source metadata.
 */
export async function bulkImportRequirementsFromProject(opts: {
  sourceProjectId: string;
  targetProjectId: string;
  targetFolderId: string | null;
}) {
  const { sourceProjectId, targetProjectId, targetFolderId } = opts;
  const sourceReqs = await listRequirementsByProject(sourceProjectId);

  const importedIds: string[] = [];
  for (const r of sourceReqs) {
    const attrs = {
      ...(r.attributes || {}),
      __ImportedFromProjectId: r.projectId,
      __ImportedOriginalId: r.id,
      __ImportedAt: new Date().toISOString(),
    };

    const copy = await createRequirement(
      targetProjectId,
      targetFolderId,
      {
        title: r.title,
        module: r.module,
        attributes: attrs,
        links: [],
        parentId: null,
        status: r.status ?? 'Proposed',
        version: 1,
        baselineVersion: 0,
        createdAt: r.createdAt,
      }
    );
    importedIds.push(copy.id);
  }
  return { importedCount: importedIds.length, importedIds };
}
