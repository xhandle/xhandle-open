import { candidateConsolidationPlan, mergeIdenticalCandidates } from './consolidationCandidates';

const fact = (title, text, sourceIds) => ({ key: title, title, text, kind: 'requirement', sourceIds });
test('exact duplicate wording combines citations without conflating units or responsibilities', () => {
  const candidates = [fact('Power limit', 'The device shall remain below 10 mW.', ['a']), fact('Power limit', 'The device shall remain below 10 mW.', ['b']), fact('Power limit', 'The device shall remain below 10 MW.', ['c']), fact('Different controller', 'The device shall remain below 10 mW.', ['d'])];
  const merged = mergeIdenticalCandidates(candidates);
  expect(merged).toHaveLength(3);
  expect(merged[0].sourceIds).toEqual(['a', 'b']);
  expect(candidates[0].sourceIds).toEqual(['a']);
});
test('the plan bounds candidate counts as well as request size and preserves every candidate identity', () => {
  const candidates = Array.from({ length: 211 }, (_, index) => fact(`Concern ${index}`, `Recorded requirement ${index}.`, [`HTR-${index % 35}`]));
  const plan = candidateConsolidationPlan(candidates);
  expect(plan.groups.every(group => group.length <= 24)).toBe(true);
  expect(new Set(plan.groups.flat().map(source => source.id)).size).toBe(candidates.length);
  for (const entry of plan.groups.flat()) expect(plan.citations.get(entry.id)).toEqual(plan.byId.get(entry.id).sourceIds);
});
