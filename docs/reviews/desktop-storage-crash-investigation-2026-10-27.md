# Desktop Storage crash investigation — 2026-10-27

## Outcome

The Storage inventory has an unbounded per-record allocation path in the renderer. Opening the tab can read and stringify entire saved analysis records across multiple databases merely to estimate storage sizes. This is a strong candidate for the reported crash, especially with large saved hazard runs. The native crash's precise cause remains unproven: no production crash was deliberately reproduced, and the reports do not explicitly identify out-of-memory termination.

Investigation baseline: shared commit `4a56e75`; installed app and recovery report both identify Desktop `0.2.11`. No production code or user data was changed. The isolated runtime used Electron 45.0.0 / Chromium 156.0.8078.48.

## Local evidence

Read only the Electron recovery diagnostic and macOS diagnostic reports, not workspace database records. The recovery diagnostic changed during investigation as further crashes were recorded; the latest captured timestamp was `2026-10-27T23:36:49.615Z` (19:36 EDT).

| macOS report time (EDT) | Renderer PID | Peak working set recorded, KiB | Approx. GiB |
| --- | --- | --- | --- |
| 19:30:48 | 72890 | 3,412,640 | 3.25 |
| 19:31:41 | 73023 | 2,569,856 | 2.45 |
| 19:36:48 | 73282 | 1,917,568 | 1.83 |

All three macOS reports show `EXC_BREAKPOINT / SIGTRAP`, signal code 5. The latest Electron recovery record reports `reason: crashed`, `exitCode: 5`. These demonstrate renderer termination, not a network delay or simply a slow UI. Working-set peaks are process metrics, not JavaScript heap measurements or exact memory at the fatal instruction. The 15-second samples cannot locate the allocation that failed. Poor native symbolication is insufficient to attribute this to DNS or a particular V8 function.

The recovery dialog is emitted by `electron/renderer-recovery.cjs` in the private desktop repository. Its generic interrupted-analysis wording does not prove that an analysis was active during each crash.

## Findings

### High: opening Storage sizes complete records on the UI thread

`src/components/SettingsModal.jsx:185` uses `JSON.stringify(value)` followed by `new Blob([text]).size`. `src/components/inspectStorageStore.js:29` accesses `cursor.value` and invokes that sizing callback for every record. There is no bound on the size of one value or its serialized representation. Structured-clone materialization, the source object, JSON text, and encoded Blob can contribute temporary memory pressure.

`SettingsModal.jsx:668` scans the 15 configured databases through `Promise.all`. JavaScript callbacks still execute serially on the renderer thread, but multiple database scans can be outstanding. There is no global allocation/concurrency budget. Chunked stores do not eliminate the risk for legacy whole-record values, large individual chunks, or representations that expand during JSON conversion.

The count and byte estimate also cover raw internal records, rather than exclusively logical project records. JSON byte lengths are not actual IndexedDB disk usage.

### High: five-second timeout cannot bound a synchronous record allocation

`inspectStorageStore` sets a timer and aborts its transaction on timeout. However, the timer cannot run while a cursor callback is synchronously materializing/stringifying a large value. It therefore does not protect against a single large allocation or fatal renderer termination.

The tab effect (`SettingsModal.jsx:721`) has no cancellation cleanup. Leaving the tab does not abort an in-progress inventory, and re-entering can launch another scan. A disabled Refresh button does not address tab exit/re-entry. Overlap is a source-inspection finding; a live multi-tab UI stress test was not performed.

### Medium: sizing failures silently produce misleading totals

`inspectStorageStore.js:33` catches and discards sizing exceptions, still increments the count, and can finish with `error: ''`. A `RangeError: Invalid string length` yields zero bytes for that record without an incomplete-total warning. Native crashes cannot be caught by this JavaScript catch.

### High for large legacy records: expanding a storage category still reads full values

`src/components/storageCategoryItems.js:40–48` uses `openCursor()` and accesses `cursor.value` to construct each label. It skips internal chunk keys and does not reconstruct chunked analysis payloads, but a legacy whole-record value is still read in full. The 50-item page limit is not a byte bound. Reading sibling metadata afterward does not undo the initial large read.

## Executed checks

Created and ran `scripts/diagnostics/investigate-storage-scan.cjs` with the desktop repository's Electron binary, using a new temporary profile and loopback fixture origin. The fixture profile was removed afterward. It never used the installed application's profile or user data.

```sh
env -u ELECTRON_RUN_AS_NODE ../xhandle-desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/diagnostics/investigate-storage-scan.cjs
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/components/inspectStorageStore.test.js src/components/storageCategoryItems.test.js src/lib/storageScanTimeout.test.js
```

Results:

- Actual IndexedDB fixture: one 8 MiB text payload was fully visited by the production scanner, reported as 8,388,619 JSON bytes; scan took approximately 31 ms. This modest fixture completed without a crash.
- Synthetic sparse array: one populated entry at index 999,999 serialized to **5,000,000 bytes**.
- Synthetic 1 MiB `Uint8Array`: serialized to **11,471,803 bytes**.
- Synthetic 1 MiB Blob: reported as **2 bytes**, demonstrating that this estimator can undercount as well as overallocate.
- Injected sizing `RangeError`: result was `{count: 1, bytes: 0, error: ''}`.
- Controlled 100 ms synchronous callback with a 10 ms timeout: the timeout had not settled when the callback returned. It only reported timeout afterward. This exercises event-loop behavior without a multi-gigabyte allocation.
- Existing unit tests: **3 suites, 10 tests passed**. Those tests cover cursor lifecycle, paging, and timer settlement; their success does not demonstrate bounded memory or exclude this crash.

## Recommended correction order

1. Remove payload serialization from automatic inventory. Use `navigator.storage.estimate()` for origin-level usage and key/count operations for categories. Display category size as unknown unless trusted byte metadata exists; do not imply an exact per-store disk size.
2. Make category pages metadata/key-only. Use existing small metadata records where available and safe generic labels otherwise. Do not load a large analysis just to find its title.
3. Add cancellation on tab exit/unmount, stop outstanding transactions, reject stale scan publications, and prevent overlapping inventories. Limit outstanding database work.
4. Where exact logical byte totals are required, maintain them incrementally when writing bounded records. Avoid a whole-workspace serialization pass or an eager migration of legacy payloads on opening Settings.
5. Add regression fixtures for large legacy values, sparse and binary data, cancellation/re-entry, and preservation of all saved results. Validate packaged Desktop as well as browser Settings. Keep the current read-only inventory and selective-deletion behavior separate.

Do not increase heap limits as the first correction. The Storage tab should not need analysis-sized allocations. Capture renderer fatal logs or a properly symbolicated crash if a precise native cause is needed. No assertion is made that these changes would eliminate every possible renderer crash.
