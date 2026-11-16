import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { randomUUID } from 'crypto';
import { captureSources } from './artifactSources';
import { ARTIFACT_TEMPLATES, CREATABLE_ARTIFACT_TEMPLATES, ENGINEERING_ARTIFACT_TYPES, artifactObjectText, getTemplate, validateSection } from './artifactModel';
import { acceptProposal, checkpointJob, createArtifact, createBaseline, deleteArtifact, listArtifacts, listRevisions, loadArtifact, openArtifactDatabase, saveDraftObjects, saveObjects, startProposal } from './artifactRepository';
import { generateArtifact, requestSection } from './artifactGeneration';
import { refreshArtifactSources, startArtifactMaintenance } from './artifactMaintenance';
import { artifactMarkdown, portableArtifact } from './artifactExport';
import { fixtureSafetyIssues } from '../../project-hazard-analysis/testHelpers/safetyIssueFixtures';
import { appendModuleRequirements, replaceModuleRequirements } from '../../requirements/actions/requirementsState';

jest.mock('../../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: { 'x-ai-provider': 'fixture', 'x-ai-model': 'fixture-model', 'Content-Type': 'application/json' } }) }));
const config = { templateId: 'system-spec', title: 'Fixture Specification', projectId: 'p', workspaceType: 'functional', folderId: 'f', system: 'Fixture system', sources: [{ folderId: 'f', moduleId: 'm' }], notes: '' };
const seedRows = () => Array.from({ length: 150 }, (_, n) => ({ id: `r${n}`, title: `Evidence ${n}`, moduleId: 'm', module: 'Source', folderId: 'f', parentId: null, attributes: { Description: `Need ${n}` } }));
const response = () => ({ objects: [{ key: 'one', kind: 'requirement', title: 'Source-backed requirement', text: 'Derived from selected evidence.', sourceIds: ['module:f/m:r149'] }, { key: 'gap', kind: 'gap', title: 'Missing performance budget', text: 'Unresolved: no budget supplied.', sourceIds: [] }] });
const request = jest.fn(async () => response());
async function ready() { const id = await createArtifact(config); await generateArtifact(id, { request }); return id; }
async function accepted() { const id = await ready(); const { job } = await loadArtifact(id); await acceptProposal(id, 0, job.token); return id; }
beforeEach(() => {
  global.structuredClone = v => deserialize(serialize(v));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID } });
  localStorage.clear();
  localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Fixture' }, { id: 'other' }]));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Design', modules: [{ id: 'm', name: 'Source' }, { id: 'other', name: 'Other' }] }]));
  localStorage.setItem('xhandle:requirements', JSON.stringify(seedRows()));
  request.mockReset(); request.mockImplementation(async () => response());
});
afterEach(() => jest.restoreAllMocks());

