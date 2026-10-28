# Hazard tab reentry memory fix — October 28, 2026

Executed `docs/codex-prompts/fix-tab-switch-memory-pressure.md`.

## Implemented

- Saved hazard publications now assign a fresh installation-local storage revision in the metadata transaction. Restoration checks this small index and reuses the currently loaded object only when its identity and tracked revision match. The revision association uses weak keys, not a retained map of projects.
- Legacy metadata gets a revision without reading its payload. If storage is full and cannot save that token, the analysis remains readable, with reuse disabled for that record.
- Saves with unchanged timestamps still invalidate reuse. Deleted results and other scopes cannot reuse the old object. Import assigns new revisions for inserted metadata and excludes the installation-local token from both archive conflict comparisons; all other fields remain checked. Idempotent imports and genuine content conflicts are covered by tests.
- Reentry and focus/visibility restoration revalidate metadata, including changes committed in another window. Existing active-generation, newer-edit, stale-publication, cancellation, and retirement guards remain in place.
- The App owns one current-project preparation cache, cleared on project/repository scope change. It accepts at most an estimated 8 MiB of additional prepared rows/trace IDs and rejects oversized or object-valued cells. Cache keys cover the existing freshness/context inputs. Without a supplied cache, unmount still releases preparation. This is a conservative estimate, not a browser heap reservation or hard heap limit.

## Validation

- **181 tests passed across 23 suites** in the final combined run. Coverage includes 100 unchanged reuse calls without payload reads, same-timestamp saves, deletion, different scopes, legacy metadata, quota fallback, preparation reuse/invalidation/budget, focus refresh, cancellation, partial-result preservation, diagram links, Storage cleanup, and import roundtrips/conflicts.
- The disposable Electron diagnostic in `scripts/diagnostics/stress-hazard-tab-reentry.cjs` completed **100 reentries on 14,483 synthetic rows**. It performed 101 metadata checks and **zero additional root payload reads after initial loading**. Loaded and prepared object identities stayed stable.
- Diagnostic heap: 25.71 MiB loaded/prepared; 29.01 MiB sampled peak; 9.42 MiB after idle; 8.40 MiB after explicit diagnostic garbage collection. Peak renderer working set: 156,016 KiB (about 152 MiB). No monotonic retained-heap growth was observed in this fixture.
- `git diff --check` passed. The final normal production build (`CI=false npm run build`) succeeded with warnings. Existing repository lint/Browserslist warnings remain; this does not establish a warning-free strict CI build.

## Practical limits

The stress harness uses the real React restoration hook, actual IndexedDB, actual preparation component and scheduling, but replaces the final table renderer with a no-op. It isolates the confirmed duplicate-read/preparation problem; it does not exercise the full architecture diagram, Handsontable, every application tab, or the user's exact workspace. It is an Electron/Chromium diagnostic, not a separate standalone Chrome or Safari runtime test.

Chrome error 5 remains an unconfirmed crash diagnosis. Large views above the preparation-cache budget still prepare again, and whole-run loading, native cloning, legacy full backups, and other table/diagram allocations remain possible memory-pressure sources. Validate the actual workspace's tab-switching workload before declaring the reported crash resolved.

No live user profile was accessed. No saved user data was cleared, no update was installed, and no commit/push/release was performed.
