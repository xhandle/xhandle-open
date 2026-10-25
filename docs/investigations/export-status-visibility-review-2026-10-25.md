# Export status visibility review

Executed prompt: `docs/codex-prompts/review-export-status-visibility.md`.

## Finding

**P2 — The export panel has no viewport height constraint, so its action buttons are clipped in short windows.** `src/App.js:21769` uses an unconstrained centered panel and `src/App.js:21775` gives the list up to 55vh independently of the header/status/download/footer heights. Moving the status and download outside the list fixes their original scrolling problem but increases the total panel height. At 800×450 the ready-state buttons extend to y=481.25; at 390×400 they begin at y=412.5, entirely below the viewport. Both Chromium and WebKit reproduce this. The original status-hidden-in-list defect is fixed, but the panel is not yet robust to short windows.

Recommended correction: constrain the panel to available viewport height using a flex column, make only the project list shrink and scroll (`min-height: 0`), and reserve space for status/download/actions. Include a compact layout for very short windows. Verify both exporting and ready states before release.

## Browser evidence

Ran `scripts/diagnostics/review-export-status-visibility.cjs` using installed Chrome and Playwright WebKit. It extracts the current modal JSX from App.js, renders synthetic project state with React, and loads the current production CSS in an isolated browser page. It does not load user data, run an export, or contact a backend.

20 cases: two engines × five viewport sizes × two states. Viewports: 1280×800, 1024×600, 800×450, 390×844 and 390×400; each with 20 synthetic projects. Status and download were outside the scrolling list and within the viewport in all tested cases. Action buttons fit at the larger sizes but were clipped in both short configurations. Project selection was disabled during export and enabled when ready. The script emits exact geometry and can be rerun after a fix.

## Other validation

- All 66 transfer tests passed in this review, including partial results, cancellation/rollback, progress, conflict checks, archive compatibility and corruption rejection.
- Source review confirms immediate preparation feedback and stage messages before waiting for pending edits/results. Errors share the status region outside the scrolling list.
- git diff --check passed.
- The production build from the preceding implementation turn passed with warnings. No production code was changed during this review, so the build was not repeated. The previously reported eight unrelated full-suite hazard-evaluation failures remain unresolved.

No new serialization or data-preservation regression was detected. Actual large-project export in Safari/Electron is still not verified; browser layout tests do not establish memory stability or the cause of the user's page reload. The finding above remains open. No commit, push or release was performed.
