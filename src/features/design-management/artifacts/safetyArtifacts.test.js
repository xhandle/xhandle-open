import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { randomUUID, webcrypto } from 'crypto';
import { saveProjectHazardAnalysisRecord, deleteProjectHazardAnalysisRecord } from '../../project-hazard-analysis/projectHazardAnalysisStorage';
import { saveCodeArchitectureHazardRun } from '../../code-architecture-hazard-analysis/codeArchitectureHazardStore';
import { openHazardSchema } from '../../code-architecture-hazard-analysis/hazardSchema';
import { captureHazardAnalysisSources, readHazardAnalysisAvailability } from './hazardAnalysisSources';
import { artifactStorageSnapshot, captureLiveSources } from './artifactSources';
import { createArtifact, loadArtifact, listArtifacts, acceptProposal, saveDraftObjects, startProposal, deleteArtifact, checkpointJob, writeArtifactStorage, listRevisions } from './artifactRepository';
import { createEngineeringProject, loadEngineeringProject, acceptEngineeringProject } from './engineeringProjectRepository';
import { generateArtifact } from './artifactGeneration';
import { generateEngineeringProject } from './engineeringProjectGeneration';
import { artifactMarkdown } from './artifactExport';
import { HAZARD_TRACKING_COLUMNS } from './hazardTrackingFields';
import { consolidateHazardRows } from './consolidateHazardRows';
import { requestSafetyIssueConsolidation } from '../../project-hazard-analysis/safetyIssueGeneration';
import { fixtureSafetyIssues } from '../../project-hazard-analysis/testHelpers/safetyIssueFixtures';
import { createGenerationBudget } from './generationBudget';
import { engineeringProjectTrace } from './engineeringProjectModel';
import { getTemplate } from './artifactModel';
import { artifactDocumentSize, DOCUMENT_CONTENT_LIMIT } from './artifactSize';

jest.mock('../../project-hazard-analysis/safetyIssueGeneration', () => ({ ...jest.requireActual('../../project-hazard-analysis/safetyIssueGeneration'), requestSafetyIssueConsolidation: jest.fn() }));

const owner = { id: 'p', workspaceType: 'functional' };
const codeOwner = { id: 'p', workspaceType: 'code-architecture' };
const headers = ['Raw Analysis Row ID', 'Canonical Hazard ID', 'Hazard', 'System Requirement', 'Safety Constraint', 'Mitigation Strategy', 'Severity', 'Residual Risk', 'Closure Status', 'Verification Method', 'Guide Phrase Applicable'];
const row = (id = 'R-1') => [id, 'H-1', 'Lost operator commands', 'The controller shall retain the last valid command.', 'The controller must not execute an expired command.', 'Reject expired commands.', 'S3', 'Unassessed', 'Open', 'Fault injection', 'Yes'];
const summary = () => [headers, row(), ['R-2', 'H-2', 'Invalid microphone data', '', '', 'Consider a watchdog.', '', '', '', '', 'Yes'], ['R-3', '', '', '', '', '', '', '', '', '', 'No']];
const config = (templateId = 'hazard-tracking-list', workspaceType = 'functional') => ({ templateId, title: templateId, folderId: 'f', projectId: 'p', workspaceType, system: 'Mission', sources: [], notes: '' });
const saveFunctional = (Summary = summary()) => saveProjectHazardAnalysisRecord('p', { analysisResult: { Summary }, riskRegister: [{ id: 'ISSUE-1', title: 'Lost commands', severity: 4, likelihood: 2, status: 'In progress', owner: 'Controls', sourceRowIds: ['R-1'] }] });
const requirementRequest = async ({ sources, section }) => ({ objects: section.id === 's2'
  ? [{ key: 'retain-command', kind: 'requirement', title: 'Reject expired commands', text: 'The controller shall reject expired commands.', sourceIds: sources.entries.filter(source => source.sourceType === 'hazard-tracking-record' && source.attributes['Safety Constraint'].length).map(source => source.id) }]
  : [{ key: 'context', kind: 'narrative', title: section.title, text: 'Consolidated safety concern coverage for review.', sourceIds: sources.entries.filter(source => source.sourceType === 'hazard-tracking-record').map(source => source.id) }] });
