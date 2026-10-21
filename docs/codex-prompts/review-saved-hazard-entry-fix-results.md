# Saved hazard entry review

Verdict: partial fix; two reproduced regressions require correction. No production code changed during this review.

## Findings

### P1 — The loading wrapper removes active-run controls and can repeatedly restart before they return
Location: SavedHazardPanelLoader.js:23, :25, :53, :57; CodeArchitectureHazardPanel.js:331.

The large-run branch does not distinguish a completed saved run from a running analysis. It replaces the entire panel (including Stop analysis) with only a progress component. The mounted-run bypass is set only after preparation completes. If new partial summary snapshots arrive before completion, each changes the preparation job and resets progress. Stop remains absent throughout those resets.

Reproduced with a 602-row active run: Stop is absent until timers finish. Replacing the summary four times before preparation finishes resets progress to zero each time and continues hiding Stop. Rendering the underlying panel directly keeps Stop immediately available.

Fix: keep the toolbar and active-run status mounted independently of table preparation. Preserve the latest displayed snapshot while preparing a newer one; coalesce streaming updates without blocking cancellation or restarting the whole panel lifecycle.

### P2 — Changing operational context remounts the same run and discards table state
Location: SavedHazardPanelLoader.js:23–25, :49–58.

selectedOperationalContextId participates in the entire saved-summary preparation key. The same-run bypass only detects a changed summary reference, so changing context with the same sheet starts preparation and replaces the mounted panel with the loader. The child is then mounted fresh, resetting local table filters/group collapse state and panel state.

Reproduced: load 602 saved rows, collapse all groups, change selected context from all to ctx (all rows have ctx). The table disappears during preparation and returns expanded. The underlying panel without the wrapper preserves collapsed groups during the same change.

Fix: separate reusable normalized-summary preparation from context-sensitive filtering/freshness checks; keep the panel/table mounted for same-run changes, with scoped background work and correct invalidation.

## Confirmed improvements

- The 26,278-row integration test verifies an initial progress indicator before the table appears.
- Large initial row normalization and row-height preparation yield between batches.
- Initial distant navigation, StrictMode navigation, scroll-anchor behavior, identity compatibility, cancellation and prepared-snapshot reuse pass their regression tests.
- A single completed snapshot is cached; project/repo/run/content/freshness inputs participate in its identity.

## Remaining performance limitation

SavedHazardPanelLoader.js:37–43 still performs functional readiness/building, eligibility, and freshness checks as individual synchronous stages. Freshness may hash full architecture evidence (codeArchitectureHazardUtils.js:1715–1718). Mounted table changes also use synchronous height preparation (useHazardRowWindow.js:25–27). The changes allow the initial loading shell to appear and reduce row-work blocking; they do not prove the actual ten-second Safari delay is eliminated. A real-project browser trace remains necessary to attribute any remaining stall. This is a known limitation, not a newly reproduced regression.

## Validation

- Existing hazard/identity suite plus three new defect-reproduction tests: 62 suites / 585 tests passed.
- Separate direct-panel comparison: 1 test passed, confirming both behaviors differ when the new wrapper is bypassed.
- The three defect-reproduction tests assert the observed faulty behavior; their passing status is evidence of the defects, not an acceptance result.
- The previously documented hazardCompletionPublicationAudit.test.js suite was excluded; its three save-count assertions were already shown to fail with the original normalization implementation in the preceding fix turn.
- No new production build was necessary for this read-only review; the preceding fix's build passed with warnings.
- Temporary tests are archived in review-saved-hazard-entry-audit.test.jsx.txt and review-saved-hazard-entry-baseline.test.jsx.txt, then removed from src.
