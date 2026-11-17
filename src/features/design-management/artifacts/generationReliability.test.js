import { briefGroups } from './generationBrief';
import { createGenerationBudget } from './generationBudget';
import { artifactDocumentSize } from './artifactSize';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'v8';
import { randomUUID } from 'crypto';
import { createArtifact, loadArtifact, acceptProposal, checkpointJob, validateArtifactObjects } from './artifactRepository';
import { validateSection, getTemplate, artifactObjectText } from './artifactModel';
import { generateArtifact, requestSection } from './artifactGeneration';
import { sourceBatchPlan, savedPartCount } from './generationSourceBatches';
import { retryAfterDelay } from './generationRecovery';

jest.mock('../../../components/backendConfig', () => ({ backendURL: '/fixture', buildAIAuthOpts: () => ({ headers: {} }) }));
const config = { templateId: 'conops', title: 'Operations', system: 'Vehicle', projectId: 'p', workspaceType: 'functional', folderId: 'f', sources: [{ folderId: 'f', moduleId: 'm' }] };
const rows = [{ id: 'need', title: 'Operate vehicle', folderId: 'f', moduleId: 'm', attributes: { Description: 'An operator requests vehicle motion.' } }];
const value = args => ({ objects: [{ key: 'motion', kind: 'narrative', title: 'Vehicle motion', text: 'An operator requests vehicle motion.', sourceIds: [args.sources.entries[0].id] }] });
const reply = (finish = 'stop') => ({ ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify({ objects: [{ key: 'motion', kind: 'narrative', title: 'Motion', text: 'An operator requests motion.', sourceIds: ['S1'] }] }) } }] }) });
beforeEach(() => {
  global.structuredClone = value => deserialize(serialize(value));
  Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID } });
  localStorage.clear();
  localStorage.setItem('xhandle.projects', JSON.stringify([{ id: 'p', name: 'Vehicle' }]));
  localStorage.setItem('xhandle:req-projects', JSON.stringify([{ id: 'f', name: 'Design', modules: [{ id: 'm', name: 'Needs' }] }]));
  localStorage.setItem('xhandle:requirements', JSON.stringify(rows));
});
afterEach(() => jest.restoreAllMocks());
const fastTimers = (...durations) => { const original = setTimeout; jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms, ...rest) => original(fn, durations.includes(ms) ? 0 : ms, ...rest)); };

test('repeated invalid section output completes through smaller saved parts with exact evidence', async () => {
  const id = await createArtifact(config);
  const request = jest.fn(async args => args.section.id === 's1' && !args.part ? { objects: [] } : value(args));
  await generateArtifact(id, { request });
  const { job } = await loadArtifact(id);
  expect(request).toHaveBeenCalledTimes(9); expect(job.state).toBe('ready');
  expect(Object.keys(job.sectionParts.s1.completed)).toEqual(['core', 'detail']);
  const items = job.sections.s1.slice(1);
  expect(items.map(item => item.key)).toEqual(['core-motion', 'detail-motion']);
  expect(items.every(item => item.sourceEvidence[0].id === 'module:f/m:need')).toBe(true);
  expect(new Set(job.sections.s1.map(item => item.id)).size).toBe(3);
  await acceptProposal(id, 0, job.token); expect((await loadArtifact(id)).revision.objects).toHaveLength(13);
});

test('a saved part survives interruption and only the unfinished part is retried after reopening', async () => {
  const id = await createArtifact(config), controller = new AbortController();
  const request = jest.fn(async args => {
    if (args.section.id !== 's1') return value(args);
    if (!args.part) return { objects: [] };
    if (args.part.id === 'detail') controller.abort();
    return value(args);
  });
  await expect(generateArtifact(id, { signal: controller.signal, request })).rejects.toMatchObject({ name: 'AbortError' });
  const saved = (await loadArtifact(id)).job;
  expect(saved.sections).toEqual({}); expect(savedPartCount(saved)).toBe(1);
  const resumed = jest.fn(async args => value(args)); await generateArtifact(id, { request: resumed });
  expect(resumed).toHaveBeenCalledTimes(6);
  expect(resumed.mock.calls[0][0].part.id).toBe('detail');
  expect((await loadArtifact(id)).job.sectionParts.s1.completed.core).toEqual(saved.sectionParts.s1.completed.core);
});

