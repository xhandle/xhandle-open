# Review paged hazard first-view implementation

Review the current uncommitted implementation against the requirement that large saved hazard tables become usable within seconds on a cold first opening without renderer freezes or crashes.

Inspect the actual storage-to-App-to-panel path, including workers, row indexes, legacy upgrades, cancellation, revision checks, memory bounds, all-row filtering/export, absolute row identities, partial results and continuation. Compare existing behavior for trace navigation, stale-result warnings, CSV import/undo, narrative reviews and other tabs. Do not treat a fast storage helper or a passing build as proof of end-to-end performance.

Run relevant hazard and project-transfer regression suites and a production build. Add targeted reproductions for uncovered defects. Distinguish confirmed failures from risks and untested performance. Report findings with severity and file/line references, validation totals, and release readiness. Preserve unrelated edits and customer data. Do not commit, push, publish, or silently fix findings as part of this review.
