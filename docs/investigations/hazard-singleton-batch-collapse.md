# Repeated single-row hazard review

Two implementation paths could collapse throughput. Generation globally reduced
rowLimit after a majority of rows failed, including semantic failures, and never
increased it again. Review reduced a shared run policy on small/singleton retry
failures and could lower its character target to 8,000. The five-second heartbeat
also replaced detailed review status with a generic row count. These are confirmed
code paths, not a trace of the user's live request sequence.

The fix isolates corrective splitting from unrelated work. Generation reduces its
normal batch ceiling only on response failure in a non-retry batch of at least four
rows; normal batches have a four-row floor and recover toward 32 after two complete
full-batch responses. Semantic findings alone do not change generation capacity.
Local retries can still split to single rows.

Review policy now has a four-row / 30,000-character floor for ordinary requests,
with 24-row / 60,000-character ceilings. Small retries and partially missing verdicts
do not lower the shared policy. A failed non-retry batch can still reduce capacity;
subsequent successes grow it. Neither floor forces unrelated data into a request or
bypasses the actual input budget. An oversized row, a targeted correction or a
remaining one-row batch can legitimately be processed alone.

Review progress names targeted retry, input-size limit, remaining generated rows
or batch capacity, with the active row/character limits. The heartbeat retains this
message instead of erasing it. Changes affect newly started runs; running JavaScript
requests are not hot-migrated. Existing valid checkpoints remain reusable.

Regression coverage verifies failing singleton review leaves the next 24-row batch
intact, semantic corrections do not shrink later 32-row generation batches, and
input-limited singleton progress states its reason. Bounded retries, shared
concurrency, review-before-checkpoint, recovery and requirement compatibility remain.
