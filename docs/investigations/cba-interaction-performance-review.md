# Code-Based Architecture interaction performance review

Reviewed 2026-10-06. Baseline: `aa0666f8961acf6d0af09e88670fa6bee5033c8c`, the parent of `561c77df01a3fa65f7a06b568b5a710287138b9b`. Current: `10ae665` plus the existing uncommitted Functional changes. Application code was not modified during this review.

## Conclusion

There is no evidence that one universal click/pan handler became slower. The main change is that the analysis now publishes a much denser call-level dataset into UI paths that still scale with the entire dataset. There are also independently measurable new costs in Functional-model validation/navigation and storage. The recent rendering optimizations help at equal graph size, but do not make arbitrarily large graphs responsive.

This distinction matters: reverting the rendering improvements would make equal-size graphs slower. Restoring the former responsiveness requires reducing UI work per interaction while retaining complete analysis evidence.

## Findings, in remediation priority order

### P1 — Detailed extraction expanded the workload without bounding visible UI work

Introduced in `561c77d`: the previous pipeline appended the model's generated file table; the new pipeline completes the source inventory, adding supported relationships even when the model did not emit them. See `src/features/code-architecture-context/codeRelationshipEvidence.js:91` and `src/components/generateFunctionalDecompositionFromGitHub.js:3347`. Later extraction refinements retain this architecture. This is a change in granularity and coverage, not evidence that every additional row is an erroneous call.

The CBA table still renders every filtered row (`generateFunctionalDecompositionFromGitHub.js:4498`); its predecessor also did so. This is a pre-existing scaling weakness exposed by the larger workload, not a newly introduced table algorithm. Our 2,000-row current fixture mounted 148,170 DOM elements, took 2,299 ms to first table paint, and 460 ms from a row click to two animation frames. Large DOM size is also a plausible contributor to scrolling cost; scrolling was not separately profiled.

The CSU renderer retains the complete detailed graph. At fit-to-view almost everything is visible, so viewport culling cannot remove much. Current 2,000-edge fixture: 2,128 nodes including containers, 5,016 handles, 25,486 DOM elements; pan p95 frame interval 100 ms and zoom p95 250 ms. These exceed a ~16.7 ms frame budget by a large margin. See `LiteSummaryDiagramReactFlowGitHub.js:2364` and `:4224`.

Preserve the evidence inventory. Virtualize tables and introduce a rendering-level budget/level of detail for large canvases, with complete graph data retained for selection, navigation, export and analysis. Do not solve this by dropping source relationships or silently omitting hazards.

### P1 — Functional validation and single-link navigation repeatedly traverse the full evidence model

Introduced with Functional View in `10ae665`, with further materialization in the current uncommitted semantic/traceability work. `functionalModel.js:22` hashes every current row, sorts the row hashes, then hashes rows again when checking a ready model. It does the first full pass even if the rows have no Functional annotations. `buildFunctionalModelRows` repeats readiness validation and reconstructs evidence; `functionalSourceIndex` (`:351`) rebuilds the entire derived model for one link lookup.

Readiness is invoked directly during Functional rendering (`generateFunctionalDecompositionFromGitHub.js:4350`) and the hazard banner (`App.js:17542`). The Functional component also performs a separately memoized model build. Hazard staleness and assurance trace construction call the same model functions. Some callers are memoized: this is not a claim that all calls run on every React Flow viewport frame.

Pure-function measurements with 10,000 synthetic rows (~20.94 MiB raw / 27.17 MiB annotated): median readiness 258 ms; model construction 334 ms; one-link lookup 334 ms. At 5,000 rows these were 129 / 165 / 167 ms. These are synchronous main-thread algorithms in the application even though the benchmark runs them in Node. They explain potential pauses opening/switching relevant views or following a Functional link, rather than directly explaining all CSU panning.

The latest traceability implementation also materializes supporting implementation evidence into each relevant Functional interaction (`functionalModel.js:305–320`). This is correct trace coverage but increases allocation work with fan-out. Keep normalized evidence/indexes shared internally and materialize full records at export/analysis boundaries.

Fix with revision-keyed shared derivation, precomputed row/input fingerprints and trace indexes, a cheap no-model early exit, and background processing where appropriate. Invalidation must cover source/evidence/semantic edits, analyst overrides and history changes; UI selection must not invalidate the model.

### P1 — New chunked storage adds a measured project-save/load penalty

Introduced in `10ae665`: `code-architecture-storage/chunkedRecord.js:68–118` recursively creates content-addressed object/page records, serializes and SHA-256 hashes them. Reading hydrates the tree and recreates independent mutable objects (`:124–169`). This removes admission limits and supports atomic publication, but has a cost even for modest payloads.

An isolated real-IndexedDB test with 1,000 rows / 1.18 MiB measured:

| Operation | Legacy single record | Current tree storage |
| --- | ---: | ---: |
| Write | 5.1 ms | 149.9 ms |
| Read | 3.5 ms | 90.5 ms |

