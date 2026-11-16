# Electron regression results — 2026-11-15

**Result: all 15 suites passed.** This run used macOS arm64, Node 22.23.4 and
Electron 45.0.0 with a fresh production renderer and the private native shell.
No application regression was confirmed by this run. This is the automated
coverage described in the [run guide](electron-regression.md), with the limits
below.

Shared source fingerprint before and after:
`d542ada3200648fdc3e9655f91150b3401935216ef51173752962c7fb26234c6`
(1,171 files; unchanged during the run).

| Check | Result |
| --- | --- |
| Frontend | 4,255 passed; no failures. Four default opt-in tests skipped. |
| Backend/parser/harness | 111 passed; no skips or failures. |
| Archive capacity | 13 passed, including the two opt-in archive checks omitted by the default frontend run. Includes a virtual 520 MiB checksum case and synthetic legacy import/export roundtrip. |
| Native Node | 49 passed. |
| Native Python | 11 passed. |
| Production build and fixture builds | Passed. Existing build warning backlog remains. |
| Native shell smoke | Passed: protocol/preload, API CRUD/streaming/downloads, persistence/reload, isolated profiles, mocked updater, recovery and local diagnostics. |
| Cross-area Electron UI | 14 workflows passed with no renderer exceptions or console errors; includes large code/hazard data, requirements/HTL tables, folder creation, history, search, reports, Safety Case, System Test save/reload and SysML. |
| HARA, Design, derivation, safety inheritance, Collaborator | All passed; includes matrix graph/refresh/history/deletion, architecture aggregation/undo/redo, all three derivation directions, optional saved safety obligations and current-view context across six areas. |
| Worker responsiveness | Passed with 32,000,100 evidence characters, 2,000 relationships and 80 layout nodes. Maximum measured event-loop service gap: 22 ms for each operation. No source evidence was dropped. |

These counts overlap: the capacity suite reruns the checksum file's ordinary
tests as well as enabling its large case. They must not be added together as a
count of unique tests. Two paid live-model hazard evaluations remain unexecuted.

## Findings and fixes

The first baseline exposed stale test assumptions, which were corrected:

- Organization-calibration tests now cover the shared Projects HARA path and
  preserved legacy code-analysis paths independently.
- The installed report-parser VM loader now supports shared CommonJS exports.
- The live graph check verifies a horizontal SVG stroke instead of requiring a
  nonzero rectangular height. The matrix-refresh check expects the one affected
  chain and current allocated-requirements wording.

During harness development, native smoke caught an omitted staged backend entry
file. The staging step was fixed and the entire gate was rerun. Timeout and
interruption cleanup also gained a regression check for detached GUI descendants.
Application business logic was not changed for these test corrections.

## Performance follow-up

The general requirements Table view still mounted **2,101 rows / 42,660 DOM
elements** in the populated fixture. Its filter workflow took about 10.5 seconds
and its history/multiple-view workflow about 10.8 seconds. These timings cover
several actions and are not individual click-latency measurements. The workflows
pass, but row virtualization remains an optimization candidate; this run does not
establish a performance regression against a prior baseline. The separate
8,000-row code hazard check kept mounted rows bounded and passed repeated reentry.

## Evidence and limits

Local detailed report:
[report.md](/private/tmp/xhandle-electron-regression-verified-20261115/report.md)
and [report.json](/private/tmp/xhandle-electron-regression-verified-20261115/report.json).
The reports link suite logs, screenshots, assertions and interaction samples.
Temporary evidence paths may be removed by OS cleanup; this summary preserves the
result and source identity.

AI responses were controlled fixtures. Live provider output quality, remote
authentication/GitHub permissions, Windows/x64 Linux execution, signed installers,
notarization and published auto-update feeds require separate validation. The run
used disposable synthetic workspaces and did not commit, publish or release.
