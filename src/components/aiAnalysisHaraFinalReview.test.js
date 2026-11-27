import { reviewProjectHaraFinal, projectHaraFinalReviewPrompt } from './aiAnalysisHaraFinalReview';
import { refreshProjectHaraSheets, PROJECT_HARA_HEADERS } from '../features/project-hazard-analysis/projectHara';
jest.mock('./aiAnalysisSTPA', () => ({ fetchLLMResponse: jest.fn() }));
const fixture = (count = 1, overrides = {}) => {
  const headers = ['Raw Analysis Row ID', 'Functional Safety Requirements', ...PROJECT_HARA_HEADERS];
  const values = { 'Guide Phrase Applicable': 'Yes', Item: 'Automated vehicle braking',
    'Hazardous Event': 'Vehicle crosses an occupied crossing without stopping.', 'Potential Harm': 'Fatal pedestrian injury.',
    Severity: 'S3', 'Severity Rationale': 'Impact can fatally injure a pedestrian.', Exposure: 'E4', 'Exposure Rationale': 'Frequent occupied crossings.',
    Controllability: 'C0', 'Controllability Rationale': 'Pedestrians cannot avoid the impact.',
    'Safety Goal': 'The vehicle shall prevent loss of braking at occupied crossings.',
    'Safe State': 'Standstill before the crossing.', 'Fault Tolerant Time Interval': 'clearance / closing speed',
    'FTTI Rationale': 'Time from fault to hazardous crossing entry; detection plus full braking must finish earlier.',
    'Functional Safety Requirements': 'The vehicle shall preserve emergency braking.', ...overrides };
  return refreshProjectHaraSheets({ Summary: [headers, ...Array.from({ length: count }, (_, index) => headers.map(header => header === 'Raw Analysis Row ID' ? `row-${index}` : values[header] || ''))] }, { practical: true });
};
const value = (sheets, field, row = 1) => sheets.Summary[row][sheets.Summary[0].indexOf(field)];
const fix = entries => ({ patches: entries.map(input => ({ id: input.id, issueIds: input.findings.map(issue => issue.findingId),
  reason: 'Correct the people-at-risk avoidance argument.', changes: { Controllability: 'C3',
    'Controllability Rationale': 'The exposed pedestrian cannot avoid impact within the available time.' } })) });
const approve = entries => ({ checks: entries.flatMap(input => input.proposal.groups.map(group => ({ changeId: group.changeId, accept: true,
  reason: 'The revised decision describes pedestrian harm avoidance without crediting an internal safeguard.' }))) });
const normal = async (_prompt, { phase, entries }) => phase === 'find' ? { findings: [] } : phase === 'correct' ? fix(entries) : approve(entries);

test('bounded finding, correction and fresh verification phases cover the table, with two workers and durable replay', async () => {
  const source = fixture(25), original = JSON.stringify(source), cache = new Map();
  const generationCheckpoint = { read: async basis => cache.get(JSON.stringify(basis)), write: async (basis, body) => cache.set(JSON.stringify(basis), body) };
  let current = 0, peak = 0;
  const request = jest.fn(async (prompt, meta) => { current++; peak = Math.max(peak, current); await Promise.resolve(); current--; return normal(prompt, meta); });
  const reviewed = await reviewProjectHaraFinal(source, { request, generationCheckpoint });
  expect(request).toHaveBeenCalledTimes(9); expect(peak).toBe(2);
  expect(request.mock.calls.map(([, meta]) => meta.phase)).toEqual(['find', 'find', 'find', 'correct', 'correct', 'correct', 'verify', 'verify', 'verify']);
  expect(reviewed.haraPostReview.changedRows).toBe(25); expect(reviewed.haraPostReview.changedCells).toBe(50);
  expect(reviewed.haraPostReview.workflow).toMatchObject({ phases: ['find', 'correct', 'verify'], verifiedGroups: 25 });
  await reviewProjectHaraFinal(source, { request, generationCheckpoint }); expect(request).toHaveBeenCalledTimes(9);
  await reviewProjectHaraFinal(reviewed, { request }); expect(request).toHaveBeenCalledTimes(9);
  expect(JSON.stringify(source)).toBe(original);
});

