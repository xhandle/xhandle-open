import { createGenerationBudget } from './generationBudget';
import { reviewHazardEquivalence } from './hazardEquivalenceReview';
import { hazardResponseError } from './hazardEquivalenceResponse';

afterEach(() => jest.useRealTimers());

test('7614 real descriptions from 26278 assessments finish beyond 120 requests and 15 minutes', async () => {
  jest.useFakeTimers();
  const objects = Array.from({ length: 26278 }, (_, index) => ({ id: `assessment-${index}`, hazardTrackingRow: true, attributes: { Hazard: `Brake command unavailable at actuator ${index % 7614}`, Function: 'Brake controller', Loss: 'Collision' }, sourceIds: [`source-${index}`] }));
  let saved;
  // Reproduce the user's previously saved one-description fallback checkpoint.
  await expect(reviewHazardEquivalence({ objects, checkpoint: async state => { saved = state; }, request: async ({ newIds }) => {
    if (newIds.length > 1) throw hazardResponseError();
    throw new Error('Synthetic interruption after fallback');
  } })).rejects.toThrow('Synthetic interruption after fallback');
  expect(saved).toMatchObject({ comparisonSize: 1, next: 1 });
  const budget = createGenerationBudget(), provider = jest.fn(async () => {
    if (provider.mock.calls.length === 1) jest.advanceTimersByTime(900001);
    return { groups: [] };
  });
  let final;
  try {
    const result = await budget.runFiniteWork(() => reviewHazardEquivalence({ objects, saved, signal: budget.signal,
      request: args => budget.request(provider, args), checkpoint: async state => { final = state; },
    }));
    expect(provider.mock.calls.length).toBeGreaterThan(120);
    expect(provider.mock.calls.some(([args]) => args.newIds.length === 64)).toBe(true);
    expect(budget.signal.aborted).toBe(false); expect(budget.error()).toBeNull();
    expect(result.state).toMatchObject({ complete: true, next: 7614 }); expect(final.next).toBe(7614);
    expect(result.objects).toHaveLength(26278);
    expect(result.objects[26277]).toBe(objects[26277]);
  } finally { budget.close(); }
}, 30000);
