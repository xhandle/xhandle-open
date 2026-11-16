# Large hazard-analysis memory and responsiveness fix

The reproduced Projects HARA renderer crash and large-analysis GUI stalls are resolved for the tested workload. All four final-source 31,500-row STPA/HARA cases pass completion, exact data preservation, durable save/reload and the existing two-second maximum renderer-gap limit. All eight recovery cases and the full 17-suite Electron gate pass. No commit, push or release was performed.

The work followed the [Codex fix prompt](../codex-prompts/fix-large-hazard-analysis-memory-and-responsiveness.md). Full measurements, fingerprints and remaining publication steps are in the [readiness report](../testing/pre-release-readiness-2026-11-16.md).

## Evidence and cause

The original 31,500-row Projects HARA run crashed in V8 after its last assessment batch. Its flight log recorded approximately 1.78 GB JS heap and 2.36 GB renderer working set; two real input probes timed out. Committed completion was not verified.

A subsequent production Electron allocation profile of 5,376 Projects HARA rows attributed more than 1.4 GB of cumulative allocation to JSON recovery cloning. This is cumulative allocation, not peak memory. Workbook sheets share rows, but JSON cloning expands aliases and creates a full JSON string as an intermediate. Generation also copied the outer Summary array for every three assessed events. Revision signatures retained another complete JSON representation in each saved head and revision.

Profiler evidence: `/private/tmp/xhandle-hara-allocations-20261116/projects-HARA-256-none/profile-000.json` and `profile-001.json`. The optional `--profile true` diagnostic samples real Electron CPU/allocation stacks. Final acceptance runs without profiling overhead.

Moving storage to a worker removed expensive renderer work, but whole-workbook native messages still caused intermittent 3.6-second renderer tasks. Bounded acknowledged graph transfers fixed those pauses. Separately, Code applicability grouping, prompt-budget planning and evidence preflight ran uninterrupted across 31,500 rows, producing roughly four-second gaps before the first request; cooperative task yields fixed those stalls.

## Changes

- Capture plain recovery snapshots synchronously without copying immutable strings. Preserve aliases, cycles and mutation isolation. Send large values through acknowledged graph chunks with browser task boundaries; partial values are never exposed. Pending recovery replacements retain one-active/one-latest coalescing.
- Keep recovery IndexedDB operations, HARA derived workbook refresh, normalization and revision persistence in one persistent worker. Send only Summary for derived-sheet refresh. Preserve atomic compare-and-set transactions, per-project ordering, bounded pending operations, failure reporting and backup notifications. Failed worker writes are never silently replayed.
- Replace retained full-workbook JSON signatures with bounded SHA-256 Merkle fingerprints. Identical legacy heads migrate without adding a revision; pinned history remains available.
- Remove per-assessment full-sheet array copies and redundant final HARA publication. Share the assessed Summary/HARA table and keep final Projects workbook refresh off the renderer.
- Yield browser tasks during Code applicability/evidence preflight with an eight-millisecond cooperative budget, retaining every row, validation and cancellation checks.
- Add snapshot/graph/worker/storage/fingerprint/yield regression tests and stage worker chunks in isolated Electron tests.
- Bound diagnostic inspector cleanup and shutdown. Fall back to the actual Electron PID when it is not a process-group leader, with hard-kill escalation. The cleanup regression covers this case. Obsolete isolated diagnostics were terminated before final performance checks.

No row truncation, weaker semantic validation, increased renderer heap limit or relaxation of responsiveness thresholds is used.

## Final verification

Shared source fingerprint: `440cbd8898f9e81a14a27fa9de58b7223bc32117b2a927c0383a42ba71b73204` (1,201 files), unchanged through final verification. Production Electron 45.0.0 on macOS arm64, real application engines, isolated IndexedDB and controlled synthetic provider responses.

