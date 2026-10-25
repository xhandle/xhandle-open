# Large project export: Invalid string length

The desktop screenshot reports `Invalid string length` while exporting a 4,792-row project with incomplete hazard analysis. No stack trace or copy of that project's database was available, so the specific failing record has not been identified.

The exporter avoided a whole-workspace JSON string but still encoded and stringified every entire database record. A hazard run can itself be a very large record. Binary encoding also expanded each entire value into a number array. Import conflict checks repeated the whole-record stringification.

The fix introduces version 2 archives. Small entries retain the existing encoding. Large entries are represented by bounded structured-value tokens across multiple physical lines, with checksum coverage of every frame. Binary values are read in slices. Import reconstructs one record at a time and applies existing ownership, schema, chunk integrity, conflict and rollback checks. Conflict comparisons now hash bounded tokens. Version 1 imports remain supported; older installations cannot import version 2 exports and must be updated first.

## Validation

- 55 transfer tests pass across six suites.
- Regression test injects a 128 KiB stringify limit, demonstrates whole-record failure, then successfully exports/imports a large partial hazard run without losing its summary/status. The same test covers identical destination reuse and conflicting destination rejection.
- Additional cases cover cancellation, truncated framed archives, legacy v1 imports, escaped text and Unicode split across token boundaries, binary values, maps/sets, and reserved property names.
- Full suite: 2,469 passed, 8 failed, 2 skipped. All eight failures are in hazardEvalRunner.test.js and reproduce on an isolated unchanged HEAD checkout (11 passed, 8 failed in that suite). They are not fixed by this export change.
- Production build passes with lint and stale Browserslist warnings; no warnings reference the changed transfer files.

## Remaining validation and limits

This is a local fix, not a published desktop update. The user's actual project still needs export/import testing in the packaged desktop build. The tests use modest records plus a fault-injected string limit rather than allocating a string at V8's real maximum.

This removes whole-record JSON string construction, not all memory usage: IndexedDB still returns a complete source record, import still reconstructs a complete record, and the downloadable Blob still contains the complete archive. Export does not delete the source project or its partial results. Native streaming to disk and incremental database record storage would be separate improvements for still larger datasets.
