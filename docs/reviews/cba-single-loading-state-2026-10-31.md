# One loading state per Code-Based Architecture view

The reported hazard screen showed three competing messages: a saved-row loading label, that worker's percentage, and a separate table-layout percentage. Background hazard restoration also placed a loader above unrelated architecture, requirements, design, traceability and remediation views.

Each view now owns its loading presentation. The implementation preserves asynchronous reads, bounded row caches, virtual scrolling and cancellation; it changes how their state is presented.

- The hazard table owns saved-layout preparation and visible-row loading. Its toolbar no longer repeats preparation messages. Row placeholders remain mounted but do not each announce another loading message. Background prefetching does not activate the visible-row loader.
- Known worker progress is displayed once. Unknown progress is indeterminate, with no invented percentage or `aria-valuenow`.
- Draft preparation, storage upgrades and running analyses take precedence over a nested hazard-table loader. Errors, retry controls and upgrade cancellation remain available.
- Requirements and traceability use the table's loading area for storage reads, automatic recovery and row preparation. Terminal read failures stop loading; previously displayed content remains available where appropriate.
- Routine hazard restoration does not appear above unrelated tabs. Actionable restoration failures remain visible. Remediation no longer claims hazard analysis is absent while its saved state is still unknown.

## Validation

- Focused loading checks passed: 53 hazard tests, 25 engineering/traceability tests and 8 shared preparation tests. They exercise real nested components with delayed reads, rather than mocking away the competing loading presentations.
- The combined hazard/assurance run covered 126 suites and 1,023 tests. Of these, 125 suites and 1,020 tests passed immediately; three older assertions in the remaining suite assumed any progressbar meant table preparation. Those assertions now distinguish the single generation indicator from preparation while retaining table-identity, threshold, cancellation and source-change checks. All eight tests in that suite then passed. Logs are in `/tmp/xhandle-single-loading-20261031/regression.log` and `saved-entry-controls-final.log`.
- The production build passed at `/tmp/xhandle-single-loading-20261031/build`. Targeted lint reported no errors; the affected table/panel files retain their existing hook-dependency warnings. `git diff --check` passed.
- The scrolling measurement hooks and bounded row cache are unchanged from the earlier verified scrolling fix.
- Actual production-App checks passed in Chrome and Electron with 15,000 saved hazard rows. Each runtime exercised 11 phases: architecture diagram/table, all four requirements/design views, traceability and its refresh, hazard preparation and scrolling, and remediation. Every observed frame had at most one visible loading indicator, and every ready state had none. The test deliberately observed actual loading frames in the engineering, traceability and hazard cases. Neither runtime reported an error, and the short hazard scrolling check passed.
- The hazard screenshot paused delivery of subsequent real worker messages after 11,400 of 15,000 rows (76%), then released them unchanged. It visibly shows a single working mark and percentage; the ready screenshot shows populated rows with no loading indicator. Fourfold CPU throttling makes brief UI transitions observable; these timings are not performance measurements.

Browser evidence and screenshots are in `/tmp/xhandle-single-loading-20261031/chrome-checked.json` and `electron-checked.json`, with `.hazard-preparing.png` and `.hazard-ready.png` appended for screenshots. The initial Chrome driver's premature refresh-readiness failure is retained separately; it was resolved by waiting for an observed loading state followed by four idle frames, without changing application code.

The [compact verification artifact](../investigations/cba-single-loading-state-2026-10-31.json) records phase results and hashes of the build, harness, logs and screenshots.

Verification uses disposable synthetic data; no customer project or installed desktop application is modified, and no update is published.
