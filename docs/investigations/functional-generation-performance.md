# Functional generation performance

Executed [speed-up-functional-generation.md](../codex-prompts/speed-up-functional-generation.md).

## Findings and changes

The processor awaited every caller and consolidation batch serially. Each consolidation batch also scanned all source annotations. This made provider response latency accumulate across independent functions.

Independent callers and consolidation batches now run through a pool capped at four simultaneous requests. Batches within a caller remain sequential so they share a consistent established descriptor. Consolidation uses an endpoint index instead of repeated full-model scans. Stable caller, link and target ordering makes mappings independent of response completion order.

Automatic processing reuses an already-current model without model requests. Explicit Generate/Regenerate in the UI forces fresh processing. No partial cache or stale annotations are reused. The shared processor covers GitHub, local and imported/existing analyses.

Cancellation or terminal failure aborts in-flight requests and stops queued work. The model publishes only after both validated stages finish. Malformed model output still retries and subdivides; provider transport errors that have already exhausted adapter retries do not subdivide into a storm of additional requests. Detailed source data and existing hazard/source traceability are unchanged.

## Verification

- Synthetic 24-function fixture: 30 identical-output requests at 20 ms simulated latency each took 634 ms sequential versus 182 ms with four workers (about 3.5x faster). This measures scheduling, not real provider throughput or model quality.
- Verified four-request cap, reversed completion order, sequential/parallel output equivalence, complete source coverage, cache reuse, explicit regeneration, cancellation, fatal failures, and no repeated subdivision on exhausted HTTP 429 retries.
- 31 regression suites / 246 tests passed across functional processing, source generation, hazards, assurance, navigation and remediation.
- Production build checked separately; no paid model calls or customer data were used.

## Limits

Fresh processing still makes the same number of semantic requests and consumes approximately the same tokens. Rate limits and provider capacity can reduce concurrency gains. A single caller with many source relationships still processes its batches sequentially to preserve consistent descriptors. No automatic reduction of source evidence or weaker validation was introduced to achieve the speedup. Changes are uncommitted.
