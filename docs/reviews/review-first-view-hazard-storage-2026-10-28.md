# Review: first-view hazard loading

Prompt executed: `docs/codex-prompts/review-first-view-hazard-storage.md`.

Verdict: useful cold-read optimization, but not a complete fix for the requested first-view and memory guarantees. Do not sign off as regression-free.

## Findings

### P1 — First access still depends on assembling all retained results

`hazardRunChunks.js:123-139` reads every indexed page into one assembler before returning any results. `hazardWorkingSet.js:5-6` omits only architecture snapshots and narrative-review inputs; all tables and other retained fields remain. `SavedHazardPanelLoader.js:33-48` then normalizes every Summary row and computes functional/eligibility/freshness data before showing the panel.

A new characterization test proves that a result-heavy 1,000-row fixture retains and reads **every source page** on a cold view. Bounded batches limit transient input, not the assembled output. A second characterization proves that resolving even a minor displayed-row edit reads original evidence again. The latter is needed for current data preservation but remains a memory risk for very large runs.

This is a remaining requirement gap, not evidence that the indexed path itself corrupted data. Implement disk-backed row access or another genuinely bounded display representation if first-view work must remain independent of total result size. Keep complete-dataset action semantics explicit.

### P2 — Mandatory legacy upgrade has no UI in other hazard-consuming views

`App.js:7952-7963` enables working-set restoration for other code-architecture tabs and diagram hazard-detail requests. `codeArchitectureHazardStore.js:148-150` now refuses a legacy chunked run until it is upgraded. However, `hazardRestoration` is passed to the panel only at `App.js:17923`, inside the hazard-analysis subtab.

Reproduction by code path: restart with an old chunked run, enter Software Requirements, Safety Remediation, or request diagram hazard details before opening the hazard-analysis subtab. Restoration returns `upgrade-required` and publishes no saved run; those views receive null/undefined hazard data and no upgrade action. Diagram hazard links can appear absent. Software requirement derivation has its own full-source resolver, so this does not establish that its saved requirements are lost.

Expose a shared restoration/upgrade notice wherever those results are requested, or route the user explicitly to the upgrade action rather than presenting absent data.

### P2 — Save-recovery regression coverage is broken

The broader hazard/transfer suite reports 10 failures, all in `finalHazardSaveRecovery.test.js`. All 10 tests pass against an isolated archive of committed HEAD. Current detailed output shows `crypto is not defined` from revision generation and mock database objects missing `close()`.

These are reproducible test-harness incompatibilities with the changed implementation; they do **not** demonstrate real-browser save failure. Nevertheless, slow saves, retries, queued revisions, and terminal recovery coverage are no longer green. Update the harness to provide browser crypto and faithful database lifecycle behavior, then rerun the unchanged behavioral assertions before regression sign-off.

### P2 — Benchmark is not the full application first-view acceptance test

`scripts/diagnostics/benchmark-hazard-first-view.cjs:19-22,43-49` uses a two-column synthetic sheet and renders `CodeArchitectureHazardSummaryTable` directly. It does not run `SavedHazardPanelLoader`, App context alignment, or the full project/architecture state. It measures first cells, not verified completion of a filter/edit interaction.

The fresh renderer and actual upgrade worker are valuable tests, but the timings cannot establish the two-second avLocalizationWithOutHDMap target. Add a full-panel/application cold-open test with representative row widths, partial history, and architecture input; measure first usable interaction, long tasks, and peak memory. No customer data was accessed in this review.

## Validation performed

Production build and `git diff --check` passed. Build retains bundle-size/Browserslist warnings.

- Existing targeted selection: **135 passed**, 14 suites.
- Broad hazard + project-transfer suite: **891 passed, 10 failed, 1 skipped** (96 passing suites, one failed, one skipped).
- Two added characterization tests: **2 passed**; document the full-result hydration and full-source edit-resolution behavior, rather than claiming those gaps are fixed.
- Isolated committed-HEAD baseline: save-recovery suite **10 passed**. No working-tree files were replaced to run this comparison.
- Disposable Electron benchmark rerun: 15,000 rows, 2,042 source pages, 91 indexed pages. Cold read **141.2 ms**, first table cells **1,307.8 ms**, 41 rendered rows, maximum event-loop gap **247.7 ms**, peak reported renderer working set **266,496 KiB**. Actual worker upgrade completed before opening a fresh renderer.
- Existing passing tests exercise source integrity, explicit upgrade cancellation/retry, partial-result preservation, stale writes, import/reimport, focus lifecycle, table virtualization, narrative review, and generation preprocessing.

Production behavior was not changed during this review. Added only the review prompt/report and focused characterization tests. No commit, push, release, or installed-data migration.
