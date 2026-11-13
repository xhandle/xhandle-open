import * as generationBudgets from './generationBudget';
import { briefGroups } from './generationBrief';
import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { randomUUID } from 'crypto';
import { ARTIFACT_TEMPLATES, getTemplate } from './artifactModel';
import { updateDocumentDetails, acceptProposal, createArtifact, createBaseline, checkpointJob, deleteArtifact, listArtifacts, listRevisions, loadArtifact, moveArtifactInLibrary, openArtifactDatabase, saveObjects, startProposal } from './artifactRepository';
import { engineeringProjectTrace, planEngineeringProject } from './engineeringProjectModel';
import { acceptEngineeringProject, moveFolderIntoEngineeringProject, moveDesignArtifact, addArtifactToEngineeringProject, beginEngineeringGeneration, createEngineeringProject, deleteEngineeringProject, finishEngineeringGeneration, exportEngineeringProject, listEngineeringProjects, loadEngineeringProject, prepareEngineeringDocument } from './engineeringProjectRepository';
import { generateArtifact } from './artifactGeneration';
import { generateEngineeringProject } from './engineeringProjectGeneration';
import { refreshArtifactSources } from './artifactMaintenance';
import { artifactRequirementRows } from './artifactRequirementsAdapter';
import { projectOwnsRecord } from '../../../components/permanentlyDeleteStoredProject';

jest.mock('../../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: {} }) }));
const owners = [{ id: 'p', workspaceType: 'functional' }, { id: 'p', workspaceType: 'code-architecture' }];
const input = () => ({ name: 'Mission engineering', system: 'Mission', folderId: 'f', owners, sources: [{ folderId: 'f', moduleId: 'm', ownerProject: owners[0] }], projectNotes: { 'code-architecture:p': 'The controller retains operator commands.' }, artifacts: [{ templateId: 'system-spec', title: 'System specification' }, { templateId: 'conops', title: 'Operations concept' }] });
const response = ({ sources }) => ({ objects: [{ key: 'need', kind: 'requirement', title: 'Retain commands', text: 'The system shall retain commands for review.', sourceIds: sources.entries.filter(entry => entry.sourceType !== 'project' && entry.kind !== 'gap').map(entry => entry.id) }] });
const request = jest.fn();
async function ready() { const id = await createEngineeringProject(input()); await generateEngineeringProject(id, { request }); return id; }
async function accept(id) { const { program } = await loadEngineeringProject(id); return acceptEngineeringProject(id, program.version, program.runToken); }
async function accepted() { const id = await ready(); await accept(id); return id; }
beforeEach(() => {
  global.structuredClone = v => deserialize(serialize(v));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID } });
  localStorage.clear();
  localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Mission' }]));
  localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([{ id: 'p', name: 'Controller' }]));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Design', modules: [{ id: 'm', name: 'Needs' }] }]));
  localStorage.setItem('xhandle:requirements', JSON.stringify([{ id: 'n', moduleId: 'm', folderId: 'f', title: 'Retain commands', attributes: { Description: 'Operators review commands.' } }]));
  request.mockImplementation(async args => response(args));
});
afterEach(() => jest.restoreAllMocks());

