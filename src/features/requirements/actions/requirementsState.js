const LS_KEY = "xhandle:requirements";
const LS_PROJECTS = "xhandle:req-projects";
const LS_ACTIVE_PROJECT = "xhandle:req-active-project";

const MAX_HISTORY_ENTRIES = 50;
const BASE_MODULES = ["System", "Subsystem", "Interface", "Requirement", "Test"];

const nowISO = () => new Date().toISOString();

function makeId(prefix = "REQ") {
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}-${ts}-${rnd}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw ?? JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function emitChange(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("xhandle:requirements-data-changed", { detail }));
}

function emitFocus(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("xhandle:requirements-focus-module", { detail }));
}

function nextOrderAmong(rows = [], parentId = null) {
  const siblings = rows
    .filter((row) => (row.parentId ?? null) === (parentId ?? null))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const last = siblings[siblings.length - 1];
  return last ? (last.order ?? 0) + 1 : 0;
}

function describeChange(prev, next) {
  if ((prev.title || "") !== (next.title || "")) return "title updated";
  if ((prev.module || "") !== (next.module || "")) return "module updated";
  if ((prev.parentId ?? null) !== (next.parentId ?? null)) return "hierarchy updated";
  return "requirement updated";
}

function pruneForStorage(rows = []) {
  return rows.map((row) => {
    const out = { ...row };
    if (Array.isArray(out.history) && out.history.length > MAX_HISTORY_ENTRIES) {
      out.history = out.history.slice(-MAX_HISTORY_ENTRIES);
    }
    return out;
  });
}

export function loadRequirements() {
  return safeParse(typeof localStorage === "undefined" ? "[]" : localStorage.getItem(LS_KEY), []);
}

export function saveRequirements(rows, detail = {}) {
  if (typeof localStorage === "undefined") return;
  const payload = pruneForStorage(rows);
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
  emitChange({ kind: "requirements", ...detail });
}

export function loadFolders() {
  return safeParse(typeof localStorage === "undefined" ? "[]" : localStorage.getItem(LS_PROJECTS), []);
}

export function saveFolders(folders, detail = {}) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_PROJECTS, JSON.stringify(folders));
  emitChange({ kind: "folders", ...detail });
}

export function getActiveFolderId() {
  if (typeof localStorage === "undefined") return null;
  return safeParse(localStorage.getItem(LS_ACTIVE_PROJECT), null);
}

export function setActiveFolderId(folderId, detail = {}) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LS_ACTIVE_PROJECT, JSON.stringify(folderId));
  emitChange({ kind: "active-folder", folderId, ...detail });
}

