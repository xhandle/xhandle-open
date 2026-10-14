# Hazard completion verification v4 — 2026-10-14

Executed prompt: `codex-prompts/hazard-completion-verification-v4.md`.

## Result

The tested normal recovery paths complete all expected assessment rows, but unconditional completion cannot yet be confirmed. One additional noncanonical saved-data counterexample remains. No production behavior was changed during this review.

## P2 — Saved ratings can pass cleanup but fail local fallback

Affected methods: HARA and FHA.

`hazardCompletionSupport.js:13–16` checks trimmed/stringified rating values but returns the original value unchanged. For example, saved Severity ` S3 ` or Severity Category ` III ` passes cleanup. `assumptionHazardFallback.js:46` copies that original value over its valid default. The strict ASIL/SWCI derivation rejects the surrounding whitespace, and fallback throws at line 61. The pipeline propagates the exception rather than returning completed results for that row.

Reproduction: retain an existing saved rating while editing Verification through `recordUserPreprocessing`, then run generation with persistent provider failure. Both methods perform three provider attempts and subsequently reject with `Cannot reconcile governed values`. No user cancellation, reload or restart occurs.

Scope qualification: fresh CSV cells are trimmed by the current import recorder. The tests seed noncanonical previously saved state; they do not demonstrate that today's CSV importer creates this data or establish that a customer's saved project contains it. Saved-state normalization is still a gap in an unconditional completion contract.

Recommended fix: canonicalize accepted enum/rating values at the cleanup boundary using the same types/representations as downstream validators. Preserve the original input separately when normalization changes representation. Use canonical values consistently in generation constraints, fallback, final reconciliation and rating derivation. Do not weaken the ASIL/SWCI validators or change the rating's meaning. Convert these two counterexamples into successful completion assertions.

## Checks performed

- Active dispatch uses the shared results-first pipeline for all three methods.
- Added missing-output, duplicate-ID, malformed-JSON and structurally invalid-row cases: all expected IDs complete in order for STPA/HARA/FHA and reviewed No stays No.
- Added mixed cached-success/provider-unavailable/checkpoint-write-failure cases: all three methods preserve accepted work and complete the remaining row locally.
- Previous transport, fallback, applicability, checkpoint, final publication/save, CSV and requirements tests remain in the verification suite.
- Reviewed intentional cancellation and error boundaries. Explicit Stop, project deletion/clear and application teardown cancel by design. Preflight rejection remains distinct from failure after generation begins.

Fallback remains a validating operation that can throw. Final assembly at `fastHazardRunner.js:185` is not surrounded by a universal secondary completion mechanism. Arbitrary programming errors are intentionally propagated rather than hidden; finite tests cannot prove no such defects exist. Browser/process termination and resource exhaustion also cannot be guaranteed away in this architecture. This is not evidence that these failures currently occur in a customer's normal run.

## Validation

Added eight tests in `hazardCompletionFinalAudit.test.js`. Six assert successful recovery (including multiple malformed-response variants); two characterize the saved-rating defect. A passing characterization means the defect was reproduced, not fixed. All 470 tests passed across 47 suites covering hazard analysis, shared transport and downstream requirements. `git diff --check` passed. No live browser/provider run was performed.