test('plans selected types and repeated instances in dependency order with explicit owners', () => {
  const plan = planEngineeringProject({ ...input(), artifacts: ARTIFACT_TEMPLATES.filter(t => t.id !== 'architecture').map(template => ({ templateId: template.id, subsystem: 'Control', endpointA: 'Control', endpointB: 'Sensor' })).concat([{ templateId: 'subsystem-spec', subsystem: 'Sensor' }]) });
  expect(plan.members).toHaveLength(9);
  expect(plan.members.map(member => member.config.templateId)).toEqual(['conops', 'hazard-tracking-list', 'safety-requirements', 'system-spec', 'subsystem-spec', 'subsystem-spec', 'system-design', 'subsystem-design', 'interface-spec']);
  expect(plan.members[8].dependsOn).toHaveLength(8);
  expect(plan.ownerProjects).toEqual(owners);
  expect(plan.projectId).not.toBe('p');
});
test('rejects absent ownership, conflicting assignments, empty evidence and deselected-owner notes', async () => {
  await expect(createEngineeringProject({ ...input(), owners: [] })).rejects.toThrow('owning projects');
  await expect(createEngineeringProject({ ...input(), sources: [{ folderId: 'f', moduleId: 'm' }] })).rejects.toThrow('Assign');
  await expect(createEngineeringProject({ ...input(), owners: [owners[0]], sources: [] })).rejects.toThrow('source');
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', engineeringProjectId: 'other', modules: [{ id: 'm' }] }]));
  await expect(createEngineeringProject(input())).rejects.toThrow('another project');
  expect(await listArtifacts()).toHaveLength(0); expect(await listEngineeringProjects()).toHaveLength(0);
});
test('downstream generation receives exact proposed upstream objects and joint acceptance preserves every citation', async () => {
  const id = await ready(); let { program, records } = await loadEngineeringProject(id);
  expect(request).toHaveBeenCalledTimes(12);
  expect(records.every(record => record.meta.revision === 0)).toBe(true);
  const upstream = request.mock.calls[6][0].sources.entries.filter(entry => entry.sourceType === 'artifact-object');
  expect(upstream).toHaveLength(6);
  expect(upstream[0]).toMatchObject({ artifactId: records[0].meta.id, revision: 1, ownerProjects: owners });
  await accept(id); ({ program, records } = await loadEngineeringProject(id));
  expect(records.every(record => record.meta.revision === 1 && !record.job)).toBe(true);
  expect(program.acceptedRevisions).toEqual(Object.fromEntries(records.map(record => [record.meta.id, 1])));
  const graph = engineeringProjectTrace(program, records);
  const ids = new Set(graph.nodes.map(node => node.id));
  expect(graph.links.every(link => ids.has(link.from) && ids.has(link.to))).toBe(true);
  expect(graph.links.filter(link => link.type === 'derived-from-project' && link.from === id)).toHaveLength(2);
  expect(graph.links.some(link => link.type === 'refines' && link.from.startsWith(records[1].meta.id) && link.to.startsWith(records[0].meta.id))).toBe(true);
  expect(graph.gaps).toHaveLength(0);
  const projection = artifactRequirementRows(records[0].meta, records[0].revision, records[0].revision.objects, records[0].revision.sources, { program, records });
  expect(projection.allRequirements.some(row => row.module === records[1].meta.title && row.links.some(link => link.toId === records[0].revision.objects[1].id))).toBe(true);
});
test('pause and resume reuse complete documents and completed sections', async () => {
  const id = await createEngineeringProject(input()); let calls = 0;
  await expect(generateEngineeringProject(id, { request: async args => { if (++calls === 9) throw new Error('Interrupted'); return response(args); } })).rejects.toThrow('Interrupted');
  const partial = await loadEngineeringProject(id);
  expect(partial.records[0].job.state).toBe('ready'); expect(Object.keys(partial.records[1].job.sections)).toHaveLength(2);
  await generateEngineeringProject(id, { request }); expect(request).toHaveBeenCalledTimes(4); await accept(id);
});
test('a failed publication rolls back the entire project including earlier documents', async () => {
  const id = await ready(); const { records } = await loadEngineeringProject(id);
  const put = IDBObjectStore.prototype.put;
  jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, ...rest) { if (this.name === 'metadata' && value.id === records[1].meta.id) throw new Error('Quota failure'); return put.call(this, value, ...rest); });
  await expect(accept(id)).rejects.toThrow('Quota failure');
  const after = await loadEngineeringProject(id); expect(after.program.state).toBe('ready');
  for (const record of after.records) { expect(record.meta.revision).toBe(0); expect(record.job.state).toBe('ready'); expect(await listRevisions(record.meta.id)).toHaveLength(0); }
});
test('changed source evidence blocks acceptance and resume; a fresh update rebuilds the set', async () => {
  const id = await ready(); localStorage.setItem('xhandle:requirements', JSON.stringify([{ id: 'n', moduleId: 'm', folderId: 'f', title: 'Revised need' }]));
  await expect(accept(id)).rejects.toThrow('Sources or upstream');
  await expect(generateEngineeringProject(id, { request })).rejects.toThrow('Generate fresh update');
  await generateEngineeringProject(id, { request, reset: true }); await accept(id);
  expect((await loadEngineeringProject(id)).records[0].revision.sources.entries[0].title).toBe('Revised need');
});
test('superseded generation rejects late checkpoints without changing the replacement job', async () => {
  const id = await createEngineeringProject(input()); const initial = (await loadEngineeringProject(id)).program;
  const first = await beginEngineeringGeneration(id, initial.version);
  const job = await prepareEngineeringDocument(first, first.members[0].id, []);
  const second = await beginEngineeringGeneration(id, first.version);
  const next = await prepareEngineeringDocument(second, second.members[0].id, []);
  await expect(checkpointJob(first.members[0].id, job, { state: 'ready' })).rejects.toThrow('replaced');
  expect((await loadArtifact(first.members[0].id)).job).toEqual(next);
});
test('members cannot independently generate or accept project proposals', async () => {
  const id = await ready(); const { records } = await loadEngineeringProject(id); const record = records[0];
  await expect(startProposal(record.meta.id, 0)).rejects.toThrow('systems engineering project');
  await expect(acceptProposal(record.meta.id, 0, record.job.token)).rejects.toThrow('systems engineering project');
});
test('manual upstream edits mark dependents stale and preserve historical citations instead of silently retargeting', async () => {
  const id = await accepted(); const before = await loadEngineeringProject(id); const upstream = before.records[0];
  await saveObjects(upstream.meta.id, 1, upstream.revision.objects.map(object => object.kind === 'section' ? object : { ...object, text: 'Author clarification.', manual: true }));
  await refreshArtifactSources(); const after = await loadEngineeringProject(id);
  expect(after.records[1].meta.freshness).toBe('stale');
  const graph = engineeringProjectTrace(after.program, after.records);
  expect(graph.nodes.some(node => node.historical && node.revision === 1 && node.evidence.text !== 'Author clarification.')).toBe(true);
  expect(graph.gaps.some(gap => gap.message.includes('revision 1'))).toBe(true);
  await generateEngineeringProject(id, { request, reset: true }); await accept(id);
  const updated = await loadEngineeringProject(id);
  expect(updated.records[0].revision.objects.some(object => object.manual && object.text === 'Author clarification.')).toBe(true);
  expect(updated.records[1].revision.sources.dependencies[0].revision).toBe(3);
});
test('an upstream gap cannot become a supported requirement in downstream documents', async () => {
  const id = await createEngineeringProject(input());
  await generateEngineeringProject(id, { request: async args => ({ objects: [{ key: 'gap', kind: args.meta.templateId === 'conops' ? 'gap' : 'requirement', title: 'Timing budget', text: 'A timing budget is unresolved.', sourceIds: args.sources.entries.filter(source => source.sourceType === 'artifact-object').map(source => source.id) }] }) });
  const { records } = await loadEngineeringProject(id);
  const row = Object.values(records[1].job.sections)[0][1];
  expect(row).toMatchObject({ kind: 'gap', evidenceIssue: 'unresolved-upstream', proposedKind: 'requirement' });
});
test('changing accepted documents during proposal review blocks joint acceptance', async () => {
  const id = await accepted(); await generateEngineeringProject(id, { request, reset: true }); const { records } = await loadEngineeringProject(id);
  await saveObjects(records[0].meta.id, 1, records[0].revision.objects);
  await expect(accept(id)).rejects.toThrow('document changed');
  expect((await loadEngineeringProject(id)).records[1].meta.revision).toBe(1);
});
test('shared projects remain readable after source removal and export all revisions and traceability', async () => {
  const id = await accepted(); const { records } = await loadEngineeringProject(id);
  for (const record of records) expect(projectOwnsRecord(record.meta.id, record.meta, 'p', 'xhandle-design-artifacts', 'metadata')).toBe(false);
  localStorage.setItem('xhandle.projects', '[]'); await refreshArtifactSources();
  const exported = await exportEngineeringProject(id);
  expect(exported.records.every(record => record.meta.freshness === 'unavailable' && record.revisions.length === 1)).toBe(true);
  expect(exported.traceability.links.some(link => link.to === 'project:functional:p')).toBe(true);
  await expect(generateEngineeringProject(id, { request, reset: true })).rejects.toThrow('deleted');
  await deleteEngineeringProject(id); expect(await listEngineeringProjects()).toHaveLength(0); expect(await listArtifacts()).toHaveLength(0);
  const db = await openArtifactDatabase(); for (const name of ['jobs', 'revisions', 'baselines']) expect(await db.getAll(name)).toHaveLength(0); db.close();
});
test('deleting a project prevents an in-flight response from resurrecting its documents', async () => {
  const id = await createEngineeringProject(input()); let entered, resolve;
  const started = new Promise(r => { entered = r; });
  const running = generateEngineeringProject(id, { request: args => new Promise(r => { resolve = () => r(response(args)); entered(); }) });
  const rejected = expect(running).rejects.toThrow('no longer exists');
  await started; await deleteEngineeringProject(id); resolve(); await rejected;
  expect(await listArtifacts()).toHaveLength(0);
});

