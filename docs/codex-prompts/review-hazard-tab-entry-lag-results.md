# Hazard tab entry lag review

Review only. No production code changed.

## Confirmed findings

1. Saved-run preparation is not connected to the xHandle progress indicator. App.js:14648 enables useHazardDraft only when no saved hazard run exists. CodeArchitectureHazardPanel.js:415 renders its icon only for draftLoading. Consequently an already loaded saved run mounts without this indicator, regardless of how long preparation takes. The previous statement that the hazard tab has a loader was incomplete: it covers new draft construction, not all saved-table preparation.

2. Tab activation directly updates workspace state (App.js:17618). There is no separate lightweight first-paint shell for saved-table preparation. Panel render synchronously normalizes the summary and scans applicability (CodeArchitectureHazardPanel.js:98), builds functional trace IDs (:107), computes eligibility (:172), and checks staleness (:176). A progress element inserted later in that same render would not solve main-thread blocking before paint.

3. Saved-row normalization copies every row, even with existing IDs (classificationResolutionStatus.js:53), followed by the not-applicable scan (hazardNotApplicableCells.js:26). The panel memo depends on whole latestRun/draftRun objects, so replacing metadata-only run objects can also repeat it.

4. Table windowing limits mounted rows, but preparation still traverses the entire dataset: row wrappers, grouping (CodeArchitectureHazardSummaryTable.js:330), per-row text height estimates and full offset maps (useHazardRowWindow.js:10). These computations are synchronous. Windowing does not itself make initial preparation asynchronous.

5. Freshness checks can scan/hash the architecture and functional model during panel mount (codeArchitectureHazardUtils.js:1702). Functional readiness/derived-row caches exist for sealed snapshots, so it would be inaccurate to claim every invocation rebuilds them. The architecture snapshot hash still builds/ hashes a compact evidence-bearing representation (:238). Cost on the actual user's snapshot remains unmeasured.

6. Saved-result restoration uses text-only Loading/Refreshing notices (CodeArchitectureHazardPanel.js:213), separate from the draft logo/progress. Thus neither saved storage loading nor saved table CPU preparation consistently has the requested visual feedback.

## Measurement and validation

Archived test: review-hazard-tab-entry-lag-audit.test.jsx.txt.

Synthetic saved STPA sheet: 26,278 rows, 73 columns, 3,754 interface groups. Real panel and table mounted in Jest/jsdom with empty architecture inputs:
- Standalone row normalization: 52 ms.
- Standalone grouping: 58 ms.
- Panel/table mount including effects: 742 ms.
- Mounted tbody rows: 15.
- Progress indicators: zero.

These standalone timings are separate measurements, not additive exclusive portions of the mount timing. Synthetic evidence and jsdom differ from the customer's Safari data/runtime. The test confirms a loader coverage defect and synchronous work; it does not establish the exact source or duration of the reported ten seconds. Four suites / 25 tests passed (panel, table, draft hook, audit). Temporary test removed after archiving.

## Recommended implementation

- Give saved-view entry its own lightweight loading shell that can paint before heavy panel/table work begins, with a single xHandle indicator.
- Chunk or move expensive normalization, grouping and height preparation off the main thread; use actual completed work units for percentage rather than an invented timer.
- Reuse immutable prepared snapshots across tab switches; key them to project/repo/run-summary/architecture revisions and relevant table settings, not unrelated run metadata.
- Reuse validated architecture/functional snapshot identities rather than repeating freshness hashes during render, with correct invalidation.
- Keep existing visible results during same-scope background refresh; cancel obsolete preparation and prevent cross-project publication.
- Report storage loading separately from measurable CPU preparation; do not imply that a storage read has a known percentage.
- Profile the real large project from tab click through first paint to distinguish storage wait, App render, freshness hashing, preparation and browser layout. Test large saved runs, fresh drafts, warm re-entry, cancellation, project switching, filtering, row focus and editing.

No database schema, saved results, generation behavior, or existing code was modified in this review.
