import { createGenerationBudget } from './generationBudget';

afterEach(() => jest.useRealTimers());

test('finite work completes beyond 120 requests and 15 minutes without a budget pause', async () => {
  jest.useFakeTimers();
  const budget = createGenerationBudget(undefined, { requestLimit: 120 });
  const provider = jest.fn(async () => ({ groups: [] }));
  try {
    await budget.runFiniteWork(async () => {
      jest.advanceTimersByTime(900001);
      for (let index = 0; index < 145; index++) await budget.request(provider, {});
    });
    expect(provider).toHaveBeenCalledTimes(145); expect(budget.count()).toBe(145);
    expect(budget.signal.aborted).toBe(false); expect(budget.error()).toBeNull();
    await expect(budget.request(provider, {})).resolves.toEqual({ groups: [] });
  } finally { budget.close(); }
});

test('ordinary drafting retains its own request count after finite work completes', async () => {
  const budget = createGenerationBudget(undefined, { requestLimit: 1 });
  const provider = jest.fn(async () => 'ok');
  try {
    await budget.request(provider, {});
    await budget.runFiniteWork(async () => { for (let index = 0; index < 5; index++) await budget.request(provider, {}); });
    await expect(budget.request(provider, {})).rejects.toMatchObject({ code: 'GENERATION_BUDGET' });
    expect(provider).toHaveBeenCalledTimes(6);
  } finally { budget.close(); }
});

test('user cancellation still interrupts a pending finite-work request and prevents continuation', async () => {
  const controller = new AbortController(), budget = createGenerationBudget(controller.signal);
  let finish;
  const after = jest.fn();
  const pending = budget.runFiniteWork(async () => {
    await budget.request(() => new Promise(resolve => { finish = resolve; }), {});
    after();
  });
  await Promise.resolve(); controller.abort();
  try { await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); finish('late response'); await Promise.resolve(); expect(after).not.toHaveBeenCalled(); }
  finally { budget.close(); }
});

test('nested finite work restores the drafting timer only after the outer work finishes', async () => {
  jest.useFakeTimers();
  const budget = createGenerationBudget(undefined, { timeLimit: 100 });
  try {
    await budget.runFiniteWork(async () => {
      await budget.runFiniteWork(async () => { jest.advanceTimersByTime(500); });
      jest.advanceTimersByTime(500); expect(budget.signal.aborted).toBe(false);
    });
    jest.advanceTimersByTime(99); expect(budget.signal.aborted).toBe(false);
    jest.advanceTimersByTime(1); expect(budget.signal.aborted).toBe(true);
  } finally { budget.close(); }
});
