# Restore responsive Code-Based Architecture interaction

Implement the performance fixes identified in `docs/investigations/cba-interaction-performance-review.md`.

The goal is fast button clicks, scrolling, table editing, view switching, diagram loading, panning and zooming on large codebases. Preserve complete analysis results and the current engineering workflow. This is a performance implementation, not a redesign of source extraction or functional abstraction.

## Read before editing

Read the repository instructions, the review above, its measurement JSON, and these reproducible diagnostics:

- `docs/investigations/cba-interaction-performance-benchmark.cjs`
- `docs/investigations/cba-derived-model-cost-benchmark.cjs`
- `docs/investigations/cba-storage-performance-benchmark.cjs`

Inspect the current working tree, including uncommitted changes. Preserve existing work. Source line numbers in the review may have shifted. The historical baseline is `aa0666f8961acf6d0af09e88670fa6bee5033c8c`, the parent of `561c77df01a3fa65f7a06b568b5a710287138b9b`.

Do not roll back that commit or subsequent improvements. Equal-size measurements showed that the current CSU renderer is faster than the old renderer; larger workloads and additional processing costs are the problem. Verify findings against the current code before changing it.

## Non-negotiable behavior and data safeguards

- Preserve canonical CBA relationships, evidence coverage, stable identities, architecture allocations, retained history and local/GitHub equivalence.
- Preserve Subsystem, CSCI, CSC, CSU and the single existing Functional view. Do not change semantic abstraction rules, interaction significance, eligibility decisions or analyst overrides to gain speed.
- Preserve Functional-to-CBA/source traceability and all downstream mechanics: Hazard & Remediation, Software Requirements, System Requirements, Subsystem Requirements, System / Subsystem Design, and Traceability Matrix.
- Preserve navigation on the first click, search, selection, editing, filters, copy/export, imports, saved positions, manual routes, colors, comments, diagram exports and project switching.
- Do not discard rows, truncate evidence, reduce source coverage, impose new dataset admission limits, or disable features to meet performance targets.
- Preserve atomic publication, concurrent-edit protection, previous successful results, cancellation, recovery, backups, restore and permanent deletion. Never solve storage performance by clearing customer data.
- Keep changes scoped to the affected CBA paths. If a shared component must change, validate the Projects area and other consumers explicitly.
- Use isolated synthetic data and fresh browser contexts. Do not inspect or mutate customer browser storage or run paid model requests. Do not commit or push unless separately requested.

## Implement in this order

### 1. Derive the Functional model once per relevant revision

Inspect `functionalModel.js`, its render/navigation consumers, hazard staleness checks and assurance trace construction.

- Share readiness, derived rows and a trace-ID lookup index across consumers. Repeated readiness checks and single-link navigation must not hash/rebuild the entire model on each interaction.
- Add a cheap no-model/version check before expensive validation.
- Reuse row fingerprints and normalized evidence. Avoid repeatedly copying the same supporting implementation evidence into transient UI objects; materialize existing public shapes when required by analysis/export consumers.
- Invalidate correctly for source/evidence changes, Functional semantic edits, eligibility overrides, lifecycle/history changes, imports, regeneration and project/source switching. Selection, scrolling and viewport changes must not invalidate derivation.
- Audit mutation paths before relying on object identity. A WeakMap alone is not sufficient if callers mutate objects in place. Use a reliable revision contract or correct immutable updates without changing public semantics.
- Bound cache lifetime and release project data on eviction/disposal. Do not trade latency for an unbounded memory leak or shared mutable evidence aliases.
- Move expensive cold derivation off the interaction path, using workers or cancellable cooperative work if justified. Reject stale results using revision/epoch checks and preserve synchronous API expectations where necessary.

### 2. Virtualize the CBA and Functional tables

- Render visible rows plus bounded overscan instead of the entire filtered dataset. Support variable-height/wrapped descriptions, horizontal scrolling, column widths and sticky headers.
- Keep stable row/trace identity across filtering, sorting, edits and virtualization; do not identify rows by their current viewport index.
- Navigation and search must scroll to and mount the exact target before focusing/highlighting it. First-click behavior must remain reliable.
- Preserve editing and save/commit behavior when a row leaves the viewport; retain or deliberately commit active editors without losing text or focus.
- Keep copy, CSV/workbook export and selection semantics based on the full intended filtered dataset, not just mounted rows. Preserve accessibility, keyboard interaction and row counts.
- Reuse an existing suitable virtualization approach where practical. Do not rewrite unrelated downstream tables without profiling evidence that they need it; ensure they remain functional.

### 3. Keep large canvases responsive without changing graph semantics

- Preserve existing idle-handle pruning and valid rendering optimizations.
- Profile fitted overviews as well as zoomed sections. Ordinary viewport culling cannot solve a fitted overview where every item is visible.
- Bound costly labels, decorations, handles and subscriptions during gestures. If needed, use a lightweight visual representation at overview scales that retains topology and is clearly a presentation choice. Restore appropriate detail when zooming in or ending a gesture.
- Do not silently collapse functional responsibilities, remove connections from the model, change abstraction level, or change saved geometry as a performance shortcut.
- Preserve hit testing, selection, search/navigation, manual route editing, comments and exports. Export the intended complete diagram, not a transient reduced-detail gesture frame.
- Replace the global culling disablement for any manual route with correct route-aware visibility bounds if feasible. Include routes crossing the viewport when both endpoints are offscreen, self-loops, parallel routes and nested containers.
- Avoid full-graph allocation/recalculation on viewport-only events. Preserve smooth Mac trackpad pan and pinch zoom, mouse wheel behavior and Windows input support.