test('whole-workspace backup restores the coordinated project, accepted revisions, checkpoints and exact traces', async () => {
  const id = await accepted(); await generateEngineeringProject(id, { request, reset: true });
  const before = await exportEngineeringProject(id);
  const { backupNow, restoreFromBackupFile } = require('../../../lib/localBackupService');
  const { Blob: NodeBlob } = require('buffer'); let downloaded;
  jest.spyOn(window, 'Blob').mockImplementation((parts, options) => new NodeBlob(parts, options));
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(blob => { downloaded = blob; return 'blob:fixture'; }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await backupNow({ mode: 'download' }); const text = await downloaded.text();
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  const timeout = global.setTimeout; jest.spyOn(global, 'setTimeout').mockImplementation((callback, ms, ...args) => ms === 150 ? 0 : timeout(callback, ms, ...args));
  await restoreFromBackupFile({ text: async () => text });
  const after = await exportEngineeringProject(id); expect(after).toEqual(before);
  await accept(id); expect((await loadEngineeringProject(id)).records.every(record => record.meta.revision === 2)).toBe(true);
});

test('moving a project relocates every member atomically while preserving revisions, proposal inputs and trace links', async () => {
  const id = await accepted(); await generateEngineeringProject(id, { request, reset: true }); const before = await loadEngineeringProject(id);
  const folders = JSON.parse(localStorage.getItem('xhandle:req-projects')); localStorage.setItem('xhandle:req-projects', JSON.stringify([...folders, { id: 'destination', name: 'Other folder', modules: [] }]));
  await moveArtifactInLibrary(id, 'destination'); const after = await loadEngineeringProject(id);
  expect(after.program.folderId).toBe('destination'); expect(after.program.members.every(member => member.config.folderId === 'destination')).toBe(true);
  for (let index = 0; index < after.records.length; index++) {
    expect(after.records[index].meta.folderId).toBe('destination'); expect(after.records[index].meta.config.folderId).toBe('destination');
    expect(after.records[index].revision).toEqual(before.records[index].revision); expect(after.records[index].job).toEqual(before.records[index].job);
  }
  expect(engineeringProjectTrace(after.program, after.records)).toEqual(engineeringProjectTrace(before.program, before.records));
  await accept(id); expect((await loadEngineeringProject(id)).records.every(record => record.meta.revision === 2)).toBe(true);
});
test('a failed project move rolls back every member', async () => {
  const id = await accepted(); const { records } = await loadEngineeringProject(id);
  const folders = JSON.parse(localStorage.getItem('xhandle:req-projects')); localStorage.setItem('xhandle:req-projects', JSON.stringify([...folders, { id: 'destination', name: 'Other', modules: [] }]));
  const put = IDBObjectStore.prototype.put;
  jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, ...args) { if (value.id === records[1].meta.id) throw new Error('Storage full'); return put.call(this, value, ...args); });
  await expect(moveArtifactInLibrary(id, 'destination')).rejects.toThrow('Storage full');
  const after = await loadEngineeringProject(id); expect(after.program.folderId).toBe('f'); expect(after.records.every(record => record.meta.folderId === 'f')).toBe(true);
});

