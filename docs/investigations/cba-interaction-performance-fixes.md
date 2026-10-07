# Code-Based Architecture interaction performance implementation

Date: 2026-10-06. Implements `docs/codex-prompts/fix-cba-interaction-performance.md` following the performance review. Changes remain uncommitted. Existing Functional abstraction changes in the working tree were preserved; their semantic changes are not attributed to this performance work.

## Outcome

Table rendering, repeated Functional derivation/navigation, and storage improved substantially. Large-canvas interaction improved, but the complete performance acceptance target has **not** been met: the 2,000-edge development fixture still has approximately 50 ms p95 pan frames, versus the requested 33 ms maximum. Cold Functional derivation also remains synchronous. This report records verified improvements, not a claim that all large-codebase latency is resolved.

## Changes and rationale

- `functionalModel.js`: share readiness, row fingerprints, derived rows and exact trace-ID lookup through WeakMaps. CBA state adoption in `App.js` and table/diagram inputs explicitly deep-freezes JSON revisions through `immutableFunctionalRows`. Mutable API callers remain uncached and are revalidated, preventing stale results after in-place edits. New immutable revisions invalidate the cache; weak keys allow collection when consumers release a project. Cached derived rows are also immutable. No persistent model schema or semantic classification change was introduced by this optimization.
- `VirtualTableBody.jsx`, `generateFunctionalDecompositionFromGitHub.js`, and `FunctionalArchitectureDiagram.jsx`: render measured, variable-height rows with overscan and native table semantics. Stable trace identities survive filtering. Navigation mounts its target before scrolling/focusing; model-backed search includes offscreen rows. Active editors remain mounted. Copy/export still use full model/filter results, not the mounted subset. The table exposes total accessible row/column counts.
- `LiteSummaryDiagramReactFlowGitHub.js`: disable React Flow 11 endpoint-based visibility filtering. Its viewport selector was scanning/allocating graph collections during every movement, even in a fitted overview. The complete graph remains rendered and transformed; manual routes crossing the viewport are not lost when endpoints are offscreen. Connected-port pruning and gesture decoration suppression remain. This trades offscreen DOM savings for reduced per-frame work; it does not bound total diagram DOM.
- `csuFunctionOrdering.js`: build source adjacency once per layout, instead of scanning every edge for every CSU. Ordering equivalence is regression-tested.
- `csuLayoutRevision.js`: use topology, labels, files and architecture allocations—including both endpoint allocations—for layout invalidation. Full evidence/description payloads no longer enter the layout epoch key. This removes that serialization cost; it does not claim every other row-dependent effect was eliminated.
- `chunkedRecord.js`: pack small JSON subtrees into existing inline value entries, using bounded inspection, while retaining paged content-addressed storage for larger values. Skip root publication when its content root is unchanged. Existing chunk reuse and compare-and-swap publication remain. No data-volume admission limit was added, no records were deleted, and no speculative garbage collection was introduced.

## Measurements

Raw samples: [cba-interaction-performance-fixes-measurements.json](./cba-interaction-performance-fixes-measurements.json).

Environment: Apple M2, 8 GiB RAM, Node 20.20.2, headless Chrome 154.0.8037.98, 1500×1000 browser viewport. Browser performance measurements use the same CRA **development** build mode and isolated synthetic fixture before/after; they are not production or customer-data measurements. No paid model calls or customer browser storage were used.

The following values are medians across three independent browser runs. Gesture values are the median of each run's frame-interval p95, not a pooled p95. Table selection uses a synthetic click followed by two animation frames; cold table timing starts at render and is sampled after rows mount and two frames. The original comparison clicked the first table row; with virtualization this can be a spacer, so the after-selection number is a rendering proxy, not proof of real selection latency. The reproducible benchmark now explicitly selects a data row, and separate browser tests verify real editing/navigation.

| 2,000-row/edge fixture | Before | After |
| --- | ---: | ---: |
| Table first paint | 2,231.7 ms | 133.2 ms |
| Mounted table rows, including spacers | 2,000 | 13 (13–15 range) |
| Table-page DOM elements | 148,170 | 1,060 (up to 1,208) |
| Selection/render proxy | 449 ms | 31 ms |
| Pan frame interval p95 | 83.3 ms | 50 ms |
| Zoom frame interval p95 | 233.3 ms | 33.4 ms |
| First edge presence | 4,876 ms | 4,342.2 ms |

Both versions retain 2,128 diagram nodes, 2,000 edges, 5,016 handles and 25,486 DOM elements in the fitted diagram. “First edge presence” is **not full diagram readiness**. Pan/zoom measurements start after an additional settling interval and fit-view request.

An independent 800-edge navigation diagnostic passed, including hover-port restoration, stable paths and pinch zoom; its measured gesture p95 was 16.8 ms. The 10,000-row browser diagnostic mounted 19 rows at completion and passed first-request navigation to row 10,000, editing across scrolling, offscreen search and full-table Markdown copy.

For the 10,000-row Functional fixture (27.17 MiB annotated JSON, 2,000 derived rows), six in-process samples gave:

| Operation | Before median | After warm median |
| --- | ---: | ---: |
| Readiness | 258.1 ms | 0.006 ms |
| Derived model access | 333.9 ms | 0.001 ms |
| Single trace lookup | 333.8 ms | 0.001 ms |

These sub-millisecond numbers demonstrate cache reuse rather than precise hardware latency. Cold derivation still took 304.3 ms at 10,000 rows, 139.1 ms at 5,000 and 41.6 ms at 1,000. Freezing/adoption is outside that cold-derivation timer. The benchmark's `layoutScopeSerialization` field still deliberately measures full JSON serialization as a reference; it is not a measurement of the new compact layout key.

Storage: 1,000 rows, 1.184 MiB logical payload. The pre-fix storage comparison was one run; after values are medians of three runs, so this is indicative rather than a matched statistical comparison.

| Storage metric | Before | After |
| --- | ---: | ---: |
| Tree write | 149.9 ms | 27.3 ms |
| Tree read | 90.5 ms | 3.6 ms |
| Fixture database records, including legacy comparison record | 4,069 | 19 |

All three after-storage runs had exact JSON round-trip equality. The capacity diagnostic additionally exercised larger logical payloads exceeding the former 32 MiB cap.

## Compatibility and verification

- **44 test suites, 380 tests passed.** Includes Functional semantics/cache invalidation, source extraction, CBA hazard analysis, assurance requirements/design/traceability, review exports, navigation, Quick Search, virtual tables, ordering/layout revisions, and Projects diagram/history/manual-editing regressions.
- `verify-cba-virtual-table.cjs`: 10,000-row exact offscreen navigation, retained edits, model-backed search and full copy passed; no page errors.
- `verify-functional-architecture-view.cjs`: source coverage, Functional containers, reload persistence, rejected stale publication, local/GitHub parity, exact table links, CSU drill-through and Functional hazard input passed. Semantic requests were stubbed, not real repository analysis.
- `verify-csu-navigation.cjs`: connected ports, restored hover ports, route stability and pinch zoom passed.
- `verify-cba-capacity.cjs`: independent mutable hydration, aborted publication, save-only retry, preserved concurrent edits, quota recovery, legacy recovery, reload recovery, original tree-format migration and unchanged-chunk reuse passed.
- Original single-record data and `xhandle-json-tree-v1` remain readable. Inline subtree entries use the existing format; writes lazily publish the compact representation only after staging succeeds. Existing backup/delete key-prefix conventions remain unchanged.
- Targeted ESLint completed without code diagnostics; Browserslist reported an outdated compatibility database. `git diff --check` passed.
- Final production build verification: **`npm run build` passed (exit 0)** on the current working tree. CRA reported lint warnings and an outdated Browserslist database; no build errors. This verifies production compilation, not production interaction latency.

## Remaining limits and unverified acceptance items

1. The 2,000-edge pan target remains unmet, and zoom at 33.4 ms is slightly above the literal 33 ms threshold. This work should not be described as universally “lightning fast.”
2. All diagram DOM remains mounted. Larger graphs may still be limited by paint, subscriptions, memory and cold layout. A route-aware spatial index or lightweight overview renderer needs separate implementation and validation before promising larger-scale responsiveness.
3. Cold Functional derivation remains synchronous; no worker or cancellable background derivation was added. Additional hazard snapshot hashing and other row-dependent consumers can still do revision-dependent work.
4. Unchanged storage writes reuse chunks and skip root publication, but still traverse/hash the submitted data. Write coalescing and global abandoned-chunk collection were not added.
5. No production-browser latency measurements, real Safari/WebKit run, >2,000-edge dense/manual-route stress benchmark, sustained table-scroll p95, or heap-retention study across repeated project switches was completed. The optional stress fixture exists in the benchmark but is not claimed as executed.
6. Broader customer-scale evidence and fully settled diagram readiness remain unmeasured. The documented tests validate specific behaviors, not every downstream end-to-end customer workflow.

## Reproduction

Use an isolated dev server (`PORT=3001 BROWSER=none npm start`) and fresh browser contexts. Diagnostic paths default to the local Chrome and Playwright installation documented in the scripts; adjust those for another machine.

```sh
COUNT=2000 XHANDLE_URL=http://localhost:3001 node docs/investigations/cba-interaction-performance-benchmark.cjs
node docs/investigations/cba-derived-model-cost-benchmark.cjs
XHANDLE_URL=http://localhost:3001 node docs/investigations/cba-storage-performance-benchmark.cjs
XHANDLE_URL=http://localhost:3001 node scripts/diagnostics/verify-cba-virtual-table.cjs
XHANDLE_URL=http://localhost:3001 node scripts/diagnostics/verify-functional-architecture-view.cjs
XHANDLE_URL=http://localhost:3001 node scripts/diagnostics/verify-csu-navigation.cjs
node scripts/diagnostics/verify-cba-capacity.cjs
npm run build
git diff --check
```

The raw artifact preserves all three before/after 2,000-edge samples, storage samples, derivation measurements and browser regression results. No commit or push was performed.
