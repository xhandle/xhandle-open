# Workspace storage lifecycle review

## Outcome and remaining findings

The four reported behaviors pass the exercised helper, component and isolated-browser acceptance checks after the repairs below. No remaining blocking defect was demonstrated in those scenarios. This is not a guarantee that all regressions are absent. The full repository suite is not green: eight hazard-evaluation failures reproduce on the unchanged baseline; an earlier full run also had timeout failures that passed when rerun separately.

Residual limits:

- Cross-tab writers and explicit backup restoration are outside the same-runtime migration/write gate. Cleanup is not one atomic transaction across every database; earlier successful stages may remain committed after a later failure. The retained project row stays available for retry when prerequisite cleanup fails.
- Unindexed stores still require individual payload reads where keys cannot establish ownership. Large synchronous deserialization or localStorage JSON parsing cannot be interrupted by JavaScript timers. The snapshot database open is bounded, but a retention transaction itself still depends on IndexedDB scheduling/completion; a pathological competing transaction can delay removal while the active project remains intact.
- Historical metadata never retained cannot be reconstructed by this fix. Tests used synthetic data, not the user's original removed project, personal browser profile or backups. Browser reload coverage does not establish native desktop update/reset behavior.
- Conflicting workspace ownership and ambiguous colon-delimited project namespaces now fail safely. They require data repair before destructive cleanup rather than guessing ownership. Ambiguous legacy layout keys are intentionally preserved.

## Review findings repaired

1. **High — functional removal discarded restorable data.** App's normal functional-project removal still deleted its project map, recovery, hazard analysis and review items after saving only its project snapshot. Restoring could recreate the project entry without that work. Normal removal now preserves project-owned data; destructive cleanup remains in permanent deletion. The browser diagnostic verifies a project-data sentinel survives actual sidebar removal and restore.
2. **High — numeric/string aliases could bypass workspace ownership.** Retention checked only string keys, while legacy graph projects may have numeric keys. Permanent deletion could remove another workspace's record with the same normalized ID and its scoped records. Retention checks both aliases; deletion verifies retained workspace ownership before any destructive cleanup. Regressions failed before repair and pass afterward.
3. **High — overlapping colon-delimited namespaces could select another project.** A scoped key for project `a:b` can resemble a nested key belonging to project `a`. Cleanup now refuses ambiguity against active registries and retained project keys. The regression verifies both the other retained project and its artifacts survive.
4. **Medium — removal could commit stale state or hide a failed active-registry write.** Snapshot persistence introduces an await during which project metadata or selection can change. Removal now checks the latest project object, persists the active-registry removal synchronously before publishing it to React, and leaves the project active when the registry write fails. Current selection refs prevent a delayed removal from clearing another selected project. Tests cover a changed project object and failed registry write.
5. **Medium — restore could replace corrupt registry data with an empty list.** A forgiving registry parser treated invalid JSON as no active projects. Restore now fails visibly and preserves the malformed value. The browser test injects invalid JSON and confirms it is unchanged.
6. **Medium — retention accepted invalid IDs and an open could complete after timeout.** Snapshot inputs are validated before opening storage. A ten-second open timeout closes late connections without starting writes. Tests cover invalid IDs and late completion. Aborted transaction promises are observed to avoid unhandled rejections.
7. **Medium — a failed repeated deletion could release an earlier successful deletion's guards.** Guards are now acquired inside the serial mutation gate, report whether they were newly installed, and are released on failure only by the operation that acquired them. A regression verifies late artifact saves remain blocked after successful deletion followed by a failed repeated cleanup.
8. **Low — stale inventory failure callbacks and misleading read tests.** Aborted scans no longer publish stale retained-inventory errors. Deletion tests explicitly forbid hydration in stores whose keys prove ownership; tests do not claim every unindexed store avoids value reads. Actual App normalization accepts numeric zero consistently with the storage helpers.

The review's failures-before evidence is recorded in temporary logs `/tmp/workspace-review-before.log`, `/tmp/workspace-review-collision-before.log`, `/tmp/workspace-review-finalize-before.log`, `/tmp/workspace-review-guard-before.log` and `/tmp/workspace-review-prefix-before.log`. These are local diagnostic artifacts, not committed repository dependencies. Some initial test failures also exposed inadequate mocks; those were corrected rather than treated as product reproductions.

