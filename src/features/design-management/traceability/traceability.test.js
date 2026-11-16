import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { randomUUID } from 'crypto';
import { consolidateHazardRows } from '../artifacts/consolidateHazardRows';
import { hazardIssueEvidenceHash } from '../artifacts/hazardIssueEvidence';
import { DEFAULT_PROFILE, clone, validateProfile, checkRelationship, profileKey } from './traceabilityModel';
import { semanticHash } from '../artifacts/artifactModel';
import { evaluateTraceability } from './traceabilityEvaluation';
import { profiles, publishProfile, getProfile, createMatrix, assessMatrix, saveRelationship, saveAssessment, configureMatrix, saveExclusion, assignment, assignProfile, baselineAssessment, suggestBindings, collectScope, assessConfiguration, traceCatalog } from './traceabilityRepository';
import { writeArtifactStorage, readArtifactStorage, loadArtifact } from '../artifacts/artifactRepository';

beforeEach(() => {
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID } });
  localStorage.clear(); localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Controller' }]));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Specifications', modules: [] }]));
});
const node = (id, role, extra = {}) => ({ id, objectId: id, artifactId: id, artifactTitle: id, title: id, roles: [role], hash: id, ...extra });
const selection = { id: DEFAULT_PROFILE.id, version: 1 };
const ruleOnly = (...ids) => ({ ...clone(DEFAULT_PROFILE), rules: clone(DEFAULT_PROFILE.rules.filter(rule => ids.includes(rule.id))) });
const source = node('s', 'software'), parent = node('p', 'system'), lower = node('sub', 'subsystem');
const linked = (from = source, to = parent, extra = {}) => ({ id: 'l', from: from.id, to: to.id, type: 'derived-from', state: 'confirmed', sourceHash: from.hash, targetHash: to.hash, profile: selection, rationale: 'Reviewed origin', ...extra });
const evaluate = (profile, nodes, links = [], extra = {}) => evaluateTraceability({ profile, nodes, links, availability: Object.fromEntries(profile.roles.map(role => [role.id, { ready: nodes.some(node => node.roles.includes(role.id)) }])), ...extra });

const bindingCatalog = [
  { id: 'standalone', templateId: 'system-spec', projectId: 'p', workspaceType: 'code-architecture' },
  { id: 'member-a', templateId: 'software-spec', programId: 'se-project:a', projectId: 'se-project:a', workspaceType: 'systems-engineering', config: { projectId: 'p', workspaceType: 'code-architecture', programId: 'se-project:a' } },
  { id: 'member-b', templateId: 'software-spec', programId: 'se-project:b', projectId: 'se-project:b', workspaceType: 'systems-engineering', config: { ownerProjects: [{ id: 'other', workspaceType: 'functional' }, { id: 'p', workspaceType: 'code-architecture' }] } },
  { id: 'same-id-other-workspace', templateId: 'system-spec', projectId: 'p', workspaceType: 'functional' },
  { id: 'unrelated', templateId: 'system-spec', projectId: 'other', workspaceType: 'code-architecture', folderId: 'same-folder' },
  { id: 'deleted', templateId: 'system-spec', projectId: 'p', workspaceType: 'code-architecture', deleted: true },
];
test('role suggestions find standalone and engineering-project artifacts through exact underlying owners', () => {
  const bindings = suggestBindings(DEFAULT_PROFILE, bindingCatalog, { id: 'p', workspaceType: 'code-architecture' });
  expect(bindings.system).toEqual(['standalone']); expect(bindings.software).toEqual(['member-a', 'member-b']);
});
test('matrix configuration suggestions do not match missing IDs or unrelated source projects', () => {
  const bindings = suggestBindings(DEFAULT_PROFILE, bindingCatalog, { projectId: 'p', workspaceType: 'code-architecture', scopeId: 'code-architecture:p' });
  expect(bindings.system).toEqual(['standalone']); expect(bindings.software).toEqual(['member-a', 'member-b']);
  expect(Object.values(suggestBindings(DEFAULT_PROFILE, bindingCatalog, null)).flat()).toEqual([]);
  expect(Object.values(suggestBindings(DEFAULT_PROFILE, bindingCatalog, {})).flat()).toEqual([]);
});
test('engineering-project suggestions stay within the selected program, including when configuring its matrix', () => {
  for (const owner of [{ id: 'se-project:a', recordType: 'systems-engineering-project', ownerProjects: [{ id: 'p', workspaceType: 'code-architecture' }] }, { scopeId: 'se-project:a', projectId: 'p', workspaceType: 'code-architecture' }]) {
    const bindings = suggestBindings(DEFAULT_PROFILE, bindingCatalog, owner);
    expect(bindings.software).toEqual(['member-a']); expect(bindings.system).toEqual([]);
  }
});

