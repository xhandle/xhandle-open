# Project transfer reliability results

Implemented the associated prompt on October 25, 2026.

## Changes

- Storage opens now retry transient failures up to three times, report retries,
  respond immediately to cancellation, and close late connections. Late schema
  upgrades are aborted. A genuinely blocked upgrade reports that separately from
  an unresponsive storage service; persistent failures stop without publishing.
- Read operations have cancellation and timeout handling. Export reads bounded
  pages of keys first and avoids loading unrelated source/architecture payloads
  whose ownership is encoded in those keys.
- Export follows referenced immutable chunks from live records, saved history,
  and incomplete checkpoints. Unreferenced chunks left by previous writes are
  excluded without changing source storage. Missing referenced chunks still fail
  integrity validation.
- Diagram position reads/writes close their connections; architecture and
  transfer connections close when a newer schema requests access.
- Streaming gzip compression, disk upload, and streaming import are wired into
  the UI. Old uncompressed archives remain readable. Progress distinguishes raw
  bytes from compressed bytes. Both installations must support compressed imports.

## Validation

- 117 Jest tests passed across 14 suites: transfer, architecture recovery,
  storage cancellation, and diagram detail traces.
- Three local disk-transfer server tests passed.
- Isolated complete export/download/import checks passed in installed Chrome,
  Playwright WebKit, and Electron 45 using the `xhandle://app` origin. The fixture
  verifies saved architecture, history, requirements, partial hazard evidence,
  continuation checkpoints, export cancellation, UI yielding, and connection
  release. Electron uses a native download with its destination supplied by the
  harness so no save dialog needs manual interaction.
- Production build completed with existing application lint/bundle warnings.
  The changed transfer modules pass targeted ESLint checks.

## Limits and next validation

The specific Safari storage-process stall in the screenshot was not reproduced
against the user's live data. WebKit automation is not an installed Safari test;
the Electron harness is not a newly packaged Desktop release. MANPADS has not
been exported with these changes yet. Restart the old Safari session before
testing to release existing connections. A permanently unresponsive browser
storage service still needs a restart; retries cannot repair it in JavaScript.

All checks use disposable data/profiles. No live project was deleted or modified.
These changes have not been committed, pushed, or published as a Desktop update.
