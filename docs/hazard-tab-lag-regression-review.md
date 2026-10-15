# Hazard tab lag regression review

## Verdict
The original synchronous draft builder has moved out of React rendering into a worker, a current-input cache survives tab switches, and hazard table DOM mounting is viewport-bounded. These address the identified bottlenecks. Two confirmed scrolling/navigation regressions remain, so the change is not yet fully cleared.

## Findings

### P2: Distant row navigation can lose its target after height measurement
- `useHazardRowWindow.js:26-41` scrolls to estimated offsets, then revises offsets after measuring newly mounted rows without retaining the requested target or correcting scroll position.
- `CodeArchitectureHazardSummaryTable.js:341` considers the reveal request handled immediately. It will not reveal that target again after measurements change its offset.
- `quickSearchUtils.js:36-37` also performs a single reveal and a fixed two-frame wait. If the target is no longer mounted, its jump silently returns.
- Reproduction: 1,000 short estimated rows, viewport 800px, mocked measured row heights 400px. Reveal row 999; following measurement/re-render, row 999 is absent from the mounted window. This also reproduced with 2,000px rows. Unlike the existing distant-row test, these probes supply nonzero layout measurements.
- Impact: a trace link or quick-search selection may fail to reach a long/wrapped row. This is a navigation regression, not loss of stored analysis.
- Fix direction: retain a pending target through measurement, adjust offsets until mounted and positioned, and acknowledge only after successful focus. Prefer mount/measurement acknowledgment over fixed frame counts. Preserve viewport anchors during ordinary height refinement.

### P2: Every data/layout revision resets the reader to the top
- `useHazardRowWindow.js:10` clears all measurements and sets scrollTop=0 whenever entries change.
- Entries depend on groups, collapse state, visible columns and widths. App publishes partial runs at `App.js:14550`, and the panel derives a fresh sheet from the run object at `CodeArchitectureHazardPanel.js:96`. A user inspecting lower rows during generation therefore jumps back on updates. Collapsing a lower group or resizing columns also triggers the reset.
- Reproduction: reveal row 500 in a 1,000-row fixture, then supply an equivalent fresh group array. Scroll position changes from greater than 10,000px to zero.
- Fix direction: distinguish new dataset/filter navigation from updates to the same dataset. Preserve a stable row anchor and relative offset, retaining valid measurements. Reconcile deleted/filtered anchors explicitly rather than globally resetting on object identity.

## Checks and scope
- 640 permanent tests passed across 71 suites (hazard analysis, assurance and STPA).
- Two temporary focused probes confirmed the findings, including a rerun with 400px measured rows. Probe assertions deliberately confirm the defects; their passing does not mean those behaviors are correct. Temporary source removed; probe retained at `/tmp/tabLagAuditProbe.test.jsx` for this session.
- `git diff --check` passed.
- Reviewed worker creation, current-input caching, stale response protection, cleanup/error/retry, full-model export/filter/search and collapse/link integration. No additional actionable defect identified in those inspected paths.
- No application implementation changed during this review. Prompt and report added only.
- Production build passed during implementation; not repeated for this read-only review. No live Safari profiling or access to the user's large architecture occurred. Worker message cloning, main-thread normalization/grouping and height estimates still have input-dependent costs; actual tab latency is not established by jsdom tests.