async function readyHTL(workspaceType = 'functional') {
  const id = await createArtifact(config('hazard-tracking-list', workspaceType));
  await generateArtifact(id); return id;
}
const saveCode = (patch = {}) => saveCodeArchitectureHazardRun({ id: 'run-1', projectId: 'p', repoId: 'controller', hazardMethod: 'HARA', runState: 'complete', createdAt: '2026-11-12T13:00:00Z', updatedAt: '2026-11-12T13:00:00Z', generatedSheets: { Summary: [headers, row('CODE-1')] }, ...patch });
beforeEach(() => {
  requestSafetyIssueConsolidation.mockImplementation(fixtureSafetyIssues);
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID, getRandomValues: array => webcrypto.getRandomValues(array) } });
  localStorage.clear();
  localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Mission' }, { id: 'other', name: 'Other' }]));
  localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([{ id: 'p', name: 'Controller', repos: [{ id: 'controller', repoId: 'controller' }] }]));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Safety', modules: [] }]));
});
afterEach(() => jest.restoreAllMocks());

test('hazard tracking requires hazard analysis even when source notes are supplied', async () => {
  const templateId = 'hazard-tracking-list';
  await expect(createArtifact({ ...config(templateId), notes: 'Invented hazards cannot substitute for analysis.' })).rejects.toThrow(/Perform hazard analysis.*Mission.*Projects/);
  expect(await listArtifacts()).toEqual([]);
  await expect(createArtifact(config(templateId, 'code-architecture'))).rejects.toThrow(/Perform hazard analysis.*Controller.*Code-Based Architecture/);
});

test('hazard tracking preserves every assessment with only the selected fields, source identity and coverage', async () => {
  await saveFunctional(); const request = jest.fn();
  const id = await createArtifact(config()); await generateArtifact(id, { request });
  let data = await loadArtifact(id); expect(request).not.toHaveBeenCalled();
  expect(data.job.sources.entries).toHaveLength(3);
  const hazardRows = data.job.sections.s2.filter(object => object.kind !== 'section');
  expect(hazardRows).toHaveLength(3);
  expect(hazardRows.map(object => object.sourceEvidence[0].sourceRowId)).toEqual(['R-1', 'R-2', 'R-3']);
  expect(hazardRows[0].attributes).toEqual({ Hazard: row()[2], 'Guide Phrase Applicable': 'Yes', 'Safety Constraint': row()[4], Verification: 'Fault injection' });
  expect(hazardRows[0].sourceEvidence[0].relatedSafetyIssues).toBeUndefined();
  expect(hazardRows.every(object => Object.keys(object.attributes).every(column => HAZARD_TRACKING_COLUMNS.includes(column)))).toBe(true);
  expect(JSON.stringify(data.job.sources)).not.toContain('Unassessed');
  expect(Object.keys(data.job.sections)).toEqual(['s2']);
  expect(hazardRows.every(object => object.text === '')).toBe(true);
  await acceptProposal(id, 0, data.job.token); data = await loadArtifact(id);
  expect(artifactMarkdown(data.meta, data.revision)).toContain(row()[4]);
  expect(artifactMarkdown(data.meta, data.revision)).not.toContain('Reject expired commands.');
  expect(data.revision.objects.every(object => !object.sourceIds.length || object.sourceEvidence.every(source => source.sourceType === 'hazard-analysis-row'))).toBe(true);
});

test('safety requirements synthesize consolidated HTRs, preserve traceability and expose coverage gaps', async () => {
  await saveFunctional(); const htl = await readyHTL();
  const id = await createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: htl });
  const request = jest.fn(requirementRequest);
  await generateArtifact(id, { request });
  const { job } = await loadArtifact(id);
  expect(job.sources.entries).toHaveLength(2);
  expect(job.sources.entries.every(source => source.sourceType === 'hazard-tracking-record')).toBe(true);
  expect(job.sources.entries[0]).toMatchObject({ artifactId: htl, recordId: 'HTR-1' });
  expect(job.sources.entries[0].attributes['Safety Constraint']).toEqual([row()[4]]);
  expect(request.mock.calls.every(([args]) => args.sources.entries.filter(source => source.sourceType === 'hazard-tracking-record').every(source => Object.keys(source.attributes).every(field => ['HTR', 'Safety Constraint'].includes(field))))).toBe(true);
  expect(job.sources.entries[0].attributes.Verification).toEqual(['Fault injection']);
  expect(JSON.stringify(job.sources)).not.toContain('hazard-analysis-row');
  const requirements = job.sections.s2.filter(object => object.kind === 'requirement');
  expect(requirements).toHaveLength(1);
  expect(requirements[0]).toMatchObject({ text: 'The controller shall reject expired commands.', attributes: { HTR: 'HTR-1', Verification: 'Fault injection' } });
  expect(job.sections.s6.some(object => object.kind === 'gap' && object.title === 'Safety constraint missing')).toBe(true);
  expect(job.sections.s6.some(object => object.kind === 'gap' && object.title === 'Verification method missing')).toBe(true);
  await acceptProposal(id, 0, job.token);
  expect((await loadArtifact(id)).revision.sources.entries[0].artifactId).toBe(htl);
});

