import { type IDBPDatabase, type DBSchema } from 'idb';
import {
  TRACEABILITY_DB_NAME,
  TRACEABILITY_STORES,
  createTraceabilityTransaction,
  openTraceabilityDB,
} from './traceabilityDb';

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

let dbPromise: Promise<IDBPDatabase<TraceabilityDB>> | null = null;

function openTraceDB() {
  if (!dbPromise) {
    dbPromise = openTraceabilityDB() as Promise<IDBPDatabase<TraceabilityDB>>;
  }
  return dbPromise!;
}

const now = () => new Date().toISOString();
const newId = () =>
  (globalThis.crypto && 'randomUUID' in globalThis.crypto)
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

// =============== PROJECTS ===============
export async function listProjects(): Promise<Project[]> {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.projects, 'readonly');
  if (!tx) return [];
  const s = tx.store;
  const byUpdated = s.index('by_updated');
  const projects = await byUpdated.getAll();
  await tx.done;
  return projects.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function getProject(projectId: string): Promise<Project | undefined> {
  const db = await openTraceDB();
  return (await db.get('Projects', projectId)) ?? undefined;
}

export async function createProject(name: string): Promise<Project> {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.projects, 'readwrite');
  if (!tx) {
    throw new Error(`[IDB] Cannot create project because ${TRACEABILITY_STORES.projects} is unavailable in ${TRACEABILITY_DB_NAME}.`);
  }
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

export async function renameProject(projectId: string, name: string): Promise<Project | null> {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.projects, 'readwrite');
  if (!tx) return null;
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
  const tx = createTraceabilityTransaction(
    db,
    [TRACEABILITY_STORES.projects, TRACEABILITY_STORES.requirementFolders, TRACEABILITY_STORES.requirements],
    'readwrite',
  );
  if (!tx) return;
  const ps = tx.objectStore(TRACEABILITY_STORES.projects);
  const fs = tx.objectStore(TRACEABILITY_STORES.requirementFolders);
  const rs = tx.objectStore(TRACEABILITY_STORES.requirements);

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
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.projects, 'readwrite');
  if (!tx) return;
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
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.requirementFolders, 'readwrite');
  if (!tx) return null;
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

export async function renameFolder(folderId: string, name: string) {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.requirementFolders, 'readwrite');
  if (!tx) return null;
  const s = tx.store;
  const f = await s.get(folderId);
  if (!f) return null;
  f.name = name;
  f.updatedAt = now();
  await s.put(f);
  await tx.done;
  return f;
}

export async function moveFolder(folderId: string, newParentId: string | null) {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.requirementFolders, 'readwrite');
  if (!tx) return null;
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

export async function deleteFolderRecursive(folderId: string) {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(
    db,
    [TRACEABILITY_STORES.requirementFolders, TRACEABILITY_STORES.requirements],
    'readwrite',
  );
  if (!tx) return;
  const fs = tx.objectStore(TRACEABILITY_STORES.requirementFolders);
  const rs = tx.objectStore(TRACEABILITY_STORES.requirements);

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

export async function listFolderTree(projectId: string) {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.requirementFolders, 'readonly');
  if (!tx) return [];
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
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.requirements, 'readwrite');
  if (!tx) return null;
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

export async function listRequirementsByFolder(projectId: string, folderId: string | null) {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.requirements, 'readonly');
  if (!tx) return [];
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
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.requirements, 'readonly');
  if (!tx) return [];
  const s = tx.store;
  const rows = await s.index('by_project').getAll(projectId);
  await tx.done;
  return rows;
}

// Optional helpers
export async function updateRequirement(id: string, patch: Partial<Requirement>) {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.requirements, 'readwrite');
  if (!tx) return null;
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

export async function updateRequirementFolder(id: string, folderId: string | null) {
  return updateRequirement(id, { folderId });
}

export async function deleteRequirement(id: string) {
  const db = await openTraceDB();
  const tx = createTraceabilityTransaction(db, TRACEABILITY_STORES.requirements, 'readwrite');
  if (!tx) return;
  const rec = await tx.store.get(id);
  await tx.store.delete(id);
  await tx.done;
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
