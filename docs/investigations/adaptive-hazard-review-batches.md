# Adaptive larger hazard review batches

Semantic review now starts at a 24-row / 60,000-character target, up from 12 rows /
30,000 characters. Character budgeting uses the deduplicated serialized prompt.
No source content is dropped. An indivisible row exceeding the target is still sent
alone. Generation retains its 32-row ceiling and the scheduler retains three shared
provider slots. Review output stays capped at 4,000 tokens; bounded truncation
recovery handles responses that do not fit.

A policy shared by review workers within one run halves row capacity on truncation,
malformed responses or missing verdicts, and reduces input capacity. Two complete
near-capacity responses permit cautious growth (+4 rows and +25% character budget)
to the trial ceilings. Policy epochs prevent older concurrent successes from
undoing a newly reduced limit. Findings about content do not count as transport
failures: they still trigger targeted generation correction as before.

Valid unique verdicts from an incomplete response are retained. Only omitted IDs
are re-reviewed. Duplicate, unexpected or malformed verdicts are not accepted;
missing verdicts never imply approval. Limits are run-local rather than global
provider state. No checkpoint contract change was needed; valid v5 checkpoints
remain reusable.

The pipeline emits one content-free [hazard-analysis-performance] console summary
and exposes an onMetrics callback: generation/review request counts and summed
request elapsed milliseconds, total wall milliseconds, newly accepted row count,
and wall milliseconds per newly accepted row (null when none). Request duration
starts after scheduler dispatch and includes failures/retries; summed concurrent
request durations are not wall time. Rows restored from checkpoints or bypassed
by reviewed No do not count as newly accepted. Metrics do not include final run
assembly/publication after generateFastHazards returns.

Verification: 293 tests passed across 29 suites. Added tests cover a real serialized
prompt between 30,000 and 60,000 characters in a single 24-row request, shrink and
regrowth, partial verdict preservation, concurrent policy changes, oversized-source
preservation and metric output. Existing overlap, cancellation, validation, recovery,
HARA/FHA and software-requirement compatibility tests remain passing. These are
mock-provider tests; live latency and larger-batch reasoning quality still need a
smoke test. No commit or push was performed.
