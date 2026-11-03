# Hazard filter loading — November 3, 2026

The screenshot showed “No matching values” while a remote column-option scan was still running. Read-only inspection of the open Intermediate Safety Function filter subsequently found one loaded option. The confirmed CSV also contains exactly one distinct value in that column across all 27,125 rows. The immediate empty message did not establish missing table data.

## Final scope, following the user's memory constraint

The user preferred to skip an enhancement if it risked memory-related crashes. An initial progressive-results/cache prototype was therefore removed before the preview was opened. **The final fix leaves the existing database scan and option-list size limits unchanged and adds no new data cache or streaming of partial options.**

The dropdown now shows “Loading filter values…” until the existing request completes, and distinguishes an actual empty result from a read error. Errors provide a local Retry control. Source/column/search ownership prevents choices from a different request flashing into the menu; stale completions are ignored. Closing the menu cancels its option request. The existing worker still limits listed choices to 500 and value text to 256 KiB. Over-limit results show their limitation instead of falsely claiming no matching values. Select visible is disabled while the empty list is still loading.

No analysis, import, saved record or table-data retention policy changed. The preexisting pending legacy-reader changes in `pagedHazardRows.js` were preserved; the filter task made no final changes to its option-scan algorithm.

## Validation

- 61 tests passed across eight relevant suites, covering loading/empty/error states, retry, stale/canceled requests, wrong-column isolation, ordinary remote filtering, continuous scrolling, partial-table behavior and adjacent artifact views.
- Production build passed with existing repository warnings. Focused ESLint had no errors and retained the preexisting `filterState` hook-dependency warning. `git diff --check` passed.
- On the real 27,125-row project in local Electron diagnostics.8, the dropdown showed loading immediately, never displayed “No matching values” while loading, and returned its expected single choice after approximately 8.6 seconds. No renderer crash or filter error was observed. The dropdown was left open for inspection; no filter was applied and no records were changed.

The runtime sample recorded aggregate Electron working set peaking around 953 MiB during the existing full-source option read, compared with approximately 477 MiB before opening it. These are process working-set samples, not unique physical-memory accounting or an A/B measurement of the UI change's overhead. Renderer `performance.memory` excludes separate worker heaps. This test does not prove that arbitrary future datasets cannot exhaust memory. The conservative assurance is structural: the final change does not add record retention, extra source scans, or another option cache.

## Preview and artifacts

The updated preview is open as `0.2.14-diagnostics.8`, unpackaged with desktop updates disabled. Project: `/private/tmp/xhandle-hazard-filter-preview/project`; renderer: `/private/tmp/xhandle-hazard-filter-preview-build`; profile remains `/private/tmp/xhandle-csv-confirmed-preview-o6t0i940`. The prior preview was closed only after the helper confirmed no active analysis/import. Installed Desktop data and the preserved original profile remain untouched. No commit, push or release was published.

Logs: `/private/tmp/hazard-filter-conservative-tests.log`, `/private/tmp/hazard-filter-fix-build.log`, `/private/tmp/hazard-filter-conservative-lint.log`, `/private/tmp/hazard-filter-conservative-runtime.log`, `/private/tmp/hazard-filter-preview-open.log`.
