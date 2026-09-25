+# Codex prompt: root-cause and repair disappearing project hazard analysis

Investigate this as a browser-storage data-loss incident in xhandle-open. The Atoms Transport functional-project hazard analysis has disappeared more than once without the user intentionally clearing it.

Objectives:
1. Trace the complete lifecycle of functional-project hazard data: generation, state updates, project switching, hydration, autosave, IndexedDB writes, localStorage migration/removal, quota failures, review/regeneration writes, reset/restore, import/export, and storage cleanup.
2. Identify the concrete path(s) that can replace a previously non-empty saved hazard-analysis record with null, empty, stale, or wrong-project data. Do not settle for general speculation about browser quota.
3. Pay special attention to asynchronous hydration versus autosave races, stale React closures, project-ID capture, failed IndexedDB writes, fallback behavior, and code that deletes legacy localStorage fields before durable persistence is confirmed.
4. Reproduce each credible destructive path with automated tests.
5. Implement a durable fix with these invariants:
   - Loading or switching projects must never autosave unhydrated/default state.
   - A null/empty in-memory analysis must not overwrite an existing non-empty persisted analysis except through the explicit confirmed Clear Analysis operation.
   - Failed writes must preserve the last known good record and report failure.
   - Migration removes legacy copies only after the durable write is confirmed.
   - Concurrent/stale writes cannot roll a newer/non-empty record backward.
   - Explicit clear remains possible, intentional, auditable, and recoverable through its existing undo behavior.
6. Add recovery where feasible for existing projects using the strongest surviving source (IndexedDB, legacy project data, review evidence, or snapshots) without fabricating analysis.
7. Keep changes scoped; preserve unrelated uncommitted work.
8. Run focused persistence/race/quota tests and a production build.

Deliver:
- Root cause with exact code paths.
- Files changed and safeguards added.
- Tests proving the former loss path and the fixed behavior.
- Any residual browser-level limitations.

