import { createHazardTaskYield } from './hazardTaskYield';

test('long microtask work gives queued input a browser task boundary', async () => {
  jest.useFakeTimers();
  try {
    const cooperate = createHazardTaskYield(undefined, 0), input = jest.fn();
    setTimeout(input, 0);
    let finished = false;
    const work = cooperate().then(() => { finished = true; });
    await Promise.resolve(); expect(finished).toBe(false);
    jest.runOnlyPendingTimers(); await work;
    expect(input).toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

test('cancellation during the task boundary stops further preflight work', async () => {
  jest.useFakeTimers();
  try {
    const controller = new AbortController(), cooperate = createHazardTaskYield(controller.signal, 0);
    const work = cooperate(), rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); jest.runOnlyPendingTimers(); await rejected;
  } finally { jest.useRealTimers(); }
});
