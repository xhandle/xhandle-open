# Context-save performance implementation

Implemented `docs/codex-prompts/implement-context-save-performance.md` on 2026-10-10.

## Changes

- `App.js`: unchanged context saves return early. Context saves adopt the saved run directly rather than triggering a full reload. Pending reads are invalidated when context saving begins; same-scope loaders wait for an in-flight context save. Project/repository identity is checked before adopting saved state. CSV drafts are no longer constructed when an existing hazard run supplies the table; the CSV workspace guard retains a separately memoized architecture hash. Review matching uses a first-occurrence index instead of repeatedly searching all serialized rows.
- `saveHazardContexts.js`: persists imported row changes without run-change notifications, then saves contexts. If the context write fails, attempts to restore the previous run and reports failure. No applicability values or reasoning are changed.
- `codeArchitectureHazardStore.js`: optional `notify: false` for locally coordinated writes; ordinary saves keep their notifications.
- `codeHazardImportContext.js`: indexes contexts and headers and allocates row copies only when a row's context actually changes. Existing preprocessing ownership and conflict handling remain intact.
- `codeArchitectureHazardUtils.js`: indexes case-insensitive summary headers once per conversion, preserving first-match semantics.
- `HazardOperationalContextManager.jsx`: displays “Saving…” and yields before doing row work. Continues to await persistence and report errors before closing.

## Validation

52 tests across 7 suites passed: context persistence, imported-context assignment, store notifications, CSV handling, summary conversion, and modal saving. Added checks for Yes/No preservation, unchanged row references, delayed persistence, run-write failure, context-write rollback, silent save durability, and duplicate case-insensitive headers. Production build passed with lint warnings. `git diff --check` passed.

The synthetic audit fixture also passed. Its timing run overlapped the production build, so those numbers are not used to claim a before/after speedup. The changes eliminate identifiable duplicate work, but Safari/Chrome end-to-end responsiveness has not been measured and customer data was not accessed.

## Scope and remaining limits

This is the targeted Code-Based Architecture optimization, with shared modal feedback. It does not redesign Projects map persistence, migrate storage, alter hazard reasoning, or change applicability decisions. A changed imported context still requires a full run write; very large payloads can still spend time in browser cloning/storage and table rendering. Context and run storage remain separate backends, so rollback handles reported write failures but is not crash-atomic across process termination. Browser smoke tests should cover large imported and generated analyses, reload after saving, and switching projects/repositories while saving. No commit or push performed.

## Follow-up: false scope mismatch on loaded analyses (2026-10-11)

The context-save guard compared `run.repoId` (source identity, e.g. `NVlabs/alpamayo`) to `activeCodeArchitectureRepo.id` (workspace repository entry UUID). The run loader correctly uses source identity, while the context store intentionally uses the workspace UUID. The guard therefore rejected valid loaded analyses and misleadingly described the rejection as loading.

Fixed the guard to compare with `hazardLoadRepoId`, the same identity used by the run loader. Context storage and in-flight workspace checks retain the workspace entry ID. Failed scope validation no longer increments the load invalidation version. The mismatch message now describes a different project/repository rather than claiming loading is in progress.

Added regression tests for distinct workspace/source IDs for GitHub and local sources, another project using the same repository, another repository in the same project, and configuring context before a run exists. All 57 tests across the seven targeted suites passed. No saved data migration or customer data changes.
