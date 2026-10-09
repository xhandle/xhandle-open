# Code-Based Architecture project result isolation review

Reviewed 2026-10-09 against main at ada74a52551972dd9bf4cd9c88bccf291aacae2d. Production code and user browser data were not modified.

## Outcome

Confirmed a critical project isolation defect. Switching projects can write the previously selected project's rows into the newly selected project's persistent storage. This is not merely a rendering cache problem. The reported sequence is consistent with this defect, although the user's actual IndexedDB records and original publication error were not available for inspection.

The screenshot selects **Alpamayo2**, despite the accompanying description referring to alpamayo. Its **Analysis complete — save pending** banner means completed work is checkpointed but has not been successfully published. The diagram below that banner is the currently loaded published row state, not proof that the checkpoint was successfully adopted.

## Findings

### 1. Critical: autosave uses the selected project's key with unowned row state

Evidence: `src/App.js:3985`, `src/App.js:4069`, `src/App.js:4217`, `src/App.js:5555`–5596.

`cbaTableData` is a shared array without an associated project/repository scope. Selecting project B immediately changes `activeCodeArchitectureRowsKey` to B. The loading effect starts asynchronous hydration but does not clear A's rows for a valid new project. The autosave effect also runs because its project, repo, and key dependencies changed. It writes `cbaTableData` to B without checking ownership, hydration completion, or whether an edit occurred.

Calling `setCbaLoading(true)` in the loader does not prevent this: the autosave has no loading guard at all, and both effects belong to the same render. Its cleanup sets `cancelled = true` only for the metadata continuation; the already-started database write continues.

Reproduced by extracting and executing both actual effect callbacks from App.js, using an isolated asynchronous storage double:

- A's rows are written under an empty B key.
- A's rows overwrite an existing B dataset.
- Calling the effect cleanup before the simulated database commit does not prevent either write.

The exact displayed result depends on read/write scheduling. B's original data can be read before the unwanted write, leaving apparently correct in-memory results with incorrect persisted data, or a subsequent load can adopt A's rows. Switching back can propagate stale rows in the opposite direction. A full Functional model attached to the rows can travel with them; the diagram component's React key does not protect the parent data.

Metadata may also be rewritten using B's repository identity with A's row count. Durable publication metadata, run history, checkpoint data, and the active row pointer can consequently disagree.

### 2. High: compatibility recovery accepts data without establishing project ownership

Evidence: `src/App.js:4111`–4132; `readFirstCbaRowsFromIndexedDB` in `src/features/code-architecture-assurance/codeArchitectureStorage.js`.

The candidate list trusts `meta.indexedDB.key` and `meta.storageKey`, including keys belonging to another project. It also considers the global legacy `cba:owner/repo` key. The reader selects the first nonempty row array, not a record whose ownership has been verified. Loaded fallback rows are subsequently adopted and autosaved under the active project's key.

The diagnostic confirms both an explicitly foreign metadata alias and a shared legacy repository key are accepted. A global legacy key is a particular risk for distinct projects using the same repository; it does **not** by itself explain leakage between different repository names. A foreign metadata alias also requires such an alias to exist. Neither is established in this user's browser. The unguarded autosave in finding 1 requires neither precondition.

An intentionally empty primary result is indistinguishable from absent data in this fallback path, so recovery may also repopulate a project unexpectedly. Review-item recovery is more carefully scoped: it requires a project-specific artifact prefix and rejects a mismatched explicit project ID.

### 3. High: load failures and overlapping operations can leave unowned rows active

Evidence: `src/App.js:4217`–4299, `src/App.js:5395`–5401, `src/App.js:5543`–5547, `src/App.js:17477`–17515.

The hydration promise has `.finally()` but no `.catch()`. If reading or preparing B's saved data rejects, the loading state becomes false without clearing A's rows or presenting a scoped load-error state. Rendering then passes the shared rows to the B-keyed table. This is a separate stale-display path in addition to finding 1's persistent overwrite.

Saved-data hydration and repository analysis also share `cbaLoading`. Generation is guarded before setting rows (`codeArchitectureScopeRef.current === storageKey`), but its loading setter and final loading reset are unscoped. A background run can therefore change the loading state of another selected project. Hydration checks its effect cancellation flag, but does not have an operation-generation token to prevent a load that began before a newer publication from adopting an older snapshot in the same scope. These asynchronous-ordering risks were identified by inspection; the diagnostic reproduces the autosave defect, not every full-UI timing permutation.

