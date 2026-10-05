# Large CSU canvas navigation

## Findings

The 600-function / 1,200-edge development-browser fixture reproduced the reported delay. The original canvas mounted about 29,000 DOM elements regardless of viewport. Each function mounts 32 connection handles. CPU profiling also identified repeated DOM searches in React Flow's edge-label store selector and unnecessary selection-state updates.

## Changes

- Keep the selection callback stable and retain existing state when selected IDs have not changed.
- Cache the orthogonal edge-label portal target per canvas; subscribe to canvas-root changes rather than searching the DOM on every store update for every edge. The cache uses weak references to canvas roots.
- Memoize function and orthogonal edge components.
- Enable React Flow viewport culling for CSU diagrams with at least 250 rendered nodes or 500 edges. Full node/edge state remains available for fitting, searching, exports, traceability, and persistence. Small and compact diagrams retain their existing rendering path.
- Keep full rendering if a diagram has custom orthogonal routes: endpoint-only edge culling would incorrectly omit route segments outside the endpoint bounds.
- Promote the large canvas viewport to a compositing layer. During viewport movement, temporarily omit edge-label painting, shadows, and filters. Geometry remains visible; decoration returns after navigation settles. This uses DOM attributes, not React state updates on every frame, and clears its timer on scope changes/unmount.

## Validation

`csu-navigation-benchmark.cjs` uses an isolated Chromium profile with API calls blocked. It checks pan and zoom in a populated region, zero repeated label-container queries, decoration restoration, all 600 functions and 1,200 edges returning after fit, compact-view behavior, and runtime errors.

Final development-browser measurements (milliseconds between animation frames):

| View / gesture | Median | 95th percentile |
| --- | ---: | ---: |
| Entire 600-function overview, pan | 46 | 63 |
| Entire overview, pinch zoom | 132 | 613 |
| Populated detail region, pan | 17 | 18 |
| Populated detail region, pinch zoom | 17 | 18 |

The initial reproduction measured approximately 348–464 ms median frame intervals, but used longer one-direction pan sequences. Treat those as evidence of the original slowdown, not a controlled speedup ratio. The retained benchmark uses oscillating pan and a populated detail region to avoid measuring an empty canvas. Dense overview zoom still has slow frames; this does not establish a universal frame-rate guarantee. Safari and the user's exact project were not benchmarked.

The existing edge-interaction browser fixture passed, including routing edits, node movement, bundles, reopening, and read-only behavior. Its compact-view assertion now waits for the asynchronous view transition rather than assuming synchronous React rendering.

All 60 targeted unit tests passed; targeted ESLint reported no errors and 11 existing warnings. The production build passed with existing warnings. `git diff --check` passed.
