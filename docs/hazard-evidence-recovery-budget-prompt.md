# Codex prompt: bound hazard evidence recovery

Read the current shared STPA/HARA/FHA pipeline before editing. Investigate the observed run with 70 evidence extraction requests, 13 compaction requests, two applicability requests, and no hazard-generation calls in the supplied excerpt. Trace invalid summary retries, output-limit retries, recursive splitting, compaction, cache reuse, and end-of-run retries.

Implement a focused fix that bounds evidence preparation per original payload and across the run. Count extraction, compaction, validation retries and recursive children against the same budget. Share the budget across smaller summary targets and retry passes. Reuse validated summaries in memory even when checkpoint storage is unavailable. Preserve strict citation validation, full original evidence, context, organization criteria and governed applicability.

When evidence preparation exhausts its budget or repeatedly produces invalid citations, continue independent work and use the existing assumption-based completion path for affected rows. Record premises in Assumptions and Assessment Basis; do not silently treat failed evidence extraction as a No decision. Preserve explicit cancellation and programming-error behavior. Keep reviewed No excluded and reviewed Yes unchanged. Do not change analysis classification or rating logic.

Test bounded concurrent requests, elapsed-time limits, repeated attempts, cache reuse without storage, source preservation, cancellation and completion for all three methods. Run the hazard-analysis, STPA transport and downstream requirements tests. Report actual verification and limitations; do not equate mocked tests with a live-provider speed benchmark.

# Implementation notes

- Evidence preparation allows 12 logical requests per payload/focus and 24 per run. Extraction, compaction and their local retries share these counts.
- New requests stop after 90 seconds per preparation, or 300 seconds of cumulative evidence request time across the run. These are admission limits; already-running requests finish under existing transport deadlines. Transport recovery remains independently bounded and may make multiple HTTP attempts for one logical request.
- Valid summaries remain cached in memory, independent of persistent storage. Summary-target changes do not reset the preparation budget.
- Budget exhaustion and invalid citation summaries go directly to end-of-run assumption-based completion, rather than restarting evidence recovery in subsequent passes.
- Original input records and governed decisions remain intact. This trades additional remote evidence refinement for the previously authorized explicit fallback premises; it does not establish missing facts.
