import { buildActionableHazardFamilies, outsideSafetyScope } from './actionableHazardFamilies';
import { consolidateHazardRows, assignHazardTrackingRecordNumbers, hazardGroupValues } from './consolidateHazardRows';
import { reviewHazardEquivalence } from './hazardEquivalenceReview';
import { filterHazardGroups } from './hazardTableControls';

const row = (id, attributes) => ({ id: String(id), hazardTrackingRow: true, sectionId: 's2', attributes, sourceIds: [`source-${id}`] });
test('3482 distinct hazard permutations become 35 actionable functional concerns without losing assessments', async () => {
  const objects = Array.from({ length: 3482 }, (_, index) => row(index, {
    Hazard: `Distinct unsafe state ${index}`, Function: `Function ${index % 35}`, 'Operational Scenario': `Scenario ${index % 8}`, 'Guide Phrase': index % 2 ? 'Late' : 'Not provided', 'Guide Phrase Applicable': 'Yes', 'Safety Classification': 'Safety — Direct', 'Safety Constraint': `Constraint ${index}`, Verification: `Test ${index}`,
  }));
  const request = jest.fn(async () => ({ groups: [] }));
  const result = await reviewHazardEquivalence({ objects, mode: 'actionable', request, checkpoint: async () => {} });
  const numbered = assignHazardTrackingRecordNumbers(result.objects);
  const groups = consolidateHazardRows(numbered);
  expect(groups).toHaveLength(35);
  expect(groups.flatMap(group => group.rows)).toHaveLength(3482);
  expect(groups.map(group => group.recordId)).toEqual(Array.from({ length: 35 }, (_, index) => `HTR-${index + 1}`));
  expect(result.objects.map(object => object.attributes)).toEqual(objects.map(object => object.attributes));
  expect(result.objects.map(object => object.sourceIds)).toEqual(objects.map(object => object.sourceIds));
  expect(request.mock.calls.length).toBeLessThan(5);
  expect(request.mock.calls[0][0].mode).toBe('actionable');
  expect(request.mock.calls[0][0].records[0].hazardVariants.values.length).toBeGreaterThan(1);
  expect(hazardGroupValues(groups[0], 'Actionable Safety Issue Title')[0]).toContain('summary pending');
});

test('semantic actionable review can combine different functions, preserving original hazards and verification', async () => {
  const objects = [row(1, { Hazard: 'Missing position estimate', Function: 'Localize', Verification: 'GNSS test' }), row(2, { Hazard: 'Incorrect map match', Function: 'Match route', Verification: 'Map test' })];
  const result = await reviewHazardEquivalence({ objects, mode: 'actionable', request: async ({ records }) => ({ groups: [records.map(record => record.id)] }), checkpoint: async () => {} });
  const groups = consolidateHazardRows(result.objects);
  expect(groups).toHaveLength(1); expect(groups[0].rows).toHaveLength(2);
  expect(groups[0].values.Hazard).toEqual(['Missing position estimate', 'Incorrect map match']);
  expect(groups[0].values.Verification).toEqual(['GNSS test', 'Map test']);
});

test('nonapplicable and mission rows stay saved, with manual changes invalidating stale family membership', () => {
  const rows = [row(1, { Hazard: 'Loss', Function: 'Brake', 'Safety Classification': 'Safety — Direct' }), row(2, { Hazard: 'Late', Function: 'Brake', 'Safety Classification': 'Mission/Reliability' }), row(3, { Hazard: 'Other', Function: 'Brake', 'Guide Phrase Applicable': 'No' })];
  const objects = buildActionableHazardFamilies(rows);
  expect(objects).toHaveLength(3); expect(objects.filter(outsideSafetyScope)).toHaveLength(2);
  expect(consolidateHazardRows(objects)).toHaveLength(1);
  const edited = { ...objects[1], attributes: { ...objects[1].attributes, 'Safety Classification': 'Safety — Direct' } };
  expect(outsideSafetyScope(edited)).toBe(false);
  expect(consolidateHazardRows([objects[0], edited])).toHaveLength(2);
});

test('column filters use original assessment combinations and preserve stable record IDs', () => {
  const groups = consolidateHazardRows([row(1, { Hazard: 'Loss', Function: 'Brake', 'Operational Mode': 'Driving' }), row(2, { Hazard: 'Loss', Function: 'Steer', 'Operational Mode': 'Parking' }), row(3, { Hazard: 'Late', Function: 'Steer', 'Operational Mode': 'Driving' })]);
  expect(filterHazardGroups(groups, { Function: { mode: 'include', values: ['Brake'] }, 'Operational Mode': { mode: 'include', values: ['Parking'] } })).toHaveLength(0);
  expect(filterHazardGroups(groups, { Function: { mode: 'include', values: ['Steer'] }, 'Operational Mode': { mode: 'include', values: ['Driving'] } })[0].recordId).toBe('HTR-2');
  expect(filterHazardGroups(groups, { HTR: { mode: 'include', values: ['HTR-1'] }, Hazard: { mode: 'include', values: ['Loss'] } })[0]).toBe(groups[0]);
});
