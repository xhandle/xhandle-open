# Hazard table navigation regression fix

Implemented hazard-tab-navigation-fix-prompt.md.

## Changes
- useHazardRowWindow retains the visible row and relative offset across measurement, same-dataset updates and column resizing. Valid measurements survive updates; stale layout measurements are refreshed.
- Removed anchors fall back to a collapsed parent or nearby surviving row. Explicit dataset changes reset the viewport.
- Raw Analysis Row ID supplies stable identity when row indexes change.
- Reveal requests remain pending through height refinement. Completion callbacks run only when the target is mounted and the measurement pass has settled.
- Quick search uses reveal completion instead of a fixed two-frame delay. Trace navigation acknowledges completion through the same path. Existing worker preparation, bounded DOM mounting and full-data export/filter behavior remain.

## Validation
- 644 tests passed across 72 hazard-analysis, assurance and STPA suites.
- Added an additional stable-ID deletion regression; final focused run passed all 16 table/window tests (645 unique tests validated overall).
- Regressions cover measured 400px rows, distant search and trace links, full export/count model, equivalent data updates, relative offsets during resize, group collapse, anchor removal and dataset changes.
- Production build passed with repository warnings. Targeted ESLint and git diff --check passed.
- No live Safari smoke test or customer-dataset timing was performed. This closes the two reproduced regressions; it is not a guarantee about every possible browser layout or future code change.

No analysis reasoning, generation or storage behavior was changed for this fix. No commit or push performed.
