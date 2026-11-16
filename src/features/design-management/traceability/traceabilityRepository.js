import { readArtifactStorage, writeArtifactStorage } from '../artifacts/artifactRepository';
import { newId, semanticHash, mergeProposal } from '../artifacts/artifactModel';
import { consolidatedHazardSources } from '../artifacts/hazardTrackingSources';
import { projectArtifactCatalog, requireMatrixProject, projectScopeIdentity, validateProjectSources } from './traceabilityProjectScope';
import { loadRequirements, loadFolders } from '../../requirements/actions/requirementsState';
import { listSysMLV2Models, loadSysMLV2Model } from '../SysMLV2Modeler/sysmlV2Store';
import { DEFAULT_PROFILE, DEFAULT_PROFILE_ID, MATRIX_TYPE, clone, validateProfile, referenceKey, checkRelationship, engineeringIdentity, matchingRules, STAGES } from './traceabilityModel';
import { evaluateTraceability } from './traceabilityEvaluation';
import { buildDerivationLineage, lineageProfile, lineageCitation, lineageRole, LINEAGE_STAGES } from './derivationLineage';
import { requirementDerivationMode } from '../artifacts/requirementDerivation';

const profileId = (id, version) => `trace:profile:${id}:${version}`;
const ledgerId = scope => `trace:relationships:${scope}`;
const assignmentId = scope => `trace:assignment:${scope}`;
const nativeTypes = { derives: 'derived-from', derivedFrom: 'derived-from', 'derived-from': 'derived-from', satisfies: 'satisfies', verifies: 'verifies', mitigates: 'mitigates', allocatedTo: 'allocated-to', 'allocated-to': 'allocated-to', related: 'related-to', 'related-to': 'related-to' };
const moduleKey = (folderId, moduleId) => `module:${JSON.stringify([folderId, moduleId])}`;
export function traceLegacyObjects() {
  const folders = new Map(loadFolders().map(folder => [folder.id, folder]));
  return loadRequirements().map(row => ({ ...row, moduleId: row.moduleId || folders.get(row.folderId || row.projectId)?.modules?.find(module => module.name === row.module)?.id }));
}
export function traceModels(ids) {
  return [...ids].map(id => loadSysMLV2Model(id, null)).filter(model => model && ids.has(model.id));
}
export const defaultSelection = { id: DEFAULT_PROFILE_ID, version: 1 };
export const scopeKey = owner => owner.recordType === 'systems-engineering-project' ? owner.id : `${owner.workspaceType}:${owner.projectId || owner.id}`;
export async function profiles() {
  return readArtifactStorage(async db => [clone(DEFAULT_PROFILE), ...(await db.getAll('presentations', IDBKeyRange.bound('trace:profile:', 'trace:profile:\uffff'))).filter(row => row.recordType === 'traceability-profile').map(row => row.profile)]);
}
export async function getProfile(selection = defaultSelection) {
  if (selection.id === DEFAULT_PROFILE_ID && selection.version === 1) return clone(DEFAULT_PROFILE);
  const record = await readArtifactStorage(db => db.get('presentations', profileId(selection.id, selection.version)));
  if (!record) throw Error('The selected traceability profile version is unavailable.');
  validateProfile(record.profile); return record.profile;
}
export async function publishProfile(input, { id = newId(), expectedVersion = 0 } = {}) {
  validateProfile(input); if (id === DEFAULT_PROFILE_ID) throw Error('Duplicate the built-in profile before editing it.');
  return writeArtifactStorage(['presentations'], async tx => {
    const store = tx.objectStore('presentations'), headId = `trace:profile-head:${id}`, head = await store.get(headId);
    if ((head?.version || 0) !== expectedVersion) throw Error('This profile changed in another window. Reload before publishing.');
    const profile = { ...clone(input), id, version: expectedVersion + 1, publishedAt: new Date().toISOString() };
    await store.add({ id: profileId(id, profile.version), recordType: 'traceability-profile', profile });
    await store.put({ id: headId, recordType: 'traceability-profile-head', version: profile.version }); return profile;
  });
}
export async function assignment(scope) {
  return readArtifactStorage(async db => (await db.get('presentations', assignmentId(scope))) || { id: assignmentId(scope), version: 0, selection: (await db.get('metadata', scope))?.traceabilityProfile || defaultSelection, bindings: {} });
}
export async function assignProfile(scope, expectedVersion, selection, bindings = {}) {
  await getProfile(selection);
  return writeArtifactStorage(['presentations'], async tx => {
    const store = tx.objectStore('presentations'), current = await store.get(assignmentId(scope));
    if ((current?.version || 0) !== expectedVersion) throw Error('The project traceability profile changed. Reload before applying.');
    const value = { id: assignmentId(scope), recordType: 'traceability-assignment', version: expectedVersion + 1, selection, bindings };
    await store.put(value); return value;
  });
}
export async function traceCatalog(scope) {
  if (scope) return readArtifactStorage(async db => projectArtifactCatalog(await requireMatrixProject(db, scope), await db.getAll('metadata')));
  const artifacts = await readArtifactStorage(async db => (await db.getAll('metadata')).filter(meta => !meta.deleted && meta.templateId && meta.templateId !== MATRIX_TYPE));
  const modules = loadFolders().flatMap(folder => (folder.modules || []).map(module => ({ id: moduleKey(folder.id, module.id), title: `${folder.name} / ${module.name}`, templateId: 'legacy', moduleId: module.id, moduleName: module.name, folderId: folder.id })));
  const models = listSysMLV2Models(null).map(model => ({ id: `sysml:${model.id}`, title: model.name, templateId: 'sysml', modelId: model.id }));
  return [...artifacts, ...modules, ...models];
}
export function suggestBindings(profile, catalog, owner) {
  // Matrix configurations identify their project through scopeId; they do not
  // have an id of their own. Never match two absent IDs or use folder proximity.
  const scope = owner?.scopeId;
  const workspace = ['functional', 'code-architecture'].find(type => scope?.startsWith(`${type}:`));
  const programId = scope && !workspace ? scope : !scope && (owner?.recordType === 'systems-engineering-project' || owner?.workspaceType === 'systems-engineering') ? owner.id || owner.projectId : !scope && owner?.programId;
  const project = workspace ? { id: scope.slice(workspace.length + 1), workspaceType: workspace } : owner && { id: owner.projectId || owner.id, workspaceType: owner.workspaceType };
  const sameProject = candidate => !!project?.id && !!project.workspaceType && candidate?.id === project.id && candidate.workspaceType === project.workspaceType;
  const matchesOwner = meta => {
    if (programId) return meta.programId === programId || meta.config?.programId === programId || (meta.workspaceType === 'systems-engineering' && meta.projectId === programId);
    if (!project?.id || !['functional', 'code-architecture'].includes(project.workspaceType)) return false;
    // Program members store the engineering-project ID at the top level and
    // their underlying Projects/Code-Based Architecture owners in config.
    return sameProject({ id: meta.projectId, workspaceType: meta.workspaceType }) || sameProject({ id: meta.config?.projectId, workspaceType: meta.config?.workspaceType }) || [...(meta.ownerProjects || []), ...(meta.config?.ownerProjects || [])].some(sameProject);
  };
  return Object.fromEntries(profile.roles.map(role => [role.id, [...new Set(catalog.filter(meta => !meta.deleted && role.templates.includes(meta.templateId) && matchesOwner(meta)).map(meta => meta.id))]]));
}
function validateMatrixConfig(config, profile) {
  if (!config.title?.trim() || config.title.length > 200 || !config.folderId || !config.system?.trim() || !config.scopeId || !STAGES.includes(config.stage)) throw Error('Enter a title, system, destination, owning scope and assessment stage.');
  if (!config.bindings || Object.keys(config.bindings).some(id => !profile.roles.some(role => role.id === id)) || Object.values(config.bindings).some(ids => !Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string'))) throw Error('Bind known profile roles to valid source artifacts.');
  if (config.lineageSources != null && (!Array.isArray(config.lineageSources) || config.lineageSources.length > 300 || config.lineageSources.some(id => typeof id !== 'string'))) throw Error('Select valid source artifacts for the derivation chain.');
}
export async function createMatrix(config) {
  config = { ...config, profile: config.profile || defaultSelection, bindings: config.bindings || {} };
  const profile = await getProfile(config.profile); validateMatrixConfig(config, profile);
  const id = newId(), now = new Date().toISOString();
  await writeArtifactStorage(['metadata'], async tx => {
    const store = tx.objectStore('metadata'), program = await requireMatrixProject(tx, config.scopeId);
    if (program.state === 'generating') throw Error('Pause project generation before adding a traceability matrix.');
    if (program.members.length >= 24) throw Error('A systems engineering project can contain up to 24 artifacts.');
    validateProjectSources(config, projectArtifactCatalog(program, await store.getAll()));
    // The matrix is a project member, but never an AI-generated document or an input to one.
    const savedConfig = { ...config, title: config.title.trim(), folderId: program.folderId, programId: program.id,
      projectId: program.config.projectId, workspaceType: program.config.workspaceType, ownerProjects: program.ownerProjects,
      sources: [], architectureSources: [], notes: '', templateId: MATRIX_TYPE };
    await store.add({ id, recordType: MATRIX_TYPE, templateId: MATRIX_TYPE, templateVersion: 1, title: savedConfig.title,
      folderId: program.folderId, programId: program.id, projectId: program.id, workspaceType: 'systems-engineering',
      config: savedConfig, dependsOn: [], revision: 0, matrixVersion: 0, updatedAt: now, freshness: 'current' });
    await store.put({ ...program, members: [...program.members, { id, config: savedConfig, dependsOn: [] }], version: program.version + 1, updatedAt: now });
  });
  return id;
}
export async function configureMatrix(id, expectedVersion, config) {
  const profile = await getProfile(config.profile); validateMatrixConfig(config, profile);
  return writeArtifactStorage(['metadata'], async tx => {
    const store = tx.objectStore('metadata'), meta = await store.get(id);
    if (!meta || meta.deleted || meta.templateId !== MATRIX_TYPE || meta.matrixVersion !== expectedVersion) throw Error('The matrix configuration changed. Reload before saving.');
    if (!meta.programId || config.scopeId !== meta.programId) throw Error('A matrix must use the artifacts in its containing Design Management project.');
    const program = await requireMatrixProject(tx, meta.programId);
    if (!program.members.some(member => member.id === id)) throw Error('The matrix is not a member of this project.');
    validateProjectSources(config, projectArtifactCatalog(program, await store.getAll()));
    const savedConfig = { ...config, title: meta.title, folderId: meta.folderId, templateId: MATRIX_TYPE, programId: meta.programId, sources: [] };
    await store.put({ ...meta, config: savedConfig, matrixVersion: expectedVersion + 1, updatedAt: new Date().toISOString() });
    await store.put({ ...program, version: program.version + 1, members: program.members.map(member => member.id === id ? { ...member, config: savedConfig } : member) });
  });
}
const sourceIdentity = meta => ({ id: meta.id, revision: meta.revision, draft: meta.revision ? null : meta.draftCheckpoint || meta.draftSummary || null, deleted: !!meta.deleted, freshness: meta.freshness || null });
export async function collectScope(config, profile, { signal, legacy, models } = {}) {
  const nodes = new Map(), availability = Object.fromEntries(profile.roles.map(role => [role.id, { ready: false, messages: [] }])), sourceManifest = [], provenance = [], native = [];
  const rolesByArtifact = new Map();
  for (const role of profile.roles) for (const id of config.bindings[role.id] || []) {
    if (!rolesByArtifact.has(id)) rolesByArtifact.set(id, []); rolesByArtifact.get(id).push(role);
  }
  const add = (meta, object, revision, draft, roles, objectId = object.id) => {
    const kind = object.kind || (object.heading ? 'section' : 'requirement');
    const assigned = roles.filter(role => role.kinds.includes(object.proposedKind || kind) && (role.id !== lineageRole(LINEAGE_STAGES[0]) || meta.templateId !== 'architecture' || (object.citations || object.sourceEvidence || []).some(source => source?.sourceType === 'architecture-element' && source.elementType === 'edge')));
    if (!assigned.length || object.deleted) return;
    const id = referenceKey(meta.id, objectId), node = { id, artifactId: meta.id, objectId, displayId: object.displayId || object.id,
      title: object.title || object.name || object.label || object.id, text: object.text || object.description || object.attributes?.Description || '',
      kind, requirementDerivation: requirementDerivationMode(meta.config), roles: assigned.map(role => role.id), hash: engineeringIdentity(object), revision, draft,
      unresolved: kind === 'gap' || !!object.evidenceIssue || ['stale', 'unavailable'].includes(meta.freshness), artifactTitle: meta.title, navigateId: object.navigateId || objectId,
      templateId: meta.templateId, citations: object.citations || (object.sourceEvidence || []).filter(Boolean).map(lineageCitation), sourceAliases: object.sourceAliases || [], sourceContentHash: semanticHash(object) };
    nodes.set(id, node); assigned.forEach(role => { if (!draft && !node.unresolved) availability[role.id].ready = true; });
    for (const link of object.links || []) if (Object.hasOwn(nativeTypes, link.type)) native.push({ from: id, targetObjectId: link.toId, targetArtifactId: link.artifactId, type: nativeTypes[link.type], rationale: link.rationale || 'Existing typed source relationship; review before confirming engineering coverage.' });
  };
  for (const [id, roles] of rolesByArtifact) {
    if (signal?.aborted) throw new DOMException('Assessment cancelled', 'AbortError');
    if (id.startsWith('module:')) {
      const records = legacy || traceLegacyObjects(), rowIds = records.filter(row => id === moduleKey(row.folderId || row.projectId, row.moduleId)).filter(row => !row.deleted);
      const identity = semanticHash(rowIds); sourceManifest.push({ id, legacyHash: identity });
      for (const row of rowIds) add({ id, title: rowIds[0]?.module || 'Design module' }, { ...row, kind: row.heading ? 'section' : row.kind || 'requirement', text: row.text || row.attributes?.Description || row.title }, row.version || 1, false, roles);
      if (!rowIds.length) roles.forEach(role => availability[role.id].messages.push('The bound design module is empty or unavailable.'));
    } else if (id.startsWith('sysml:')) {
      const model = (models || traceModels(new Set([id.slice(6)]))).find(model => `sysml:${model.id}` === id);
      sourceManifest.push({ id, modelHash: model ? semanticHash(model) : null });
      for (const element of model?.elements || []) add({ id, title: model.name }, { ...element, title: element.name, text: element.description, kind: element.type.startsWith('Requirement') ? 'requirement' : element.type === 'VerificationCase' ? 'verification' : 'design' }, model.version || 1, false, roles);
      for (const link of [...model?.relationships || [], ...model?.traceLinks || []]) if (Object.hasOwn(nativeTypes, link.relationshipType || link.type)) native.push({ from: referenceKey(id, link.sourceId), targetObjectId: link.targetId, type: nativeTypes[link.relationshipType || link.type], rationale: link.rationale || 'Existing SysML relationship; review before confirming engineering coverage.' });
    } else {
      const data = await readArtifactStorage(async db => {
        const tx = db.transaction(['metadata', 'revisions', 'jobs']), meta = await tx.objectStore('metadata').get(id);
        const revision = meta?.revision ? await tx.objectStore('revisions').get(`${id}:${meta.revision}`) : null;
        const job = meta && !revision ? await tx.objectStore('jobs').get(id) : null; await tx.done; return { meta, revision, job };
      });
      const { meta, revision, job } = data;
      sourceManifest.push(meta ? sourceIdentity(meta) : { id, deleted: true });
      if (!meta || meta.deleted || meta.templateId === MATRIX_TYPE || (!revision && !job)) { roles.forEach(role => availability[role.id].messages.push('The bound artifact has no available saved revision.')); continue; }
      const objects = revision?.objects || mergeProposal([], Object.values(job?.sections || {}).flat()), draft = !revision;
      if (meta.templateId === 'hazard-tracking-list') {
        try {
          const byId = new Map(objects.map(object => [object.id, object]));
          for (const record of consolidatedHazardSources(meta, objects, revision?.number || 0)) {
            const citations = new Map();
            for (const objectId of record.objectIds) for (const source of byId.get(objectId)?.sourceEvidence || []) if (source?.functionalTraceId || source?.sourceType === 'architecture-element') citations.set(source.functionalTraceId ? JSON.stringify([source.workspaceType, source.projectId, source.repoId, source.functionalTraceId]) : source.id, lineageCitation(source));
            add(meta, { id: record.recordId, displayId: record.recordId, navigateId: record.objectIds[0], title: record.attributes['Actionable Safety Issue Title'], text: record.text, attributes: record.attributes, kind: 'htr', sourceAliases: [record.id, referenceKey(meta.id, record.recordId)], citations: [...citations.values()] }, revision?.number || 0, draft, roles, record.id);
          }
        } catch (error) { roles.forEach(role => availability[role.id].messages.push(error.message)); }
      } else {
        const sources = new Map((revision?.sources?.entries || job?.sources?.entries || []).map(source => [source.id, source]));
        for (const object of objects) {
          const original = object.kind === 'architecture-element' ? { ...object, kind: 'design' } : object;
          add(meta, { ...original, citations: (object.sourceEvidence?.length ? object.sourceEvidence : (object.sourceIds || []).map(id => sources.get(id))).filter(Boolean).map(lineageCitation) }, revision?.number || 0, draft, roles);
          const captured = nodes.get(referenceKey(meta.id, object.id)); if (captured) captured.sourceContentHash = semanticHash(object);
          // Citations remain inspectable provenance and never qualify as engineering relationships.
          if (object.sourceIds?.length) provenance.push({ artifactId: id, objectId: object.id, count: object.sourceIds.length });
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const byObject = new Map();
  for (const node of nodes.values()) { if (!byObject.has(node.objectId)) byObject.set(node.objectId, []); byObject.get(node.objectId).push(node); }
  const imported = new Map();
  for (const link of native) {
    if (!nodes.has(link.from)) continue;
    const matches = (byObject.get(link.targetObjectId) || []).filter(node => !link.targetArtifactId || node.artifactId === link.targetArtifactId);
    const target = matches.length === 1 ? matches[0] : null;
    const to = target?.id || `unresolved:${link.targetObjectId}`;
    const id = `native:${semanticHash([link.from, to, link.type])}`;
    imported.set(id, { id, from: link.from, to, type: link.type, rationale: link.rationale, native: true, state: 'proposed', sourceArtifactId: nodes.get(link.from).artifactId, targetArtifactId: target?.artifactId, sourceHash: nodes.get(link.from).hash, targetHash: target?.hash, profile: { id: profile.id, version: profile.version } });
  }
  return { nodes: [...nodes.values()], availability, sourceManifest, provenance, imported: [...imported.values()] };
}
export async function assessConfiguration(config, options = {}) {
  const profile = await getProfile(config.profile);
  const { program, catalog } = await readArtifactStorage(async db => {
    const program = await requireMatrixProject(db, config.scopeId);
    return { program, catalog: projectArtifactCatalog(program, await db.getAll('metadata')) };
  });
  // Recheck explicit sources on every refresh; configuration cannot bypass project membership.
  validateProjectSources(config, catalog);
  const suggested = suggestBindings(lineageProfile, catalog, config);
  const selected = config.lineageSources == null ? new Set(Object.values(suggested).flat()) : new Set(config.lineageSources);
  const flowBindings = Object.fromEntries(lineageProfile.roles.map(role => [role.id, catalog.filter(meta => selected.has(meta.id) && role.templates.includes(meta.templateId)).map(meta => meta.id)]));
  const scope = await collectScope({ ...config, bindings: { ...config.bindings, ...flowBindings } }, { ...profile, roles: [...profile.roles, ...lineageProfile.roles] }, options);
  scope.sourceManifest.unshift(projectScopeIdentity(program, catalog));
  const ledger = await readArtifactStorage(async db => (await db.get('presentations', ledgerId(config.scopeId))) || { version: 0, links: [], exclusions: [] });
  // Project-wide links outside this matrix remain in the ledger and are not retired by a scoped assessment.
  const ids = new Set(scope.nodes.map(node => node.id));
  const bound = new Set(Object.values(config.bindings || {}).flat());
  const adopted = new Set(ledger.links.map(link => link.originId).filter(Boolean));
  const relevant = [...ledger.links.filter(link => ids.has(link.from) || ids.has(link.to) || bound.has(link.sourceArtifactId) || bound.has(link.targetArtifactId)), ...scope.imported.filter(link => !adopted.has(link.id))];
  const result = await evaluateTraceability({ ...scope, profile, links: relevant, exclusions: ledger.exclusions, stage: config.stage }, options);
  const lineage = await buildDerivationLineage(scope.nodes, result.edges, options);
  return { ...result, lineage, profile, config, sourceManifest: scope.sourceManifest, provenance: scope.provenance, ledgerVersion: ledger.version, scopeHash: semanticHash(scope.sourceManifest) };
}
export async function assessMatrix(id, options = {}) {
  const meta = await readArtifactStorage(db => db.get('metadata', id));
  if (!meta || meta.deleted || meta.templateId !== MATRIX_TYPE) throw Error('This traceability matrix is unavailable.');
  if (!meta.programId || meta.config.scopeId !== meta.programId) throw Error('Add this traceability matrix to a Design Management project to use that project’s artifacts as inputs. Saved assessments are retained.');
  const program = await readArtifactStorage(db => requireMatrixProject(db, meta.programId));
  if (!program.members.some(member => member.id === id)) throw Error('Add this matrix to the project artifacts before refreshing. Saved assessments are retained.');
  return { ...await assessConfiguration(meta.config, options), matrixVersion: meta.matrixVersion, matrixRevision: meta.revision };
}
async function assertCurrent(tx, meta, assessment) {
  if (!meta || meta.deleted) throw Error('This traceability matrix was deleted.');
  if (meta.matrixVersion !== assessment.matrixVersion || semanticHash(meta.config) !== semanticHash(assessment.config)) throw Error('The matrix configuration changed. Reassess before saving.');
  for (const source of assessment.sourceManifest) {
    if (source.recordType === 'matrix-project-scope') {
      const program = await requireMatrixProject(tx, meta.programId), catalog = projectArtifactCatalog(program, await tx.objectStore('metadata').getAll());
      if (meta.config.scopeId !== program.id || !program.members.some(member => member.id === meta.id)) throw Error('Project membership changed. Reassess before saving.');
      if (semanticHash(projectScopeIdentity(program, catalog)) !== semanticHash(source)) throw Error('Project artifacts changed. Reassess before saving.');
      continue;
    }
    if (source.id.startsWith('module:')) {
      const rows = traceLegacyObjects().filter(row => !row.deleted && moduleKey(row.folderId || row.projectId, row.moduleId) === source.id);
      if (semanticHash(rows) !== source.legacyHash) throw Error('The bound design module changed. Reassess before saving.');
      continue;
    }
    if (source.id.startsWith('sysml:')) {
      const model = traceModels(new Set([source.id.slice(6)]))[0];
      if ((model ? semanticHash(model) : null) !== source.modelHash) throw Error('The bound SysML model changed. Reassess before saving.');
      continue;
    }
    const current = await tx.objectStore('metadata').get(source.id);
    if (semanticHash(current ? sourceIdentity(current) : { id: source.id, deleted: true }) !== semanticHash(source)) throw Error('Source content changed. Reassess before saving.');
  }
  const current = await tx.objectStore('presentations').get(ledgerId(meta.config.scopeId));
  if ((current?.version || 0) !== assessment.ledgerVersion) throw Error('Relationships changed in another window. Reassess before saving.');
  return current || { id: ledgerId(meta.config.scopeId), recordType: 'traceability-relationships', version: 0, links: [], exclusions: [] };
}
async function checkedAssessment(id, expected) {
  const actual = typeof Worker === 'undefined' ? await assessMatrix(id) : await (await import('./requestTraceAssessment')).requestTraceAssessment(id);
  if (actual.scopeHash !== expected.scopeHash || actual.matrixVersion !== expected.matrixVersion || actual.ledgerVersion !== expected.ledgerVersion || semanticHash(actual.config) !== semanticHash(expected.config)) throw Error('Traceability evidence changed. Reassess before saving.');
  return actual;
}
export async function saveRelationship(matrixId, expected, input) {
  const assessment = await checkedAssessment(matrixId, expected);
  if (!['proposed', 'confirmed', 'retired'].includes(input.state) || typeof input.rationale !== 'string' || !input.rationale.trim() || input.rationale.length > 4000) throw Error('Select a state and enter a relationship rationale.');
  if (input.state === 'retired') return writeArtifactStorage(['metadata', 'presentations'], async tx => {
    const meta = await tx.objectStore('metadata').get(matrixId), ledger = await assertCurrent(tx, meta, assessment), native = assessment.edges.find(link => link.id === input.id && link.native), prior = ledger.links.find(link => link.id === input.id) || native;
    if (!prior) throw Error('Choose an existing relationship to retire.');
    const link = { ...prior, ...(native ? { id: newId(), originId: native.id, native: false } : {}), state: 'retired', rationale: input.rationale.trim(), updatedAt: new Date().toISOString() };
    await tx.objectStore('presentations').add({ id: `trace:relationship-history:${prior.id}:${ledger.version}`, recordType: 'traceability-relationship-history', scopeId: meta.config.scopeId, link: prior });
    await tx.objectStore('presentations').put({ ...ledger, links: [...ledger.links.filter(item => item.id !== prior.id), link], version: ledger.version + 1 }); return link;
  });
  const { source, target, rules } = checkRelationship(assessment.profile, assessment.nodes, input);
  if (input.state === 'confirmed' && (!input.reviewed || source.draft || target.draft || source.unresolved || target.unresolved)) throw Error('Confirm review using current, resolved saved endpoints.');
  return writeArtifactStorage(['metadata', 'presentations'], async tx => {
    const meta = await tx.objectStore('metadata').get(matrixId), ledger = await assertCurrent(tx, meta, assessment);
    const prior = input.id && ledger.links.find(link => link.id === input.id), native = assessment.edges.find(link => link.native && (input.id ? link.id === input.id : link.from === input.from && link.to === input.to && link.type === input.type));
    if (input.id && !prior && !native) throw Error('This relationship no longer exists.');
    const others = ledger.links.filter(link => link.id !== input.id && link.state !== 'retired');
    if (input.state !== 'retired') {
      if (others.some(link => link.from === input.from && link.to === input.to && link.type === input.type)) throw Error('This relationship already exists.');
      for (const rule of rules) for (const [endpoint, side] of [[source, 'Source'], [target, 'Target']]) {
        const maximum = rule[`max${side}`];
        const byId = new Map(assessment.nodes.map(node => [node.id, node]));
        if (maximum !== null && others.filter(link => link.type === input.type && (side === 'Source' ? link.from === endpoint.id : link.to === endpoint.id) && byId.has(link.from) && byId.has(link.to) && matchingRules(assessment.profile, byId.get(link.from), byId.get(link.to), link.type).some(item => item.id === rule.id)).length >= maximum) throw Error('This relationship exceeds the rule cardinality.');
      }
      if (input.type === 'derived-from') {
        const outgoing = new Map(); for (const edge of others.filter(link => link.type === input.type)) { if (!outgoing.has(edge.from)) outgoing.set(edge.from, []); outgoing.get(edge.from).push(edge.to); }
        const pending = [input.to], seen = new Set();
        while (pending.length) { const next = pending.pop(); if (next === input.from) throw Error('This relationship would create a derivation cycle.'); if (!seen.has(next)) { seen.add(next); pending.push(...outgoing.get(next) || []); } }
      }
    }
    const link = { id: prior?.id || newId(), from: input.from, to: input.to, type: input.type, rationale: input.rationale.trim(), state: input.state,
      ...(native || prior?.originId ? { originId: native?.id || prior.originId } : {}),
      sourceArtifactId: source.artifactId, targetArtifactId: target.artifactId, sourceHash: source.hash, targetHash: target.hash, sourceRevision: source.revision, targetRevision: target.revision,
      profile: meta.config.profile, reviewedAt: input.state === 'confirmed' ? new Date().toISOString() : null, updatedAt: new Date().toISOString() };
    const links = ledger.links.filter(item => item.id !== link.id); links.push(link);
    if (prior) await tx.objectStore('presentations').add({ id: `trace:relationship-history:${prior.id}:${ledger.version}`, recordType: 'traceability-relationship-history', scopeId: meta.config.scopeId, link: prior });
    await tx.objectStore('presentations').put({ ...ledger, links, version: ledger.version + 1 }); return link;
  });
}
export async function saveExclusion(matrixId, expected, row, rationale) {
  const assessment = await checkedAssessment(matrixId, expected), current = assessment.rows.find(item => item.id === row.id);
  if (!current?.nodeId || !rationale?.trim() || rationale.length > 4000) throw Error('A current object obligation and a reviewed rationale are required.');
  return writeArtifactStorage(['metadata', 'presentations'], async tx => {
    const meta = await tx.objectStore('metadata').get(matrixId), ledger = await assertCurrent(tx, meta, assessment);
    const exclusion = { id: row.id, ruleId: row.ruleId, ruleHash: semanticHash(assessment.profile.rules.find(rule => rule.id === row.ruleId)), nodeId: row.nodeId, side: row.side, hash: row.hash, rationale: rationale.trim(), reviewed: true, reviewedAt: new Date().toISOString() };
    await tx.objectStore('presentations').put({ ...ledger, version: ledger.version + 1, exclusions: [...ledger.exclusions.filter(item => item.id !== row.id), exclusion] });
  });
}
export async function removeExclusion(matrixId, expected, rowId) {
  const assessment = await checkedAssessment(matrixId, expected);
  return writeArtifactStorage(['metadata', 'presentations'], async tx => {
    const meta = await tx.objectStore('metadata').get(matrixId), ledger = await assertCurrent(tx, meta, assessment);
    await tx.objectStore('presentations').put({ ...ledger, version: ledger.version + 1, exclusions: ledger.exclusions.filter(item => item.id !== rowId) });
  });
}
export async function saveAssessment(id, expected) {
  const assessment = await checkedAssessment(id, expected);
  return writeArtifactStorage(['metadata', 'revisions', 'presentations'], async tx => {
    const meta = await tx.objectStore('metadata').get(id); await assertCurrent(tx, meta, assessment);
    if (meta.revision !== expected.matrixRevision) throw Error('Another assessment was saved. Reassess before saving a revision.');
    const number = meta.revision + 1, createdAt = new Date().toISOString();
    const objects = [...assessment.rows.map(row => ({ id: `${id}:${row.id}`, kind: 'narrative', title: row.Title || row.ID, text: `${row.Status}: ${row.Finding}`, parentId: null, sourceIds: [], attributes: { ...row, nodeId: undefined } })), ...(assessment.lineage?.rows || []).map(row => ({ id: `${id}:${row.id}`, kind: 'narrative', title: row.traceChainId, text: [...LINEAGE_STAGES.map(stage => row[stage.id]), row.safetyCarryForward, row.openIssues].filter(Boolean).join('\n'), sourceIds: [], parentId: null, attributes: { ...row, cellNodes: undefined } }))];
    const revision = { id: `${id}:${number}`, artifactId: id, projectId: meta.projectId, number, createdAt, reason: 'Saved traceability assessment', assessment, objects, sources: { entries: [] } };
    await tx.objectStore('revisions').add(revision); await tx.objectStore('metadata').put({ ...meta, revision: number, updatedAt: createdAt }); return revision;
  });
}
export async function baselineAssessment(id, expectedRevision, label, reviewed) {
  if (!reviewed || !label?.trim() || label.length > 200) throw Error('Review the assessment and enter a baseline name.');
  return writeArtifactStorage(['metadata', 'revisions', 'baselines'], async tx => {
    const meta = await tx.objectStore('metadata').get(id);
    if (!meta || meta.deleted || !meta.revision || meta.revision !== expectedRevision) throw Error('The saved assessment changed. Reload before creating a baseline.');
    const saved = (await tx.objectStore('revisions').get(`${id}:${expectedRevision}`))?.assessment;
    if (!saved || saved.rows.some(row => row.severity === 'error' && !['Covered', 'Excluded'].includes(row.Status)) || saved.findings.length) throw Error('Resolve error-level findings and invalid relationships before creating a reviewed baseline.');
    const record = { id: newId(), artifactId: id, projectId: meta.projectId, workspaceType: meta.workspaceType, revision: expectedRevision, label: label.trim(), reviewed: true, createdAt: new Date().toISOString() };
    await tx.objectStore('baselines').add(record); return record;
  });
}