test('an unresolved citation does not stop the project and downstream use remains an explicit gap', async () => {
  const id = await createEngineeringProject(input());
  const request = jest.fn(async args => {
    if (args.meta.templateId === 'conops' && args.section.id === 's1') return { objects: [{ key: 'unsupported', kind: 'requirement', title: 'Timing budget', text: 'Timing shall be 10 ms.', sourceIds: ['invented-budget'] }] };
    const gap = args.sources.entries.find(source => source.sourceType === 'artifact-object' && source.kind === 'gap');
    return gap ? { objects: [{ key: 'dependent', kind: 'requirement', title: 'Allocated timing', text: 'Timing is allocated from the operations concept.', sourceIds: [gap.id] }] } : response(args);
  });
  await generateEngineeringProject(id, { request });
  const { program, records } = await loadEngineeringProject(id); expect(program.state).toBe('ready');
  const conops = records.find(record => record.meta.templateId === 'conops');
  const spec = records.find(record => record.meta.templateId === 'system-spec');
  expect(conops.job.sections.s1[1]).toMatchObject({ kind: 'gap', evidenceIssue: 'unknown-citation', sourceIds: [] });
  expect(spec.job.sections.s1[1]).toMatchObject({ kind: 'gap', evidenceIssue: 'unresolved-upstream' });
  expect(engineeringProjectTrace(program, records, true).gaps.length).toBeGreaterThan(0);
  expect(request.mock.calls.filter(([args]) => args.meta.templateId === 'conops' && args.section.id === 's1')).toHaveLength(2);
  expect(records.every(record => record.job.state === 'ready')).toBe(true);
});


const standaloneConfig = () => ({ templateId: 'system-design', title: 'Existing design', system: 'Mission', projectId: 'p', workspaceType: 'functional', folderId: 'f', sources: [{ folderId: 'f', moduleId: 'm' }] });
test('joining a project preserves accepted revisions, baselines and source ownership through generation and acceptance', async () => {
  const programId = await ready(); const beforeProgram = await loadEngineeringProject(programId);
  const id = await createArtifact(standaloneConfig());
  await generateArtifact(id, { request }); let data = await loadArtifact(id); await acceptProposal(id, 0, data.job.token);
  await createBaseline(id, 1, 'Before joining'); const before = await loadArtifact(id);
  await addArtifactToEngineeringProject(id, programId);
  const after = await loadArtifact(id), project = await loadEngineeringProject(programId);
  expect(after.revision).toEqual(before.revision); expect(after.baselines).toEqual(before.baselines);
  expect(after.meta).toMatchObject({ programId, revision: 1, dependsOn: [], config: { ownerProjects: [owners[0]], sources: standaloneConfig().sources } });
  expect(project.program.members).toHaveLength(3); expect(project.program.state).toBe('paused');
  for (let i = 0; i < 2; i++) expect(project.records[i].job).toEqual(beforeProgram.records[i].job);
  expect(engineeringProjectTrace(project.program, project.records).links).toContainEqual(expect.objectContaining({ from: programId, to: id, type: 'contains' }));
  await generateEngineeringProject(programId, { request }); await accept(programId);
  expect((await loadArtifact(id)).meta.revision).toBe(2);
  expect((await listRevisions(id))[0]).toEqual(before.revision);
  await deleteEngineeringProject(programId); expect(await listArtifacts()).toHaveLength(0);
});
test('joining preserves partial standalone checkpoints and resumes only missing sections', async () => {
  const programId = await ready(), id = await createArtifact(standaloneConfig()); let count = 0;
  await expect(generateArtifact(id, { request: async args => { if (++count === 2) throw new Error('Interrupted'); return response(args); } })).rejects.toThrow('Interrupted');
  const before = await loadArtifact(id);
  await addArtifactToEngineeringProject(id, programId);
  const after = await loadArtifact(id);
  expect(after.job.sections).toEqual(before.job.sections); expect(after.job.token).not.toBe(before.job.token);
  const resume = jest.fn(async args => response(args)); await generateEngineeringProject(programId, { request: resume });
  expect(resume).toHaveBeenCalledTimes(5); await accept(programId);
});
test('joining is atomic, idempotent, and rejects running or missing projects', async () => {
  const programId = await createEngineeringProject(input()), id = await createArtifact(standaloneConfig());
  await expect(addArtifactToEngineeringProject(id, 'missing')).rejects.toThrow('no longer exists');
  const before = await loadArtifact(id), programBefore = await loadEngineeringProject(programId);
  const put = IDBObjectStore.prototype.put;
  const failing = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, ...args) { if (value.id === programId) throw new Error('Storage full'); return put.call(this, value, ...args); });
  await expect(addArtifactToEngineeringProject(id, programId)).rejects.toThrow('Storage full'); failing.mockRestore();
  expect(await loadArtifact(id)).toEqual(before); expect(await loadEngineeringProject(programId)).toEqual(programBefore);
  await beginEngineeringGeneration(programId, programBefore.program.version);
  await expect(addArtifactToEngineeringProject(id, programId)).rejects.toThrow('Pause generation');
  await generateEngineeringProject(programId, { request });
  await addArtifactToEngineeringProject(id, programId); await addArtifactToEngineeringProject(id, programId);
  expect((await loadEngineeringProject(programId)).program.members.filter(member => member.id === id)).toHaveLength(1);
  const other = await createEngineeringProject(input());
  await expect(addArtifactToEngineeringProject(id, other)).rejects.toThrow('another systems engineering project');
});