test('source manifests include all 150 objects, semantic changes, and explicit module ownership', () => {
  const first = captureSources(config); expect(first.entries).toHaveLength(150);
  const rows = seedRows(); rows[149].attributes.Description = 'Changed last row';
  localStorage.setItem('xhandle:requirements', JSON.stringify(rows)); expect(captureSources(config).hash).not.toBe(first.hash);
  rows[149].updatedAt = 'timestamp-only'; const hash = captureSources(config).hash;
  localStorage.setItem('xhandle:requirements', JSON.stringify(rows)); expect(captureSources(config).hash).toBe(hash);
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', engineeringProjectId: 'other', modules: [{ id: 'm' }] }]));
  expect(() => captureSources(config)).toThrow('another project');
});
test('missing and malformed sources are unavailable, never treated as empty evidence', () => {
  localStorage.setItem('xhandle:requirements', '{broken'); expect(() => captureSources(config)).toThrow();
  localStorage.setItem('xhandle:requirements', '[]'); localStorage.setItem('xhandle:req-projects', '[]');
  expect(() => captureSources(config)).toThrow('unavailable');
});
test('all required template families are versioned and scoped', () => {
  expect(ARTIFACT_TEMPLATES.map(t => t.id)).toEqual(['conops', 'system-spec', 'subsystem-spec', 'software-spec', 'hardware-spec', 'system-design', 'subsystem-design', 'interface-spec', 'architecture', 'hazard-tracking-list', 'safety-requirements']);
  expect(ARTIFACT_TEMPLATES.every(t => t.version === 1 && t.sections.length)).toBe(true);
});
test('creation offers exactly six document types while saved legacy templates remain readable', () => {
  expect(ENGINEERING_ARTIFACT_TYPES.map(template => template.name)).toEqual(['ConOps', 'Architecture', 'System Requirements Specification', 'Software Requirements Specification', 'Hardware Requirements Specification', 'Traceability Matrix']);
  expect(CREATABLE_ARTIFACT_TEMPLATES.every(template => !template.deterministic)).toBe(true);
  for (const id of ['subsystem-spec', 'system-design', 'subsystem-design', 'interface-spec', 'hazard-tracking-list', 'safety-requirements']) {
    expect(CREATABLE_ARTIFACT_TEMPLATES.some(template => template.id === id)).toBe(false);
    expect(getTemplate(id)).toMatchObject({ id, version: 1 });
    expect(getTemplate(id).sections.length).toBeGreaterThan(0);
  }
  expect(getTemplate('system-spec').sections[1]).toEqual({ id: 's2', title: 'Functional requirements' });
});
test('validates generated identity, citation, kind and size boundaries', () => {
  const section = ARTIFACT_TEMPLATES[0].sections[0], allowed = new Set(['module:f/m:r149']);
  expect(validateSection(response(), section, 'a', allowed)).toHaveLength(3);
  for (const patch of [{ sourceIds: ['made-up'] }, { key: '../bad' }, { text: 'x'.repeat(16001) }, { kind: 'approved' }]) {
    const value = response(); Object.assign(value.objects[0], patch); expect(() => validateSection(value, section, 'a', allowed)).toThrow();
  }
  const duplicate = response(); duplicate.objects.push(duplicate.objects[0]); expect(() => validateSection(duplicate, section, 'a', allowed)).toThrow('duplicate');
});
test('draft checkpoints survive reopen; accepting atomically publishes an immutable revision', async () => {
  const id = await ready(); let data = await loadArtifact(id); expect(data.meta.revision).toBe(0); expect(data.job.state).toBe('ready');
  await acceptProposal(id, 0, data.job.token); data = await loadArtifact(id);
  expect(data.meta.projectId).toBe('p'); expect(data.meta.folderId).toBe('f'); expect(data.revision.objects).toHaveLength(18); expect(data.job).toBeUndefined();
  expect(localStorage.getItem('xhandle:requirements')).not.toContain('Source-backed requirement');
  await createBaseline(id, 1, 'Review A'); expect((await loadArtifact(id)).baselines[0]).toMatchObject({ label: 'Review A', revision: 1 });
});
test('a quota failure rolls back both accepted revision and metadata', async () => {
  const id = await ready(); const { job } = await loadArtifact(id);
  const put = IDBObjectStore.prototype.put;
  jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(...args) { if (this.name === 'metadata') throw new Error('Quota failure'); return put.apply(this, args); });
  await expect(acceptProposal(id, 0, job.token)).rejects.toThrow('Quota');
  expect(await listRevisions(id)).toHaveLength(0); expect((await loadArtifact(id)).meta.revision).toBe(0); expect((await loadArtifact(id)).job.state).toBe('ready');
});
test('manual edits survive regeneration and old revisions remain unchanged', async () => {
  const id = await accepted(); const old = (await loadArtifact(id)).revision;
  const edited = old.objects.map((o, i) => i === 1 ? { ...o, text: 'Manual decision', manual: true } : o);
  await saveObjects(id, 1, edited); await startProposal(id, 2); await generateArtifact(id, { request });
  const data = await loadArtifact(id); await acceptProposal(id, 2, data.job.token);
  expect((await loadArtifact(id)).revision.objects[1].text).toBe('Manual decision');
  expect((await listRevisions(id)).find(r => r.number === 1).objects[1].text).toBe('Derived from selected evidence.');
});
test('stale proposals and concurrent saves fail instead of overwriting manual work', async () => {
  const id = await accepted(); await startProposal(id, 1); await generateArtifact(id, { request });
  const { revision, job } = await loadArtifact(id); await saveObjects(id, 1, revision.objects);
  await expect(acceptProposal(id, 2, job.token)).rejects.toThrow('changed since generation');
  await expect(saveObjects(id, 1, revision.objects)).rejects.toThrow('another window');
});
test('source changes prevent accepting an outdated proposal', async () => {
  const id = await ready(); const { job } = await loadArtifact(id);
  const rows = seedRows(); rows[149].title = 'Changed'; localStorage.setItem('xhandle:requirements', JSON.stringify(rows));
  await expect(acceptProposal(id, 0, job.token)).rejects.toThrow('Sources changed');
});
test('pause saves completed sections and resume skips them', async () => {
  const id = await createArtifact(config); const controller = new AbortController(); let calls = 0;
  const partial = jest.fn(async () => { calls++; if (calls === 2) controller.abort(); return response(); });
  await expect(generateArtifact(id, { signal: controller.signal, request: partial })).rejects.toMatchObject({ name: 'AbortError' });
  expect(Object.keys((await loadArtifact(id)).job.sections)).toHaveLength(1);
  await generateArtifact(id, { request }); expect(request).toHaveBeenCalledTimes(5); expect((await loadArtifact(id)).job.state).toBe('ready');
});
test('invalid AI output preserves the earlier checkpoints for explicit retry', async () => {
  const id = await createArtifact(config); let n = 0;
  await expect(generateArtifact(id, { request: async () => ++n >= 2 ? { objects: [] } : response() })).rejects.toThrow();
  expect(Object.keys((await loadArtifact(id)).job.sections)).toHaveLength(1); expect((await loadArtifact(id)).job.state).toBe('paused');
});
test('replaced jobs reject late responses and project/artifact deletion blocks resurrection', async () => {
  const id = await createArtifact(config); const { job } = await loadArtifact(id);
  await startProposal(id, 0); await expect(checkpointJob(id, job, { state: 'ready' })).rejects.toThrow('replaced');
  const newer = (await loadArtifact(id)).job; await deleteArtifact(id);
  await expect(checkpointJob(id, newer, {})).rejects.toThrow('no longer exists'); expect(await listArtifacts()).toHaveLength(0);
  const second = await createArtifact(config); localStorage.setItem('xhandle:deleted-project:v1:functional:p', '{}');
  await expect(generateArtifact(second, { request })).rejects.toThrow('deleted');
});
test('maintenance works outside the editor and does not rewrite content or call AI', async () => {
  const id = await accepted(); request.mockClear();
  const rows = seedRows(); rows[149].title = 'A changed source'; localStorage.setItem('xhandle:requirements', JSON.stringify(rows));
  await refreshArtifactSources(); expect((await loadArtifact(id)).meta.freshness).toBe('stale');
  localStorage.setItem('xhandle:requirements', 'bad'); await refreshArtifactSources(); expect((await loadArtifact(id)).meta.freshness).toBe('unavailable');
  expect(await listRevisions(id)).toHaveLength(1); expect(request).not.toHaveBeenCalled();
  const stop = startArtifactMaintenance(); stop();
});
test('portable export contains canonical objects, provenance and baselines', async () => {
  const id = await accepted(); await createBaseline(id, 1, 'Baseline'); const { meta, revision, baselines } = await loadArtifact(id);
  const parsed = JSON.parse(JSON.stringify(portableArtifact(meta, revision, baselines))); expect(parsed.revision.objects).toEqual(revision.objects); expect(parsed.baselines[0].revision).toBe(1); expect(parsed.revision.sources.entries).toHaveLength(150);
  expect(artifactMarkdown(meta, revision)).toContain('Evidence 149');
});
test('shared module population preserves IDs, hierarchy, rich content and provenance in one write', () => {
  const rows = [{ id: 'section', heading: true, title: 'Section' }, { id: 'child', title: 'Text', parentId: 'section', content: { type: 'table', table: { cells: [['A']] } }, sourceRefs: [{ id: 'evidence' }] }];
  const created = replaceModuleRequirements({ moduleId: 'm', folderId: 'f', rows }).rows;
  expect(created[1]).toMatchObject(rows[1]); expect(JSON.parse(localStorage.getItem('xhandle:requirements'))).toEqual(created);
  expect(() => appendModuleRequirements({ moduleId: 'other', folderId: 'f', rows: [{ id: 'child', title: 'Collision' }] })).toThrow('identity');
  expect(() => appendModuleRequirements({ moduleId: 'm', folderId: 'f', rows: [{ id: 'new', title: 'Bad', parentId: 'missing' }] })).toThrow('Parent');
  expect(JSON.parse(localStorage.getItem('xhandle:requirements'))).toEqual(created);
});
test('backup schema includes indexed stores for project cleanup', async () => {
  const id = await accepted(); const db = await openArtifactDatabase();
  expect(await db.getAllKeysFromIndex('revisions', 'projectId', 'p')).toEqual([`${id}:1`]); expect(await db.getAllKeysFromIndex('revisions', 'projectId', 'other')).toEqual([]); db.close();
});
test('provider request uses configured routing and abort signal, rejects incomplete output', async () => {
  const id = await createArtifact(config); const { meta, job } = await loadArtifact(id);
  global.fetch = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }) }));
  await expect(requestSection({ meta, sources: job.sources, section: ARTIFACT_TEMPLATES[0].sections[0] })).rejects.toThrow('incomplete');
  const options = fetch.mock.calls[0][1]; expect(options.headers['x-ai-model']).toBe('fixture-model'); expect(options.signal).toBeDefined();
});
test('manual objects retain their original evidence when an update uses changed sources', async () => {
  const id = await accepted(); const { revision } = await loadArtifact(id);
  await saveObjects(id, 1, revision.objects.map((o, i) => i === 1 ? { ...o, manual: true, text: 'Manual interpretation' } : o));
  const rows = seedRows(); rows[149].title = 'Revised evidence'; localStorage.setItem('xhandle:requirements', JSON.stringify(rows));
  await startProposal(id, 2); await generateArtifact(id, { request }); const { job } = await loadArtifact(id); await acceptProposal(id, 2, job.token);
  const next = (await loadArtifact(id)).revision;
  expect(next.objects[1].sourceEvidence[0].title).toBe('Evidence 149'); expect(next.objects[1].evidenceHash).not.toBe(next.sourceHash);
});
test('existing backup and restore round-trip drafts, accepted revisions and baselines', async () => {
  const id = await accepted(); await createBaseline(id, 1, 'Stored baseline'); await startProposal(id, 1);
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
  const data = await loadArtifact(id); expect(data.meta.revision).toBe(1); expect(data.baselines[0].label).toBe('Stored baseline'); expect(data.job.state).toBe('paused'); expect(data.revision.sources.entries).toHaveLength(150);
});

