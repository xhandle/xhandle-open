# Review of hazard concurrent-error priority

Prompt executed: `docs/codex-prompts/review-hazard-parallel-error-priority.md`.

## Finding: P1 — a provider error still masks a concurrent programming failure

`hazardDeferredFailures.js:20-24` assigns both provider/configuration failures and programming exceptions priority 2, then keeps the first on a tie. `resultsFirstHazardPipeline.js:157` uses this selection; lines 164-167 convert the selected provider status into assumption-based completion.

Reproduction: start two generation batches over nine reviewed-applicable sources. Reject the first request with status 403, then reject the second with a ReferenceError. The pipeline resolves with results instead of rejecting with the programming error. Reversing their arrival order correctly interrupts. A missing generation dependency must not become an apparently completed assessment run because a sibling request also encountered a provider problem.

The old generation collector used the last error. Thus the provider-first/programming-second case is a regression in the new implementation; the reverse-order vulnerability existed before. Stable first-error selection changes which order fails without eliminating the underlying ambiguity. Provider failures that permit fallback must rank below failures that must interrupt, or fallback eligibility must consider all concurrent failures. Keep cancellation and required-evidence storage protection intact.

Executable regression: `hazardParallelPriorityReview.test.js`. It asserts the desired interruption behavior and deliberately remains failing for provider-first ordering. Production code was not changed during this review.

## Verified behavior

Existing tests exercise required-evidence storage versus budget failures in both arrival orders; storage versus provider failures in screening and generation; cancellation during evidence recovery; original error/cause identity; accepted partial results; checkpoint recovery without more extraction calls; bounded caches/backpressure; and clearing paused status. These protections pass the suite.

## Limits

This is a source and automated-test review, not an overnight Electron workload test. Sources/results still reside in renderer memory and job execution still depends on that renderer. Neither absence of future memory crashes nor survival of a renderer crash has been established. The previous production build passed with warnings; no production source changed in this review, so it was not repeated. No release, application restart, or customer database access occurred.

## Validation

Full hazard suite: 71 suites passed, 1 failed; 632 tests passed, 1 failed (633 total). The sole failure is the new provider-first/programming-second regression above. All previously existing 631 tests pass. `git diff --check` passed.
