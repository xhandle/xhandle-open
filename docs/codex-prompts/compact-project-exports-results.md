# Compact project export implementation

Implemented `compact-project-exports.md` in the shared application. No source project or supplied export file was modified.

## Changes

- The modal now offers hazard, software requirements, system requirements, subsystem requirements and design checkboxes. Architecture is always included. Defaults include all categories, but only saved data is exported. Unselected category records, associated requirement checkpoints, and hazard databases/fallbacks are excluded before payload reads. Selected partial results and continuation state remain portable.
- Archive version 3 uses compact JSON objects/arrays for ordinary values instead of wrapping every object and array in another typed structure. Large chunk records can be encoded directly within a bounded line budget, avoiding a second layer of tokenization.
- Dates, undefined, special numbers, BigInt, Map, Set and binary values retain explicit escaped envelopes. Binary is base64 instead of decimal byte expansion. Reserved user properties and prototype-sensitive keys roundtrip safely. Decoding reconstructs the original records before checking their stored digests.
- Streaming gzip, bounded uploads, cancellation, progress, checksums and atomic import remain intact. Versions 1 and 2 remain readable; users should update both installations to read new version-3 archives.

## Measured benchmark

The supplied legacy Alpamayo JSON was read into an isolated fake IndexedDB, never a user browser database. Its 48 architecture rows and hazard tables were exported/imported and compared with the source. Original review items were outside the requested scope; the redundant hazard architecture snapshot was already excluded by 0.2.10. No checkpoint data was present in this older file.

| Measurement | Bytes |
| --- | ---: |
| Supplied pretty-printed JSON | 12,033,170 |
| Supplied file gzip (including whitespace) | 853,099 |
| Previous transport, same selected records, raw | 28,064,510 |
| Previous transport, same selected records, gzip | 955,522 |
| Compact transport, raw | 5,543,715 |
| Compact transport, gzip | 382,981 |

The same-record comparison reduces raw transport by about 80% and compressed output by about 60%. The previous-transport comparison re-encodes the same logical records with the old framing algorithm; it is a transport-size benchmark, not a comparison against a different project's export. Random generation IDs can slightly change compressed sizes. The earlier 0.61 MB estimate used minified legacy JSON rather than this table's pretty-printed source.

Run the read-only benchmark with `XHANDLE_EXPORT_BENCHMARK_FILE=/path/to/legacy.json CI=true npm test -- --watchAll=false --runInBand src/features/code-architecture-transfer/projectArchive.benchmark.test.js`. It is skipped in normal test runs.

## Validation and limits

- 124 transfer tests passed, including structured types/reserved keys, malformed envelopes, byte packing, selection exclusions, selected-checkpoint reuse, corruption, cancellation and rollback. The opt-in file benchmark also passed.
- Isolated gzip download/import checks passed in installed Chrome, Electron 45, and Playwright WebKit, preserving partial hazards and selected continuation state. Synthetic fixture output was approximately 7.27 KB in all three runtimes.
- Production build succeeded with existing lint warnings. Targeted ESLint and `git diff --check` passed.
- This does not establish a fixed file-size ceiling or remove necessary evidence/checkpoints. Large partial analyses can still contain substantial required state. Installed Safari and the user's current full project exports require manual validation; Playwright WebKit is a separate runtime.
- No commit, push, or desktop publication was performed for this change.