## Acceptance matrix

| Reported problem | Result and evidence |
| --- | --- |
| Permanent deletion reports completion but leaves the project | Pass: persisted numeric/string deletion, final independent verification, failed cleanup/retry, unrelated survivors, refresh and reload. Ownership conflicts are rejected before cleanup. |
| No visible deletion progress | Pass: named stage progress stays visible through cleanup and inventory refresh; cancellation leaves data intact; failure clears progress and keeps a retryable row. |
| Architecture displays a phantom saved-results loading banner | Pass: disabled hazard restoration returns idle without reading; enabled loads retain loading/retry/upgrade behavior; cancellation and stale callbacks are covered. Actual architecture navigation loads synthetic rows without the banner. |
| Removed sidebar project missing from Storage; active projects also missing | Pass: fresh graph starts empty, active registries supply inventory, actual removal durably retains metadata, restore preserves repository settings, unrelated scan failures do not hide rows, unavailable graph is distinguished from empty inventory. |

## Validation

Final focused command:

```sh
CI=true npm test -- --watchAll=false --runInBand --testPathPattern='retainWorkspaceProject|permanentlyDeleteStoredProject|storageWorkspaceVisibility|storageCleanupWorkspace|workspaceGraph|legacyWorkspaceGraphMigrator|durableRecovery|useHazardRunRestoration|codeArchitectureIsolation|artifact'
```

Result: **24 suites / 165 tests passed** in the primary agent's final rerun after the review process stopped. The review runner's preceding focused run passed 164 tests; the final rerun includes the added namespace regression. Log: `/tmp/workspace-review-root-final-tests.log`.

Browser checks, both passed in isolated nonpersistent Chrome contexts against current source:

```sh
node scripts/diagnostics/verify-removed-project-visibility.cjs
PLAYWRIGHT_MODULE=/tmp/xhandle-delete-browser/node_modules/playwright-core node scripts/diagnostics/verify-workspace-project-permanent-delete.cjs
```

Coverage includes actual sidebar removal without seeded retained rows, retention failure preserving the active project, unavailable retained inventory, unrelated scan failures, faithful repository restore, malformed active registry preservation, architecture navigation without the loading banner, permanent deletion/progress/cancellation/failure/retry/reload, unrelated survivors, and functional data preservation on restore. Logs: `/tmp/workspace-review-browser-visibility-final.log` and `/tmp/workspace-review-browser-delete-final.log`.

Broader suite evidence:

- Completed full run: **315 suites passed, 5 failed, 2 skipped; 2,714 tests passed, 13 failed, 3 skipped**. Log: `/tmp/workspace-review-full.log`.
- Separate rerun of the five failing suites: four passed; **eight tests in hazardEvalRunner.test.js failed**. The same five suites on an isolated unchanged baseline produced the same eight failures and four passes. Logs: `/tmp/workspace-review-failures-rerun.log` and `/tmp/workspace-review-baseline.log`. The earlier five extra failures were timeouts and were not reproducible in that separate rerun. This is evidence against a new regression in those failures, not a fully green final full-suite run.
- A second full-suite attempt did not produce a completed summary before the stalled runner was stopped; it is not counted as a successful verification.

Final ESLint: **zero errors, 16 existing App.js warnings**. Log: `/tmp/workspace-review-root-final-lint.log`. `git diff --check` passed.

Final production compilation after the ownership hardening passed: `NODE_OPTIONS=--max-old-space-size=8192 GENERATE_SOURCEMAP=false npm run build` (exit 0), with existing lint/Browserslist/bundle warnings. Log: `/tmp/workspace-review-root-final-build.log`.

## Execution and scope

Prompt: `docs/codex-prompts/review-workspace-storage-lifecycle.md`. It was run with the local Codex CLI. After implementation and saved validation, the runner repeatedly lost its model connection and stalled. The primary agent interrupted only that runner, inspected the saved changes/results, reran focused tests and lint, and completed this report. No assertion depends on an unfinished runner's final message.

All prior authorized edits were preserved. No commit, push, merge, publication, deployment, native desktop modification or personal-data operation was performed.
