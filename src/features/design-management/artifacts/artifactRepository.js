import { putArtifactJob, deleteArtifactJob } from './artifactJobSummary';
import { assignHazardTrackingRecordNumbers } from './consolidateHazardRows';
import { assertConsolidatedHazardInputs } from './hazardTrackingSources';
import { assertRequirementInputs } from './requirementDerivationSources';
import { compactSafetyRequirementMetadata } from './safetyRequirements';
import { organizeAtomicSafetyRequirements } from './atomicSafetyRequirements';
import { usesAtomicRequirements } from './requirementArtifactTypes';
import { libraryParents, libraryDescendants, folderProject } from '../../requirements/components/designLibraryHierarchy';
import { artifactDocumentSize, DOCUMENT_CONTENT_LIMIT, DOCUMENT_EVIDENCE_LIMIT, sizeDescription } from './artifactSize';
import { artifactOperation } from './artifactOperation';
import { wrap } from 'idb';
import { assertOwner, checkedCapturedSources, captureLiveSources } from './artifactSources';
import { getTemplate, mergeProposal, newId, validateConfig } from './artifactModel';
import { BACKUP_DATA_CHANGED_EVENT } from '../../../lib/localBackupEvents';

export const ARTIFACT_DB = 'xhandle-design-artifacts';
export const ARTIFACT_STORES = ['metadata', 'revisions', 'jobs', 'baselines', 'presentations'];
export const ARTIFACT_CHANGED = 'xhandle:design-artifacts-changed';
export function openArtifactDatabase() {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, db) => {
      if (finished) { db?.close(); return; }
      finished = true; clearTimeout(timer);
      if (error) reject(error);
      else { db.onversionchange = () => db.close(); resolve(wrap(db)); }
    };
    const timer = setTimeout(() => finish(new Error('Opening design artifact storage timed out. Close other xHandle windows and retry.')), 10000);
    try {
      const request = indexedDB.open(ARTIFACT_DB, 2);
      request.onupgradeneeded = () => {
        if (finished) { request.transaction.abort(); return; }
        for (const name of ARTIFACT_STORES) {
          if (request.result.objectStoreNames.contains(name)) continue;
          const store = request.result.createObjectStore(name, { keyPath: 'id' });
          store.createIndex('projectId', 'projectId');
          if (name !== 'metadata') store.createIndex('artifactId', 'artifactId');
        }
      };
      request.onblocked = () => finish(new Error('Design artifact storage is blocked. Close other xHandle windows and retry.'));
      request.onerror = () => finish(request.error || new Error('Design artifact storage is unavailable.'));
      request.onsuccess = () => finish(null, request.result);
    } catch (error) { finish(error); }
  });
}
export function notifyArtifactChange() { window.dispatchEvent(new Event(ARTIFACT_CHANGED)); window.dispatchEvent(new Event(BACKUP_DATA_CHANGED_EVENT)); }
export async function readArtifactStorage(fn) { const db = await openArtifactDatabase(); try { return await fn(db); } finally { db.close(); } }
export async function writeArtifactStorage(stores, fn, { notify = true } = {}) {
  const db = await openArtifactDatabase();
  const tx = db.transaction(stores, 'readwrite');
  try { const value = await fn(tx); await tx.done; if (notify) notifyArtifactChange(); else window.dispatchEvent(new Event(BACKUP_DATA_CHANGED_EVENT)); return value; }
  catch (error) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw error; }
  finally { db.close(); }
}
export async function requireArtifactMeta(tx, id) {
  const meta = await tx.objectStore('metadata').get(id);
  if (!meta || meta.deleted) throw new Error('This artifact no longer exists.');
  assertOwner(meta.config);
  return meta;
}
export const listArtifacts = () => readArtifactStorage(async db => (await db.getAll('metadata')).filter(m => !m.deleted && m.recordType !== 'systems-engineering-project'));
export const listRevisions = id => readArtifactStorage(db => db.getAllFromIndex('revisions', 'artifactId', id));
export const listBaselines = id => readArtifactStorage(db => db.getAllFromIndex('baselines', 'artifactId', id));
// Display details are independent of engineering content and its revision history.
export async function updateDocumentDetails(id, expectedVersion, input) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (!title || title.length > 200) throw new Error('Enter a title of 1–200 characters.');
  if (description.length > 4000) throw new Error('Keep the description within 4,000 characters.');
  return writeArtifactStorage(['metadata', 'jobs'], async tx => {
    const store = tx.objectStore('metadata'), meta = await store.get(id);
    if (!meta || meta.deleted) throw new Error('This document or project no longer exists.');
    if ((meta.detailsVersion || 0) !== expectedVersion) throw new Error('These details changed in another window. Reopen Edit details to use the latest values.');
    const project = meta.programId ? await store.get(meta.programId) : null;
    if (meta.programId && (!project || project.deleted)) throw new Error('The containing project no longer exists.');
    const job = await tx.objectStore('jobs').get(id);
    if (meta.state === 'generating' || project?.state === 'generating' || job?.state === 'generating') throw new Error('Pause generation before editing details.');
    const updatedAt = new Date().toISOString();
    const config = { ...meta.config, title, description };
    const next = { ...meta, title, description, config, detailsVersion: (meta.detailsVersion || 0) + 1, updatedAt,
      ...(meta.recordType === 'systems-engineering-project' ? { version: meta.version + 1 } : {}) };
    await store.put(next);
    if (project) await store.put({ ...project, version: project.version + 1, updatedAt,
      members: project.members.map(member => member.id === id ? { ...member, config } : member) });
    return next;
  });
}
async function readArtifactRecord(id, onProgress) {
  onProgress?.({ percent: 0, stage: 'Opening artifact' });
  return readArtifactStorage(async db => {
    const tx = db.transaction(ARTIFACT_STORES);
    const meta = await tx.objectStore('metadata').get(id);
    if (!meta || meta.deleted) throw new Error('This artifact no longer exists.');
    if (!meta.programId) assertOwner(meta.config);
    onProgress?.({ percent: 20, stage: 'Reading saved revision' });
    const revision = meta.revision ? await tx.objectStore('revisions').get(`${id}:${meta.revision}`) : null;
    onProgress?.({ percent: 50, stage: 'Reading saved draft' });
    const job = await tx.objectStore('jobs').get(id);
    onProgress?.({ percent: 75, stage: 'Reading revision history' });
    const baselines = await tx.objectStore('baselines').index('artifactId').getAll(id);
    await tx.done;
    onProgress?.({ percent: 100, stage: 'Artifact ready' });
    return { meta, revision, job, baselines };
  });
}
export async function loadArtifact(id, onProgress) {
  const data = await readArtifactRecord(id, onProgress);
  if (data.meta.templateId !== 'safety-requirements' || data.meta.programId || data.job?.state === 'generating') return data;
  const organize = (objects, sources) => organizeAtomicSafetyRequirements(compactSafetyRequirementMetadata(objects, sources));
  const changed = (before, after) => before.length !== after.length || after.some((object, index) => object !== before[index]);
  const sections = data.job && Object.fromEntries(Object.entries(data.job.sections).map(([key, objects]) => [key, organize(objects, data.job.sources)]));
  const objects = !data.job && data.revision ? organize(data.revision.objects, data.revision.sources) : null;
  if (sections ? !Object.entries(sections).some(([key, objects]) => changed(data.job.sections[key], objects)) : !objects || !changed(data.revision.objects, objects)) return data;
  const updated = await writeArtifactStorage(['metadata', 'jobs', 'revisions'], async tx => {
    const meta = await requireArtifactMeta(tx, id), job = await tx.objectStore('jobs').get(id);
    if (meta.revision !== data.meta.revision || meta.programId) return null;
    if (sections) {
      if (!job || job.token !== data.job.token || job.version !== data.job.version || job.state === 'generating') return null;
      validateArtifactObjects(meta, Object.values(sections).flat());
      const next = { ...job, sections, version: job.version + 1, updatedAt: new Date().toISOString() };
      await putArtifactJob(tx, next);
      return { ...data, meta: await tx.objectStore('metadata').get(id), job: next };
    }
    if (job) return null;
    const revision = await publishArtifactRevision(tx, meta, objects, data.revision.sourceHash, data.revision.sources, 'Organized individual safety requirements under their topic titles', data.revision.objects);
    return { ...data, meta: await tx.objectStore('metadata').get(id), revision };
  });
  return updated || readArtifactRecord(id, onProgress);
}
export async function createArtifact(config) {
  const t = validateConfig(config);
  if (t.deterministic) throw new Error('Create traceability matrices from the project artifacts.');
  const sources = await artifactOperation('Capturing artifact sources', () => captureLiveSources(config));
  const id = newId();
  const meta = { id, projectId: config.projectId, workspaceType: config.workspaceType, folderId: config.folderId, title: config.title, templateId: t.id, templateVersion: t.version, config, revision: 0, sourceHash: sources.hash, freshness: 'current', updatedAt: new Date().toISOString() };
  await artifactOperation('Saving the artifact draft', () => writeArtifactStorage(['metadata', 'jobs', 'revisions'], async tx => {
    assertOwner(config);
    await assertConsolidatedHazardInputs(tx, config, sources);
    await assertRequirementInputs(tx, config, sources);
    await tx.objectStore('metadata').add(meta);
    await putArtifactJob(tx, makeArtifactJob(meta, sources), true);
  }));
  return id;
}
export function makeArtifactJob(meta, sources) {
  return { id: meta.id, artifactId: meta.id, projectId: meta.projectId, workspaceType: meta.workspaceType, token: newId(), version: 0, baseRevision: meta.revision, sources, sections: {}, state: 'paused', error: null, updatedAt: new Date().toISOString() };
}
export async function startProposal(id, expectedRevision) {
  const { meta } = await loadArtifact(id);
  if (meta.programId) throw new Error('Generate updates from the systems engineering project.');
  const sources = await captureLiveSources(meta.config);
  return writeArtifactStorage(['metadata', 'jobs', 'revisions'], async tx => {
    const current = await requireArtifactMeta(tx, id);
    if (current.revision !== expectedRevision) throw new Error('The artifact changed. Reload before generating an update.');
    await assertConsolidatedHazardInputs(tx, current.config, sources);
    await assertRequirementInputs(tx, current.config, sources);
    const job = makeArtifactJob(current, sources);
    await putArtifactJob(tx, job);
    return job;
  });
}
// Compare-and-swap checkpoints stop two tabs or a late response from replacing newer work.
export async function checkpointJob(id, job, patch) {
  return writeArtifactStorage(['metadata', 'jobs'], async tx => {
    const meta = await requireArtifactMeta(tx, id);
    if (meta.programId) { const program = await tx.objectStore('metadata').get(meta.programId); if (!program || program.deleted || program.runToken !== job.programRunToken) throw new Error('This project generation was replaced or stopped.'); }
    if (meta.revision !== job.baseRevision && patch.state !== 'paused') throw new Error('The document changed during generation. Start a fresh update; manual edits are preserved.');
    // Job writes update this small compare-and-swap marker in the same
    // transaction. Avoid cloning the full immutable analysis on every batch.
    // Older jobs without a marker use the original read path once.
    const current = meta.draftCheckpoint || await tx.objectStore('jobs').get(id);
    if (!current || current.token !== job.token || current.version !== job.version) throw new Error('This generation has been replaced or updated in another tab. Reload the artifact.');
    const next = { ...job, ...patch, id: job.id, artifactId: job.artifactId, projectId: job.projectId, token: current.token, version: current.version + 1, updatedAt: new Date().toISOString() };
    await putArtifactJob(tx, next);
    return next;
  }, { notify: !Object.keys(patch).every(key => key === 'hazardSafetyIssues') });
}
export function validateArtifactObjects(meta, objects) {
  if (!Array.isArray(objects)) throw new Error('The document content is invalid. Saved draft work is retained.');
  // HTL is a projection of saved assessment records, not an AI context. Its
  // selected fields and full row set are bounded by actual persistent storage.
  const size = meta.templateId === 'hazard-tracking-list' ? { content: 0, evidence: 0 } : artifactDocumentSize(objects, { measureEvidence: meta.templateId !== 'architecture' });
  if (size.content > DOCUMENT_CONTENT_LIMIT) throw new Error(`${meta.title || 'This document'} contains ${sizeDescription(size.content)} of document content, above the saved-document limit of ${sizeDescription(DOCUMENT_CONTENT_LIMIT)}. Saved sections are retained.`);
  if (size.evidence > DOCUMENT_EVIDENCE_LIMIT) throw new Error(`${meta.title || 'This document'} contains ${sizeDescription(size.evidence)} of distinct supporting evidence, above the evidence limit of ${sizeDescription(DOCUMENT_EVIDENCE_LIMIT)}. Saved sections are retained.`);
  const ids = new Set(objects.map(o => o?.id));
  if (objects.some(o => !o || typeof o.id !== 'string' || !o.id.startsWith(`${meta.id}:`) || typeof o.title !== 'string' || !o.title.trim() || o.title.length > 300 || typeof o.text !== 'string' || o.text.length > 16000)) throw new Error('Invalid artifact object or section ownership.');
  if (ids.size !== objects.length || objects.some(o => o.parentId && !ids.has(o.parentId))) throw new Error('Invalid object hierarchy.');
  const byId = new Map(objects.map(o => [o.id, o]));
  const checked = new Set();
  for (const object of objects) {
    const path = new Set(); let current = object.id;
    while (current && !checked.has(current)) {
      if (path.has(current)) throw new Error('Object hierarchy contains a cycle.');
      path.add(current); current = byId.get(current)?.parentId;
    }
    for (const id of path) checked.add(id);
  }
}
export async function publishArtifactRevision(tx, meta, objects, sourceHash, sources, reason, previousObjects = [], collaboratorEdit = null) {
  if (meta.templateId === 'hazard-tracking-list') objects = assignHazardTrackingRecordNumbers(objects, previousObjects);
  if (meta.templateId === 'safety-requirements') objects = organizeAtomicSafetyRequirements(compactSafetyRequirementMetadata(objects, sources));
  else if (usesAtomicRequirements(meta.templateId)) objects = organizeAtomicSafetyRequirements(objects);
  validateArtifactObjects(meta, objects);
  const number = meta.revision + 1;
  const revision = { id: `${meta.id}:${number}`, artifactId: meta.id, projectId: meta.projectId, workspaceType: meta.workspaceType, number, objects, sourceHash, sources, reason, createdAt: new Date().toISOString(), ...(collaboratorEdit ? { collaboratorEdit } : {}) };
  const next = { ...meta, revision: number, sourceHash, baseSourceHash: sources.baseHash || sourceHash, manualReviewRequired: objects.filter(o => o.manual && o.evidenceHash && o.evidenceHash !== sourceHash).length, updatedAt: revision.createdAt };
  await tx.objectStore('revisions').add(revision);
  await tx.objectStore('metadata').put(next);
  return revision;
}
export async function acceptProposal(id, expectedRevision, token) {
  const initial = await loadArtifact(id);
  const live = await captureLiveSources(initial.meta.config);
  return writeArtifactStorage(['metadata', 'revisions', 'jobs'], async tx => {
    const meta = await requireArtifactMeta(tx, id);
    if (meta.programId) throw new Error('Accept this document with its systems engineering project so its trace links stay consistent.');
    const job = await tx.objectStore('jobs').get(id);
    if (!job || job.token !== token || job.state !== 'ready') throw new Error('There is no complete proposal to accept.');
    if (meta.revision !== expectedRevision || job.baseRevision !== meta.revision) throw new Error('The document changed since generation began. Regenerate the proposal; manual edits will be preserved.');
    const sources = checkedCapturedSources(meta.config, live);
    await assertConsolidatedHazardInputs(tx, meta.config, sources);
    await assertRequirementInputs(tx, meta.config, sources);
    if (sources.hash !== job.sources.hash) throw new Error('Sources changed since generation. Regenerate the proposal before accepting.');
    const current = meta.revision ? await tx.objectStore('revisions').get(`${id}:${meta.revision}`) : null;
    const sections = getTemplate(meta.templateId).sections;
    if (sections.some(s => !job.sections[s.id])) throw new Error('The proposal is incomplete.');
    const objects = mergeProposal(current?.objects || [], sections.flatMap(s => job.sections[s.id]));
    const revision = await publishArtifactRevision(tx, { ...meta, freshness: 'current', freshnessError: null }, objects, sources.hash, sources, 'Accepted generated proposal', current?.objects || []);
    await deleteArtifactJob(tx, id);
    return revision;
  });
}
export async function saveObjects(id, expectedRevision, objects, { collaboratorEdit = null } = {}) {
  return writeArtifactStorage(['metadata', 'revisions', ...(collaboratorEdit ? ['jobs'] : [])], async tx => {
    const meta = await requireArtifactMeta(tx, id);
    if (!meta.revision || meta.revision !== expectedRevision) throw new Error('The document changed in another window. Reload before saving.');
    if (collaboratorEdit) {
      const job = await tx.objectStore('jobs').get(id);
      const program = meta.programId ? await tx.objectStore('metadata').get(meta.programId) : null;
      if (job?.state === 'generating' || program?.state === 'generating') throw new Error('Pause generation before applying Collaborator changes.');
    }
    const previous = await tx.objectStore('revisions').get(`${id}:${meta.revision}`);
    return publishArtifactRevision(tx, meta, objects, previous.sourceHash, previous.sources, collaboratorEdit ? 'Collaborator edit' : 'Manual edit', previous.objects, collaboratorEdit);
  });
}
// Edit saved proposal content without accepting it or racing a generation checkpoint.
export async function saveDraftObjects(id, expectedJob, objects, { collaboratorEdit = null } = {}) {
  return writeArtifactStorage(['metadata', 'jobs'], async tx => {
    const meta = await requireArtifactMeta(tx, id);
    const job = await tx.objectStore('jobs').get(id);
    const program = meta.programId && await tx.objectStore('metadata').get(meta.programId);
    if (!job || job.token !== expectedJob.token || job.version !== expectedJob.version || job.baseRevision !== meta.revision) throw new Error('The draft changed in another window. Reload before saving.');
    if (job.state === 'generating' || program?.state === 'generating') throw new Error('Pause generation before editing saved objects.');
    if (meta.templateId === 'hazard-tracking-list') objects = assignHazardTrackingRecordNumbers(objects, Object.values(job.sections).flat());
    if (meta.templateId === 'safety-requirements') objects = organizeAtomicSafetyRequirements(compactSafetyRequirementMetadata(objects, job.sources));
    else if (usesAtomicRequirements(meta.templateId)) objects = organizeAtomicSafetyRequirements(objects);
    validateArtifactObjects(meta, objects);
    const sections = Object.fromEntries(Object.keys(job.sections).map(key => [key, []]));
    for (const object of objects) {
      const bucket = sections[object.sectionId] || (object.manual && sections[Object.keys(sections)[0]]);
      if (!bucket) throw new Error('This section has not been generated yet.');
      bucket.push(object);
    }
    await putArtifactJob(tx, { ...job, sections, version: job.version + 1, collaboratorEdit, updatedAt: new Date().toISOString() });
    if (program) await tx.objectStore('metadata').put({ ...program, version: program.version + 1, updatedAt: new Date().toISOString() });
  });
}
export async function createBaseline(id, expectedRevision, label) {
  if (!label?.trim()) throw new Error('A baseline name is required.');
  return writeArtifactStorage(['metadata', 'baselines'], async tx => {
    const meta = await requireArtifactMeta(tx, id);
    if (!meta.revision || meta.revision !== expectedRevision) throw new Error('Reload the current revision before creating a baseline.');
    const record = { id: newId(), artifactId: id, projectId: meta.projectId, workspaceType: meta.workspaceType, revision: meta.revision, label: label.trim(), createdAt: new Date().toISOString() };
    await tx.objectStore('baselines').add(record);
    return record;
  });
}
export async function updateFreshness(id, expectedHash, freshness, freshnessError = null) {
  return writeArtifactStorage(['metadata'], async tx => {
    const meta = await tx.objectStore('metadata').get(id);
    if (!meta || meta.deleted || meta.sourceHash !== expectedHash || (meta.freshness === freshness && meta.freshnessError === freshnessError)) return;
    await tx.objectStore('metadata').put({ ...meta, freshness, freshnessError });
  });
}
export async function deleteArtifact(id) {
  return writeArtifactStorage(ARTIFACT_STORES, async tx => {
    const meta = await requireArtifactMeta(tx, id);
    if (meta.programId) {
      const store = tx.objectStore('metadata'), program = await store.get(meta.programId);
      if (!program || program.deleted) throw new Error('The containing project no longer exists.');
      const members = program.members.filter(member => member.id !== id);
      let changedInputs = false;
      for (const member of members) {
        if (!(member.dependsOn || []).includes(id)) continue;
        changedInputs = true;
        member.dependsOn = member.dependsOn.filter(dependency => dependency !== id);
        const dependent = await store.get(member.id);
        if (dependent && !dependent.deleted) await store.put({ ...dependent, dependsOn: member.dependsOn, freshness: 'stale' });
      }
      // Cancel the old project run atomically so late responses cannot resurrect
      // the member or publish a proposal for the previous document set. Retain
      // other documents and their historical evidence, including citations to it.
      const computedMatrix = meta.templateId === 'traceability-matrix' && !changedInputs;
      await store.put({ ...program, members, version: program.version + 1,
        ...(computedMatrix ? {} : { runToken: null,
          state: program.state === 'accepted' ? 'accepted' : members.length ? 'paused' : 'draft',
          error: changedInputs && program.state !== 'accepted' ? 'An input artifact was deleted. Saved drafts are retained. Generate a fresh update to refresh document dependencies.' : null }),
        updatedAt: new Date().toISOString() });
    }
    // Retain a tombstone: in-flight generation cannot resurrect a deleted module.
    await tx.objectStore('metadata').put({ id, projectId: meta.projectId, workspaceType: meta.workspaceType, deleted: true });
    for (const store of ['revisions', 'jobs', 'baselines', 'presentations']) {
      const keys = await tx.objectStore(store).index('artifactId').getAllKeys(id);
      for (const key of keys) await tx.objectStore(store).delete(key);
    }
  });
}

