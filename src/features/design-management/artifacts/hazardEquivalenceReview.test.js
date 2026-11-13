import { reviewHazardEquivalence } from './hazardEquivalenceReview';
import { consolidateHazardRows } from './consolidateHazardRows';
import { hazardTrackingExportRows } from './hazardTrackingExport';
import { hazardResponseError } from './hazardEquivalenceResponse';

const row = (id, hazard, extra = {}) => ({ id, hazardTrackingRow: true, attributes: { Hazard: hazard, Function: 'Brake controller', Loss: 'Collision', ...extra }, sourceIds: [`source-${id}`] });
const options = objects => ({ objects, checkpoint: jest.fn(), request: jest.fn(async () => ({ groups: [] })) });

test('combines paraphrases as table metadata while preserving original assessments, context and exports', async () => {
  const objects = [row('one', 'Brake command is not delivered', { 'Operational Mode': 'Driving', 'Safety Classification': 'Safety — Direct' }), row('two', 'Braking request fails to reach the controller', { 'Operational Mode': 'Parking', 'Safety Classification': 'Safety — Related' }), row('late', 'Brake command arrives too late')];
  const original = JSON.stringify(objects), args = options(objects);
  args.request.mockResolvedValue({ groups: [['H1', 'H2']] });
  const result = await reviewHazardEquivalence(args), groups = consolidateHazardRows(result.objects);
  expect(groups).toHaveLength(2); expect(groups[0].rows.map(object => object.id)).toEqual(['one', 'two']);
  expect(groups[0].values.Hazard).toEqual(objects.slice(0, 2).map(object => object.attributes.Hazard));
  expect(groups[0].values['Operational Mode']).toEqual(['Driving', 'Parking']);
  expect(groups[0].values['Safety Classification']).toEqual(['Safety — Direct', 'Safety — Related']);
  expect(JSON.stringify(objects)).toBe(original);
  expect(result.objects.map(object => object.sourceIds)).toEqual(objects.map(object => object.sourceIds));
  expect(hazardTrackingExportRows(result.objects)).toHaveLength(2);
  expect(result.state).toMatchObject({ complete: true, next: 3 });
  const resume = options(result.objects); resume.saved = result.state;
  await reviewHazardEquivalence(resume); expect(resume.request).not.toHaveBeenCalled();
});

test('a manual change invalidates that assessment’s prior equivalence group', async () => {
  const args = options([row('one', 'Braking unavailable'), row('two', 'Brakes fail to engage')]);
  args.request.mockResolvedValue({ groups: [['H1', 'H2']] });
  const { objects } = await reviewHazardEquivalence(args);
  expect(consolidateHazardRows(objects)).toHaveLength(1);
  objects[1] = { ...objects[1], attributes: { ...objects[1].attributes, Hazard: 'Brakes remain engaged when release is commanded' } };
  expect(consolidateHazardRows(objects)).toHaveLength(2);
});

test('retained manual objects cannot join a new meaning through a reused representative row ID', async () => {
  const before = options([row('one', 'Braking unavailable'), row('two', 'Brakes fail to engage')]);
  before.request.mockResolvedValue({ groups: [['H1', 'H2']] });
  const old = await reviewHazardEquivalence(before);
  const after = options([row('one', 'Brakes will not release'), row('three', 'Braking continues after release is commanded')]);
  after.request.mockResolvedValue({ groups: [['H1', 'H2']] });
  const next = await reviewHazardEquivalence(after);
  expect(consolidateHazardRows([...next.objects, { ...old.objects[1], manual: true }])).toHaveLength(2);
});

test('changing operating conditions requires a fresh semantic comparison for that assessment', async () => {
  const args = options([row('one', 'Braking unavailable'), row('two', 'Brakes fail to engage')]);
  args.request.mockResolvedValue({ groups: [['H1', 'H2']] });
  const { objects } = await reviewHazardEquivalence(args);
  objects[1] = { ...objects[1], attributes: { ...objects[1].attributes, 'Operating Conditions': 'Only during commanded maintenance' } };
  expect(consolidateHazardRows(objects)).toHaveLength(2);
});

