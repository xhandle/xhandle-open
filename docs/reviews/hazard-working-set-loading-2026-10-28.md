# Hazard table working-set loading

The existing hazard tab now requests a revision-keyed working set. The panel, table, editing controls, partial-result notice, filtering, sorting, CSV export, traceability and Continue action remain the same. No separate read-only browser or extra mode-switch button was introduced.

## Storage and preservation

Only `architectureRowsSnapshot` and `narrativeReviewInput` are deferred, including within `pendingAttempt`. All sheets, row IDs, traceability maps, preprocessing, contexts, freshness identifiers and partial-result metadata remain in the working set. The original authoritative run and checkpoint storage remain intact. Existing project exports still read authoritative data.

A separate disposable IndexedDB cache contains token pages, read in batches of at most 16. Each page and the ordered manifest are verified. Cache keys include the authoritative storage revision and scope. Publication/read rechecks reject stale sources; save publication also compares the source revision atomically. Sequential local edits already queued from one revision can advance through their own preceding saved revision, but unrelated stale objects cannot overwrite newer data. Cache write failures do not fail authoritative saves. Cache output is limited to 64 MiB per run and old published generations are retired.

The initial legacy conversion verifies all original chunks while discarding deferred field tokens instead of assembling those large values. New saves build the working set proactively. Imports that bypass the application save API are converted on their first opening. A legacy multi-gigabyte conversion can still be slow. Disabling/clearing the cache, cache quota failure, or exceeding its budget means conversion is required again.

Continuation and narrative review acquire full verified inputs automatically. Saving an edited working set restores only deferred fields and preserves the edited fields. The transient working-set marker is never written into the authoritative run. This avoids accidentally saving a partial object as a complete run.

## Boundaries

This is a compact working-set optimization, not database-backed viewport pagination. The existing table receives all result sheets, preserving complete-dataset operations. Full-run hydration is still used for continuation, narrative review and saves of edited working sets; those operations can remain expensive. Replacing that with incremental authoritative row writes and disk-backed queries would require further storage/transfer work. Extremely large result sheets themselves can still exceed the current memory budget. No claim of arbitrary-size or zero-crash support is made.

## Verification

- 115 tests passed across 11 suites for restoration, partial results, analysis generation, CSV, review, source preservation and working-set behavior.
- 53 tests passed across 8 suites for archive round trips, token assembly/export, store behavior and cancellation.
- Two additional tests cover rapid queued edits and a source change between hydration and publication; the focused 4-suite rerun passed 28 tests.
- Production build passed with existing repository warnings.
- Disposable Electron benchmark: 15,000 rows, 32 million execution-data characters, 2,042 authoritative chunks. Full load: 942.5 ms; first legacy conversion: 1,017.8 ms; subsequent working-set loads: 59.8 ms and 57.2 ms, zero authoritative chunk reads. Maximum sampled event-loop gaps: 17.1 / 15.3 / 11.5 / 11 ms. Peak renderer working set across the entire fixture setup and all modes: 350,496 KiB.

These are storage timings for a synthetic fixture, not end-to-end UI timings or the customer's 172,647-chunk project. Validate that actual project's first conversion and subsequent cold app launches separately. Safari, installed Electron and the actual project have not been exercised by this benchmark. No release was published and no user workspace database was modified by the benchmark.
