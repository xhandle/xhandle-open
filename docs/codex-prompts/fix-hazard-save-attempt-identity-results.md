# Attempt-aware recovery persistence

Recovery attempts now claim session-local ownership of their saved record before the initial manifest write. Store writes check that ownership before enqueueing, after queue waits/storage opening, and at existing retry/completion boundaries. Superseded writes reject with HAZARD_SAVE_SUPERSEDED and cannot emit save-state updates or replace the current unsaved cache. Existing serialized ordering remains in place for transactions already dispatched.

Registry save-event reconciliation now requires matching pendingAttempt identity (or outer ID for a standalone run), in addition to project/repository/record identity. Old success or failure events cannot replace or release a newer pending recovery record. Current-attempt retries still reconcile and release ownership after successful saving.

No database schema or persisted payload fields changed. Ownership is session-local because a reload terminates the old workers. This does not introduce cross-tab coordination.

Validation: primary 5 suites / 51 tests passed. Additional final-save recovery, save-wait and abortable-task tests passed; final total reported to the user. New tests cover queued old writes superseded before storage opens, rejection of late old writes without save-state events, preserved prior completed sheets, current-attempt retries, and stale notifications against stopped newer pending attempts. Diff whitespace checks passed. Production-build status reported in the final response.

Tests use synthetic data and mocked/browser-test storage. No customer data or live providers accessed. Not committed or pushed.
