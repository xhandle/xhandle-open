# Desktop workspace memory investigation — October 27, 2026

## Conclusion

There are multiple confirmed ways for large saved data to cause avoidable renderer work and memory amplification. The strongest new finding is that hiding a dirty workspace can start whole-store backup reads **even with automatic backup disabled and no backup folder**. There is also no backup single-flight guard. Separately, hazard restoration eagerly reconstructs full runs, and repeated retries can overlap those reads. The installed application still contains the old payload-scanning Storage inventory.

These defects plausibly explain worsening behavior after large imports/analyses and after switching applications. They do not establish which allocation caused each native crash. We did not reproduce a production-size crash or prove a general unbounded heap leak. Large on-disk storage alone is not evidence that all of it is resident in memory.

## Installed version and evidence

- Installed Desktop: **0.2.11**. Packaged build metadata identifies desktop `7b7c1cf853bb380c2e318a7b96ab6a788cea576a`, upstream `4a56e75375785069816d0bbbbcf3f798153ba37e`.
- The installed renderer bundle contains the old `Store scan timed out; totals may be incomplete.` message and does not contain the replacement count-only timeout message. The pending Storage fix is not installed.
- No xHandle process appeared in the process snapshot taken for this investigation. We did not launch the real app or inspect its databases. Therefore there is no direct measurement of the currently affected session's active tasks or JavaScript heap.
- This Mac reports **8 GiB physical RAM**. That reduces headroom when several multi-gigabyte allocations coexist with other applications. It is not proof of the historical crash cause.
- Four renderer crash reports exist for October 27: 15:06:36, 19:30:48, 19:31:41, 19:36:48 EDT. They report `EXC_BREAKPOINT`, signal/exit code 5.
- The retained recovery history records renderer peaks of approximately **3.25, 2.45, and 1.83 GiB** for the three evening renderer PIDs. These are working-set peaks, not JS heap or exact values at the fatal instruction. Latest recovery reason is `crashed`, not an explicit OOM reason. Native symbols are insufficiently precise to attribute the fatal instruction.
- The disposable runtime used Electron 45.0.0 / Chromium 156.0.8078.48. Test fixtures were small and synthetic; all real workspace data remained untouched.

## Confirmed findings, in priority order

### P1: Hidden-window backup bypasses settings and performs expensive work before checking destination

Sources: `src/lib/localBackupService.js:267`, `:311`, `:494`, `:548`, `:561`, `:616`.

The normal scheduled path checks enabled/folder/permission state. However, disabled or unavailable backups still mark the workspace dirty. The `visibilitychange` listener checks only `hidden && dirtySinceLastBackup` and calls `backupNow` directly. `backupNow` builds a workspace snapshot before obtaining the backup directory or verifying permission. `silentIfUnavailable` suppresses the eventual failure but does not avoid the earlier reads.

`exportKnownDb` uses `getAll()` for each configured store, retaining those values in an accumulating snapshot. The configured databases include source indexes, architecture records, recovery, workspace graph, reports and traceability; this is the legacy known-database backup path, not a claim that it covers every modern hazard store. A configured successful backup additionally serializes the combined snapshot using pretty-printed `JSON.stringify`.

`setBusy` updates UI state only; it does not reject or serialize a second invocation. Repeated hide events or later timers can begin additional snapshots while the first is still building. This creates a cross-project pressure path: adding inactive projects can make a backup more expensive even if the selected project does not change.

**Reproduced:** a mock-backed test with auto-backup disabled, no folder, and a dirty workspace observed a `getAll()` call on hiding. A second hide event started another `getAll()` while the first remained unresolved. No user database or actual backup file was involved. The first test attempt was adjusted to account for the existing 250 ms event-suppression window; the corrected test passed.

### P1: Retry and change events can overlap full hazard restorations

Sources: `src/features/code-architecture-hazard-analysis/useHazardRunRestoration.js:14–103`, `codeArchitectureHazardStore.js:95`, `hazardRunChunks.js:100`, `src/App.js:7949`.