## Why the run can finish without new results appearing

`src/components/generateFunctionalDecompositionFromGitHub.js:3428` reads the existing rows used as the reconciliation/publication baseline. Functional processing occurs after that read. At lines 3504–3520, the generator prepares and recovers publication before calling `setTableData`. If publication fails, it throws while retaining prior rows and the recovery checkpoint.

`prepareArchitecturePublication` and `recoverArchitecturePublication` (`src/features/code-architecture-assurance/codeArchitectureStorage.js:94`–174) compare baseline revisions and reject changes with `SOURCE_PUBLICATION_CONFLICT`. An unrelated autosave changing the active record during this interval can trigger that protection. Other storage failures can also prevent publication; the screenshot does not identify which occurred in the reported run.

`ArchitectureRunRecovery` is keyed by scope and uses the existence of any current row data (`hasPublishedRows={cbaTableData.length > 0}`) to say that the last completed architecture remains available. It does not verify those rows belong to the selected project. Thus a correctly scoped pending checkpoint can be shown above a foreign diagram.

The 38-file/1341-draft-row figures belong to checkpoint status. They do not establish that the visible diagram represents those generated results. No evidence here supports blaming browser capacity or the specific Alpamayo repository.

## Existing protections that should be retained

- Primary row keys contain both project ID and repository-config ID.
- Durable metadata is tagged and checked against the active scope.
- Generator row callbacks check the current scope.
- Hydration cancels state adoption after its effect is cleaned up.
- Recovery validates both checkpoint-key scope and the ready record's scope.
- Publication compares revisions in the commit transaction and preserves conflicting work.
- Review-row recovery uses project-specific prefixes.

These protections do not compensate for the unscoped parent row array and unconditional autosave.

## Potential downstream impact

App passes the shared `cbaTableData` into the Functional diagram, exports, hazard analysis, and assurance/requirements panels (`src/App.js:14363`, `14433`, `14537`, `17503`, `17568` onward). If it already belongs to another project, those consumers can derive artifacts from the wrong inputs while using the selected project's identity. This review does not establish that any specific saved hazard or requirement artifact has been contaminated.

## Smallest safe repair plan

1. Represent loaded architecture state with its owner scope and load/revision status. Derive renderable rows only when that scope matches the active project/repository. Apply the same ownership gate to exports and downstream analysis inputs.
2. Persist explicit edits or dirty revisions for their owning scope. Do not autosave just because selection or metadata changed. Hydration must not be treated as an edit. Preserve generation's existing atomic publication path.
3. Use per-scope operation tokens for hydration and generation completion/loading. A stale completion must neither replace newer rows nor end another operation's loading state. Handle load failures explicitly without retaining foreign rows.
4. Constrain migration candidates to verified ownership. Treat missing and intentionally empty records separately; make ambiguous legacy recovery explicit rather than automatically adopting it.
5. Retain publication conflict detection. Do not solve the pending-save symptom by bypassing the revision check or forcibly replacing saved data.
6. Assess potentially affected records before attempting recovery: compare active rows, durable metadata, run scope/source manifests, history, and completed checkpoints. Do not infer ownership from project names, row counts, or similar function labels. Preserve ambiguous copies; do not silently delete or relabel them.

Required regression coverage: A/B empty and populated destinations; distinct and identical repository identities; rapid A/B/A switching; delayed reads/writes; cleanup during writes; hydration failure; intentional empty results; legacy aliases; project switching during generation; stale hydration after publication; scoped Functional model/export/hazard/requirements inputs; and publication-conflict recovery preserving both versions.

## Verification

Created and executed:

`node scripts/diagnostics/review-cba-project-result-isolation.cjs`

All four defect reproductions passed (empty B overwrite, populated B overwrite, foreign metadata alias, shared legacy key). The script extracts the actual App.js effect/helper source using Babel and runs it with isolated storage doubles. It verifies current defective behavior; it is **not** a regression test asserting that the issue has been fixed, a full browser reproduction, or a real IndexedDB timing test.

No paid AI runs, user database changes, production code edits, build, commit, or push were performed. The remaining uncertainties are the original publication exception and which user records, if any, have already been overwritten. A corrected implementation needs integration/browser regression coverage before this workflow is considered repaired.
