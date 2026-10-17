import { architectureDashboardSummary } from './architectureDashboardSummary';

test('recovers published count and metrics when localStorage metadata is missing', () => {
  const metrics = { rowCount: 4981, totalDurationMs: 1234 };
  expect(architectureDashboardSummary({ durable: { metrics } })).toEqual({ rowCount: 4981, metrics });
});
test('durable metadata overrides stale zero count and missing metrics', () => {
  expect(architectureDashboardSummary({ cached: { rowCount: 0 }, durable: { metrics: { rowCount: 4981 } } }).rowCount).toBe(4981);
});
test('owned live edits including an intentional empty table override saved count', () => {
  expect(architectureDashboardSummary({ cached: { rowCount: 4981 }, liveRows: [] }).rowCount).toBe(0);
  expect(architectureDashboardSummary({ cached: { rowCount: 4981 }, liveRows: [{}] }).rowCount).toBe(1);
});
test('legacy cache still works and missing metadata is unknown rather than zero', () => {
  expect(architectureDashboardSummary({ cached: { rowCount: 12 } }).rowCount).toBe(12);
  expect(architectureDashboardSummary({}).rowCount).toBeNull();
});

test('newer saved edits supersede original run counts', () => {
  expect(architectureDashboardSummary({
    cached: { rowCount: 0, updatedAt: '2026-10-17T12:00:00Z' },
    durable: { metrics: { rowCount: 4981, completedAt: '2026-10-17T11:00:00Z' } },
  }).rowCount).toBe(0);
});
