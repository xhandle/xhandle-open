# Workspace memory implementation review — October 27, 2026

## Verdict

The implementation fixes several confirmed memory multipliers, but it is not ready to be described as resolving all large-workspace crashes or as regression-free. Two actionable findings remain. This review changed only documentation and a characterization test; it did not modify application behavior, install a desktop build, or access the user's live profile.

Review prompt: `docs/codex-prompts/review-workspace-memory-fixes.md`.

## Findings

### P1 — Retry can remain blocked behind an uncancellable pre-hydration read

Locations: `codeArchitectureHazardStore.js:82–85,108–111` and `useHazardRunRestoration.js:81–96`.

The new hook serializes replacement reads behind `readTail`, but only database opening and chunk hydration observe abort events directly. The metadata query and initial root-record `db.get` use implicit transactions and only check cancellation after their promises resolve. If either query is delayed behind another transaction or fails to settle, aborting the old load does not retire it; Retry and even a subsequent project load on the same hook remain queued behind that read. The opener's ten-second timeout no longer applies after the connection has opened.

The added characterization test holds the actual store getter's metadata promise pending, aborts its signal, and confirms the getter remains unsettled and the connection stays open. Only releasing the metadata query allows cancellation to finish. The existing hook test independently confirms retries wait for the original promise. This demonstrates a recovery gap, not proof that it caused the user's specific sleep/wake incident. The noncancellable query predates this patch; tying all replacements to its retirement introduces the dependency across retries/scopes.

Recommendation: own the metadata/root read transactions, wire cancellation to their abort, bound their wait, and wait for actual retirement before retrying. Test cancellation during metadata lookup and root lookup, not just chunk hydration, plus switching projects behind a delayed read. Preserve the chunk snapshot/integrity protections; simply racing promises and starting another untracked read would reintroduce overlap.

### P2 — Key-only Storage listings lose project identity for hazard runs

Location: `storageCategoryItems.js:68`.

Passing `null` instead of record metadata to `describeStorageItem` removes project/repository/title/date information for UUID-keyed hazard runs. The key itself cannot identify the owning project. The UI still offers individual record deletion, but now shows generic labels such as “Hazard analyses — saved item 1,” making it difficult to distinguish records to keep from records to delete. Architecture keys embedding project IDs continue to work, which is why the existing label tests passed.

The added test exercises `readStoragePage` with a UUID run key and known project metadata and confirms the generic label and empty details. This is a regression from the previous value-backed listing.

Recommendation: join against the existing small `runMetadata` store for hazard runs (and use bounded metadata where available for other stores), without reading whole payloads. If ownership cannot be established, make that limitation explicit before selective deletion. Add an end-to-end page-label test for multiple projects and hazard run IDs.

## Verified improvements

- Disabled/unconfigured automatic backups do not read workspace stores on hide. Folder permission is checked before snapshot construction.
- Backup operations share a single in-flight snapshot; conflicting output modes report a conflict.
- Startup no longer parses the complete prior backup to display folder status.
- Chunk hydration cancels and preserves the durable saved run; stale hook publication and overlapping retries are guarded once the underlying read retires.
- Architecture navigation defers hazard restoration; node/edge detail callbacks request it on demand through both diagram paths.
- Prepared hazard data no longer remains in the removed module-global cache after unmount.
- Storage inventory counts records without hydrating payloads; listings use key cursors and have cancellation/timeouts.

## Remaining structural limits (not newly introduced regressions)

- `localBackupService.js:281` still reads entire stores and assembles a whole snapshot; explicit backups and legitimately enabled/configured automatic backups can still exhaust memory on very large workspaces. Gating reduces frequency, not peak memory of a valid backup.
- Hazard hydration still assembles a complete run and the view prepares derived tables. Memory grows with run size. Chunked persistence does not make the final view page-backed.
- Legacy single-record cloning cannot be preempted while native cloning is executing. Long synchronous preparation and actual sleep/wake behavior require production-scale validation.
- Key listings now advance through every hidden `:$part:` record. This avoids cloning values but can still time out across very large chunk ranges; the nominal page size bounds displayed items, not underlying cursor steps. Consider a bounded scan continuation or safe prefix skipping.

## Verification performed

- All 151 existing focused tests passed together across 18 suites. Coverage includes backup gating, restoration, chunk integrity, saved partial results, table preparation, diagram links, selected import regressions, and Storage inventory/deletion.
- Two new characterization tests passed, reproducing the two findings above. They deliberately assert observed defects and are labeled as review evidence, not acceptance tests for correct behavior.
- Re-ran the disposable-profile Electron diagnostic: cancelled a real chunked read and restored all 2,000 synthetic saved rows intact. Peak renderer working set was 152,096 KiB (about 149 MiB). This small synthetic fixture is not evidence that multi-gigabyte production workspaces are safe.
- `git diff --check` passed. Application code is unchanged by this review; the implementation's previously successful production build was not repeated.

No saved user data was changed. Actual Safari execution, a packaged updated Desktop against the user's large workspace, long-running AI analysis, and physical laptop sleep/wake were not exercised. No commit, push, or release was performed.
