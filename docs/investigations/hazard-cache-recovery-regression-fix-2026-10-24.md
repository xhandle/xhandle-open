# Hazard cache recovery regression fixes

Implemented the two regressions identified by the large-analysis reliability review. Prompt: `docs/codex-prompts/fix-hazard-cache-recovery-regressions.md`.

## Prepared evidence after eviction

The evidence chunker now retains only compact identities of successfully prepared or recovered summaries. If a previously prepared summary is evicted and its checkpoint is missing, invalid or unreadable, it raises `HAZARD_EVIDENCE_STORAGE_UNAVAILABLE`. This error is not eligible for row deferral or assumption-based completion. The pipeline preserves accepted partial results and returns an actionable storage-recovery error.

This is a recoverable interruption, not an automatic background retry loop. After storage becomes readable, checkpointed evidence can be reused without further provider calls. The request/time budget is not reset. Persisted checkpoint keys, source evidence and cache size limits are unchanged. The compact identity ledger is per run and grows with prepared chunks; it is not a claim of constant total memory.

## Correct paused status

After a capacity wait succeeds, the checkpoint writer explicitly reports resumed processing. If other writes remain queued, the status continues to mark work unsaved and says progress is still being saved. Cancellation continues to reject the waiting producer without falsely reporting resumed work.

## Validation

- Complete hazard suite: **69 suites / 623 tests passed**.
- Production build succeeded with existing lint warnings.
- `git diff --check` passed.
- Regression cases cover missing, invalid and rejected reads after eviction; identical recovered evidence without extra provider calls; retained-cache control behavior; preserved accepted results without assumption fallback for STPA, HARA and FHA; and resumed processing while other writes remain pending.
- Existing tests continue covering healthy-checkpoint eviction reuse, partial preparation recovery, cancellation, write ordering, slow storage, and byte/count limits.

No Desktop native files were changed in this fix. No production app was restarted, no personal database was accessed, and no release was published. Combined packaged validation still requires pinning the reviewed shared changes into Desktop. Full result paging, execution outside the renderer, and sustained large-workload memory validation remain outstanding. These regression fixes do not establish that the original native crash has been eliminated.
