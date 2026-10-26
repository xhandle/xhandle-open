# Review of sparse-array export correction

Date: 2026-10-26.

## Findings

No new confirmed production regressions found in the reviewed correction. The earlier sparse-array finding is resolved: packing now checks every own index, so holes no longer pass byte-array eligibility. The ordinary-array fallback restores undefined values, matching the previous transport. This preserves value semantics; it does not preserve the distinction between an array hole and an explicit undefined entry, which the prior transport also did not preserve.

The fix does not change archive versions, decoding, category selection, hazard export callbacks, transactions or cancellation. Dense arrays still use the compact byte representation. Negative zero, explicit undefined, null, out-of-range/fractional values, NaN, Infinity and strings take the ordinary path and survive roundtrip. No source mutation was found.

## Validation

- 145 transfer tests passed; one opt-in benchmark skipped.
- Added packing-threshold tests at 63, 64 and 65 elements and nested non-byte value tests.
- Targeted ESLint and whitespace checks passed; existing Browserslist age notice remains.
- Corrected isolated WebKit, Chrome and Electron compressed export/download/import checks all passed, including sparse/dense array preservation, all categories, cancellation and connection release.
- Runtime fixture expanded to include sparse and dense arrays in a raw saved functional-work record, in addition to all analysis categories, partial hazards and continuation state.

The initial runtime fixture used the application's JSON storage writer, which converts array holes to null before export. Its assertion therefore failed before it could validly assess transfer preservation. The corrected fixture writes a raw structured IndexedDB record and verifies its source value before exporting. This separates the existing JSON-storage semantics from the compact-transfer regression.

## Limits

The earlier successful installed-Safari export and automated checks support the Safari mitigation but cannot guarantee absence of native engine crashes. Largest legacy-record memory and process-crash rollback limitations documented in the prior review remain. Already-created archives containing zero-filled holes cannot recover those original missing values without a fresh export from source. No evidence shows that the user's project contained this edge case.

Production code was not changed during this review. No commit, push or desktop release was performed.
