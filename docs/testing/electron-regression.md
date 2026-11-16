# Electron regression gate

Run the current shared working tree in the real desktop shell, with a freshly
built production renderer and disposable synthetic workspaces. This gate combines
the existing frontend/backend/native tests with browser-driven Electron checks.
It does not use the installed application's profile or a customer's project.

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
| `capacity` | Legacy archive roundtrip/compression with synthetic input; standard/legacy checksum compatibility over a virtual 520 MiB body. Explicitly enables the two normally opt-in capacity tests. |
| `native-node`, `native-python` | Native security, recovery, staging, updater and release-validator tests from the private desktop checkout. |
| `build`, `fixtures` | Fresh production renderer, staged native/backend runtime, source fingerprints and reproducible synthetic fixtures. |
| `shell` | Native desktop smoke: protocol/preload, loopback backend, SQLite/auth state, persisted reload, workers, recovery and mocked update IPC. |
| `workspace` | Populated Projects diagrams; five code-architecture abstraction levels; code requirements/design/traceability tabs; repeated navigation through 8,000 hazard rows with bounded mounted rows; Design folder creation/reload, column multiselects, history, Outline/Table/Traceability/Document views, HTL assessment expansion/resizing, global search; SysML model/table/text/validation/reload; report content, Safety Case interaction, System Test edit/save/reload, Settings/help/activities. |
| `hara` | Real HARA UI pipeline with controlled AI: shared STPA mechanics, visible Operational Mode and Operating Conditions columns, no Item definition text box, explicit output budgets, automatic recovery from truncated row/batch responses in Generate row and Develop risk profile, deterministic ASIL/rating edits, workbook export/reload (including saved item definitions), legacy method preservation and no new CBA FHA selection. Code HARA uses the production sheet builder and real saved/paged table to check every Projects HARA field, searchable multiselect FTTI filtering, CSV export, reload and blank missing fields in older analyses. |
| `design` | Simplified artifact types, compact menus, folder/project/artifact edit flows, bounded dialogs and visible footer actions, proposal review/publication controls, matrix creation/filtering/deletion, directed graph and architecture aggregation behavior. |
| `derivation` | Projects, code and mixed source derivation, real source-freshness checks and joint publication; no invented safety obligations when hazard analysis has not generated them. |
| `safety-inheritance` | Same three source modes with saved hazard obligations; preserved source requirements, classification/provenance and downstream safety significance. |
| `collaborator` | Current-view requests in all six populated areas, tool/context handoff, selection/diagram/document evidence and repair after current-view context changes. |
| `worker` | Large evidence capture, checksums and layout in workers while the renderer services an input-event probe; assertions include a maximum event-loop service gap. |

The full test inventory is discovered on each run; the number grows with the
repository. The frontend run intentionally leaves the two paid live-model hazard
evaluations disabled. Its two other default skips are executed by `capacity`.

## Failure behavior and isolation

- Nonzero exit, timeout, failed/missing result assertions, unexpected renderer
  exceptions or nonlocal network attempts fail the applicable suite. Failures
  remain failures even when later suites pass. Interrupting stops subsequent work.
- Application source is fingerprinted before and after the run. A changed shared
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

Run native UI/packaged smoke checks on macOS, Windows and x64 Linux before claiming
cross-platform runtime coverage. A macOS result only establishes macOS coverage.
The staged production app here is unpackaged; no installer, commit, release or
publication is performed by this command.
