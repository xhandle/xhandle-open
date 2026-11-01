# Large diagram overview investigation — 2026-10-31

Scope: profiling only. The user identified Code-Based Architecture Functional and other abstractions, including CSU/CSC. Application source, dependencies, installed desktop app and user data were not changed. Earlier uncommitted review-memory work was preserved.

## Findings

1. **The large graph has a remaining connection-rendering bottleneck.** With 1,500 functions and 3,000 connections, Chromium spends substantial main-thread time in `Layerize` while transforming the diagram. Full-graph panning is slower than close-up panning in both Chrome and Electron. This is evidence of costly browser rendering/compositing preparation; it is not proof that GPU hardware is saturated.
2. **Functional and CSU share this path.** `FunctionalArchitectureDiagram.jsx:79,203–224` wraps `LiteSummaryDiagramReactFlowGitHub` with `architectureMode` and detailed abstraction. The large-canvas guard at `LiteSummaryDiagramReactFlowGitHub.js:2270` therefore applies to both. The old edge-opacity fix is present at lines 2232–2263; this investigation is not rediscovering a missing version of that fix.
3. **The whole graph remains mounted.** `LiteSummaryDiagramReactFlowGitHub.js:4199` sets `onlyRenderVisibleElements={false}`. In the CSU fixture, all 1,884 nodes (including groups), 3,000 edges, 9,072 handles and 3,000 labels remain mounted at every scale: approximately 34,500 DOM elements. At close zoom, only 12 node bounds and 28 edge bounds intersect the Chrome viewport. Retaining the scene protects manually routed connections crossing the viewport with offscreen endpoints; blindly enabling React Flow endpoint culling would risk changing that behavior. Culling also cannot help when everything is visible.
4. **Existing motion optimizations help but do not remove the limit.** `csuNavigation.css:5–26` promotes the moving viewport, suppresses labels and removes decoration during motion. The measured large views activate that state. Temporarily removing the compositor hint made the exploratory zoom sample worse. A permanent promotion or indiscriminately removing hints is not supported by this evidence.
5. **This is not a reproduced React update-depth failure.** Ordinary gestures generally produce 26 pan commits or 24 zoom commits, consistent with input count, with no runtime errors or instrumented IndexedDB reads/writes during the measured gestures. That does not prove every component is optimally memoized. One Functional intermediate-zoom sample had 31 commits and a 116.6 ms p95; it is retained in the results. React Flow's marker selector also scans the edge list on store notifications (`node_modules/@reactflow/core/dist/esm/index.js:3547–3568`), a secondary optimization candidate whose individual cost was not isolated here.
6. **Gesture startup also stalls.** In Chrome, first-input-to-next-rAF delay reached 185.5 ms for CSU pan, and small zoom gestures commonly took 125–173 ms to reach their first rAF across these two views. Separate traces contain large initial style updates. The motion-state transition is a candidate contributor, not a proven exclusive cause; profile startup separately during implementation.
7. **CSC needs distinct coverage.** The large-canvas guard requires detailed abstraction, so aggregate CSC/CSCI views do not receive the same motion CSS or handle-pruning policy. This is a scope difference in source, not proof that a particular customer's aggregate diagram is slow. A small aggregate control cannot establish performance for thousands of aggregate nodes or dense aggregate connections.

## Method and limits

Production renderer: `/tmp/xhandle-review-retired-final-build`, manifest SHA-256 `78d8635246668cfa99ec336c91f779ee4c196a732cc560d864df5ecc3e41c117`. It includes the earlier local review-memory work. Real Chrome and a disposable Electron shell load the actual App with fixture-only API responses and IndexedDB records. No customer project, credentials or paid analysis are used. The customer's existing Electron preview remains separate.

Local hardware is Apple M2 / 8 GiB, not the customer's M4 / 16 GB. The 634 MB archive size does not identify the customer's node count, edge density or route lengths. Synthetic results establish a bottleneck on this machine, not customer-device timings or an exact reproduction of their project.