test('the built-in profile is valid; published versions cannot be overwritten or mutated by readers', async () => {
  expect(validateProfile(DEFAULT_PROFILE)).toBe(DEFAULT_PROFILE);
  const input = clone(DEFAULT_PROFILE); input.name = 'Customer profile';
  const first = await publishProfile(input), second = await publishProfile({ ...first, name: 'Customer revised' }, { id: first.id, expectedVersion: 1 });
  expect(second.version).toBe(2); expect((await getProfile(first)).name).toBe('Customer profile');
  expect((await profiles()).map(profileKey)).toHaveLength(3);
  await expect(publishProfile(input, { id: first.id, expectedVersion: 1 })).rejects.toThrow(/another window/);
  await expect(publishProfile(input, { id: DEFAULT_PROFILE.id })).rejects.toThrow(/Duplicate/);
});
test.each([
  profile => { profile.rules[0].to = ['unknown']; },
  profile => { profile.rules.push({ ...profile.rules[0], id: 'overlap' }); },
  profile => { profile.rules[0].maxSource = 0; },
  profile => { profile.rules[0].allowed = false; },
  profile => { profile.roles[0].kinds = []; },
  profile => { profile.roles[0].id = '__proto__'; },
])('invalid imported profile definitions are rejected', mutate => { const profile = clone(DEFAULT_PROFILE); mutate(profile); expect(() => validateProfile(profile)).toThrow(); });
test('rules enforce exact role direction and preserve OR targets', () => {
  expect(checkRelationship(DEFAULT_PROFILE, [source, parent], linked()).source).toBe(source);
  expect(() => checkRelationship(DEFAULT_PROFILE, [source, parent], { from: parent.id, to: source.id, type: 'derived-from' })).toThrow(/not allowed/);
  expect(() => checkRelationship(DEFAULT_PROFILE, [source], linked())).toThrow(/endpoints/);
  expect(() => checkRelationship(DEFAULT_PROFILE, [source], { from: 's', to: 's', type: 'related-to' })).toThrow(/itself/);
});
test('OR target roles form one obligation; separate rules form AND obligations', async () => {
  const profile = ruleOnly('software-origin');
  const result = await evaluate(profile, [source, parent, lower], [linked()]);
  expect(result.rows).toHaveLength(1); expect(result.rows[0].Status).toBe('Covered');
  profile.rules.push({ ...profile.rules[0], id: 'software-safety', to: ['safety'] });
  const next = await evaluate(profile, [source, parent, lower], [linked()]);
  expect(next.rows.map(row => row.Status)).toEqual(['Covered', 'Not assessed']);
});
test('empty populations and unavailable counterpart evidence never produce covered results', async () => {
  const profile = ruleOnly('software-origin');
  expect((await evaluate(profile, [])).summary).toEqual({ 'Not assessed': 1 });
  expect((await evaluate(profile, [source])).rows[0].Status).toBe('Not assessed');
});
test.each([
  [{ state: 'proposed' }, 'Proposed'], [{ sourceHash: 'old' }, 'Suspect'], [{ profile: { id: 'old-profile', version: 1 } }, 'Suspect'],
  [{ state: 'unrecognized' }, 'Missing'],
])('review state and changed identity affect coverage', async (patch, status) => {
  const result = await evaluate(ruleOnly('software-origin'), [source, parent], [linked(source, parent, patch)]);
  expect(result.rows[0].Status).toBe(status);
  if (patch.state === 'unrecognized') expect(result.findings).toHaveLength(1);
});
test('draft endpoints never establish confirmed coverage; stage requirements are conditional', async () => {
  const draft = { ...source, draft: true };
  expect((await evaluate(ruleOnly('software-origin'), [draft, parent], [linked(draft)])).rows[0].Status).toBe('Not assessed');
  expect((await evaluate(ruleOnly('requirement-design'), [parent], [], { stage: 'definition' })).rows).toHaveLength(0);
  expect((await evaluate(ruleOnly('requirement-design'), [parent], [], { stage: 'design' })).rows[0].Status).toBe('Not assessed');
});
test('cardinality is evaluated separately on source and target endpoints', async () => {
  const profile = ruleOnly('software-origin'); profile.rules[0].maxSource = 1; profile.rules[0].minTarget = 1;
  const result = await evaluate(profile, [source, parent, lower], [linked(), linked(source, lower, { id: 'l2' })]);
  expect(result.rows.find(row => row.side === 'source').Status).toBe('Invalid');
  expect(result.rows.filter(row => row.side === 'target').map(row => row.Status)).toEqual(['Covered', 'Covered']);
});
test('reviewed exclusions are separate and become stale after rule or object changes', async () => {
  const profile = ruleOnly('software-origin'), exclusion = { reviewed: true, rationale: 'Allocation excluded', ruleId: 'software-origin', nodeId: source.id, side: 'source', hash: source.hash, ruleHash: semanticHash(profile.rules[0]) };
  expect((await evaluate(profile, [source, parent], [], { exclusions: [exclusion] })).rows[0].Status).toBe('Excluded');
  profile.rules[0].minSource = 2;
  expect((await evaluate(profile, [source, parent], [], { exclusions: [exclusion] })).rows[0].Status).toBe('Missing');
});
test('evaluation yields and can be cancelled during a large object population', async () => {
  const controller = new AbortController(); let yields = 0;
  await expect(evaluateTraceability({ profile: ruleOnly('software-origin'), nodes: [...Array.from({ length: 26000 }, (_, i) => node(`r${i}`, 'software')), parent], availability: { system: { ready: true } } }, { signal: controller.signal, yieldEvery: 100, onProgress: () => { yields++; controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
  expect(yields).toBeGreaterThan(0);
});

const programId = 'se-project:fixture';
async function projectMembers(ids) {
  return writeArtifactStorage(['metadata'], async tx => {
    const store = tx.objectStore('metadata'), before = await store.get(programId);
    const members = [...(before?.members || [])];
    for (const id of ids) {
      const meta = await store.get(id);
      await store.put({ ...meta, programId, projectId: programId, workspaceType: 'systems-engineering' });
      if (!members.some(member => member.id === id)) members.push({ id, config: meta.config, dependsOn: [] });
    }
    const program = { ...before, id: programId, title: 'Controller engineering', recordType: 'systems-engineering-project', folderId: 'f', ownerProjects: [{ id: 'p', workspaceType: 'functional' }], config: { projectId: 'p', workspaceType: 'functional', system: 'Controller' }, members, version: (before?.version || 0) + 1, state: 'draft' };
    await store.put(program); return program;
  });
}
async function seed() {
  await writeArtifactStorage(['metadata', 'revisions'], async tx => {
    for (const [id, templateId, text] of [['sys', 'system-spec', 'The controller shall reject invalid commands.'], ['sw', 'software-spec', 'The software shall reject commands with an invalid checksum.']]) {
      const config = { projectId: 'p', workspaceType: 'functional', folderId: 'f', system: 'Controller', sources: [], notes: text };
      await tx.objectStore('metadata').put({ id, templateId, projectId: 'p', workspaceType: 'functional', title: id, folderId: 'f', config, revision: 1 });
      await tx.objectStore('revisions').put({ id: `${id}:1`, artifactId: id, number: 1, objects: [{ id: `${id}:req`, title: `${id} requirement`, text, kind: 'requirement', sourceIds: ['notes'] }, { id: `${id}:section`, title: 'Heading', kind: 'section', sourceIds: [] }], sources: { entries: [] } });
    }
  });
  await projectMembers(['sys', 'sw']);
  const config = { title: 'Matrix', projectId: 'p', workspaceType: 'functional', folderId: 'f', system: 'Controller', scopeId: programId, stage: 'definition', profile: selection, bindings: { software: ['sw'], system: ['sys'] } };
  return createMatrix(config);
}
test('matrix persistence includes unlinked requirements and preserves citations solely as provenance', async () => {
  const id = await seed(), assessment = await assessMatrix(id);
  expect(assessment.nodes).toHaveLength(2); expect(assessment.provenance).toHaveLength(2); expect(assessment.edges).toHaveLength(0);
  expect(assessment.rows.find(row => row.Rule === 'software-origin').Status).toBe('Missing');
  const from = assessment.nodes.find(node => node.artifactId === 'sw'), to = assessment.nodes.find(node => node.artifactId === 'sys');
  await saveRelationship(id, assessment, { from: from.id, to: to.id, type: 'derived-from', state: 'confirmed', reviewed: true, rationale: 'Reviewed software allocation' });
  const linkedAssessment = await assessMatrix(id); expect(linkedAssessment.rows.find(row => row.Rule === 'software-origin').Status).toBe('Covered');
  await saveAssessment(id, linkedAssessment);
  const saved = await loadArtifact(id); expect(saved.meta.revision).toBe(1); expect(saved.revision.assessment.profile).toEqual(DEFAULT_PROFILE);
  const sourceRevision = await readArtifactStorage(db => db.get('revisions', 'sw:1')); expect(sourceRevision.objects[0].sourceIds).toEqual(['notes']);
});
test('stale relationship and assessment writes fail and old snapshots stay immutable', async () => {
  const id = await seed(), original = await assessMatrix(id); await saveAssessment(id, original);
  const current = await assessMatrix(id), from = current.nodes.find(node => node.artifactId === 'sw'), to = current.nodes.find(node => node.artifactId === 'sys');
  const link = await saveRelationship(id, current, { from: from.id, to: to.id, type: 'derived-from', state: 'proposed', rationale: 'Candidate' });
  await expect(saveAssessment(id, current)).rejects.toThrow(/changed/);
  expect((await loadArtifact(id)).revision.assessment.edges).toHaveLength(0);
  const fresh = await assessMatrix(id); await saveRelationship(id, fresh, { ...link, state: 'confirmed', reviewed: true });
  await writeArtifactStorage(['metadata', 'revisions'], async tx => { const meta = await tx.objectStore('metadata').get('sys'), revision = await tx.objectStore('revisions').get('sys:1'); await tx.objectStore('metadata').put({ ...meta, revision: 2 }); await tx.objectStore('revisions').put({ ...revision, id: 'sys:2', number: 2, objects: revision.objects.map(object => object.kind === 'requirement' ? { ...object, text: 'The controller shall reject invalid commands within 10 ms.' } : object) }); });
  expect((await assessMatrix(id)).edges[0].state).toBe('suspect');
  const now = await assessMatrix(id); await saveRelationship(id, now, { ...now.edges[0], state: 'retired', rationale: 'Superseded' });
  expect((await assessMatrix(id)).edges).toHaveLength(0);
  expect((await readArtifactStorage(db => db.getAll('presentations'))).filter(row => row.recordType === 'traceability-relationship-history')).toHaveLength(2);
});
test('profile selection is pinned per project and matrix overrides do not overwrite it', async () => {
  const id = await seed(), profile = await publishProfile({ ...clone(DEFAULT_PROFILE), name: 'Customer rules' });
  await assignProfile('functional:p', 0, { id: profile.id, version: 1 }, { software: ['sw'] });
  expect((await assignment('functional:p')).selection.id).toBe(profile.id);
  expect((await assessMatrix(id)).profile.id).toBe(DEFAULT_PROFILE.id);
  const meta = (await loadArtifact(id)).meta;
  await configureMatrix(id, 0, { ...meta.config, profile: { id: profile.id, version: 1 } });
  await expect(configureMatrix(id, 0, meta.config)).rejects.toThrow(/changed/);
  expect((await assessMatrix(id)).profile.id).toBe(profile.id);
});
test('source changes and exclusions use canonical identities rather than displayed labels or filters', async () => {
  const id = await seed(), assessment = await assessMatrix(id), row = assessment.rows.find(row => row.Rule === 'software-origin');
  await saveExclusion(id, assessment, row, 'This software allocation is outside this release.');
  expect((await assessMatrix(id)).rows.find(row => row.Rule === 'software-origin').Status).toBe('Excluded');
  await expect(saveExclusion(id, assessment, row, 'Stale')).rejects.toThrow(/changed/);
});


test('HTR scope evaluates consolidated issues, retaining navigation into original assessment evidence', async () => {
  const id = await seed();
  const rows = Array.from({ length: 1200 }, (_, index) => ({ id: `hazard-${index}`, sectionId: 's2', kind: 'narrative', hazardTrackingRow: true, attributes: { Hazard: 'Unintended vehicle motion', Function: 'Control motion', 'Guide Phrase Applicable': 'Yes', 'Safety Constraint': 'The controller shall reject invalid commands.' } }));
  const group = consolidateHazardRows(rows)[0];
  const section = { id: 'htl:s2', kind: 'section', sectionId: 's2', hazardIssueSummaries: { [group.id]: { title: 'Invalid commands cause unintended motion', description: 'Invalid commands can cause unexpected motion. Reject invalid commands.', evidenceHash: hazardIssueEvidenceHash(group) } } };
  await writeArtifactStorage(['metadata', 'revisions'], async tx => {
    await tx.objectStore('metadata').put({ id: 'htl', title: 'Controller HTL', templateId: 'hazard-tracking-list', projectId: 'p', workspaceType: 'functional', config: { projectId: 'p', workspaceType: 'functional' }, revision: 1 });
    await tx.objectStore('revisions').put({ id: 'htl:1', artifactId: 'htl', number: 1, objects: [section, ...rows], sources: { entries: [] } });
  });
  await projectMembers(['htl']);
  const meta = (await loadArtifact(id)).meta;
  await configureMatrix(id, 0, { ...meta.config, bindings: { ...meta.config.bindings, htr: ['htl'] } });
  const assessed = await assessMatrix(id), htrs = assessed.nodes.filter(node => node.kind === 'htr');
  expect(htrs).toHaveLength(1); expect(htrs[0].displayId).toBe('HTR-1'); expect(htrs[0].navigateId).toBe('hazard-0');
  expect(assessed.nodes.some(node => node.objectId === 'hazard-1199')).toBe(false);
});

test('a project matrix automatically computes the full saved derivation chain without role bindings', async () => {
  const fd = { id: 'fd-1', kind: 'architecture-element', title: 'Controller → command → Actuator', sourceIds: ['fd-source'], sourceEvidence: [{ id: 'fd-source', sourceType: 'architecture-element', elementType: 'edge', elementId: 'functional-1', workspaceType: 'functional', projectId: 'p' }] };
  const row = { id: 'ha-1', kind: 'narrative', sectionId: 's2', hazardTrackingRow: true, attributes: { Hazard: 'Invalid command causes unintended motion', Function: 'Controller → command → Actuator', 'Guide Phrase Applicable': 'Yes', 'Safety Constraint': 'The controller shall reject invalid commands.' }, sourceEvidence: [{ id: 'ha-source', sourceType: 'hazard-analysis-row', functionalTraceId: 'functional-1', workspaceType: 'functional', projectId: 'p' }] };
  const group = consolidateHazardRows([row])[0];
  const htl = [{ id: 'htl:s2', kind: 'section', sectionId: 's2', hazardIssueSummaries: { [group.id]: { title: 'Invalid commands cause unintended motion', description: 'Reject invalid commands.', evidenceHash: hazardIssueEvidenceHash(group) } } }, row];
  const cite = (artifactId, object) => ({ id: `artifact-object:${artifactId}:${object.id}`, sourceType: 'artifact-object', artifactId, objectId: object.id, revision: 1, contentHash: semanticHash(object) });
  const safety = { id: 'safe-1', kind: 'requirement', text: 'The controller shall reject invalid commands.', sourceEvidence: [{ id: `hazard-tracking-record:htl:${group.recordId}`, sourceType: 'hazard-tracking-record', artifactId: 'htl', recordId: group.recordId, revision: 1 }] };
  const system = { id: 'sys-1', kind: 'requirement', text: safety.text, sourceEvidence: [cite('safety', safety)] };
  const software = { id: 'sw-1', kind: 'requirement', text: safety.text, sourceEvidence: [cite('system', system)] };
  const hardware = { id: 'hw-1', kind: 'requirement', text: safety.text, sourceEvidence: [cite('system', system)] };
  const subsystem = { id: 'sub-1', kind: 'requirement', text: safety.text, sourceEvidence: [cite('system', system)] };
  const design = { id: 'des-1', kind: 'narrative', title: 'Command gate', text: 'The command gate rejects invalid commands.', sourceEvidence: [cite('subsystem', subsystem), cite('software', software), cite('hardware', hardware)] };
  await writeArtifactStorage(['metadata', 'revisions'], async tx => {
    for (const [id, templateId, objects] of [['fd', 'architecture', [fd]], ['htl', 'hazard-tracking-list', htl], ['safety', 'safety-requirements', [safety]], ['system', 'system-spec', [system]], ['software', 'software-spec', [software]], ['hardware', 'hardware-spec', [hardware]], ['subsystem', 'subsystem-spec', [subsystem]], ['design', 'system-design', [design]]]) {
      await tx.objectStore('metadata').put({ id, title: id, templateId, projectId: 'p', workspaceType: 'functional', revision: 1, config: { projectId: 'p', workspaceType: 'functional' } });
      await tx.objectStore('revisions').put({ id: `${id}:1`, artifactId: id, number: 1, objects, sources: { entries: [] } });
    }
  });
  await projectMembers(['fd', 'htl', 'safety', 'system', 'software', 'hardware', 'subsystem', 'design']);
  const id = await createMatrix({ title: 'End-to-end trace', folderId: 'f', system: 'Controller', projectId: 'p', workspaceType: 'functional', scopeId: programId, stage: 'definition' });
  const assessed = await assessMatrix(id);
  expect(assessed.lineage.summary).toEqual({ chains: 1, complete: 1, open: 0 });
  expect(assessed.lineage.stageCounts).toEqual({ functional: 1, hazard: 1, safety: 1, system: 1, software: 1, hardware: 1, subsystem: 1, design: 1 });
  await saveAssessment(id, assessed);
  const saved = await loadArtifact(id); expect(saved.revision.assessment.lineage.summary.complete).toBe(1); expect(saved.revision.objects.some(object => object.id.includes(':lineage:'))).toBe(true);
});

test('legacy role binding resolves module names to immutable module IDs', async () => {
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'folder:1', name: 'Legacy', modules: [{ id: 'module:1', name: 'Commands' }] }]));
  localStorage.setItem('xhandle:requirements', JSON.stringify([{ id: 'r', projectId: 'folder:1', module: 'Commands', title: 'The controller shall stop.', attributes: {}, links: [] }]));
  const config = { title: 'Legacy matrix', projectId: 'p', workspaceType: 'functional', folderId: 'f', system: 'Controller', scopeId: 'functional:p', stage: 'definition', profile: selection, bindings: { system: ['module:' + JSON.stringify(['folder:1', 'module:1'])] } };
  const result = await collectScope(config, DEFAULT_PROFILE); expect(result.nodes).toHaveLength(1); expect(result.nodes[0].objectId).toBe('r');
});


