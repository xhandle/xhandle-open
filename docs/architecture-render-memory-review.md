# Architecture render memory-fix review

## Verdict
No new actionable regressions found in the reviewed paths. The specific allocation shown in the supplied stack is removed: computeArchitectureSnapshotHash no longer recursively constructs a canonical evidence tree and JSON.stringify of the whole row array. Incremental hashing retains full evidence coverage. This establishes removal of that allocation mechanism, not proof that every possible browser memory failure is eliminated.

## Checks
- Incremental output matches legacy stableValue/JSON.stringify/hash semantics for ordinary serialized evidence: null/undefined normalization, numeric object keys, sorted object keys, control-character escaping, Unicode/surrogates, array ordering, and numeric formatting.
- 500 deterministic nested bounded payloads matched legacy hash output; an additional Unicode/control-character probe passed.
- Existing large shared-evidence test rejects whole-array and large-string stringify and confirms evidence edits change the fingerprint.
- App gates draft generation on the active code architecture safety/hazard view and absence of an existing hazard run. Architecture publication no longer triggers draft construction merely because no hazard run exists. CSV imports still check summary/run identity; draft fingerprint reuse preserves sheet/traceability content in tests.
- A separate workspace fingerprint still runs synchronously when the architecture row-array identity changes. It is now incremental; it can still consume CPU proportional to repeated evidence. No performance guarantee is inferred.
- Root boundary wraps App; ordinary render exceptions have a recovery UI and retry. Saved browser storage is not cleared. Boundary remount is not a guarantee that component-local unsaved state survives, nor can it recover a browser process killed by memory pressure.
- Normal architecture generation still awaits durable publication before exposing rows. No persistence ordering changes were made by the memory patch.

## Validation
638 existing tests plus two temporary audit tests passed: 640 tests across 71 suites. App/entry-point syntax parsed; git diff --check passed. Temporary audit tests removed. Application code unchanged during this review; prompt/report added only.

## Remaining validation
Open the affected saved project in Safari after loading the updated app, confirm the architecture displays, then open hazards and exercise CSV export/import. The user's actual large project and Safari peak memory have not been inspected. Opening hazards still builds expanded draft rows; the fix avoids this on architecture publication but is not a general virtualization or evidence-deduplication rewrite. Keep browser storage intact and do not regenerate solely for this validation.