The database contained 4,069 records after storing both copies; round-trip data equality passed. This demonstrates overhead, not a disk quota problem. Application persistence (`App.js:5504`) writes complete CBA state when its dependencies change. The graph benchmark bypasses project hydration, so storage is a separate cost and is not included in its diagram timing.

Use suitably sized row/byte pages or a small-record fast path, reuse unchanged staged content, and avoid rewriting unchanged loaded data. Retain atomic publication, revision conflict detection, backups, historical evidence and interrupted-write recovery. Storage is not shown to run on every pan; do not attribute every frame stall to it.

### P2 — Full-row serialization now carries much more metadata into diagram invalidation

`LiteSummaryDiagramReactFlowGitHub.js:2108` constructs the layout scope with `JSON.stringify(rows)`. This code existed before `561c77d`. However, the new `...r` spread in the CBA diagram adapter (`generateFunctionalDecompositionFromGitHub.js:3871`) carries all row metadata, including Functional annotations and source evidence, into the renderer. The scope therefore depends on large non-geometric payloads, in addition to the increased row count.

The synthetic 10,000-row annotated payload took about 40 ms merely to serialize. This useMemo runs when row identity changes, not on every viewport event. A geometry/structure revision plus separately updated presentation data would avoid using complete evidence as a layout key while preserving cancellation of obsolete layouts.

### P2 — Remaining scaling cliffs deserve targeted follow-up, not blind rollback

- `581d079` added `orderCsuFunctions`: each CSU scans the full edge list and then runs bounded local swap passes (`csuFunctionOrdering.js:3–40`; caller `LiteSummaryDiagramReactFlowGitHub.js:696`). The window is bounded but total work grows with containers, edges and degree. This affects initial/explicit arrangement, not proven continuous pan cost. Index adjacency once and profile before changing the ordering policy.
- Any manual edge route disables whole-diagram culling (`LiteSummaryDiagramReactFlowGitHub.js:2368`) because a route may extend outside its endpoint bounds. This protects correct visibility but creates a performance cliff. Route-aware visibility bounds would preserve that correctness without disabling culling globally. Not independently benchmarked here.
- First diagram/table switches can unmount and recreate a surface. This lifecycle existed before the reference commit; larger inputs amplify its cost. Preserve model/layout results across view switches without keeping every large DOM surface mounted.

## Equal-workload countercheck

Same synthetic 800 relationships, same browser/viewport, fresh context, same scripts, development builds:

| Metric | Before `561c77d` | Current |
| --- | ---: | ---: |
| First edges visible | 3,569 ms | 1,507 ms |
| Nodes including containers | 853 | 853 |
| Handles | 26,048 | 2,016 |
| Diagram DOM elements | 35,891 | 10,261 |
| Pan p95 frame interval | 433 ms | 16.8 ms |
| Zoom p95 frame interval | 450 ms | 50 ms |
| Table first paint | 994 ms | 888 ms |
| Table click-to-two-frames | 197 ms | 174 ms |

The current renderer is substantially better at this equal workload. This supports retaining the `581d079`/`10ae665` rendering optimizations. It does not contradict the user's experience with much larger generated datasets, nor prove that all graph topologies are fast.

## Recommended implementation order and verification

1. Share/copy-on-change Functional derivation and indexed trace lookup; remove evidence-wide readiness work from ordinary render paths. Measure unrelated button clicks and navigation on populated Functional projects.
2. Virtualize CBA and Functional tables. Preserve variable row heights, editors, filters, select/copy/export semantics, accessibility and exact navigation to offscreen rows.
3. Bound large-canvas drawing work through viewport/route-aware visibility and appropriate visual detail during gestures. Preserve full graph semantics, manual routes, container membership and saved positions. Validate both dense fitted overviews and zoomed views.
4. Improve storage chunk granularity and unchanged-state detection without weakening storage correctness or reintroducing hard dataset limits.
5. Profile and index layout work; separate geometry revisions from descriptive/evidence payload changes.
6. Add repeatable performance checks at representative sizes and payload complexity. Validate production builds and Safari on the user's hardware before declaring responsiveness restored. Include local/Git parity and downstream hazard/requirements/traceability regressions.

## Reproduction and limitations

Prompt: `docs/codex-prompts/review-cba-interaction-performance.md`.
Scripts: `cba-interaction-performance-benchmark.cjs`, `cba-derived-model-cost-benchmark.cjs`, `cba-storage-performance-benchmark.cjs` beside this report.
Raw results: `cba-interaction-performance-measurements.json`.

Old source was extracted to a temporary directory from git; dependency installation was shared with the current workspace. Isolated Chromium contexts used synthetic fixtures, no customer browser data, no model calls. Browser timings are single exploratory runs per condition, not statistical guarantees. "First edges" is not full interaction readiness. Gesture events are programmatically dispatched; pan/zoom timings include browser processing and scheduling. Pure-function results report six samples per operation. Storage is one exploratory sample. No Safari, customer-repository capture, production-build benchmark, heap profile or complete downstream-table scroll trace was performed. The exact dataset growth factor cannot be established without equivalent old/new customer outputs; it is not assumed to be fivefold.

Only review artifacts were added. Existing application changes were preserved; no performance fix, commit or push was performed.
