# Hazard scrolling update-depth regression — 2026-10-31

The reported development stack was traced against the JavaScript served by `localhost:3000`. Its `measure` call at line 452738 was the synchronous `setMeasurementRevision` in `useContinuousHazardRowWindow`, invoked from a layout effect. The customer's browser storage was not opened or modified.

## Cause and reproduction

Measuring newly mounted rows could change the visible range, which mounted different rows, which measured again and synchronously updated React before the previous commit had finished. Both the continuous saved-row hook and the older complete-table hook could exceed React's nested-update limit.

Four deterministic tests reproduce the original error before the fix: alternating row geometry and a long but finite sequence of newly measured short rows, for each hook. The before-fix log is `/tmp/xhandle-hazard-depth-20261031/baseline-measurement-regression.log`.

The actual table also specified `table-layout: fixed` with only `minWidth`, leaving its width implicit. Real Chromium tests showed a configured 1,780-pixel table varying between 1,780 and 10,183.26 pixels as different rows entered the window; the two-column fixture varied from 640 to 7,151.27 pixels. That changed wrapping and row heights despite unchanged column settings. These browser fixtures confirmed unstable geometry but did not reproduce the React crash themselves; the deterministic hook tests provide the exact fail-before evidence.

Broader regression tests also caught a scroll-position problem during column resizing. Replacing a measured tall row with a temporary estimate could overwrite its retained within-row offset before the new measurement arrived. Deferring measurement exposed this in the complete-table hook; the continuous hook already had the analogous problem for offsets exceeding its estimate. The correction must preserve the original offset through estimates, clamp it only against the new actual height, and retain that clamp if the row later grows again.

## Fix

- Both hooks read and publish measurements through a coalesced animation-frame callback. Measurements no longer synchronously recurse from a layout effect, and bursts of ResizeObserver notifications share the queued callback.
- Queued measurements are cancelled on cleanup and validated against the current source/model before updating shared state. A stale callback cannot clear a newer callback's ownership.
- Row focus completes only after unchanged geometry is measured or changed geometry has committed.
- Programmatic scroll corrections retain the logical row and within-row offset until actual measurements arrive. Native scroll events caused by those corrections cannot replace the anchor with a temporary estimate. A real scroll to a different position still updates the anchor immediately, including before an outstanding saved-row response commits.
- The real hazard table now sets its explicit width to the configured column-width total, stabilizing wrapping as rows enter and leave the viewport.

## Verification

- All four original failure cases now pass. The focused hook/navigation set has 29 passing tests, including observer coalescing, convergence to zero queued measurement work, StrictMode focus, scope changes, disable/unmount and stale callback protection. Resize tests for both hooks verify a 1,500-pixel offset inside a 2,000-pixel row becomes 399 when the row shrinks to 400 pixels and remains 399 when it grows again; programmatic native scroll events are included.
- Table/panel integration: 23 tests passed. Assertions for focus completion now wait for the measurement frame rather than assuming synchronous layout-effect completion.
- The full hazard-analysis regression suite passes: **96 suites, 850 tests** (`final-hazard-regression.log`).
- Production build passed at `/tmp/xhandle-hazard-depth-20261031/final-build`. Build warnings match the earlier build; no additional warning messages were introduced. Hook lint and `git diff --check` pass. The build's source manifest is `/tmp/xhandle-hazard-depth-20261031/final-source-sha256.json`; all 784 recorded source/configuration files remained unchanged through build completion.
- An independent review of the final hooks found no remaining blocking issues in anchor retention, stale callback ownership, navigation completion or idle update convergence.
- Real development React/StrictMode verification exercises 15,000-row complete and saved tables, mixed variable heights, long unbroken values, a two-column table, rapid scrolling, scrollbar jumps, resizing and distant-row focus. Both Chrome and Electron passed all four variants, with stable configured widths, no runtime errors and zero continued idle commits. These longer stress captures precede the final anchor correction and are labeled accordingly in the evidence.
- Both Chrome and Electron also passed four focused navigation variants against the final source. Real header drags narrowed and widened columns while preserving the viewed source row and within-row position; far-row focus and idle convergence passed. The diagnostic adds 24 pixels of padding to its isolated scroller so macOS overlay scrollbars do not intercept the last column's resize handle. Earlier driver failures are retained as diagnostic failures, not application regressions.
- The final production full-App runs with 15,000 saved hazard rows passed in Chrome and Electron. Six wheel samples per runtime had p95 frame intervals of 16.8–17.5 ms in Chrome and 16.8–17.3 ms in Electron. Both runs reported no runtime errors and zero visible loading or empty frames during the measured scrolling gestures. These are synthetic workload results, not a guarantee for every saved project or device.

Detailed evidence is recorded in [the measurement artifact](../investigations/hazard-scroll-update-depth-2026-10-31.json), including raw log paths and hashes. The earlier successful production benchmark did not cover these adverse geometry cases; its results are not being used as proof that this regression could not occur.

No update was published and the installed desktop application was not modified. Chrome localhost receives the shared source change; an already-open error overlay may require a page reload. Electron uses the same corrected table code when built from this source.