Restoration guards publication with sequence/cancelled flags. It does not pass an AbortSignal to its reader or cancel the underlying database transaction. Pressing Retry begins a new effect/read; storage change events can also begin another read. Stale results are discarded after the work, rather than preventing that work.

Chunked persistence limits encoding pages, but `hydrateHazardRun` still reconstructs the entire run into a JavaScript object before returning it. It verifies all pages in a readonly transaction and accumulates them through `createValueAssembler`. There is no cancellation or loading progress in that function. The restoration hook in App is not gated on the Hazard tab being visible, so selecting a code-architecture project can initiate loading its hazard results before the user opens that tab.

**Reproduced:** the hook test starts three unresolved reads from initial load plus two retries, with no abort signal. The isolated Electron experiment also returns three independent full run objects from three simultaneous calls to the real getter. This is demonstrated duplication, not merely a theoretical cache concern.

### P1: Installed Storage inventory still materializes and serializes payloads

See `desktop-storage-crash-investigation-2026-10-27.md`. Opening Storage in installed 0.2.11 runs value cursors and JSON/Blob sizing across configured databases. Record size is unbounded and timers cannot interrupt synchronous serialization. The count/key-only local fix removes this path, but has not been released. It does not fix the backup or restoration paths above.

### P2: Full-run preparation and retained snapshots add to resident memory

Sources: `SavedHazardPanelLoader.js:13–57`, `CodeArchitectureHazardPanel.js:99–108`, `useHazardDraft.js:10–29` in the hazard feature.

Saved-run preparation creates a normalized summary sheet in addition to the hydrated run. The module-level `lastPrepared` retains one completed snapshot and input keys (including the original sheet and architecture rows) after component unmount. This cache is bounded to one entry, so it should not be described as an unbounded cache leak; nevertheless one large retained entry can be costly. Draft preparation sends input through `worker.postMessage`, which can introduce another representation while the worker processes it. Worker cleanup/termination exists.

The UI generators yield between batches, improving responsiveness, but yielding alone does not reduce the total final object graph. Additional maps/filter arrays support table, review, eligibility, and traceability views. No exact byte attribution to these structures was measured.

### P2: Hazard getters and saves leave database connections open

Sources: `codeArchitectureHazardStore.js:85–110`, `:147–169`. These paths open database connections without a corresponding `finally { db.close(); }`. IndexedDB wrappers may eventually be collected, and `blocking()` closes tracked connections for upgrades, so this is not proof that every connection remains forever. Deterministic closure is nevertheless missing and should be corrected alongside cancellation. Pending readonly hydration also delays writers that need overlapping stores.

### Additional scoped risks, not established causes of idle crashes

- Workbook collection (`App.js:4747–4768`, `:5095–5102`) hydrates all project hazard runs before filtering to a repository. This is an export/workbook path, not evidence that idle startup loads all history.
- Version 1/2 streamed archive records can still assemble a complete logical record (`projectArchive.js:350–385`). Modern bounded hazard chunks are preserved on import rather than automatically hydrating them there. Compact file size does not bound the eventual restored object size. No new compact-import corruption or leak was established.
- Saved generations are reclaimed during publication; the run registry retires successful inactive runs. Unsaved failed saves are intentionally retained to prevent data loss. Do not delete these protective records or caches indiscriminately.
- The active hazard pipeline retains source/result/planning maps. This audit did not run paid generation, change request concurrency, or measure a complete large continuation. More concurrency is not an appropriate first response to these local allocation defects.

## Data-flow map

```text
Saved architecture / indexes / recovery / graph (multiple projects)
  -> hidden-window backup
  -> whole-store getAll arrays
  -> combined workspace snapshot
  -> one large JSON string if writing/downloading
  [second backup can overlap this sequence]

Hazard run metadata -> chunk descriptor -> validated pages
  -> whole reconstructed run
  -> App state/ref -> normalized summary + indexes -> table
                      -> one module-level prepared snapshot
  [retry/change event can reconstruct another full run concurrently]

Archive -> streamed validation/decode -> persisted records/chunks
  -> project selection/restoration -> the normal whole-run loading path
```

