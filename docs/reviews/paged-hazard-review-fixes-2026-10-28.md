# Paged hazard review fixes — 2026-10-28

Implemented `docs/codex-prompts/fix-paged-hazard-review-findings.md` against the current working tree. No installed workspace data was changed and nothing was committed, pushed or released.

## Changes

- Exported the resolver and paged deletion functions used by App so production compilation succeeds.
- Versioned the derived row index to v2. An absent published Summary is a valid empty table; incomplete attempts retain their own row coordinates. Existing derived indexes can be rebuilt using the explicit upgrade path without rewriting source data.
- Rejected attempts to save a paged descriptor. Callers must resolve the authoritative run before editing; explicit resolved edits persist. Added revision revalidation between metadata/root reads and coordinate checks for both published and partial rows.
- Restored Functional trace IDs and freshness checks. Bounded context/provenance metadata is available in the descriptor; oversized omitted freshness metadata is handled conservatively as stale.
- Split-view diagram details now search associated hazards in a worker and display bounded pages with original row indices. Opening a table link preserves the absolute target across filter resets. Original full-summary diagrams retain their existing path.
- CSV undo and saved narrative review data are independently addressable by verified token spans. Undo loads only when requested; narrative findings load when the review section opens. Neither is included in the initial row page. Interactive detail reads are capped at 32 MiB of UTF-16 token text; oversized operations fail visibly without changing saved results.
- Filter dropdowns retain at most 500 options, 256 KiB of UTF-16 text in total, and 2,048 characters per value. Longer values remain discoverable through full-row search, with a visible explanation. Page payloads, copy operations and CSV preparation also use text-size bounds.
- Workers terminate on completion/cancellation, including message-cloning errors. Stale responses cannot overwrite a new page. Current-page quick search registration is restored; the panel's search scans all saved rows.
- Preserved streaming CSV download filenames, with an exact-byte server test. Added visible failure-message metadata for a retained incomplete attempt.

## Validation

- Expanded hazard-analysis, transfer and diagram regression run: **103 suites passed, 960 tests passed; 1 suite/test skipped**. `/tmp/paged-fix-final-tests.log`.
- Final focused paged-storage, panel, narrative and review-regression checks: **4 suites, 16 tests passed**. `/tmp/paged-fix-last-targeted.log`.
- Transfer-file server tests: **4 passed**, including streamed CSV filename/content validation. `/tmp/paged-server-tests.log`.
- Production build checked with `npm run build`; log `/tmp/paged-fix-final-build.log`.
- `git diff --check` passed.

The former three characterization tests now assert corrected behavior. Added tests cover bounded long filter options, off-page association queries, invalid partial coordinates, cancellation, Functional trace routing metadata, stale status, lazy undo, and row-focus/filter interaction.

## Disposable Electron panel measurement

Ran `scripts/diagnostics/benchmark-paged-hazard-panel.cjs` with the real SavedHazardPanelLoader, prepared panel, table, and row worker. No replacement of the prepared panel is used. The fixture contains 15,000 twelve-column rows and approximately 32 million evidence/review characters. It is seeded/upgraded, then a fresh renderer opens the saved panel.

Observed:

- Descriptor read: **21.5 ms**.
- First usable table: **186.6 ms**.
- Next page after clicking its button: **115.5 ms**.
- Rendered table rows: **101** (100 data rows plus a group row).
- Maximum measured event-loop interval: **64.4 ms**.
- Observed peak renderer working set: **205,424 KiB** (about 201 MiB).

Log: `/tmp/paged-panel-benchmark.log`. Early diagnostic attempts exposed harness configuration problems (TypeScript resolution, environment definitions, JSX transform, and missing UTF-8 response charset); these were corrected. The final run completed successfully.

## Limits and user validation

This is a synthetic saved-panel benchmark, not a timing guarantee for the complete App or the customer's project. It uses no populated architecture model, a minimal stylesheet, no live analysis, and a development diagnostic bundle. Safari and the packaged Desktop release have not been manually tested in this turn.

An old saved run can still require a one-time explicit index upgrade. Search/association scans may take longer than first-page display because they inspect the complete dataset in a worker. Grouping is per displayed page and is labeled that way; all-row search/export remain available. Large clipboard/interactive edit/detail operations can return an explicit size-limit message rather than allocate without a bound.

Continuation, CSV baseline persistence and new narrative analysis still resolve the complete authoritative run when explicitly requested. These actions retain their existing behavior and are outside the bounded initial-display memory guarantee. This work does not establish that arbitrary-size analyses can never crash. Test the actual large project, tab switching, sleep/reopen and continuation before release.