Each run discards warmups and takes three samples per scale/gesture unless explicitly labeled exploratory. Scales are interleaved across repetitions. Each sample restores Fit View, sets the requested scale using trusted CDP wheel input, waits for stability and verifies the transform changes during the gesture. Pan uses 24 middle-button steps; zoom uses 24 small alternating pinch-wheel steps. These zoom samples do not represent a long, rapidly changing physical trackpad gesture.

Frame figures are rAF intervals wholly between first and last trusted input, not measured display FPS. Automation, instrumentation, operating-system activity and thermal conditions can affect them. Timing runs exclude CPU/browser tracing; separate traced runs identify costs. The probe reads computed viewport state each frame and contributes some JavaScript overhead. Bounding-box intersection counts can overestimate visible connection geometry. Browser and Electron viewport dimensions are recorded per sample and differ; compare zoom scales within a runtime rather than treating the runtimes as a controlled speed contest.

## Measurements

See the [measurement JSON](../investigations/diagram-overview-sluggishness-2026-10-31.json) for every untraced sample, traced cost summary, first-input delay, scene counts, runtime versions and preservation checks. Raw screenshots, traces and CPU profiles are under `/tmp/xhandle-overview-investigation-20261031/`.

Chrome CSU pan p95 across three runs was **149.9 / 150.0 / 66.7 ms at overview**, versus **50.8 / 50.3 / 67.1 ms close up**. Chrome Functional was **133.3 / 150.0 / 133.3 ms at overview**, versus **50.1 / 51.4 / 50.7 ms close up**. Small alternating zoom generally remained around 50 ms across scales. Thus panning reproduces the reported scale sensitivity; small zoom only partially reproduces it, and close-up rendering is still below a smooth 60 Hz budget on this machine.

Electron CSU pan p95 was **150.0 / 166.6 / 150.0 ms at overview**, versus **66.8 / 51.0 / 50.1 ms close up**. Overview zoom was **66.7 / 66.7 / 50.1 ms**, versus **50.1 / 50.0 / 50.0 ms close up**. Its separate pan traces likewise showed 936 ms total `Layerize` at overview (26 calls, maximum 38.8 ms), versus 714 ms close up (27 calls, maximum 30.4 ms).

Electron Functional pan p95 was **166.7 / 150.1 / 148.6 ms at overview**, versus **66.7 / 50.1 / 66.7 ms close up**. Overview zoom was **50.1 / 50.1 / 66.6 ms**, versus **50.0 / 50.0 / 49.9 ms close up**. Both large views therefore show similar overview-pan sensitivity in both runtimes.

The smaller Chrome CSU control has **500 functions / 1,000 connections** (628 mounted nodes including groups). Across all 18 samples, pan and zoom p95 stayed between **16.8 and 18.7 ms**, without the large overview penalty. Overview pan was **17.7 / 17.2 / 18.6 ms**, versus **18.7 / 18.4 / 18.5 ms close up**. This supports a scene-size scaling limit rather than an inherent slow pan implementation at every graph size.

CSC aggregation of the 1,500-function fixture produces only **84 nodes / 60 connections**. Its 18 Chrome samples stayed between **16.7 and 18.5 ms** p95. This control is responsive but does not test a genuinely large aggregate graph. Electron CSC, CSCI and subsystem views were not separately benchmarked in this investigation.

In separate Chrome CSU pan traces, total inclusive `Layerize` time was 953 ms over 26 calls at overview and 733 ms over 27 calls close up; individual calls reached 41 and 32 ms respectively. Functional showed 924 ms over 27 calls at overview and 753 ms over 25 close-up calls. These events alone can exceed a 16.7 ms frame budget. By comparison, total `FunctionCall` time was approximately 309–377 ms across those gestures. Trace event durations may overlap and must not be summed as independent CPU totals.

## Diagnostic scene alterations

These were temporary CSS changes in disposable profiles, removed after measurement. They are attribution experiments, not proposed product behavior or visual acceptance tests.

For the exploratory Chrome CSU run, hiding connections gave a 33.4 ms pan p95 and reduced traced `Layerize` time to 233 ms over 52 calls (maximum 14.7 ms). Removing only invisible interaction paths left 922 ms of `Layerize` over 25 calls (maximum 38.5 ms). Removing only arrowheads, labels, visual effects or edge pointer events did not yield the same improvement. Hiding nodes helped some, but less than hiding connections. These variants each have one untraced sample and are directional; repeated edge isolation in Electron provides an additional check.