test('SysML verification role reads the selected model elements rather than catalog summaries', async () => {
  localStorage.setItem('xhandle.designManagement.sysmlV2.models', JSON.stringify([{ id: 'model', name: 'Controller verification', version: 1, elements: [{ id: 'case', name: 'Checksum verification', type: 'VerificationCase', description: 'Inspect invalid-command rejection.' }], relationships: [], traceLinks: [], metadata: {}, diagrams: {} }]));
  const config = { title: 'Verification matrix', projectId: 'p', workspaceType: 'functional', folderId: 'f', system: 'Controller', scopeId: 'functional:p', stage: 'verification', profile: selection, bindings: { verification: ['sysml:model'] } };
  const result = await collectScope(config, DEFAULT_PROFILE); expect(result.nodes).toHaveLength(1); expect(result.nodes[0]).toMatchObject({ kind: 'verification', objectId: 'case', title: 'Checksum verification' });
});


test('existing typed source links are proposed and can be adopted after review without rewriting the module', async () => {
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Legacy', modules: [{ id: 'software-module', name: 'Software' }, { id: 'system-module', name: 'System' }] }]));
  const rows = [{ id: 'software-req', projectId: 'f', module: 'Software', title: 'The software shall reject invalid commands.', attributes: {}, links: [{ toId: 'system-req', type: 'derives' }, { toId: 'system-req', type: 'refines' }] }, { id: 'system-req', projectId: 'f', module: 'System', title: 'The controller shall reject invalid commands.', attributes: {}, links: [] }];
  localStorage.setItem('xhandle:requirements', JSON.stringify(rows));
  const config = { title: 'Legacy matrix', projectId: 'p', workspaceType: 'functional', folderId: 'f', system: 'Controller', scopeId: 'functional:p', stage: 'definition', profile: selection, bindings: { system: ['module:' + JSON.stringify(['f', 'system-module'])], software: ['module:' + JSON.stringify(['f', 'software-module'])] } };
  const result = await collectScope(config, DEFAULT_PROFILE); expect(result.imported).toHaveLength(1); expect(result.imported[0]).toMatchObject({ native: true, state: 'proposed', type: 'derived-from' });
  expect(JSON.parse(localStorage.getItem('xhandle:requirements'))).toEqual(rows);
});


