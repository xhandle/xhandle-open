# Tab-switch memory implementation review — 2026-10-28

## Verdict

The unchanged-run restoration optimization passes its targeted checks. One remaining memory-retention defect was identified in the new prepared-view cache. Do not describe the Chrome error-code-5 incident as conclusively fixed: the real crashing workspace and complete rendering lifecycle were not reproduced.

## Finding: P2 — invalidate prepared inputs when same-scope data changes while the tab is hidden

Locations: `src/App.js:7950`, `src/features/code-architecture-hazard-analysis/SavedHazardPanelLoader.js:52`, `src/features/code-architecture-hazard-analysis/hazardPreparationCache.js:1`.

The App-owned cache is cleared on project/repository changes only. The loader checks input identity while mounted, but the cache outlives the loader. After viewing a large hazard run, navigate away and finish or publish new results for the same project. The background completion path (`src/App.js:14538`) replaces the current run without clearing this cache. Its old `sheet` and `keys` references (including architecture rows) remain strongly reachable until another hazard mount or scope change.

The 8 MiB budget measures prepared output only. Its assumption that source inputs are already owned by the application ceases to hold when those inputs are replaced. This is one obsolete snapshot, not an unbounded history, but its input retention is not constrained by that budget. Large-workspace memory can therefore remain higher than intended. This finding does not establish the cause of the reported crash or imply stale results are shown on reentry: the mounted loader checks identities again.

Added a passing characterization in `SavedHazardPanelLoader.test.jsx` that prepares a run, hides the loader, replaces same-project inputs, and verifies the old sheet and architecture rows remain in the external cache. The harness mirrors the App cache ownership policy; it does not mount the whole App.

Recommended correction: invalidate the App-owned cache on actual source/freshness-input replacement even when the panel is hidden, while preserving reuse for unchanged inputs. Test background completion, context changes, source replacement and deletion before converting the characterization to the desired release behavior.

## Verification executed

- 182 tests passed across 23 suites, covering restoration races/cancellation, revision reuse, deletion, scope changes, legacy/quota handling, chunk storage, archive import/export regressions, diagram linkage, Storage and backup behavior.
- Isolated Electron/Chromium diagnostic: 14,483 synthetic rows, 100 tab reentries, 101 metadata checks, zero extra root-payload reads after initial load. Prepared-result and loaded-run identity remained stable.
- Diagnostic sampled heap peak: 28.87 MiB; idle: 9.42 MiB; explicit diagnostic-GC heap: 8.40 MiB. Renderer peak working set: 159,568 KiB.
- `git diff --check` passed.

Logs: `/tmp/xhandle-review-oct28-full.log` and `/tmp/xhandle-review-oct28-stress.log`.

## Limits and change scope

The stress diagnostic uses real storage/restoration/preparation but replaces the final hazard panel renderer with a no-op. It does not cover complete App tab navigation, large real source strings, simultaneous generation, all diagram/table rendering, Safari, or the user's exact Chrome profile. The passing characterization documents a defect; a green test count is not an all-clear.

No other regression was identified within the reviewed paths and executed checks. No new production build was run during this review; the preceding implementation build succeeded. This review added only its prompt, report, and characterization coverage. Production code, saved user data, commits and releases were not changed by this review.
