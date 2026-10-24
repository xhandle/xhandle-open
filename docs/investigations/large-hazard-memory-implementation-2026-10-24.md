# Large hazard analysis memory controls

## Implemented scope

This is the first reliability stage, not the complete architecture for arbitrary-size analyses. It addresses demonstrated cache/backlog growth while preserving the existing analysis method, source evidence and persisted checkpoint identities.

- Evidence planning and preparation retain SHA-256 identities rather than full serialized payload keys. Incremental hashing avoids a whole-input JavaScript byte array and preserves UTF-8 surrogate boundaries.
- Prepared evidence and summary caches each have a 4 MiB estimated serialized-size budget and a 96-entry limit. Oversized values are not admitted. Active work is tracked separately from completed cache entries. Compact relationship budget records survive eviction so cache churn cannot reset request/time allowances.
- Checkpoint writes pause their producers at 192 pending entries or 8 MiB of estimated serialized bases/results. No unsaved checkpoint is evicted. A single oversized record is admitted only when the queue is empty, so it can make progress without truncation. Producers must await writes; the existing hazard workers do.
- Saved checkpoint cache entries are bounded to 96 entries / 4 MiB. Batches select at most 48 pending entries without copying the entire queue.
- Capacity waits respond to cancellation. Healthy storage releases waiting producers automatically; exhausted/permanent storage failures leave analysis visibly paused until cancelled. Small workloads can still finish with an unsaved-results warning, as before.
- Stable source basis objects avoid repeated wrapper digests. Checkpoint recovery reads 48 results at a time. Wrapper and persistent backend hashing are sequential, avoiding 48 simultaneous full-evidence byte buffers. Persisted digest inputs and versions are unchanged.

Byte budgets estimate serialized UTF-16 footprint; they are not exact heap/RSS limits. Object overhead, active requests, one oversized record, source collections, full results, and compact per-relationship identity/budget metadata remain additional memory. Evidence is never truncated to fit a cache.

## Measured validation

- Synthetic planning: 202 oversized inputs previously retained 25,872,656 key characters; now retain 12,928 key characters.
- Synthetic wrapper checkpoint read/write: reused bases reduce serialization from 96 calls / 12,291,724 characters to 48 calls / 6,145,862 characters for 48 rows.
- A 300-record slow-storage test pauses at the configured entry/byte limit and eventually persists every record in order.
- Tests cover cancellation during capacity waits, byte pressure below the entry cap, an oversized record, visible pause status, and checkpoint reload after cache eviction without repeated provider requests.
- A 10,000-item cache stream checks that retained estimated bytes/count remain within configured bounds. Unicode hashing is checked against Node SHA-256.
- Full hazard directory: 68 suites / 613 tests passed before the additional pause-status regression; that regression is checked separately. Production compilation succeeded with existing warnings. See the session report for final native validation.

The batching test now supplies healthy checkpoint storage because a storage-free run can legitimately pause at capacity. A pre-existing publication test expected only one save; the unchanged baseline also failed it. Its assertion now counts the initial recovery manifest and final result save.

## Required next architecture stage

Total memory still grows with sources/results. Analysis still executes in the renderer. Do not advertise this stage as end-to-end constant memory, UI-independent execution, or a proven fix for the native crash.

1. Introduce a versioned durable job store with immutable input references, per-assessment records, a small status manifest, leases and an ordered event cursor. Preserve old run/checkpoint readers and provide a restartable migration.
2. Page sources and accepted results through that store. Adapt final sheet generation, narrative review, export and downstream traceability to consume iterators/pages; replacing the result map alone would move the allocation into finalization.
3. Extract provider transport, configuration and cancellation from browser globals behind injected interfaces. Execute the same hazard core in an isolated Desktop utility process, with bounded messages/pages and authenticated local access. Keep the browser execution adapter supported.
4. Make the renderer a subscriber to job status and visible result pages. Closing/reloading its window must not stop an independent job. Cancel must durably stop the job, including retries and worker requests.
5. Validate migrations, result equivalence, export completeness, and restart recovery using large synthetic datasets. Measure renderer/main/worker resident memory across increasing workload sizes and extended foreground/background runs. Force renderer and worker termination in isolated profiles and verify no duplicate accepted work or missing evidence.

The existing 4:37 PM native crash remains unattributed. Bounded caches reduce plausible pressure; a long-run reproduction and native diagnostics are still needed.
