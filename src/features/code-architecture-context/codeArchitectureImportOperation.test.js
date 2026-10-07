import { createCodeArchitectureImportOperation } from './codeArchitectureImportOperation';

test('reports progress and returns completed work', async () => {
  const progress = jest.fn();
  const op = createCodeArchitectureImportOperation({ onProgress: progress });
  await expect(op.wait('Reading file', async () => 42)).resolves.toBe(42);
  expect(progress).toHaveBeenCalledWith('Reading file');
});
test('cancellation releases a stalled request and rejects late completion', async () => {
  let complete;
  const op = createCodeArchitectureImportOperation();
  const pending = op.wait('Saving', () => new Promise(resolve => { complete = resolve; }));
  await Promise.resolve();
  op.cancel();
  await expect(pending).rejects.toThrow('cancelled');
  complete(42);
  expect(() => op.check()).toThrow('cancelled');
});
test('workspace changes block publication', async () => {
  let current = true;
  const op = createCodeArchitectureImportOperation({ isCurrent: () => current });
  await expect(op.wait('Reading', async () => { current = false; return 42; })).rejects.toThrow('workspace changed');
});
test('storage timeout is visible and aborts late writes', async () => {
  jest.useFakeTimers();
  try {
    const op = createCodeArchitectureImportOperation({ timeoutMs: 50 });
    const result = op.wait('Saving imported analysis', () => new Promise(() => {}));
    const assertion = expect(result).rejects.toThrow('Saving imported analysis timed out');
    jest.advanceTimersByTime(50);
    await assertion;
    expect(op.signal.aborted).toBe(true);
  } finally { jest.useRealTimers(); }
});
