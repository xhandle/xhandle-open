Fix permanent deletion from Settings → Storage → Workspace project visibility in /Users/Nick/xhandle-open. Implement and verify the fix; do not stop at a plan or review.

User-confirmed behavior:
- The affected row is a removed project in Workspace project visibility, not a record in an expanded category.
- Clicking Permanently delete opens the warning. The user accepts it, the UI appears to perform deletion, but the project remains after completion and after an xHandle reset/restart.
- We have not inspected the user's actual stored project or confirmed its ID type or any final error message. Do not claim a root cause for their specific data without evidence.

Current worktree has authorized uncommitted changes in SettingsModal.jsx and permanentlyDeleteStoredProject.js plus a new permanentlyDeleteStoredProject.integration.test.js. Inspect these and preserve unrelated changes. Earlier work added key/index-based deletion to avoid hydrating large analysis payloads, normalized numeric project IDs, moved messages beside the project list, and retained the success message after inventory refresh. Eleven targeted tests passed. The numeric-ID regression is reproduced in a synthetic test, but is NOT confirmed to be the cause of the user's report. Critically review these edits, correct unsafe assumptions, and improve or replace them as necessary.

Investigate the complete flow:
1. Inventory and classification of retained graph projects; active-list validation; confirmation, busy state, result messages and inventory refresh.
2. Every cleanup stage before the retained graph record is deleted last. Identify how unrelated invalid localStorage JSON, blocked/failed databases, large values, cursor callback errors, or timeouts can prevent that final deletion. Errors must be actionable and visible without scrolling past the storage list.
3. Exact ownership matching across string/numeric IDs, project index semantics, chunk records, recovery records and shared fallbacks. Preserve other projects, repository caches, credentials and backups. Do not silently skip owned records simply because an index is incomplete or a payload has a conflicting projectId.
4. Pending writes, memory caches, graph migration, React persistence, backup restore or startup behavior that could recreate deleted records. Distinguish a failed delete from recreation; don't hide retained rows just to make the UI look fixed.
5. Verify the persisted project record is absent before reporting success. Preserve a retryable retained row if prerequisite cleanup fails, with a meaningful error.

Relevant starting points:
- src/components/SettingsModal.jsx
- src/components/permanentlyDeleteStoredProject.js and its tests
- src/components/storageWorkspaceVisibility.js
- src/components/storageCleanupWorkspace.js
- src/features/workspace-graph/{workspaceGraphDb,workspaceGraphRepository,legacyWorkspaceGraphMigrator}.ts
- src/lib/durableRecovery.js
- src/features/code-architecture-assurance/artifactUtils.js
- src/App.js storage callbacks, project removal, startup persistence
- scripts/diagnostics/verify-storage-cleanup-reload.cjs (existing native-browser test pattern; uses isolated browser storage)
- docs/investigations/selective-storage-cleanup.md

Requirements:
- Reproduce at least one failure relevant to this exact UI flow with a regression that fails before the fix.
- Add meaningful tests for persisted deletion and preservation of unrelated projects; include failure/retry behavior and string/numeric IDs as warranted.
- Run an actual Settings UI test in an isolated browser/profile if browser tooling is available: seed a retained project and unrelated active/removed projects, confirm permanent deletion, inspect persisted stores, refresh and reload, and verify it remains absent. Test cancellation and a cleanup failure so the UI cannot falsely report success. Use synthetic data only; do not access or delete personal user databases/profiles.
- Run focused tests and appropriate compilation/lint checks. Inspect the final diff.
- Keep shared application changes in this repo. If consulting /Users/Nick/xhandle-desktop, read its AGENTS.md and README.md and treat it as read-only unless a native defect is established. Do not publish, commit, push, package or deploy as part of this task.
- Do not spawn further agents or recursively invoke Codex. Do not alter global configuration.
- Write a concise findings/validation report to docs/investigations/workspace-project-permanent-delete.md with demonstrated causes, changes, exact checks and results, and any unverified limitations. Clearly separate synthetic reproductions from the user's uninspected data.

Complete the implementation and verification autonomously. In your final response, summarize the actual fix, files changed, tests run and remaining limitations. Do not claim the user's installed app was updated.
