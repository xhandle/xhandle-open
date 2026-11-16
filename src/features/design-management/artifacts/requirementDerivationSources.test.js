import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { randomUUID, webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import { createArtifact, loadArtifact, acceptProposal, openArtifactDatabase } from './artifactRepository';
import { captureLiveSources, artifactStorageSnapshot } from './artifactSources';
import { generateArtifact } from './artifactGeneration';
import { getTemplate, semanticHash } from './artifactModel';
import { planEngineeringProject } from './engineeringProjectModel';
import { beginEngineeringGeneration, createEngineeringProject, acceptEngineeringProject, loadEngineeringProject, addArtifactToEngineeringProject } from './engineeringProjectRepository';
import { generateEngineeringProject } from './engineeringProjectGeneration';
import { writeCbaRowsToIndexedDB } from '../../code-architecture-assurance/codeArchitectureStorage';
import { contentGuidance } from './artifactContentGuidance';
import { updateArchitectureSources } from './architectureSourceUpdates';
import { saveProjectHazardAnalysisRecord } from '../../project-hazard-analysis/projectHazardAnalysisStorage';
import { saveCodeArchitectureHazardRun } from '../../code-architecture-hazard-analysis/codeArchitectureHazardStore';
import { captureSavedSafetyRequirementSources } from './hazardAnalysisSources';

jest.mock('../../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: {} }) }));
const config = templateId => ({ templateId, title: getTemplate(templateId).name, projectId: 'p', workspaceType: 'functional', system: 'Controller', folderId: 'f', sources: [], architectureSources: [] });
const object = { id: 'system-r1', kind: 'requirement', title: '', text: 'The controller shall reject commands older than 100 ms.', sourceIds: ['fd:command'], sourceEvidence: [{ id: 'fd:command', sourceType: 'architecture-element', snapshot: { large: 'x'.repeat(100000) } }] };
async function seed({ id = 'system', system = 'Controller', projectId = 'p', programId, revision = 1, objects = [object], job, deleted } = {}) {
  const db = await openArtifactDatabase();
  const meta = { id, templateId: 'system-spec', title: `${system} System Requirements`, revision, programId, deleted, config: { ...config('system-spec'), system, projectId } };
  await db.put('metadata', meta);
  if (revision) await db.put('revisions', { id: `${id}:${revision}`, artifactId: id, number: revision, objects });
  if (job) await db.put('jobs', { id, artifactId: id, baseRevision: revision, ...job });
  db.close();
  return meta;
}
beforeEach(() => {
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID, subtle: webcrypto.subtle, getRandomValues: array => webcrypto.getRandomValues(array) } });
  global.TextEncoder = TextEncoder;
  localStorage.clear(); localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Controller' }, { id: 'other', name: 'Other' }]));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Specifications', modules: [] }]));
});

