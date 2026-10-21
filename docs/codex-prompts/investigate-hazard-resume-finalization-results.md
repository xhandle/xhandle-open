# Hazard continuation investigation

Read-only investigation; no production code or user data changed.

## Confirmed

1. **Recovered assessments do not update assessment progress.** `resultsFirstHazardPipeline.js:88` restores results, but does not call `report()`. If all assessments are restored, no generation/fallback iteration reports progress. An isolated test with 27,125 valid cached STPA assessments returned every assessment, made zero provider calls, emitted no assessment-completion progress, and reported `newlyAccepted:27125`.
2. **The metric name conflates recovered and new work.** `resultsFirstHazardPipeline.js:167` reports `results.size` as `newlyAccepted`. It runs in `finally`, including error exits. It is not evidence of final persistence or new provider work.
3. **Finalization blocks the main thread until result construction completes.** `fastHazardRunner.js:175–202,229` constructs sheets, reconciles preprocessing, validates rows, constructs narrative review data and normalizes summary rows synchronously. There is no paint yield after setting progress to 96. This can leave the previous preparation label visible despite later work executing. Browser duration not measured.
4. **Conditional quadratic reconciliation.** `codeArchitectureHazardPreprocessing.js:116` scans the entire list of user-owned preprocessing rows for each summary row (`owned.filter`). If all 27,125 rows are owned, exact matching alone entails 735,765,625 predicate visits. Rows with no user preprocessing skip this path. The customer's ownership count is unknown.
5. **Zero validated is an initial recovery manifest, not necessarily current recovered work.** `fastHazardRunner.js:153` initializes it to zero before recovery. This runner does not update that manifest count as cached rows are read; final/partial run publication happens later.

## Saving and limits of diagnosis

On the successful path, checkpoint flush completes before the shown metrics are emitted. The outer runner still must construct and save the final run. `codeArchitectureHazardStore.js:152` serializes writes per record and yields before opening storage. IndexedDB `put` can incur structured-clone cost; the fallback serializes the stored collection. These are possible additional costs, not a demonstrated storage hang in this screenshot. The 1.5-second wait in `waitForHazardSave.js` bounds waiting, does not cancel the writer, and cannot interrupt synchronous work.

The screenshot does not establish which finalization stage dominates, whether storage eventually succeeded, or whether another render/storage operation blocked the event loop. No live Safari profiling or customer database was accessed. Earlier 503 messages establish provider connection failures at that time, not their persistence after restart.

## Next focused fixes

- Publish checkpoint-restoration counts and distinguish recovered/new assessments in metrics.
- Report finalization stages and yield/chunk expensive construction while retaining cancellation and stale-run protection.
- Index preprocessing identities and composite fallback keys, preserving duplicate/ambiguous-match behavior.
- Keep prior results visible and distinguish recovery-manifest status from active attempt status.
- Instrument finalization, storage opening, put/transaction completion and first paint separately. Preserve existing save ordering and distinguish ready-in-memory from durably saved.
- Test cached-only continuation, mixed recovered/new work, edited/ambiguous identities, cancellation, failed/slow saves and project switching. Do not regenerate or delete checkpoints to repair the display.

## Validation

Two Jest suites passed, 10 tests total (resultsFirstHazardPipeline plus temporary investigation). Audit test archived beside this report. Synthetic cache test uses memory-backed reads and does not measure actual IndexedDB/Safari performance. No provider calls made by the audit. No production fix implemented in this investigation.