test('project completes with smaller generated parts and canonical cross-document traces', async () => {
  const id = await createEngineeringProject(input());
  const recovering = jest.fn(async args => args.meta.templateId === 'conops' && args.section.id === 's1' && !args.part ? { objects: [] } : response(args));
  await generateEngineeringProject(id, { request: recovering });
  const { program, records } = await loadEngineeringProject(id);
  expect(program.state).toBe('ready'); expect(records.every(record => record.job.state === 'ready')).toBe(true);
  const source = records[0].job.sections.s1[1].id;
  const trace = engineeringProjectTrace(program, records, true);
  expect(trace.links.some(link => link.type === 'refines' && link.from.startsWith(records[1].meta.id) && link.to === source)).toBe(true);
  await accept(id); expect((await loadEngineeringProject(id)).program.state).toBe('accepted');
});
test('project readiness cannot be asserted when member jobs are missing', async () => {
  const id = await createEngineeringProject(input()); const initial = (await loadEngineeringProject(id)).program;
  const program = await beginEngineeringGeneration(id, initial.version);
  await expect(finishEngineeringGeneration(program, 'ready')).rejects.toThrow('incomplete');
  expect((await loadEngineeringProject(id)).program.state).toBe('generating');
});

test('project progress reports aggregate saved sections, document location and final checks', async () => {
  const id = await createEngineeringProject(input()), progress = jest.fn();
  await generateEngineeringProject(id, { request, onProgress: progress });
  const details = progress.mock.calls.map(([, value]) => value);
  expect(details[0]).toMatchObject({ stage: 'preparing', totalDocuments: 2, completedSections: 0, totalSections: 12 });
  expect(details.some(value => value.documentIndex === 2 && value.sectionTitle === 'Functional requirements' && value.completedDocuments === 1 && value.completedSections === 7)).toBe(true);
  expect(details.find(value => value.stage === 'verifying' && !value.documentTitle)).toMatchObject({ completedSections: 12, totalSections: 12, completedDocuments: 2 });
  expect(details[details.length - 1]).toMatchObject({ stage: 'complete', completedSections: 12, completedDocuments: 2 });
  await generateEngineeringProject(id, { request, onProgress: progress });
  expect(progress.mock.calls[progress.mock.calls.length - 1][1].completedSections).toBe(12);
});

test('a project completes and accepts evidence-heavy documents above the old repeated-snapshot limit', async () => {
  const rows = JSON.parse(localStorage.getItem('xhandle:requirements'));
  rows[0].attributes.Description = 'Selected operational evidence. '.repeat(700);
  localStorage.setItem('xhandle:requirements', JSON.stringify(rows));
  request.mockImplementation(async args => {
    const item = response(args).objects[0];
    const sourceIds = [...new Set([item.sourceIds[0], item.sourceIds[item.sourceIds.length - 1]])];
    return { objects: Array.from({ length: args.part ? 10 : 20 }, (_, i) => ({ ...item, sourceIds, key: `need-${i}` })) };
  });
  const id = await ready();
  const { records, program } = await loadEngineeringProject(id);
  expect(program.state).toBe('ready');
  const conops = records.find(record => record.meta.templateId === 'conops');
  expect(JSON.stringify(Object.values(conops.job.sections).flat()).length).toBeGreaterThan(2000000);
  expect(records.every(record => record.job.state === 'ready')).toBe(true);
  await accept(id);
  const accepted = await loadEngineeringProject(id);
  expect(accepted.program.state).toBe('accepted');
  expect(accepted.records.every(record => record.meta.revision === 1)).toBe(true);
  const graph = engineeringProjectTrace(accepted.program, accepted.records);
  expect(graph.links.some(link => link.type === 'refines')).toBe(true);
});

test('multi-megabyte upstream documents are reviewed once before six concise downstream sections', async () => {
  request.mockImplementation(async args => {
    const source = args.sources.entries.find(entry => entry.sourceType === 'artifact-object') || args.sources.entries.find(entry => entry.sourceType !== 'project');
    return { objects: Array.from({ length: args.task === 'evidence-review' ? 12 : args.meta.templateId === 'conops' ? 30 : 1 }, (_, i) => ({ key: `statement-${i}`, kind: 'requirement', title: `Operational statement ${i}`, text: args.task === 'evidence-review' ? 'Supported material detail. '.repeat(40) : args.meta.templateId === 'conops' ? 'Detailed supported operational statement. '.repeat(350) : 'Allocated system requirement.', sourceIds: [source.id] })) };
  });
  const id = await ready();
  const { records, program } = await loadEngineeringProject(id);
  expect(program.state).toBe('ready');
  const conops = records.find(record => record.meta.templateId === 'conops');
  const spec = records.find(record => record.meta.templateId === 'system-spec');
  expect(JSON.stringify(conops.job.sections).length).toBeGreaterThan(2000000);
  expect(JSON.stringify(spec.job.sources).length).toBeGreaterThan(2000000);
  const reviews = request.mock.calls.map(([args]) => args).filter(args => args.meta.id === spec.meta.id && args.task === 'evidence-review' && args.section.id.startsWith('review-0-'));
  expect(reviews.length).toBe(briefGroups(spec.job.sources).length);
  expect(reviews.length).toBeGreaterThan(12);
  expect(spec.job.evidenceBrief.rounds.length).toBeGreaterThan(1);
  expect(spec.job.evidenceBrief.rounds.length).toBeLessThanOrEqual(3);
  expect(request.mock.calls.length).toBeLessThan(120);
  expect(reviews.flatMap(args => args.sources.entries.map(source => source.id))).toEqual(spec.job.sources.entries.filter(source => source.sourceType !== 'project').map(source => source.id));
  expect(request.mock.calls.filter(([args]) => args.meta.id === spec.meta.id && args.task !== 'evidence-review')).toHaveLength(6);
  expect(Object.values(spec.job.sections).flat().filter(object => object.kind !== 'section')).toHaveLength(6);
  await accept(id);
  const accepted = await loadEngineeringProject(id);
  expect(accepted.program.state).toBe('accepted');
  expect(accepted.records.every(record => record.meta.revision === 1)).toBe(true);
});


