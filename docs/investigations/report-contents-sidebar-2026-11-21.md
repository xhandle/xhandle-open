# Reports contents sidebar — 2026-11-21

Added a left Contents sidebar to the Reports area and the Projects Reporting tab, following the Design Management document-view pattern. Design Management and the existing code-architecture report outline are unchanged.

The report and its outline scroll separately. Links retain heading hierarchy, show the active section, move only the document pane and focus their destination without changing the workspace hash route. The outline can be collapsed, expanded or dismissed with Escape. Selecting a saved report version resets the reader and rebuilds the outline; theme-driven renderer updates refresh heading references without resetting reading position.

The outline reads actual rendered headings rather than scanning Markdown text. It therefore agrees with formatted/Setext headings and excludes fenced code. Duplicate headings receive distinct destinations; generated identifiers are scoped to the viewer. Empty outlines have a short explanatory state. A MutationObserver batches content changes and a passive scroll listener batches active-section updates through animation frames.

On narrow report panels the outline defaults to a collapsed rail and opens over the document, preserving reading width. It closes after a section is chosen. Wide panels use a 210-pixel sidebar. Colors follow the existing semantic theme and printing hides navigation; saved report bodies, report generation, snapshots and export content are unchanged.

## Verification

- 19 tests across four suites passed, including nine new report-layout tests and the existing Design document-layout, report viewer and themed image tests. Coverage includes duplicate IDs, heading hierarchy, reader-only scrolling, focus/hash behavior, collapse/Escape, compact layout, active sections, renderer replacement, report switching and empty content. Log: `/private/tmp/xhandle-report-contents-unit-2.log`.
- Focused ESLint and `git diff --check` passed.
- The comprehensive Electron harness's `report-appearance` category now checks the sidebar against a real Markdown report: repeated headings, rich labels, Setext headings, code-block exclusion, navigation/focus, active sections, report switching, collapse, compact windows and print. Existing image appearance/reload/preview checks remain enabled.

Final verification: `/private/tmp/xhandle-report-contents-fixed-20261121/report.json` — **passed (partial selection)**. All three selected categories passed: build, fixtures and report appearance. The report diagnostic passed all six workflows, including the expanded contents check, with no runtime errors. Shared and native source remained stable. Screenshots and detailed evidence: `/var/folders/67/8rby79hs1xq1fvs4f925m8600000gp/T/xhandle-report-appearance-qyltKa/result.json`. The final dark report/contents screenshot was visually reviewed.

The preceding wider run also passed the platform theme workflows, then caught a compact-layout bug in the new report check: taking the outline out of grid flow caused the reader to occupy the narrow rail. Explicitly assigning the reader to column two corrected this; the final check verifies that expanding the compact overlay preserves the document width. The assertion was retained. This was the only product change after the wider appearance check.

Tests used macOS Electron and synthetic profiles, without paid-model calls or private-data. This is selected coverage, not a new full-harness or Linux runtime run. No commit, push or release publication is part of this change.

Final shared fingerprint: `23eb2be067dbd58d21346eb3283ed6d1b822657c2e23009dfc729cd6959712dd`.
