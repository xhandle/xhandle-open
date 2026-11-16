import { listArchitecturePresentations } from './architecturePresentation';
import { putArtifactJob, deleteArtifactJob } from './artifactJobSummary';
import { folderProject, libraryParents, libraryDescendants } from '../../requirements/components/designLibraryHierarchy';
import { ARTIFACT_STORES, listRevisions, loadArtifact, makeArtifactJob, moveArtifactInLibrary, publishArtifactRevision, readArtifactStorage, writeArtifactStorage } from './artifactRepository';
import { assertOwner, checkedCapturedSources, captureLiveSources, captureLiveSourceHash, configOwners, ownerKey } from './artifactSources';
import { getTemplate, newId, semanticHash } from './artifactModel';
import { upstreamRequirementTemplate } from './requirementDerivation';
import { ENGINEERING_PROJECT_TYPE, generationMembers, engineeringProjectTrace, planEngineeringProject, projectInputSources, proposedRevision, sameProjectInputs, systemRequirementDerivation } from './engineeringProjectModel';

export const listEngineeringProjects = () => readArtifactStorage(async db => (await db.getAll('metadata')).filter(m => m.recordType === ENGINEERING_PROJECT_TYPE && !m.deleted));
export async function loadEngineeringProject(id) {
  const program = await readArtifactStorage(db => db.get('metadata', id));
  if (!program || program.deleted || program.recordType !== ENGINEERING_PROJECT_TYPE) throw new Error('This systems engineering project no longer exists.');
  const records = await Promise.all(program.members.map(member => loadArtifact(member.id)));
  return { program, records };
}
export async function createEngineeringProject(input) {
  if (input.traceabilityProfile) await (await import('../traceability/traceabilityRepository')).getProfile(input.traceabilityProfile);
  const program = planEngineeringProject(input);
  const snapshots = new Map(await Promise.all(program.members.map(async member => [member.id, await captureLiveSources(member.config)])));
  await writeArtifactStorage(['metadata'], async tx => {
    assertOwner(program.config);
    await tx.objectStore('metadata').add(program);
    for (const member of program.members) {
      const config = member.config, template = getTemplate(config.templateId), sources = checkedCapturedSources(config, snapshots.get(member.id));
      await tx.objectStore('metadata').add({ id: member.id, programId: program.id, projectId: program.id, workspaceType: 'systems-engineering',
        folderId: program.folderId, title: config.title, templateId: template.id, templateVersion: template.version,
        config, draftSummary: null, dependsOn: member.dependsOn, revision: 0, sourceHash: sources.hash, baseSourceHash: sources.hash, freshness: 'current', updatedAt: program.updatedAt });
    }
  });
  return program.id;
}
export async function beginEngineeringGeneration(id, expectedVersion, reset = false) {
  const before = await readArtifactStorage(db => db.get('metadata', id));
  if (!before || before.deleted || before.version !== expectedVersion) throw new Error('The project changed in another window. Reload before generating.');
  const planned = systemRequirementDerivation(before);
  const changed = semanticHash(planned.members) !== semanticHash(before.members);
  if (changed && !reset) throw new Error('Choose Generate fresh update to apply the requirement derivation order for the selected source diagrams. Existing revisions and saved drafts are retained.');
  const existingIds = new Set(before.members.map(member => member.id));
  const added = planned.members.filter(member => !existingIds.has(member.id));
  const snapshots = new Map(await Promise.all(added.map(async member => [member.id, await captureLiveSources(member.config)])));
  return writeArtifactStorage(['metadata', 'jobs'], async tx => {
    const program = await tx.objectStore('metadata').get(id);
    if (!program || program.deleted || program.version !== expectedVersion) throw new Error('The project changed in another window. Reload before generating.');
    assertOwner(program.config);
    const next = { ...planned, version: program.version + 1, runToken: newId(), state: 'generating', error: null, updatedAt: new Date().toISOString() };
    if (changed) for (const member of planned.members) {
      const meta = await tx.objectStore('metadata').get(member.id);
      if (meta) await tx.objectStore('metadata').put({ ...meta, config: member.config, dependsOn: member.dependsOn });
      else {
        const sources = checkedCapturedSources(member.config, snapshots.get(member.id));
        await tx.objectStore('metadata').add({ id: member.id, programId: id, projectId: id, workspaceType: 'systems-engineering',
          folderId: member.config.folderId, title: member.config.title, templateId: member.config.templateId, templateVersion: getTemplate(member.config.templateId).version,
          config: member.config, dependsOn: member.dependsOn, revision: 0, sourceHash: sources.hash, baseSourceHash: sources.hash, freshness: 'current', updatedAt: next.updatedAt });
      }
    }
    if (reset) for (const member of generationMembers(program)) await deleteArtifactJob(tx, member.id);
    await tx.objectStore('metadata').put(next); return next;
  });
}
export async function prepareEngineeringDocument(program, artifactId, upstream) {
  const initial = await loadArtifact(artifactId);
  const live = await captureLiveSources(initial.meta.config);
  return writeArtifactStorage(['metadata', 'jobs', 'revisions'], async tx => {
    const current = await tx.objectStore('metadata').get(program.id);
    if (!current || current.deleted || current.runToken !== program.runToken) throw new Error('This project generation was replaced.');
    const meta = await tx.objectStore('metadata').get(artifactId);
    if (!meta || meta.deleted || meta.programId !== program.id) throw new Error('A project document is missing.');
    const sources = projectInputSources(meta.config, upstream, checkedCapturedSources(meta.config, live));
    let job = await tx.objectStore('jobs').get(artifactId);
    if (job && (job.baseRevision !== meta.revision || !sameProjectInputs(job.sources, sources))) throw new Error('Project sources or documents changed. Choose Generate fresh update to rebuild proposals; accepted edits are preserved.');
    if (!job) job = makeArtifactJob(meta, sources);
    job = { ...job, version: job.version + 1, programRunToken: program.runToken };
    await putArtifactJob(tx, job); return job;
  });
}
export async function finishEngineeringGeneration(program, state, error = null) {
  if (state === 'ready') {
    const { records } = await loadEngineeringProject(program.id);
    for (const record of records.filter(record => record.meta.templateId !== 'traceability-matrix')) {
      if (!record.job || record.job.state !== 'ready') throw new Error('A project document is incomplete. Resume the project to finish saved drafts.');
      if (await captureLiveSourceHash(record.meta.config) !== (record.job.sources.baseHash || record.job.sources.hash)) throw new Error('Project sources changed during generation. Saved drafts are retained; generate a fresh update before review.');
    }
  }
  return writeArtifactStorage(['metadata', 'jobs'], async tx => {
    const current = await tx.objectStore('metadata').get(program.id);
    if (!current || current.deleted || current.runToken !== program.runToken) {
      if (state === 'ready') throw new Error('This project generation was replaced.');
      return;
    }
    if (state === 'ready') for (const member of generationMembers(current)) {
      const meta = await tx.objectStore('metadata').get(member.id), job = await tx.objectStore('jobs').get(member.id);
      if (!meta || meta.deleted || !job || job.state !== 'ready' || job.programRunToken !== program.runToken || job.baseRevision !== meta.revision || getTemplate(meta.templateId).sections.some(section => !job.sections[section.id]?.length)) throw new Error('A project document is incomplete or changed. Resume the project to finish saved drafts.');
    }
    await tx.objectStore('metadata').put({ ...current, state, error, version: current.version + 1, updatedAt: new Date().toISOString() });
  });
}
export async function acceptEngineeringProject(id, expectedVersion, expectedToken) {
  const initial = await loadEngineeringProject(id);
  const snapshots = new Map(await Promise.all(initial.records.filter(data => data.meta.templateId !== 'traceability-matrix').map(async data => [data.meta.id, await captureLiveSources(data.meta.config)])));
  return writeArtifactStorage(['metadata', 'jobs', 'revisions'], async tx => {
    const program = await tx.objectStore('metadata').get(id);
    if (!program || program.deleted || program.version !== expectedVersion || program.runToken !== expectedToken || program.state !== 'ready') throw new Error('Reload and review the current complete project proposal.');
    assertOwner(program.config);
    const records = [];
    for (const member of generationMembers(program)) {
      const meta = await tx.objectStore('metadata').get(member.id);
      const job = await tx.objectStore('jobs').get(member.id);
      if (!meta || meta.deleted || !job || job.programRunToken !== program.runToken || job.baseRevision !== meta.revision || job.state !== 'ready') throw new Error('A document changed or is incomplete. Generate a fresh project update.');
      const revision = meta.revision ? await tx.objectStore('revisions').get(`${meta.id}:${meta.revision}`) : null;
      records.push({ meta, job, revision });
    }
    // External architecture stores were read before this transaction. Rebuild local
    // inputs and upstream revisions atomically before publishing any revision.
    for (const data of records) {
      const upstream = data.meta.dependsOn.map(dep => records.find(record => record.meta.id === dep));
      if (upstream.some(record => !record)) throw new Error('An input document is missing.');
      const sources = projectInputSources(data.meta.config, upstream, checkedCapturedSources(data.meta.config, snapshots.get(data.meta.id)));
      if (!sameProjectInputs(sources, data.job.sources)) throw new Error('Sources or upstream documents changed since generation. Generate a fresh project update.');
      data.next = proposedRevision(data);
    }
    for (const data of records) {
      await publishArtifactRevision(tx, { ...data.meta, freshness: 'current', freshnessError: null }, data.next.objects, data.job.sources.hash, data.job.sources, 'Accepted systems engineering project proposal');
      await deleteArtifactJob(tx, data.meta.id);
    }
    const published = { ...program, acceptedRevisions: Object.fromEntries(records.map(data => [data.meta.id, data.next.number])), updatedAt: new Date().toISOString(), state: 'accepted', version: program.version + 1, acceptedAt: new Date().toISOString(), error: null };
    await tx.objectStore('metadata').put(published);
    return published;
  });
}
export async function engineeringDependencyStatus(meta, sources) {
  if (!meta.programId) return 'current';
  for (const ref of sources?.dependencies || []) {
    try {
      const data = await loadArtifact(ref.artifactId);
      if (!data.revision) return 'stale';
      // Revision identity changes even if a text-only edit happens to preserve meaning.
      if (data.revision.number !== ref.revision) return 'stale';
      const { orderedObjects } = await import('./artifactExport');
      if (semanticHash(orderedObjects(data.revision.objects)) !== ref.contentHash) return 'stale';
    } catch { return 'unavailable'; }
  }
  return 'current';
}
export async function exportEngineeringProject(id) {
  const { program, records } = await loadEngineeringProject(id);
  return { format: 'xhandle-systems-engineering-project', schemaVersion: 1, program, records: await Promise.all(records.map(async record => ({ ...record, revisions: await listRevisions(record.meta.id), presentations: await listArchitecturePresentations(record.meta.id) }))),
    traceability: engineeringProjectTrace(program, records, program.state === 'ready') };
}
export async function deleteEngineeringProject(id) {
  return writeArtifactStorage(ARTIFACT_STORES, async tx => {
    const program = await tx.objectStore('metadata').get(id);
    if (!program || program.deleted) return;
    for (const member of program.members) {
      await tx.objectStore('metadata').put({ id: member.id, projectId: id, deleted: true });
      for (const name of ['jobs', 'revisions', 'baselines', 'presentations']) for (const key of await tx.objectStore(name).index('artifactId').getAllKeys(member.id)) await tx.objectStore(name).delete(key);
    }
    await tx.objectStore('metadata').put({ id, projectId: id, recordType: ENGINEERING_PROJECT_TYPE, deleted: true });
  });
}

