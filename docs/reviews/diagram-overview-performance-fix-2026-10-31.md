# CBA diagram overview performance fix — 2026-10-31

Implemented a shared browser/Electron optimization for large Code-Based Architecture diagrams. The full node/connection model remains mounted. During viewport movement, loaded, bounded vector images supply connection paint while the native SVG supplies the authoritative routes and interaction targets. Native presentation resumes at idle, during editing, and for export/print.

This addresses the repeated connection-display work identified in [the investigation](diagram-overview-sluggishness-2026-10-31.md). It does not establish stall-free rendering for every project: gesture startup, cold-cache fallback and some cache transitions still pause. The customer's M4 / 16 GB project was not available for validation.

## Implementation

- `architectureEdgeMotionCache.js` captures native SVG geometry and computed paint at idle, yielding during the scan. Subsequent camera changes use the stored markup and complete path bounds, including manual detours. No route calculation, storage access or React state update is added to the camera loop.
- Each SVG paint layer gets an HTML image containing self-contained SVG. A loaded image is used only when it covers the entire visible portion of that layer and fits the pixel budget. The native SVG remains available on unsupported content, image-load failure or uncovered camera positions. Original transparent hit paths remain hit-testable; pointer/keyboard input restores native paint before editing.
- Image crops align to the device-pixel grid. Matching intrinsic dimensions to the displayed grid reduced thin-stroke opacity differences. Curved overview scenes still require the perceptual check and structural/negative controls described below; this is not a claim of identical rasterization.
- Budgets limit captured geometry to 8 MiB, layers to eight, active/build image pixels to 16 Mi pixels and either side to 8,192 pixels. One overview can be retained beside the current crop, with retained intrinsic pixels capped at two budgets plus one in-flight build. These are image budgets, not a cap on total Chromium process memory.
- Animated aggregate highlights retain native rendering so their animation is not frozen into a static image. Clearing the highlight re-enables caching. Detailed views retain their existing animation suppression during motion.
- Geometry, marker, theme and viewport-size changes invalidate the cache. Disposal removes images, revokes blob URLs, cancels pending loads/timers and unsubscribes observers/store listeners. Full-scene overview reuse avoids decoding every connection again when zooming back out.
- `ArchitectureMarkers.jsx` resolves built-in marker objects once per edge revision. React Flow receives stable string references, reducing marker-ID work on viewport notifications. Exported/persisted edge data retains the original marker objects.
- The optimization applies to large Functional/CSU and aggregate CSC/CSCI scenes through `LiteSummaryDiagramReactFlowGitHub.js`. Existing detailed-view motion styling remains scoped to detailed views; it is necessary to avoid a sustained overview-zoom regression. JSON/XML/PNG export and print use native/model content; acceleration images are excluded from PNG cloning.

- Pinch now applies motion presentation in `onMove`, after D3's `scaleTo` extent reads. Applying it in `onMoveStart` forced layout of the large diagram before committing the camera transform. Other input types retain their early preparation; the +/− controls retain their original behavior. The new test exercises the actual React Flow pinch handler and asserts that extent reads precede the style change.
- Native SVG text wrappers explicitly override inherited visibility. Cached rendering now hides those wrappers as well, preventing duplicate aggregate labels. Print CSS restores native SVG labels even if printing begins before the idle callback.

No dependencies or release configuration changed. The existing unrelated review-memory changes were preserved. No commit, push, installer update or desktop release was performed.

## Validation build and method

Production assets: `/tmp/xhandle-overview-fix-20261031/accepted-build`.

Asset-manifest SHA-256: `447c3ae27601632b9f776589da3071e093f3c0c4ffa1349b9caddfe2cfb17559`.

Real Chrome and disposable Electron load the production App with synthetic IndexedDB records and fixture-only API responses. Installed applications, user profiles, customer data and the earlier desktop preview are separate. Tests run sequentially on the local Apple M2 / 8 GiB machine. Runtime, build, seeder and harness hashes are retained with the measurements.

Each performance case discards warmup gestures, then interleaves three repetitions of pan and zoom at overview, intermediate and close scales. Timings are rAF intervals during trusted input, not hardware presentation FPS. First-input intervals and separate traces are retained rather than discarded. Extended 96-input zoom sweeps measure cache transitions separately. Before measurements come from the earlier investigation with matching production fixtures; the large aggregate cases add correctness/performance coverage, without claiming a measured before/after speedup for those new fixtures.

## Results

The final build passed 5 performance/control cases, both curved/labelled visual cases and both editing/export/memory regressions, with no page runtime errors. Functional and CSU use the same 1,500-function / 3,000-connection fixture size in Chrome and Electron. Each main case includes three repetitions at overview, intermediate and close zoom, an extended sweep, light/dark visual comparisons and matched +/− versus pinch inputs. The final-build performance dataset contains 78 measured gestures, excluding warmups.

Overview p95 rAF intervals, milliseconds; all three samples are shown. These are scheduling intervals during input, not hardware presentation FPS:

| Runtime/view | Pan before | Pan after | Pinch before | Pinch after |
|---|---|---|---|---|
| chrome-functional | 133.3 / 150.0 / 133.3 | 33.3 / 33.4 / 33.4 | 50.1 / 50.1 / 50.1 | 16.8 / 16.8 / 16.8 |
| chrome-csu | 149.9 / 150.0 / 66.7 | 32.9 / 17.7 / 16.9 | 50.1 / 50.1 / 50.1 | 17.7 / 33.3 / 18.3 |
| electron-functional | 166.7 / 150.1 / 148.6 | 18.4 / 33.4 / 33.3 | 50.1 / 50.1 / 66.6 | 18.3 / 16.8 / 16.9 |
| electron-csu | 150.0 / 166.6 / 150.0 | 31.5 / 17.9 / 33.3 | 66.7 / 66.7 / 50.1 | 18.3 / 33.4 / 16.8 |

The earlier nine-case implementation matrix is retained separately in the [measurement artifact](../investigations/diagram-overview-performance-fix-2026-10-31.json), with its own build and harness hashes. It includes genuinely large CSC/CSCI scenes and traced attribution runs. Final-build validation adds the pinch-ordering correction and native SVG-label/animated-highlight safeguards. Do not confuse those earlier measurements with tests of the final bundle.

Each extended sweep delivers 96 trusted zoom inputs, moving in and back out across more than an eightfold scale range:

| Runtime/view | Median ms | p95 ms | Maximum ms | Frames with cache active |
|---|---:|---:|---:|---:|
| chrome-functional | 16.7 | 18.1 | 183.4 | 388/390 |
| chrome-csu | 16.7 | 33.4 | 201.9 | 351/355 |
| electron-functional | 16.7 | 18.3 | 216.7 | 364/374 |
| electron-csu | 16.7 | 34.5 | 200.0 | 322/330 |

### Pinch versus buttons

Matched 1.2× zoom inputs preserve cursor anchoring and direction in both runtimes; the reverse direction is also checked. Median first changed-transform rAF delay in milliseconds (button / pinch):

| Runtime/view | Overview | Close |
|---|---|---|
| chrome-functional | 32.2 / 156.6 | 27.4 / 132.8 |
| chrome-csu | 31.4 / 170.7 | 28.3 / 156.0 |
| electron-functional | 27.9 / 156.2 | 28.4 / 132.8 |
| electron-csu | 27.9 / 181.6 | 27.0 / 145.5 |

The preceding Chrome Functional build measured median pinch delays of 174.9 ms at overview and 166.6 ms close up. Deferring motion styles until after D3's extent reads removes a forced-layout step; the +/− controls keep their original path. These measurements still show a first-pinch pause. Sustained responsiveness and first-input latency are reported separately rather than treating a smooth median as proof that startup is fixed.

A separate stress test produces 120 trusted ctrl-wheel inputs at 8 ms intervals without waiting for each dispatch. All four final-build cases preserve the complete net zoom delta, return to the original camera and restore idle presentation. Two baseline Functional runs provide a direct comparison. Values are before / after; CSU has no equivalent baseline burst run:

| Runtime/view and scale | Median changed-frame interval ms | p95 changed-frame interval ms | First-to-last delivered input ms |
|---|---:|---:|---:|
| chrome-functional / overview | 50.1 / 17.2 | 67.5 / 66.8 | 3384.7 / 1674.8 |
| chrome-functional / close | 50.0 / 16.8 | 51.8 / 35.1 | 2959.8 / 1677.0 |
| chrome-csu / overview | — / 33.3 | — / 82.9 | — / 1901.4 |
| chrome-csu / close | — / 33.3 | — / 51.7 | — / 2103.9 |
| electron-functional / overview | 66.6 / 18.6 | 83.5 / 34.8 | 3281.2 / 1783.6 |
| electron-functional / close | 50.0 / 32.5 | 51.9 / 35.4 | 3145.8 / 1684.3 |
| electron-csu / overview | — / 33.3 | — / 50.1 | — / 2166.4 |
| electron-csu / close | — / 33.4 | — / 52.0 | — / 1903.9 |

The producer finishes in roughly 1.1–1.2 seconds, but delivery to the renderer continues afterward. Chromium coalesces the 120 dispatched inputs into 61–62 wheel events while preserving every delta. The diagnostic waits for idle relative to the last delivered event, because CDP can acknowledge an input before delivering it. Dispatch timing and delivery tails are retained separately in the artifact. These bursts show less backlog, but variable tail latency and occasional long frames remain; simulated CDP input is not a hardware-trackpad latency measurement.

A disposable Chrome-only attribution experiment also rasterized loaded SVG connection images to PNG before the gesture. It did not remove the first-pinch pause or materially improve the rapid-input result. That raster prototype was not added to the application; native/vector quality and the bounded production cache remain unchanged.

