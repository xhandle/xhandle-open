import {
  createEmptySysMLModel,
  createSysMLElement,
  createSysMLRelationship,
  nowISO,
} from "./sysmlV2Types";

const MODELS_KEY = "xhandle.designManagement.sysmlV2.models";
const ACTIVE_MODEL_KEY = "xhandle.designManagement.sysmlV2.activeModelId";
const ACTIVE_PROJECT_ID_KEY = "xhandle.activeProjectId";

function canUseStorage() {
  return typeof window !== "undefined" && !!window.localStorage;
}

function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function readModels() {
  if (!canUseStorage()) return [];
  const value = safeParse(window.localStorage.getItem(MODELS_KEY), []);
  return Array.isArray(value) ? value : [];
}

function currentProjectId() {
  if (!canUseStorage()) return null;
  return window.localStorage.getItem(ACTIVE_PROJECT_ID_KEY) || null;
}

function activeModelMap() {
  const value = getActiveSysMLV2ModelId();
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function modelBelongsToProject(model, projectId) {
  if (!projectId) return true;
  return !model.projectId || model.projectId === projectId;
}

function writeModels(models) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(MODELS_KEY, JSON.stringify(models));
  window.dispatchEvent(new CustomEvent("xhandle:sysml-v2-models-changed", { detail: { count: models.length } }));
}

function withQualifiedNames(model) {
  const byId = new Map((model.elements || []).map((el) => [el.id, el]));
  const qualify = (el, seen = new Set()) => {
    if (!el?.ownerId || seen.has(el.id)) return el?.name || "";
    const owner = byId.get(el.ownerId);
    if (!owner) return el.name;
    return `${qualify(owner, new Set([...seen, el.id]))}::${el.name}`;
  };
  return {
    ...model,
    elements: (model.elements || []).map((el) => ({ ...el, qualifiedName: qualify(el) })),
  };
}

export function listSysMLV2Models(projectId = currentProjectId()) {
  return readModels().filter((model) => modelBelongsToProject(model, projectId)).map((model) => ({
    id: model.id,
    projectId: model.projectId || null,
    name: model.name,
    description: model.description,
    updatedAt: model.updatedAt,
    elementCount: model.elements?.length || 0,
    relationshipCount: model.relationships?.length || 0,
  }));
}

export function getActiveSysMLV2ModelId() {
  if (!canUseStorage()) return null;
  return safeParse(window.localStorage.getItem(ACTIVE_MODEL_KEY), null);
}

export function setActiveSysMLV2ModelId(modelId, projectId = currentProjectId()) {
  if (!canUseStorage()) return;
  const next = activeModelMap();
  const key = projectId || "__global__";
  if (modelId) next[key] = modelId;
  else delete next[key];
  window.localStorage.setItem(ACTIVE_MODEL_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("xhandle:sysml-v2-active-model-changed", { detail: { modelId, projectId } }));
}

export function loadSysMLV2Model(modelId = null, projectId = currentProjectId()) {
  const models = readModels();
  const active = activeModelMap();
  const activeId = modelId || active[projectId || "__global__"] || null;
  const scopedModels = models.filter((entry) => modelBelongsToProject(entry, projectId));
  const model = scopedModels.find((entry) => entry.id === activeId) || scopedModels[0] || null;
  return model ? withQualifiedNames(model) : null;
}

export function saveSysMLV2Model(model) {
  const projectId = model.projectId || currentProjectId();
  const nextModel = withQualifiedNames({ ...model, projectId, updatedAt: nowISO() });
  const models = readModels();
  const exists = models.some((entry) => entry.id === nextModel.id);
  writeModels(exists ? models.map((entry) => (entry.id === nextModel.id ? nextModel : entry)) : [nextModel, ...models]);
  setActiveSysMLV2ModelId(nextModel.id, projectId);
  return nextModel;
}

export function createSysMLV2Model({ name = "UntitledSystemModel", description = "", projectId = currentProjectId() } = {}) {
  const model = createEmptySysMLModel({ name, description });
  model.projectId = projectId || null;
  const root = createSysMLElement({ type: "Package", name, description: description || "Root model package." });
  model.rootElementId = root.id;
  model.elements = [root];
  model.diagrams.structure.positions[root.id] = { x: 120, y: 120 };
  return saveSysMLV2Model(model);
}

export function duplicateSysMLV2Model(modelId) {
  const model = loadSysMLV2Model(modelId);
  if (!model) throw new Error("Model not found.");
  return saveSysMLV2Model({
    ...model,
    id: `model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${model.name} Copy`,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  });
}

