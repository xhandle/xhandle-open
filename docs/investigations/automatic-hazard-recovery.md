# Automatic hazard recovery

Executed `docs/codex-prompts/automatic-hazard-recovery.md`.

The active results-first pipeline previously propagated transient transport failures immediately, handing partial work to the runner's manual Continue/Retry recovery. Structural failures already had three bounded attempts; rate limits already had five transport attempts honoring Retry-After.

`hazardAutomaticRecovery.js` now wraps applicability and generation requests within the current run. It retries recognized network failures, timeouts and HTTP 408/500/502/503/504/529 after 2, 5 and 10 seconds. Each request gets at most three additional attempts, with six additional attempts total across the run. Completed rows are not regenerated, and in-memory results survive without relying on working IndexedDB. AbortError and an aborted user signal are not retried; Stop interrupts backoff immediately. Permanent errors and exhausted 429 transport retries remain actionable rather than gaining another retry multiplier. Structural retry limits are unchanged.

Progress reports the affected stage/row count, delay and attempt count without increasing completion percentage. Diagnostics report automatic retries, and metrics count actual request invocations. After exhaustion, the existing runner receives partial work and retains its Continue/Retry path. Storage recovery remains separate; reasoning, batch sizing, ratings, governed decisions and requirement derivation are unchanged.

Validation: 312 tests in 34 suites passed (hazard-analysis directory and provider transport tests). Added transient success, persistent failure, aggregate budget, HTTP classification, permanent errors, cancellation during backoff, all three active generation methods retaining completed batches without storage, and applicability recovery/exclusion tests. `git diff --check` passed. No live provider or browser run performed.