const functionalDiagram = { projectId: 'p', workspaceType: 'functional' };
const codeDiagram = { projectId: 'c', workspaceType: 'code-architecture', repoId: 'repo', abstraction: 'csu' };
async function seedDiagrams() {
  localStorage.setItem('xhandle.projectData', JSON.stringify({ p: { responseRows: [{ id: 'system-exchange', fromFunction: 'Operator', controlAction: 'Motion command', toFunction: 'Controller', controlDetails: 'Reject stale motion commands.' }] } }));
  localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([{ id: 'c', name: 'Controller code', repos: [{ id: 'repo', repoName: 'controller' }] }]));
  await writeCbaRowsToIndexedDB('cba:c:repo', [{ traceId: 'code-exchange', fromFunction: 'Validate command', toFunction: 'Publish command', controlAction: 'Validated command', fromNodeId: 'validate', toNodeId: 'publish' }]);
}
const draftRequirement = args => {
  const source = args.sources.entries.find(source => source.sourceType === 'artifact-object' && source.kind === 'requirement')
    || args.sources.entries.find(source => source.sourceType === 'architecture-element' && source.elementType === 'edge')
    || args.sources.entries.find(source => source.sourceType === 'architecture-element');
  return { objects: [{ key: 'command-age', kind: args.section.id === 's2' ? 'requirement' : 'narrative', title: 'Command age', text: 'The controller shall reject motion commands older than 100 ms.', sourceIds: [source.id] }] };
};
const projectSafety = 'The controller shall inhibit motion while the operator emergency stop is active.';
const codeSafety = 'The command validator shall reject commands older than 100 ms.';
async function seedSafety() {
  await saveProjectHazardAnalysisRecord('p', { method: 'STPA-Textbook', analysisResult: { Summary: [
    ['Raw Analysis Row ID', 'System Requirement', 'Safety Significant', 'Safety Classification'],
    ['PROJECT-SAFE', projectSafety, 'Yes', 'Safety — Direct'],
  ] } });
  await saveCodeArchitectureHazardRun({ id: 'code-hazard', projectId: 'c', repoId: 'repo', runState: 'complete', hazardMethod: 'STPA', generatedSheets: { Summary: [
    ['Raw Analysis Row ID', 'Software Safety Requirement', 'Safety Significant', 'ASIL'],
    ['CODE-SAFE', codeSafety, 'Yes', 'D'],
  ] } });
}
test.each(['functional', 'code', 'mixed'])('%s carries saved hazard obligations into the correct root and safety flags through the published requirements chain', async mode => {
  await seedDiagrams(); await seedSafety();
  const architectureSources = mode === 'functional' ? [functionalDiagram] : mode === 'code' ? [codeDiagram] : [functionalDiagram, codeDiagram];
  const id = await createEngineeringProject({ name: `Safety ${mode}`, owners: architectureSources.map(diagram => ({ id: diagram.projectId, workspaceType: diagram.workspaceType })), system: 'Controller', folderId: 'f', architectureSources, artifacts: [{ templateId: 'software-spec' }, { templateId: 'hardware-spec' }] });
  await generateEngineeringProject(id, { request: async args => {
    const parent = args.sources.entries.find(entry => entry.sourceType === 'artifact-object' && entry.attributes?.['Safety Significant'] === 'Yes');
    // The root model deliberately omits the existing safety obligation. It
    // must still survive the real generation/checkpoint/publication pipeline.
    return parent && args.section.id === 's2' ? { objects: [{ key: 'derived-safety', kind: 'requirement', title: 'Command validation', text: 'The controller shall inhibit motion after detecting an invalid command.', sourceIds: [parent.id] }] } : draftRequirement(args);
  } });
  const { program, records } = await loadEngineeringProject(id);
  const first = records[0], second = records[1];
  expect(first.job.sources.entries.filter(entry => entry.sourceType === 'hazard-derived-requirement').map(entry => entry.text)).toEqual([mode === 'functional' ? projectSafety : codeSafety]);
  const rootSafety = Object.values(first.job.sections).flat().find(object => object.text === (mode === 'functional' ? projectSafety : codeSafety));
  expect(rootSafety).toMatchObject({ kind: 'requirement', recordedSafetyRequirement: true, attributes: { 'Safety Significant': 'Yes' } });
  const inherited = Object.values(second.job.sections).flat().find(object => object.key === 'derived-safety');
  expect(inherited.attributes['Safety Significant']).toBe('Yes');
  expect(inherited.sourceEvidence).toContainEqual(expect.objectContaining({ artifactId: first.meta.id, objectId: rootSafety.id, attributes: expect.objectContaining({ 'Safety Significant': 'Yes' }) }));
  if (mode === 'mixed') expect(Object.values(second.job.sections).flat()).toContainEqual(expect.objectContaining({ text: projectSafety, attributes: expect.objectContaining({ 'Safety Significant': 'Yes' }) }));
  await acceptEngineeringProject(id, program.version, program.runToken);
  const published = await loadEngineeringProject(id);
  expect(published.records.every(record => record.revision.objects.some(object => object.kind === 'requirement' && object.attributes?.['Safety Significant'] === 'Yes'))).toBe(true);
  if (mode !== 'functional') expect(published.records[2].revision.objects.some(object => object.attributes?.['Source ASIL'] === 'D')).toBe(true);
});
test('optional saved analysis is minimal, paged code rows preserve provenance, and a safety edit invalidates a completed proposal', async () => {
  await seedDiagrams();
  expect(await captureSavedSafetyRequirementSources([{ id: 'p', workspaceType: 'functional' }])).toEqual([]);
  await seedSafety();
  await saveCodeArchitectureHazardRun({ id: 'code-hazard', projectId: 'c', repoId: 'repo', runState: 'complete', hazardMethod: 'STPA', generatedSheets: { Summary: [
    ['Raw Analysis Row ID', 'Software Safety Requirement', 'Safety Significant', 'Internal diagnostics'],
    ...Array.from({ length: 125 }, (_, index) => [`CODE-${index}`, codeSafety, 'Yes', 'Do not copy this payload']),
  ] } });
  const sources = await captureSavedSafetyRequirementSources([{ id: 'c', workspaceType: 'code-architecture' }]);
  expect(sources).toHaveLength(1); expect(sources[0].hazardReferences).toHaveLength(125);
  expect(JSON.stringify(sources)).not.toContain('Do not copy');
  const artifactId = await createArtifact({ ...config('system-spec'), architectureSources: [functionalDiagram] });
  await generateArtifact(artifactId, { request: async args => draftRequirement(args) });
  const { job } = await loadArtifact(artifactId);
  await saveProjectHazardAnalysisRecord('p', { analysisResult: { Summary: [['Raw Analysis Row ID', 'System Requirement', 'Safety Significant'], ['EDITED', 'The controller shall inhibit motion while an emergency stop is active for 10 ms.', 'Yes']] } });
  await expect(acceptProposal(artifactId, 0, job.token)).rejects.toThrow(/sources|changed/i);
  expect((await loadArtifact(artifactId)).meta.revision).toBe(0);
});
test('incomplete code analysis does not introduce safety requirements or block normal software generation', async () => {
  await seedDiagrams();
  await saveCodeArchitectureHazardRun({ id: 'pending-code-hazard', projectId: 'c', repoId: 'repo', runState: 'paused', generatedSheets: { Summary: [
    ['Raw Analysis Row ID', 'Software Safety Requirement', 'Safety Significant'], ['NOT-FINISHED', codeSafety, 'Yes'],
  ] } });
  const softwareId = await createArtifact({ ...config('software-spec'), projectId: 'c', workspaceType: 'code-architecture', architectureSources: [codeDiagram] });
  await generateArtifact(softwareId, { request: async args => draftRequirement(args) });
  const { job } = await loadArtifact(softwareId);
  expect(job.state).toBe('ready');
  expect(job.sources.entries.some(entry => entry.sourceType === 'hazard-derived-requirement')).toBe(false);
  expect(Object.values(job.sections).flat().some(object => object.recordedSafetyRequirement || object.evidenceIssue === 'unresolved-safety-allocation')).toBe(false);
});
test.each(['functional', 'code', 'mixed'])('%s diagrams determine the real generation order, exact inputs and published parent citations', async source => {
  await seedDiagrams();
  const architectureSources = source === 'functional' ? [functionalDiagram] : source === 'code' ? [codeDiagram] : [functionalDiagram, codeDiagram];
  const owners = architectureSources.map(diagram => ({ id: diagram.projectId, workspaceType: diagram.workspaceType }));
  const id = await createEngineeringProject({ name: 'Derived controller', owners, system: 'Controller', folderId: 'f', architectureSources, artifacts: [{ templateId: 'software-spec' }, { templateId: 'hardware-spec' }] });
  const calls = [];
  await generateEngineeringProject(id, { request: async args => { calls.push(args); return draftRequirement(args); } });
  const { program, records } = await loadEngineeringProject(id);
  expect(records.map(record => record.meta.templateId)).toEqual(source === 'functional' ? ['system-spec', 'software-spec', 'hardware-spec'] : ['software-spec', 'system-spec', 'hardware-spec']);
  const [first, second, hardware] = records;
  expect(first.meta.dependsOn).toEqual([]); expect(second.meta.dependsOn).toEqual([first.meta.id]);
  expect(hardware.meta.dependsOn).toEqual([records.find(record => record.meta.templateId === 'system-spec').meta.id]);
  const diagrams = record => record.job.sources.entries.filter(entry => entry.sourceType === 'architecture-diagram').map(entry => entry.workspaceType);
  expect(diagrams(first)).toEqual([source === 'functional' ? 'functional' : 'code-architecture']);
  expect(diagrams(second)).toEqual(source === 'mixed' ? ['functional'] : []); expect(diagrams(hardware)).toEqual([]);
  expect(second.job.sources.entries.filter(entry => entry.sourceType === 'artifact-object').every(entry => entry.templateId === first.meta.templateId && entry.kind === 'requirement')).toBe(true);
  expect(records.every(record => !record.job.sources.entries.some(entry => entry.sourceType === 'hazard-derived-requirement') && !Object.values(record.job.sections).flat().some(object => object.recordedSafetyRequirement || object.evidenceIssue === 'unresolved-safety-allocation' || object.attributes?.['Safety Significant'] === 'Yes'))).toBe(true);
  expect(contentGuidance(first.meta.templateId, first.meta.config)).toMatch(/skip safety requirements entirely/);
  expect(calls.map(args => args.meta.templateId).filter((type, index, all) => all.indexOf(type) === index)).toEqual(records.map(record => record.meta.templateId));
  await acceptEngineeringProject(id, program.version, program.runToken);
  const accepted = await loadEngineeringProject(id);
  expect(accepted.records.every(record => record.meta.revision === 1)).toBe(true);
  const requirement = accepted.records[1].revision.objects.find(object => object.kind === 'requirement');
  expect(requirement.sourceEvidence).toContainEqual(expect.objectContaining({ artifactId: first.meta.id, templateId: first.meta.templateId, revision: 1, objectId: expect.any(String) }));
});
test('standalone code specifications derive Software from code, System from Software and Hardware from System', async () => {
  await seedDiagrams();
  const input = { ...config('software-spec'), projectId: 'c', workspaceType: 'code-architecture', architectureSources: [codeDiagram] };
  const softwareId = await createArtifact(input);
  await generateArtifact(softwareId, { request: async args => draftRequirement(args) });
  const software = await loadArtifact(softwareId); await acceptProposal(softwareId, 0, software.job.token);
  const systemConfig = { ...input, templateId: 'system-spec', title: getTemplate('system-spec').name, architectureSources: [], notes: 'Must not replace source requirements.' };
  const systemSources = await captureLiveSources(systemConfig);
  expect(systemSources.entries.every(entry => entry.templateId === 'software-spec' && entry.artifactId === softwareId)).toBe(true);
  await expect(createArtifact({ ...systemConfig, templateId: 'hardware-spec' })).rejects.toThrow('Create and generate a System Requirements');
  const systemId = await createArtifact(systemConfig);
  await generateArtifact(systemId, { request: async args => draftRequirement(args) });
  const system = await loadArtifact(systemId); await acceptProposal(systemId, 0, system.job.token);
  expect((await captureLiveSources({ ...systemConfig, templateId: 'hardware-spec' })).entries.every(entry => entry.artifactId === systemId)).toBe(true);
  expect(contentGuidance('software-spec', input)).toMatch(/first requirements stage for code sources/);
  expect(contentGuidance('system-spec', systemConfig)).toMatch(/Software Requirements precede System Requirements/);
});
test('changing from Projects diagrams to code requires a fresh dependency plan and does not rewrite accepted documents', async () => {
  await seedDiagrams();
  const owners = [{ id: 'p', workspaceType: 'functional' }, { id: 'c', workspaceType: 'code-architecture' }];
  const id = await createEngineeringProject({ name: 'Source switch', owners, system: 'Controller', folderId: 'f', architectureSources: [functionalDiagram], artifacts: [{ templateId: 'software-spec' }, { templateId: 'hardware-spec' }] });
  await generateEngineeringProject(id, { request: async args => draftRequirement(args) });
  let { program } = await loadEngineeringProject(id); await acceptEngineeringProject(id, program.version, program.runToken);
  const before = await loadEngineeringProject(id);
  await updateArchitectureSources(id, [codeDiagram]);
  ({ program } = await loadEngineeringProject(id));
  await expect(beginEngineeringGeneration(id, program.version)).rejects.toThrow('Generate fresh update');
  await generateEngineeringProject(id, { reset: true, request: async args => draftRequirement(args) });
  const after = await loadEngineeringProject(id);
  expect(after.records.map(record => record.meta.templateId)).toEqual(['software-spec', 'system-spec', 'hardware-spec']);
  for (const old of before.records) expect(after.records.find(record => record.meta.id === old.meta.id).revision).toEqual(old.revision);
});
test('moving an existing software draft into a project preserves its evidence until a fresh project generation binds local System Requirements', async () => {
  await seedDiagrams(); await seed();
  const standalone = await createArtifact(config('software-spec'));
  await generateArtifact(standalone, { request: async args => draftRequirement(args) });
  const original = await loadArtifact(standalone);
  const id = await createEngineeringProject({ name: 'Local source project', owners: [{ id: 'p', workspaceType: 'functional' }], system: 'Controller', folderId: 'f', architectureSources: [functionalDiagram], artifacts: [{ templateId: 'system-spec' }] });
  await addArtifactToEngineeringProject(standalone, id);
  expect((await loadArtifact(standalone)).job.sources).toEqual(original.job.sources);
  await generateEngineeringProject(id, { reset: true, request: async args => draftRequirement(args) });
  const { records } = await loadEngineeringProject(id), localSystem = records.find(record => record.meta.templateId === 'system-spec');
  const software = records.find(record => record.meta.id === standalone);
  expect(software.meta.config.programId).toBe(id);
  expect(software.job.sources.entries.some(source => source.artifactId === localSystem.meta.id)).toBe(true);
  expect(software.job.sources.entries.some(source => source.artifactId === 'system')).toBe(false);
});
test.each(['software-spec', 'hardware-spec'])('%s uses exact system requirement objects without copying raw source graphs or notes', async templateId => {
  await seed();
  const input = { ...config(templateId), notes: 'Unrelated implementation notes', architectureSources: [{ projectId: 'p', workspaceType: 'functional' }] };
  const source = (await captureLiveSources(input)).entries[0];
  expect(source).toMatchObject({ artifactId: 'system', objectId: object.id, revision: 1, templateId: 'system-spec', text: object.text, contentHash: semanticHash(object), upstreamSourceIds: ['fd:command'] });
  expect(JSON.stringify(source)).not.toContain('large'); expect(JSON.stringify(source)).not.toContain('Unrelated');
  expect(artifactStorageSnapshot(input, localStorage)).not.toHaveProperty('xhandle.projectData');
});
test('missing, unrelated, empty and incomplete System Requirements cannot fall back to diagrams or notes', async () => {
  const input = { ...config('software-spec'), notes: 'The software shall do something.' };
  await seed({ projectId: 'other' }); await seed({ id: 'other-system', system: 'Other' }); await seed({ id: 'removed', deleted: true });
  await expect(createArtifact(input)).rejects.toThrow('Create and generate a System Requirements');
  await seed({ id: 'empty', objects: [] });
  await expect(createArtifact(input)).rejects.toThrow('requirement statements');
  await seed({ id: 'empty', revision: 0, job: { state: 'paused', sections: {} } });
  await expect(createArtifact(input)).rejects.toThrow('Finish generating');
});
test('ambiguous sources require an explicit choice and cannot cross project boundaries', async () => {
  await seed({ id: 'first' }); await seed({ id: 'second' }); await seed({ id: 'foreign', projectId: 'other' });
  await expect(captureLiveSources(config('hardware-spec'))).rejects.toThrow('Select the System Requirements');
  const sources = await captureLiveSources({ ...config('hardware-spec'), systemRequirementsArtifactId: 'second' });
  expect(sources.entries.every(source => source.artifactId === 'second')).toBe(true);
  await expect(captureLiveSources({ ...config('hardware-spec'), systemRequirementsArtifactId: 'foreign' })).rejects.toThrow('Select the System Requirements');
});
test('accepted requirements remain the source while an update is incomplete; completed initial drafts can be used', async () => {
  await seed({ job: { state: 'paused', sections: {} } });
  expect((await captureLiveSources(config('software-spec'))).entries[0].revision).toBe(1);
  const db = await openArtifactDatabase(); await db.delete('metadata', 'system'); db.close();
  await seed({ id: 'draft', revision: 0, job: { state: 'ready', sections: Object.fromEntries(getTemplate('system-spec').sections.map(section => [section.id, section.id === 's2' ? [object] : []])) } });
  expect((await captureLiveSources(config('software-spec'))).entries[0]).toMatchObject({ artifactId: 'draft', revision: 1 });
});
test('source edits change freshness and requirements without a system parent citation stay review gaps', async () => {
  await seed();
  const input = config('software-spec'), before = await captureLiveSources(input);
  const id = await createArtifact(input);
  await generateArtifact(id, { request: async () => ({ objects: [{ key: 'uncited', kind: 'requirement', title: 'Uncited obligation', text: object.text, sourceIds: [] }] }) });
  const saved = await loadArtifact(id);
  expect(saved.job.sections.s2.some(item => item.kind === 'gap' && item.proposedKind === 'requirement')).toBe(true);
  await seed({ objects: [{ ...object, text: 'The controller shall reject commands older than 50 ms.' }] });
  expect((await captureLiveSources(input)).hash).not.toBe(before.hash);
});
test('selecting software or hardware alone adds System Requirements first and uses direct parallel dependencies', () => {
  const plan = planEngineeringProject({ name: 'Controller', owners: [{ id: 'p', workspaceType: 'functional' }], system: 'Controller', folderId: 'f', notes: object.text, artifacts: [{ templateId: 'software-spec' }, { templateId: 'hardware-spec' }] });
  expect(plan.members.map(member => member.config.templateId)).toEqual(['system-spec', 'software-spec', 'hardware-spec']);
  for (const member of plan.members.slice(1)) {
    expect(member.dependsOn).toEqual([plan.members[0].id]); expect(member.config).toMatchObject({ architectureSources: [], sources: [], notes: '', projectNotes: {} });
  }
});
test('legacy projects change the derivation plan only on a fresh generation and retain original revisions', async () => {
  const id = await createEngineeringProject({ name: 'Controller', owners: [{ id: 'p', workspaceType: 'functional' }], system: 'Controller', folderId: 'f', notes: object.text, artifacts: [{ templateId: 'system-spec' }, { templateId: 'software-spec' }] });
  const { program } = await loadEngineeringProject(id);
  const [system, software] = program.members;
  const db = await openArtifactDatabase();
  await db.put('revisions', { id: `${software.id}:1`, artifactId: software.id, number: 1, objects: [object] });
  const old = { ...program, members: [{ ...software, dependsOn: [] }, { ...system, dependsOn: [software.id] }] };
  await db.put('metadata', old); db.close();
  await expect(beginEngineeringGeneration(id, old.version)).rejects.toThrow('Generate fresh update');
  const next = await beginEngineeringGeneration(id, old.version, true);
  expect(next.members.map(member => member.config.templateId)).toEqual(['system-spec', 'software-spec']);
  expect(next.members[0].dependsOn).toEqual([]); expect(next.members[1].dependsOn).toEqual([system.id]);
  const read = await openArtifactDatabase();
  expect((await read.get('revisions', `${software.id}:1`)).objects).toEqual([object]); read.close();
});