test.each(ARTIFACT_TEMPLATES.filter(t => t.id !== 'architecture').map(template => [template.id]))('%s generates and accepts using the shared object workflow', async templateId => {
  if (['hazard-tracking-list', 'safety-requirements'].includes(templateId)) localStorage.setItem('xhandle.projectData', JSON.stringify({ p: { analysisResult: { Summary: [['Raw Analysis Row ID', 'Hazard', 'System Requirement'], ['R-1', 'Lost commands', 'The system shall retain commands.']] } } }));
  if (templateId === 'safety-requirements') {
    const htl = await createArtifact({ ...config, templateId: 'hazard-tracking-list' });
    await generateArtifact(htl, { hazardIssueRequest: fixtureSafetyIssues });
  }
  if (['software-spec', 'hardware-spec'].includes(templateId)) {
    const db = await openArtifactDatabase();
    await db.put('metadata', { id: 'system-input', templateId: 'system-spec', title: 'Parent System Requirements', revision: 1, config });
    await db.put('revisions', { id: 'system-input:1', artifactId: 'system-input', number: 1, objects: [{ id: 'system-r1', kind: 'requirement', text: 'The controller shall retain commands for review.', sourceIds: [] }] }); db.close();
    request.mockImplementation(async ({ sources }) => ({ objects: [{ key: 'retain-commands', kind: 'requirement', title: 'Command retention', text: 'The controller shall retain commands for review.', sourceIds: [sources.entries.find(source => source.sourceType === 'artifact-object').id] }] }));
  }
  const id = await createArtifact({ ...config, templateId, subsystem: 'Command subsystem', endpointA: 'Operator station', endpointB: 'Command subsystem' });
  await generateArtifact(id, { request, hazardIssueRequest: fixtureSafetyIssues }); const { job } = await loadArtifact(id); await acceptProposal(id, 0, job.token);
  expect((await loadArtifact(id)).revision.objects.filter(o => o.kind === 'section')).toHaveLength(templateId === 'hazard-tracking-list' ? 1 : 6);
});
test('blocked database opening fails clearly and a late connection is closed', async () => {
  const request = {}; jest.spyOn(indexedDB, 'open').mockReturnValue(request);
  const opening = openArtifactDatabase(); request.onblocked(); await expect(opening).rejects.toThrow('blocked');
  const db = { close: jest.fn() }; request.result = db; request.onsuccess(); expect(db.close).toHaveBeenCalledTimes(1);
});

