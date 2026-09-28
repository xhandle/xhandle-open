# Storage regression fixes — 2026-09-28

Executed prompt: docs/codex-prompts/fix-storage-repair-regressions.md.

- Legacy primary data, including explicit empty tables, wins over ambiguous checkpoints. Differing checkpoints remain in storage for backup/manual review; hydration displays a notice. Comparable content versions still recover newer checkpoints.
- Failed primary saves retain data under a separate decomposition-candidate key with accepted=false. They cannot replace accepted recovery data or automatically apply on refresh.
- Functional CSV imports capture project identity and navigation epoch before reading. Navigation during read cancels the import; navigation during checkpoint persistence skips UI publication. Layout initialization markers are written for the original project before the wait.
- Project deletion immediately blocks future checkpoint submissions for that identity, drains active/pending writes, then deletes decomposition, candidate, and hazard-run records. Cleanup failures are surfaced. This coordinates producers in this tab; independent tabs should be closed before deletion because cross-tab project lifecycle coordination is outside this patch.
- Recovery failure no longer blocks loading valid primary data. A warning identifies degraded recovery and reopening retries. Missing primary data remains protected from autosave when recovery cannot be checked.
- Final hazard consolidation publishes UI changes only after successful revision-checked persistence. Previously persisted pre-consolidation results remain if final persistence fails.

Validation: full Jest suite 118 passed, one skipped; 1,103 tests passed, two skipped. Isolated actual-source diagnostics cover legacy rollback, rejected imports, navigation during CSV read/checkpoint and normal publication, degraded hydration, quota failures, corrupt-primary protection, and save/reload. Queue regression covers deletion during stalled writes and rejection of late producers. Changed production files pass parsing/no-undef checks; git diff --check passes.

No user storage was cleared, no AI analysis was run, and no live Safari overnight/heap test was performed. Recovery candidates currently require manual inspection through a storage backup; automatic resume is unchanged. Existing unrelated workspace changes were preserved.