export function migrateRequirementsState() {
  const folders = loadFolders();
  if (!folders.length) {
    const rows = loadRequirements();
    const moduleNames = [...new Set(rows.map((row) => row.module).filter(Boolean))];
    const modules = moduleNames.map((name) => ({
      id: makeId("MOD"),
      name,
      type: BASE_MODULES.includes(name) ? name : "Requirement",
      description: "",
      attrTemplate: [],
      viewTemplates: [],
    }));

    const root = {
      id: makeId("FOL"),
      parentId: null,
      name: "Root",
      modules,
      roles: { Owner: [], Editor: [], Viewer: [] },
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    const tagged = rows.map((row) => ({
      ...row,
      projectId: root.id,
      folderId: root.id,
      moduleId: modules.find((module) => module.name === row.module)?.id || null,
    }));

    saveFolders([root], { source: "migration" });
    setActiveFolderId(root.id, { source: "migration" });
    saveRequirements(tagged, { source: "migration" });
    return { folders: [root], requirements: tagged, activeFolderId: root.id };
  }

  const fixed = folders.map((folder) =>
    typeof folder.parentId === "undefined"
      ? { ...folder, parentId: null, updatedAt: folder.updatedAt || nowISO() }
      : folder
  );
  if (JSON.stringify(fixed) !== JSON.stringify(folders)) {
    saveFolders(fixed, { source: "migration" });
  }

  const activeFolderId = getActiveFolderId() || fixed[0]?.id || null;
  if (activeFolderId) setActiveFolderId(activeFolderId, { source: "migration" });
  return { folders: fixed, requirements: loadRequirements(), activeFolderId };
}

export function ensureActiveFolder() {
  const migrated = migrateRequirementsState();
  const folders = migrated.folders || loadFolders();
  const activeFolderId = getActiveFolderId() || folders[0]?.id || null;
  const activeFolder = folders.find((folder) => folder.id === activeFolderId) || folders[0] || null;
  if (activeFolder?.id && activeFolder.id !== activeFolderId) {
    setActiveFolderId(activeFolder.id, { source: "ensure-active-folder" });
  }
  return activeFolder;
}

export function findFolderById(folderId) {
  return loadFolders().find((folder) => folder.id === folderId) || null;
}

export function createFolderRecord({ name, parentId = null } = {}) {
  const folderName = String(name || "").trim();
  if (!folderName) throw new Error("Folder name is required.");
  const folders = loadFolders();
  const folder = {
    id: makeId("FOL"),
    parentId,
    name: folderName,
    modules: [],
    roles: { Owner: [], Editor: [], Viewer: [] },
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  const next = [...folders, folder];
  saveFolders(next, { source: "create-folder", folderId: folder.id });
  setActiveFolderId(folder.id, { source: "create-folder" });
  return folder;
}

export function listModules(folderId = getActiveFolderId()) {
  const folder = findFolderById(folderId);
  return folder?.modules || [];
}

export function findModule(folderRef, { by = "id", folderId = getActiveFolderId() } = {}) {
  const modules = listModules(folderId);
  if (!folderRef) return null;
  return (
    modules.find((module) =>
      by === "name"
        ? String(module.name || "").toLowerCase() === String(folderRef).toLowerCase()
        : module.id === folderRef
    ) || null
  );
}

export function resolveModuleRecord(moduleRef, { folderId = getActiveFolderId() } = {}) {
  if (!moduleRef) return null;
  return findModule(moduleRef, { by: "id", folderId }) || findModule(moduleRef, { by: "name", folderId });
}

export function createModuleRecord({ name, type = "Requirement", description = "", folderId = getActiveFolderId() } = {}) {
  const folder = ensureActiveFolder();
  const targetFolderId = folderId || folder?.id;
  const folderState = findFolderById(targetFolderId);
  if (!folderState) throw new Error("No active Requirements folder is available.");

  const moduleName = String(name || "").trim();
  if (!moduleName) throw new Error("Module name is required.");

  const existing = (folderState.modules || []).find(
    (module) => String(module.name || "").toLowerCase() === moduleName.toLowerCase()
  );
  if (existing) return existing;

  const moduleRecord = {
    id: makeId("MOD"),
    name: moduleName,
    type,
    description: String(description || ""),
    attrTemplate: [],
    viewTemplates: [],
  };

  const folders = loadFolders();
  const next = folders.map((entry) =>
    entry.id === folderState.id
      ? {
          ...entry,
          updatedAt: nowISO(),
          modules: [...(entry.modules || []), moduleRecord],
        }
      : entry
  );

  saveFolders(next, { source: "create-module", folderId: folderState.id, moduleId: moduleRecord.id });
  emitFocus({ folderId: folderState.id, moduleId: moduleRecord.id, moduleName: moduleRecord.name });
  return moduleRecord;
}

export function updateModuleRecord({ moduleId, folderId = getActiveFolderId(), patch = {} } = {}) {
  const folder = findFolderById(folderId);
  if (!folder) throw new Error("Folder not found.");
  const modules = folder.modules || [];
  const current = modules.find((module) => module.id === moduleId);
  if (!current) throw new Error("Module not found.");

  const nextModule = { ...current, ...patch };
  const folders = loadFolders().map((entry) =>
    entry.id === folder.id
      ? {
          ...entry,
          updatedAt: nowISO(),
          modules: modules.map((module) => (module.id === moduleId ? nextModule : module)),
        }
      : entry
  );

  saveFolders(folders, { source: "update-module", folderId: folder.id, moduleId });
  emitFocus({ folderId: folder.id, moduleId, moduleName: nextModule.name });
  return nextModule;
}

export function listRequirementsForModule({ folderId = getActiveFolderId(), moduleId = null, moduleName = null } = {}) {
  const requirements = loadRequirements();
  return requirements.filter((row) => {
    const sameFolder = (row.folderId ?? row.projectId) === folderId;
    if (!sameFolder) return false;
    if (moduleId && row.moduleId === moduleId) return true;
    if (moduleName && row.module === moduleName) return true;
    return !moduleId && !moduleName;
  });
}

export function saveRequirementRecord(draft, { author = "xHandle Collaborator" } = {}) {
  if (!draft?.title && !draft?.id) {
    throw new Error("Requirement content is required.");
  }

  const folderId = draft.folderId ?? draft.projectId ?? getActiveFolderId();
  const moduleName = draft.module;
  const moduleRecord =
    (draft.moduleId && findModule(draft.moduleId, { by: "id", folderId })) ||
    (moduleName && findModule(moduleName, { by: "name", folderId })) ||
    null;

  const nextDraft = clone({
    id: draft.id || makeId("REQ"),
    title: draft.title || "New Requirement",
    projectId: folderId,
    folderId,
    module: moduleRecord?.name || moduleName || "Requirement",
    moduleId: moduleRecord?.id || draft.moduleId || null,
    status: draft.status || "Proposed",
    heading: !!draft.heading,
    attributes: draft.attributes || {},
    links: draft.links || [],
    parentId: draft.parentId ?? null,
    order: draft.order,
    version: draft.version || 1,
    history: Array.isArray(draft.history) ? draft.history : [],
    createdAt: draft.createdAt || nowISO(),
    updatedAt: nowISO(),
  });

  const requirements = loadRequirements();
  const exists = requirements.find((row) => row.id === nextDraft.id);
  const next = clone(requirements);

  if (!exists) {
    if (typeof nextDraft.order !== "number") {
      nextDraft.order = nextOrderAmong(
        next.filter(
          (row) => (row.folderId ?? row.projectId) === folderId && row.module === nextDraft.module
        ),
        nextDraft.parentId ?? null
      );
    }
    next.push(nextDraft);
  } else {
    const idx = next.findIndex((row) => row.id === nextDraft.id);
    const prevSnap = clone(next[idx]);
    const version = (prevSnap.version ?? 1) + 1;

    if (typeof nextDraft.order !== "number") {
      nextDraft.order = next[idx].order ?? nextOrderAmong(
        next.filter(
          (row) => (row.folderId ?? row.projectId) === folderId && row.module === nextDraft.module
        ),
        nextDraft.parentId ?? null
      );
    }

    nextDraft.version = version;
    nextDraft.history = [
      ...(prevSnap.history || []),
      { at: nowISO(), version, prev: prevSnap, change: describeChange(prevSnap, nextDraft), author },
    ].slice(-MAX_HISTORY_ENTRIES);
    next[idx] = nextDraft;
  }

  saveRequirements(next, {
    source: "save-requirement",
    folderId,
    moduleId: nextDraft.moduleId,
    requirementId: nextDraft.id,
  });
  return nextDraft;
}

export function replaceModuleRequirements({ moduleId, folderId = getActiveFolderId(), rows = [], author = "xHandle Collaborator" } = {}) {
  const moduleRecord = findModule(moduleId, { by: "id", folderId });
  if (!moduleRecord) throw new Error("Module not found.");

  const requirements = loadRequirements();
  const keep = requirements.filter(
    (row) => !((row.folderId ?? row.projectId) === folderId && row.moduleId === moduleId)
  );

  const created = rows.map((row, index) => ({
    id: makeId("REQ"),
    title: row.title || `Item ${index + 1}`,
    projectId: folderId,
    folderId,
    module: moduleRecord.name,
    moduleId: moduleRecord.id,
    status: row.status || "Proposed",
    heading: !!row.heading,
    attributes: row.attributes || {},
    links: row.links || [],
    parentId: row.parentId ?? null,
    order: typeof row.order === "number" ? row.order : index,
    version: 1,
    history: [],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  }));

  saveRequirements([...keep, ...created], {
    source: "replace-module-requirements",
    folderId,
    moduleId,
    count: created.length,
  });
  emitFocus({ folderId, moduleId, moduleName: moduleRecord.name });
  return { module: moduleRecord, rows: created };
}

export function appendModuleRequirements({ moduleId, folderId = getActiveFolderId(), rows = [] } = {}) {
  const moduleRecord = findModule(moduleId, { by: "id", folderId });
  if (!moduleRecord) throw new Error("Module not found.");
  const existing = listRequirementsForModule({ folderId, moduleId });
  const created = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const saved = saveRequirementRecord(
      {
        title: row.title || `Item ${existing.length + index + 1}`,
        projectId: folderId,
        folderId,
        module: moduleRecord.name,
        moduleId: moduleRecord.id,
        status: row.status || "Proposed",
        heading: !!row.heading,
        attributes: row.attributes || {},
        links: row.links || [],
        parentId: row.parentId ?? null,
        order: nextOrderAmong([...existing, ...created], row.parentId ?? null),
      },
      { author: "xHandle Collaborator" }
    );
    created.push(saved);
  }
  emitFocus({ folderId, moduleId, moduleName: moduleRecord.name });
  return { module: moduleRecord, rows: created };
}

export function loadEntityRecord(entityType, id, { folderId = getActiveFolderId() } = {}) {
  switch (entityType) {
    case "module":
      return resolveModuleRecord(id, { folderId });
    case "folder":
      return findFolderById(id);
    case "requirement":
      return loadRequirements().find((row) => row.id === id) || null;
    default:
      return null;
  }
}

export function updateEntityRecord(entityType, id, patch, options = {}) {
  switch (entityType) {
    case "module":
      return updateModuleRecord({ moduleId: id, patch, folderId: options.folderId });
    case "folder": {
      const folders = loadFolders();
      const folder = folders.find((entry) => entry.id === id);
      if (!folder) throw new Error("Folder not found.");
      const nextFolder = { ...folder, ...patch, updatedAt: nowISO() };
      saveFolders(
        folders.map((entry) => (entry.id === id ? nextFolder : entry)),
        { source: "update-folder", folderId: id }
      );
      return nextFolder;
    }
    case "requirement":
      return saveRequirementRecord({ ...(loadEntityRecord("requirement", id) || {}), ...patch, id }, { author: "xHandle Collaborator" });
    default:
      throw new Error(`Unsupported entity type: ${entityType}`);
  }
}

export function focusModule(moduleId, { folderId = getActiveFolderId() } = {}) {
  const moduleRecord = resolveModuleRecord(moduleId, { folderId });
  if (!moduleRecord) throw new Error("Module not found.");
  setActiveFolderId(folderId, { source: "focus-module" });
  emitFocus({ folderId, moduleId: moduleRecord.id, moduleName: moduleRecord.name });
  return moduleRecord;
}

export { makeId, nowISO, nextOrderAmong, emitChange, emitFocus };