test('a sound C0 needs only inspection; malformed requests retain final decisions without indefinite repairs', async () => {
  const source = fixture(1, { Controllability: 'C0', 'Controllability Rationale': 'Generally controllable: people can easily step clear with ample time.' });
  const request = jest.fn(async () => ({ findings: [] }));
  expect((await reviewProjectHaraFinal(source, { request })).haraPostReview.changedCells).toBe(0); expect(request).toHaveBeenCalledTimes(1);
  const invalid = jest.fn(async () => '{invalid'), retained = await reviewProjectHaraFinal(fixture(), { request: invalid });
  expect(invalid).toHaveBeenCalledTimes(2); expect(retained.haraPostReview.changedCells).toBe(0);
  expect(value(retained, 'Assessment Status')).toBe('Complete'); expect(value(retained, 'HARA Review Findings')).toBe('');
});

test('a malformed identity does not discard a different valid assessment in the same response batch', async () => {
  const source = fixture(2);
  const request = async (prompt, meta) => {
    if (meta.phase !== 'correct') return normal(prompt, meta);
    const output = fix(meta.entries);
    output.patches[1].id = 'unknown-assessment';
    return output;
  };
  const result = await reviewProjectHaraFinal(source, { request });
  expect(value(result, 'Controllability', 1)).toBe('C3');
  expect(value(result, 'Controllability', 2)).toBe(value(source, 'Controllability', 2));
});

test('duplicate verifier identities retain that group only, without discarding a different valid check', async () => {
  const source = fixture(3);
  const request = async (prompt, meta) => {
    if (meta.phase !== 'verify') return normal(prompt, meta);
    const output = approve(meta.entries);
    output.checks[1] = { ...output.checks[0] };
    return output;
  };
  const result = await reviewProjectHaraFinal(source, { request });
  expect(value(result, 'Controllability', 1)).toBe(value(source, 'Controllability', 1));
  expect(value(result, 'Controllability', 2)).toBe(value(source, 'Controllability', 2));
  expect(value(result, 'Controllability', 3)).toBe('C3');
});

test('forged issue evidence, source rewrites, wrong snapshots and unknown identities cannot become edits', async () => {
  const sound = fixture(1, { Controllability: 'C3' });
  const forged = jest.fn(async () => ({ findings: [{ id: 'row-0', code: 'FTTI', fields: ['FTTI Rationale'],
    reason: 'Invented source.', evidence: [{ field: 'FTTI Rationale', quote: 'Not present in source' }] }] }));
  expect((await reviewProjectHaraFinal(sound, { request: forged })).haraPostReview.changedCells).toBe(0); expect(forged).toHaveBeenCalledTimes(1);
  for (const corruption of ['source', 'hash', 'unknown']) {
    const request = jest.fn(async (prompt, meta) => {
      if (meta.phase !== 'correct') return normal(prompt, meta);
      const output = fix(meta.entries);
      if (corruption === 'source') output.patches[0].changes.Hazard = 'Rewritten source';
      if (corruption === 'hash') output.patches[0].hash = 'stale';
      if (corruption === 'unknown') output.patches[0].id = 'unknown';
      return output;
    });
    expect((await reviewProjectHaraFinal(fixture(), { request })).haraPostReview.changedCells).toBe(0); expect(request).toHaveBeenCalledTimes(2);
  }
});

test('fresh verification can reject a proposed timing change while preserving a sound independent control correction', async () => {
  const source = fixture(1, { 'FTTI Rationale': 'FTTI = stopping distance + network latency.' });
  const request = jest.fn(async (prompt, meta) => {
    if (meta.phase === 'correct') {
      const output = fix(meta.entries);
      output.patches[0].changes['FTTI Rationale'] = 'Fault-to-hazard interval = clearance distance / closing speed; full response must finish earlier.';
      return output;
    }
    if (meta.phase === 'verify') return { checks: meta.entries.flatMap(input => input.proposal.groups.map(group => ({ changeId: group.changeId,
      accept: group.group === 'control', reason: group.group === 'control' ? 'People cannot avoid this impact.' : 'Timing change does not address the complete physical response.' }))) };
    return normal(prompt, meta);
  });
  const result = await reviewProjectHaraFinal(source, { request });
  expect(request).toHaveBeenCalledTimes(3); expect(value(result, 'Controllability')).toBe('C3');
  expect(value(result, 'FTTI Rationale')).toBe(value(source, 'FTTI Rationale')); expect(result.haraPostReview.changedCells).toBe(2);
  expect(value(result, 'Assessment Status')).toBe('Complete');
});

