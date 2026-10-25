# Disk-backed project transfers

The project export UI sends bounded archive lines to `/api/project-transfer-files` on the local backend. One upload of at most 256 KiB is outstanding at a time. The server writes each upload before acknowledging it; the renderer retains only the current transport buffer. A sequence number, byte count and incremental SHA-256 digest protect finalization. The completed `.xhproject` file downloads directly from disk with Content-Disposition, without fetching a whole Blob into the renderer. Desktop uses its existing authenticated custom-protocol proxy.

Temporary directories and files use mode 0700/0600. The endpoint accepts loopback clients and local origins, uses random capabilities, limits concurrent exports and request bodies, and expires files after 24 hours of inactivity. Cancellation deletes the spool; abandoned files expire, and old directories from prior processes are reclaimed when a new spool is created. Closing the export UI can dispose its download, so save the completed file before closing it. Temporary files contain private project data and are not encrypted.

Hazard database version 5 uses a shared canonical migration for application opens and imports. It repairs missing stores/indexes from earlier versions and backfills run metadata. New large runs use immutable token pages, with the descriptor, metadata, old-generation deletion and staging-lease retirement committed atomically. Readers re-read the descriptor and pages in one readonly IndexedDB transaction, so a replacing writer cannot delete the pages they are reading. Healthy repeated saves retain one committed generation, plus any active staged replacements. Each staged generation has a renewable ten-minute lease; subsequent large saves for the same run reclaim expired or unleased generations left by interrupted saves. Storage can temporarily contain both old and new payloads during a save.

Page checksums, aggregate checksums, ordered token grammar, complete values, binary alignment and root identity are validated before import publication, without constructing the full hazard run. Validation retains container state rather than evidence strings. Run/project deletion removes owned pages and staging leases. Export omits staging leases and obsolete generations.

New exports convert legacy whole hazard records into chunk records without modifying the source. New-format imports write these records incrementally and preserve partial results and continuation state. Architecture and requirement chunk records are transferred without hydration. The archive envelope remains version 2; destinations need this updated hazard schema to import new hazard archives. Older version 1/2 files remain supported.

## Limits

An existing oversized IndexedDB record still requires one whole read before conversion. Legacy archives containing whole records still assemble those records on import. Normal analysis readers still hydrate their selected run; this work does not make the analysis engine itself fully streaming. Export consistency still requires stopping active analyses and closing other xHandle tabs. This change removes the complete export Blob/string allocation from the UI path, but cannot guarantee that every large legacy workspace or analysis will fit available memory.

## Validation

- `node --test server/projectTransferFiles.test.cjs`: ordered writes, download bytes, checksum failure, request bounds, origin checks, expiry, deletion and concurrent-session limits.
- Transfer, hazard storage and graph tests: large partial round trips, bounded sink writes, cancellation cleanup, corrupt/missing chunks, legacy schema reads/imports, deletion and existing consumers.
- `node scripts/diagnostics/check-disk-project-download.cjs`: isolated WebKit download, exact 6.25 MiB file and cleanup. Set `CHECK_BROWSER=chromium` for Chrome. Requires Playwright (`PLAYWRIGHT_MODULE` can specify its module path). Uses a fresh isolated origin and does not access user databases. It also checks repeated 2 MiB run replacement, a concurrent reader snapshot, and cancelled-stage cleanup in real IndexedDB.
- Tested the existing desktop custom-protocol proxy against the new endpoint for upload, finalization and download; a newly packaged desktop release and the user's real largest project still need acceptance testing.
- Follow-up regression coverage verifies legacy schema versions 1–4, repair of an incomplete version-4 database, old archives without metadata rows, concurrent readers, active/expired staging leases, failed publication, and malformed token grammar. The previous defect reproductions now assert correct behavior.
- The follow-up implementation and final check results are recorded in `docs/reviews/disk-backed-project-transfer-fixes-2026-10-25.md`.
