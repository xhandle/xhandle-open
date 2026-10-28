# Review of overlapping hazard review edits — 2026-10-28

Executed `docs/codex-prompts/review-overlapping-hazard-review-fix.md`. Production code was not changed.

## Verdict

The queue and acknowledgement bridge fix the original ordinary overlapping-edit race. Two storage-failure paths remain unsafe. These findings concern interactions with existing storage behavior; they do not imply that all underlying storage failure behavior was newly introduced by this patch.

## P2: Source-save failure can block retry after reopening the run

Locations: `src/App.js:9962`, `src/features/code-architecture-hazard-analysis/codeArchitectureHazardStore.js:198`, `:265`, `:335`.

A non-revision source publication failure retains the proposed run in `unsavedRuns`. Reopening the run through `getCodeArchitectureHazardRunById` returns that unsaved proposal. Review Center correctly retains its preceding content because the source acknowledgement failed. A subsequent review retry therefore compares the preceding review row against the proposed, unsaved source row and fails with “The reviewed row no longer exists.” The durable source remains unchanged.

`reviewSourceFailure.characterization.test.js` reproduces this with the actual provider callback, App handler, acknowledgement bridge and IndexedDB-backed source store. It injects a failure at `publishHazardRun`, reopens through the actual store getter, and verifies the retry rejection and unchanged durable Summary. It does not mount the entire App. The previous failed-save test threw before entering the real store, so it did not exercise retained failed proposals.

Recommended fix: distinguish committed source content/revision from retryable proposed content. Allow an explicit retry of the same pending review operation without treating the proposed row as a new authoritative source. Preserve genuine external-edit and deletion conflicts; do not broadly relax row matching or discard recovery data.

## P2: Review persistence failure still resolves as success after the source commit

Locations: `src/features/results-review/ResultsReviewProvider.js:72`, `:147`, `:164`, `:207`; `src/features/results-review/ResultsReviewDrawer.js:28`.

The source now commits before the review record is persisted. `persist` retains optimistic review content when its writer returns `{ok:false}`, sets a failure state and emits a failure event, but resolves normally. The action then emits its normal success event and resolves; the drawer clears its saving state and approval can advance. The failure state is exposed through context, but no current consumer renders it and no production listener handles the persistence-failed event.

After reload, the old durable review content remains while the source contains the newer edit. The next edit can fail exact previous-content matching. Approval/audit changes may also be missing after reload.

`reviewDurabilityFailure.characterization.test.js` extracts the actual provider `persist` and update callbacks, injects the writer's documented failure result, and exercises the real acknowledgement bridge. It verifies successful action resolution despite divergent durable review/source state and rejection after simulating reload. Its source handler is a controlled exact-match stub, not a full database integration.

Recommended fix: propagate review persistence failure to the action UI and retain explicit retry state for a source-applied/review-not-durable operation. Retrying must persist the outstanding review record without blindly reapplying or rolling back the source. Reconcile interrupted publication after reload, preserving audit evidence and revision checks.

## Scope

No customer data was modified, no paid analysis was run, and nothing was committed or released. The new tests characterize current defects and intentionally pass when those defects occur. Their passing status is not evidence of a clean implementation. Real large-project Chrome/Safari/packaged Electron testing and first-view performance benchmarking were not repeated in this review.

## Validation

- The broad run completed with 115 suites passing, four failing and one skipped; 1,111 tests passed, 16 failed and one skipped. Failures included five-second timeouts and follow-on errors from unfinished work. `/tmp/review-overlap-tests.log`.
- Reran all four affected suites plus both defect reproductions sequentially with a 60-second **test** timeout: six suites / 39 tests passed. No production timeout or implementation was changed. `/tmp/review-overlap-retest.log`. This supports timing sensitivity in the first run, but the broad run was not clean at its default timeout.
- Both defect reproductions passed independently before the broad run. `/tmp/review-overlap-failures.log`.
- Production build passed with warnings. `/tmp/review-overlap-build.log`.
- Server project-transfer checks: four tests passed. `/tmp/review-overlap-server.log`.
- `git diff --check` passed.
