# Overnight hazard analysis and missing decomposition investigation

Date: 2026-09-28
Scope: execute docs/codex-prompts/investigate-overnight-analysis-storage.md. Read-only investigation of application behavior; no browser project data cleared or reset. Application fixes are not included in this investigation.

## Confirmed findings

1. **Critical: project saves can falsely report success after storage failure.**
   App.js installLocalStorageBroadcast wraps localStorage.setItem, catches failures through runStorageWrite, and only rethrows quota errors for a small allowlist. xhandle.projectData is not on that allowlist. writeProjectMap assumes an exception-free call persisted its serialized data, updates its cache, and returns true. This breaks callers that check saveProjectPatch's boolean. Non-quota write errors are also swallowed. A failed write leaves the previous disk data intact; it does not directly delete it. If the previous data lacks the newly imported decomposition, refresh reveals the older empty state.
   Reproduced from the current App.js function bodies against isolated fake storage using scripts/diagnostics/reproduce-project-storage-failure.cjs: reportedSuccess=true, diskRows=0, rowsAfterRefresh=0. No user storage was accessed by this reproduction.

2. **High: intermediate bulk analysis stages are not durably checkpointed in the project path.**
   App.js passes dummySetFolders to runLiteAIAnalysis. That callback evaluates each updater against an empty object and returns it without persisting it. aiAnalysisLite and its generators issue intermediate setFolders updates, but the project caller only processes the returned final sheets. A late failure, reload, or browser termination can therefore discard intermediate work even if earlier AI calls succeeded. This is a browser-owned job, not evidence of a resumable overnight background job.

3. **High: generated hazard rows wait for issue consolidation before publication/save.**
   App.js builds finalSheets, then awaits requestConsolidatedSafetyIssuesFromSummary before setting analysis state and saving the artifact. A failure normally caught by the consolidation catch can retain results, but abort/reload/termination before publication loses this in-memory result. Save a validated hazard checkpoint before starting consolidation.

4. **High: functional decomposition recovery depends on volatile memory when the primary record is absent.**
   responseRows are stored in the monolithic localStorage xhandle.projectData map. The lastKnownFunctionalRowsRef fallback is a React ref and cannot survive refresh. readProjectMap collapses read/parse failures to an empty map, and hydration then substitutes empty rows; it does not distinguish unavailable storage from genuinely absent content. A read failure should block subsequent empty-state autosaves, not be treated as an empty project. This investigation reproduced write failure, not an actual browser read failure.

5. **Medium: storage waits have no bounded failure on the hazard artifact path.**
   openHazardDatabase awaits idb.openDB without blocked/versionchange handling or a timeout; operations and transaction completion are awaited without a deadline. A blocked/stalled open can leave save/load pending. The Settings storage scan timeout added elsewhere does not protect this separate path. Actual Safari blocking was not reproduced here.

6. **Memory/size pressure is plausible but unmeasured.**
   Every compact project save serializes the whole project map; the autosave effect also depends on analysis/draft/risk state. Hazard state and drafts duplicate table data, with five retained artifact revisions. listHazardAnalysisRevisions loads all projects' revision payloads before filtering. These are allocation/size concerns, not proof of a memory leak or an out-of-memory crash. No heap profile or Safari crash log was available.

## Validation

- Isolated reproduction above confirms the false-success write defect.
- 35 tests passed across safeStorage.test, projectHazardAnalysisStorage.test, and aiAnalysisSTPA.test.
- Provider request deadlines exist (180 seconds default, 290 seconds for selected long-reasoning requests); the investigation does not claim all AI requests lack timeouts.
- No production code changed during this investigation.

## What remains unknown about the reported incident

No direct access to the affected Safari tab's localStorage/IndexedDB, storage usage, Activities outcome, provider/network logs, or crash report was obtained. Thus quota exhaustion, browser process termination, blocked IndexedDB, and an AI failure cannot yet be ranked as the actual overnight trigger. The two symptoms may have separate causes. Do not describe the missing decomposition as irretrievably deleted.

## Recovery sequence

Keep any other surviving xHandle tabs open. Do not clear browser/site storage. Inspect hazard Restore history for a saved artifact and check existing configured backups before writing new data. Backup restore can replace workspace data and requires reviewing the backup first. Downloads contains prior decomposition and hazard CSV exports; these can recover the exported input/preprocessing state, but cannot reconstruct unpersisted AI results. Reimport into a separate recovery project only after storage writes are verified reliable; do not overwrite the affected project to investigate it.

## Prioritized implementation plan

1. Preserve observable write failures for authoritative project data; update caches only after confirmed writes. Test the installed wrapper together with writeProjectMap, including quota and non-quota errors.
2. Add durable, revisioned decomposition storage and explicit missing/unavailable/corrupt read outcomes. Prevent empty-state overwrite after failed hydration.
3. Persist validated incremental analysis checkpoints, with project/run identity and resume metadata; persist hazard rows before consolidation. Interrupted runs must retain the last valid checkpoint and preprocessing.
4. Bound IndexedDB open/read/write waits, close stale version connections, surface save failure persistently, and stop dependent operations when durability is unknown.
5. Reduce whole-map serialization and loading of unrelated revision bodies; profile a realistic large run before claiming a memory fix.

The first fix is necessary but alone does not supply overnight resume or recover results never saved.

## Repair execution (2026-09-28)

Executed docs/codex-prompts/fix-overnight-analysis-storage.md.

- Authoritative project writes now propagate quota/non-quota failures through the wrapper; cache maps are copied instead of mutated before persistence. Corrupt/unreadable project storage blocks saving/hydration rather than becoming a new empty map.
- A separate IndexedDB recovery store checkpoints nonempty decompositions. Loading an empty project checks for a newer durable checkpoint before enabling autosave, while preserving intentionally newer empty state. Bulk hazard analysis explicitly awaits a decomposition checkpoint before generation.
- Bulk generation stage callbacks now retain previous sheets and await durable snapshots, including input/context/preprocessing. Latest run snapshots can be downloaded using Export run checkpoint. These snapshots do not automatically resume AI execution and are not completed hazard CSVs.
- Generated hazard rows and drafts are committed to the versioned artifact store before issue consolidation begins. A failed durability check stops consolidation.
- Recovery connections/transactions and hazard database connection/read/write waits are bounded; timed-out writes abort their transactions, late connections close, and version changes close blocking connections.
- Recovery storage participates in Backup and Storage settings. Revision lists fetch only the selected project's revision bodies one at a time. Removed unrelated hazard/draft dependencies from compact project autosave.
- Regression checks: 47 targeted Jest tests passed; isolated current-code checks confirm quota false-success repaired, corrupt primary data preserved, and successful save/reload preserves decomposition. Changed core modules passed no-undefined-variable lint and syntax parsing.

Limitations: no overnight real Safari run or affected-browser heap profile was performed. Browser/process termination cannot save work since the last completed checkpoint. Existing unpersisted data cannot be reconstructed by these changes. Primary project metadata remains in localStorage; the recovery store supplements decomposition durability rather than migrating the entire workspace to IndexedDB. Recovery listing still reads each matching project's full revision serially to compute row counts; no full heap optimization claim is made.
