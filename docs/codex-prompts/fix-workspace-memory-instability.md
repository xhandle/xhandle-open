# Resolve confirmed workspace memory-pressure defects

Implement the confirmed findings in desktop-workspace-memory-investigation-2026-10-27.md. Preserve all saved runs, partial results, identity, and transaction integrity. Keep existing pending Storage fixes.

Gate every automatic backup trigger before any snapshot read, verify the destination first, allow only one backup at a time, and coalesce changes without losing dirty state. Make hazard restoration abortable, retire superseded reads before retrying, close database connections deterministically, and provide hydration progress. Defer hazard restoration until a relevant view needs it while preserving active generation and downstream safety/requirements behavior. Remove unnecessary module-global retention of prepared hazard views.

Convert investigation characterizations into prevention regressions. Verify backup-disabled/no-folder/hidden behavior, overlapping triggers, retry and unmount cancellation, stale publication, partial-save integrity, tab/view gating, and chunk consistency. Run focused suites, isolated Electron checks, and a production build. Do not touch the live user profile, clear databases, commit, push, or release. Document remaining large-data limitations honestly; do not claim all renderer crashes are eliminated.
