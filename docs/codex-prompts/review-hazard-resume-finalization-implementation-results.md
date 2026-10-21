# Hazard resume implementation review

## Finding — P1: cancellation during partial recovery bypasses partial preservation

Locations: `fastHazardRunner.js:179,184,241–252`; consumer `App.js:14599`.

After generation fails with validated partialResults, buildRun receives recoveringCancelledAttempt from the signal's state at entry. If the signal is still active then, pressing Stop during a subsequent task yield throws a new AbortError. That rejection escapes the existing catch body before the partial run is saved, error.recoveryRun is set, or onPartialRunUpdate is called. The original failure and its in-memory partialResults are replaced by the new error. The caller falls back to the prior record instead of the newly recovered partial results.

An independent fault-injection test reproduces this with 150 accepted assessments: signal is aborted after the first recovery batch; only the initial zero-validated manifest is saved, and the thrown error has neither partialResults nor recoveryRun. Existing persisted row checkpoints may still permit continuation; permanent loss is not established. If checkpoint storage was unavailable, this path risks losing the only retained in-memory assessments when the failed attempt unwinds.

Recommended fix: distinguish cancellation of normal completed-result finalization from preservation of partial recovery. Once recovery of validated partialResults starts, retain the original error and partial data through cancellation, finish or otherwise safely retain the recovery artifact, and publish only an incomplete result under the existing scope guard. Add tests for Stop during recovery, including unavailable checkpoint storage, a prior completed run, and project switching. Do not permit a cancelled attempt to publish a completed result.

## Verified fixes

- 27,125 cached assessments report recovered counts and make no provider calls.
- Review packing uses indexed first-seen values; the serialization-count test verifies linear candidate serialization for the tested fixture.
- Indexed preprocessing tests preserve reviewed edits, exclusions, ambiguity and missing-column fallback.
- Batched normal finalization matches synchronous sheet output and global summary row identities in the fixture.
- Stop during normal finalization prevents completed publication.
- Stop already active before partial recovery retains partial-saving behavior.
- Existing runner, preprocessing, save-order/storage and recovery-notice tests pass.

## Remaining performance limits

The cache read/validation and upstream architecture preparation still precede the new recovery report; users can still wait before that report appears. First-batch matcher construction remains synchronous, and 100 rows is a row bound rather than an elapsed-time bound. A very large single evidence value can therefore still occupy a long task. IndexedDB cloning is also outside the batching mechanism. These are limitations requiring real-project profiling, not evidence that the screenshot's original duration persists.

## Validation and scope

12 suites / 98 tests passed, including the independent audit that asserts and reproduces the defect above. Passing tests therefore do not mean this review is clean. The audit source is archived alongside this report. Production code and customer storage were not modified; no live provider requests were made. A new build was unnecessary for this read-only review. Live Safari performance and actual customer checkpoint contents were not inspected.
