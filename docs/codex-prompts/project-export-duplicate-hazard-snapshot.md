# Oversized project export: duplicate hazard snapshot

## Finding

Read-only inspection of two earlier canceled MANPADS transfer spools found 44.7 MB and 155.3 MB of raw archive output. The larger partial export contained approximately 120.68 MB of hazard chunk records, versus 19.18 MB of generation checkpoints, 9.87 MB of artifact rows and 3.54 MB of architecture parts. These are incomplete prior exports, not a measurement of the user's latest near-1-GB attempt.

Hazard payload tokens showed large `architectureRowsSnapshot` values with repeated embedded source `content` and `originalArchitectureRow`. Archive framing further expands tokenized payloads. Searching all of `src` found the snapshot written by hazard input preparation/runners and retained by normalization, but no reader using the persisted property. Traceability is stored separately. Results, pending attempts and generation checkpoints must remain portable.

## Change

Project exports omit only the top-level redundant `architectureRowsSnapshot` from hazard runs (including legacy local-storage fallbacks). Source databases are unchanged. Generated sheets, traceability maps, partial state, pending attempts and user inputs are retained. Architecture results are still independently exported.

Legacy inline records are shallowly projected before serialization. Already chunked runs are read a page at a time, with original checksums/identities/grammar verified, filtered without hydrating the full run, and repaged with fresh checksums. Unreferenced hazard pages are no longer scanned/copied. Import format and old archive support are unchanged.

## Validation

- 123 tests passed across 14 transfer/hazard-chunk suites.
- Dedicated tests cover inline and chunked projection, exact preservation of other fields, no source mutation, a 1.2 MB redundant source fixture exporting below 10 KB, and rejection of corruption inside the omitted snapshot.
- Download/import checks passed in installed Chrome, Electron 45, and Playwright WebKit using an additional 2.6 MB redundant-snapshot fixture. Partial hazards, architecture, requirements, and continuation state survived import; the duplicate snapshot did not. These use disposable profiles and synthetic fixtures, not the user's actual project.
- Targeted ESLint and whitespace checks passed.

## Limits

This removes a measured source of bloat; it is not a promise that every project fits in a few MB. Required analysis evidence and continuation data may still be substantial. A complete export of the user's MANPADS project with this change has not been measured. Installed Safari automation remains unavailable; Playwright WebKit is not installed Safari. No desktop release has been published by this change.
