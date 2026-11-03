# Reliable hazard CSV round trips — November 3, 2026

Prompt: [fix-hazard-csv-roundtrip.md](../codex-prompts/fix-hazard-csv-roundtrip.md).
Original investigation: [hazard-csv-roundtrip-investigation-2026-11-03.md](hazard-csv-roundtrip-investigation-2026-11-03.md).

## Changes

The Code-Based Architecture hazard tab now uses a dedicated worker for CSV validation and saving. It reads 64 KiB Blob slices, decodes quoted/multiline fields across slice boundaries, and stages baseline rows, duplicate tracking and updates in temporary IndexedDB storage. It does not call `file.text()`, create a full imported grid in the renderer, or hydrate the entire saved Summary before importing. The existing 32 MiB interactive `loadSummary` helper remains for compatibility; the new App import and undo paths bypass it entirely.

Baseline matching uses IndexedDB indexes for stable row IDs and interface/context identity. It rejects duplicate imported IDs, ambiguous matches and malformed records before publishing anything. Partial files preserve omitted rows, canonical internal IDs remain unchanged, unknown columns are reported, and existing governed-decision/conflict and derived-resolution rules are reused. Conflict previews are bounded while the total conflict count remains accurate. The older array-based App handler also uses one baseline ID map instead of repeated slice/find scans.

After explicit Apply confirmation, a verified token-stream rewrite produces a new staged hazard generation. Other generated sheets, evidence snapshots, narrative input and unrelated root fields are preserved without materializing their contents. Summary rows and preprocessing are regenerated incrementally. Prior Summary/preprocessing snapshots are retained for undo; undo uses the same worker/storage pipeline rather than loading a giant previous table into memory. Publication checks the authoritative source revision and commits the root/metadata atomically. A save observer cannot invalidate a durable commit.

The worker checks page digests, source grammar and identity, complete source digests, table/source basis and persisted revisions. Real cell edits or concurrent saves invalidate the import; equivalent view/draft copies, including a regenerated unpublished draft ID, remain acceptable when their table and analysis basis match. Cancellation can abort staging/publication; a commit that wins a late cancellation is explicitly reported as saved. Published pages are never removed by a post-commit cleanup failure.

The UI distinguishes reading/validation, awaiting Apply, saving, completion, cancellation and errors. Progress is coalesced, cancellation is available, and success follows durable publication. A small repository-scoped status owner survives the draft-to-paged-view remount, without retaining full row data. Leaving the view retires unfinished work. Hazard generation and cleanup in the same window are blocked while its CSV import owns the scope. The draft banner now explains the import-and-Apply workflow rather than calling a populated file incomplete.

Temporary records are removed using native key-range deletion, avoiding per-record cleanup round trips. Abandoned sessions older than 24 hours are reclaimed on a subsequent import. Existing generation leases protect active staged snapshots. Neither temporary CSV records nor customer fixture contents are added to archive formats or repository artifacts.

## Validation

**198 tests passed across 16 suites** covering the new streaming parser, worker protocol/client lifecycle, persistence/undo, view remounts, existing CSV matching, hazard restoration, page/chunk integrity, archive integration, and the preceding requirements-derivation work. The production renderer build succeeded with existing repository warnings. Focused ESLint reported no errors or warnings in the changed import modules, and `git diff --check` passed.

New checks include:

- BOM, UTF-8, quoted commas/newlines and doubled quotes across one-byte and larger slices.
- Malformed quotes, decoded-row limits, duplicate IDs and ambiguous context matches.
- Draft imports and existing saved-run imports, partial-file preservation, stable IDs, other sheets/evidence and preprocessing preservation.
- Save/reopen and undo, including prior preprocessing and cleanup of all temporary session tables.
- Cancellation during apply, simulated disk-write failure, concurrent-save rejection and equivalent draft refreshes.
- Explicit confirmation, same-scope remount, ownership release and an idle worker failure becoming a visible retryable error.

Logs: `/private/tmp/hazard-csv-final-regressions.log`, `/private/tmp/hazard-csv-production-build.log`, `/private/tmp/hazard-csv-fix-lint.log`.

## Runtime experiments

The generic diagnostic harness is `scripts/diagnostics/stress-hazard-csv-import.cjs`. Supply `XHANDLE_CSV_FILE`, `XHANDLE_CSV_BASELINE` and `XHANDLE_CSV_EXPECTED`, and run with Electron with `ELECTRON_RUN_AS_NODE` unset. It compiles the real worker/store modules, uses a fresh sandboxed Electron profile, and invokes no AI providers. The baseline fixture represents the exported table before external completion; expected samples name cells to check after saving and undo. Customer fixtures remain in temporary directories outside the repository.

| Runtime/workload | Validate/prepare | Apply/save | Full scenario including undo | Sampled peak renderer JS heap |
| --- | ---: | ---: | ---: | ---: |
| Electron, entire supplied CSV: 160,913,412 bytes / 27,125 rows | 41.05 s | 162.76 s | 684.56 s | 264.8 MiB |
| Chrome, 1,000-row actual-file subset: 5,801,499 bytes | 2.35 s | 8.14 s | 22.94 s | 16.7 MiB |
| Electron, final-source 5,000-row subset: 28,526,774 bytes | 7.15 s | 26.33 s | 83.07 s | 54.6 MiB |

The full-file run matched/staged all 27,125 rows, verified the saved row count and completed cells sampled from the beginning/middle/end, exercised undo, then cold-reloaded the page and verified restored data. It recorded no runtime errors or renderer-process failures. The Electron diagnostic enforced a 1,536 MiB V8 heap limit, the same numerical limit under which the old parser failed on this file. Its sampled aggregate process working set peaked around 872 MiB. That is a working-set sample, not a complete physical-footprint measurement, and renderer heap samples do not separately measure worker heaps.

The full-file run preceded the final bulk-cleanup, bulk-reader, basis-guard and progress refinements. A fresh 5,000-row Electron run exercised the final worker implementation, including save, undo and cold reopen. Chrome's 1,000-row run also passed all those checks. These are single diagnostic runs with local fixture inputs, not a latency guarantee or an end-to-end replay of the user's already-open App profile. The harness exercises actual worker/store modules; final App integration is covered by compilation and component/protocol regressions.

Largest sampled renderer event-loop delays were approximately 589 ms for the full case, 6 ms for Chrome's subset and 61 ms for the final Electron subset. Large existing draft snapshots still incur a structured-clone cost when transferred to the worker. These results establish successful bounded-file processing, not zero stalls or unlimited capacity. Large saves still take time and require temporary disk space; oversized individual records and storage-quota failures are reported while prior committed results are retained.

Runtime artifacts: `/private/tmp/xhandle-csv-runtime-RDKQpf`, `/private/tmp/xhandle-csv-chrome-Y8I8hm`, `/private/tmp/xhandle-csv-runtime-D45Kp9`. The optimized production build is `/private/tmp/xhandle-hazard-csv-production-build`.

## Status

The confirmed import defects have local fixes and regression coverage. The original file, installed app, current preview profile and existing user project data were not modified. No commits, pushes, private desktop source changes, version bumps or update publication occurred. The currently open preview still uses its earlier renderer build until explicitly relaunched with this build.