test.each([
  { groups: [['H1', 'unknown']] },
  { groups: [['unknown']] },
  { groups: ['H1'] },
  { objects: [] },
])('invalid provider memberships cannot alter the table (%j)', async response => {
  const args = options([row('one', 'Braking unavailable'), row('two', 'Brakes fail to engage'), row('three', 'Brakes release unexpectedly')]);
  args.request.mockResolvedValue(response);
  await expect(reviewHazardEquivalence(args)).rejects.toMatchObject({ code: 'HAZARD_GROUPS_INVALID' });
  expect(args.checkpoint.mock.calls.every(([state]) => !Object.keys(state.parents).length)).toBe(true);
  expect(args.objects.every(object => !object.hazardEquivalence)).toBe(true);
});

test('duplicate IDs, overlapping valid groups and unmatched singletons do not stop consolidation', async () => {
  const args = options([row('one', 'Braking unavailable'), row('two', 'Brakes fail to engage'), row('three', 'Requested braking is absent'), row('four', 'Brakes remain engaged')]);
  args.request.mockResolvedValue({ groups: [['H1', 'H2', 'H1'], ['H2', 'H3'], ['H1', 'H2'], ['H4']] });
  const result = await reviewHazardEquivalence(args), groups = consolidateHazardRows(result.objects);
  expect(args.request).toHaveBeenCalledTimes(1); expect(result.state.complete).toBe(true);
  expect(groups).toHaveLength(2); expect(groups[0].rows.map(object => object.id)).toEqual(['one', 'two', 'three']);
  expect(groups[1].rows.map(object => object.id)).toEqual(['four']);
});

test('candidate-only equivalences are ignored after validating their references', async () => {
  const objects = Array.from({ length: 66 }, (_, index) => row(String(index), `Brake command missing at actuator ${index}`));
  const args = options(objects);
  args.request.mockResolvedValueOnce({ groups: [] }).mockResolvedValueOnce({ groups: [['H1', 'H2'], ['H65', 'H66']] });
  const result = await reviewHazardEquivalence(args), groups = consolidateHazardRows(result.objects);
  expect(groups.find(group => group.rows.some(object => object.id === '0')).rows).toHaveLength(1);
  expect(groups.find(group => group.rows.some(object => object.id === '64')).rows.map(object => object.id)).toEqual(['64', '65']);
});

test('a later failed batch resumes saved comparisons and can match earlier wording with synonyms', async () => {
  const objects = Array.from({ length: 66 }, (_, index) => row(String(index), `Unavailable brake command affecting actuator number ${index}`));
  const args = options(objects), checkpoints = [];
  args.checkpoint.mockImplementation(state => checkpoints.push(state));
  args.request.mockResolvedValueOnce({ groups: [['H1', 'H2']] }).mockRejectedValueOnce(new Error('Provider unavailable'));
  await expect(reviewHazardEquivalence(args)).rejects.toThrow('Provider unavailable');
  expect(checkpoints).toHaveLength(1); expect(checkpoints[0].next).toBe(64);
  const retry = options(objects); retry.saved = checkpoints[0];
  retry.request.mockImplementation(async ({ records, newIds }) => { expect(records.some(record => record.id === 'H1')).toBe(true); expect(newIds).toEqual(['H65', 'H66']); return { groups: [['H1', 'H65']] }; });
  const result = await reviewHazardEquivalence(retry);
  expect(retry.request).toHaveBeenCalledTimes(1);
  expect(consolidateHazardRows(result.objects).find(group => group.rows.some(object => object.id === '0')).rows.map(object => object.id)).toEqual(['0', '1', '64']);
});

