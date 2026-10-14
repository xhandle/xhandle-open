# Deduplicated hazard review and overlapping request queues

## Changes

`fastHazardSemanticReview.js` now serializes shared operational contexts, source
evidence and interface definitions once per review batch. Each row references its
interface and retains its own ID, guide phrase, governed decisions and full
assessment. Different contexts remain distinct. Prompt budgeting uses this actual
serialized representation; the 12-row/30,000-character targets remain unchanged.
No evidence is truncated to meet the budget.

`hazardRequestScheduler.js` provides separate FIFO generation/review request queues
under one three-request limit. When both queues have work, dispatch alternates stages.
Cancellation rejects queued calls; the pipeline's stop check prevents queued work
from starting after a fatal provider error.

`fastHazardPipeline.js` permits six bounded batch workers to prepare generation and
review work, rather than tying three workers to whole generation/review cycles.
The scheduler accounts for every generation, review and retry request. At most six
batches (up to 192 source rows) await completion across these stages. This is not
unbounded pre-generation of a repository's assessments. Generation can start while
review from another batch is still pending. The existing semantic review gate,
checkpoint ordering, governed applicability and method-specific calculations remain.
Progress counts only accepted assessments; queued/generated rows are not completion.

Checkpoint version remains v5: this changes scheduling and lossless serialization,
not the assessment contract. Previously reviewed matching checkpoints remain reusable.
No changes were made to the Projects hazard-analysis pipeline.

## Verification

287 tests passed across 28 suites, including software-requirement compatibility.
Regression tests reconstruct deduplicated inputs to verify round-trip equivalence,
retain different contexts, and check actual generation starts during a held review
request for STPA, HARA and FHA. They assert total active requests never exceeds
three, at most six batches are generated while review is blocked, and no unreviewed
row is checkpointed or counted complete. Scheduler tests cover stage fairness and
cancellation. Existing semantic-failure, correction, checkpoint reuse, provider
failure and recovery tests also pass.

A synthetic 12-row repeated-evidence fixture reduces serialized review prompt size
by over 35% compared with unshared source entries. This is a payload measurement,
not a measured live-provider speedup. Independent contexts/evidence yield less
reduction. The shared request ceiling is intentionally unchanged, so latency gains
depend on repeated input and stage imbalance; they are not guaranteed by concurrency
alone. No live-provider benchmark, commit or push was performed.