// Joining a project changes library membership, not the artifact's source ownership.
// Keep existing revisions, baselines, object IDs and saved section evidence intact.
export async function addArtifactToEngineeringProject(artifactId, programId, folderId) {
  return writeArtifactStorage(['metadata', 'jobs'], tx => adoptArtifact(tx, artifactId, programId, folderId));
}
async function adoptArtifact(tx, artifactId, programId, folderId) {
  const store = tx.objectStore('metadata');
  const program = await store.get(programId), meta = await store.get(artifactId);
  if (!program || program.deleted || program.recordType !== ENGINEERING_PROJECT_TYPE) throw new Error('The destination project no longer exists.');
  if (!meta || meta.deleted || meta.recordType === ENGINEERING_PROJECT_TYPE) throw new Error('This artifact no longer exists.');
  const destinationId = folderId || program.folderId;
  if (meta.programId === programId && program.members.some(member => member.id === artifactId)) {
    if (meta.folderId !== destinationId) {
      const folders = JSON.parse(localStorage.getItem('xhandle:req-projects') || '[]');
      const destination = folders.find(folder => folder.id === destinationId);
      if (!destination) throw new Error('The destination folder no longer exists.');
      if (destination.engineeringProjectId && !configOwners(meta.config).some(owner => String(owner.id) === String(destination.engineeringProjectId))) throw new Error('The destination folder belongs to another owning project.');
      await store.put({ ...meta, folderId: destinationId, config: { ...meta.config, folderId: destinationId } });
      await store.put({ ...program, version: program.version + 1, members: program.members.map(member => member.id === artifactId ? { ...member, config: { ...member.config, folderId: destinationId } } : member) });
    }
    return;
  }
  if (meta.programId) throw new Error('This artifact already belongs to another systems engineering project.');
  const job = await tx.objectStore('jobs').get(artifactId);
  if (program.state === 'generating' || job?.state === 'generating') throw new Error('Pause generation before moving this artifact into the project.');
  if (program.members.length >= 24) throw new Error('A systems engineering project can contain up to 24 artifacts.');
  const artifactOwners = configOwners(meta.config);
  const owners = [...new Map([...program.ownerProjects, ...artifactOwners].map(owner => [ownerKey(owner), owner])).values()];
  if (owners.length > 20) throw new Error('A systems engineering project can have up to 20 owning projects.');
  const folders = JSON.parse(localStorage.getItem('xhandle:req-projects') || '[]');
  const folder = folders.find(item => item.id === destinationId);
  if (!folder) throw new Error('The destination folder no longer exists.');
  const projectFolder = folders.find(item => item.id === program.folderId);
  if (!projectFolder) throw new Error('The project folder no longer exists.');
  for (const destination of [folder, projectFolder]) if (destination.engineeringProjectId && !artifactOwners.some(owner => String(owner.id) === String(destination.engineeringProjectId))) throw new Error('The destination folder belongs to another owning project.');
  const config = { ...meta.config, folderId: destinationId, ownerProjects: artifactOwners, ...(meta.templateId === 'traceability-matrix' ? { programId, scopeId: programId, bindings: {}, lineageSources: null } : {}) };
  assertOwner(config); assertOwner(program.config);
  const updatedAt = new Date().toISOString();
  const next = { ...meta, programId, projectId: programId, workspaceType: 'systems-engineering', folderId: destinationId, config, dependsOn: [], updatedAt };
  await store.put(next);
  if (job) await putArtifactJob(tx, { ...job, projectId: programId, workspaceType: 'systems-engineering',
    sources: upstreamRequirementTemplate(config) ? job.sources : projectInputSources(config, [], job.sources), token: newId(), version: job.version + 1, programRunToken: null, updatedAt });
  // Existing document dependencies and checkpoints remain valid. Adding a member
  // does not fabricate claims that the other documents already cite its content.
  await store.put({ ...program, ownerProjects: owners, config: { ...program.config, ownerProjects: owners },
    members: [...program.members, { id: artifactId, config, dependsOn: [] }],
    state: 'paused', error: null, runToken: null, version: program.version + 1, updatedAt });
}

