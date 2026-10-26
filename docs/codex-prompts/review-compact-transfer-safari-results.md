# Compact transfer / Safari implementation review

Date: 2026-10-26. Scope: all current uncommitted transfer changes, including category selection, compact v3 transport, local metadata compaction, import callbacks and hazard export callbacks. Production code was not modified during this review.

## Finding

### P2 — Sparse numeric arrays silently become zero-filled arrays

`src/features/code-architecture-transfer/compactArchiveCodec.js:34` selects the byte-array representation using `Array.every`, which skips holes. `Uint8Array.from` then converts those holes to zero. For an array of length 64 with only positions 0 and 63 populated with byte values, the old transport restores undefined at position 1; the new transport restores 0. The archive checksum cannot detect this because the changed representation is what gets hashed. This violates the codec's lossless contract for eligible records. No evidence establishes that the user's MANPADS data contains such arrays.

Reproduced using the saved audit test `review-compact-transfer-safari-audit.test.js.txt`. To rerun, copy it to `src/features/code-architecture-transfer/compactArchiveCodec.review.test.js` and run the focused Jest command. The test fails on current code; it is retained as an audit artifact instead of adding a known failure to the normal test suite.

Recommended correction: require every array position to exist and contain a valid byte before packing, or preserve holes/undefined explicitly. Add regression coverage alongside ordinary dense byte arrays.

## Validated behavior

- Production build completed with warnings; `git diff --check` passed.
- 127 transfer tests passed (one opt-in benchmark skipped).
- 34 adjacent hazard storage/chunk/checkpoint and artifact storage/cancellation tests passed.
- Fresh isolated WebKit, installed Chrome headless, and Electron test profiles completed compressed export/download/import with architecture, partial hazards, software/system/subsystem requirements and design.
- Runtime checks verified continuation state, excluded history/source data, cancellation and connection release.
- WebKit stress traversal completed 10,000 records / 3,600,000 tokens with event-loop progress.
- User independently confirmed all-category MANPADS export now succeeds in installed Safari. Full user-project import into the target instance remains to be verified.

## Limits and remaining risks

No additional confirmed regressions were found in reviewed category selection, hazard filtering/checksums, cancellation, quota-message or callback changes. This is not proof of absence of all defects.

Native crash reports implicate JavaScriptCore generator/optimization frames, without identifying a specific JavaScript function. Removing async-generator chains and the successful user retry support the mitigation; they do not guarantee elimination of native crashes.

Existing large legacy IndexedDB values still require a complete record read, and importing a framed record reconstructs that record before writing it. End-to-end memory is not strictly independent of the largest individual stored value. Ordinary caught import failures roll back, but a browser process crash prevents in-memory rollback and can leave unpublished records. These are existing limitations, not new regressions from this patch.

These changes are not yet published to Desktop. Review artifacts and tests do not constitute a released update.