test('older shall paragraphs become child objects, preserving evidence through editing and acceptance', async () => {
  await saveFunctional(); const htl = await readyHTL();
  const id = await createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: htl });
  await generateArtifact(id, { request: requirementRequest });
  const legacy = (await loadArtifact(id)).job;
  await checkpointJob(id, legacy, { sections: { ...legacy.sections, s2: legacy.sections.s2.map(object => object.kind === 'requirement' ? { ...object, title: 'Command validity', text: 'The controller shall reject expired commands and shall report the rejection. The controller shall retain the last valid command.' } : object) } });
  let data = await loadArtifact(id);
  const topic = data.job.sections.s2.find(object => object.title === 'Command validity');
  const children = data.job.sections.s2.filter(object => object.parentId === topic.id);
  expect(topic).toMatchObject({ kind: 'section', text: '' });
  expect(children.map(object => object.text)).toEqual(['The controller shall reject expired commands.', 'The controller shall report the rejection.', 'The controller shall retain the last valid command.']);
  expect(children.every(object => object.kind === 'requirement' && object.attributes.HTR === 'HTR-1' && object.sourceEvidence[0].sourceType === 'hazard-tracking-record')).toBe(true);
  const updatedText = 'The controller shall report the rejection to the operator.';
  await saveDraftObjects(id, data.job, Object.values(data.job.sections).flat().map(object => object.id === children[1].id ? { ...object, text: updatedText, manual: true } : object));
  data = await loadArtifact(id);
  expect(data.job.sections.s2.filter(object => object.parentId === topic.id)).toHaveLength(3);
  expect(data.job.sections.s2.find(object => object.id === children[1].id)).toMatchObject({ text: updatedText, manual: true });
  expect(data.job.sections.s2.find(object => object.id === children[0].id)).toEqual(children[0]);
  await acceptProposal(id, 0, data.job.token);
  const accepted = await loadArtifact(id);
  expect(accepted.revision.objects.filter(object => object.parentId === topic.id)).toHaveLength(3);
  expect(artifactMarkdown(accepted.meta, accepted.revision)).toContain(updatedText);
});

test('Safety Requirements retries dependent wording once and saves complete independently understandable requirements', async () => {
  await saveFunctional(); const htl = await readyHTL();
  const id = await createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: htl });
  const request = jest.fn(async args => {
    if (args.section.id !== 's2') return requirementRequest(args);
    const response = await requirementRequest(args);
    return { objects: response.objects.map(object => ({ ...object, text: args.writingCorrection ? 'The controller shall reject expired commands.' : 'otherwise no command shall be executed.' })) };
  });
  await generateArtifact(id, { request });
  const calls = request.mock.calls.filter(([args]) => args.section.id === 's2');
  expect(calls).toHaveLength(2);
  expect(calls[1][0].writingCorrection.instruction).toContain('standalone sentence');
  const { job } = await loadArtifact(id);
  expect(job.state).toBe('ready');
  const requirement = job.sections.s2.find(object => object.kind === 'requirement');
  expect(requirement).toMatchObject({ text: 'The controller shall reject expired commands.', attributes: { HTR: 'HTR-1' } });
  expect(requirement.requirementWritingIssues || []).toEqual([]);
});

test('generation rewrites bundled requirements before materialization rather than accepting a mechanically split response', async () => {
  await saveFunctional(); const htl = await readyHTL();
  const id = await createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: htl });
  const request = jest.fn(async args => {
    const response = await requirementRequest(args);
    if (args.section.id !== 's2') return response;
    if (!args.writingCorrection) return { objects: [{ ...response.objects[0], text: 'The controller shall reject expired commands and shall report rejection.' }] };
    return { objects: [
      { ...response.objects[0], key: 'reject-command', text: 'The controller shall reject expired commands.' },
      { ...response.objects[0], key: 'report-rejection', text: 'The controller shall report rejected commands to the operator.' },
    ] };
  });
  await generateArtifact(id, { request });
  expect(request.mock.calls.filter(([args]) => args.section.id === 's2')).toHaveLength(2);
  const { job } = await loadArtifact(id);
  const requirements = job.sections.s2.filter(object => object.kind === 'requirement');
  expect(requirements.map(object => object.text)).toEqual(['The controller shall reject expired commands.', 'The controller shall report rejected commands to the operator.']);
  expect(requirements.every(object => !object.atomicRequirement && object.parentId === `${id}:s2` && object.attributes.HTR === 'HTR-1')).toBe(true);
});

