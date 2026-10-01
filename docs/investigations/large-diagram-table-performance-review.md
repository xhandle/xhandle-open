# Large diagram and hazard table performance review — 2026-09-29

Prompt executed: [review-large-diagram-table-performance.md](../codex-prompts/review-large-diagram-table-performance.md). Application revision: `828fba7`.

## Result

The lag is reproducible without AI requests, real project data, or an open search dialog. The strongest findings are excessive mounted table content and broad React updates for small selections. Diagram selection also rebuilds presentation objects across the graph and triggers additional reconciliation. Search has a measurable opening cost, but is not the explanation for ordinary clicks while it is closed.

This review changes only investigation artifacts. No application fixes, data changes, commits, or pushes were made.

## Measurements

Fresh isolated Chrome sessions against the running development server, 1500 × 1000 viewport. Synthetic cyclic interfaces have systems, subsystems, and one operational context; each interface produces seven STPA rows. CPU profiling was enabled. Measurements cover event dispatch through two animation frames; they are indicative interaction delays, not guaranteed time to full application quiescence. No CPU throttling was applied. Three different cells/nodes were selected per fixture; tab, filter, and search opening were each measured once.

| Fixture | Mounted diagram nodes / edges | Draft hazard rows | Draft textareas | Hazard tab opening | Cell selection, median | Filter opening | Search opening |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 interfaces | 25 / 20 | 140 | 6,300 | 250 ms | 87 ms | 82 ms | 51 ms |
| 100 interfaces | 124 / 100 | 700 | 31,500 | 1,153 ms | 394 ms | 407 ms | 256 ms |
| 200 interfaces | 247 / 200 | 1,400 | 63,000 | 2,488 ms | 952 ms | 876 ms | 539 ms |

Draft view total DOM element counts were 20,977 / 102,097 / 203,497 respectively. DOM `tbody tr` counts in the raw measurements also include interface group headers; they are not hazard-row counts.

For 700 synthetic **completed** hazard rows: zero textareas, 63,536 DOM elements, 1,739 ms tab opening, 271 ms median cell selection, 310 ms filter opening, and 159 ms search opening. Synthetic completed content is short and exercises the completed renderer; it is not a validated engineering analysis.

Diagram selection medians were **44 / 156 / 312 ms** for the three sizes. The 20-interface samples were 44, 160, and 37 ms, so the smallest fixture also showed variability. The harness dispatches mouse down/up plus click through the actual node handlers and verifies that one node is selected.

At 1,400 draft rows, cell selections produced long tasks of roughly 697–835 ms plus additional work. CPU samples prominently contain React JSX creation, property validation/diffing, reconciliation, garbage collection, and DOM insertion. Search opening samples prominently contain visibility checks, `getClientRects`, ancestor traversal, and text extraction. No page errors were recorded.

Instrumented synchronous storage writes were absent during measured node/cell selections and filter/search opening. Hazard tab changes flushed small diagram-position/group/manual-node records. This does not measure IndexedDB transactions or prove storage never causes lag elsewhere.

## Findings, ranked

### 1. High — Hazard tables mount the entire expanded dataset and rebuild it for cell selection

Locations: `src/App.js:7558`, `:18545`, `:18628`, `:18830`, `:18933`.

Both table renderers map every expanded row and its columns inside the large App component. Draft cells each mount a controlled textarea; some context columns are hidden by CSS but still create their cells/editors. Completed cells use contentEditable elements, which reduces the DOM cost but does not isolate their rendering.

Click/focus calls `selectTableCellForCollaborator`, which creates a new App-level selection object even for an unchanged selection. App then constructs the table JSX again, including per-cell diagram targets, selection checks, handlers, and props. There is no row windowing or memoized row boundary here. Opening a column filter likewise updates App state and revisits the entire table. This explains why even clicks that do not edit or save content slow down with row count.

