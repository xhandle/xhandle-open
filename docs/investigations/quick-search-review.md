# Quick-search implementation review — 2026-09-29

Prompt executed: [review-quick-search.md](../codex-prompts/review-quick-search.md).

Scope: current working tree, including the Safari keyboard hardening, not just committed main. This review adds investigation artifacts only. No application fixes, commits, or pushes were performed during the review.

## Verdict

The implementation is not ready for a clean “no bugs found” assessment. Three defects were reproduced in both WebKit and Chromium. The existing tests pass but do not cover these cases. No application data deletion, diagram rearrangement, or storage corruption was observed in the exercised checks.

## Confirmed findings

### 1. P2 — Dropdown options are indexed as though they were current cell values

Location: src/components/quickSearchUtils.js:21–23.
Affected integration example: src/components/RequirementsManager.jsx:4362, where each requirements row contains a status select.

Reproduction: a row contains a select with Approved selected and Rejected as another option. Searching Rejected returns the Approved row in both browser engines.

Cause: cell.textContent includes every option label; appending select.value does not remove unselected options. Textarea default text can likewise coexist with its edited value.

Impact: searching an engineering status can return misleading results, and the preview includes values the row does not have.

Correction: extract static visible cell text separately from controls. Exclude control subtrees from static text, then index current textarea/input values and selected option labels only. Define checkbox/radio handling explicitly rather than indexing their default “on” value.

### 2. P2 — Visibility checks index hidden cells and CSS-invisible rows

Locations: src/components/quickSearchUtils.js:5–7 and :19–23.

Reproduction: place hidden-secret in a td with display:none inside a visible row. It still matches. A whole row with visibility:hidden also matches. Both behaviors reproduced in both engines.

Cause: the visibility guard is applied to tables and rows, not cells/text descendants, and getClientRects does not detect visibility:hidden. textContent ignores CSS visibility.

Impact: results can refer to content the user cannot see. Jumping to a hidden cell cannot reliably reveal or highlight the requested content.

Correction: use visibility-aware cell/text extraction, including computed visibility and hidden ancestors. Preserve horizontally offscreen columns as searchable: offscreen is not the same as hidden. Skip hidden inputs. Do not use viewport intersection as the visibility test.

### 3. P2 — Refining a scrolled result list can leave the active result invisible

Locations: src/components/QuickSearch.js:65–67 and :118.

Reproduction: search Braking with 150 matching rows, scroll the results to the bottom without changing the active result, then refine to Brakin. The active index is still zero, but its row remains above the visible results viewport. Reproduced in both engines.

Cause: scrollIntoView runs only when active changes. Changing the query while active already equals zero does not rerun the effect or reset the list scroll position.

Impact: Enter can activate a result the user cannot see, and the visual list position disagrees with keyboard selection.

Correction: reset the result-list scroll position on query change and ensure the active option is visible whenever the query/result set changes. Restrict scrolling to the results container; avoid scrolling the background page.

## Limitations and follow-up risks (separate from the three confirmed defects)

- The 100-result display cap is explicit in the UI but there is no paging or “load more.” With 150 matches the browser tests saw 100 options. Refinement can often reach additional results, but identical searchable rows beyond the cap cannot be distinguished. Add paging/virtualization or a next-match workflow if complete traversal is required.
- Search covers mounted table rows and diagram elements in the current view. It does not search collapsed/unmounted table groups, other pages/projects, or plain report paragraphs. The global Cmd/Ctrl+F listener replaces native browser Find even when no searchable tables or diagram elements exist (QuickSearch.js:39–52). Provide native-find fallback or explicitly extend coverage for those screens.
- Entries are a snapshot captured when search opens. Background analysis updates can leave stale preview text or detached row targets; activation silently returns for a detached row (quickSearchUtils.js:29). Diagram activation also closes over node objects from collection time. Consider stable result identifiers with re-resolution at activation, and a refresh/stale-result message instead of a background observer.
- aria-modal and Tab wrapping exist, but background DOM is not made inert. Screen-reader behavior with existing stacked dialogs was not verified.
- The original installed-Safari “Script error” was not reproduced. WebKit automation is not the user's Safari installation, extensions, or autofill environment. The previous assertion that event leakage explained the original error is not proven by the available stack.
- A targeted probe of React Flow's Meta-key state did not reproduce a stuck modifier. It is not included as a finding.

## Validation performed

- Full suite: 122 passed suites, 1 skipped; 1,128 passed tests, 2 skipped.
- Existing search tests cover both modifier shortcuts, key-release dismissal/activation, Delete/Backspace event isolation, focus restoration, and a composition guard.
- Existing diagram test verifies search selection/fitting does not change node positions.
- Isolated WebKit and Chromium sessions: search, repeated text deletion, forward Delete, dismissal, and result-list probes. No page errors were recorded during those UI probes.
- No user's real browser profile or stored project data was accessed by automation.
- git diff --check passed.

Synthetic performance fixture: 343 rows × 60 cells, each containing approximately 240 characters, with layout performed before timing.

| Browser | Index scan | Average query (20 runs) |
| --- | ---: | ---: |
| WebKit | 44 ms | 4 ms |
| Chromium | 39 ms | 2 ms |

These are local sample timings, not end-to-end latency or worst-case guarantees. The synchronous scan can briefly block opening, but this fixture did not demonstrate a severe performance regression. No background scanning occurs while search is closed.

## Reproduction

Run the browser diagnostic with an available Playwright installation and browsers, with xHandle's development server running:

    XHANDLE_PLAYWRIGHT_PATH=/path/to/playwright-core \
    XHANDLE_CHROME_PATH=/path/to/chrome \
    node scripts/diagnostics/review-quick-search.cjs

XHANDLE_URL optionally changes the default http://localhost:3000. The script creates isolated browser contexts and synthetic tables; it does not alter application source or user data. It prints measurements and the observed defect conditions.

Prioritize fixing the three confirmed defects, add regression assertions for each, and repeat the browser checks before expanding the feature.
