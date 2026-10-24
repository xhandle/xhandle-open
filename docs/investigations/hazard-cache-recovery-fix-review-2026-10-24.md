# Review of the hazard cache recovery fixes

## Verdict

The stale paused-message regression is fixed in the exercised scenarios. The prepared-evidence recovery fix works for individual failures, including a real checkpoint timeout followed by late recovery, but remains incomplete under concurrent chunk failures. One high-priority finding blocks calling this fix complete. No additional runtime changes were made during this review.

## P1: an earlier budget error masks a later non-deferrable storage error

Location: `src/features/code-architecture-hazard-analysis/hazardEvidenceChunking.js:145`.

Parallel evidence workers use `failure = failure || error`. This retains the first failure regardless of severity. If a request-budget error arrives first and a sibling later discovers that previously prepared evidence is unavailable, the new `HAZARD_EVIDENCE_STORAGE_UNAVAILABLE` error is discarded. The caller receives `HAZARD_EVIDENCE_BUDGET` with `completionOnly: true`, allowing assumption-based completion through the existing pipeline policy. The non-deferrable guard cannot help because it never receives the storage error.

Reproduced with two evidence chunks and a reduced two-request preparation budget:

1. One chunk succeeds and is checkpointed; the other request fails with an ordinary extraction error. The first preparation rejects with that ordinary error, so a later retry is possible.
2. Completed summary values are evicted; the compact identity ledger remains.
3. On retry, the previously completed chunk's read is delayed and then returns no record. The other chunk hits its already-consumed budget immediately.
4. Both workers settle, but the exposed error is the budget error, not the required storage-recovery error.

The thresholds are reduced to reproduce the same logic deterministically. No provider or personal database is involved. The targeted probe passes by asserting the faulty outcome; passing does not mean the issue is fixed.

Required change: explicitly prioritize cancellation and non-deferrable failures over deferrable/budget errors when collecting concurrent worker failures. Preserve the initiating cause as diagnostic context where useful. Add both completion-order variants and cancellation coverage. Do not reset budgets or restore unbounded caches.

## Fixes confirmed

- Eviction followed by missing, invalid or rejected checkpoint reads produces an actionable storage interruption in the single-failure path.
- With the actual resilient checkpoint wrapper, a timed-out read causes the storage interruption; after late recovery, the original evidence is reused without extra provider requests.
- Cancellation during an evicted-summary read remains AbortError rather than becoming a storage failure.
- Accepted results are preserved and no assumptions are generated for directly propagated storage errors across STPA, HARA and FHA.
- Capacity release now clears the paused message while continuing to report pending writes as unsaved. Existing cancellation, slow-write, ordering and ownership tests pass.

## Validation

- Complete hazard directory: **70 suites / 625 tests passed**, including the first two new audit cases.
- Final targeted audit: **3 tests passed**, including the concurrent-failure defect reproduction with the initial ordinary extraction failure asserted explicitly.
- Native unit suite: **22 tests passed**. Native code was unchanged by these fixes.
- `git diff --check` passed.

Audit tests: `src/features/code-architecture-hazard-analysis/hazardCacheRecoveryAudit.test.js`.
Prompt: `docs/codex-prompts/review-hazard-cache-recovery-fixes.md`.

## Remaining limits

These results do not prove that the original native renderer crash is prevented. Full source/result collections remain in renderer memory, execution remains tied to that renderer, and no combined Desktop package includes the uncommitted shared changes yet. Existing packaged recovery evidence covers the native recovery handler with the prior shared pin, not a sustained large hazard job using this implementation. Paging, independent execution, combined packaged validation and long-run memory measurements remain open.

No additional regression was established in the reviewed paths beyond the concurrent-failure gap. This is a bounded review conclusion, not a guarantee that no other bugs exist. Fix the P1 error-priority gap before approving these changes for release.
