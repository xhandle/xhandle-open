# Review of durable hazard review saves — 2026-10-28

Prompt: `docs/codex-prompts/review-review-save-failure-recovery.md`.

## Finding

**P2 — Pending-save publication resets the selected review and hides its recovery action.**

`ResultsReviewDrawer.js:43–52` resets `activeIndex` whenever `queue` changes. The durable-save implementation publishes a new items array when it prepares the pending operation, before source publication finishes. With a multi-item queue, navigate from the initial item to another item and save an edit: preparation returns the drawer to its initial selection. If source publication fails, the pending operation remains on the edited item, but the visible item has no “Retry review save” button. The error is therefore shown alongside a different row. Approval advancement also operates on the reset index rather than the original selection.

The reset effect predates this change; the new intermediate pending-state publication exposes it during the save/recovery workflow. This is a UI/recovery-access defect, not evidence of lost durable data. Preserve selection by item ID on content updates, initialize selection only when opening or intentionally changing scope, and advance from the successfully saved item.

Reproduction: `src/features/results-review/reviewPendingNavigation.characterization.test.js` mounts the real drawer, selects item 2, publishes the pending-state update, and checks the current undesirable behavior (selection returns to item 1 and retry disappears). This is a characterization test, not an assertion that the defect is fixed.

## Fixes verified

Existing integration regressions exercise actual provider callbacks, App source handlers and IndexedDB-backed storage with injected failures. They pass for source-write failure and reopening, source success followed by review-finalization failure, receipt-based retry without duplicate source publication, approval history finalized once, failed preparation before source writes, and conflicting source changes remaining protected.

No additional data-loss regression was confirmed in the inspected paths. This is not a guarantee that all regressions are absent.

## Validation and limits

- Broad targeted suite: 119 suites / 1,132 tests passed; one suite/test skipped. Log: `/tmp/review-durable-review-tests.log`.
- Test timeout was 60 seconds; production deadlines were not changed.
- New mounted-drawer characterization: 1 test passed, confirming the remaining defect. Log: `/tmp/review-pending-navigation.log`.
- Production build passed with warnings, including bundle size. Log: `/tmp/review-durable-review-build.log`.
- Server project-transfer checks: 4 tests passed. Log: `/tmp/review-durable-review-server.log`.
- `git diff --check` passed.
- No live customer databases, paid AI runs, packaged Desktop, or actual Safari sessions were exercised. Large-project first-view latency and peak memory therefore remain runtime validation items.
- Production implementation was not changed. Nothing was committed, pushed or released.