test('a paused draft above 1000 objects resumes intact, feeds downstream generation and publishes with its full traceability', async () => {
  const id = await createEngineeringProject(input());
  const before = await loadEngineeringProject(id);
  const program = await beginEngineeringGeneration(id, before.program.version, false);
  const member = program.members[0];
  const job = await prepareEngineeringDocument(program, member.id, []);
  const source = job.sources.entries.find(entry => entry.sourceType !== 'project');
  const sections = Object.fromEntries(getTemplate(member.config.templateId).sections.map(section => [section.id, [
    { id: `${member.id}:${section.id}`, sectionId: section.id, title: section.title, text: '', kind: 'section', parentId: null, sourceIds: [], manual: false },
    ...Array.from({ length: 240 }, (_, index) => ({ id: `${member.id}:${section.id}:saved-${index}`, key: `saved-${index}`, sectionId: section.id, parentId: `${member.id}:${section.id}`, title: `Saved requirement ${index}`, text: `Supported operational statement ${index}.`, kind: 'requirement', sourceIds: [source.id], sourceEvidence: [source], evidenceHash: job.sources.hash, manual: false })),
  ]]));
  await checkpointJob(member.id, job, { sections, state: 'paused', error: 'The document contains more than 1,000 objects.' });
  await finishEngineeringGeneration(program, 'paused', 'The document contains more than 1,000 objects.');
  request.mockImplementation(async args => {
    const source = args.sources.entries.find(entry => entry.sourceType === 'artifact-object') || args.sources.entries.find(entry => entry.sourceType !== 'project');
    return { objects: [{ key: 'allocation', kind: 'requirement', title: 'Allocated requirement', text: 'Supported allocation.', sourceIds: [source.id] }] };
  });
  await generateEngineeringProject(id, { request });
  expect(request.mock.calls.every(([args]) => args.meta.id !== member.id)).toBe(true);
  const ready = await loadEngineeringProject(id);
  expect(ready.program.state).toBe('ready');
  expect(ready.records[0].job.sections).toEqual(sections);
  await accept(id);
  const accepted = await loadEngineeringProject(id);
  expect(accepted.program.state).toBe('accepted');
  const record = accepted.records[0];
  expect(record.revision.objects).toEqual(Object.values(sections).flat());
  expect(record.revision.objects).toHaveLength(1446);
  const view = artifactRequirementRows(record.meta, record.revision, record.revision.objects, record.revision.sources, accepted);
  expect(view.rows).toHaveLength(1446);
  const exported = await exportEngineeringProject(id);
  expect(exported.records[0].revision.objects).toHaveLength(1446);
  expect(exported.traceability.nodes.filter(node => node.artifactId === member.id && node.objectId)).toHaveLength(1446);
  expect(exported.traceability.links.some(link => link.type === 'refines' && link.to.startsWith(member.id))).toBe(true);
});


test('one project request budget spans documents and resume keeps the ready document intact', async () => {
  const realBudget = generationBudgets.createGenerationBudget;
  const makeBudget = jest.spyOn(generationBudgets, 'createGenerationBudget').mockImplementation(signal => realBudget(signal, { requestLimit: 7 }));
  const id = await createEngineeringProject(input());
  await expect(generateEngineeringProject(id, { request })).rejects.toMatchObject({ code: 'GENERATION_BUDGET' });
  const partial = await loadEngineeringProject(id);
  expect(makeBudget).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(7);
  expect(partial.program.state).toBe('paused');
  expect(partial.program.error).toContain('7-request');
  expect(partial.records[0].job.state).toBe('ready');
  expect(Object.keys(partial.records[1].job.sections)).toHaveLength(1);
  expect(partial.records[1].job.error).toContain('7-request');
  makeBudget.mockRestore(); request.mockClear();
  await generateEngineeringProject(id, { request });
  expect(request).toHaveBeenCalledTimes(5);
  expect((await loadEngineeringProject(id)).records[0].job.sections).toEqual(partial.records[0].job.sections);
  await accept(id);
});


test('editing project and member details preserves ready proposals, citations and acceptance', async () => {
  const id = await ready();
  const before = await loadEngineeringProject(id), memberId = before.records[0].meta.id;
  await updateDocumentDetails(id, 0, { title: ' Renamed program ', description: 'Project purpose.' });
  await updateDocumentDetails(memberId, 0, { title: 'Updated operations', description: 'Operational context.' });
  const updated = await loadEngineeringProject(id);
  expect(updated.program).toMatchObject({ title: 'Renamed program', description: 'Project purpose.', state: 'ready' });
  expect(updated.program.members[0].config).toMatchObject({ title: 'Updated operations', description: 'Operational context.' });
  expect(updated.records.map(record => record.job)).toEqual(before.records.map(record => record.job));
  expect(updated.records[0].meta.config.title).toBe('Updated operations');
  const calls = request.mock.calls.length;
  // Resume reuses every checkpoint even after an upstream document was renamed.
  await generateEngineeringProject(id, { request });
  expect(request).toHaveBeenCalledTimes(calls);
  await accept(id);
  const accepted = await loadEngineeringProject(id);
  expect(accepted.program.state).toBe('accepted');
  expect(accepted.records.every(record => record.meta.revision === 1)).toBe(true);
  const revisions = await listRevisions(memberId);
  await updateDocumentDetails(memberId, 1, { title: 'Final operations title', description: '' });
  expect(await listRevisions(memberId)).toEqual(revisions);
  expect((await exportEngineeringProject(id)).records[0].meta.title).toBe('Final operations title');
});

