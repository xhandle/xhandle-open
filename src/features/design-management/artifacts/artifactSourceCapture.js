import { captureArchitectureSources } from './architectureSources';
import { semanticHash, validateConfig } from './artifactModel';
import { sourceManifestSize, DOCUMENT_EVIDENCE_LIMIT } from './artifactSize';
import { isProjectDeletionRequested } from '../../../lib/projectDeletionRegistry';
import { captureHazardAnalysisSources } from './hazardAnalysisSources';
import { isSafetyArtifact } from './safetyArtifactTypes';
import { captureConsolidatedHazardSources } from './hazardTrackingSources';

export function readArray(key, storage = localStorage) {
  const value = JSON.parse(storage.getItem(key) || '[]');
  if (!Array.isArray(value)) throw new Error(`Cannot read ${key}.`);
  return value;
}
export function availableProjects(storage = localStorage) {
  return [['functional', 'xhandle.projects'], ['code-architecture', 'xhandle.codeArchitectureProjects']].flatMap(([workspaceType, key]) => readArray(key, storage).map(p => ({ id: String(p.id), name: p.name || p.title || String(p.id), workspaceType })));
}
export const ownerKey = owner => `${owner.workspaceType}:${owner.id}`;
export function configOwners(config) { return config.ownerProjects || [{ id: config.projectId, workspaceType: config.workspaceType }]; }
export function assertOwner(config, storage = localStorage) {
  const available = availableProjects(storage);
  for (const owner of configOwners(config)) {
    if (isProjectDeletionRequested(owner, storage) || !available.some(p => ownerKey(p) === ownerKey(owner))) throw new Error('An owning project is unavailable or has been deleted.');
  }
}
export function sourceCatalog(storage = localStorage) {
  return readArray('xhandle:req-projects', storage).flatMap(f => (f.modules || []).map(m => ({ folderId: f.id, moduleId: m.id, label: `${f.name} / ${m.name}` })));
}
export function captureSources(config, storage = localStorage, architectureEntries = []) {
  validateConfig(config);
  assertOwner(config, storage);
  const owners = configOwners(config);
  const folders = readArray('xhandle:req-projects', storage);
  const destination = folders.find(f => f.id === config.folderId);
  if (!destination) throw new Error('The destination folder is unavailable.');
  if (destination.engineeringProjectId && !owners.some(owner => owner.id === String(destination.engineeringProjectId))) throw new Error('The destination belongs to another project.');
  const rows = readArray('xhandle:requirements', storage);
  const entries = [...architectureEntries];
  const modules = [];
  const identities = new Set();
  for (const source of config.sources) {
    const folder = folders.find(f => f.id === source.folderId);
    const module = folder?.modules?.find(m => m.id === source.moduleId);
    if (!module) throw new Error('A selected source module is unavailable.');
    const scope = `${source.folderId}/${source.moduleId}`;
    if (identities.has(scope)) throw new Error('Duplicate source module.');
    identities.add(scope);
    // Legacy folders have no engineering-project owner. Their inclusion is explicit in the form.
    if (folder.engineeringProjectId && !owners.some(owner => owner.id === String(folder.engineeringProjectId))) throw new Error('A selected source belongs to another project.');
    if (config.programId && (!source.ownerProject || !owners.some(owner => ownerKey(owner) === ownerKey(source.ownerProject)))) throw new Error('Assign each selected module to one of the owning projects.');
    if (source.ownerProject && folder.engineeringProjectId && String(folder.engineeringProjectId) !== source.ownerProject.id) throw new Error('The source module assignment conflicts with its recorded owner.');
    modules.push({ ...source, name: module.name, folderName: folder.name });
    for (const row of rows.filter(r => (r.folderId ?? r.projectId) === source.folderId && (r.moduleId ? r.moduleId === source.moduleId : r.module === module.name))) {
      if (row.id == null || String(row.id).trim() === '') throw new Error('A source object has no stable identity. Repair the source module before generation.');
      const id = `module:${scope}:${row.id}`;
      if (identities.has(id)) throw new Error('Duplicate source object identity.');
      identities.add(id);
      entries.push({ ...(config.programId ? { ownerProjects: [source.ownerProject], sourceType: 'module-object' } : {}), id, rowId: row.id, folderId: source.folderId, moduleId: source.moduleId, title: row.title || '', parentId: row.parentId || null, order: row.order ?? 0, heading: !!row.heading, attributes: row.attributes || {}, content: row.content || null, links: row.links || [], sourceRefs: row.sourceRefs || [], status: row.status || '' });
    }
  }
  if (config.templateId !== 'hazard-tracking-list') entries.sort((a, b) => a.id.localeCompare(b.id));
  if (config.notes?.trim()) entries.push({ id: 'notes', title: 'User-provided source notes', text: config.notes.trim() });
  if (config.programId) {
    const projects = availableProjects(storage);
    for (const owner of owners) {
      const project = projects.find(p => ownerKey(p) === ownerKey(owner));
      entries.push({ id: `project:${ownerKey(owner)}`, sourceType: 'project', title: project.name, ownerProjects: [owner], text: 'Selected owning project. Identity and ownership only; this is not engineering evidence.' });
      const notes = config.projectNotes?.[ownerKey(owner)]?.trim();
      if (notes) entries.push({ id: `project-notes:${ownerKey(owner)}`, sourceType: 'project-notes', title: `${project.name} — source notes`, text: notes, ownerProjects: [owner] });
    }
  }
  const manifest = { modules, entries };
  // Architecture snapshots are saved evidence, not a single AI request. Request
  // sizes are bounded separately by the generation pipeline's evidence review.
  if (config.templateId === 'architecture' || config.templateId === 'hazard-tracking-list') {
    // A saved diagram is an exact source snapshot, not a generated narrative.
    // Its capacity is governed by persistent storage, not AI document budgets.
  } else if (architectureEntries.length || isSafetyArtifact(config.templateId)) {
    if (sourceManifestSize(manifest) > DOCUMENT_EVIDENCE_LIMIT) throw new Error('Selected sources exceed the saved supporting-evidence limit. Use a focused source scope.');
  } else if (JSON.stringify(manifest).length > 350000) throw new Error('Selected sources exceed the generation context limit. Select fewer modules or create a focused source module.');
  return { ...manifest, hash: semanticHash(manifest) };
}

// Read external stores before opening an artifact write transaction.
export async function captureLiveSourcesInline(config, storage = localStorage, options = {}) {
  validateConfig(config); assertOwner(config, storage);
  const architecture = config.templateId === 'safety-requirements'
    ? config.programId ? [] : await captureConsolidatedHazardSources(config)
    : isSafetyArtifact(config.templateId) ? await captureHazardAnalysisSources(configOwners(config), storage, { ...options, templateId: config.templateId }) : await captureArchitectureSources(config, storage);
  return captureSources(config.templateId === 'safety-requirements' ? { ...config, sources: [], architectureSources: [], notes: '', projectNotes: {} } : config, storage, architecture);
}