test('unresolved requirement writing becomes a review gap after one correction rather than an endless generation retry', async () => {
  await saveFunctional(); const htl = await readyHTL();
  const id = await createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: htl });
  const request = jest.fn(async args => {
    const response = await requirementRequest(args);
    return args.section.id === 's2' ? { objects: response.objects.map(object => ({ ...object, text: 'The controller shall reject commands after that limit.' })) } : response;
  });
  await generateArtifact(id, { request });
  expect(request.mock.calls.filter(([args]) => args.section.id === 's2')).toHaveLength(2);
  const { job } = await loadArtifact(id);
  expect(job.state).toBe('ready');
  expect(job.sections.s2.find(object => object.proposedKind === 'requirement')).toMatchObject({ kind: 'gap', evidenceIssue: 'requirement-writing', text: 'The controller shall reject commands after that limit.', sourceIds: [job.sources.entries[0].id] });
  expect(job.sections.s6.some(object => object.title === 'Safety requirement coverage needs review')).toBe(true);
});

test('reopening an older saved draft organizes requirements once without regeneration or changing its checkpoint identity', async () => {
  await saveFunctional(); const htl = await readyHTL();
  const id = await createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: htl });
  await generateArtifact(id, { request: requirementRequest });
  const initial = (await loadArtifact(id)).job;
  const sections = { ...initial.sections, s2: initial.sections.s2.map(object => object.kind === 'requirement' ? { ...object, title: 'Command validity', text: 'The controller shall reject expired commands. The controller shall retain the last valid command.' } : object) };
  const checkpoint = await checkpointJob(id, initial, { sections, state: 'paused', error: 'Saved draft retained.' });
  const reopened = await loadArtifact(id);
  expect(reopened.job).toMatchObject({ token: checkpoint.token, version: checkpoint.version + 1, state: 'paused', error: 'Saved draft retained.', sources: checkpoint.sources });
  const topic = reopened.job.sections.s2.find(object => object.title === 'Command validity');
  expect(reopened.job.sections.s2.filter(object => object.parentId === topic.id)).toHaveLength(2);
  expect((await loadArtifact(id)).job).toEqual(reopened.job);
});

test('older accepted requirement paragraphs receive a structured revision while their original revision remains intact', async () => {
  await saveFunctional(); const htl = await readyHTL();
  const id = await createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: htl });
  await generateArtifact(id, { request: requirementRequest });
  await acceptProposal(id, 0, (await loadArtifact(id)).job.token);
  const original = (await loadArtifact(id)).revision;
  const topic = original.objects.find(object => object.kind === 'requirement');
  const legacy = { ...original, objects: original.objects.map(object => object.id === topic.id ? { ...object, text: 'The controller shall reject expired commands. The controller shall retain the last valid command.' } : object) };
  // Simulate a revision saved before individual child requirements were supported.
  await writeArtifactStorage(['revisions'], tx => tx.objectStore('revisions').put(legacy));
  const reopened = await loadArtifact(id);
  expect(reopened.meta.revision).toBe(2);
  expect(reopened.revision.objects.filter(object => object.parentId === topic.id)).toHaveLength(2);
  expect((await listRevisions(id)).find(revision => revision.number === 1)).toEqual(legacy);
  expect((await loadArtifact(id)).meta.revision).toBe(2);
});

test('Safety Requirements requires a completed consolidated HTL and explicit selection when multiple match', async () => {
  await saveFunctional();
  await expect(createArtifact(config('safety-requirements'))).rejects.toThrow('Create and consolidate a Hazard Tracking List');
  const pending = await createArtifact(config());
  await expect(createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: pending })).rejects.toThrow('Finish generating and consolidating');
  await generateArtifact(pending);
  const other = await readyHTL();
  await expect(createArtifact(config('safety-requirements'))).rejects.toThrow('Select the consolidated Hazard Tracking List');
  await expect(createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: other, projectId: 'other' })).rejects.toThrow('Create and consolidate');
  const id = await createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: pending });
  expect((await loadArtifact(id)).job.sources.entries.every(source => source.artifactId === pending)).toBe(true);
});

test('changing or removing the source HTL prevents accepting outdated Safety Requirements', async () => {
  await saveFunctional(); const htl = await readyHTL();
  const id = await createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: htl });
  await generateArtifact(id, { request: requirementRequest });
  const data = await loadArtifact(id), source = await loadArtifact(htl);
  const changed = Object.values(source.job.sections).flat().map(object => object.hazardTrackingRow && object.attributes['Safety Constraint'] ? { ...object, attributes: { ...object.attributes, 'Safety Constraint': 'Reject commands with invalid sequence numbers.' } } : object);
  await saveDraftObjects(htl, source.job, changed);
  await expect(acceptProposal(id, 0, data.job.token)).rejects.toThrow('Finish consolidating');
  await deleteArtifact(htl);
  await expect(startProposal(id, 0)).rejects.toThrow('Create and consolidate');
});

