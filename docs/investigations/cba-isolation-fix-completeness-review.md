# Follow-up review: Code-Based Architecture isolation fix

Date: 2026-10-09. Reviewed the current uncommitted implementation on top of ada74a52551972dd9bf4cd9c88bccf291aacae2d. This review added a prompt, this report, and diagnostic tests only. It did not modify production code or user records.

## Verdict

**Not fully resolved.** The original A-to-B row autosave defect is prevented in the covered selection flows. The follow-up audit reproduced two remaining asynchronous lifecycle defects and identified a same-scope import refresh gap by inspection. These remaining defects concern stale or missing results within the correct project; this review did not reproduce the original cross-project overwrite after the fix.

## 1. High: a queued save can replace a newer publication if delayed before reading its baseline

References: `src/App.js:5567`, `src/features/code-architecture-assurance/codeArchitectureStorage.js:57`, `src/features/code-architecture-storage/chunkedRecord.js:222`.

App submits an owned row snapshot to `writeCbaRowsToIndexedDB` without an expected revision from the snapshot it edited. The adapter first awaits database opening; `writeRecord` reads its baseline afterward. If a newer analysis publishes before this older save reaches that baseline read, the save adopts the NEW database revision as its baseline and commits the OLD row payload over it.

The atomic comparison protects against a revision change **after** the writer's baseline read. It does not establish that the payload was derived from that baseline. The dirty/scope guard prevents cross-project writes but does not solve this version-ordering gap.

Reproduction uses production publication and storage functions with fake-indexeddb. Delay delivery of the old save's database-open completion, successfully publish fresh rows, then release the old save. It returns true and the stored rows revert to the older edit. This is a deterministic injected scheduling test, not a reproduction in the customer's Safari session.

A separate test delayed the writer during hashing, AFTER its baseline read: publication correctly caused that save to return false, and the new rows survived. That case is protected and should remain so.

Minimal follow-up: bind edits to the revision they were based on, or coordinate saves and publication through a per-scope version-aware write coordinator. Drain/settle relevant queued edits before selecting a generation baseline. Preserve the commit-time revision guard. A cancellation boolean applied only after the write is insufficient.

## 2. High: switching away and back during a run that fails leaves existing results blank

References: `src/App.js:4226`, `src/App.js:4293`, `src/App.js:5544`; `src/features/code-architecture-assurance/useScopedArchitectureRows.js:11`.

Sequence:

1. A has published rows and begins a new analysis.
2. User selects B and then A while A's run is still active.
3. The session guard correctly stops exposing A's old in-memory snapshot. A's loader sees an active analysis and returns before loading its saved rows.
4. The run fails, including a publication failure. Its finally block clears the in-flight refs and loading flag.
5. Clearing refs does not restart the scope-dependent loader. A remains empty even though its published rows are still in IndexedDB.

Reproduced using the actual App loader and `handleBaselineRepo` bodies, the production scoped-row hook, a rejected generation promise, and isolated persisted rows. After failure, loading is false and the displayed row array is empty; reading A's saved data returns its original results.

This is a regression risk from suppressing hydration during analysis without a terminal failure reload. It is not evidence that the saved results were deleted.

Minimal follow-up: track analysis lifecycle reactively or explicitly trigger a scope-checked rehydration when an unsuccessful run ends. Recover the last published snapshot for that scope without replacing a newer publication or reading a different project's rows. Test ordinary generation failure, publication conflict, and cancellation after A/B/A navigation.

## 3. Medium: importing into an unchanged local repository scope does not refresh the display

References: `src/App.js:4606`, `src/App.js:5300`, `src/App.js:5313`; hydration dependencies at `src/App.js:4293`.

`saveImportedCodeArchitectureRows` reuses an existing repository-config ID when an imported local-source package matches it. The importer persists the rows, selects that repository, and assumes the selection will cause hydration. The fix removed the explicit imported-row adoption, and the loader now runs only on scope/session changes.

When the matching local repository is already selected, the scope does not change. The import can report success while the current diagram/table retains its old rows. The importer also appends the reused ID to the repository list; this should be reconciled rather than relying on duplicate IDs to refresh anything.

Evidence level: code-path inspection, not a complete file-picker/browser reproduction. Ordinary CSV imports create distinct IDs and are not implicated by this specific case.

Minimal follow-up: explicitly adopt or reload the successfully persisted import using its target scope and current operation token, including unchanged-scope imports. Upsert a reused repository ID. Add a local project-package reimport integration test.

## Protections verified

- No A rows are autosaved into empty or populated B merely by changing selection.
- Prior-session setters and loads are rejected on A/B/A navigation.
- The Functional payload remains attached to its owned snapshot.
- Published snapshots and ordinary hydration do not trigger autosave.
- Foreign metadata aliases and global repository fallbacks are not automatically adopted.
- Explicit empty records stop fallback recovery.
- Known foreign lineage causes a load error without rewriting the record.
- Checkpoint recovery refuses a different project scope.
- Commit-time publication conflicts retain the completed checkpoint and existing edits.

## Verification and limits

Executed:

```
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/features/code-architecture-assurance/codeArchitectureIsolationFollowupAudit.test.js src/features/code-architecture-assurance/useScopedArchitectureRows.test.js src/features/code-architecture-assurance/codeArchitectureIsolation.test.js src/components/generateFunctionalDecompositionFromGitHub.test.js src/features/code-architecture-assurance/ArchitectureRunRecovery.test.js
```

58 tests passed across five suites: the previous 55 tests plus three new diagnostics. **Two passing diagnostics assert that defects still occur**, and the third verifies an existing protection. A green test command here must not be interpreted as a clean completeness verdict. Convert defect reproductions to corrected-behavior regression tests when fixing them.

`git diff --check` passed. No build was repeated because this review did not change production code. No paid analysis, live Safari test, real customer storage inspection, data recovery, commit, or push was performed. Historical data without reliable ownership evidence remains an acknowledged limitation; this audit does not establish which customer records were affected.

## Implementation follow-up

See `cba-isolation-lifecycle-fixes.md` for the subsequent changes and regression validation. The two reproduced timing defects have been addressed, and the diagnostic tests now assert corrected behavior. The full import caller trace also narrowed finding 3: JSON packages create a new project, so its originally suggested normal UI trigger was not established. Import completion was still made explicit and repository-ID merging hardened without changing that destination policy.
