# Independent review of disk-transfer fixes — 2026-10-25

## Verdict

No additional actionable regression was reproduced in this review. The three previously reported defects (incomplete legacy hazard schema, accumulation of obsolete generations, and acceptance of invalid chunk token grammar) have passing regression coverage in the current working tree. This is a scoped verification, not proof that every large project or all memory-pressure crashes are resolved.

Reviewed the uncommitted implementation against HEAD `7f88b49`, using `docs/codex-prompts/review-disk-transfer-fixes.md`. No production code changed during this review; two additional regression tests and review documentation were added. Nothing was committed or published.

## Evidence

- Full Jest suite: 2,515 passed, 8 failed, 2 skipped (288 passed suites, 1 failed, 1 skipped). All eight failures remain in `hazardEvalRunner.test.js`, reporting missing FD-1/FD-2 assessments. These match the previously isolated HEAD baseline: `/tmp/xhandle-disk-review-baseline.log`. Current run: `/tmp/xhandle-fresh-review-tests.log`.
- Added independent coverage for cancellation halfway through a chunked import: pages, root, and metadata roll back; unrelated saved results remain byte-for-value equivalent; the imported project is not published.
- Added independent coverage for a fallback migration staging concurrently with a newer save: the newer result survives and abandoned fallback pages/lease are removed.
- Both augmented suites pass: 20 tests, including the two new cases (`/tmp/xhandle-fresh-review-extra.log`). These were run after the full suite; their additions do not change production behavior.
- Local spool server: 3 tests pass, covering byte-exact download, sequence/hash verification, request restrictions, expiration, and concurrent session cap (`/tmp/xhandle-fresh-review-server.log`).
- Real browser diagnostics pass in Playwright WebKit and installed Chrome: each streams and downloads an exact 6.25 MiB file, cleans up, and exercises 129-page storage with three replacement saves, a concurrent snapshot read, and staging cancellation. Logs: `/tmp/xhandle-fresh-review-webkit.log`, `/tmp/xhandle-fresh-review-chrome.log`.
- Status visibility diagnostic passes 30 browser/viewport/state combinations. Status and controls stay outside the scrolling project list; the ready download control is visible. Log: `/tmp/xhandle-fresh-review-layout.log`. This diagnostic uses the existing production CSS build and isolated current modal markup.
- `git diff --check` passes. The previous implementation turn's production build passed; it was not repeated because this review changed only tests and documentation.

## Code paths reviewed

Canonical DB5 migration/backfill, metadata publication, staging leases and reclamation, atomic root replacement, snapshot hydration versus replacement/deletion, canceled save cleanup, import preflight and rollback, streamed hazard grammar validation, spool lifecycle and bounded uploads, and download descriptor disposal.

## Remaining limits and release validation

- Legacy IndexedDB records still require an initial whole-record read. Legacy archive records and analysis readers can still materialize an entire selected run. Disk-backed export removes the whole-file renderer allocation but does not make every application operation bounded in memory.
- Replacing a large run temporarily requires space for both old and staged generations. Expired abandoned staging is reclaimed on a subsequent large save of the same run, not by a global background collector.
- The browser diagnostics use synthetic data, not the user's largest failing project. WebKit automation is not a test of the installed Safari application.
- This review did not build/install a new Electron package or exercise the actual large project's analysis continuation after transfer. Before claiming the original customer case resolved, export that project, import into a separate instance, compare saved and partial results/checkpoints, then verify continuation in the packaged desktop app.
- The full suite is not green because of the eight known baseline hazard evaluation failures. They should be tracked separately rather than described as a clean full-suite result.