test('Safety Requirements resumes an oversized HTR review without replacing sources or losing completed pieces', async () => {
  const records = Array.from({ length: 240 }, (_, index) => {
    const record = row(`COMMAND-${index}`);
    record[4] = `The controller must reject expired commands in condition ${index}. ${'Retain the recorded acceptance criteria. '.repeat(30)}`;
    return record;
  });
  await saveFunctional([headers, ...records]); const htl = await readyHTL();
  const id = await createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: htl });
  const before = await loadArtifact(id);
  expect(before.job.sources.entries).toHaveLength(1);
  expect(JSON.stringify(before.job.sources.entries[0].attributes).length).toBeGreaterThan(90000);
  let reviews = 0, pause = true;
  const request = jest.fn(async args => {
    if (args.task !== 'evidence-review') return { objects: [{ key: 'command', kind: args.section.id === 's2' ? 'requirement' : 'narrative', title: 'Reject expired commands', text: 'The controller shall reject expired commands.', sourceIds: args.sources.entries.map(source => source.id) }] };
    reviews++;
    if (pause && reviews === 2) throw new Error('Interrupted test review');
    expect(args.sources.entries.every(source => source.reviewSourceId === before.job.sources.entries[0].id)).toBe(true);
    return { objects: [{ key: 'command-constraint', kind: 'requirement', title: 'Reject expired commands', text: 'The controller shall reject expired commands under the recorded operating conditions.', sourceIds: args.sources.entries.map(source => source.id) }] };
  });
  await expect(generateArtifact(id, { request })).rejects.toThrow('Interrupted test review');
  const paused = await loadArtifact(id);
  expect(Object.keys(paused.job.evidenceBrief.rounds[0].completed)).toEqual(['0']);
  expect(paused.job.evidenceBrief.rounds[0].completed[0][0].sourceIds).toEqual([before.job.sources.entries[0].id]);
  const firstParts = request.mock.calls[0][0].sources.entries.map(source => source.id);
  pause = false; request.mockClear();
  const budget = createGenerationBudget(undefined, { requestLimit: 1 });
  try { await generateArtifact(id, { request, budget }); } finally { budget.close(); }
  const ready = await loadArtifact(id);
  expect(ready.job.state).toBe('ready');
  expect(ready.job.sources).toEqual(before.job.sources);
  expect(request.mock.calls.filter(([args]) => args.task === 'evidence-review').every(([args]) => !args.sources.entries.some(source => firstParts.includes(source.id)))).toBe(true);
  const requirement = ready.job.sections.s2.find(object => object.kind === 'requirement');
  expect(requirement.sourceIds).toEqual([before.job.sources.entries[0].id]);
  expect(requirement.sourceEvidence[0].sourceType).toBe('hazard-tracking-record');
  expect(requirement.attributes.HTR).toBe('HTR-1');
  await acceptProposal(id, 0, ready.job.token);
  expect((await loadArtifact(id)).revision.number).toBe(1);
});

test('a Safety Requirements draft stuck at pass eight completes with every recorded requirement retained', async () => {
  const records = Array.from({ length: 75 }, (_, index) => { const record = row(`LIMIT-${index}`); record[4] = `The controller shall reject expired commands after ${index + 1} ms.`; return record; });
  await saveFunctional([headers, ...records]); const htl = await readyHTL();
  const id = await createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: htl });
  const initial = (await loadArtifact(id)).job, source = initial.sources.entries[0];
  const candidates = records.map((record, index) => ({ key: `limit-${index}`, title: `Recorded deadline ${index + 1}`, text: record[4], kind: 'requirement', sourceIds: [source.id] }));
  const scope = [{ id: `${id}:s1`, sectionId: 's1', parentId: null, title: 'Scope and source analyses', text: '', kind: 'section', sourceIds: [], manual: false }];
  await checkpointJob(id, initial, { sections: { s1: scope }, sectionSynthesis: { s2: { version: 1, sourceHash: initial.sources.hash, candidates, round: 8, completed: {} } }, state: 'paused', error: 'Safety requirements: The AI has not produced a concise synthesis after eight saved consolidation passes.' });
  const request = jest.fn(async args => {
    expect(args.task).not.toBe('evidence-review'); expect(args.section.id).not.toBe('s1');
    if (args.task !== 'section-consolidation') return requirementRequest(args);
    expect(args.part.targetItems).toBeLessThanOrEqual(8);
    return { objects: args.sources.entries.map((entry, index) => ({ key: `kept-${index}`, title: entry.title, text: entry.text, kind: entry.kind, sourceIds: [entry.id] })) };
  });
  await generateArtifact(id, { request });
  const { job } = await loadArtifact(id);
  expect(job.state).toBe('ready'); expect(job.sections.s1).toEqual(scope);
  expect(job.sections.s2.filter(object => object.kind === 'requirement').map(object => object.text).sort()).toEqual(candidates.map(candidate => candidate.text).sort());
  expect(job.sections.s2.some(object => object.key === 'consolidation-review' && object.kind === 'gap')).toBe(true);
  expect(job.sections.s2.filter(object => object.kind === 'requirement').every(object => object.attributes.HTR === 'HTR-1')).toBe(true);
  await acceptProposal(id, 0, job.token);
  expect((await loadArtifact(id)).revision.number).toBe(1);
});

