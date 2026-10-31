# Continuous saved hazard table scrolling — 2026-10-31

Executed [the implementation prompt](../codex-prompts/implement-continuous-hazard-scrolling-2026-10-31.md) in the shared browser/Electron application. Existing unrelated changes were preserved. No customer data, installed application, release, or repository publication was changed.

## Behavior and implementation

Saved hazard results previously exposed one storage page at a time: at most 100 rows, sometimes fewer at the byte limit. The table virtualized only that page, so users needed Previous/Next rows to continue.

The table now represents the complete matching result set with one scroll range. A worker builds the group order and absolute source-row coordinates. Row contents load automatically near the viewport, with actual visible rows taking priority over nearby prefetch. Distant scrollbar jumps and reverse scrolling use the same path; no page buttons remain. The shared implementation is used by Chrome and Electron.

- Mounted rows remain limited to the viewport and overscan. A prefix-sum height index supports variable heights and distant jumps without scanning every row on each scroll frame. Logical row anchors preserve position through measurements, column changes and collapse; the scrollbar remains at the end when final-row heights settle.
- Row contents use a cache capped at 400 rows and a conservative 16 MiB retained-data estimate, with at most two concurrent viewport read workers. Short storage responses advance by their actual returned row count. Obsolete work is cancelled, and old scope completions cannot populate the new table. Prefetch stops at the byte budget rather than cycling through load/evict/refetch.
- Group identities hash the complete normalized identity; group labels are limited to 512 characters. Full result cells remain unchanged. The active outline has a conservative 32 MiB limit, including headers, group descriptions and numeric coordinates. The current workspace may retain one outline of up to 8 MiB for reuse on tab reentry; generation/revision changes retire it. It contains no result cells or evidence snapshots.
- Search, column filters and operational contexts still query all saved rows. Export/copy still visit the complete matching data; CSV editing still resolves the complete published Summary under its existing limit. Review content is normalized/indexed once per review revision, and cache fills compare only loaded rows. Partial results remain isolated from published review/edit/undo actions.
- Stable absolute source indices drive selection, deletion, focus and trace links. Retry refreshes the saved descriptor, including when another operation changed the stored revision. Unusually large required rows and oversized outlines produce explicit errors rather than silent empty results or unbounded memory growth.

## Regression checks

- Broad hazard, project-hazard and transfer suites: 148 passed, one skipped; 1,385 tests passed and two skipped. This includes the existing large-export checksum coverage. Log: `/tmp/xhandle-hazard-scroll-20261031/regression-tests.log`.
- Final hazard suite after the substantive changes: 95 suites / 841 tests passed. Log: `/tmp/xhandle-hazard-scroll-20261031/final-hazard-tests.log`.
- Focused follow-up coverage checks source-revision cache retirement, descriptor refresh on retry, exact/newest review matching, no repeated review normalization during scrolling, variable-height bottom pinning, bounded group strings and row-cache budget handling. Counts overlap the broader suites and are not additive.
- Production build passed. Targeted runtime lint has zero errors and two pre-existing table hook warnings; `git diff --check` passed. The repository also reports its existing Browserslist age notice.

The production artifact is `/tmp/xhandle-hazard-scroll-20261031/final-build`; its asset-manifest SHA-256 is `c4e34a96a316d95603cd33b3588a947e2649dbc1f9a835b4c2ed09cdb7e5d96c`. Source hashes and the one trailing-blank-line cleanup during the build are recorded beside it.

## Runtime measurements

The [checked measurement summary](../investigations/continuous-hazard-scrolling-2026-10-31.json) records final runs of the production App, real IndexedDB data and row workers in disposable profiles. The fixture has 15,000 hazard rows, groups spanning storage boundaries, two operational contexts, variable-height rows and wide hidden cells that force shortened reads. Hardware: Apple M2, 8 GiB RAM, arm64, DPR 2.

| Measurement | Chrome | Electron |
| --- | ---: | ---: |
| First usable table | 1,741 ms | 2,567 ms |
| Active wheel p95, six forward/reverse samples | 16.8–17.0 ms | 17.6–17.7 ms |
| Largest active-input frame | 17.8 ms | 17.8 ms |
| Visible loading-placeholder / empty frames during measured scrolling | 0 / 0 | 0 / 0 |
| Uncached far-jump settling | 166–299 ms | 151–318 ms |
| Largest observed mounted table body | 24 rows | 23 rows |
| Largest observed row cache | 400 rows / 6,269,914 bytes | 400 rows / 6,269,902 bytes |
| Retained JS heap growth across five equivalent tab reentries | 628,064 bytes | 508,254 bytes |

The final saved row (source index 14,999) became visible at the scrollbar end without additional wheel inputs. Full-result search found and selected that row; context filtering retained the correct absolute source IDs. Genuine byte-limited reads, navigation cancellation and repeated tab reentry passed. DOM nodes and event listener counts stayed exactly constant at equivalent reentry states; there were no remaining row workers or browser errors. The modest heap growth is reported rather than described as a proof of zero leaks.

Actual inner viewports were 1440×920 in Chrome and 1440×804 in Electron. These are checks of each runtime on the same build/fixture/scenario, not a controlled ranking of browser speeds. Frame timings include the diagnostic's bounded checks for visible loading placeholders. External focus requests and editing/review behavior have regression-test coverage; this runtime scenario directly exercises scrolling, search selection, context filtering and cancellation.

## Limits

The first outline still scans the saved Summary in a worker; its startup cost is separate from scrolling performance. Reentry can reuse the current unchanged outline. Uncached distant jumps still require storage reads. These changes do not imply that arbitrary-size cells or datasets can be rendered without delay.

The runtime fixture is synthetic, not the customer's 634 MB project. Electron measurements exercise the production shared App in a disposable Electron renderer; they are not a packaged installer, updater or native-backend parity test. The existing interactive Electron preview continues to use its previous build until an updated preview is launched. No desktop update was published.
