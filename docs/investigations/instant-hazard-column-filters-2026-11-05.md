# Hazard column dropdown latency — 2026-11-05

Opening a saved-table column dropdown previously started an `options` worker that reconstructed and normalized every saved hazard row. Every column opening and value search repeated that read.

The existing layout pass now collects bounded distinct values for every column. The table reads these synchronously on the opening render, so there is no initial loading flash, extra worker, or scan. Values include offscreen rows and retain the existing whole-source semantics even when the table is filtered. Published and partial tables have separate indices. Generation/revision identity and existing validation govern cache reuse; replacement/import invalidates the old layout and its values.

The collector has a 4 MiB aggregate estimate, fair per-column quotas of at most 64 KiB, at most 500 values per column, and a 2,048-character maximum per value. Estimates include per-value overhead. Values are detached from source strings. Full row bodies remain in the existing bounded viewport cache. The existing 8 MiB/two-entry session layout cache accounts for the new metadata. Collection runs in the existing worker and scan, with no background fan-out.

Lists that exceed their quota explicitly report truncation. Their initial bounded choices still open immediately; searching such a list uses the existing cancellable full-source worker so a late/offscreen value is not falsely reported absent. Exceptionally long values retain the existing interactive safety limit. A universal instant search over arbitrary unbounded narrative values is not claimed.

Validation:

- Seven regression suites, 42 tests passed: normalization, blanks, searches, global options under filters, partial source, source revision changes, cache validation/eviction, selection, cancellation/error handling, viewport memory limits, and a synthetic 27,000-row × 73-column collector stress case.
- Production build passed with existing repository lint warnings. No new hook dependency warning remains.
- Final Electron preview on avLocalizationWithOutHDMap, 26,278 rows: 60 openings across all 13 visible columns, approximately 18–53 ms measured through two animation frames. Zero loading states and zero `options` workers. Matching/nonmatching/cleared searches in Operational Mode were immediate and correct.
- Filter metadata estimate 2,157,294 bytes; combined layout estimate 5,501,308 bytes. Retained JS heap after forced GC increased from 196,473,112 to 196,875,700 bytes across the opening/search exercise (~0.4 MB). Zero runtime errors and zero renderer crashes observed. This is a bounded test, not a guarantee for every workload.

Preview 0.2.14-preview.20261105.9 uses renderer `main.480f0f06.js`, preserves the existing preview profile, and is open for user testing. Diagnostic hooks were removed. No commit, push, or desktop release was performed.
