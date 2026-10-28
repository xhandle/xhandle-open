# Storage inventory fix — 2026-10-27

Implemented the prompt in `docs/codex-prompts/fix-desktop-storage-crash.md`.

## Changes

- IndexedDB inventory uses readonly `count()` requests. It no longer reads values, stringifies analyses, or creates payload Blobs. Counts include physical records, including internal chunks.
- The Settings inventory visits databases sequentially. Pending opens settle on cancellation and close any late-arriving connections. Count/page transactions abort on cancellation or timeout.
- Tab exit/unmount aborts inventory and page controllers. Refresh cancels the previous scan/listing. Cancelled operations cannot publish late results or reset a newer operation's busy indicator.
- Individual listings use `openKeyCursor()`. They preserve primary keys for selection/deletion, hide internal chunk records, and retain pagination. Names come from already loaded project/repository metadata. Where metadata cannot identify a record, the existing generic category/ordinal label is used; stored payload titles/dates are intentionally no longer fetched merely for display.
- Settings displays the browser's origin-wide storage estimate and quota. Per-database sizes say **Not measured** rather than falsely showing zero or a partial JSON size. LocalStorage string sizes remain approximate. The old payload-size category chart is removed because its totals are no longer available.
- Selective deletion, paired hazard stores, and workspace reconciliation are unchanged. No migration or user-data rewrite is involved.

## Validation

Passed 23 tests across five suites: count lifecycle; key-only page access and chunk hiding; cancellation and timeout; storage summary/project visibility; and cleanup reconciliation preserving unselected projects.

Ran the updated `scripts/diagnostics/investigate-storage-scan.cjs` in a disposable Electron 45.0.0 profile. It now validates the fix rather than reproducing the old serializer behavior. Fixture records include an 8 MiB legacy object, a sparse million-slot array, a 1 MiB typed array, a 1 MiB Blob, 125 small records, and an internal chunk. Value cursors and single-record reads are deliberately disabled during verification. Results:

- Pages: 50 / 50 / 29 logical records, no duplicate keys or internal chunk labels.
- Cancellation rejected the pending page read.
- Deleting one selected fixture record left 129 physical records.
- Count and listing sequence completed in approximately 27 ms; no serializer or analysis value reads were needed.

`npm run build` succeeded with ESLint, Browserslist-age, and bundle-size warnings. `git diff --check` passed.

## Limits and rollout

The original production native crash was not reproduced, so this removes the confirmed inventory allocation hazard without claiming to fix every possible renderer failure. Browser quota estimates and the small workspace-project metadata lookup still depend on browser APIs; stale publications are suppressed when cancelled. No live user profile, saved analysis, or checkpoint was modified. No packaged release was built or published. After release, verify Settings → Storage on the previously affected large workspace, including leaving/re-entering the tab and expanding a category. Safari-specific runtime behavior has not been retested in this change.
