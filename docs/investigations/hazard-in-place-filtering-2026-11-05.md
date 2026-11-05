# Hazard filtering in place — 2026-11-05

The previous dropdown improvement prepared option labels but not row membership. Selecting a checkbox still started a full saved-row layout scan, cleared the layout, and discarded the viewport cache through its query identity. This caused the entire table to show preparation again.

The existing worker layout pass now also prepares a compact nine-bit value code for each row/column, independently capped at 4 MiB. It contains membership codes, not duplicate row bodies. Selecting prepared values filters numeric source indices and group membership synchronously, with OR within a column and AND across columns. The unfiltered baseline is retained for clearing or changing filters. The viewport cache belongs to the saved source revision rather than each filter query and retains its 400-row/16-MiB limits.

The table and dropdown remain mounted during filtering. Counts show the matching rows and full published/partial source total, including while viewport rows are being fetched: for example, `3,754 of 26,278 rows match filters`. Counts refer to analysis rows, not group headings or just the rendered viewport.

For inputs exceeding the membership budget or searched values outside the bounded option lists, the existing cancellable worker remains the fallback. It preserves the displayed table while updating filters, and copy/export waits for the current query. This fallback can still take time; it does not claim universal constant-time filtering for unbounded datasets. Search/context/source changes retain their own preparation path, and revision changes invalidate cached bodies and membership. No background indexing was added.

Validation:

- 49 tests across seven suites passed, including packed codes across byte boundaries, normalized blanks, truncated-value fallback, combined filters, context/search equivalence with saved-source queries, offscreen source indices, copied results, rapid obsolete requests, source revision changes, count display, and existing viewport memory bounds. A synthetic 27,000-row × 73-column case checks metadata limits.
- Production build succeeded with existing repository warnings; `git diff --check` passed.
- Electron preview, avLocalizationWithOutHDMap, 26,278 rows: two runs of 80 actual checkbox/clear changes, plus combined-column checks. All kept the same table and dropdown DOM, with correct counts. Zero layout/options workers after baseline preparation, zero whole-table loading observations, zero runtime errors and zero renderer crashes. Measurements include two animation frames; see the accompanying JSON for medians and maxima.
- First run retained JS heap after forced GC rose from 195,211,424 to 199,946,904 bytes, including initial viewport filling. The repeated run rose from 199,946,772 to 200,375,124 bytes (~0.4 MB). Sampled peak JS heap stayed below 495 MB. This bounded workload test does not establish a universal no-crash guarantee.
- Combined baseline metadata estimate is 7,659,407 bytes, including 4,315,393 bytes of option and membership metadata, within the existing 8 MiB layout-cache entry limit. No table bodies were added to that cache.

Preview `0.2.14-preview.20261105.10`, renderer `main.6f9bcfa7.js`, is open using the existing disposable profile. Diagnostic interception was removed after testing. No commit, push, or desktop update was published.
