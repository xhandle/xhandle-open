# Quick-search confirmed fixes — 2026-09-29

Executed prompt: [fix-quick-search-review-findings.md](../codex-prompts/fix-quick-search-review-findings.md).
Original findings: [quick-search-review.md](quick-search-review.md).

All three confirmed findings are addressed:
- Search reads current control values and selected option labels, not unselected options or old textarea content. Hidden/password inputs are excluded; checkbox/radio state is represented explicitly.
- Visibility-aware extraction excludes hidden cells and descendants, including CSS visibility:hidden/collapse. Horizontally offscreen cells remain searchable. A per-scan WeakMap avoids duplicate visibility work.
- Query changes reset the list scroll position. Active-result changes adjust only the result list's scrollTop; they cannot scroll the background page through scrollIntoView.

Four added regression tests cover control values, hidden/offscreen content, refining an already-scrolled list with active index zero, and list-local arrow navigation. Existing keyboard and diagram interaction tests continue passing.

Validation:
- Full suite: 1,132 tests passed, 2 skipped; 122 suites passed, 1 skipped.
- Focused search/diagram checks: 34 tests passed.
- ESLint for search files passed (tool emitted the existing Browserslist data-age notice).
- git diff --check passed.
- Isolated WebKit and Chromium browser diagnostic assertions passed: zero unselected-option matches, zero hidden-cell/hidden-row matches, active result visible after refinement, working Backspace/Delete, and no page errors.
- 343 × 60-cell synthetic fixture: scan 60 ms / average query 4 ms in WebKit; scan 67 ms / average query 2 ms in Chromium. Prior review samples were 44/4 and 39/2 ms respectively. Visibility validation adds opening work; there is still no background scan, and query times were comparable in this local sample. These timings are not latency guarantees.

Scope remains the three confirmed defects. The review's other limitations (100 displayed results, current rendered-view coverage, snapshot freshness, native Find fallback, and untested screen-reader/installed-Safari configuration) have not been represented as fixed. No commit or push performed.

## Mac shortcut follow-up

The opening/refocus shortcut now schedules work immediately after keydown rather than waiting for F keyup, which macOS can omit while Command remains held. Enter/Escape actions still use key release, and search continues to isolate Delete/Backspace. Pending shortcut work is cancelled on blur/unmount/close.

Regression coverage now includes missing F keyup, refocusing an existing dialog, and cancellation when the window loses focus. WebKit and Chromium both opened search with Command and F still held, without page errors. Final full suite: 1,134 passed, 2 skipped.