// Library placement is metadata only. Document/object identity, evidence snapshots,
// revisions and the program's generation dependency order remain unchanged.
export async function moveArtifactInLibrary(id, folderId) {
  const folders = JSON.parse(localStorage.getItem('xhandle:req-projects') || '[]');
  const destination = folders.find(folder => folder.id === folderId);
  if (!destination) throw new Error('The destination folder no longer exists.');
  return writeArtifactStorage(['metadata'], async tx => {
    const store = tx.objectStore('metadata'), meta = await store.get(id);
    if (!meta || meta.deleted) throw new Error('This library item no longer exists.');
    const projects = (await store.getAll()).filter(record => !record.deleted && record.recordType === 'systems-engineering-project');
    const owner = folderProject(folderId, folders, projects);
    if (meta.templateId === 'traceability-matrix' && meta.programId) {
      const program = projects.find(project => project.id === meta.programId);
      if (!program || (folderId !== program.folderId && owner !== program.id)) throw new Error('Traceability matrices must remain in their containing project artifacts.');
    }
    if (meta.recordType === 'systems-engineering-project') {
      if (owner || libraryDescendants(libraryParents(folders, projects), `project:${id}`).has(`folder:${folderId}`)) throw new Error('A project cannot be moved inside another project or its own folders.');
    } else if (owner && meta.programId !== owner) throw new Error('Add this artifact to the destination project before moving it into its folders.');
    if (meta.programId) {
      const program = await store.get(meta.programId);
      if (!program || program.deleted || !program.members.some(member => member.id === id)) throw new Error('The owning project is unavailable. Reload before moving the artifact.');
      await store.put({ ...program, version: program.version + 1, members: program.members.map(member => member.id === id ? { ...member, config: { ...member.config, folderId } } : member) });
    }
    const owners = meta.config.ownerProjects || [{ id: meta.config.projectId }];
    if (destination.engineeringProjectId && !owners.some(owner => String(owner.id) === String(destination.engineeringProjectId))) throw new Error('The destination folder belongs to another owning project.');
    const records = [meta];
    if (meta.recordType === 'systems-engineering-project') {
      for (const member of meta.members) {
        const artifact = await store.get(member.id);
        if (!artifact || artifact.deleted || artifact.programId !== meta.id) throw new Error('A project artifact is missing. Reload before moving the project.');
        if (artifact.folderId === meta.folderId) records.push(artifact);
      }
    }
    const movingIds = new Set(records.map(record => record.id));
    for (const record of records) {
      const recordOwners = record.config.ownerProjects || [{ id: record.config.projectId }];
      if (destination.engineeringProjectId && !recordOwners.some(owner => String(owner.id) === String(destination.engineeringProjectId))) throw new Error('The destination folder belongs to another owning project.');
      await store.put({ ...record, folderId, config: { ...record.config, folderId },
        ...(record.members ? { version: record.version + 1, members: record.members.map(member => movingIds.has(member.id) ? { ...member, config: { ...member.config, folderId } } : member) } : {}),
      });
    }
  });
}