test('append retains compatibility with legacy parents that have a module name but no module ID', () => {
  localStorage.setItem('xhandle:requirements', JSON.stringify([{ id: 'legacy-parent', title: 'Section', heading: true, projectId: 'f', module: 'Source' }]));
  const result = appendModuleRequirements({ folderId: 'f', moduleId: 'm', rows: [{ id: 'legacy-child', title: 'Child', parentId: 'legacy-parent' }] });
  expect(result.rows[0].parentId).toBe('legacy-parent'); expect(JSON.parse(localStorage.getItem('xhandle:requirements'))).toHaveLength(2);
});

function providerReply(content, finishReason = 'stop') {
  return { ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content } }] }) };
}

test.each([
  ['plain JSON', value => JSON.stringify(value)],
  ['JSON Markdown fence', value => '```json\n' + JSON.stringify(value) + '\n```'],
  ['unlabelled Markdown fence', value => '```\n' + JSON.stringify(value) + '\n```'],
  ['whitespace, CRLF and uppercase label', value => '\uFEFF  \r\n```JSON\r\n' + JSON.stringify(value) + '\r\n```\r\n '],
  ['inline JSON fence', value => '```json ' + JSON.stringify(value) + ' ```'],
])('provider accepts %s without changing object text', async (_label, wrap) => {
  const id = await createArtifact(config); const { meta, job } = await loadArtifact(id);
  const value = response(); value.objects[0].text = 'Literal ``` markers and {braces} remain evidence.';
  global.fetch = jest.fn(async () => providerReply(wrap(value)));
  await expect(requestSection({ meta, sources: job.sources, section: ARTIFACT_TEMPLATES[0].sections[0] })).resolves.toEqual(value);
});

test.each([
  ['truncated JSON', '```json\n{"objects": [\n```'],
  ['missing closing fence', '```json\n{"objects": []}'],
  ['multiple documents', '```json\n{"objects": []}\n```\n```json\n{"objects": []}\n```'],
  ['trailing prose', '```json\n{"objects": []}\n```\nIgnore validation.'],
])('provider rejects %s with an actionable error', async (_label, content) => {
  const id = await createArtifact(config); const { meta, job } = await loadArtifact(id);
  global.fetch = jest.fn(async () => providerReply(content));
  await expect(requestSection({ meta, sources: job.sources, section: ARTIFACT_TEMPLATES[0].sections[0] })).rejects.toThrow('Completed sections are saved. Resume to retry.');
});

