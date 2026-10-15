# Hazard table navigation review

## Verdict
The prior normal-render reproductions now pass: measurement-driven distant navigation, equivalent data updates, resize with a small relative offset, stable-ID deletion, group collapse and explicit dataset changes. Full-model filtering/export behavior and bounded mounting remain covered. Two further confirmed cases prevent a clean sign-off.

## P2 — Initial row links can be lost under the application's StrictMode
- App enables React.StrictMode at src/index.js:39. Development StrictMode replays effect setup/cleanup when a table mounts.
- useHazardRowWindow.js:62 clears pending navigation during cleanup. Its setup/update also captures the current scroll anchor; initial layout setup resets the initial scope.
- CodeArchitectureHazardSummaryTable.js:346-351 has already recorded the request as scheduled, so the replayed effect returns without rescheduling it. Scheduling and completion are not separately tracked.
- Reproduced by mounting the actual table with highlightedRowIndex=999, 1,000 rows and nonzero 400px row measurements. Without StrictMode the target mounts and completion is acknowledged. With StrictMode the target remains unmounted. This affects the localhost development configuration shown by the user; production does not perform this StrictMode effect replay.
- Recommendation: make navigation ownership/lifecycle replay-safe. Canceled setup must permit rescheduling; only successfully positioned requests should be acknowledged as completed. Add an actual-table StrictMode regression test.

## P2 — Shrinking a tall row can lose the viewport anchor
- useHazardRowWindow.js:36 adds the retained relative offset to the new row offset without bounding that relative offset to the new row height.
- Resizing columns invalidates height measurements. A relative offset deep inside a formerly tall row can exceed both its new estimate and eventual height, moving the window past the anchor and unmounting it before it is remeasured.
- Reproduced with 1,000 rows: reveal row 500, scroll 1,500px into a measured 2,000px row, widen the column with a new 400px measured height. Row 500 drops out of the mounted window. The existing resize test uses a 37px relative offset, so it does not exercise this case.
- Recommendation: reconcile/clamp the relative position when height changes and keep the anchor available for measurement through resize. Test shrinking as well as growing rows and offsets near the row end. Preserve ordinary user scrolling.

## Validation and scope
- 645 permanent tests passed across 72 suites.
- Three focused temporary cases: normal-render control passed; StrictMode initial navigation and tall-row shrinking failed their desired-behavior assertions, confirming the findings.
- Probe source retained for this session at /tmp/navigationAuditProbe.test.jsx; temporary source removed from the repository.
- git diff --check passed. No application code changed; only this report and the review prompt were added.
- No additional actionable defect identified in the inspected worker/cache, full-model export/filter, or normal navigation paths. This is not a guarantee of absence of all bugs.
- No live Safari profiling was performed. The previous production build was not repeated for this read-only review.