test('details reject stale edits, invalid titles and active generation without overwriting saved work', async () => {
  const id = await createEngineeringProject(input());
  await expect(updateDocumentDetails(id, 0, { title: '  ' })).rejects.toThrow('title');
  await expect(updateDocumentDetails(id, 0, { title: 'Valid', description: 'x'.repeat(4001) })).rejects.toThrow('description');
  await updateDocumentDetails(id, 0, { title: 'First edit', description: 'Keep this.' });
  await expect(updateDocumentDetails(id, 0, { title: 'Stale edit' })).rejects.toThrow('another window');
  const { program } = await loadEngineeringProject(id);
  await beginEngineeringGeneration(id, program.version);
  await expect(updateDocumentDetails(id, 1, { title: 'During generation' })).rejects.toThrow('Pause generation');
  await expect(updateDocumentDetails(program.members[0].id, 0, { title: 'During generation' })).rejects.toThrow('Pause generation');
  expect((await loadEngineeringProject(id)).program.title).toBe('First edit');
});


test('project artifacts can move into nested folders, resume and accept, and move back without losing membership or evidence', async () => {
  const id = await accepted(); await generateEngineeringProject(id, { request, reset: true });
  const before = await loadEngineeringProject(id), artifactId = before.records[0].meta.id;
  const folders = JSON.parse(localStorage.getItem('xhandle:req-projects'));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([...folders, { id: 'nested', name: 'Architectures', parentId: 'f', modules: [] }]));
  await moveArtifactInLibrary(artifactId, 'nested');
  const after = await loadEngineeringProject(id), moved = after.records.find(record => record.meta.id === artifactId);
  expect(moved.meta).toMatchObject({ folderId: 'nested', programId: id, config: { folderId: 'nested' } });
  expect(after.program.folderId).toBe('f');
  expect(after.program.members.find(member => member.id === artifactId).config.folderId).toBe('nested');
  expect(moved.revision).toEqual(before.records[0].revision);
  expect(moved.job).toEqual(before.records[0].job);
  expect(engineeringProjectTrace(after.program, after.records)).toEqual(engineeringProjectTrace(before.program, before.records));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([...JSON.parse(localStorage.getItem('xhandle:req-projects')), { id: 'relocated', name: 'Other project location', modules: [] }]));
  await moveArtifactInLibrary(id, 'relocated');
  const relocated = await loadEngineeringProject(id);
  expect(relocated.records.find(record => record.meta.id === artifactId).meta.folderId).toBe('nested');
  expect(relocated.program.members.find(member => member.id === artifactId).config.folderId).toBe('nested');
  expect(relocated.records.filter(record => record.meta.id !== artifactId).every(record => record.meta.folderId === 'relocated')).toBe(true);
  await accept(id);
  await addArtifactToEngineeringProject(artifactId, id);
  const restored = await loadEngineeringProject(id);
  expect(restored.records.find(record => record.meta.id === artifactId).meta.folderId).toBe('relocated');
  expect(restored.program.members.filter(member => member.id === artifactId)).toHaveLength(1);
  expect(restored.records.find(record => record.meta.id === artifactId).meta.revision).toBe(2);
});


test('a failed artifact subfolder move rolls back project member placement too', async () => {
  const id = await accepted(), before = await loadEngineeringProject(id), artifactId = before.records[0].meta.id;
  localStorage.setItem('xhandle:req-projects', JSON.stringify([...JSON.parse(localStorage.getItem('xhandle:req-projects')), { id: 'nested', name: 'Nested', parentId: 'f', modules: [] }]));
  const put = IDBObjectStore.prototype.put;
  const failure = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, ...args) { if (value.id === artifactId) throw new Error('Storage full'); return put.call(this, value, ...args); });
  await expect(moveArtifactInLibrary(artifactId, 'nested')).rejects.toThrow('Storage full');
  failure.mockRestore();
  expect(await loadEngineeringProject(id)).toEqual(before);
});