test('reviewed baseline gates error-level missing or unavailable obligations without changing requirement approval', async () => {
  const id = await seed(), custom = clone(DEFAULT_PROFILE); custom.name = 'Required origin'; custom.rules = [custom.rules.find(rule => rule.id === 'software-origin')]; custom.rules[0].severity = 'error';
  const profile = await publishProfile(custom), meta = (await loadArtifact(id)).meta;
  await configureMatrix(id, 0, { ...meta.config, profile: { id: profile.id, version: 1 } });
  const assessment = await assessMatrix(id); await saveAssessment(id, assessment);
  await expect(baselineAssessment(id, 1, 'Release', true)).rejects.toThrow(/error-level/);
  const current = await assessMatrix(id); await saveExclusion(id, current, current.rows[0], 'Documented release exclusion'); await saveAssessment(id, await assessMatrix(id));
  await expect(baselineAssessment(id, 2, 'Reviewed release', true)).resolves.toMatchObject({ revision: 2, reviewed: true });
  const source = await readArtifactStorage(db => db.get('revisions', 'sw:1')); expect(source.objects[0].status).toBeUndefined();
});


test('matrices require a live Design Management project and are saved as its artifacts', async () => {
  const config = { title: 'Matrix', folderId: 'f', system: 'Controller', scopeId: 'functional:p', stage: 'definition' };
  await expect(createMatrix(config)).rejects.toThrow('Design Management project');
  const id = await seed(), meta = (await loadArtifact(id)).meta;
  expect(meta).toMatchObject({ programId, projectId: programId, workspaceType: 'systems-engineering' });
  const program = await readArtifactStorage(db => db.get('metadata', programId));
  expect(program.members.find(member => member.id === id)).toMatchObject({ dependsOn: [], config: { templateId: 'traceability-matrix', scopeId: programId } });
  expect((await traceCatalog(programId)).map(meta => meta.id)).toEqual(expect.arrayContaining(['sys', 'sw']));
  expect((await traceCatalog(programId)).some(meta => meta.id === id)).toBe(false);
});

