import { createReviewPersistenceWriter } from './reviewPersistenceWriter';
const ok = { ok: true, durability: 'indexeddb' };
test('coalesces pending snapshots while retaining all applied edits and waiting callers', async () => {
  let finish;
  const save = jest.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(ok);
  const write = createReviewPersistenceWriter(save);
  const first = [{ id: 'a' }];
  const second = [...first, { id: 'b' }];
  const third = [...second, { id: 'c' }];
  const a = write(first);
  await Promise.resolve();
  const b = write(second);
  const c = write(third);
  finish(ok);
  await Promise.all([a, b, c]);
  expect(save.mock.calls).toEqual([[first, null], [third, first]]);
});
test('failed writes invalidate baseline and subsequent saves retry all current data', async () => {
  const save = jest.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(ok);
  const write = createReviewPersistenceWriter(save);
  const first = [{ id: 'a' }];
  await write(first);
  const next = [...first, { id: 'b' }];
  await write(next);
  await write(next);
  expect(save.mock.calls[2]).toEqual([next, null]);
});
test('a rejected save does not strand newer requests', async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error('closed')).mockResolvedValueOnce(ok);
  const write = createReviewPersistenceWriter(save);
  await expect(write([])).rejects.toThrow('closed');
  await expect(write([{ id: 'a' }])).resolves.toEqual(ok);
});
