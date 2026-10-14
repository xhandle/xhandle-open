# Compact hazard latency fixes

Implemented from `compact-hazard-wiring-audit.md` on 2026-10-13 using
`docs/codex-prompts/fix-compact-hazard-latency.md`.

## Changes

- `fastHazardPipeline.js`: budget the actual deduplicated prompt including shared
  organization/context/instructions. Keep a 32-assessment output ceiling and three
  workers. Evidence is never silently truncated; an indivisible oversized single
  assessment is still sent intact rather than dropping its evidence.
- Build batches as workers request them. Malformed/truncated responses or widespread
  validation failures lower the row ceiling for subsequent work and recursive retries.
  Retain validated rows and retry only missing/invalid rows, with bounded singleton
  retries. Transport errors do not trigger a splitting storm.
- Show request starts, explicit retry reasons and five-second waiting updates.
  Percentages advance with accepted/reused rows, not elapsed time. The runner still
  reserves 100% for successful final persistence.
- `codeHazardGenerationCheckpoint.js`: bulk reads (128 rows per pipeline group),
  transactional writes per accepted batch, cached digests shared between lookup and
  write. Hashes are computed before opening transactions to avoid inactive IndexedDB
  transactions. Existing key format is preserved: prior checkpoints remain reusable.
  Legacy individual read/write callers continue to work.
- `App.js`: keep `error.recoveryRun` when final persistence fails instead of restoring
  the previous run over completed in-memory results.
- `CodeArchitectureHazardPanel.js`: identify unsaved results and direct users to the
  existing CSV export and Continue actions. Checkpoints support retrying final save.

Method reasoning, organization calibration, reviewed applicability, requested default
columns and software-requirement outputs are unchanged. Historical and supporting
columns remain available; their presence was not a pipeline dispatch bug.

## Verification

245 tests passed in 22 suites, covering compact and retained legacy runners, table
defaults, CSV imports, governed decisions and downstream requirement derivation.
Added/updated regression tests reproduce and verify:

- Shared 12,000-character evidence across 32 assessments: **one request instead of 16**.
- Eight assessments where multi-row responses truncate: **11 requests instead of 15**.
- Shared profile text included in prompt budgeting with complete evidence coverage.
- Visible retry/wait updates without fabricated progress; heartbeat cleanup.
- Actual fake-IndexedDB bulk/individual checkpoint compatibility, reload, project
  isolation and cancellation without overwriting saved data.

These request counts use deterministic mock responses, not live-provider performance.
Large independent evidence, provider latency/rate limits, multiple operational
contexts, and repeated invalid responses can still extend a run. Existing requests
already executing do not automatically acquire this new scheduling logic.

Production build passed with lint/bundle/Browserslist warnings; no new pipeline-module
warnings were reported. `git diff --check` passed. No server restart, active
run cancellation, paid model request, commit or push was performed by this task.
