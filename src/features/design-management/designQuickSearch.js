import { useEffect } from 'react';
import { QUICK_SEARCH_COLLECT, filterSearchEntries, isSearchVisible } from '../../components/quickSearchUtils';
import { loadFolders, loadRequirements } from '../requirements/actions';
import { readArtifactStorage } from './artifacts/artifactRepository';
import { consolidateHazardRows } from './artifacts/consolidateHazardRows';
import { architectureDescriptionObjects } from './artifacts/architectureDescription';

export const DESIGN_SEARCH_REVEAL = 'xhandle:design-search-reveal';
const textOf = value => {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  return Object.values(value).map(textOf).join(' ');
};
export function librarySearchEntries(folders, requirements, activate) {
  const entries = [];
  for (const folder of folders) {
    entries.push({ id: `design-folder:${folder.id}`, kind: 'Folder', label: folder.name, text: folder.description || '', activate: () => activate({ folderId: folder.id }) });
    for (const module of folder.modules || []) entries.push({ id: `design-module:${module.id || `${folder.id}:${module.name}`}`, kind: 'Module', label: `${folder.name} · ${module.name}`, text: module.description || '', activate: () => activate({ folderId: folder.id, moduleName: module.name }) });
  }
  for (const row of requirements) {
    if (row.deleted) continue;
    const folder = folders.find(folder => folder.id === (row.folderId || row.projectId));
    entries.push({ id: `design-requirement:${row.id}`, kind: 'Requirement', label: `${folder?.name || 'Design'} · ${row.module || 'System'} · ${row.title || row.id}`, text: textOf([row.id, row.description, row.text, row.attributes, row.content, row.status, row.version, row.updatedAt, row.links]), activate: () => activate({ folderId: row.folderId || row.projectId, moduleName: row.module, objectId: row.id }) });
  }
  return entries;
}
export function artifactSearchEntries(meta, objects, draft, activate) {
  const records = new Map(), issues = [];
  if (meta.templateId === 'hazard-tracking-list') for (const group of consolidateHazardRows(objects)) {
    for (const row of group.rows) records.set(row.id, group.recordId);
    issues.push({ id: `design-issue:${meta.id}:${draft ? 'draft' : 'revision'}:${group.id}`, kind: 'Actionable Safety Issue', label: `${meta.title} · ${group.recordId} · Actionable Safety Issue`, text: group.issueDescription, activate: () => activate(meta.id, group.rows[0].id, draft) });
  }
  const entries = objects.filter(object => !object.deleted).map(object => ({
    id: `design-artifact:${meta.id}:${draft ? 'draft' : 'revision'}:${object.id}`, kind: draft ? 'Draft artifact' : 'Artifact', label: `${meta.title} · ${records.get(object.id) || object.title || object.id}`,
    text: textOf([object.title, object.text, object.attributes, object.content, object.status, object.kind, (object.sourceEvidence || []).map(source => [source.sourceRowId, source.projectName, source.repoId])]), activate: () => activate(meta.id, object.id, draft),
  }));
  // Specific source-cell matches precede the shared issue description. A find
  // for one function must reveal that assessment, not a sibling in its HTR.
  return [...entries, ...issues];
}

// Read one document at a time and retain only searchable strings and navigation
// targets. Never collect full source manifests from every artifact into memory.
export function useDesignQuickSearch({ rootRef, modules, onOpenArtifact, onOpenLibrary }) {
  useEffect(() => {
    const collect = event => {
      if (!isSearchVisible(rootRef.current)) return;
      const { entries, providers } = event.detail;
      const library = librarySearchEntries(loadFolders(), loadRequirements(), onOpenLibrary);
      for (const meta of modules) library.push({ id: `design-meta:${meta.id}`, kind: meta.recordType === 'systems-engineering-project' ? 'Engineering project' : 'Artifact', label: meta.title || meta.name, text: textOf([meta.description, meta.config?.system]), activate: () => onOpenArtifact(meta.id) });
      // These model-backed entries replace DOM table snapshots in Design so a
      // filtered or off-page result has the same reliable navigation behavior.
      const otherProviders = entries.filter(entry => entry.kind !== 'Table row');
      entries.splice(0, entries.length, ...otherProviders, ...library);
      if (!providers) return;
      const cache = new Map();
      providers.push(async (query, signal) => {
        const found = [];
        for (const meta of modules) {
          if (signal.aborted) return [];
          if (meta.recordType === 'systems-engineering-project') continue;
          if (!cache.has(meta.id)) {
            const indexed = await readArtifactStorage(async db => {
              const current = await db.get('metadata', meta.id);
              if (!current || current.deleted) return [];
              const revision = current.revision ? await db.get('revisions', `${meta.id}:${current.revision}`) : null;
              const searchable = (objects, manifest) => meta.templateId === 'architecture' && objects.length ? [...new Map([...objects, ...architectureDescriptionObjects(meta, manifest, objects)].map(object => [object.id, object])).values()] : objects;
              const accepted = revision ? artifactSearchEntries(meta, searchable(revision.objects || [], revision.sources), false, onOpenArtifact) : [];
              const job = await db.get('jobs', meta.id);
              const objects = Object.values(job?.sections || {}).flat();
              return [...accepted, ...(job ? artifactSearchEntries(meta, searchable(objects, job.sources), true, onOpenArtifact) : [])];
            });
            if (signal.aborted) return [];
            cache.set(meta.id, indexed);
          }
          found.push(...filterSearchEntries(cache.get(meta.id), query));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        return found;
      });
    };
    window.addEventListener(QUICK_SEARCH_COLLECT, collect);
    return () => window.removeEventListener(QUICK_SEARCH_COLLECT, collect);
  }, [rootRef, modules, onOpenArtifact, onOpenLibrary]);
}
