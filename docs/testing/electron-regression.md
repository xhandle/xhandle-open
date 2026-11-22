# Electron regression gate

Run the current shared working tree in the real desktop shell, with a freshly
built production renderer and disposable synthetic workspaces. This gate combines
the existing frontend/backend/native tests with browser-driven Electron checks.
It does not use the installed application's profile or an external project.

## Run

Prerequisites: Node 22+, Python 3, installed shared dependencies, a local private
`xhandle-desktop` checkout with its native dependencies installed, and
`playwright-core`. The private desktop source stays in that repository. Supply
Playwright from a separate tooling directory if it is not available locally.

```sh
npm run test:electron:regression -- \
  --desktop ../xhandle-desktop \
  --playwright /absolute/path/to/node_modules/playwright-core
```

On this development Mac, use Node 22 explicitly if the default shell uses Node 20:

```sh
/opt/homebrew/opt/node@22/bin/node scripts/diagnostics/run-electron-regression.cjs \
  --desktop /Users/Nick/xhandle-desktop \
  --playwright /private/tmp/xhandle-gui-audit-tools/node_modules/playwright-core
```

The runner prints its report directory immediately and a heartbeat during long
suites. `report.md` and `report.json` update after each suite. Logs, Jest JSON,
screenshots, interaction assertions, production build and disposable profiles are
retained beneath or linked from that directory. An optional `--out` must name a
new directory; prior reports are never overwritten. Keep these generated files
outside source control. Delete the temporary directories after review if no
longer needed.

Use `--only frontend,backend` or another comma-separated suite selection for
diagnosis. Live selections automatically build/stage the app and fixture scripts.
A partial run is explicitly labelled partial. Use the default full run for the
pre-commit regression gate. `--electron /absolute/path/to/executable` overrides
the executable resolved from the desktop checkout.

## Coverage

| Suite | Assertions |
| --- | --- |
| `frontend` | All discovered CRA/Jest unit, component and integration tests, including storage, requirements, HARA/STPA, optional hazard-derived safety inheritance, artifact generation/recovery, traceability, table controls and Collaborator. |
| `backend` | All server Node tests and installed-parser/diagnostic helper tests; routing, streaming, provider normalization and response parsing. |
| `stpa` | Rapid offline code-based STPA harness: actual screening/generation with controlled responses across four domains and all four UCA categories; exclusions, artifact validation, correction targeting, 320-row throughput/cache/resume, pending-evidence retry, delayed checkpoint writes, provider failures, cancellation, evidence integrity, trace links, context imports, compact table/copy identity and HARA/FHA compatibility. Checks compact responses through final publication. Network access is blocked. This suite needs no production build. |
| `capacity` | Legacy archive roundtrip/compression with synthetic input; standard/legacy checksum compatibility over a virtual 520 MiB body. Explicitly enables the two normally opt-in capacity tests. |
| `native-node`, `native-python` | Native security, recovery, staging, updater and release-validator tests from the private desktop checkout. |
| `build`, `fixtures` | Fresh production renderer, staged native/backend runtime, source fingerprints and reproducible synthetic fixtures. |
| `shell` | Native desktop smoke: protocol/preload, loopback backend, SQLite/auth state, persisted reload, workers, recovery and mocked update IPC. |
| `workspace` | Populated Projects diagrams; five code-architecture abstraction levels; code requirements/design/traceability tabs; repeated navigation through 8,000 hazard rows with bounded mounted rows; Design folder creation/reload, column multiselects, history, Outline/Table/Traceability/Document views, HTL assessment expansion/resizing, global search; SysML model/table/text/validation/reload; report content, Safety Case interaction, System Test edit/save/reload, Settings/help/activities. |
| `theme` | Populated dark screens across Projects, Code-Based Architecture, Design Management, Reports, Safety Case, System Test, SysML and Collaborator; dialogs, field values/placeholders, measured visible text contrast, unexpected bright panels, saturated blue/purple action fills and screenshots. Exercises light/dark/device settings, OS changes, native synchronization, storage events, reload, keyboard focus and custom node/edge paint. Deliberate unreadable white-panel and saturated-action probes verify the audit detects regressions. SVG/canvas/image/gradient content also requires visual review. |
| `hara` | Real HARA UI pipeline with controlled AI: shared STPA mechanics, visible Operational Mode and Operating Conditions columns, no Item definition text box, explicit output budgets, automatic recovery from truncated row/batch responses in Generate row and Develop risk profile, deterministic ASIL/rating edits, workbook export/reload (including saved item definitions), legacy method preservation and no new CBA FHA selection. Code HARA uses the production sheet builder and real saved/paged table to check every Projects HARA field, searchable multiselect FTTI filtering, CSV export, reload and blank missing fields in older analyses. |
| `design` | Simplified artifact types, compact menus, folder/project/artifact edit flows, bounded dialogs and visible footer actions, proposal review/publication controls, matrix creation/filtering/deletion, directed graph and architecture aggregation behavior. |
| `derivation` | Projects, code and mixed source derivation, real source-freshness checks and joint publication; no invented safety obligations when hazard analysis has not generated them. |
| `safety-inheritance` | Same three source modes with saved hazard obligations; preserved source requirements, classification/provenance and downstream safety significance. |
| `report-appearance` | Paired report captures begun in either theme; full-scene PNG pixel checks, unchanged custom colors and live scene, saved Projects report/structured SVG switching, library reload, code report/enlarged preview switching and light print images. Checks report contents hierarchy, duplicate headings, code-block exclusion, document-only navigation and focus, active sections, report switching, collapse/expand and compact-window layout. Also verifies the compact report picker, upper-right generation/export menu, metadata-only rename across reload, confirmation before deletion and preservation of other saved reports. Uses isolated profiles and synthetic snapshots without AI calls. |
| `cookbook` | Shared README recipes; docked/full-screen + menus and keyboard access; searchable browsing, edited draft insertion, attachment preservation, explicit controlled-provider suggestions, failure/cancellation, unsupported requests, context boundaries, unchanged saved records and light/dark appearance. |
| `collaborator` | Current-view requests in all six populated areas, tool/context handoff, selection/diagram/document evidence and repair after current-view context changes. |
| `worker` | Large evidence capture, checksums and layout in workers while the renderer services an input-event probe; assertions include a maximum event-loop service gap. |