test('large inputs are reviewed once and synthesized into concise sections with canonical citations', async () => {
  localStorage.setItem('xhandle:requirements', JSON.stringify(Array.from({ length: 14 }, (_, i) => ({ ...rows[0], id: `need${i}`, attributes: { Description: 'Evidence '.repeat(1200) } }))));
  const id = await createArtifact(config), before = (await loadArtifact(id)).job;
  const groups = briefGroups(before.sources); expect(groups.length).toBeGreaterThan(1);
  const request = jest.fn(async args => ({ objects: [{ ...value(args).objects[0], sourceIds: args.sources.entries.map(entry => entry.id) }] }));
  await generateArtifact(id, { request });
  const reviews = request.mock.calls.map(([args]) => args).filter(args => args.task === 'evidence-review');
  expect(reviews.flatMap(args => args.sources.entries.map(entry => entry.id))).toEqual(before.sources.entries.map(entry => entry.id));
  const drafts = request.mock.calls.map(([args]) => args).filter(args => args.task !== 'evidence-review');
  expect(drafts).toHaveLength(6);
  expect(request).toHaveBeenCalledTimes(groups.length + 6);
  expect(drafts[1].documentContext).toEqual([{ section: getTemplate('conops').sections[0].title, topics: ['Vehicle motion'], additionalTopics: 0 }]);
  const { job } = await loadArtifact(id); expect(job.sources).toEqual(before.sources); expect(job.state).toBe('ready');
  expect(Object.keys(job.evidenceBrief.rounds[0].completed)).toHaveLength(groups.length);
  for (const objects of Object.values(job.sections)) {
    expect(objects).toHaveLength(2);
    expect(objects[1].sourceIds).toEqual(before.sources.entries.map(entry => entry.id));
    expect(objects[1].sourceEvidence).toEqual(before.sources.entries);
  }
  await acceptProposal(id, 0, job.token);
});

test('a request budget checkpoints evidence review and resume skips completed groups', async () => {
  localStorage.setItem('xhandle:requirements', JSON.stringify(Array.from({ length: 14 }, (_, i) => ({ ...rows[0], id: `need${i}`, attributes: { Description: 'Evidence '.repeat(1200) } }))));
  const id = await createArtifact(config), budget = createGenerationBudget(undefined, { requestLimit: 1 });
  const request = jest.fn(async args => value(args));
  try { await expect(generateArtifact(id, { request, budget })).rejects.toMatchObject({ code: 'GENERATION_BUDGET' }); }
  finally { budget.close(); }
  const { job } = await loadArtifact(id);
  expect(job.state).toBe('paused'); expect(job.error).toContain('1-request'); expect(request).toHaveBeenCalledTimes(1);
  const saved = job.evidenceBrief.rounds[0].completed[0];
  expect(saved).toHaveLength(1); expect(job.sections).toEqual({});
  request.mockClear(); await generateArtifact(id, { request });
  expect(request.mock.calls.filter(([args]) => args.task === 'evidence-review')).toHaveLength(briefGroups(job.sources).length - 1);
  expect((await loadArtifact(id)).job.evidenceBrief.rounds[0].completed[0]).toEqual(saved);
});

