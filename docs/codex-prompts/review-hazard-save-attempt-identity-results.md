# Attempt identity implementation review

## Finding: P2 — cleared analysis can be recreated by late partial recovery

Locations: `hazardSaveAttempt.js:6–11`; `codeArchitectureHazardStore.js`, deleteCodeArchitectureHazardRuns and saveCodeArchitectureHazardRun; `fastHazardRunner.js:243`; `App.js:14631`.

Partial recovery deliberately continues after Stop. If Clear analysis completes while that recovery is still constructing output, its subsequent save can recreate the deleted record. Deletion neither revokes the registered attempt claim nor leaves a tombstone that rejects future writes from that attempt. The save epoch is captured when saveCodeArchitectureHazardRun is called; a write first submitted after deletion observes the current epoch and passes. Registry discard blocks publication through its callback, but cannot prevent the durable write.

Reproduced using the real store with test-local fallback storage: claim an incomplete manifest, save it, delete the scope, verify no latest run, then submit its delayed recovery save. The old ID reappears with 150 validated assessments. No customer database was accessed. This demonstrates persistence resurrection, not just a UI event race. A full mounted-App timing reproduction was not performed.

This is an existing deletion-lifecycle gap that the new ownership check does not close; no new regression in same-record supersession was demonstrated. It matters because the broader fix explicitly preserves background recovery after Stop.

Recommended fix: revoke/tombstone outstanding attempt claims for the deleted scope before asynchronous deletion begins, and check that original attempt authorization before late writes. Do not simply remove the claim, because absent ownership currently permits writes. Preserve legitimate new analyses after clearing and unrelated projects. Test Clear during partial preparation, queued/in-flight writes, reanalysis after Clear, and late save notifications.

## Verified

- Old queued and late writes for a superseded attempt are rejected.
- Old success/failure events cannot replace or release a newer pending attempt with the same outer record ID.
- Current-attempt retries succeed and prior completed sheets are preserved.
- Recovery ownership survives Stop, normal finalization cancellation works, and replaced attempts cannot directly publish.

## Validation

9 suites / 68 tests passed, including the independent audit that asserts the deletion defect. The passing audit is a reproduction, not a clean-review signal. Its source is archived beside this report. Production source unchanged. No live provider calls or customer data changes. Live Safari performance, full mounted-App behavior and cross-tab coordination remain outside this review. No rebuild needed for this read-only review.