The full test inventory is discovered on each run; the number grows with the
repository. The frontend run intentionally leaves the two paid live-model hazard
evaluations disabled. Its two other default skips are executed by `capacity`.

For rapid STPA iteration without building Electron or contacting a provider:

```sh
npm run test:stpa:synthetic -- --out /private/tmp/xhandle-stpa-fresh-run
```

The output directory must be new. `result.json` records pass/fail, test counts,
elapsed time, network isolation and links to the full Jest results/log. The same
checks are included in the full Electron gate and available with `--only stpa`.
Synthetic responses test the production pipeline and acceptance contracts;
they do not evaluate a live model's interpretation of an external source code.

## Failure behavior and isolation

- Nonzero exit, timeout, failed/missing result assertions, unexpected renderer
  exceptions or nonlocal network attempts fail the applicable suite. Failures
  remain failures even when later suites pass. Interrupting stops subsequent work.
- Application source is fingerprinted before and after the run. A changed shared or native
  tree fails the gate because results no longer describe one source snapshot.
- Profiles, session storage, databases and downloads are isolated. Source
  decomposition rows are checked for unintended mutation after interaction tests.
- Test subprocesses receive an environment allowlist without provider credentials.
  The live renderer blocks nonlocal requests, and AI responses are intercepted
  with controlled fixtures. Historical seeded Design UI drafts control source
  freshness; the separate derivation suites exercise actual freshness checks.

## Limits and release checks

This is a broad automated regression gate, not proof that every behavior is free
of defects. It does not validate the semantic quality/availability of live Claude
or other providers, real cloud sign-in/GitHub permissions, every native file
dialog, accessibility with assistive technology, signed installer installation,
notarization or published auto-update feeds. Existing provider compatibility unit
tests run, but live paid evaluations require a separate authorized run.

The opt-in [live functional hazard-quality campaign](live-hazard-quality.md)
uses production prompts and an isolated Electron observer, source/context
integrity checks, a fixed quality rubric and a persistent spending cap. Run it
with `npm run test:hazard:quality -- --live ...`; ordinary regression commands
never start that paid campaign.

Run native UI/packaged smoke checks on macOS, Windows and x64 Linux before claiming
cross-platform runtime coverage. A macOS result only establishes macOS coverage.
The staged production app here is unpackaged; no installer, commit, release or
publication is performed by this command.

## Code architecture finalization memory replay

The `cba-memory` suite runs production data modules in the real preview shell,
checks complete evidence across native IndexedDB publication/recovery, and opens
the saved architecture. Pass `--cba-baseline /path/to/pre-change-tree` to compare
the original generator, chunk reader and architecture storage on identical inputs.
Each case starts in a fresh Electron process. The small default comparison uses
a 1 GiB test cap; it is not a large-scale pressure replay.

Run `scripts/diagnostics/verify-cba-finalization-memory.cjs` against a freshly
staged preview with `--stress-files 6000 --stress-rows 32000` for that replay.
It uses the normal approximately 4.09 GiB cap, actual source/evidence objects,
heap and resident samples, exact row/evidence checks and full-result recovery
after process restart. The baseline must reach real 4+ GB memory pressure; after
sustained final-save pressure it can be deliberately stopped. Such a stop is
reported separately and must never be described as an observed native crash.
Without a supplied baseline, only fixed-code completion is established.

See [the implementation and measured results](../investigations/code-architecture-finalization-memory-2026-11-22.md)
for exact commands, source-isolation details, the 6,000-file benchmark and Linux
RSS/runtime qualifications. Profiles and output directories must be disposable;
the command never needs a live provider or an external workspace.