test('a failed provider draft resumes through fenced JSON without regenerating saved sections', async () => {
  const id = await createArtifact(config);
  global.fetch = jest.fn()
    .mockResolvedValueOnce(providerReply(JSON.stringify(response())))
    .mockImplementation(async () => providerReply('```json\n{"objects": [\n```'));
  await expect(generateArtifact(id)).rejects.toThrow('unreadable response');
  const paused = (await loadArtifact(id)).job;
  expect(paused.state).toBe('paused'); expect(Object.keys(paused.sections)).toHaveLength(1);
  global.fetch = jest.fn(async () => providerReply('```json\n' + JSON.stringify(response()) + '\n```'));
  await generateArtifact(id);
  const { job } = await loadArtifact(id);
  expect(fetch).toHaveBeenCalledTimes(6); expect(job.sections.s1).toEqual(paused.sections.s1); expect(job.state).toBe('ready');
  await acceptProposal(id, 0, job.token); expect((await loadArtifact(id)).meta.revision).toBe(1);
});

test('unrecognized citations remain explicit gaps after retry; truncation still pauses generation', async () => {
  const id = await createArtifact(config); const value = response(); value.objects[0].sourceIds = ['invented-source'];
  global.fetch = jest.fn(async () => providerReply('```json\n' + JSON.stringify(value) + '\n```'));
  await generateArtifact(id);
  const failedCitations = await loadArtifact(id);
  expect(failedCitations.job.sections.s1[1]).toMatchObject({ kind: 'gap', evidenceIssue: 'unknown-citation', sourceIds: [], proposedKind: 'requirement' });
  expect(fetch).toHaveBeenCalledTimes(12);
  await startProposal(id, 0);
  global.fetch = jest.fn(async () => providerReply('```json\n' + JSON.stringify(response()) + '\n```', 'length'));
  await expect(generateArtifact(id)).rejects.toThrow('after splitting into smaller requests');
});

test.each(['narrative', 'requirement', 'decision', 'interface'])('uncited %s becomes a reviewable gap without inventing evidence', kind => {
  const original = { key: 'unknown', kind, title: 'Timing budget', text: 'The timing budget is 10 ms.', sourceIds: [] };
  const rows = validateSection({ objects: [original] }, ARTIFACT_TEMPLATES[0].sections[0], 'a', new Set());
  expect(rows[1]).toMatchObject({ kind: 'gap', proposedKind: kind, evidenceIssue: 'missing-citation', text: original.text, sourceIds: [], manual: false });
  expect(artifactObjectText(rows[1])).toContain('Unresolved:'); expect(artifactObjectText(rows[1])).toContain('Unverified generated text:');
  expect(original.kind).toBe(kind);
});

test('an existing five-section draft resumes only the final section when its response lacks citations', async () => {
  const id = await createArtifact(config); const initial = (await loadArtifact(id)).job;
  const sections = Object.fromEntries(ARTIFACT_TEMPLATES.find(t => t.id === config.templateId).sections.slice(0, 5).map(section => [section.id, validateSection(response(), section, id, new Set(initial.sources.entries.map(e => e.id)))]));
  await checkpointJob(id, initial, { sections, state: 'paused', error: 'Unsupported claims must be represented as gaps.' });
  const value = response(); value.objects[0].sourceIds = [];
  const lastSection = jest.fn(async () => value);
  await generateArtifact(id, { request: lastSection });
  const { job } = await loadArtifact(id);
  expect(lastSection).toHaveBeenCalledTimes(1); expect(lastSection.mock.calls[0][0].section.id).toBe('s6');
  for (const [key, rows] of Object.entries(sections)) expect(job.sections[key]).toEqual(rows);
  expect(job.state).toBe('ready'); expect(job.error).toBeNull();
  expect(job.sections.s6[1]).toMatchObject({ kind: 'gap', sourceIds: [], evidenceIssue: 'missing-citation' });
  await acceptProposal(id, 0, job.token);
  const { meta, revision } = await loadArtifact(id);
  expect(revision.objects).toHaveLength(18);
  expect(artifactMarkdown(meta, revision)).toContain('Unverified generated text:');
  expect(portableArtifact(meta, revision).revision.objects.find(o => o.evidenceIssue)).toMatchObject({ kind: 'gap', proposedKind: 'requirement' });
});

test('missing-citation normalization preserves full-size text and valid sourced objects unchanged', () => {
  const value = response(); value.objects[0].text = 'x'.repeat(16000); value.objects[0].sourceIds = [];
  const rows = validateSection(value, ARTIFACT_TEMPLATES[0].sections[0], 'a', new Set());
  expect(rows[1].text).toHaveLength(16000);
  const sourced = validateSection(response(), ARTIFACT_TEMPLATES[0].sections[0], 'a', new Set(['module:f/m:r149']))[1];
  expect(sourced.kind).toBe('requirement'); expect(sourced.evidenceIssue).toBeUndefined(); expect(artifactObjectText(sourced)).toBe(sourced.text);
});