test('system specification resumes a fourth-review kind failure with exact saved work and corrected provider kinds', async () => {
  localStorage.setItem('xhandle:requirements', JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ ...rows[0], id: `need${i}`, attributes: { Description: 'Evidence '.repeat(1200) } }))));
  const id = await createArtifact({ ...config, templateId: 'system-spec' });
  const initial = (await loadArtifact(id)).job;
  expect(briefGroups(initial.sources).length).toBe(4);
  const fetchBefore = global.fetch;
  let failFourthReview = true;
  global.fetch = jest.fn(async (_url, options) => {
    const body = JSON.parse(options.body), prompt = JSON.parse(body.messages[1].content);
    expect(body.messages[0].content).toContain('"kind":"narrative"');
    expect(body.messages[0].content).toContain('Fact and constraint are descriptions of content, not kind values');
    const review = prompt.task === 'evidence-review';
    if (review) expect(prompt.synthesisGuidance).toContain('Label source-backed facts as kind narrative');
    const objects = [{ key: 'recorded-motion', kind: review ? ' Fact ' : 'narrative', title: 'Recorded motion', text: 'An operator requests vehicle motion.', sourceIds: prompt.sources.map(source => source.id) }];
    if (review) objects.push({ key: 'recorded-constraint', kind: 'CONSTRAINT', title: 'Corrupted audio', text: 'The microphone controller shall reject corrupted audio frames.', sourceIds: prompt.sources.map(source => source.id) });
    if (failFourthReview && prompt.section.id === 'review-0-3') objects[0].kind = 'safety-goal';
    return { ok: true, text: async () => JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ objects }) } }] }) };
  });
  try {
    await expect(generateArtifact(id)).rejects.toMatchObject({ code: 'INVALID_SECTION_RESPONSE', responseIssue: 'kind' });
    const paused = (await loadArtifact(id)).job;
    expect(paused.state).toBe('paused');
    expect(Object.keys(paused.evidenceBrief.rounds[0].completed)).toEqual(['0', '1', '2']);
    expect(paused.evidenceBrief.rounds[0].completed[0].map(object => object.kind)).toEqual(['narrative', 'requirement']);
    const correction = JSON.parse(fetch.mock.calls[4][1].body).messages[1].content;
    expect(JSON.parse(correction).formatCorrection).toContain('objects[0].kind was "safety-goal"');
    expect(paused.sources).toEqual(initial.sources);
    failFourthReview = false; fetch.mockClear();
    await generateArtifact(id);
    const { job } = await loadArtifact(id);
    expect(job.state).toBe('ready');
    expect(job.token).toBe(initial.token);
    expect(job.sources).toEqual(initial.sources);
    expect(Object.keys(job.sections)).toHaveLength(6);
    const resumedPrompts = fetch.mock.calls.map(([, options]) => JSON.parse(JSON.parse(options.body).messages[1].content));
    expect(resumedPrompts[0].section.id).toBe('review-0-3');
    expect(resumedPrompts.some(prompt => ['review-0-0', 'review-0-1', 'review-0-2'].includes(prompt.section.id))).toBe(false);
    for (let index = 0; index < 3; index++) expect(job.evidenceBrief.rounds[0].completed[index]).toEqual(paused.evidenceBrief.rounds[0].completed[index]);
    for (const section of Object.values(job.sections)) expect(section[1].sourceIds).toEqual(initial.sources.entries.map(source => source.id));
    await acceptProposal(id, 0, job.token);
    expect((await loadArtifact(id)).revision.objects.filter(object => object.kind === 'section')).toHaveLength(6);
  } finally { global.fetch = fetchBefore; }
});

