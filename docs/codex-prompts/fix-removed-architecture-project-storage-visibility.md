Investigate and fix removed Code-Based Architecture projects missing from Settings → Storage → Workspace project visibility in /Users/Nick/xhandle-open. Implement and verify the repair, not just a plan.

User report and screenshot evidence:
- User deleted a project from Code-Based Architecture and expects it to appear in Storage as Removed with Restore/Permanently delete actions. It did not.
- Screenshot /Users/Nick/Desktop/Screenshot 2026-10-28 at 8.16.25 PM.png (actual filename may contain a narrow nonbreaking space before PM; locate read-only if necessary) shows three existing code projects in the sidebar but Storage shows 0 active, 0 removed, and “No recoverable workspace project records were found.”
- The screenshot reports a partial scan: xhandle-project-hazard-analysis, xhandle-hazard-analysis-reset, xhandle-safety-remediation, SafetyCaseEvidenceDB unavailable or timed out. Estimated site usage is 1.65 GB.
- User is on browser localhost:3000, not a packaged desktop application.
- Do not assume the specific project's historical data can be recovered; explain that limit if its metadata was never retained. Do not read, export, modify or delete personal browser profiles, databases, backups or customer data. All reproductions use isolated synthetic fixtures.

Initial code evidence to verify:
- src/App.js deleteCodeArchitectureProject currently only removes an entry from React state and clears selection; check its persistence effects.
- src/components/storageWorkspaceVisibility.js classifies graph project records and filters by sourceStore. Active localStorage lists appear used only for classification, not as independent inventory sources.
- Graph population via legacyWorkspaceGraphMigrator may be lazy and tied to Collaborator/context construction, so projects not previously indexed may never have a recoverable retained record. Do not make deleted-project retention depend on whether an optional migration or feature has run.

Requirements:
1. Trace creation/import, edits, normal project removal, retained metadata, inventory, restore, permanent deletion and reload. Reproduce a missing removed project from a fresh graph with no prior Collaborator/indexing. Also reproduce why active sidebar projects can be absent from Storage.
2. Ensure normal sidebar removal retains a durable exact project snapshot sufficient for restore, BEFORE removing the active registry entry. Surface retention failures and leave the active project intact when the snapshot cannot be saved. Do not silently convert normal removal into permanent deletion. Check functional Projects removal too; fix a shared defect where appropriate while preserving documented cleanup semantics.
3. Inventory active projects from authoritative active registries even when graph indexing has not run. Merge durable removed records without duplicates; distinguish workspace type and exact IDs. Do not fabricate recoverability, resurrect permanently deleted records, or infer ownership by names/repository matches.
4. Decouple project visibility from unrelated feature-database scans/timeouts. Do not report “none found” when the project inventory itself failed. Keep useful active counts/rows if retained-record lookup fails, and show a retryable diagnostic for unavailable retained records. Preserve existing partial scan warnings.
5. Ensure restore faithfully restores repository connections/settings and that permanent deletion (including verification/progress) still removes retained records and stays removed on refresh/reload. Coordinate with existing migration gates and pending-write safeguards where necessary. Do not add a separate conflicting retention mechanism without a reason.
6. Add meaningful regressions that fail before the fix: remove without prior indexing; durable retention failure; authoritative active inventory with an empty/unavailable graph; restore; permanent delete/reload; unrelated scan failure. Use targeted helper and actual UI tests as appropriate.
7. Exercise actual App sidebar deletion → Settings → Storage → Restore → removal → Permanently delete → refresh/reload in an isolated browser context with synthetic projects. Existing diagnostics scripts show Playwright patterns and temporary playwright-core modules may be available under /tmp/xhandle-delete-browser or /tmp/xhandle-hazard-review. Do not merely seed an already-retained graph project to claim sidebar removal was verified. Include an unrelated active project and confirm it survives.
8. Run focused tests, lint and appropriate compilation checks. Avoid hydration of giant analysis values for inventory. Review final diffs and preserve all existing authorized changes.

Existing authorized worktree changes from this session must be preserved:
- Permanent deletion ID/ownership fixes, write/migration coordination, verification, retryable errors, stage progress and browser tests.
- Hazard restoration idle-state fix and tests to remove a phantom “Loading saved results…” banner during architecture-only navigation.
- Existing untracked prompts, findings reports and integration/browser diagnostics.
Inspect git status before editing. Do not reset unrelated files, commit, push, publish, package or deploy. Native desktop repo is outside scope. Do not spawn subagents or recursively invoke Codex. Do not change global configuration.

Starting files:
- src/App.js project creation/import/remove/persistence callbacks, Settings callbacks
- src/components/SettingsModal.jsx refreshStorageInventory, restoreStoredWorkspaceProject, permanentlyDeleteWorkspaceProject
- src/components/storageWorkspaceVisibility.js
- src/components/permanentlyDeleteStoredProject.js and tests
- src/features/workspace-graph/{workspaceGraphDb,workspaceGraphRepository,legacyWorkspaceGraphMigrator}.ts
- src/components/storageCleanupWorkspace.js
- scripts/diagnostics/verify-workspace-project-permanent-delete.cjs
- docs/investigations/workspace-project-permanent-delete.md

Write findings and validation to docs/investigations/removed-architecture-project-storage-visibility.md. State demonstrated cause(s), behavior changes, commands/results and unverified recovery limits. Finish with a concise implementation/test summary. Do not claim the user's installed desktop app or personal data was changed.