| Case | Rows preserved | Elapsed including reload | Max renderer gap |
| --- | --- | --- | --- |
| Projects STPA | 31,500 | 56.20 s | 1,773.5 ms |
| Projects HARA | 31,500 | 117.65 s | 1,766.6 ms |
| Code STPA | 31,500 | 195.12 s | 532.6 ms |
| Code HARA | 31,500 | 266.51 s | 1,001.2 ms |

All four pass the two-second renderer-gap and five-second input-timeout gates, exact assessment identities/counts, saved reload and semantic validation, with zero renderer errors, input timeouts or assumption fallback. HARA checks include S/E/C, deterministic ASIL and goal links. Projects HARA also passes 672-row and 5,376-row cases.

All eight 672-row recovery cases pass. Each area/method combination recovers from injected output-limit, malformed-result, missing-row and rate-limit faults. Cancel/reload/resume reuses committed assessments without repeating their identities. The aggregate checks all four distinct large combinations, all eight recovery cases, report status and source fingerprints.

The final 17-suite gate passes: 4,347 frontend tests (483 suites), 122 backend/parser/harness tests, 13 capacity tests, 49 native Node tests and 11 native Python release checks, plus production build, native smoke and all populated cross-area UI suites. Four default frontend skips include two capacity cases run separately and two paid live-model evaluations not executed. Counts overlap. Lint checks 194 changed files with zero errors and 76 warnings; `git diff --check` passes. Diagnostic cleanup has four passing focused Node tests.

Evidence:

- Aggregate: `/private/tmp/xhandle-hazard-final-verification-20261116.json`
- Full gate: `/private/tmp/xhandle-hazard-fix-final-regression-20261116/report.json`
- Projects HARA sizes: `/private/tmp/xhandle-hazard-graph-acceptance-20261116/report.json`
- Projects STPA/recovery: `/private/tmp/xhandle-hazard-final-projects-stpa-20261116/report.json`
- Code methods/recovery: `/private/tmp/xhandle-hazard-final-code-20261116/report.json`
- Projects HARA recovery: `/private/tmp/xhandle-hazard-final-projects-hara-recovery-20261116/report.json`
- Lint: `/private/tmp/xhandle-hazard-final-lint-20261116.json`

Sampled renderer peak JS heap ranges from 1.40 GB to 2.73 GB, excluding worker/native memory. Code durable-save waits remain substantial (112.56 seconds for STPA and 168.92 seconds for HARA here) while input stays responsive. This is evidence for the reproduced workload, not unlimited capacity. Controlled-provider success verifies orchestration/persistence, not arbitrary live-model quality. Signed/notarized packages, Windows/Linux execution and update publication remain separate release checks.

## Preserved earlier candidates

These reports are superseded by final-source acceptance:

- `/private/tmp/xhandle-precommit-large-hara-20261116/report.json`: original OOM/input timeouts; committed completion unverified.
- `/private/tmp/xhandle-hara-worker-stress-20261116/report.json`: first worker candidate saved/reloaded 31,500 HARA rows, but redundant cloning still caused a 24-second gap.
- `/private/tmp/xhandle-hara-worker-profile-20261116/report.json`: clone removal reduced pauses; profiled maximum gap remained 2.7 seconds. CPU/allocation profiles remain beside the report.
- `/private/tmp/xhandle-hazard-acceptance-20261116/report.json`: Projects passed; Code completed/reloaded but failed responsiveness at 3.98/3.66 seconds in preflight. All eight recovery cases passed. The Code yield correction followed.
- `/private/tmp/xhandle-hazard-final-acceptance-20261116/report.json`: additional run exposed intermittent Projects HARA gaps of 3.6 seconds, prompting bounded graph transfers. Its interrupted cases are not final evidence.
- `/private/tmp/xhandle-hazard-fix-regression-20261116/report.json`: earlier 17-suite pass on fingerprint `828d755b8fa4ca8226ae68a381c691096863a8a49d664844c1d16e044f49736a`, before the final graph correction. Use the final gate above.