test.each([13, 61])('a complete %i-item evidence review is saved intact and survives resume before concise synthesis', async count => {
  localStorage.setItem('xhandle:requirements', JSON.stringify(Array.from({ length: 14 }, (_, i) => ({ ...rows[0], id: `need${i}`, attributes: { Description: 'Evidence '.repeat(1200) } }))));
  const id = await createArtifact(config), before = (await loadArtifact(id)).job;
  let interrupted = true;
  const request = jest.fn(async args => {
    if (interrupted && args.section.id === 'review-0-1') throw new Error('Interrupted test review');
    if (args.section.id === 'review-0-0') return { objects: Array.from({ length: count }, (_, index) => ({ key: `fact-${index}`, kind: index === count - 1 ? 'gap' : 'narrative', title: `Supported fact ${index}`, text: `Fact ${index}. ${'Recorded detail. '.repeat(125)}`, sourceIds: args.sources.entries.map(entry => entry.id) })) };
    return value(args);
  });
  await expect(generateArtifact(id, { request })).rejects.toThrow('Interrupted test review');
  const saved = (await loadArtifact(id)).job.evidenceBrief.rounds[0].completed[0];
  expect(saved).toHaveLength(count);
  expect(saved[0].text.length).toBeGreaterThan(1200);
  expect(saved[count - 1].kind).toBe('gap');
  interrupted = false; request.mockClear();
  await generateArtifact(id, { request });
  const { job } = await loadArtifact(id);
  expect(job.state).toBe('ready');
  expect(job.evidenceBrief.rounds[0].completed[0]).toEqual(saved);
  expect(request.mock.calls.some(([args]) => args.section.id === 'review-0-0')).toBe(false);
  expect(job.sources).toEqual(before.sources);
  expect(Object.values(job.sections).flat().every(object => object.sourceIds.every(sourceId => before.sources.entries.some(source => source.id === sourceId)))).toBe(true);
  await acceptProposal(id, 0, job.token);
});

test('a run deadline aborts a stalled request, retains saved sections, and prevents late writes', async () => {
  let expire;
  const timer = setTimeout;
  jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms, ...rest) => { if (ms === 900000) expire = fn; return timer(fn, ms, ...rest); });
  const id = await createArtifact(config), budget = createGenerationBudget();
  let finish, pendingSignal;
  const request = jest.fn(async args => {
    if (args.section.id === 's1') return value(args);
    pendingSignal = args.signal;
    return new Promise(resolve => { finish = () => resolve(value(args)); expire(); });
  });
  try { await expect(generateArtifact(id, { request, budget })).rejects.toMatchObject({ code: 'GENERATION_BUDGET' }); }
  finally { budget.close(); }
  expect(pendingSignal.aborted).toBe(true); expect(request).toHaveBeenCalledTimes(2);
  const { job } = await loadArtifact(id); expect(job.error).toContain('run budget'); expect(Object.keys(job.sections)).toEqual(['s1']);
  finish(); await new Promise(resolve => setTimeout(resolve, 0));
  expect((await loadArtifact(id)).job).toEqual(job);
  const resume = jest.fn(async args => value(args)); await generateArtifact(id, { request: resume }); expect(resume).toHaveBeenCalledTimes(5);
});

test('ordinary standalone UI generation completes its finite section plan beyond fifteen total minutes', async () => {
  const id = await createArtifact(config);
  let now = Date.now(); jest.spyOn(Date, 'now').mockImplementation(() => now);
  const provider = jest.fn(async args => { now += 240000; return value(args); });
  await generateArtifact(id, { request: provider });
  expect(provider).toHaveBeenCalledTimes(6);
  expect((await loadArtifact(id)).job.state).toBe('ready');
});