**Limits:** the preferred <=25 ms p95 target is not universal, and startup/cache-transition stalls remain. Cold, unsupported and animated aggregate scenes retain native rendering. The customer's M4 / 16 GB project was not available; this is not a zero-latency or unlimited-size guarantee.

### Visual and interaction correctness

24 light/dark overview/close comparisons passed. Most satisfy the raw criterion: fewer than 0.3% of screenshot pixels differ by more than 32 in any RGB channel. 4 curved overview comparisons required the additional perceptual check because native SVG and image compositing rasterize thin curves differently. Their largest raw difference was 1.3% of pixels. Those cases also verify every visible path and its computed stroke/fill/opacity against the native scene, and deliberately remove cached connections to verify that the comparison detects missing paint. The YIQ threshold is 0.15 (stricter than Playwright's 0.2 default), the allowed perceptual mismatch remains below 0.3%, and the missing-connections control must fail that same acceptance threshold and have greater mean channel error. This does not claim pixel identity during motion; native presentation resumes at idle.

The curved fixtures contain chrome: 507 nodes, 754 connections and 248 labels; electron: 507 nodes, 754 connections and 248 labels. Native hit-testing during cached movement and the animated-highlight native fallback pass. Node layout and connection IDs remain unchanged across measured camera gestures.

Both runtimes pass cancellation/blur/visibility loss, rapid restart, stationary release, zoom limits, keyboard selection/ports, source inspection, manual-route editing and reload, node-position editing and reload, and saved canvas notes. A routed connection remains visible and editable with both endpoints offscreen. JSON/XML exports retain all 500 functions and 1,000 relationships in the semantic fixture; actual PNG and PDF generation pass. Export/print restore native labels during movement. Chrome resize/DPR checks preserve route coordinates.

### Retention across navigation

Ten Architecture Diagram / Software Requirements cycles pass in each runtime, awaiting cache readiness and collecting garbage at equivalent checkpoints. Heap below is MiB, comparing warm cycle 2 to cycle 10:

| Runtime | Warm heap | Final heap | DOM-node growth | Document growth | Final motion images |
|---|---:|---:|---:|---:|---:|
| chrome | 75.1 | 75.8 | 0 | 0 | 1 |
| electron | 75.1 | 75.8 | 0 | 0 | 1 |

The diagnostic explicitly checks DOM/document accumulation and heap growth. An initial diagnostic retained DOM handles from its readiness wait; returning a boolean removed that test-induced retention. Application lifecycle tests separately verify image removal, blob revocation, pending-load cancellation and unsubscription.

The changes remain local. A representative customer graph should be tested on the M4 before declaring that customer's sluggishness resolved.

The remaining pinch investigation should trace the interval between committing the camera transform and presenting the first changed frame. The current tests show that removing forced layout improves the commit time, while a substantial first-frame delay survives even with pre-rasterized connections. More preparation work or a different rendering strategy needs measured evidence before adoption.

## Source checks

The production build succeeded. Seven focused Jest suites passed: **63 tests**, covering cache lifecycle/coverage/failure, pixel alignment, markers, existing component paint, handles, routing, Functional projection and architecture navigation. ESLint reported zero errors and the same eleven pre-existing warnings in the large diagram component; the new modules/tests have no warnings. Diagnostic syntax and `git diff --check` passed.

Comparison with the investigation's 784-file `src`/`server` snapshot found only the intended changes to `LiteSummaryDiagramReactFlowGitHub.js`, its paint test and `csuNavigation.css`, alongside the new cache/marker modules and tests.

## Reproduction

The implementation prompt is [here](../codex-prompts/fix-diagram-overview-sluggishness-2026-10-31.md). Reusable diagnostics live in `scripts/diagnostics/diagram-overview-{scenario,visual,sweep}.cjs` and `diagram-pinch-comparison.cjs` and `diagram-pinch-burst.cjs`, invoked by `desktop-interaction-performance.cjs`. The fixture builder accepts optional `PERF_CSC_GROUP_SIZE` and `PERF_CSCI_GROUP_SIZE`; existing defaults remain unchanged.

```sh
node scripts/diagnostics/build-desktop-performance-fixture.cjs /tmp/xhandle-interaction-seeder
node scripts/diagnostics/desktop-interaction-performance.cjs \
  --overview 1 --workspace cba --level CSU \
  --build /tmp/xhandle-overview-fix-20261031/accepted-build \
  --out /tmp/cba-overview-check.json --browser chrome \
  --nodes 1500 --rows 1000 --artifacts 100 --samples 3 \
  --cache 1 --visual 1 --sweep 1 --pinchCompare 1 --pinchBurst 1 --verify 1
```

Omit `--browser chrome` for disposable Electron. Use `--level Functional`, `CSC` or `CSCI` for other abstractions. The harness uses the local Electron and Playwright installations documented in its source; override `ELECTRON_PATH` and `PLAYWRIGHT_MODULE` if needed. Run rendering workloads sequentially. Raw traces, screenshots, exports and logs are in `/tmp/xhandle-overview-fix-20261031`; temporary artifacts may be removed by the OS.
