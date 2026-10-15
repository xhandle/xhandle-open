# Final-save lifecycle review

## Conclusion
The previously reported superseded-success and stopped-run pending-state defects are addressed in ordinary calls. One additional observer reentrancy defect remains. No production code changed in this review.

## Remaining finding: synchronous save observer can reverse write order
Severity: medium; confirmed storage API edge case, not an observed current UI path.

`codeArchitectureHazardStore.js` calls `state('saving')` (including the synchronous window event and onSaveState observer) before reading `saveQueues.get(run.id)` and before registering the current work in the queue. If that observer starts a second save for the same ID, the second save registers first. The original invocation then queues behind it. Actual puts occur in revision order 2, then 1: the old result overwrites the new result. Newest-owner notification guards hide the old write, so memory/notifications can disagree with persisted storage.

Temporary reproduction invoked save(version=2) from version=1's onSaveState('saving') callback and observed writes [2,1]. The callbacks currently wired in App/runner do not directly initiate such a synchronous nested save; this is not evidence of customer data loss through the present UI. The public callback/event ordering nevertheless violates the intended serialization invariant.

Recommended fix: reserve/register the current queue slot before invoking any observer or dispatching a synchronous event. Ensure work starts only after registration and callbacks cannot reorder writes. Preserve original failure propagation and no-overlap semantics. Add the reproduction as a permanent regression asserting [1,2].

## Passed checks
- Existing slow-save, bounded retries, permanent errors, revision ordering and Stop success/failure tests.
- Temporary deletion-during-open test: save rejects HAZARD_SAVE_DELETED without put.
- Temporary newer-run isolation test: old completion cannot replace a newer registry run.
- 548 existing tests plus three targeted probes passed (551 total, 54 suites). One probe intentionally asserted the defective ordering to reproduce it, not to approve it.
- git diff --check passed.

Temporary probes removed. No live Safari test performed; no guarantee of correctness under all browser/storage conditions. Genuinely stalled storage remains pending and exportable rather than being falsely marked saved.