## Measurements and test coverage

`scripts/diagnostics/audit-hazard-restoration-memory.cjs` bundles the actual current hazard store/chunk implementation, uses a disposable profile and loopback origin, and has a 60-second stop budget. Fixture evidence strings are 512 characters; they do not approximate the customer's full row complexity. No forced GC or heap snapshot was used.

| Stage | Observed JS heap MiB | Timing |
| --- | ---: | ---: |
| Empty fixture page | 0.65 | — |
| Saved 500 rows | 1.82 | 111 ms |
| Restored 500 rows | 2.86 | 11 ms |
| Saved 2,000 rows | 6.94 | 81 ms |
| Restored 2,000 rows | 7.91 | 46 ms |
| Three concurrent 2,000-row restores after adding three inactive fixtures | 21.15 | 111 ms |
| One second after releasing the local concurrent-result array | 21.15 | — |

Observed renderer peak working set: 143,232 KiB (~140 MiB). The last heap number does **not** prove a leak: garbage collection was not forced and other recent allocations remain. Stage-to-stage differences include intervening saves and are not a controlled estimate of the exact cost of concurrent reads. Identity checks do prove distinct reconstructed objects.

Ran **54 passing tests in seven suites**, including the two new audit characterizations, existing restoration publication guards, run registry cleanup, chunk persistence/integrity, and selected archive/import regressions. The audit tests assert the current defective behavior to document the investigation; replace those expectations with prevention checks when implementing corrections. No production source changes were made in this investigation; the earlier pending Storage patch was preserved.

Coverage gaps: no live-app CPU profile, no user data inspected, no production-sized import/continuation, no actual laptop sleep/wake test, no UI navigation retention benchmark, no Safari runtime rerun, no symbolicated fatal allocation diagnosis. The limited fixture was intentionally not scaled to the point of crashing this 8 GiB machine. Full inactive-project scaling and end-to-end import/navigation timing remain follow-up validation, rather than inferred from these results.

## Remediation and safe recovery order

1. **Stop unexpected background backup allocation.** Apply enabled/destination/permission checks before building anything, including visibility handling. Add a single-flight operation with coalesced follow-up requests, and avoid an unconditional hidden-window backup. Disabling the setting alone is not a reliable workaround in this version because the visibility path bypasses it.
2. **Include the pending Storage fix.** Automatic inventory should remain key/count-only, cancellable, and sequential.
3. **Make restoration single-flight and abortable.** Cancel superseded reads, close connections deterministically, report actual hydration progress, and prevent Retry from multiplying work. Carefully preserve the existing snapshot consistency guarantees when changing transaction structure.
4. **Lazy-load hazards.** An updated build should open a lightweight workspace/metadata shell without loading the last large hazard run merely because its project is selected. Explicitly opening results can then use bounded preparation. Do not remove the saved run to make startup work.
5. **Reduce resident duplication.** Release prepared snapshots on scope retirement, use bounded/page-backed views of results, and separate continuation metadata from complete historical result objects. Longer term, stream legacy backups and persist incremental results so total workspace size does not dictate peak renderer memory.

For the existing workspace: keep the current profile intact and avoid repeated Retry/Storage/export attempts in the old app. Prepare and validate a patched build with the same stable origin/profile identity; installing it should not require deleting projects. Before any migration or repair, arrange a consistent filesystem-level backup while the app is fully quit, with the user's approval for quitting/copying. Do not claim an arbitrary live database copy is a valid backup. This investigation did not restart, delete, copy, or rewrite the user's workspace and did not publish an update.

Regression gates for implementation: hidden-window events do nothing when backup is disabled/unavailable; one backup at a time; one restoration per scope; abort/unmount retires work; partial rows/checkpoints survive cancellation/restart; no duplicate continuation work; import/export fidelity and repository isolation; no all-project payload reads for a single-project view; memory peaks remain bounded under repeated navigation and interruption. Validate the packaged Desktop build and browser environments separately before declaring the large-workspace problem resolved.
