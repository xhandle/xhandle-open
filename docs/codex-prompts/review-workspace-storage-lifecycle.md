Review and validate the uncommitted implementation in /Users/Nick/xhandle-open for correctness, regressions and completeness. The user explicitly requests a review to determine whether the reported problems are fixed and whether new bugs were introduced. Execute the review, tests and any necessary concrete fixes; do not stop at a proposed plan. Do not claim an absolute absence of bugs.

Reported problems and intended behavior:
1. Permanently deleting a removed project in Settings → Storage → Workspace project visibility appeared to complete, but the project remained after refresh/restart. Success must require persisted deletion, preserve unrelated projects/shared caches/credentials/backups, and show a useful retryable error on failure.
2. Deletion needs visible progress with the project name and genuine cleanup stages through verification and list refresh; no fake time estimates or premature completion.
3. Architecture Diagram showed “Loading saved results… Retry loading” after the diagram loaded. Saved-hazard restoration is intentionally disabled for architecture-only navigation unless requested. Idle/disabled loading must not show phantom progress; enabled hazard/requirements/design/traceability loads, retries, upgrades, generation publication, cancellation and background refresh must remain correct.
4. Removing a Code-Based Architecture project in the sidebar did not make it appear as Removed in Storage. Storage showed zero active/removed despite active sidebar projects and partial unrelated database-scan warnings. Normal removal must retain an exact durable recoverable snapshot before changing active state. Retention failure must preserve the active project and explain the error. Storage must inventory active registries without optional prior graph indexing, distinguish an unavailable retained inventory from a genuinely empty one, and offer faithful restore/permanent deletion. Historical snapshots never saved may not be reconstructable.

Review scope:
- All current tracked diffs and untracked implementation, tests and diagnostics, not only the last patch. Start with git status/diff, read any applicable AGENTS.md and the existing findings reports. Preserve unrelated work.
- src/App.js removal/creation/import/persistence callbacks and state races.
- src/components/SettingsModal.jsx inventory/restore/permanent deletion/progress and stale async scans.
- src/components/{retainWorkspaceProject,permanentlyDeleteStoredProject,storageWorkspaceVisibility,storageCleanupWorkspace} and tests.
- src/features/workspace-graph/{workspaceGraphDb,workspaceGraphRepository,legacyWorkspaceGraphMigrator}.ts.
- src/features/code-architecture-assurance/{artifactUtils,codeArchitectureStorage}.js.
- src/lib/durableRecovery.js.
- src/features/code-architecture-hazard-analysis/useHazardRunRestoration.js and tests.
- Both new browser diagnostic scripts and reports under docs/investigations.

Actively try to disprove correctness:
- Ownership: string/numeric/zero IDs, invalid IDs, same IDs in different workspace types, scoped keys vs conflicting explicit projectId, incomplete indexes, chunk ownership, ambiguous diagram keys, shared repositories. Ensure nothing belonging to another project is deleted.
- Persistence: real graph schemas, older/missing stores, atomic retention, aborted/blocked transactions, invalid localStorage JSON, quota/write failures, cleanup retry, restore after partial cleanup, reopening connections. A failed snapshot write must not remove the project. A queued/timed-out operation must never start deleting after the UI reports failure.
- Async lifecycle: late writes, memory caches, recovery queues, migrations, repeated clicks, project edits/removal while awaiting snapshot, switching scope/view, restore during cleanup, unmount, stale inventory warnings and counts, serial gate errors/timeouts, failed guards and guard release. Check pending promises/transactions for hangs and unhandled rejections.
- Retention and restoration: exact current metadata and repository settings, original ID types, no reliance on Collaborator indexing, no silent permanent loss of functional-project data caused by applying shared changes. Read actual App normalization and persistence effects rather than only helper tests.
- UI/progress: status is visible and accessible; abort/failure/cancellation clears progress appropriately; completion follows verification; stage counts match actual stages; slow unrelated scans don't mask available project rows; graph failure doesn't claim zero removed definitively; success messages don't conceal errors.
- Hazard idle fix: disabled views don't read huge data or show loading/failure notices; enabling restores data; disabling aborts and ignores stale callbacks without discarding retained runs; scopeReady does not break other consumers.
- Performance: avoid loading giant analyses for inventory/deletion where ownership metadata suffices; bound opens/waits and clean up handles/listeners; inspect tests for mocks that accidentally conceal real payload hydration or missing ownership cases.

Verification:
1. For each material finding provide file/line, severity, concrete trigger, impact and evidence. Add a meaningful regression that fails before fixing it. Fix concrete bugs found within this scope and rerun affected checks. Separate initial findings from residual issues after fixes.
2. Run relevant helper/hook/storage/migration/recovery/architecture tests. Broaden to relevant existing suites and full suite if feasible. Establish whether failures predate this change with an isolated baseline, without resetting this worktree. Avoid unrelated fixture rewrites or masking failures to make tests green.
3. Run both browser scripts with actual App/Settings in fresh isolated nonpersistent browser profiles using synthetic data only. Verify sidebar remove → Storage → restore → remove → permanent delete → refresh/reload with unrelated survivors, failure/retry, cancellation, unavailable graph, fresh graph and unrelated scan failures. Confirm tests use current source and don't merely seed retained rows to pretend sidebar retention works. Test progress and loading-banner behavior with real components.
4. Run lint on modified files and a production compilation when warranted. Inspect final diff and ensure old authorized changes remain. Record exact commands and results, including existing warnings/failures.
5. Write the final review to docs/reviews/workspace-storage-lifecycle-review.md. Lead with residual findings by severity (or explicitly say no remaining demonstrated findings), then list repaired review findings, acceptance matrix for the four reported problems, validation results and limitations. Distinguish synthetic verification from user's uninspected historical data and native desktop restart. Don't claim no regressions just because focused tests pass.

Boundaries:
- User authorizes review, local repairs and verification, not commit/push/merge/publication/deployment/release. Do not touch installed apps or private desktop source. Do not access real personal/customer browser databases or backups. Do not modify global configuration or log secrets.
- Do not reset existing edits, spawn subagents or recursively invoke Codex. Existing prompts and reports are context, not proof; independently verify their claims.
- Use existing Playwright tooling under /tmp if available; isolate and clean up only processes/resources you start. Do not kill the user's dev server.

Finish with a concise review outcome, repaired/residual findings, test evidence and limits. The intended result is a concrete reviewed implementation with demonstrated bugs corrected and an honest statement of what remains unverified.