test('an unreadable response retries the same comparison with a correction before changing any membership', async () => {
  const args = options([row('one', 'Braking unavailable'), row('two', 'Brakes fail to engage')]);
  args.request.mockRejectedValueOnce(hazardResponseError()).mockResolvedValueOnce({ groups: [['H1', 'H2']] });
  const result = await reviewHazardEquivalence(args);
  expect(args.request).toHaveBeenCalledTimes(2);
  expect(args.request.mock.calls[1][0]).toMatchObject({ formatCorrection: true });
  expect(args.request.mock.calls[1][0].newIds).toEqual(args.request.mock.calls[0][0].newIds);
  expect(consolidateHazardRows(result.objects)).toHaveLength(1);
  expect(args.checkpoint).toHaveBeenCalledTimes(1);
});

test('repeated malformed output reduces comparisons and retains completed progress on resume', async () => {
  const objects = Array.from({ length: 66 }, (_, index) => row(String(index), `Unavailable brake command affecting actuator number ${index}`));
  const args = options(objects), saved = [];
  args.checkpoint.mockImplementation(state => saved.push(state));
  args.request.mockResolvedValueOnce({ groups: [['H1', 'H2']] }).mockRejectedValueOnce(hazardResponseError()).mockRejectedValueOnce(hazardResponseError());
  args.request.mockImplementation(async ({ newIds }) => {
    if (newIds.length > 1) throw hazardResponseError();
    throw new Error('Provider offline');
  });
  await expect(reviewHazardEquivalence(args)).rejects.toThrow('Provider offline');
  const checkpoint = saved.at(-1);
  expect(checkpoint).toMatchObject({ next: 64, comparisonSize: 1, parents: { H2: 'H1' } });
  const retry = options(objects); retry.saved = checkpoint;
  const result = await reviewHazardEquivalence(retry);
  expect(retry.request.mock.calls.map(([request]) => request.newIds)).toEqual([['H65'], ['H66']]);
  expect(result.state.complete).toBe(true);
  expect(consolidateHazardRows(result.objects).find(group => group.rows.some(object => object.id === '0')).rows.map(object => object.id)).toEqual(['0', '1']);
});

test('cancellation never applies an unfinished comparison; identifier-only labels need no AI interpretation', async () => {
  const controller = new AbortController(), args = options([row('one', 'Braking unavailable'), row('two', 'Brakes fail to engage')]);
  args.signal = controller.signal; args.request.mockImplementation(async () => { controller.abort(); return { groups: [['H1', 'H2']] }; });
  await expect(reviewHazardEquivalence(args)).rejects.toMatchObject({ name: 'AbortError' }); expect(args.checkpoint).not.toHaveBeenCalled();
  const identifiers = options(Array.from({ length: 26278 }, (_, index) => row(String(index), `Hazard ${index}`)));
  const result = await reviewHazardEquivalence(identifiers);
  expect(identifiers.request).not.toHaveBeenCalled(); expect(result.objects).toHaveLength(26278);
  expect(result.state.complete).toBe(true);
});

test('a successful fallback gradually returns to bounded batch comparisons rather than staying at one', async () => {
  const objects = Array.from({ length: 100 }, (_, index) => row(String(index), `Brake command missing at actuator ${index}`));
  const args = options(objects);
  args.request.mockRejectedValueOnce(hazardResponseError()).mockRejectedValueOnce(hazardResponseError());
  args.request.mockImplementation(async ({ newIds }) => { if (newIds.length > 1 && args.request.mock.calls.length < 13) throw hazardResponseError(); return { groups: [] }; });
  const result = await reviewHazardEquivalence(args);
  expect(result.state.complete).toBe(true);
  expect(args.request.mock.calls.some(([request]) => request.newIds.length === 1)).toBe(true);
  expect(args.request.mock.calls.slice(13).some(([request]) => request.newIds.length >= 4)).toBe(true);
  expect(result.objects).toHaveLength(100);
});
