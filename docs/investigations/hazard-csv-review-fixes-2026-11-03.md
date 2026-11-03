# Hazard CSV review fixes — November 3, 2026

Implemented the three confirmed findings from `hazard-csv-regression-review-2026-11-03.md` using the prompt in `docs/codex-prompts/fix-hazard-csv-review-regressions.md`.

## Changes

- Legacy baselines now use the same `createHazardRowNormalizer` as the interactive table, with global row offsets. Missing and blank IDs are generated consistently, existing IDs survive, and matching uses the normalized baseline. Raw source headers and differing original rows remain available for exact Undo; the current-table fingerprint still covers the original source rather than its normalized projection.
- Extracted the existing operational-context policy into a reusable row assigner. The legacy and streaming paths share assignment and preprocessing-conflict semantics. The panel sends current workspace contexts to the worker; Apply checks them against the validated configuration, and the App passes its current context configuration into Apply. Assignment preserves the original scenario/mode basis and flags reassigned assessments for review. Ambiguous contexts remain unassigned. Context assignment and preprocessing share one bounded pass; when no contexts exist, only edited rows are visited.
- Undo validates the authoritative previous snapshot's row count and stable row identities, then restores its original headers and cells verbatim. It bypasses normal CSV merging and classification-status recalculation, restores previous preprocessing, and clears the consumed snapshot after successful atomic publication. Evidence verification, cancellation and compare-and-swap revision protection remain in place.

## Verification

**271 tests passed across 24 suites.** Seven added regression cases cover missing and blank legacy IDs over 205 rows/multiple pages, exact Undo including blank/status/whitespace values, unambiguous and ambiguous context assignment, configuration changes while pending, and hook-to-worker context propagation. Existing suites cover corrupt evidence rejection, cancellation, concurrent writes, evidence/other-sheet preservation, archive round trips, requirements derivation, diagnostics and diagram paint behavior.

Focused ESLint and `git diff --check` passed. A separate production build succeeded at `/private/tmp/xhandle-hazard-csv-regression-fixes-build` with existing repository warnings. The running preview's build was not replaced.

A disposable Electron 45 worker test used synthetic data, 1,000 CSV rows, a derived row cache and two 2 MiB evidence values. It verified confirmation before publication, saved results, operational-context assignment, exact first-row/header restoration on Undo, and cold reopening. No renderer errors or process failures were recorded. Preparation took approximately 0.84 seconds and Apply 1.85 seconds; the full import/Undo sequence took 4.51 seconds. These small-fixture measurements are not a guarantee for customer-scale projects. Renderer heap measurement excludes worker heap; total Electron working set peaked at approximately 741 MiB.

Logs: `/private/tmp/hazard-csv-review-fixes-regressions.log`, `/private/tmp/hazard-csv-review-fixes-lint.log`, `/private/tmp/hazard-csv-review-fixes-build.log`, `/private/tmp/hazard-csv-review-fixes-native.log`. Native artifacts: `/private/tmp/xhandle-csv-runtime-wT8B6L`; synthetic fixture/harness: `/private/tmp/xhandle-csv-fixes-native`.

The customer CSV, live preview, its pending import and installed workspace data were not modified. No commit, push, release publication, build-pin change or desktop update was performed. Customer-scale stress testing and a new packaged release were not part of this verification.