test('bad mitigation-credit downgrades are blocked without losing an unrelated emergency-stop correction', async () => {
  const source = fixture(1, { Controllability: 'C2', 'Controllability Rationale': 'An attentive pedestrian has some opportunity to step clear.',
    'Functional Safety Requirements': 'The controller shall reject stop requests older than 200 ms.' });
  const request = jest.fn(async (_prompt, { phase, entries }) => {
    if (phase === 'find') return { findings: [{ id: entries[0].id, code: 'CONTROLLABILITY', fields: ['Controllability', 'Controllability Rationale'],
      reason: 'Reassess the avoidance action.', evidence: [{ field: 'Controllability Rationale', quote: entries[0].assessment['Controllability Rationale'] }] }] };
    if (phase === 'correct') return { patches: entries.map(input => ({ id: input.id, issueIds: input.findings.map(issue => issue.findingId), reason: 'Correct avoidance and stopping behavior.',
      changes: { Controllability: 'C1', 'Controllability Rationale': 'The system implements automated inhibition that prevents harmful motion independently of operator detection.',
        'Functional Safety Requirements': 'The vehicle shall preserve emergency braking while the hazard remains present, independently of routine stale-command rejection.' } })) };
    if (phase === 'refine') return { patches: [] };
    expect(entries[0].proposal.groups.map(group => group.group)).toEqual(['response']);
    return approve(entries);
  });
  const result = await reviewProjectHaraFinal(source, { request });
  expect(value(result, 'Controllability')).toBe('C2'); expect(value(result, 'Functional Safety Requirements')).toContain('preserve emergency braking');
  expect(result.haraPostReview.changedCells).toBe(1);
});

test('one scoped refinement repairs a machine-rejected proposal and cannot rewrite already sound groups', async () => {
  const source = fixture(1, { 'Potential Harm': 'The dependent operation fails.', Controllability: 'C3' });
  const phases = [];
  const request = async (_prompt, { phase, entries }) => {
    phases.push(phase);
    if (phase === 'find') return { findings: [] };
    if (phase === 'correct') return { patches: [{ id: entries[0].id, issueIds: entries[0].findings.map(issue => issue.findingId),
      reason: 'Attempt injury correction.', changes: { 'Potential Harm': 'The operation cannot achieve its intended outcome.' } }] };
    if (phase === 'refine') {
      expect(entries[0].refinement.allowedFields).toContain('Potential Harm');
      expect(entries[0].refinement.allowedFields).not.toContain('Controllability');
      return { patches: [{ id: entries[0].id, issueIds: entries[0].findings.map(issue => issue.findingId), reason: 'State the injury consequence.',
        changes: { 'Potential Harm': 'Pedestrian crushing injuries or death from vehicle impact.' } }] };
    }
    return approve(entries);
  };
  const result = await reviewProjectHaraFinal(source, { request });
  expect(phases).toEqual(['find', 'correct', 'refine', 'verify']);
  expect(value(result, 'Potential Harm')).toContain('crushing injuries');
  expect(result.haraPostReview.quality.before.HARM).toBe(1);
  expect(result.haraPostReview.quality.after.HARM).toBeUndefined();
  expect(value(result, 'Assessment Status')).toBe('Complete');
});

test('a verifier approval cannot bypass exposure and response-budget guards; no endless refinement follows', async () => {
  const source = fixture(1, { Controllability: 'C3', 'Exposure Rationale': 'Exposure is based on the probability of network failure.' });
  const phases = [];
  const request = async (_prompt, { phase, entries }) => {
    phases.push(phase);
    if (phase === 'find') return { findings: [] };
    if (phase === 'verify') return approve(entries);
    return { patches: [{ id: entries[0].id, issueIds: entries[0].findings.map(issue => issue.findingId), reason: 'Reduce exposure.',
      changes: { Exposure: 'E2', 'Exposure Rationale': 'Exposure is the frequency of missions during which task-data loss occurs.' } }] };
  };
  const result = await reviewProjectHaraFinal(source, { request });
  expect(phases).toEqual(['find', 'correct', 'refine']);
  expect(value(result, 'Exposure')).toBe(value(source, 'Exposure'));
  expect(result.haraPostReview.changedCells).toBe(0);
});

