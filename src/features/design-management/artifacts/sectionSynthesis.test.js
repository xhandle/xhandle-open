import { generateConciseSection } from './sectionSynthesis';
import { getTemplate, validateEvidenceReview } from './artifactModel';
import { resolveBriefCitations } from './generationBrief';

const meta = { id: 'artifact', templateId: 'safety-requirements' };
const source = { id: 'HTR-source', title: 'HTR-1', text: 'Recorded protective action.' };
const fact = index => ({ key: `candidate-${index}`, kind: 'narrative', title: `Candidate ${index}`, text: `Recorded statement ${index}.`, sourceIds: [source.id] });
const args = section => ({ meta, section, sources: { entries: [source] } });
const checked = (input, objects) => validateEvidenceReview(resolveBriefCitations({ objects }, input.citationMap), input.section, meta.id, new Set([source.id])).map(row => input.task === 'section-consolidation' && row.kind !== 'section' ? { ...row, synthesisSourceIds: objects.find(object => object.key === row.key).sourceIds } : row);

test.each(getTemplate('safety-requirements').sections)('$title automatically consolidates oversized output into a concise section', async section => {
  const checkpoints = [];
  const generate = jest.fn(async input => {
    if (input.task !== 'section-consolidation') return checked(input, Array.from({ length: 61 }, (_, index) => fact(index)));
    expect(input.sources.entries.length).toBeLessThanOrEqual(24);
    expect(input.part.targetItems).toBeLessThanOrEqual(8);
    expect(input.part.focus).toContain('Preserve distinct requirements');
    return checked(input, [{ ...fact(0), title: 'Concise result', sourceIds: input.sources.entries.map(source => source.id) }]);
  });
  const objects = await generateConciseSection(args(section), { sourceHash: 'saved', generate, checkpoint: async state => checkpoints.push(state), onProgress: jest.fn() });
  expect(generate).toHaveBeenCalledTimes(4);
  expect(checkpoints[0].candidates).toHaveLength(61);
  expect(objects).toHaveLength(2);
  expect(objects[1]).toMatchObject({ title: 'Concise result', sourceIds: [source.id], sectionId: section.id });
});

test('resume reuses saved candidates instead of regenerating the oversized section', async () => {
  const section = getTemplate('safety-requirements').sections[0];
  let saved;
  const initial = jest.fn(async input => {
    if (input.task === 'section-consolidation') throw new Error('Interrupted consolidation');
    return checked(input, Array.from({ length: 61 }, (_, index) => fact(index)));
  });
  await expect(generateConciseSection(args(section), { sourceHash: 'saved', generate: initial, checkpoint: async state => { saved = state; }, onProgress: jest.fn() })).rejects.toThrow('Interrupted');
  expect(saved.candidates).toHaveLength(61);
  const resumed = jest.fn(async input => checked(input, [{ ...fact(0), sourceIds: input.sources.entries.map(source => source.id) }]));
  await generateConciseSection(args(section), { saved, sourceHash: 'saved', generate: resumed, checkpoint: async state => { saved = state; }, onProgress: jest.fn() });
  expect(resumed).toHaveBeenCalledTimes(3);
  expect(resumed.mock.calls[0][0].task).toBe('section-consolidation');
});

test('truncated section output falls back to saved smaller parts and resumes only unfinished work', async () => {
  const section = getTemplate('safety-requirements').sections[0];
  let saved;
  const initial = jest.fn(async input => {
    if (!input.part) throw Object.assign(new Error('Truncated response'), { code: 'OUTPUT_LIMIT' });
    if (input.part.id === 'detail') throw new Error('Interrupted part');
    return checked(input, [fact(0)]);
  });
  await expect(generateConciseSection(args(section), { sourceHash: 'saved', generate: initial, checkpoint: async state => { saved = state; }, onProgress: jest.fn() })).rejects.toThrow('Interrupted part');
  expect(saved.completed.core).toHaveLength(1);
  const resumed = jest.fn(async input => checked(input, [{ ...fact(1), key: 'candidate-0' }]));
  const objects = await generateConciseSection(args(section), { saved, sourceHash: 'saved', generate: resumed, checkpoint: async state => { saved = state; }, onProgress: jest.fn() });
  expect(resumed).toHaveBeenCalledTimes(1); expect(resumed.mock.calls[0][0].part.id).toBe('detail');
  expect(objects).toHaveLength(3); expect(new Set(objects.map(object => object.id)).size).toBe(3);
});

test('an old eight-pass checkpoint recovers without discarding distinct statements or looping on a fixed count', async () => {
  const section = getTemplate('safety-requirements').sections[1];
  const candidates = Array.from({ length: 75 }, (_, index) => ({ ...fact(index), kind: 'requirement', text: `The controller shall enforce recorded limit ${index + 1} ms.` }));
  let saved = { version: 1, sourceHash: 'saved', candidates, round: 8, completed: {} };
  const generate = jest.fn(async input => {
    expect(input.task).toBe('section-consolidation');
    expect(input.sources.entries.length).toBeLessThanOrEqual(24);
    return checked(input, input.sources.entries.map((entry, index) => ({ key: `distinct-${index}`, kind: entry.kind, title: entry.title, text: entry.text, sourceIds: [entry.id] })));
  });
  const options = { sourceHash: 'saved', generate, checkpoint: async state => { saved = state; }, onProgress: jest.fn() };
  const objects = await generateConciseSection(args(section), { ...options, saved });
  expect(generate).toHaveBeenCalledTimes(8);
  expect(objects.filter(object => object.kind === 'requirement').map(object => object.text).sort()).toEqual(candidates.map(candidate => candidate.text).sort());
  expect(objects.some(object => object.kind === 'gap' && object.key === 'consolidation-review')).toBe(true);
  expect(saved).toMatchObject({ strategy: 2, finished: true, reviewRequired: true });
  generate.mockClear();
  await expect(generateConciseSection(args(section), { ...options, saved })).resolves.toEqual(objects);
  expect(generate).not.toHaveBeenCalled();
});

test('candidate statements omitted from model citations remain present in the proposal', async () => {
  const section = getTemplate('safety-requirements').sections[1];
  const candidates = Array.from({ length: 61 }, (_, index) => fact(index));
  const saved = { version: 1, sourceHash: 'saved', candidates, round: 0, completed: {} };
  const generate = jest.fn(async input => {
    const first = input.sources.entries[0];
    return checked(input, [{ key: 'only-first', kind: first.kind, title: first.title, text: first.text, sourceIds: [first.id] }]);
  });
  const objects = await generateConciseSection(args(section), { saved, sourceHash: 'saved', generate, checkpoint: async () => {}, onProgress: jest.fn() });
  expect(objects.filter(object => object.kind === 'narrative').map(object => object.text).sort()).toEqual(candidates.map(candidate => candidate.text).sort());
  expect(generate.mock.calls.length).toBeLessThanOrEqual(6);
});