export function deleteSysMLV2Model(modelId) {
  const models = readModels().filter((entry) => entry.id !== modelId);
  writeModels(models);
  const projectId = currentProjectId();
  const nextId = models.find((entry) => modelBelongsToProject(entry, projectId))?.id || null;
  setActiveSysMLV2ModelId(nextId, projectId);
  return nextId;
}

export function importSysMLV2Model(model) {
  if (!model?.name || !Array.isArray(model.elements) || !Array.isArray(model.relationships)) {
    throw new Error("Imported SysML v2 model JSON is missing name, elements, or relationships.");
  }
  return saveSysMLV2Model({
    ...createEmptySysMLModel({ name: model.name, description: model.description || "" }),
    ...model,
    projectId: model.projectId || currentProjectId(),
    updatedAt: nowISO(),
  });
}

export function addSysMLElement(modelId, elementInput = {}, position = null) {
  const model = loadSysMLV2Model(modelId) || createSysMLV2Model({ name: "UntitledSystemModel" });
  const element = createSysMLElement({
    packageId: model.rootElementId,
    ownerId: model.rootElementId,
    ...elementInput,
  });
  const activeView = model.activeView || "structure";
  const positions = model.diagrams?.[activeView]?.positions || {};
  const next = {
    ...model,
    elements: [...(model.elements || []), element],
    diagrams: {
      ...(model.diagrams || {}),
      [activeView]: {
        ...(model.diagrams?.[activeView] || {}),
        positions: {
          ...positions,
          [element.id]: position || { x: 260 + (model.elements.length % 4) * 180, y: 160 + Math.floor(model.elements.length / 4) * 130 },
        },
      },
    },
  };
  return { model: saveSysMLV2Model(next), element };
}

export function updateSysMLElement(modelId, elementId, patch = {}) {
  const model = loadSysMLV2Model(modelId);
  if (!model) throw new Error("Model not found.");
  const next = {
    ...model,
    elements: model.elements.map((element) => element.id === elementId ? { ...element, ...patch, updatedAt: nowISO() } : element),
  };
  return saveSysMLV2Model(next);
}

export function deleteSysMLElement(modelId, elementId) {
  const model = loadSysMLV2Model(modelId);
  if (!model) throw new Error("Model not found.");
  const next = {
    ...model,
    elements: model.elements.filter((element) => element.id !== elementId),
    relationships: model.relationships.filter((rel) => rel.sourceId !== elementId && rel.targetId !== elementId),
    traceLinks: (model.traceLinks || []).filter((link) => link.sourceId !== elementId && link.targetId !== elementId),
  };
  return saveSysMLV2Model(next);
}

export function addSysMLRelationship(modelId, relationshipInput = {}) {
  const model = loadSysMLV2Model(modelId);
  if (!model) throw new Error("Model not found.");
  const relationship = createSysMLRelationship(relationshipInput);
  const next = { ...model, relationships: [...(model.relationships || []), relationship] };
  return { model: saveSysMLV2Model(next), relationship };
}

export function updateSysMLRelationship(modelId, relationshipId, patch = {}) {
  const model = loadSysMLV2Model(modelId);
  if (!model) throw new Error("Model not found.");
  const next = {
    ...model,
    relationships: model.relationships.map((rel) => rel.id === relationshipId ? { ...rel, ...patch, updatedAt: nowISO() } : rel),
  };
  return saveSysMLV2Model(next);
}

export function deleteSysMLRelationship(modelId, relationshipId) {
  const model = loadSysMLV2Model(modelId);
  if (!model) throw new Error("Model not found.");
  return saveSysMLV2Model({ ...model, relationships: model.relationships.filter((rel) => rel.id !== relationshipId) });
}

export function saveSysMLDiagramPositions(modelId, viewId, positions = {}) {
  const model = loadSysMLV2Model(modelId);
  if (!model) throw new Error("Model not found.");
  return saveSysMLV2Model({
    ...model,
    diagrams: {
      ...(model.diagrams || {}),
      [viewId]: {
        ...(model.diagrams?.[viewId] || {}),
        positions: { ...(model.diagrams?.[viewId]?.positions || {}), ...positions },
      },
    },
  });
}

export function ensureDefaultSysMLV2Model(projectId = currentProjectId(), projectName = "System") {
  return loadSysMLV2Model(null, projectId) || createSysMLV2Model({
    name: `${projectName || "System"} Model`.replace(/[^\w ]/g, "").trim() || "SystemModel",
    description: "Default SysML v2-style model.",
    projectId,
  });
}