test('creation, configuration and refresh reject external, standalone and unregistered project inputs', async () => {
  const id = await seed(), config = (await loadArtifact(id)).meta.config;
  await writeArtifactStorage(['metadata'], async tx => {
    const store = tx.objectStore('metadata'), original = await store.get('sw');
    await store.put({ ...original, id: 'external', programId: 'other-program' });
    await store.put({ ...original, id: 'standalone', programId: undefined });
    await store.put({ ...original, id: 'unregistered' });
  });
  for (const external of ['external', 'standalone', 'unregistered', 'module:legacy', 'sysml:model', id]) {
    const forged = { ...config, lineageSources: ['sw', external] };
    await expect(createMatrix(forged)).rejects.toThrow('inputs must be artifacts in this');
    await expect(configureMatrix(id, 0, forged)).rejects.toThrow('inputs must be artifacts in this');
    await expect(assessConfiguration(forged)).rejects.toThrow('inputs must be artifacts in this');
    await expect(assessConfiguration({ ...config, bindings: { software: [external] } })).rejects.toThrow('inputs must be artifacts in this');
  }
  const catalog = await traceCatalog(programId);
  expect(catalog.map(meta => meta.id).sort()).toEqual(['sw', 'sys']);
  await expect(configureMatrix(id, 0, { ...config, scopeId: 'other-program' })).rejects.toThrow('containing Design Management project');
});

test('automatic inputs follow project membership and old saved snapshots remain unchanged', async () => {
  const id = await seed(), first = await assessMatrix(id); await saveAssessment(id, first);
  await writeArtifactStorage(['metadata', 'revisions'], async tx => {
    const store = tx.objectStore('metadata'), meta = await store.get('sw');
    await store.put({ ...meta, id: 'new-software' });
    await tx.objectStore('revisions').put({ id: 'new-software:1', number: 1, objects: [{ id: 'new-req', kind: 'requirement', text: 'The controller shall stop on an invalid command.' }] });
  });
  expect((await assessMatrix(id)).nodes.some(node => node.artifactId === 'new-software')).toBe(false);
  await projectMembers(['new-software']);
  const next = await assessMatrix(id);
  expect(next.nodes.some(node => node.artifactId === 'new-software')).toBe(true);
  await expect(saveAssessment(id, first)).rejects.toThrow('changed');
  expect((await loadArtifact(id)).revision.assessment.nodes.some(node => node.artifactId === 'new-software')).toBe(false);
});
