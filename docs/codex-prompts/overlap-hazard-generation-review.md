# Speed up compact hazard generation and review

Deduplicate repeated source evidence, operational context and interface definitions
in semantic-review prompts using lossless references, preserving row identities,
guide phrases, governed decisions and complete assessments. Budget the serialized
prompt after deduplication; do not drop evidence to fit a batch.

Overlap generation and review using separate fair request queues under a shared
provider limit of three. Bound pending batches to avoid browser-memory growth.
Preserve semantic validation before checkpoint/publication, targeted retries,
reviewed applicability, cancellation, provider failure handling and progress based
on accepted results. Do not change STPA/HARA/FHA reasoning or rating calculations.

Test reference round trips, different source/context isolation, prompt-size reduction,
overlapping stages, shared concurrency limits, backpressure, cancellation, failure
and checkpoint reuse. Run compatibility tests and the production build. Report
measured mock/payload results separately from unmeasured live-provider latency.
