# First-view hazard storage

Implemented from `docs/codex-prompts/implement-first-view-hazard-storage.md`.

## Change

Saved chunked runs now include a checksummed index of token ranges needed by the existing table view. The index is generated while serializing the original source, without another full object copy. A cold table read requests at most 16 selected source pages at once, verifies their checksums, and skips root/nested pending-attempt architecture snapshots and narrative-review inputs. All result sheets, partial results, review data, and unrelated similarly named fields remain available. Full APIs and edit/continuation resolution retain the original source data and revision checks.

This replaces dependence on building a disposable cache after a full hydration. New saves have the index immediately. Project archive import prepares it before publishing the imported project; installation-local index metadata is excluded from content-conflict comparisons.

Older chunked results require an explicit one-time storage upgrade. Its UI shows progress and cancellation. A dedicated worker scans bounded batches, validates the full source, and publishes only the index using a generation/digest comparison. Cancellation and failure leave original chunks intact. Switching scopes terminates the worker; focus events do not restart an upgrade. The upgrade does not run an AI analysis.

## Validation

Production build and `git diff --check` passed. Build retains existing bundle-size/Browserslist warnings.

- 85 tests across eight suites: token boundaries (including keys split across pages), cold reads, partial data, index repair, corrupt source rejection, cancelled upgrade/retry, revision conflicts, edit preservation, import/reimport, restoration lifecycle and saved-panel loading.
- 50 additional tests across six suites: table behavior, row virtualization, narrative review, store, preprocessing and screening.
- Disposable Electron diagnostic: `scripts/diagnostics/benchmark-hazard-first-view.cjs`. A new renderer opens an already persisted 15,000-row synthetic table with 32 million execution-evidence characters, without a warmed JavaScript cache. No installed workspace was accessed.
  - 2,042 total pages; 91 indexed pages read.
  - Cold data read: 70.9 ms; first table cells: 1,038.7 ms; 41 rendered rows.
  - Full source read for comparison: 920.2 ms (128 batch requests).
  - Maximum event-loop gap including rendering: 218.9 ms.
  - Peak renderer working set reported across diagnostic: 271,696 KiB.
  - Minimal viewport CSS is supplied to reproduce the existing bounded table container. This is not the entire application or an actual customer dataset.

A second disposable Electron run also exercised the actual upgrade worker against a legacy descriptor before creating a fresh renderer: upgrade succeeded, cold read took 75.6 ms, first table cells 1,017.6 ms, 41 rendered rows, maximum loop gap 207 ms.

## Limits

This is an indexed compact-working-set implementation, not disk-backed row pagination. The complete retained table/result fields are still assembled, and existing full-dataset grouping/filtering/search behavior remains. Extremely large result cells can still consume substantial memory; full-run actions still resolve execution fields. The renderer pause above is measurable and should not be described as zero blocking.

The two-second actual-project first-view target remains unverified. Existing source-format upgrade time is separate from ordinary first-view time and can be lengthy; it is explicit and cancellable. Validate avLocalizationWithOutHDMap after its one-time upgrade, with a fresh application session, and capture load diagnostics plus time to usable table. No guarantee of crash elimination is warranted from synthetic tests. No release or installed-user-data migration was performed.
