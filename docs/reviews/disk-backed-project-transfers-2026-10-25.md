# Disk-backed project transfer review — 2026-10-25

Follow-up: the findings below were addressed in `disk-backed-project-transfer-fixes-2026-10-25.md`. This document preserves the original review evidence.

Scope: uncommitted implementation relative to HEAD 7f88b49. Executed `docs/codex-prompts/review-disk-backed-project-transfers.md`. Production code was not modified during this review. Added explicit defect-reproduction tests; their assertions describe current broken behavior and must be replaced with desired-behavior assertions when fixes land.

## Findings

### P1 — Legacy hazard imports can publish an unusable database

Locations: `src/features/code-architecture-transfer/projectArchive.js:219` and `:349`.

Export unconditionally labels hazard schemas version 4 but only adds the chunk store to the source schema. Import also creates old hazard schemas at version 4 while adding only that store. A version-1 database without `runMetadata` or `generationCheckpoints` is therefore imported at version 4 without those stores. The normal opener already requests version 4, so its upgrade callback never repairs the missing stores. Import reports success and publishes the project; `getLatestCodeArchitectureHazardRun` then fails with a missing-store error. This can affect later hazard operations in that destination database, not just the imported project.

Reproduced by seeding a version-1 run store, exporting, importing into empty storage, and reading the latest run. Compared with unchanged HEAD in an isolated snapshot: the same legacy round trip succeeds there because the normal opener can upgrade the imported database.

Fix: use the application's complete canonical schema/migration logic when initializing an imported database, including metadata population from imported roots; validate required stores before publishing. Cover both newly exported legacy databases and previously created old archives, with existing and empty destinations.

### P2 — Repeated saves grow stored payloads without a bound

Locations: `src/features/code-architecture-hazard-analysis/hazardRunChunks.js:17` and `codeArchitectureHazardStore.js:192`.

Each save generates a random generation and writes every page again. Publishing replaces the root but never reclaims successful previous generations. Three identical 200 KB saves retained three full page sets and one root. This is documented as intentional protection for concurrent readers, but changes replacement-save storage from roughly one payload to one payload per save. Large runs edited or resumed repeatedly can exhaust storage and prevent saving despite no increase in logical project size. Excluding old generations from export does not reclaim source storage.

Fix: implement coordinated reclamation or reusable content-addressed pages with a safe reader/reference protocol. Do not simply delete the old generation immediately while a reader may still use it. Test repeated edits, interrupted staging, concurrency, quota failure and recovery.

### P2 — Chunk checksums do not validate reconstructability before publication

Location: `src/features/code-architecture-transfer/hazardChunkIntegrity.js:12`.

The checker validates page identity and digests but never validates the encoded token grammar or the reconstructed run's identity. A page containing `['unknown-token']` with correct page/aggregate/archive hashes passes both export and import. Import publishes the project successfully; opening the run subsequently throws `Invalid streamed project record`. Hashes detect altered bytes, not whether the payload is a valid run. The previous outer record assembler validates token grammar; the nested hazard pages now bypass that safeguard until application read time.

Fix: validate the nested token stream incrementally before publication without assembling the whole run. Check balanced containers, valid tokens, complete values and root identity. Add checksummed malformed/truncated/identity-mismatched payload tests that prove no project is published.

## Confirmed improvements and checks

- The UI passes a disk sink to export. It awaits bounded writes and uses the completed download URL rather than constructing a complete renderer Blob.
- Real isolated WebKit and Chrome checks each streamed and downloaded an exact 6.25 MiB file, then cleaned up.
- All three server tests passed: sequencing and exact output; size/origin/integrity/expiry rejection; concurrent session cap.
- Export status, controls and save link remained visible in all 30 browser/state/viewport layout checks.
- Full suite: 2,494 passed, 8 failed, 2 skipped. The passing count includes three explicit defect reproductions; those are evidence of defects, not proof they are fixed.
- All eight failures are in `hazardEvalRunner.test.js`, for missing FD-1/FD-2 assessments. Re-running that suite against unchanged HEAD reproduced the same eight failures (11 tests passed).
- Existing large partial-result round-trip and continuation-data tests pass for supported current schemas.
- `git diff --check` passed. No production changes since the successful production build in the implementation turn.

## Limits and recommendation

Do not release this as a complete resolution yet. Fix the three findings first, especially the legacy schema initialization defect and repeated-save storage growth. The user's actual largest project has not been exercised, and no newly packaged desktop acceptance test was run in this review. The browser download checks are synthetic and are not Safari memory profiling. Legacy whole IndexedDB values still need an initial full read; legacy whole-record archives and normal analysis readers still hydrate entire values. Therefore this review confirms removal of the final whole-export renderer allocation, not elimination of every crash or memory-pressure path.