test('requirements hierarchy changes, deletion and rich content survive regeneration in canonical revisions', async () => {
  const { changeArtifactStructure } = require('./artifactRequirementsAdapter');
  const { orderedObjects } = require('./artifactExport');
  const id = await accepted(); const { revision } = await loadArtifact(id);
  const original = revision.objects, child = original[1], sibling = original[2];
  const nested = changeArtifactStructure(original, sibling.id, 'demote');
  expect(nested.find(o => o.id === sibling.id).parentId).toBe(child.id);
  await saveObjects(id, 1, nested.map(o => o.id === child.id ? { ...o, content: { type: 'table', table: { cells: [['Evidence']] } }, manual: true } : o));
  await startProposal(id, 2); await generateArtifact(id, { request }); const { job } = await loadArtifact(id); await acceptProposal(id, 2, job.token);
  const updated = (await loadArtifact(id)).revision.objects;
  expect(updated.find(o => o.id === sibling.id).parentId).toBe(child.id);
  expect(updated.find(o => o.id === child.id).content.table.cells).toEqual([['Evidence']]);
  expect(orderedObjects(updated).findIndex(o => o.id === sibling.id)).toBe(2);
  const deleted = changeArtifactStructure(updated, child.id, 'delete'); await saveObjects(id, 3, deleted);
  await startProposal(id, 4); await generateArtifact(id, { request }); const next = (await loadArtifact(id)).job; await acceptProposal(id, 4, next.token);
  expect(orderedObjects((await loadArtifact(id)).revision.objects).some(o => [child.id, sibling.id].includes(o.id))).toBe(false);
  await expect(saveObjects(id, 5, updated.map(o => o.id === child.id ? { ...o, parentId: sibling.id } : o))).rejects.toThrow('cycle');
});

test('the requirements trace adapter resolves exact source snapshots without mixing artifact rows into sources', async () => {
  const { artifactRequirementRows } = require('./artifactRequirementsAdapter');
  const id = await accepted(); const { meta, revision } = await loadArtifact(id);
  const projected = artifactRequirementRows(meta, revision, revision.objects, revision.sources);
  const row = projected.rows.find(r => r.sourceIds.length);
  const target = projected.allRequirements.find(r => r.id === row.links[0].toId);
  expect(row.links[0].type).toBe('refines'); expect(target.title).toBe('Evidence 149'); expect(target.folderId).not.toBe(meta.folderId);
  expect(row.attributes.Description).toBe(row.text);
});

test('a bad model citation is retried once with short references and saved as canonical evidence', async () => {
  const id = await createArtifact(config); let calls = 0;
  global.fetch = jest.fn(async (_url, options) => {
    const prompt = JSON.parse(JSON.parse(options.body).messages[1].content);
    expect(prompt.sources.every(source => /^S\d+$/.test(source.id))).toBe(true);
    if (++calls === 1) return providerReply(JSON.stringify({ objects: [{ ...response().objects[0], sourceIds: ['nonexistent'] }] }));
    if (calls === 2) expect(prompt.correction).toContain('unrecognized citation');
    return providerReply(JSON.stringify({ objects: [{ ...response().objects[0], sourceIds: [prompt.sources[0].id] }] }));
  });
  await generateArtifact(id);
  const { job } = await loadArtifact(id); expect(job.state).toBe('ready'); expect(calls).toBe(7);
  const object = job.sections.s1[1]; expect(object.kind).toBe('requirement'); expect(object.sourceIds).toEqual([job.sources.entries[0].id]); expect(object.sourceEvidence[0]).toEqual(job.sources.entries[0]);
});