In three Electron repeats, hiding connections reduced overview pan p95 to **50.0 / 33.3 / 33.3 ms** and zoom to **33.4 / 33.4 / 33.4 ms**. The separate trace reduced `Layerize` to 262 ms over 57 calls (maximum 11.9 ms), while `FunctionCall` remained around 361 ms. This strengthens the connection-display attribution across runtimes but also shows remaining overhead after connections are hidden.

The connections must remain visible in a real fix. This experiment narrows the optimization target to connection display work; it does not establish which replacement representation will preserve appearance and interaction most efficiently.

## Recommended next implementation

Start with a bounded prototype of lower-cost connection rendering in the shared CBA renderer, with the current implementation retained as a fallback. Compare reduced per-edge paint/compositing complexity against a cached or batched connection layer. React Flow already groups edges into SVGs by z-level, so simply moving them into one SVG is not an established solution. Canvas/WebGL or raster caching may change text, line crispness, hit-testing and memory use and should be evaluated, not selected by assumption.

Keep the full diagram and every connection visible, with identical routes, arrowheads, opacity, stacking and fit behavior. Preserve node/edge selection, hovering, manual routes, comments, inspection, keyboard access, export and print. Do not trade this problem for chunking, disappearing connections, layout changes or a degraded overview. Keep route geometry independent of camera motion; separately reduce avoidable store-selector and gesture-start work if profiling justifies it. Do not re-enable broad viewport culling without crossing-route correctness tests.

Acceptance should cover Chrome and Electron, Functional and detailed CSU, genuinely large aggregate CSC/CSCI graphs, small controls and long crossing/manual routes. Measure repeated sustained pans, actual rapid zoom sweeps, first-input stalls, idle restoration and memory after many gestures. Capture visual comparisons at overview and close zoom, plus selection/edit/export checks. Use the customer's representative graph on M4 hardware before claiming their issue resolved.

No implementation fix is claimed by this investigation.

## Verification

Seven runs completed: 130 untraced measurement gestures and 15 separate traced gestures, excluding warmups. All runs passed trusted-input/viewport-motion assertions and ended with unchanged node IDs/layout transforms and edge IDs. No page runtime errors were captured. No instrumented IndexedDB reads or writes occurred during the measured gestures. These are performance-harness checks, not a full editing/export regression suite.

SHA-256 comparison against the investigation's starting snapshot verified all **784 source files under `src` and `server` unchanged**. `git diff --check` passed. New repository artifacts are this report, the investigation prompt and the measurement JSON; diagnostic code and raw traces remain in `/tmp`. No dependencies, installed applications or release configuration were changed. Existing unrelated worktree modifications remain in place.

## Reproduction

Prompt: `docs/codex-prompts/investigate-diagram-overview-sluggishness-2026-10-31.md`.

Local diagnostic harness: `/tmp/xhandle-overview-investigation-20261031/runner.cjs` plus `overview-scenario.cjs`, based on `scripts/diagnostics/desktop-interaction-performance.cjs`. The seeder is `/tmp/xhandle-interaction-seeder/seed.js`, built from `scripts/diagnostics/build-desktop-performance-fixture.cjs`. Temporary files may be removed by the OS; retain them with the raw traces for an exact rerun.

```sh
node /tmp/xhandle-overview-investigation-20261031/runner.cjs \
  --overview 1 --workspace cba --level CSU \
  --build /tmp/xhandle-review-retired-final-build \
  --out /tmp/xhandle-overview-investigation-20261031/recheck.json \
  --browser chrome --nodes 1500 --rows 1000 --artifacts 100 \
  --samples 3 --profile 1 --isolates edges --profileIsolates edges --verify 1
```

Omit `--browser chrome` for Electron. Use `--level Functional` or `--level CSC` for those views; use `--nodes 500` for the smaller detailed control. Run profiling workloads sequentially to avoid competing for rendering resources.