test('a completed draft blocked by repeated verification metadata resumes and accepts without any AI requests', async () => {
  const records = Array.from({ length: 150 }, (_, index) => {
    const record = row(`VERIFY-${index}`);
    record[9] = `Method ${index}: ${'Recorded verification criteria. '.repeat(32)}`;
    return record;
  });
  await saveFunctional([headers, ...records]); const htl = await readyHTL();
  const id = await createArtifact({ ...config('safety-requirements'), hazardTrackingArtifactId: htl });
  const initial = (await loadArtifact(id)).job, source = initial.sources.entries[0];
  const verification = source.attributes.Verification.join('\n');
  const sections = Object.fromEntries(getTemplate('safety-requirements').sections.map(section => [section.id, [{ id: `${id}:${section.id}`, sectionId: section.id, parentId: null, title: section.title, text: '', kind: 'section', sourceIds: [], manual: false }]]));
  sections.s2.push(...Array.from({ length: 150 }, (_, index) => ({ id: `${id}:s2:requirement-${index}`, key: `requirement-${index}`, sectionId: 's2', parentId: `${id}:s2`, title: `Protective action ${index}`, text: `The controller shall retain the valid command for recorded operating case ${index}.`, kind: 'requirement', sourceIds: [source.id], sourceEvidence: [source], evidenceHash: initial.sources.hash, manual: false, attributes: { HTR: source.recordId, Verification: verification } })));
  expect(artifactDocumentSize(Object.values(sections).flat()).content).toBeGreaterThan(DOCUMENT_CONTENT_LIMIT);
  await checkpointJob(id, initial, { sections, state: 'paused', error: 'Safety Requirements contains 21.8 million characters of document content, above the saved-document limit of 20.0 million characters. Saved sections are retained.' });
  const request = jest.fn();
  await generateArtifact(id, { request });
  const { job } = await loadArtifact(id);
  expect(request).not.toHaveBeenCalled(); expect(job.state).toBe('ready');
  expect(job.sources).toEqual(initial.sources);
  expect(Object.values(job.sections).flat().map(object => object.text)).toEqual(Object.values(sections).flat().map(object => object.text));
  expect(artifactDocumentSize(Object.values(job.sections).flat()).content).toBeLessThan(500000);
  expect(job.sections.s2[1].sourceEvidence[0].attributes.Verification).toEqual(source.attributes.Verification);
  expect(job.sections.s2[1].attributes.Verification).toBe('150 recorded verification methods — see linked HTR evidence.');
  await acceptProposal(id, 0, job.token);
  const accepted = await loadArtifact(id);
  expect(accepted.revision.objects.filter(object => object.kind === 'requirement')).toHaveLength(150);
  expect(accepted.revision.sources.entries[0].attributes.Verification).toEqual(source.attributes.Verification);
});

