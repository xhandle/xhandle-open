# Codex prompt: repair checkpoint timing and recovery

Read the shared STPA/HARA/FHA checkpoint implementation before editing. Fix the confirmed defects: a 1.5-second deadline labels successful slow writes unavailable; a transient read failure disables writes; recovery never clears the UI warning.

Keep generation independent of storage. Observe slow and late writes without overlapping drains or allowing stale completions to erase newer data. Bound checkpoint reads and hashing batches. Retry transient write and database-open failures automatically with finite backoff, preserve buffered work, handle permanent storage errors without endless retries, and honor cancellation and scope ownership. Emit truthful saved/pending/failed status and clear warnings immediately on confirmed recovery. Keep checkpoint status separate from final-result persistence. Preserve existing unsaved-result protection and export access.

Test slow success, transient read/write failures, late completion, latest-value preservation, bounded retries, large reads, connection recovery, cancellation, isolation, and recovered checkpoints followed by final-save failure. Run hazard-analysis and downstream requirements checks. Do not change hazard reasoning, classifications, applicability, or stored data. Do not commit or push.

# Implementation

- Checkpoint writes no longer use a rejecting 1.5-second deadline. After five seconds they report pending and retain ownership of the in-flight operation. A late success clears only the buffered values actually written. Newer values are written afterward.
- Reads use batches of 48 and a five-second wait budget. Read failure does not disable writes. Late database initialization remains usable; failed initialization can be retried via a factory.
- Transient write failures retry after 1, 3, and 10 seconds. Quota, security, unsupported-storage, and cloning errors stop automatic retries while retaining memory results. Flush remains bounded and does not reset exhausted retry budgets.
- InvalidStateError on a closed connection reopens the database once within the existing scoped transaction retry.
- Storage recovery clears the active progress warning immediately. Late checkpoint callbacks cannot replace final-save status.
- Existing final-save recovery, export, and unsaved-run protection remain unchanged. A browser that never settles an operation still cannot guarantee persistence; generation and bounded flush can continue independently.

Tests use controlled promises/fake timers and fake IndexedDB. They are not a live Safari or provider smoke test.
