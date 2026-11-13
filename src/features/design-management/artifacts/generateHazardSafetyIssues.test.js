import { generateHazardSafetyIssues } from './generateHazardSafetyIssues';
import { consolidateSafetyIssues } from '../../project-hazard-analysis/safetyIssueGeneration';
import { consolidateHazardRows } from './consolidateHazardRows';
import { hazardIssueCells } from './actionableSafetyIssue';

const section = { id: 'table:s2', sectionId: 's2', kind: 'section' };
const objects = [section, ...['Incorrect map projection', 'Invalid route geometry', 'Lost remote command'].map((Hazard, index) => ({ id: `row-${index}`, hazardTrackingRow: true, sectionId: 's2', attributes: { Hazard, Function: index < 2 ? 'Map loader → Geometry → Route planner' : 'Operator → Command → Vehicle', 'Safety Classification': 'Safety — Direct', 'Guide Phrase Applicable': 'Yes' }, sourceIds: [`source-${index}`] }))];
const request = async ({ families }) => families.map(family => ({ title: family.rows[0].cells['Function (From)'] === 'Map loader' ? 'Invalid route planning from incorrect map geometry' : 'Loss of remote vehicle command delivery', description: family.rows[0].cells['Function (From)'] === 'Map loader' ? 'Incorrect map projection and route geometry can produce an invalid planned path. The linked map interpretation and planning evidence require a common correctness strategy.' : 'Remote commands may fail to reach the vehicle, preventing the intended control action. Delivery assurance must address the linked command-loss evidence.', sourceFamilyIds: [family.familyId] }));

test('HTL and Projects use identical semantic titles, descriptions, boundaries and full source coverage', async () => {
  const safetyRows = objects.slice(1).map((object, index) => ({ sourceIndex: index + 1, sourceRowId: object.id, cells: hazardIssueCells(object.attributes) }));
  const projectIssues = await consolidateSafetyIssues(safetyRows, { request });
  const result = await generateHazardSafetyIssues({ objects, meta: { title: 'HTL', config: { system: 'Localization' } }, request, checkpoint: async () => {} });
  const groups = consolidateHazardRows(result);
  expect(groups.map(group => group.safetyIssue.title)).toEqual(projectIssues.map(issue => issue.title));
  expect(groups.map(group => group.safetyIssue.description)).toEqual(projectIssues.map(issue => issue.description));
  expect(groups.map(group => group.rows.length)).toEqual([2, 1]);
  expect(result.filter(row => row.hazardTrackingRow).map(row => row.attributes)).toEqual(objects.slice(1).map(row => row.attributes));
  expect(groups[0].issueDescription).toContain('Invalid route planning from incorrect map geometry');
  const edited = result.map(row => row.id === 'row-0' ? { ...row, attributes: { ...row.attributes, Hazard: 'An independently changed unsafe condition' } } : row);
  expect(consolidateHazardRows(edited).every(group => !group.safetyIssue)).toBe(false);
  expect(consolidateHazardRows(edited).find(group => group.rows.some(row => row.id === 'row-0')).safetyIssue).toBeUndefined();
});

test('a provider failure publishes completed summaries and resumes without regenerating accepted evidence', async () => {
  let saved, partial;
  const interrupted = jest.fn(async ({ families }) => {
    if (interrupted.mock.calls.length > 1) throw new Error('Provider interrupted after a valid issue');
    return request({ families: families.slice(0, 1) });
  });
  await expect(generateHazardSafetyIssues({ objects, meta: { title: 'HTL', config: { system: 'Localization' } }, request: interrupted, checkpoint: async state => { saved = state; }, onPartial: async value => { partial = value; } })).rejects.toThrow('Provider interrupted');
  const groups = consolidateHazardRows(partial);
  expect(groups.filter(group => group.safetyIssue)).toHaveLength(1);
  expect(groups[0].safetyIssue.title).toBe('Invalid route planning from incorrect map geometry');
  expect(groups[1].safetyIssue).toBeUndefined(); expect(groups[1].issueDescription).not.toContain('undefined');
  const resume = jest.fn(request);
  const complete = await generateHazardSafetyIssues({ objects: partial, meta: { title: 'HTL', config: { system: 'Localization' } }, saved, request: resume, checkpoint: async () => {} });
  expect(resume).toHaveBeenCalledTimes(1); expect(resume.mock.calls[0][0].families[0].rows[0].cells['Function (From)']).toBe('Operator');
  expect(consolidateHazardRows(complete).every(group => group.safetyIssue)).toBe(true);
});