Draft typing has an additional source-level risk: `handleDraftHazardCellChange` (`App.js:12697`) updates the shared draft map on each keystroke, invalidating the display-row derivation and table rendering. Typing latency was not separately benchmarked.

Recommended correction: extract a memoized table/row/cell implementation with stable props and callbacks; make selection updates affect only the changed rows/cells; ignore identical selections. Avoid keeping an editor mounted for every inactive draft cell. Then introduce measured, variable-height row windowing if needed, retaining natural text wrapping, grouped headers, keyboard navigation, and save-on-leave semantics. A fixed-height scrolling-cell workaround would violate the requested behavior.

### 2. High — Diagram interaction invalidates graph-wide presentation and parent UI

Locations: `src/components/LiteSummaryDiagramReactFlow.js:2414`, `:2424`, `:2447`, `:5618`, `:5652`; `src/App.js:17956`, `:17991`, `:18129`; `src/components/FunctionalDiagramWorkspace.jsx:113`, `:143`.

`viewNodes` maps the entire graph into new node/data objects when nodes, edges, or selection change. `viewEdges` similarly rebuilds all edge/data/style objects when its dependencies change. Node click creates a new edges array even when no edge was selected. That new array invalidates both presentation memos. This defeats much of the benefit of memoized individual React Flow nodes/edges.

Selection also builds and serializes a canvas-selection snapshot, then publishes changed selections to App. The functional workspace retains both panes, hiding an inactive pane with CSS. App constructs the functional table JSX even in diagram mode, and that hidden table remains mounted. Thus selection can update both graph presentation and the hidden decomposition table.

The measured graph selection cost scales from tens to hundreds of milliseconds before any search or hazard table interaction. Profiles contain React reconciliation, element/property work, edge rendering, and garbage collection. The exact proportion attributable to each source path was not isolated with an A/B patch.

Recommended correction: retain unchanged node/edge/data references; return the existing edges array for a no-op deselection; memoize comment lookups and changed-item decoration; isolate the decomposition table and collaborator selection from unrelated App renders. Preserve the mounted diagram's layout/viewport when changing views. Evaluate viewport culling only after identity churn is fixed, with explicit export/search/fit-view checks.

### 3. Medium — Selection-sensitive diagram effects repeat structural work before early exits

Locations: `LiteSummaryDiagramReactFlow.js:2883`, `:4471`, `:4750`, `:4778`, `:4816`.

Source-confirmed avoidable work:

- Structural reconciliation checks every wanted function ID with `nodes.some`, and every group with another `nodes.some`, before its unchanged-structure return. The worst-case membership check is quadratic in graph size.
- Description generation filters nodes for each group and regenerates descriptions before deciding whether anything changed.
- The group-membership signature filters the full node array once per group before its unchanged-membership guard.
- `useRef(loadPositions(storageKey))` evaluates `loadPositions` on every component render, including its localStorage read, JSON parse, and Map construction. React keeps the initial ref value but does not skip evaluation of that argument.

These are source-level inefficiencies on interaction-sensitive paths. They were not individually shown to dominate the CPU samples; do not equate every node update with a full ELK layout run. Drag guards and persistence debouncing already exist and must be retained.

Recommended correction: initialize the positions ref once and retain the existing explicit reload on project/storage-key changes; index nodes and parent membership once per structural revision; separate position/selection changes from topology and label/description changes; move inexpensive change guards ahead of expensive derivation. Preserve first-render arrangement, saved-layout restoration, system containment, overlap handling, and history.

### 4. Medium — Opening search synchronously traverses the whole mounted table

Locations: `src/components/QuickSearch.js:32`; `src/components/quickSearchUtils.js:39`.

Search builds a DOM snapshot before showing the dialog, walking table rows, cells, visible descendants, and controls. The measured opening delay grows to 539 ms in the 1,400-row draft fixture. Visibility/layout reads are prominent in the profile.

