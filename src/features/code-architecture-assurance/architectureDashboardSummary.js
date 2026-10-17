// Durable publication metadata survives localStorage quota failures. Never let
// an unloaded workspace's empty array override an existing saved count.
export function architectureDashboardSummary({ cached, durable, liveRows }) {
  const durableTime = Date.parse(durable?.updatedAt || durable?.metrics?.completedAt || '') || 0;
  const cachedTime = Date.parse(cached?.updatedAt || '') || 0;
  const metadata = cached && cachedTime > durableTime ? cached : durable || cached;
  const savedCount = metadata?.rowCount ?? metadata?.metrics?.rowCount ?? cached?.rowCount;
  return {
    rowCount: Array.isArray(liveRows) ? liveRows.length : Number.isFinite(Number(savedCount)) && savedCount != null ? Number(savedCount) : null,
    metrics: metadata?.metrics ?? cached?.metrics ?? null,
  };
}
