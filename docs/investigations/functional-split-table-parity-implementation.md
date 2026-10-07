# Functional split/table parity implementation

Implemented `docs/codex-prompts/implement-functional-split-table-parity.md` on 2026-10-06.

## Result

Functional and CSU now share the workspace, divider, table pane, header/cell/link styles, column-width persistence and frame-coalesced drag handling in `src/components/ArchitectureWorkspace.jsx`.

- Functional occupies the full workspace rather than nesting a split inside the diagram surface. Tools participates in the diagram pane width. Table-only mounts neither Tools nor the diagram. Narrow layouts place diagram before table.
- Both abstractions retain the parent-owned split percentage when switching abstractions: default 50%, bounds 25–75%, keyboard increments 5%. This is session state, not a new reload-persistence promise.
- Resize fits the viewport on the next frame, without changing graph layout. Pointer cancellation, lost capture, blur, scope/view change and unmount remove drag listeners and restore body styles; scheduled fits are cancelled on scope changes.
- Functional table uses the same fixed toolbar / scrolling body structure and sticky header classes as CSU. Corresponding columns share widths and minimums. Functional preferences use `functional-table-widths-v1:<project/source scope>`; CSU keeps its existing storage key. Preference writes are debounced and flushed on scope exit.
- From/To/action links resolve derived identities. Table-only links open diagram-only; split stays split. Effect cleanup cancels pending focus on view/data/project changes. Reverse reveal retains filters when the row is visible, clears hiding filters, and rejects a missing explicit ID rather than substituting a positional row.
- Collaborator selection now includes the Functional row identity, actual Functional headers/values and supporting source row references/trace IDs.
- Memoized summaries, source-review lists, layout keys and row indexes avoid repeated data scans. The Functional canvas is memoized with a stable reverse-navigation callback, isolating it from table/filter/column updates.

Functional data remains read-only; derived labels do not become editable raw source calls. Interaction types, evidence inspector, full filtered copy/CSV export, virtual table/search infrastructure, layout storage keys, model generation, and downstream analysis inputs are retained. Source/pipeline/storage-format code was not changed by this task. Existing unrelated workspace changes were preserved.

## Verification

Final targeted run: **136 tests passed across 9 suites**. `npm run build` passed with existing repository lint warnings (including the pre-existing unused repo-name state in the pipeline component). `git diff --check` passed. No new warnings were reported for the shared workspace or Functional component.

Automated regression coverage covers shared resizing and cleanup, scope-specific width restoration, exact node/edge navigation and view policy, cancellation, reverse-filter handling, rejected missing identities, Collaborator provenance, Functional model validation, source-to-hazard mapping, virtualization, and CSU/Functional layout helpers.

Real Chromium checks (`scripts/diagnostics/verify-functional-architecture-view.cjs`) passed with isolated synthetic data and stubbed semantic responses:

- GitHub/local source paths, Functional model IndexedDB persistence and actual page reload.
- Ellipsis-menu table/split/diagram modes and CSU drill-through.
- First and repeated From/To/action arrows with exact selected node IDs.
- Split percentage retained through Functional → CSU → Functional.
- Pointer column resize persisted to the Functional preference key.
- Source coverage and downstream hazard mapping retained, no source data-change callbacks.
- No uncaught page errors.

`scripts/diagnostics/verify-functional-table-parity.cjs` also verified table-only has no canvas/Tools gutter, narrow-screen pane order, Collaborator selection, source immutability, and no data-change callbacks for 1,000 and 5,000 rows. Screenshots were captured and visually inspected for Functional split and narrow layouts and the CSU split baseline; all table/split/narrow captures are under `/tmp/parity-{csu,functional}-{table,split,narrow}.png`.

## Measured performance

Headless Chrome on this Mac, development bundle, 1500×1000 viewport; three sequential trials per case, without a concurrent build. Both views render the same 100 function nodes and 1,000/5,000 edges. CSU has four container nodes; Functional has three (its intentional omission of redundant CSU wrappers). Rows/descriptions are synthetic. These are comparative fixture measurements, not production/Safari performance guarantees.

Median across trials of p95 animation-frame interval, milliseconds:

| Rows / edges | View | Divider drag | Table scroll | Pan | Zoom | Long tasks across all trials |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | CSU | 66.7 | 16.8 | 16.8 | 16.8 | 3 |
| 1,000 | Functional | 33.4 | 16.7 | 16.7 | 16.8 | 0 |
| 5,000 | CSU | 216.7 | 50.1 | 98.9 | 16.8 | 271 |
| 5,000 | Functional | 150.0 | 49.9 | 91.1 | 16.7 | 76 |

Raw measurements: `functional-split-table-parity-metrics.json`. Frame intervals include rendering and event-loop delay; they are not direct hardware input-latency measurements. Full graph/evidence datasets were retained. Functional showed no comparative slowdown in this fixture, but both views still have stalls at 5,000 edges. This work does not establish uniformly smooth large-graph interaction.

An initial benchmark setup generated annotations before assigning source IDs and therefore invalidated its own Functional readiness check. That fixture was corrected before the reported run. The CSU comparison also explicitly uses a shared CSU container to match rendered complexity rather than comparing against hundreds of redundant wrappers.

## Limits and use

Safari automation was not exercised; the local preference check did not establish enabled remote automation. Chromium results do not establish Safari parity. Real-browser offscreen reverse navigation under filters, quick-search activation, full clipboard/CSV round-trips, and all cancellation permutations were not exhaustively retested here; the shared infrastructure and relevant unit coverage were retained. No paid repository/Functional generation or customer records were used.

Reload the app, select Functional, then choose Table or Split view in the ellipsis menu. Existing saved Functional models work without rerunning analysis. This task did not commit or push changes.
