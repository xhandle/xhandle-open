# Review of programming-error priority fix

Executed prompt: `docs/codex-prompts/review-hazard-programming-error-priority.md`.

## Result

No new actionable bug or regression was identified in the reviewed error-selection/fallback paths. The previously reproduced provider-first/programming-second defect is fixed. This conclusion is limited to code inspection and the automated scenarios below, not a guarantee of absence of all defects.

## Evidence

- The shared selector distinguishes provider errors eligible for assumption completion from programming errors that must interrupt. The final pipeline fallback uses the same eligibility rule. The previous tie between these classes is eliminated.
- The existing 36 pipeline cases cover STPA/HARA/FHA, screening/generation, ReferenceError/RangeError/non-network TypeError, and both arrival orders. They verify that the original error is preserved as the interruption cause, accepted partial results survive, and assumptions are not published.
- Existing tests cover fatal exceptions carrying provider-status metadata, direct/nested/message status encodings, missing prepared evidence versus concurrent budget/provider failures, checkpoint read recovery, cancellation, cache limits, and producer backpressure.
- Added `hazardProgrammingPriorityAudit.test.js`: exhaustive arrival permutations of representative priority classes; real pipeline provider fallback for all five supported statuses across all three methods; and cancellation after a concurrent provider failure during screening and generation, preserving accepted partial work.
- Reviewed interactions with automatic recovery, request scheduling, and the application-owned error wrapper. Network-TypeError classification, ordinary provider fallback statuses, request budgets, and persisted checkpoint formats are unchanged by the latest fix.

## Validation and scope

Full hazard suite: 73 suites passed, 694 tests passed. The new focused audit passed all 18 tests. Logs: `/tmp/xhandle-programming-review-suite.log` and `/tmp/xhandle-programming-review-focused.log`. `git diff --check` passed. The previous production build passed with warnings; production code was unchanged in this review, so the build was not repeated. Only the review prompt, report, and new tests were added. No publish, application restart, or customer-data access occurred.

## Remaining limitations

Large-analysis crash prevention is not established. Source/result residency still grows with workload, and analysis execution remains tied to the renderer. This review did not reproduce the native crash, run an overnight packaged Desktop workload, or verify a combined desktop release. A representative large-project desktop run, including time in the background and Continue after interruption, remains necessary before claiming the original reliability problem is resolved.
