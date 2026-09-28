# Pre-run storage/readiness review — 2026-09-28

Executed prompt: docs/codex-prompts/review-analysis-storage-readiness.md.
Recommendation: **No-go for another unattended overnight run until the high-priority findings below are repaired and exercised end-to-end.** This does not establish the historical Safari failure's exact cause.

## Findings

### P1 — Actual project STPA stage checkpoints are not wired up

Project methods normalize to STPA-Textbook (src/features/project-hazard-analysis/hazardReconciliation.js:3). runLiteAIAnalysis's STPA-Textbook branch (src/components/aiAnalysisLite.js:233) passes setFolders but no onStageComplete to the standard generator. That generator defaults onStageComplete to a no-op (src/components/aiAnalysisCodeHazardStandard.js:2705), invokes it after generation/repair stages, and only calls saveSheets after ALL stages finish (line 2730). The new App.js checkpoint callback at line 11989 therefore saves initial decomposition and final sheets, not these intermediate stages.

Validation: isolated mocked-provider diagnostic executes the real runLiteAIAnalysis, completes a generation stage and fails a later stage. Only the initial decomposition reaches setFolders; generated stage rows never reach the checkpoint callback. No AI calls made.

Attribution: the missing integration existed before the repair, but the recent repair incorrectly claimed to supply stage checkpoints for this active path. Connect and await onStageComplete through the project runner; checkpoint completed batches as well if a stage itself is long. Verify a late-stage failure followed by a reload retains usable partial results.

### P1 — Durable decomposition recovery can ignore the newer correct data

App.js:7921 queries recovery only when loadedResponseRows is empty. A failed new decomposition save over an existing nonempty older decomposition leaves that old primary record, so the newer durable checkpoint is not inspected. App.js:7924 also compares against the whole project's _updatedAt, not a decomposition-specific revision; unrelated metadata changes can suppress valid recovery. Normal saveProjectPatch stores recovery asynchronously (App.js:1905), with failure only logged, and a later run can overwrite the one checkpoint slot with whichever stale decomposition loaded.

Validation: evaluated the actual guard expressions from App.js: recovery is skipped for nonempty old rows; an empty primary with newer metadata rejects a checkpoint even when no intentional decomposition deletion occurred. These are logic demonstrations, not a live Safari recovery test.

Attribution: introduced by the recent recovery implementation. Use decomposition-specific versions/tombstones, compare primary and recovery versions even when both are populated, and distinguish intentionally cleared rows from failed persistence. Await critical import/checkpoint durability; preserve multiple recoverable versions or prevent stale replacement.

### P1 — Run completion is not isolated from project navigation

The new pre-consolidation path saves to projectIdAtRun but unconditionally calls commitAnalysisResult (App.js:12118), using the live analysisRevisionRef for its expected revision. Navigation remains enabled (e.g. App.js:15196). If project B is active when A finishes, A's results/drafts are published into shared UI state and the autosave effect can save that state under B's active ID. Subsequent setAnalysisResult/setDraftHazardRowsByIndex after consolidation repeats the risk.

Evidence: code-path review, not a two-project browser reproduction. Closure-bound explicit final saves still target A; the hazard is shared React state and B's autosave, not JavaScript closure IDs changing.

Attribution: unguarded final publication predates the recent repair; the repair added another publication point and a live-revision dependency. Capture the run's project/revision once; persist against that identity; publish only if it is still the selected project/run. Test switching projects while generation and consolidation are pending.

### P2 — New recovery writes retain unbounded cloned snapshots under slow storage

src/lib/durableRecovery.js:51 JSON-stringifies and parses the full value before placing it on a per-key promise chain. Each pending call closes over its own full snapshot. There is no pending-write coalescing or queue bound. Decomposition edits can enqueue many complete copies while IndexedDB is slow or each request takes up to ten seconds to fail. Stage callbacks await writes, limiting that particular producer; ordinary saveProjectPatch callers do not await recovery.

Attribution: new recovery code. Coalesce replaceable decomposition checkpoints, bound pending writes, and avoid synchronous serialization of superseded snapshots. Validate queue size and retained bytes under stalled storage. This is a demonstrated structural growth risk, not a measured leak in the user's Safari process.

## Other observations

- Primary project data still uses a monolithic localStorage map. Diagram/import/hazard changes across the recent commits enlarge work and retained copies, but no heap profile was captured to blame a specific visual change.
- Recovery snapshots contain all accumulated sheets plus decomposition/context/preprocessing, and each completed write notifies automatic backup. Configured automatic backups serialize the workspace after debounce; large checkpoints can amplify peak memory. Measure representative data before claiming the memory issue is solved.
- New read timeouts improve bounded failure, but automatic continuation after interruption is absent; exported run checkpoints are JSON recovery artifacts, not automatic resumable jobs.
- Several hazard read paths still leave successful database connections open; transaction and recovery paths close theirs. Audit closure on all return/error paths.

## What passed

- 47 existing targeted tests passed across recovery, hazard storage, row display, STPA request handling, organization profile forwarding, and safe storage.
- Additional isolated diagnostic reproduces the missing stage checkpoint integration. Its first attempt required correcting the test's mock setup (CRA resets Jest mock implementations); this was a test setup issue.
- Current-code quota regression now reports save failure correctly. Corrupt primary storage remains untouched. Successful metadata save preserves decomposition across simulated cache reset.

## Scope and deliverables

No production fixes were made in this review; only this report, the review prompt, and a diagnostic test were added. No user browser storage was changed, no paid generation was run, and no real overnight Safari or heap test was performed. Historical root cause remains unconfirmed. Repair P1s and queue bounding, then validate fault injection, refresh recovery, project switching, and a representative staged run before unattended operation.

## Follow-up repair execution — 2026-09-28

Executed docs/codex-prompts/fix-analysis-storage-readiness.md.

- Forwarded onStageComplete through the active STPA-Textbook runner. The project callback awaits durable storage of stage name/normalized rows, plus accumulated sheets, inputs, and preprocessing. A later-stage exception no longer prevents the completed stage from reaching the checkpoint callback.
- Added content-specific decomposition versions, independent of project metadata timestamps. Hydration compares recovery even when primary rows are populated. Empty checkpoints are retained as intentional clears. Legacy unversioned recovery prefers the durable copy because old data cannot distinguish a clear from a failed save; versioned clears remain authoritative. Critical CSV import waits for the pending recovery write and reports recovery failure.
- Checkpoint queues retain at most one active and one latest pending snapshot per key. Superseded pending callers share the replacement promise. Snapshot serialization still occurs per submission, but retained pending copies are bounded.
- Captured run revision and navigation epoch. Late generation/final publication is gated by original project and navigation epoch. Background completion persists to the original project; consolidation is skipped if it has not started before navigation away. Final saves use compare-and-set against the pre-consolidation revision.
- Added regression coverage for stage forwarding before failure, newer recovery over nonempty stale primary, metadata independence, versioned clears, monotonic versions, coalescing 100 pending snapshots, and rejecting publication after project navigation (including return).

No paid AI execution or user browser storage resets. Automatic resume is not implemented: stage JSON is recoverable using Export run checkpoint, while completed hazard artifacts are available through normal loading/Restore. Initial generation can still lose work within a stage before its completion callback. Actual overnight Safari behavior and representative heap measurements remain unverified. Previously lost unsaved data cannot be reconstructed by this patch.
