# Hazard recovery and repeated review edits: fresh review

Executed `docs/codex-prompts/review-hazard-recovery-repeat-review.md` on the current working tree. No production code was changed during this review.

## Verdict

The two previously identified defects are fixed for the tested paths: interrupted continuation persists validated partial results without conflicting with its own manifest, and sequential Review Center edits match the immediately preceding content while preserving the original audit snapshot. One remaining concurrency defect prevents a clean verdict for repeated review edits.

## Finding

### P2 — Overlapping review edits can leave the hazard table behind Review Center

Locations: `src/App.js:9955`, `src/features/results-review/ResultsReviewProvider.js:158` and `:218`.

The provider persists the new review content, dispatches an event, and returns without waiting for the source-table update. The App handler starts an independent async operation. If a second edit arrives while the first source save is pending, its `previousContent` contains the first edit, but the source Summary still contains the original row. Exact matching rejects the second edit with “The reviewed row no longer exists. Reload the review.” The first save can then finish, leaving the hazard Summary at the first edit while the review record contains the second. This also affects an edit followed by approval with modifications during a slow source save.

Added a deterministic characterization to `pagedRecoveryReview.characterization.test.js`. It extracts the actual App handler, uses the real IndexedDB-backed store, delays the first source save, delivers the second event with the immediate previous content, then releases the first save. It confirms the alert and durable Summary containing only the first edit. This passing characterization asserts the defect, not correct behavior. Provider event sequencing is separately exercised by `reviewPreviousContent.test.js`; the overlap reproduction does not mount the full React application.

This is an unresolved concurrency case in the reviewed path; this review does not establish that the latest patch originally introduced the asynchronous event architecture.

Recommended fix: serialize source updates per run and provide an acknowledgement of source persistence to the review action. Only signal successful completion after the intended source edit is committed; surface failed application explicitly and allow retry. Retain project/run/revision guards and exact row identity checks. Do not fix this by weakening conflict protection or blindly writing by numeric index.

## Verification

- Broad hazard-analysis, project-transfer, Results Review, collaborator, functional-decomposition and diagram suites: 116 suites / 1,116 tests passed; one suite/test skipped. Log: `/tmp/recovery-review-tests.log`.
- Focused suite after adding overlap characterization: seven tests passed, including the new defect reproduction. Log: `/tmp/recovery-review-overlap.log`.
- Production build passed with warnings. Log: `/tmp/recovery-review-build.log`.
- Server project-transfer tests: four passed. Log: `/tmp/recovery-review-server.log`.
- `git diff --check` passed.

Recovery coverage includes explicit Stop, ordinary interruption, delayed manifest completion, failed initial writes and rejection of independent edits. Sequential review coverage includes moved/deleted rows and externally edited rows. No additional confirmed regressions were identified in this scope.

## Limits

These checks do not prove that every freeze, crash or data race is eliminated. The latest changes do not change the first-page loading mechanism; this review did not repeat the earlier synthetic first-page benchmark or time the customer's actual large project in Safari, Chrome or packaged Electron. Explicit continuation and review mutations can still hydrate full records. Customer databases were not modified, no paid analyses were run, and nothing was committed, pushed or released. Review changes are limited to this report, the review prompt and the overlap characterization test.