test('new harm descriptions are mandatory findings; edits remain linked to those issues and independently checked', async () => {
  const source = fixture(1, { Controllability: 'C3', 'Potential Harm': 'The dependent operation does not achieve its intended outcome.' });
  const request = jest.fn(async (_prompt, { phase, entries }) => {
    if (phase === 'find') return { findings: [] };
    if (phase === 'correct') {
      expect(entries[0].findings.map(issue => issue.code)).toContain('HARM');
      return { patches: [{ id: entries[0].id, issueIds: entries[0].findings.map(issue => issue.findingId), reason: 'State human injury from this collision.', changes: { 'Potential Harm': 'Crushing injuries or death to pedestrians struck by the vehicle.' } }] };
    }
    return approve(entries);
  });
  const result = await reviewProjectHaraFinal(source, { request });
  expect(value(result, 'Potential Harm')).toContain('Crushing injuries'); expect(request).toHaveBeenCalledTimes(3);
});

test('a shared-goal refinement is retained unless independently verified for every linked assessment', async () => {
  const source = fixture(2, { Controllability: 'C3', 'Safety Goal': 'The vehicle shall validate packet timestamps every 100 ms.' });
  const request = jest.fn(async (_prompt, { phase, entries }) => {
    if (phase === 'find') return { findings: [] };
    if (phase === 'correct') return { patches: [{ id: entries[0].id, issueIds: entries[0].findings.map(issue => issue.findingId), reason: 'Use one functional goal.',
      changes: { 'Safety Goal': 'The vehicle shall prevent unintended motion at occupied crossings.' } }] };
    expect(entries).toHaveLength(2);
    return { checks: entries.flatMap(input => input.proposal.groups.map(group => ({ changeId: group.changeId, accept: input.id === 'row-0', reason: 'Check the linked event-specific objective.' }))) };
  });
  const result = await reviewProjectHaraFinal(source, { request });
  expect(value(result, 'Safety Goal')).toBe(value(source, 'Safety Goal')); expect(value(result, 'Safety Goal', 2)).toBe(value(source, 'Safety Goal', 2));
});

test('cancellation, account, programming and durable storage failures remain visible without mutating source', async () => {
  const source = fixture(), original = JSON.stringify(source);
  for (const error of [Object.assign(Error('Canceled'), { name: 'AbortError' }), Object.assign(Error('Account'), { status: 401 }), new ReferenceError('Programming error')]) {
    const request = jest.fn(async () => { throw error; });
    await expect(reviewProjectHaraFinal(source, { request })).rejects.toBe(error); expect(request).toHaveBeenCalledTimes(1);
  }
  await expect(reviewProjectHaraFinal(source, { request: normal, generationCheckpoint: { read: async () => null, write: async () => { throw Error('Storage unavailable'); } } })).rejects.toThrow('Storage unavailable');
  const controller = new AbortController(); controller.abort();
  await expect(reviewProjectHaraFinal(source, { request: normal, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(JSON.stringify(source)).toBe(original);
});

test('all stages carry the shared acceptance bar, whole-table context and engineering reasoning rules', () => {
  for (const phase of ['find', 'correct', 'verify']) {
    const prompt = projectHaraFinalReviewPrompt([], { phase, overview: { rows: 385 }, item: { name: 'Synthetic braking item' } });
    expect(prompt).toContain('All primary and corrected assessments are final'); expect(prompt).toContain('retain it as final');
    expect(prompt).toContain('385'); expect(prompt).toContain('Synthetic braking item'); expect(prompt).toContain('Never repeat STPA');
    expect(prompt).toContain('A normative shall requirement'); expect(prompt).toContain('PEOPLE avoiding HARM');
  }
});