### 4. Reduce storage overhead while preserving reliability

Inspect `chunkedRecord.js`, CBA storage consumers and the App persistence effect.

- Use an appropriately sized record/page strategy rather than hashing/storing every small compound object independently when that is slower. Consider a small-record fast path and bounded row/byte pages for larger records.
- Skip unchanged saves using a reliable revision/content contract. Reuse unchanged stored content where safe. Coalesce writes without losing the final edit or weakening explicit-save/run-completion durability.
- Keep old single-record and `xhandle-json-tree-v1` data readable. If introducing a format version, update readers, backup/export/import, deletion and recovery consistently. Prefer lazy, atomic migration with the old record retained until successful publication.
- Preserve independent mutable objects after hydration. Avoid cross-row aliasing introduced by deduplication.
- Handle quota errors, cancellation, missing chunks, interrupted publication and concurrent writes without replacing good data with partial results.
- Clean abandoned chunks only when confirmed unreferenced by active records, history, checkpoints or in-progress writes. No global destructive cleanup.
- Keep browser capacity checks and actionable errors; do not replace the removed arbitrary size limits with new ones.

### 5. Separate layout invalidation from evidence payloads

- Replace full-row `JSON.stringify` layout keys with correct structural/geometry revisions or compact signatures. Source-description/evidence updates should update visible content without unnecessarily resetting layout.
- Include the fields that actually affect layout and port geometry; preserve stale-layout cancellation, node-size changes, imports and explicit Auto Arrange behavior.
- Index adjacency once instead of scanning the complete edge list for every CSU. Preserve deterministic ordering and existing non-overlap, containment and route behavior.
- Reuse suitable derived/layout state across table/diagram switches without keeping all large DOM trees mounted indefinitely.

## Verification and performance acceptance

Establish a repeatable current baseline before edits. Use identical fixtures, browser, viewport and build mode for before/after comparisons. Prefer production builds for user-facing claims; adapt diagnostics to production safely rather than relying solely on webpack development hooks. Warm up and report medians/p95 over at least three runs, including cold load and warm interaction separately.

Cover:

- 800 and 2,000 edge diagrams; also a larger stress case with dense fan-out, nested containers, long labels and manual routes.
- 2,000 and 10,000-row tables, including variable heights, offscreen navigation, filtering and active editors.
- 1,000, 5,000 and 10,000-row Functional evidence fixtures, plus high-fan-out supporting evidence.
- Small legacy storage, existing tree records and large newly written records, including repeat save/load and interrupted/conflicting writes.

Measure click-to-paint, sustained table scroll frames, diagram readiness (not merely first edge presence), pan/zoom frame intervals, view-switch latency, derived-model work, mounted DOM/handles, storage read/write latency and heap retention across repeated project/view switches.

Targets on the documented test machine:

- Warm selection/navigation/button response under 100 ms p95 on representative large fixtures.
- Pan, zoom and table scrolling aim for a 16.7 ms frame budget; target p95 at or below 33 ms for the 2,000-edge fixture. No repeatable application-caused main-thread stalls over 100 ms during ordinary interactions.
- Cached readiness and indexed Functional lookup should be effectively constant-time and comfortably below one frame at 10,000 rows, with no full-model hashing/rebuild on warm interactions.
- Table DOM scales with viewport/overscan, not total rows. Scrolling and navigation must not repeatedly construct the full table.
- Storage and cold-load times show a substantial measured improvement over the reviewed baseline without correctness regressions. Explain remaining costs rather than silently shrinking the fixture.

These are acceptance targets, not permission to sacrifice correctness or claim universal hardware performance. If a target remains unmet, identify the measured blocker and remaining work; do not call the task completely resolved. Do not add brittle wall-clock assertions to ordinary unit tests; use deterministic work-count/DOM-bound tests plus benchmark reporting.

Add meaningful regression coverage for cache invalidation, exact trace lookup, stale worker results, virtualized editing/navigation/export, viewport route visibility, layout preservation, storage compatibility/atomicity/recovery and local/Git parity. Run relevant existing suites for all six downstream areas, Functional semantics and Projects behavior where shared code changed. Run lint, production build and whitespace checks.

Test Chromium and Safari/WebKit when available. Clearly distinguish real Safari from automated WebKit and document any unavailable platform checks. Do not report mocked model tests or synthetic browser fixtures as customer-scale validation.

## Deliverables

Implement the fixes and run validation. Write `docs/investigations/cba-interaction-performance-fixes.md` with:

1. Root causes addressed, implementation decisions and relevant files.
2. Comparable before/after measurements, fixture sizes, browser/build details and reproduction commands.
3. Behavioral/data-integrity regression results and compatibility/migration details.
4. Remaining bottlenecks or unmet targets, explicitly stated.

Finish with a concise account of what changed, measured improvements, preserved behavior, tests and limitations. No commit or push unless requested.
