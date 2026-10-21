# Recovery ownership review

## Finding: P1 — save events can reconcile an older attempt into a newer record

`hazardRunRegistry.js`, reconcileSave, matches only run.id/projectId/repoId. `App.js:7984` uses that result to publish a matching save event. `fastHazardRunner.js` intentionally retains a previous completed run's ID when attaching an incomplete pendingAttempt.

When two attempts use that same prior completed result, their recovery objects share the outer ID but have different pendingAttempt IDs. Direct acceptUpdate correctly rejects the retired record, yet a delayed storage event from it passes reconcileSave and replaces the newer record.run with the older pendingAttempt. If that event reports a saved result for a stopped newer record, it can also release the newer pending-save registry record. The visible prior run ID matches, so the App event handler's ID check does not distinguish the attempts either.

Independent reproduction used real registry functions: retire old background work, start a replacement, accept a newer pending recovery with the same prior completed ID, then deliver an older saved recovery event. Direct acceptUpdate returned false for the old record; reconcileSave accepted the same older payload and replaced attempt-new with attempt-old.

This is an existing weakness in save-event identity matching exposed by the reviewed lifecycle, not evidence that the newly added direct-callback gate itself regressed. The test proves registry/event reconciliation, not real IndexedDB scheduling or deletion of saved rows. Storage writes also need review before claiming full stale-attempt protection: preventing only UI publication would not prevent a late old write from persisting older recovery metadata.

Recommended fix: make recovery save publication and persistence attempt-aware. Check pendingAttempt identity/version in addition to the outer saved-run ID, and prevent superseded recovery writes from replacing newer metadata. Preserve ordering and automatic retries within the same attempt. Test delayed old success/failure notifications against active and stopped newer attempts, successful retry cleanup, deletion, and preservation of prior completed sheets.

## Verified behavior

- Stop is immediate while partial recovery retains separate ownership.
- Failed-save partial recovery remains accepted and retained after the UI owner finishes.
- Direct updates from replaced/deleted attempts are rejected.
- Cancelled completed output is rejected.
- Normal finalization cancellation and incomplete partial-saving tests pass.
- Registry cleanup after recovery and retry-save behavior pass.

## Validation

8 suites / 56 tests passed, including the independent race test that asserts the remaining defect. Passing that reproduction does not mean the review is clean. Audit source archived next to this report. No production code or user storage modified; no live provider calls. Live Safari behavior and a full mounted-App/IndexedDB race were not tested. No new build required for this read-only review.
