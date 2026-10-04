import { resolveArchitectureTarget, retryDiagramFocus } from './codeArchitectureNavigation';

const rows = [
  { traceId: 'FD-other', rowRef: 1, fromFunction: 'Other', controlAction: 'Other', toFunction: 'Other', edgeId: 'wrong' },
  { traceId: 'FD-target', rowRef: 2, fromFunction: 'Plan', controlAction: 'Stop', toFunction: 'Control', fromNodeId: 'current-plan', toNodeId: 'current-control', edgeId: 'current-edge' },
];
test('refreshes stale IDs and positions from the current trace identity', () => {
  expect(resolveArchitectureTarget({ type: 'node', mode: 'to', traceId: 'FD-target', nodeId: 'deleted', rowIndex: 0 }, rows))
    .toMatchObject({ nodeId: 'current-control', rowIndex: 1 });
});
test('stale row reference never overrides the matching interface', () => {
  expect(resolveArchitectureTarget({ type: 'edge', rowRef: 1, edgeId: 'deleted', fromFunction: 'Plan', controlAction: 'Stop', toFunction: 'Control' }, rows))
    .toMatchObject({ edgeId: 'current-edge', rowIndex: 1 });
});
test('does not guess an ambiguous or deleted interface from its old index', () => {
  const target = { type: 'edge', rowIndex: 0, fromFunction: 'Plan', controlAction: 'Stop', toFunction: 'Control' };
  expect(resolveArchitectureTarget(target, [rows[1], { ...rows[1], edgeId: 'duplicate' }])).toBeNull();
  expect(resolveArchitectureTarget({ type: 'edge', rowIndex: 0, traceId: 'deleted' }, rows)).toBeNull();
});
test('waits past the old timeout until focus succeeds, then acknowledges once', () => {
  jest.useFakeTimers();
  const focus = jest.fn().mockReturnValue(false), done = jest.fn();
  const cancel = retryDiagramFocus(() => ({ focusArchitectureTarget: focus }), {}, done);
  jest.advanceTimersByTime(7000);
  expect(done).not.toHaveBeenCalled();
  focus.mockReturnValue(true);
  jest.advanceTimersByTime(1000);
  expect(done).toHaveBeenCalledTimes(1);
  cancel(); jest.useRealTimers();
});
test('cancels an old request when a new navigation supersedes it', () => {
  jest.useFakeTimers();
  const focus = jest.fn().mockReturnValue(false), oldDone = jest.fn(), newDone = jest.fn();
  const cancel = retryDiagramFocus(() => ({ focusArchitectureTarget: focus }), { nodeId: 'old' }, oldDone);
  jest.advanceTimersByTime(50); cancel();
  focus.mockReturnValue(true);
  retryDiagramFocus(() => ({ focusArchitectureTarget: focus }), { nodeId: 'new' }, newDone);
  jest.advanceTimersByTime(1000);
  expect(oldDone).not.toHaveBeenCalled();
  expect(newDone).toHaveBeenCalledTimes(1);
  expect(focus.mock.calls.at(-1)[0]).toEqual({ nodeId: 'new' });
  jest.useRealTimers();
});
test('uses source files to disambiguate otherwise identical interfaces', () => {
  const duplicate = { ...rows[1], traceId: 'FD-copy', edgeId: 'copy', fromFile: 'other.js' };
  const current = { ...rows[1], fromFile: 'plan.js' };
  expect(resolveArchitectureTarget({ type: 'edge', fromFunction: 'Plan', controlAction: 'Stop', toFunction: 'Control', fromFile: 'plan.js' }, [duplicate, current]))
    .toMatchObject({ edgeId: 'current-edge', rowIndex: 1 });
});
