import { inspectSafetyIssues, validateSafetyIssues } from './safetyIssueResponse';
const families = [1, 2, 3].map(id => ({ familyId: `family-${id}`, sourceIndexes: [id * 10, id * 10 + 1] }));
const issue = (ids, patch = {}) => ({ title: 'Invalid route planning from incorrect map geometry', description: 'Incorrect map geometry may produce an invalid planned path. The affected interpretation and planning behavior require a common correctness strategy.', sourceFamilyIds: ids, ...patch });

test('presentation-length targets and harmless formatting do not invalidate correct semantic issues', () => {
  const title = 'Loss of reliable route planning when map projections and lanelet geometry are interpreted inconsistently across supported operating configurations';
  const description = 'The linked evidence requires reliable interpretation of map geometry under the recorded operating conditions. '.repeat(9).trim();
  const [result] = validateSafetyIssues({ issues: [issue([' FAMILY_1 '], { title: title.replace('route planning', 'route\nplanning'), description })] }, families.slice(0, 1));
  expect(result.title).toBe(title); expect(result.description).toBe(description); expect(result.sourceFamilyIds).toEqual(['family-1']);
});
test('valid, disjoint issues survive omitted, unknown and generic proposals', () => {
  const result = inspectSafetyIssues({ issues: [issue(['family-1']), issue(['family-2', 'not-supplied']), issue(['family-3'], { title: 'Unsafe behavior across 143 functional interfaces' })] }, families);
  expect(result.issues).toHaveLength(1); expect(result.issues[0].sourceFamilyIds).toEqual(['family-1']);
  expect(result.pending.map(family => family.familyId)).toEqual(['family-2', 'family-3']);
  expect(result.problems.some(problem => problem.type === 'references')).toBe(true); expect(result.problems.some(problem => problem.type === 'prose')).toBe(true);
});
test('conflicting memberships are repaired while unrelated valid issues remain usable', () => {
  const result = inspectSafetyIssues({ issues: [issue(['family-1']), issue(['family-1', 'family-2'], { title: 'Loss of remote command delivery' }), issue(['family-3'])] }, families);
  expect(result.issues.map(item => item.sourceFamilyIds)).toEqual([['family-3']]);
  expect(result.pending.map(family => family.familyId)).toEqual(['family-1', 'family-2']);
});
test('identical duplicate proposals and numeric local family spellings retain one complete membership', () => {
  const candidate = issue([1]);
  const result = validateSafetyIssues({ issues: [candidate, candidate] }, families.slice(0, 1));
  expect(result).toHaveLength(1); expect(result[0].sourceFamilyIds).toEqual(['family-1']);
});
test('legacy source indexes resolve only entire supplied families; unsolicited indexes cannot contaminate membership', () => {
  const valid = issue(undefined, { sourceIndexes: [10, 11] });
  expect(validateSafetyIssues({ issues: [valid] }, families.slice(0, 1))[0].sourceFamilyIds).toEqual(['family-1']);
  expect(inspectSafetyIssues({ issues: [issue(undefined, { sourceIndexes: [10] })] }, families.slice(0, 1)).issues).toHaveLength(0);
  expect(validateSafetyIssues({ issues: [issue(['family-1'], { sourceIndexes: [999], canonicalHazards: [{ title: 'Invented' }] })] }, families.slice(0, 1))[0]).not.toHaveProperty('sourceIndexes');
  expect(validateSafetyIssues({ issues: [issue(['family-1'], { canonicalHazards: [{ title: 'Invented' }] })] }, families.slice(0, 1))[0]).not.toHaveProperty('canonicalHazards');
});

test('a provider echoing the schema placeholder cannot publish it as an actionable issue', () => {
  const result = inspectSafetyIssues({ issues: [issue(['family-1'], { title: 'specific unsafe condition' })] }, families.slice(0, 1));
  expect(result.issues).toHaveLength(0); expect(result.pending).toHaveLength(1); expect(result.problems[0].type).toBe('prose');
});