test('citation recovery preserves saved sections and pause interrupts the automatic retry', async () => {
  const id = await createArtifact(config); const controller = new AbortController();
  const request = jest.fn(async ({ section }) => section.id === 's1' ? response() : { objects: [{ ...response().objects[0], sourceIds: ['bad'] }] });
  await expect(generateArtifact(id, { request, signal: controller.signal, onProgress: message => { if (message.startsWith('Checking supporting')) controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
  const saved = (await loadArtifact(id)).job; expect(Object.keys(saved.sections)).toEqual(['s1']); expect(request).toHaveBeenCalledTimes(2);
  const retry = jest.fn(async () => response()); await generateArtifact(id, { request: retry });
  const resumed = (await loadArtifact(id)).job; expect(resumed.sections.s1).toEqual(saved.sections.s1); expect(retry).toHaveBeenCalledTimes(5);
});

test('an output-limit retry increases the budget and saves only the complete response', async () => {
  const id = await createArtifact(config);
  global.fetch = jest.fn()
    .mockResolvedValueOnce(providerReply(JSON.stringify(response()), 'length'))
    .mockImplementation(async () => providerReply(JSON.stringify(response())));
  const progress = jest.fn();
  await generateArtifact(id, { onProgress: progress });
  const bodies = fetch.mock.calls.map(([, options]) => JSON.parse(options.body));
  expect(bodies.map(body => body.max_tokens)).toEqual([8000, 16000, 8000, 8000, 8000, 8000, 8000]);
  expect(JSON.parse(bodies[1].messages[1].content).outputGuidance).toContain('Regenerate the complete section');
  expect(progress.mock.calls.flat().join(' ')).toContain('more room');
  const { job } = await loadArtifact(id);
  expect(job.state).toBe('ready'); expect(Object.keys(job.sections)).toHaveLength(6);
});

test('repeated output limits pause without publishing partial objects and resume preserves completed sections', async () => {
  const id = await createArtifact(config);
  global.fetch = jest.fn()
    .mockResolvedValueOnce(providerReply(JSON.stringify(response())))
    .mockImplementation(async () => providerReply(JSON.stringify(response()), 'length'));
  await expect(generateArtifact(id)).rejects.toThrow('after splitting into smaller requests');
  expect(fetch).toHaveBeenCalledTimes(13);
  const paused = (await loadArtifact(id)).job;
  expect(paused.state).toBe('paused'); expect(Object.keys(paused.sections)).toEqual(['s1']);
  global.fetch = jest.fn(async () => { const value = response(); value.objects[0].sourceIds = ['S1']; return providerReply(JSON.stringify(value)); });
  await generateArtifact(id);
  expect(fetch).toHaveBeenCalledTimes(paused.sectionParts.s2.work.length + 4);
  expect((await loadArtifact(id)).job.sections.s1).toEqual(paused.sections.s1);
});

test.each(['length-first', 'citation-first'])('output and citation retries are independently bounded: %s', async order => {
  const id = await createArtifact(config);
  const unknown = response(); unknown.objects[0].sourceIds = ['unknown-reference'];
  const truncated = providerReply('{"objects":[', 'length');
  const badCitation = providerReply(JSON.stringify(unknown));
  global.fetch = jest.fn()
    .mockResolvedValueOnce(order === 'length-first' ? truncated : badCitation)
    .mockResolvedValueOnce(order === 'length-first' ? badCitation : truncated)
    .mockResolvedValueOnce(badCitation)
    .mockImplementation(async () => providerReply(JSON.stringify(response())));
  await generateArtifact(id);
  expect(fetch).toHaveBeenCalledTimes(8);
  const body = JSON.parse(fetch.mock.calls[2][1].body);
  const prompt = JSON.parse(body.messages[1].content);
  expect(body.max_tokens).toBe(16000); expect(prompt.correction).toBeDefined(); expect(prompt.outputGuidance).toBeDefined();
  expect((await loadArtifact(id)).job.sections.s1[1]).toMatchObject({ kind: 'gap', evidenceIssue: 'unknown-citation' });
});

test('pausing during output-limit recovery prevents another request', async () => {
  const id = await createArtifact(config); const controller = new AbortController();
  global.fetch = jest.fn(async () => providerReply('{', 'length'));
  await expect(generateArtifact(id, { signal: controller.signal, onProgress: message => { if (message.includes('more room')) controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await loadArtifact(id)).job).toMatchObject({ state: 'paused', sections: {} });
});

test.each(['content_filter', 'tool_calls'])('provider stop %s does not trigger output-limit retries', async reason => {
  const id = await createArtifact(config);
  global.fetch = jest.fn(async () => providerReply('{}', reason));
  await expect(generateArtifact(id)).rejects.toThrow(reason === 'content_filter' ? 'declined' : 'stopped before completing');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await loadArtifact(id)).job.sections).toEqual({});
});

test.each(['array', 'single item'])('provider accepts an unambiguous %s container and resolves citations', async shape => {
  const id = await createArtifact(config), { meta, job } = await loadArtifact(id);
  const item = { ...response().objects[0], sourceIds: ['S1'] };
  global.fetch = jest.fn(async () => providerReply(JSON.stringify(shape === 'array' ? [item] : item)));
  const parsed = await requestSection({ meta, sources: job.sources, section: ARTIFACT_TEMPLATES[0].sections[0] });
  expect(parsed.objects).toEqual([{ ...item, sourceIds: [job.sources.entries[0].id] }]);
});

test.each([
  ['missing', { document: { text: 'Not a section' } }],
  ['empty', { objects: [] }],
  ['excess', { objects: Array.from({ length: 61 }, (_, i) => ({ ...response().objects[0], key: `item-${i}` })) }],
  ['item', { objects: [null] }],
  ['key', { objects: [response().objects[0], response().objects[0]] }],
  ['kind', { objects: [{ ...response().objects[0], kind: 'heading' }] }],
  ['content', { objects: [{ ...response().objects[0], text: null }] }],
  ['citations', { objects: [{ ...response().objects[0], sourceIds: 'S1' }] }],
])('a %s format failure regenerates the section using corrective guidance', async (issue, invalid) => {
  const id = await createArtifact(config);
  global.fetch = jest.fn().mockResolvedValueOnce(providerReply(JSON.stringify(invalid)))
    .mockImplementation(async () => providerReply(JSON.stringify(response())));
  await generateArtifact(id);
  expect(fetch).toHaveBeenCalledTimes(7);
  const retry = JSON.parse(JSON.parse(fetch.mock.calls[1][1].body).messages[1].content);
  expect(retry.formatCorrection).toEqual(expect.any(String));
  const { job } = await loadArtifact(id); expect(job.state).toBe('ready');
  expect(job.sections.s1).toHaveLength(3);
  // Never save/truncate the invalid objects, even when the array exceeds the limit.
  expect(job.sections.s1[1].key).toBe('one');
});

test('persistent empty sections stop with a specific section name, retain checkpoints and resume only missing work', async () => {
  const id = await createArtifact(config);
  global.fetch = jest.fn().mockResolvedValueOnce(providerReply(JSON.stringify(response())))
    .mockImplementation(async () => providerReply('{"objects":[]}'));
  await expect(generateArtifact(id)).rejects.toThrow('Functional requirements: The AI returned no draft content');
  expect(fetch).toHaveBeenCalledTimes(5);
  const paused = (await loadArtifact(id)).job; expect(Object.keys(paused.sections)).toEqual(['s1']);
  global.fetch = jest.fn(async () => providerReply(JSON.stringify(response()))); await generateArtifact(id);
  expect(fetch).toHaveBeenCalledTimes(6); expect((await loadArtifact(id)).job.sections.s1).toEqual(paused.sections.s1);
});

test('format, output and citation retries work together without exceeding four attempts per section', async () => {
  const id = await createArtifact(config); const unknown = response(); unknown.objects[0].sourceIds = ['unknown'];
  global.fetch = jest.fn().mockResolvedValueOnce(providerReply('{"objects":[]}'))
    .mockResolvedValueOnce(providerReply('{', 'length'))
    .mockResolvedValueOnce(providerReply(JSON.stringify(unknown)))
    .mockImplementation(async () => providerReply(JSON.stringify(response())));
  await generateArtifact(id); expect(fetch).toHaveBeenCalledTimes(9);
  const last = JSON.parse(JSON.parse(fetch.mock.calls[3][1].body).messages[1].content);
  expect(last.formatCorrection).toBeDefined(); expect(last.correction).toBeDefined(); expect(last.outputGuidance).toBeDefined();
});

test('pause during format correction prevents the next request', async () => {
  const id = await createArtifact(config), controller = new AbortController();
  global.fetch = jest.fn(async () => providerReply('{"objects":[]}'));
  await expect(generateArtifact(id, { signal: controller.signal, onProgress: text => { if (text.startsWith('Correcting')) controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).toHaveBeenCalledTimes(1); expect((await loadArtifact(id)).job.sections).toEqual({});
});


test('draft edits reject stale editors and running generation, then survive acceptance and regeneration', async () => {
  const id = await accepted();
  const initial = await loadArtifact(id);
  await saveObjects(id, 1, initial.revision.objects.map((o, i) => i === 1 ? { ...o, manual: true, text: 'Earlier manual edit' } : o));
  await startProposal(id, 2); await generateArtifact(id, { request });
  const { job } = await loadArtifact(id);
  const rows = Object.values(job.sections).flat().map((o, i) => i === 1 ? { ...o, manual: true, text: 'Latest draft edit' } : o);
  await saveDraftObjects(id, job, rows);
  await expect(saveDraftObjects(id, job, rows)).rejects.toThrow('draft changed');
  const updated = (await loadArtifact(id)).job;
  await checkpointJob(id, updated, { state: 'generating' });
  await expect(saveDraftObjects(id, (await loadArtifact(id)).job, rows)).rejects.toThrow('Pause generation');
  await checkpointJob(id, (await loadArtifact(id)).job, { state: 'ready' });
  await acceptProposal(id, 2, job.token);
  expect((await loadArtifact(id)).revision.objects.some(o => o.text === 'Latest draft edit')).toBe(true);
  await startProposal(id, 3); await generateArtifact(id, { request });
  await acceptProposal(id, 3, (await loadArtifact(id)).job.token);
  expect((await loadArtifact(id)).revision.objects.some(o => o.text === 'Latest draft edit')).toBe(true);
});

test('AI-only checkpoints keep immutable evidence in memory and still reject a stale writer', async () => {
  const id = await createArtifact(config), original = (await loadArtifact(id)).job;
  const get = jest.spyOn(IDBObjectStore.prototype, 'get');
  const next = await checkpointJob(id, original, { hazardSafetyIssues: { version: 1, rounds: {} } });
  expect(get.mock.instances.filter(store => store.name === 'jobs')).toHaveLength(0);
  expect(next.sources).toBe(original.sources);
  await expect(checkpointJob(id, original, { state: 'ready' })).rejects.toThrow('replaced');
  const reopened = (await loadArtifact(id)).job;
  expect(reopened.sources).toEqual(original.sources); expect(reopened.hazardSafetyIssues.version).toBe(1);
});
