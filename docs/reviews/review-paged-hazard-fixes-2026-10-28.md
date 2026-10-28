# Follow-up review of paged hazard fixes — 2026-10-28

## Verdict

**Not ready to release.** The earlier build, empty-Summary upgrade, direct-descriptor save, trace-routing, deferred detail and option-size findings have targeted fixes and passing tests. The cold saved-panel benchmark remains fast. However, this follow-up found two high-priority action-path regressions and one partial-result presentation regression. Passing the existing suite did not detect them.

Executed the prompt in `docs/codex-prompts/review-paged-hazard-fixes.md`. Production code was not changed during this review. No customer database, live analysis, paid API call, commit or release was involved.

## Confirmed findings

### 1. P1 — Resolved edits lose their source revision and can overwrite newer edits

Location: `src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js:206` and the save path around line 274.

The paged resolver checks revision before/after hydration but returns the full object without retaining a source revision. Save derives its expected revision only from the WORKING_SET/PAGED markers. App now intentionally resolves before applying CSV/narrative edits, so these saves lose optimistic concurrency protection. Two clients (or independent asynchronous actions) can resolve the same revision, save different edits, and silently overwrite one another.

Reproduction: save a fixture, resolve its descriptor twice, save `reviewStatus: reviewed` from the first snapshot, then save a renamed repository from the second. Both saves succeed; the final record has the rename but loses the review status. This uses the real IndexedDB-backed resolver/save methods.

Required fix: carry the source revision through resolved edit snapshots and enforce it at atomic publication. Avoid relying on a marker that gets removed during resolution or a WeakMap association lost by object spreads. Add concurrent-edit tests for the actual CSV/narrative handlers as well as the store.

### 2. P1 — Governed review and undo still consume descriptors as complete runs

Locations: `src/App.js:11597` (`getHazardVibeReviewState`), `src/App.js:11695` (apply), `src/App.js:11841` (undo), and the results-review focus handler around line 9949.

The active-run branch selects `codeArchitectureHazardRunRef.current` by ID and immediately reads `generatedSheets.Summary`. For a paged descriptor that field is deliberately absent. The state provider consequently exposes no Summary; applying a governed decision tells the user to generate a Summary even though saved results exist. Undo also fails. The focus handler's optional row update returns early when the same field is absent.

Reproductions invoke the actual App apply/undo callback bodies, extracted from the source AST, with a valid saved paged run in their closure. Apply rejects with “Generate the Code-Based Architecture hazard-analysis Summary before applying review decisions.” Undo rejects as well. Original saved rows remain intact. These tests do not mount unrelated App services or simulate the entire browser UI.

Required fix: make the review state provider and all apply/undo/focus paths descriptor-aware. Resolve the required data explicitly with cancellation and revision protection, or implement row-level reads/updates. Preserve stable row IDs and reject stale decisions without falsely reporting absent results.

### 3. P2 — Partial-result rows inherit published-row review state

Locations: `src/features/code-architecture-hazard-analysis/PagedHazardPanel.js:103`, `CodeArchitectureHazardPanel.js:457`, and `CodeArchitectureHazardSummaryTable.js:426`.

Switching to the incomplete attempt changes the displayed rows but forwards the same published `reviewByRow` map. Both tables use zero-based row positions, so an unrelated partial row can receive the published row's rejected styling. This occurs even while review-status columns are disabled: rejected styling is calculated independently of that flag. Partial inspection also retains published undo metadata despite disabling the CSV import callback.

Reproduction: render the paged panel with published row zero rejected, switch to a different partial row zero, then render the real table with the props the prepared panel forwards. The unrelated partial row receives the rejection background. This is a display/identity defect; this test does not demonstrate a persisted partial-result mutation.

Required fix: separate published and partial review identities and controls. Either supply an attempt-specific review map or make partial inspection genuinely read-only without published review annotations/undo actions. Also test published row-review mapping after deletion shifts positions; App currently falls back to stored positions when the descriptor has no Summary.

## Validation

- Broad hazard-analysis, project-transfer and diagram run: **103 suites passed, 960 tests passed; one suite/test skipped**. `/tmp/paged-review2-tests.log`.
- Four new defect reproductions passed: three in `pagedFollowupReview.characterization.test.js`, one in `pagedPartialReview.characterization.test.jsx`. Passing these characterizations confirms the current defects; it is not a clean bill of health. `/tmp/paged-review2-repro.log`, `/tmp/paged-review2-partial.log`.
- Server transfer tests: **4 passed**. `/tmp/paged-review2-server.log`.
- Production build: **passed with warnings**. `/tmp/paged-review2-build.log`.
- `git diff --check`: passed.

## Performance recheck

Reran `scripts/diagnostics/benchmark-paged-hazard-panel.cjs` with its disposable Electron profile and real saved panel/row worker:

- 15,000 twelve-column result rows; approximately 32 million evidence/review characters.
- Descriptor read: **22.4 ms**.
- First usable table: **206.2 ms**.
- Next page: **118.8 ms**.
- 101 rendered rows, including a group row.
- Maximum measured event-loop interval: **75.3 ms**.
- Observed peak renderer working set: **203,344 KiB**, about 199 MiB.

Log: `/tmp/paged-review2-benchmark.log`.

These numbers verify the synthetic saved-panel path after index preparation. They do not measure the complete App with the customer's architecture model, a first-time legacy index upgrade, Safari, a packaged release, or analysis continuation. Full-record action paths remain outside the bounded first-page memory guarantee. Real-project stress testing is still required after the confirmed regressions are corrected.
