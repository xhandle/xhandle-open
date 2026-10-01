# Large-view performance fixes — validation

Executed [fix prompt](../codex-prompts/fix-large-diagram-table-performance.md), based on the [review](large-diagram-table-performance-review.md).

## Implemented

- Memoized project hazard rows with stable event handlers that use the latest committed state. Selection is passed only to the selected row, and identical cell selections are ignored.
- Replaced draft textarea grids with plain-text cell editing. Text wraps naturally; changes save on blur. Escape restores the original value; identifiers remain read-only. The existing preprocessing and persistence handlers remain in use.
- Added deferred row mounting with a shared IntersectionObserver and estimated placeholders. Expensive cells mount near the viewport, or immediately when highlighted/selected/found through search. Visited rows stay mounted, preserving edit text and natural row heights. Collapsing and expanding an unvisited group does not force all its editors to mount.
- Added model-backed hazard search, including review/action labels, filtered/expanded rows, current cell values, and explicit reveal-before-jump for deferred rows. Other tables keep their DOM-based search. Keyboard handling is unchanged.
- Cached per-node/per-edge presentation, memoized custom diagram nodes, skipped no-op edge deselection, avoided repeated position-store hydration, and indexed node/group membership checks.
- Skipped hidden functional decomposition row rendering in diagram-only mode. The diagram remains mounted across workspace view changes as before.

## Measured improvement

Same isolated Chrome development environment and 200-interface / 1,400-draft-row fixture as the review. CPU profiling enabled; timings are event dispatch through two animation frames. Cell/node selection uses the median of three different selections. Other actions are individual samples.

| Action | Before | After |
| --- | ---: | ---: |
| Open Hazard Analysis tab | 2,488 ms | 135 ms |
| Select a hazard cell | 952 ms | 15 ms |
| Open a hazard filter | 876 ms | 25 ms |
| Open quick search | 539 ms | 37 ms |
| Select a diagram node | 312 ms | 82 ms |

Initial hazard DOM elements fell from 203,497 to 6,823; draft textareas fell from 63,000 to zero. The row count displayed to the user and the searchable dataset remain the full filtered set. Placeholder rows are not counted as extra analysis records.

The 700-row completed-table fixture also improved: its measured tab opening was 230 ms and median cell selection was 12 ms, compared with 1,739 ms and 271 ms in the review.

Raw measurements: [large-view-performance-fix-measurements.json](large-view-performance-fix-measurements.json).

## Validation

- Full suite: **126 suites passed; 1,143 tests passed, 2 skipped**.
- New regressions cover plain-text blur save/cancel/failure behavior, current callbacks in memoized controls, unchanged diagram presentation identity and position hydration, deferred row reveal/retention, collapsed-group expansion, and model search visibility/review metadata.
- Isolated Chrome, draft and completed tables: search reveals the last previously unmounted row; long text has no internal cell scrolling; edits survive reload; stored diagram positions remain unchanged.
- Isolated Chrome at 1,400 draft rows and WebKit at 140 draft rows: search respects column filters and collapsed groups, including deferred rows; save/reload and layout restoration checks pass. No page errors were recorded.
- ESLint on changed application files: zero errors, 24 existing warnings. `git diff --check` passes.

## Scope and limits

Measurements are development-build observations, not production guarantees. WebKit automation is not the user's installed Safari with its extensions. No production-build, overnight memory-retention, or executed AI analysis was performed in this task. Existing generation, classification, recovery, CSV, and layout-algorithm code was not redesigned.

Progressive mounting reduces initial work; it is deliberately not aggressive recycling. Visiting every row eventually mounts all visited rows until the table is unmounted. This preserves editor focus and unsaved text. Row selection remains memoized and search remains model-backed after those rows have mounted. First-time offscreen heights are estimates until natural cell content renders.

The measured table fixes target project hazard tables. The separate code-architecture table retains its existing renderer and DOM search. Diagram rendering changes apply wherever this shared diagram component is used.

## Reproduce

Use `scripts/diagnostics/review-large-view-performance.cjs` with the environment variables documented in the original review. Add `PERF_VERIFY=1` for behavioral checks, `PERF_COMPLETED=1` for synthetic completed rows, or `PERF_BROWSER=webkit` for WebKit (without CDP CPU profiles). Run browser benchmarks sequentially without simultaneous tests/builds.

All browser data was synthetic and isolated. No commit or push was performed.