test('oversized final synthesis is checkpointed and resumed without rerunning completed evidence reviews', async () => {
  localStorage.setItem('xhandle:requirements', JSON.stringify(Array.from({ length: 14 }, (_, i) => ({ ...rows[0], id: `need${i}`, attributes: { Description: 'Evidence '.repeat(1200) } }))));
  const id = await createArtifact(config);
  let interrupt = true;
  const request = jest.fn(async args => {
    if (args.task === 'section-consolidation' && interrupt) throw new Error('Interrupted final synthesis');
    const object = { ...value(args).objects[0], sourceIds: args.sources.entries.map(source => source.id) };
    return { objects: args.task !== 'evidence-review' && args.task !== 'section-consolidation' && args.section.id === 's1' ? Array.from({ length: 61 }, (_, index) => ({ ...object, key: `candidate-${index}`, title: `Candidate ${index}`, text: `Retain source condition ${index}.` })) : [object] };
  });
  await expect(generateArtifact(id, { request })).rejects.toThrow('Interrupted final synthesis');
  const paused = (await loadArtifact(id)).job;
  expect(paused.sectionSynthesis.s1.candidates).toHaveLength(61);
  expect(paused.sectionSynthesis.s1.candidates.every(object => object.sourceIds.every(id => !id.startsWith('brief:')))).toBe(true);
  const reviews = paused.evidenceBrief;
  interrupt = false; request.mockClear();
  await generateArtifact(id, { request });
  const { job } = await loadArtifact(id);
  expect(job.state).toBe('ready'); expect(job.sections.s1).toHaveLength(2);
  expect(job.evidenceBrief).toEqual(reviews);
  expect(request.mock.calls.some(([args]) => args.task === 'evidence-review')).toBe(false);
  expect(request.mock.calls[0][0].task).toBe('section-consolidation');
  expect(job.sections.s1[1].sourceEvidence).toEqual(job.sources.entries);
  await acceptProposal(id, 0, job.token);
});

test('network interruption and rate limiting retry before completing without partial publication', async () => {
  fastTimers(1000, 2000);
  const id = await createArtifact(config);
  global.fetch = jest.fn().mockRejectedValueOnce(new TypeError('Network failed'))
    .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => '0' } })
    .mockImplementation(async () => reply());
  await generateArtifact(id);
  expect(fetch).toHaveBeenCalledTimes(8); expect((await loadArtifact(id)).job.state).toBe('ready');
});

test('timeouts retry finitely and remain provider failures rather than user pauses', async () => {
  fastTimers(180000, 1000, 2000);
  const id = await createArtifact(config);
  global.fetch = jest.fn((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true })));
  await expect(generateArtifact(id)).rejects.toThrow('timed out');
  expect(fetch).toHaveBeenCalledTimes(3);
  const { job } = await loadArtifact(id); expect(job.state).toBe('paused'); expect(job.error).toContain('timed out'); expect(job.sections).toEqual({});
});

test.each([401, 403, 400])('permanent provider error %s does not consume retries or create filler content', async status => {
  const id = await createArtifact(config); global.fetch = jest.fn(async () => ({ ok: false, status }));
  await expect(generateArtifact(id)).rejects.toThrow(status === 400 ? 'rejected' : 'authorize');
  expect(fetch).toHaveBeenCalledTimes(1); expect((await loadArtifact(id)).job.sections).toEqual({});
});

test('long Retry-After is respected by pausing rather than retrying early', async () => {
  const id = await createArtifact(config);
  global.fetch = jest.fn(async () => ({ ok: false, status: 429, headers: { get: () => '300' } }));
  await expect(generateArtifact(id)).rejects.toThrow('temporarily unavailable'); expect(fetch).toHaveBeenCalledTimes(1);
  expect(retryAfterDelay('Sat, 07 Nov 2026 21:00:00 GMT', Date.parse('2026-11-07T20:59:55Z'))).toBe(5000);
});