function nestedLibraryFolders() {
  const folders = JSON.parse(localStorage.getItem('xhandle:req-projects'));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([...folders,
    { id: 'specs', name: 'Specifications', parentId: 'f', modules: [] },
    { id: 'nested', name: 'Interfaces', parentId: 'specs', modules: [] },
    { id: 'outside', name: 'Outside', parentId: null, modules: [] }]));
}
test('folder adoption keeps its subtree, saved work and member identities, persists, and supports moving back out', async () => {
  nestedLibraryFolders(); const programId = await ready();
  const existingId = (await loadEngineeringProject(programId)).program.members[0].id;
  await moveArtifactInLibrary(existingId, 'specs');
  const existing = await loadArtifact(existingId);
  const standaloneId = await createArtifact({ ...standaloneConfig(), folderId: 'nested' });
  await generateArtifact(standaloneId, { request });
  const standalone = await loadArtifact(standaloneId);
  await moveFolderIntoEngineeringProject('specs', programId);
  let result = await loadEngineeringProject(programId);
  expect(result.program.libraryFolderIds).toEqual(['specs']);
  expect(result.program.members).toHaveLength(3);
  expect(await loadArtifact(existingId)).toEqual(existing);
  expect((await loadArtifact(standaloneId)).job.sections).toEqual(standalone.job.sections);
  expect((await loadArtifact(standaloneId)).meta).toMatchObject({ programId, folderId: 'nested' });
  await moveFolderIntoEngineeringProject('specs', programId);
  expect((await loadEngineeringProject(programId)).program.members).toHaveLength(3);
  await expect(moveArtifactInLibrary(programId, 'nested')).rejects.toThrow('own folders');
  await expect(moveFolderIntoEngineeringProject('f', programId)).rejects.toThrow('contents');
  const added = await createArtifact(standaloneConfig());
  await moveDesignArtifact(added, 'nested');
  expect((await loadArtifact(added)).meta).toMatchObject({ programId, folderId: 'nested' });
  await moveArtifactInLibrary(programId, 'outside');
  result = await loadEngineeringProject(programId);
  expect(result.program.libraryFolderIds).toEqual(['specs']);
  expect(result.records.find(record => record.meta.id === standaloneId).meta.folderId).toBe('nested');
  await generateEngineeringProject(programId, { request }); await accept(programId);
  await moveFolderIntoEngineeringProject('specs', null, 'outside');
  result = await loadEngineeringProject(programId);
  expect(result.program.libraryFolderIds).toEqual([]);
  expect(result.program.members).toHaveLength(4);
  expect(result.records.every(record => record.meta.revision === 1)).toBe(true);
});
test('folder adoption rejects foreign project members and storage errors atomically', async () => {
  nestedLibraryFolders(); const programId = await ready(), otherId = await ready();
  const standaloneId = await createArtifact({ ...standaloneConfig(), folderId: 'specs' });
  const foreignId = (await loadEngineeringProject(otherId)).program.members[0].id;
  await moveArtifactInLibrary(foreignId, 'nested');
  const before = await loadArtifact(standaloneId), program = await loadEngineeringProject(programId);
  await expect(moveFolderIntoEngineeringProject('specs', programId)).rejects.toThrow('another systems engineering project');
  expect(await loadArtifact(standaloneId)).toEqual(before);
  expect(await loadEngineeringProject(programId)).toEqual(program);
  await moveArtifactInLibrary(foreignId, 'f');
  const put = IDBObjectStore.prototype.put;
  const spy = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(value, ...args) {
    if (this.name === 'metadata' && value.libraryFolderIds?.includes('specs')) throw new Error('Storage full');
    return put.call(this, value, ...args);
  });
  await expect(moveFolderIntoEngineeringProject('specs', programId)).rejects.toThrow('Storage full');
  spy.mockRestore();
  expect(await loadArtifact(standaloneId)).toEqual(before);
  expect(await loadEngineeringProject(programId)).toEqual(program);
});

test('deleting one project artifact removes its records and membership while preserving other documents and historical citations', async () => {
  const id = await accepted(), before = await loadEngineeringProject(id);
  const removed = before.records[0], kept = before.records[1];
  await createBaseline(removed.meta.id, removed.meta.revision, 'Saved architecture');
  const sourceProjects = localStorage.getItem('xhandle.projects');
  await deleteArtifact(removed.meta.id);
  await expect(loadArtifact(removed.meta.id)).rejects.toThrow('no longer exists');
  const after = await loadEngineeringProject(id);
  expect(after.program.members.map(member => member.id)).toEqual([kept.meta.id]);
  expect(after.records[0].meta.dependsOn).not.toContain(removed.meta.id);
  expect(after.records[0].revision).toEqual(kept.revision);
  expect(engineeringProjectTrace(after.program, after.records).nodes.some(node => node.historical && node.artifactId === removed.meta.id)).toBe(true);
  expect(localStorage.getItem('xhandle.projects')).toBe(sourceProjects);
  const db = await openArtifactDatabase();
  for (const store of ['jobs', 'revisions', 'baselines']) expect(await db.getAllKeysFromIndex(store, 'artifactId', removed.meta.id)).toHaveLength(0);
  db.close();
});
test('deleting a member invalidates in-flight project checkpoints and retains remaining drafts', async () => {
  const id = await ready(), before = await loadEngineeringProject(id);
  const removed = before.records[0], kept = before.records[1];
  const running = await beginEngineeringGeneration(id, before.program.version);
  await deleteArtifact(removed.meta.id);
  const after = await loadEngineeringProject(id);
  expect(after.program.runToken).toBeNull(); expect(after.program.state).toBe('paused');
  expect(after.program.error).toContain('fresh update');
  expect(after.records[0].job).toEqual(kept.job);
  await expect(checkpointJob(removed.meta.id, removed.job, {})).rejects.toThrow('no longer exists');
  await expect(checkpointJob(kept.meta.id, { ...kept.job, programRunToken: running.runToken }, {})).rejects.toThrow('replaced');
});
test('failed artifact cleanup rolls back project membership and document deletion together', async () => {
  const id = await accepted(), before = await loadEngineeringProject(id), removed = before.records[0];
  const original = IDBObjectStore.prototype.delete;
  jest.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function(key) {
    if (this.name === 'revisions') throw new Error('Storage unavailable');
    return original.call(this, key);
  });
  await expect(deleteArtifact(removed.meta.id)).rejects.toThrow('Storage unavailable');
  expect(await loadEngineeringProject(id)).toEqual(before);
});
