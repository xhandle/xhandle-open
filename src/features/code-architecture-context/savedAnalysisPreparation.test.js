import { ensureCodeArchitectureTraceIds, ensureCodeArchitectureTraceIdsAsync } from '../code-architecture-hazard-analysis/codeArchitectureHazardUtils';
import { immutableFunctionalRowsAsync } from './functionalModel';
jest.mock('../code-architecture-assurance/EngineeringArtifactTable', () => () => null);

test('incremental preparation preserves existing identities, eligibility, and evidence', async () => {
  const rows = ensureCodeArchitectureTraceIds(Array.from({ length: 128 }, (_, i) => ({ from: 'shared', to: `target${i}`, action: 'Call', fromFile: 'a.cpp', codeEvidence: { text: 'evidence' } })));
  const progress = [];
  const result = await ensureCodeArchitectureTraceIdsAsync(rows, { onProgress: value => progress.push(value) });
  expect(result).toEqual(ensureCodeArchitectureTraceIds(rows));
  expect(new Set(result.map(row => row.fromNodeId)).size).toBe(1);
  expect(progress[0]).toBe(0);
  expect(progress.at(-1)).toBe(100);
  expect(progress.some(value => value > 0 && value < 100)).toBe(true);
  expect(progress).toEqual([...progress].sort((a, b) => a - b));
  const frozen = await immutableFunctionalRowsAsync(result);
  expect(frozen).toEqual(rows);
  expect(Object.isFrozen(frozen)).toBe(true);
  expect(Object.isFrozen(frozen[0].codeEvidence)).toBe(true);
});

test('cancelled preparation does not adopt an obsolete project revision', async () => {
  expect(await ensureCodeArchitectureTraceIdsAsync([{ from: 'a' }], { isCancelled: () => true })).toBeNull();
  expect(await immutableFunctionalRowsAsync([{}], { isCancelled: () => true })).toBeNull();
});

test('preparation yields to browser tasks during work', async () => {
  let clock = 0, browserTaskRan = false;
  const time = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 10));
  try {
    setTimeout(() => { browserTaskRan = true; }, 0);
    await ensureCodeArchitectureTraceIdsAsync([{ from: 'a', to: 'b' }]);
    expect(browserTaskRan).toBe(true);
    browserTaskRan = false;
    setTimeout(() => { browserTaskRan = true; }, 0);
    await immutableFunctionalRowsAsync([{ evidence: {} }]);
    expect(browserTaskRan).toBe(true);
  } finally { time.mockRestore(); }
});