test('Pause cancels retry backoff before another request', async () => {
  const id = await createArtifact(config), controller = new AbortController();
  global.fetch = jest.fn(async () => ({ ok: false, status: 503 }));
  await expect(generateArtifact(id, { signal: controller.signal, onProgress: text => { if (text.startsWith('Reconnecting')) controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).toHaveBeenCalledTimes(1); expect((await loadArtifact(id)).job.sections).toEqual({});
});

test('sources changing during the final section prevent a misleading ready state', async () => {
  const id = await createArtifact(config);
  await expect(generateArtifact(id, { request: async args => {
    if (args.section.id === 's6') localStorage.setItem('xhandle:requirements', JSON.stringify([{ ...rows[0], title: 'Changed scope' }]));
    return value(args);
  } })).rejects.toThrow('Sources changed during generation');
  const { job } = await loadArtifact(id); expect(job.state).toBe('paused'); expect(Object.keys(job.sections)).toHaveLength(6);
  await expect(acceptProposal(id, 0, job.token)).rejects.toThrow('complete proposal');
});


test('a fully saved draft over the old serialized limit resumes and publishes without regenerating or losing evidence', async () => {
  localStorage.setItem('xhandle:requirements', JSON.stringify([{ ...rows[0], attributes: { Description: 'Source evidence. '.repeat(1200) } }]));
  const id = await createArtifact(config);
  const request = jest.fn(async args => ({ objects: Array.from({ length: 20 }, (_, i) => ({ ...value(args).objects[0], key: `item-${i}` })) }));
  await generateArtifact(id, { request });
  const { job } = await loadArtifact(id);
  const objects = Object.values(job.sections).flat();
  // This is the final check that previously rejected completed, checkpointed work.
  expect(JSON.stringify(objects).length).toBeGreaterThan(2000000);
  expect(job.state).toBe('ready'); expect(request).toHaveBeenCalledTimes(6);
  await checkpointJob(id, job, { state: 'paused', error: 'Artifact exceeds the document size limit.' });
  request.mockClear();
  await generateArtifact(id, { request });
  const resumed = (await loadArtifact(id)).job;
  expect(request).not.toHaveBeenCalled(); expect(resumed.state).toBe('ready');
  expect(resumed.sections).toEqual(job.sections);
  await acceptProposal(id, 0, resumed.token);
  const { revision } = await loadArtifact(id);
  expect(revision.objects).toEqual(objects);
  expect(revision.objects.filter(object => object.kind !== 'section').every(object => object.sourceEvidence[0].text === job.sources.entries[0].text)).toBe(true);
});

test('size budgeting supports larger object sets while retaining content and evidence validation', () => {
  const meta = { id: 'document' };
  const object = { id: 'document:item', title: 'Item', text: 'Content', parentId: null, sourceEvidence: [] };
  const snapshot = { id: 'same-source', text: 'a'.repeat(1100000) };
  const repeated = Array.from({ length: 3 }, (_, i) => ({ ...object, id: `document:${i}`, sourceEvidence: [JSON.parse(JSON.stringify(snapshot))] }));
  expect(() => validateArtifactObjects(meta, repeated)).not.toThrow();
  const initialSize = artifactDocumentSize(repeated);
  // A historical snapshot with the same ID is separate evidence, not a duplicate.
  repeated[1].sourceEvidence[0].text = 'b'.repeat(1100000);
  expect(artifactDocumentSize(repeated).evidence).toBeGreaterThan(initialSize.evidence + 1000000);
  expect(() => validateArtifactObjects(meta, repeated)).not.toThrow();
  const largeContent = Array.from({ length: 140 }, (_, i) => ({ ...object, id: `document:${i}`, text: 'x'.repeat(15000) }));
  expect(() => validateArtifactObjects(meta, largeContent)).not.toThrow();
  expect(() => validateArtifactObjects(meta, [{ ...object, text: 'x'.repeat(16001) }])).toThrow('Invalid artifact object');
  expect(() => validateArtifactObjects(meta, Array.from({ length: 2500 }, (_, i) => ({ ...object, id: `document:${i}` })))).not.toThrow();
});


test('complete chunk responses above the 12-item target retain every valid item', async () => {
  const id = await createArtifact(config);
  const request = jest.fn(async args => {
    if (args.section.id !== 's1') return value(args);
    if (!args.part) return { objects: [] };
    return { objects: Array.from({ length: 20 }, (_, i) => ({ ...value(args).objects[0], key: `item-${i}` })) };
  });
  await generateArtifact(id, { request });
  const { job } = await loadArtifact(id);
  expect(job.state).toBe('ready');
  expect(job.sections.s1).toHaveLength(41);
  expect(job.sectionParts.s1.completed.core).toHaveLength(20);
  expect(job.sectionParts.s1.completed.detail).toHaveLength(20);
  expect(new Set(job.sections.s1.map(object => object.id)).size).toBe(41);
});

test.each(['excess', 'output'])('an oversized unfinished chunk (%s) splits and resumes without replacing ten completed parts', async reason => {
  localStorage.setItem('xhandle:requirements', JSON.stringify(Array.from({ length: 22 }, (_, i) => ({ ...rows[0], id: `need-${i}` }))));
  const id = await createArtifact(config), { meta, job: initial } = await loadArtifact(id);
  const section = getTemplate(meta.templateId).sections[0];
  const work = Array.from({ length: 11 }, (_, i) => ({ id: `group${i}`, title: `Source group ${i + 1}`, focus: 'Draft supported statements.', sourceIds: initial.sources.entries.slice(i * 2, i * 2 + 2).map(source => source.id) }));
  const completed = Object.fromEntries(work.slice(0, 10).map(part => [part.id, validateSection({ objects: [{ key: part.id, kind: 'requirement', title: part.title, text: 'Saved statement', sourceIds: part.sourceIds }] }, section, id, new Set(part.sourceIds)).slice(1)]));
  await checkpointJob(id, initial, { sectionParts: { s1: { version: 1, sourceHash: initial.sources.hash, work, completed } } });
  const controller = new AbortController();
  const request = jest.fn(async args => {
    if (args.part?.id === 'group10') {
      if (reason === 'output') { const error = new Error('Output limit'); error.code = 'OUTPUT_LIMIT'; throw error; }
      return { objects: Array.from({ length: 61 }, (_, i) => ({ ...value(args).objects[0], key: `item-${i}` })) };
    }
    if (args.part?.id === 'group10-b') controller.abort();
    return value(args);
  });
  await expect(generateArtifact(id, { request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  const paused = (await loadArtifact(id)).job;
  expect(savedPartCount(paused)).toBe(11);
  for (const part of work.slice(0, 10)) expect(paused.sectionParts.s1.completed[part.id]).toEqual(completed[part.id]);
  const children = paused.sectionParts.s1.work.filter(part => part.id.startsWith('group10-'));
  expect(children.map(part => part.id)).toEqual(['group10-a', 'group10-b']);
  expect(children.flatMap(part => part.sourceIds)).toEqual(work[10].sourceIds);
  const resumed = jest.fn(async args => value(args));
  await generateArtifact(id, { request: resumed });
  expect(resumed.mock.calls[0][0].part.id).toBe('group10-b');
  expect(resumed).toHaveBeenCalledTimes(6);
  const ready = (await loadArtifact(id)).job;
  expect(ready.state).toBe('ready'); expect(ready.sections.s1).toHaveLength(13);
  expect(ready.sectionParts.s1.completed['group10-a']).toEqual(paused.sectionParts.s1.completed['group10-a']);
  await acceptProposal(id, 0, ready.token);
  expect((await loadArtifact(id)).revision.objects.filter(object => object.sectionId === 's1')).toHaveLength(13);
});

test('persistent excessive responses stop at a bounded subdivision depth with saved work retained', async () => {
  const id = await createArtifact(config);
  const request = jest.fn(async args => ({ objects: Array.from({ length: 61 }, (_, i) => ({ ...value(args).objects[0], key: `item-${i}` })) }));
  await expect(generateArtifact(id, { request })).rejects.toThrow('after splitting into smaller requests');
  expect(request.mock.calls.length).toBeLessThan(20);
  const { job } = await loadArtifact(id);
  expect(job.state).toBe('paused'); expect(job.sections).toEqual({});
  expect(Math.max(...job.sectionParts.s1.work.map(part => part.depth || 0))).toBe(4);
});

test('chunk requests use a consistent small item target in both instruction messages', async () => {
  const id = await createArtifact(config), { meta, job } = await loadArtifact(id);
  global.fetch = jest.fn(async () => reply());
  await requestSection({ meta, sources: job.sources, section: getTemplate(meta.templateId).sections[0], part: { id: 'core', title: 'Core', focus: 'Principal statements' } });
  const { messages } = JSON.parse(fetch.mock.calls[0][1].body);
  expect(messages[0].content).toContain('Use 1–12 objects');
  expect(messages[0].content).not.toContain('1–60');
  expect(JSON.parse(messages[1].content).responseSize).toContain('1–12');
});


test('a fully saved multi-megabyte document resumes without any additional generation requests', async () => {
  const id = await createArtifact(config), { job: initial } = await loadArtifact(id);
  const sections = Object.fromEntries(getTemplate(config.templateId).sections.map(section => [section.id,
    validateSection({ objects: Array.from({ length: 30 }, (_, index) => ({ key: `item-${index}`, kind: 'narrative', title: `Detailed statement ${index}`, text: 'x'.repeat(15000), sourceIds: [initial.sources.entries[0].id] })) }, section, id, new Set(initial.sources.entries.map(source => source.id)))
      .map(object => ({ ...object, evidenceHash: initial.sources.hash, sourceEvidence: object.sourceIds.map(sourceId => initial.sources.entries.find(entry => entry.id === sourceId)) }))
  ]));
  await checkpointJob(id, initial, { sections, state: 'paused', error: 'The document content and distinct supporting evidence exceed the size limit.' });
  expect(artifactDocumentSize(Object.values(sections).flat()).content).toBeGreaterThan(2000000);
  const request = jest.fn(); await generateArtifact(id, { request });
  expect(request).not.toHaveBeenCalled();
  const { job } = await loadArtifact(id); expect(job.state).toBe('ready'); expect(job.sections).toEqual(sections);
  await acceptProposal(id, 0, job.token);
  expect((await loadArtifact(id)).revision.objects).toEqual(Object.values(sections).flat());
});

test('large manifests process more than twelve bounded source groups without dropping evidence', () => {
  const sources = { entries: Array.from({ length: 30 }, (_, i) => ({ id: `source-${i}`, title: `Source ${i}`, text: 'Evidence '.repeat(6000) })) };
  const work = sourceBatchPlan(sources);
  expect(work.length).toBeGreaterThan(12);
  expect(work.flatMap(part => part.sourceIds)).toEqual(sources.entries.map(source => source.id));
  expect(work.every(part => part.sourceIds.length === 1)).toBe(true);
});


test('a throttled background timer cannot allow another request after the run deadline', async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  const budget = createGenerationBudget(), provider = jest.fn();
  clock.mockReturnValue(now + 900001);
  try { await expect(budget.request(provider, {})).rejects.toMatchObject({ code: 'GENERATION_BUDGET' }); }
  finally { budget.close(); }
  expect(provider).not.toHaveBeenCalled(); expect(budget.signal.aborted).toBe(true);
});


test('claims based on unresolved evidence briefs remain explicitly unverified in the final draft', async () => {
  localStorage.setItem('xhandle:requirements', JSON.stringify(Array.from({ length: 14 }, (_, i) => ({ ...rows[0], id: `need${i}`, attributes: { Description: 'Evidence '.repeat(1200) } }))));
  const id = await createArtifact(config);
  await generateArtifact(id, { request: async args => ({ objects: [{ ...value(args).objects[0], kind: args.task === 'evidence-review' ? 'gap' : 'requirement' }] }) });
  const { job } = await loadArtifact(id);
  for (const section of Object.values(job.sections)) {
    expect(section[1]).toMatchObject({ kind: 'gap', evidenceIssue: 'unresolved-upstream', proposedKind: 'requirement' });
    expect(artifactObjectText(section[1])).toContain('Unverified generated text:');
  }
});