// Adopt the whole subtree in one transaction. Existing members keep their jobs,
// revisions, links and folder locations; standalone artifacts join the project.
export async function moveFolderIntoEngineeringProject(folderId, programId, destinationFolderId = null) {
  const folders = JSON.parse(localStorage.getItem('xhandle:req-projects') || '[]');
  if (!folders.some(folder => folder.id === folderId)) throw new Error('This folder no longer exists.');
  return writeArtifactStorage(['metadata', 'jobs'], async tx => {
    const store = tx.objectStore('metadata'), records = (await store.getAll()).filter(record => !record.deleted);
    const projects = records.filter(record => record.recordType === ENGINEERING_PROJECT_TYPE);
    const parents = libraryParents(folders, projects);
    const subtree = libraryDescendants(parents, `folder:${folderId}`);
    const targetProjectId = programId || (destinationFolderId && folderProject(destinationFolderId, folders, projects));
    const target = programId ? `project:${programId}` : destinationFolderId ? `folder:${destinationFolderId}` : 'library';
    if (subtree.has(target)) throw new Error('A folder cannot be moved into itself or its contents.');
    if (targetProjectId) {
      const project = projects.find(project => project.id === targetProjectId);
      if (!project) throw new Error('The destination project no longer exists.');
      if ([...subtree].some(key => key.startsWith('project:'))) throw new Error('Move the projects out of this folder before placing it inside a project.');
      const members = records.filter(record => subtree.has(`folder:${record.folderId}`));
      for (const member of members) await adoptArtifact(tx, member.id, targetProjectId, member.folderId);
    }
    for (const project of projects) {
      const current = await store.get(project.id);
      const ids = (current.libraryFolderIds || []).filter(id => id !== folderId);
      if (project.id === programId) ids.push(folderId);
      if (JSON.stringify(ids) !== JSON.stringify(current.libraryFolderIds || [])) await store.put({ ...current, libraryFolderIds: ids, version: current.version + 1 });
    }
  });
}

export async function moveDesignArtifact(id, folderId, programId) {
  if (programId) return addArtifactToEngineeringProject(id, programId);
  const projects = await listEngineeringProjects();
  const folders = JSON.parse(localStorage.getItem('xhandle:req-projects') || '[]');
  const owner = folderProject(folderId, folders, projects);
  if (owner) return addArtifactToEngineeringProject(id, owner, folderId);
  return moveArtifactInLibrary(id, folderId);
}
