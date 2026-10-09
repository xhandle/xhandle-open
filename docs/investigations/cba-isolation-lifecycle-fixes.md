# Remaining architecture lifecycle gaps: implementation

Implemented `docs/codex-prompts/fix-cba-isolation-lifecycle-gaps.md` on 2026-10-09.

## Changes

**Save ordering.** Architecture edits, imported records, publication preparation, and recovery now enter a per-project/repository mutation queue before opening IndexedDB. A delayed older write must settle before a later publication can proceed. Queues are independent across scopes and recover after a rejected operation. Internal memory-checkpoint preparation stays within recovery's existing queue entry, avoiding recursive queue waits.

App settles existing writes before starting generation/recovery, and the shared GitHub/local generation path settles them again before reading the reconciliation/publication baseline. Atomic revision checks and publication conflict preservation remain in place; edits made after that baseline can still correctly cause a conflict.

**Failed-run reload.** App has an explicit saved-analysis reload request. When a run fails or is cancelled, it clears the analysis-in-flight scope and requests hydration only if that run's project/repository is still selected. Returning to A during A's unsuccessful run no longer leaves A blank solely because its loader previously skipped an active analysis. The existing scoped loading tokens continue to reject stale loads.

**Import completion.** Successful import explicitly requests loading of its persisted destination rather than relying solely on selection changes. Repository entries are merged by ID so a reused ID replaces its prior entry without duplicating it. Reading back persisted rows preserves import-normalized lineage and avoids treating imported data as another unsaved edit.

## Correction to the inspection-only import finding

Tracing the entire importer showed that JSON project packages create a new project, while ordinary CSV imports create new repository IDs within the selected project. Therefore, the earlier review's claimed ordinary trigger—reimporting a JSON local project package into the already-selected repository—was not established by the existing UI path. The import changes are defensive completion guarantees, and the destination policy is unchanged. Tests now verify that JSON imports leave the previously selected project intact and that unchanged-scope completion still refreshes if an ID is reused.

## Files

- `src/features/code-architecture-assurance/codeArchitectureStorage.js`: scope mutation queues and pending-write settlement; public persistence/publication signatures retained.
- `src/components/generateFunctionalDecompositionFromGitHub.js`: settle pending edits before reading the baseline, shared by GitHub and local acquisition.
- `src/App.js`: failed-run reload requests, pre-run write settlement, explicit import reload and repository merging.
- `src/features/code-architecture-assurance/architectureImportRefresh.js`: repository-ID merge helper.
- `codeArchitectureIsolationFollowupAudit.test.js`: former defect reproductions now require corrected behavior; also covers independent scopes, imports behind older writes, and recovery after failed database opening.
- `architectureImportRefresh.test.js`: actual importer callback tests for CSV/JSON destinations and explicit completion reload, plus ID deduplication.

## Validation

66 tests passed across six suites: scope ownership and actual App hydration/autosave callbacks, IndexedDB publication isolation, lifecycle follow-up regressions, import completion, recovery UI, and Functional table behavior. Tests cover delayed database opening and hashing, ordinary generation failure, publication conflict and cancellation after A/B/A navigation, authoritative empty results, legacy ownership checks, and preservation of completed checkpoints.

Production build passed with repository lint warnings. `git diff --check` passed. No paid repository analysis or customer browser records were accessed. The tests use React harnesses, extracted production App callbacks, and production persistence functions with fake-indexeddb; they are not a live Safari/customer-dataset validation.

## Data preservation

This closes the reproduced lifecycle failures while preserving the earlier project-isolation protections. It does not automatically reconstruct historically overwritten data, bypass legitimate publication conflicts, or change hazard/requirements reasoning. Existing records and checkpoints remain untouched by the implementation work. No commit or push was performed.
