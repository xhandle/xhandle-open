# Collaborator project-scoped retrieval

## Report and findings

“Summarize the human percep project” waited at saved-data retrieval despite the regular project containing only 23 functional rows. Requested domains were mapped to index steps before resolving the named project. The functional/requirements domains included unrelated code-architecture stores. Legacy projection maintenance could also repair the entire graph before a scoped answer.

The disposable preview snapshot contained 19,611 graph artifacts and only 1,728 lightweight projections. This made unnecessary broad preparation substantial. An older recorded migration error mentioned memory exhaustion, but that historical error does not prove the current question ran out of memory.

## Changes

- Resolve named project ownership from lightweight catalogs before preparation. Regular-project questions exclude CBA-only domains; CBA and cross-project questions retain applicable domains.
- Carry project scope through the worker, per-domain/root checkpoints, cache coverage, reconciliation, and projection repair. A narrow completed pass cannot claim a broader workspace is indexed.
- Skip foreign known-owner roots before loading their bodies. Retain authoritative sources and other projects' mirrors.
- Reconcile by key and project; skip freshly retained records without cloning their full bodies. Preserve unchanged-root records using their source-store identity.
- Repair missing legacy projections only for requested projects.
- Enumerate published CBA key ranges, seek past internal chunk and processing-cache ranges, and write shared source-file metadata once per root while retaining every edge reference.

## Validation and measurements

Local-only Electron test on a disposable clone of the preview's saved data, with HTTP/HTTPS blocked:

| Query | First local preparation | Repeated preparation | Evidence |
| --- | ---: | ---: | --- |
| Summarize human percep | 823.8 ms | 14.1 ms | Project identity and all 23 functional rows |

These are retrieval measurements, not end-to-end AI response timings. No saved project content was sent to a provider by the probe.

A larger VulnerableApp first-time scoped index still exceeded the 90-second probe deadline during architecture indexing, including after restricting source enumeration and deduplicating file metadata. Therefore this change does **not** establish fast first-time retrieval for all large projects. Further work must remove full project indexing from the foreground question path, or make that initial preparation substantially faster. Do not market this as a complete Collaborator latency fix.

The large-project probe used a hidden Electron window; a repeat with backgroundThrottling disabled also exceeded the deadline. Several aborted runs wrote partial derived mirrors in the disposable clone, so these runs are diagnostic evidence rather than a controlled cold-start before/after benchmark. The real preview and installed app datasets were not changed by those probes.

Regression checks cover scoped cache reuse, different-project requests, later global indexing, changed/deleted sources, unchanged-root retention, skipping foreign bodies and checkpoint/chunk ranges, and retaining every architecture relationship when deduplicating shared file metadata.

Final validation: 262 tests across 17 suites passed; optimized build completed with existing lint warnings; all 13 synthetic full-app journeys passed in both Chrome and Electron (26 total), with no captured runtime errors. The native journeys use a deterministic local provider and do not measure real AI answer latency or independently grade model answer quality.

Updated unpublished preview: `0.2.14-preview.20261105.2`, using the existing development profile. No commit, push, or desktop release was performed.