test('HTL generation saves semantic equivalence in the proposal and accepted table without changing source cells', async () => {
  const first = row('BRAKE-1'), second = row('BRAKE-2'), opposite = row('BRAKE-3');
  first[2] = 'Brake command is not delivered'; second[2] = 'Braking request fails to reach the controller'; opposite[2] = 'Braking continues after release is commanded';
  second[4] = 'Retain brake requests until acknowledged.';
  await saveFunctional([headers, first, second, opposite]);
  const id = await createArtifact(config()), hazardIssueRequest = jest.fn(async ({ families }) => [{ title: 'Loss of brake command delivery', description: 'Required brake commands may fail to reach the controller. Delivery assurance must address the linked missing-command scenarios.', sourceFamilyIds: families.slice(0, 2).map(family => family.familyId) }, { title: 'Braking persists after release', description: 'Braking may continue after release is commanded. The linked release-control evidence requires a distinct engineering response.', sourceFamilyIds: [families[2].familyId] }]);
  await generateArtifact(id, { hazardIssueRequest });
  let data = await loadArtifact(id);
  expect(hazardIssueRequest).toHaveBeenCalledTimes(1); expect(data.job.hazardSafetyIssues.version).toBe(1);
  const assessments = data.job.sections.s2.filter(object => object.hazardTrackingRow);
  expect(assessments.map(object => object.attributes.Hazard)).toEqual([first[2], second[2], opposite[2]]);
  expect(consolidateHazardRows(assessments)).toHaveLength(2);
  expect(consolidateHazardRows(assessments).map(group => group.recordId)).toEqual(['HTR-1', 'HTR-2']);
  await acceptProposal(id, 0, data.job.token); data = await loadArtifact(id);
  expect(consolidateHazardRows(data.revision.objects)[0].rows.map(object => object.sourceEvidence[0].sourceRowId)).toEqual(['BRAKE-1', 'BRAKE-2']);
  expect(artifactMarkdown(data.meta, data.revision)).toContain('Brake command is not delivered<br><br>Braking request fails to reach the controller');
});

test('HTL finishes and accepts beyond a shared drafting budget without requiring resume', async () => {
  const records = Array.from({ length: 66 }, (_, index) => { const saved = row(`BRAKE-${index}`); saved[2] = `Brake command unavailable at actuator ${index}`; return saved; });
  await saveFunctional([headers, ...records]);
  const id = await createArtifact(config()), budget = createGenerationBudget(undefined, { requestLimit: 1 });
  const hazardIssueRequest = jest.fn(fixtureSafetyIssues);
  try {
    await generateArtifact(id, { budget, hazardIssueRequest });
    const data = await loadArtifact(id);
    expect(hazardIssueRequest.mock.calls.length).toBeGreaterThan(1); expect(budget.signal.aborted).toBe(false);
    expect(data.job).toMatchObject({ state: 'ready', error: null }); expect(data.job.hazardSafetyIssues.version).toBe(1);
    await acceptProposal(id, 0, data.job.token);
    expect((await loadArtifact(id)).revision.objects.filter(object => object.hazardTrackingRow)).toHaveLength(66);
  } finally { budget.close(); }
});

test('code analyses remain scoped by workspace and include the latest saved analysis from each repository', async () => {
  await saveFunctional(); await saveCode();
  await saveCode({ id: 'run-old', updatedAt: '2026-11-11T13:00:00Z', generatedSheets: { Summary: [headers, row('OLD')] } });
  await saveCode({ id: 'run-2', repoId: 'sensor', generatedSheets: { Summary: [headers, row('SENSOR-1')] } });
  const entries = await captureHazardAnalysisSources([codeOwner]);
  expect(entries.map(entry => entry.sourceRowId).sort()).toEqual(['CODE-1', 'SENSOR-1']);
  expect(entries.every(entry => entry.ownerProjects[0].workspaceType === 'code-architecture')).toBe(true);
  const htl = await readyHTL('code-architecture');
  const id = await createArtifact({ ...config('safety-requirements', 'code-architecture'), hazardTrackingArtifactId: htl }); await generateArtifact(id, { request: requirementRequest });
  expect((await loadArtifact(id)).job.sources.entries.every(source => source.ownerProjects[0].workspaceType === 'code-architecture')).toBe(true);
  expect((await loadArtifact(id)).job.sections.s2.filter(object => object.kind === 'requirement')).toHaveLength(1);
});

test('paged code analysis reads all rows beyond the first page without hydrating repository snapshots', async () => {
  await saveCode({ generatedSheets: { Summary: [headers, ...Array.from({ length: 125 }, (_, index) => { const record = row(`CODE-${index}`); record[2] += ' evidence'.repeat(100); return record; })] }, architectureRowsSnapshot: ['ignored repository evidence '.repeat(10000)] });
  const db = await openHazardSchema(); const stored = await db.get('hazardAnalysisRuns', 'run-1'); db.close();
  expect(stored.payload.format).toBe('xhandle-hazard-run-chunks-v1');
  const get = jest.spyOn(IDBObjectStore.prototype, 'get');
  await expect(readHazardAnalysisAvailability([codeOwner])).resolves.toEqual({ rows: 125, analyses: 1 });
  expect(get.mock.instances.filter(store => store.name === 'hazardRunChunks')).toHaveLength(0);
  get.mockRestore();
  const entries = await captureHazardAnalysisSources([codeOwner]); expect(entries).toHaveLength(125);
  expect(entries.some(entry => entry.sourceRowId === 'CODE-124')).toBe(true);
  expect(JSON.stringify(entries)).not.toContain('ignored repository evidence');
});