The 100-result display limit does not limit collection work. However, collection happens in `show`, not continuously while search is closed. The closed-dialog global listener only checks the shortcut. The latest search feature is therefore an additional opening pause, not evidence of a background scanner causing all clicks to lag.

Recommended correction: provide search entries directly from the current filtered table model, using stable row IDs and reveal/jump callbacks. This also becomes necessary if table rows are windowed: searching only mounted DOM would otherwise omit valid matches. Preserve the existing visibility, collapsed-group, keyboard, and Safari event-handling semantics. Do not add an unrestricted MutationObserver that continuously rescans the table.

## Other inspected risks and ruled-out hypotheses

- Completed-row matching already uses a WeakMap-backed indexed lookup (`App.js:832–881`). It is not a fresh full-summary scan for each target. Do not replace this with a less efficient implementation.
- `saveProjectPatch` serializes the whole project map synchronously (`App.js:1891–1919`), so edit/save latency can grow with the workspace. The measured selection stalls occurred without these writes. No storage redesign is justified solely by this benchmark; do not weaken the recent durability/recovery safeguards.
- Diagram image capture is triggered by analysis-result, functional-view-mode, or row-count changes (`App.js:8250–8268`). It can add work around result updates/view changes. It is not triggered by every cell selection, and its individual cost was not isolated here.
- The code-architecture hazard table also renders all expanded group items (`src/features/code-architecture-hazard-analysis/CodeArchitectureHazardSummaryTable.js:382`, `:512`). It has a separate component boundary and visible-column handling. The same large-DOM risk applies, but the project-table timings must not be represented as measurements of this separate screen.
- Git blame places important selection/presentation patterns before the latest search commit: App selection in `1f6e289d`, graph node decoration in `c0b0b223`. Recent additions can amplify older broad-render patterns. This review did not benchmark previous revisions, so it does not identify one commit as the sole regression cause.

## Implementation order and acceptance checks

1. Isolate hazard tables and local selection; stabilize row/cell props; mount editors only as needed.
2. Stabilize graph node/edge references and isolate hidden-table/parent updates.
3. Remove redundant graph structural scans and repeated position hydration.
4. Add data-backed search and, if still needed, variable-height table windowing together.

Repeat these fixtures and representative real-shape anonymized datasets after each change. Compare medians and tail latency over multiple runs, including a production build and installed Safari. Verify click-to-edit and save/restore, preprocessing preservation, filtering/counts, search reachability, natural row heights, first layout versus saved layouts, system/subsystem containment, split views, selection links, and undo/redo. Also measure dragging, sustained typing, long-running analysis updates, and persistence under quota failures before treating those paths as cleared.

## Reproduction and limits

Diagnostic: `scripts/diagnostics/review-large-view-performance.cjs`.
Raw sampled results: [large-view-performance-measurements.json](large-view-performance-measurements.json).

```sh
XHANDLE_PLAYWRIGHT_PATH=/tmp/xhandle-browser-check/node_modules/playwright-core \
XHANDLE_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
PERF_INTERFACES=100 PERF_PROFILE_DIR=/tmp \
node scripts/diagnostics/review-large-view-performance.cjs
```

Use `PERF_INTERFACES=20` or `200` for the other sizes, and `PERF_COMPLETED=1` for the completed table. Paths are configurable. The diagnostic creates an isolated browser profile and synthetic local data. It does not attach to the user's browser. CPU profiles are written to the supplied directory; avoid concurrent benchmark runs because contention distorts timings.

Development React adds validation overhead visible in the profiles. These are not production performance claims or Safari-specific measurements. The synthetic graph has fewer cross-links and shorter text than many real diagrams. No heap-retention/overnight test was performed; large DOM and garbage-collection cost do not establish a memory leak. Source review covers dragging, persistence, and code-architecture tables, but their end-to-end performance was not measured. No application behavior was changed, so the application test suite was not rerun for this review.