test('the latest completed repository analysis is recognized across saved repository aliases', async () => {
  localStorage.setItem('xhandle.codeArchitectureProjects', JSON.stringify([{ id: 'p', name: 'Controller', repos: [{ id: 'alias', repoId: 'owner/controller', repoName: 'Controller repository' }] }]));
  await saveCode({ id: 'old-alias-run', repoId: 'alias', runState: 'incomplete', updatedAt: '2026-11-11T13:00:00Z' });
  await saveCode({ id: 'latest-run', repoId: 'owner/controller' });
  await expect(readHazardAnalysisAvailability([codeOwner])).resolves.toEqual({ rows: 1, analyses: 1 });
  const sources = await captureHazardAnalysisSources([codeOwner]);
  expect(sources).toHaveLength(1); expect(sources[0].analysisId).toBe('latest-run');
});

test('source changes prevent acceptance, and clearing analysis makes an existing draft unavailable', async () => {
  await saveFunctional(); const id = await createArtifact(config()); await generateArtifact(id); const { job } = await loadArtifact(id);
  const changed = summary(); changed[1][2] = 'Changed hazard'; await saveFunctional(changed);
  await expect(acceptProposal(id, 0, job.token)).rejects.toThrow('Sources changed');
  await deleteProjectHazardAnalysisRecord('p');
  await expect(captureLiveSources(config())).rejects.toThrow('Perform hazard analysis');
});

test('changes to excluded HTL columns do not change its captured source hash', async () => {
  await saveFunctional(); const before = await captureLiveSources(config());
  const changed = summary(); changed[1][6] = 'S4'; changed[1][5] = 'Changed excluded mitigation';
  await saveFunctional(changed);
  expect((await captureLiveSources(config())).hash).toBe(before.hash);
});

test('legacy analysis inputs are available to workers while cleared durable records never revive legacy results', async () => {
  localStorage.setItem('xhandle.projectData', JSON.stringify({ p: { analysisResult: { Summary: summary() } } }));
  const inputs = artifactStorageSnapshot(config(), localStorage);
  expect(inputs['xhandle.projectData']).toContain('R-1');
  expect((await captureLiveSources(config())).entries).toHaveLength(3);
  await saveProjectHazardAnalysisRecord('p', { analysisResult: null }, { allowAnalysisClear: true });
  await expect(captureLiveSources(config())).rejects.toThrow('Perform hazard analysis');
});

test('incomplete code analyses and damaged source storage fail explicitly', async () => {
  await saveCode({ runState: 'incomplete' });
  await expect(captureHazardAnalysisSources([codeOwner])).rejects.toThrow('Finish and save');
  const open = jest.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('Storage unavailable'); });
  await expect(captureHazardAnalysisSources([owner])).rejects.toThrow('Could not read saved hazard analysis'); open.mockRestore();
});

test('safety-only engineering projects require analyses for each selected owner and accept both safety documents', async () => {
  await saveFunctional();
  const input = { name: 'Mission safety', system: 'Mission', folderId: 'f', owners: [owner, codeOwner], artifacts: [{ templateId: 'safety-requirements' }, { templateId: 'hazard-tracking-list' }] };
  await expect(createEngineeringProject(input)).rejects.toThrow('Perform hazard analysis');
  expect(await listArtifacts()).toHaveLength(0);
  await saveCode(); const id = await createEngineeringProject(input); await generateEngineeringProject(id, { request: requirementRequest });
  const { program, records } = await loadEngineeringProject(id);
  expect(records.map(record => record.meta.templateId)).toEqual(['hazard-tracking-list', 'safety-requirements']);
  expect(records.every(record => record.job.state === 'ready')).toBe(true);
  await acceptEngineeringProject(id, program.version, program.runToken);
  const published = await loadEngineeringProject(id);
  expect(published.records.every(record => record.meta.revision === 1)).toBe(true);
  const graph = engineeringProjectTrace(published.program, published.records);
  const htrs = graph.nodes.filter(node => node.type === 'hazard-tracking-record');
  expect(htrs.length).toBeGreaterThan(0);
  expect(graph.links.some(link => link.type === 'refines' && htrs.some(node => node.id === link.to))).toBe(true);
  expect(graph.gaps.some(gap => /drafting input has no object-level citation|current consolidation/.test(gap.message))).toBe(false);
});
