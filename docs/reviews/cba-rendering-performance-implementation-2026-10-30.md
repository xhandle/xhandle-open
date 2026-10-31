# CBA rendering performance implementation — 2026-10-30

The matched 500-function/1,000-relationship CBA scene now meets the preferred ≤25 ms pan/zoom p95 target in both actual Chrome and Electron renderers. The complete graph remains mounted. The 1,500-function scene improves substantially but still exceeds the target; first-input stalls also remain. This is renderer evidence on an Apple M2 with 8 GiB RAM, not validation of the customer's M4/16 GB machine or 634 MB archive.

The work follows [the implementation prompt](../codex-prompts/implement-cba-rendering-performance-2026-10-30.md) and [the preceding review](desktop-interaction-performance-review-2026-10-30.md). Individual results, hashes and checks are in [the measurement artifact](../investigations/cba-rendering-performance-implementation-2026-10-30.json). Raw builds, profiles, traces, screenshots, exports and failed diagnostic attempts remain in `/tmp/xhandle-cba-implementation-20261030/`.

## Changes and evidence

Marker-bearing SVG paths used element opacity: .92 for ordinary CBA edges and .58 for compact aggregates. Keeping every node, handle and relationship mounted while hiding only the edges reduced 500-function frame intervals from roughly 83 ms to roughly 17 ms. Setting only path opacity to 1 produced a similar reduction. This isolates SVG paint/compositing rather than data loading or a missing diagram as the main cost. Route-wide opacity composites the path and its arrowheads together; long routes make that intermediate surface expensive.

CBA now retains stroke alpha with `strokeOpacity` and arrow alpha in marker paint, leaving path element opacity at 1. This also preserves attenuation under the existing important dark-theme stroke rule. Selection, trace colors, bidirectional arrowheads, routing and interaction paths remain. Paint alpha can look slightly different where an arrow's fill, outline and shaft overlap; this is not a pixel-identical change.

Chrome still showed roughly 33 ms zoom p95 after the alpha fix alone. A transient `will-change: transform` on the large CSU viewport reduced it to near one display interval. The hint shares the existing motion presentation boundary and releases when idle, cancelled, blurred, hidden, switched or unmounted. A source-event timestamp and gesture epoch reject React Flow 11's delayed previous `onMoveEnd`, which otherwise cleared the next gesture's hint and labels. React Flow also omits its end callback when a pinch is already at a zoom bound or a pointer is released without moving. A 300 ms fallback on wheel inactivity/final pointer release now restores detail in both renderers, while held pointers remain active; all release listeners and timers clean up on scope change/unmount. Actual D3 tests captured five failing cases before this fix. PNG export restores detail before cloning computed styles; print restores labels even during a gesture. There is no culling, offscreen-edge scan, new geometry cache, per-frame persistence or permanent viewport promotion.

Independent functional-project controls exposed the same opacity cost. The existing presentation cache and connected-port pruning remain; built-in hex-colored marker objects receive the same paint-alpha treatment. Custom marker URLs, unfamiliar marker colors and explicit stroke-opacity styles retain their prior presentation and may retain its cost. Chrome functional zoom also needed a transient viewport hint; a separate functional CSS scope keeps all labels and ports visible and retains existing viewport saving. Promoting every functional pan caused a measured Electron regression, so a constant-time scaling-gesture gate now limits that hint to zoom; a new translation clears any preceding zoom hint. Consecutive pinch-wheel starts preserve the existing hint because React Flow emits a separate start/end for each wheel event; repeatedly removing it would recreate the compositing cost. Actual scale changes provide the fallback for touch transitions. History snapshots take base paint from authoritative edges while preserving live topology and handles, preventing undo from applying alpha twice. Functional JSON exports now describe the new rendered paint fields; schema, relationships, persisted route colors and data remain unchanged.

Stronger interaction checks also exposed two existing CBA correctness defects. Node double-clicks bubbled into canvas edge hit testing and opened an underlying edge's editor; node handling now stops that propagation. Ordinary CBA mount requested a fresh arrangement despite saved node coordinates; the wrapper now uses the existing saved-position restoration path on initial entry. Explicit Arrange and missing/new-node layout still work. Restored hierarchy bounds are reconstructed around saved absolute function coordinates, so group border dimensions need not be pixel-identical to a fresh packed layout.

## Measurements

Each headline cell lists three separate trusted-input gesture samples after discarded pan/zoom warmups. Before every sample the harness fits the same scene and waits for a stable transform. Frame intervals are restricted to the first/last trusted input, with intermediate pan transforms and actual scale changes required. Setup and idle tails are excluded. First-input latency and maxima are recorded separately; rAF cadence is not guaranteed display FPS. Diagnostic traces and presentation isolates are excluded from headline comparisons.

| Workspace/runtime (500 functions) | Before pan p95, ms | After pan p95, ms | Before zoom p95, ms | After zoom p95, ms |
|---|---:|---:|---:|---:|
| CBA, Chrome | 83.3 / 83.3 / 83.3 | 16.8 / 17.4 / 17.7 | 83.4 / 83.4 / 84.3 | 16.8 / 16.7 / 17.6 |
| CBA, Electron | 67.6 / 67.7 / 82.6 | 16.8 / 17.6 / 17.6 | 83.4 / 83.4 / 83.4 | 17.5 / 17.6 / 17.6 |
| Functional project, Chrome | 83.3 / 83.4 / 83.4 | 16.8 / 17.0 / 16.8 | 83.4 / 83.4 / 83.4 | 17.4 / 17.5 / 17.1 |
| Functional project, Electron | 66.8 / 66.7 / 66.7 | 17.5 / 16.8 / 16.8 | 83.4 / 83.3 / 83.3 | 16.8 / 16.8 / 17.6 |

These complete CBA scenes were measured before the final no-op gesture cleanup fix. Paint, geometry and promotion policy are unchanged by that lifecycle fix; final-asset acceptance runs cover 500 functions. “Before” is a range of the three baseline samples; small/dense scenes are coverage runs without a matched baseline.

| Functions / relationships; runtime | Cold graph, ms | Before pan / zoom p95, ms | After pan p95, ms | After zoom p95, ms |
|---|---:|---:|---:|---:|
| 100 / 200; Chrome | 669.8 | — | 16.8 / 17.6 / 17.1 | 17.6 / 16.8 / 17.6 |
| 100 / 200; Electron | 650.1 | — | 17.6 / 16.8 / 17.6 | 17.6 / 17.3 / 17.6 |
| 200 / 2,000; Chrome | 1314.4 | — | 17.5 / 17.7 / 16.8 | 16.8 / 17.1 / 17.4 |
| 200 / 2,000; Electron | 1270.4 | — | 16.8 / 16.7 / 16.9 | 17.2 / 17.4 / 17.6 |
| 1,500 / 3,000; Chrome | 2609.9 | 300.0–316.5 / 533.4–550.1 | 83.3 / 133.4 / 83.4 | 66.7 / 66.6 / 50.9 |
| 1,500 / 3,000; Electron | 2146.0 | 300.0–316.7 / 350.0–565.8 | 66.7 / 100.0 / 66.7 | 50.0 / 50.0 / 50.1 |

At 500 functions, the scene still mounts 628 nodes, 1,000 relationships and 3,024 handles (about 11,758 DOM elements). Chrome first-input-to-rAF maximum 63.5 ms, active-frame maximum 50.0 ms, and 1 recorded long task(s) in the busiest gesture phase; Electron first-input-to-rAF maximum 65.8 ms, active-frame maximum 66.7 ms, and 1 recorded long task(s) in the busiest gesture phase. Earlier complete runs also observed first-input delays up to 65.1 ms. Functional results were Chrome 45.5 ms startup / 17.7 ms active-frame maximum; Electron 46.5 ms startup / 33.4 ms active-frame maximum. All per-sample values remain in the artifact. This does not establish stall-free 60 FPS.

At 1,500 functions, 1,884 nodes, 3,000 relationships and 9,072 handles remain mounted. Gesture phases recorded 35–38 long tasks; first-input delay reached 338.3 ms in Chrome and 182.4 ms in Electron. This is a remaining capacity limit. During the first pan, Chrome’s largest renderer RSS changed 406,128 → 609,968 → 713,280 KiB (before/input-end/settled); Electron Tab working set changed 1,244,976 → 1,332,144 → 1,364,736 KiB. Final 500-function values were Chrome 374,768 → 442,560 → 431,904 KiB; Electron 401,984 → 444,096 → 454,976 KiB. Process memory varies with allocation and reclamation and is not exact GPU texture memory; before/end/settled GPU-process samples are also retained. All measured CBA gestures performed zero IndexedDB reads/writes.

At 1,500 functions, the profiled promoted intermediate build spent 1,310 ms across 39 `Layerize` calls and 1,375 ms in paint lifecycle across 41 calls, versus about 413 ms in JavaScript `FunctionCall` over the sampled pan. These are inclusive, non-additive trace categories. Hiding edges reduced pan to 18.5 ms; hiding HTML labels with `display:none` did not materially improve it. An additional SVG compositor hint left zoom around 50 ms and was not retained. This points to Chromium layer assignment for the dense SVG scene as the remaining limit, not demonstrated dominant handle subscriptions. Unused group ports were not removed: they are existing connection targets.

| CBA runtime | Cold graph before → after, ms | Warm Architecture Table median before → after, ms | Warm System Requirements median before → after, ms | Table-scroll p95 range before → after, ms |
|---|---:|---:|---:|---:|
| Chrome | 1058.1 → 1245.8 | 121.1 → 121.5 | 403.1 → 403.2 | 16.8–33.3 → 17.5–17.6 |
| Electron | 1101.1 → 1154.0 | 122.3 → 124.1 | 409.9 → 391.2 | 16.8–18.6 → 16.8–17.6 |

The eight CBA table scrolls moved offsets 0 → 5,400 with bounded mounted rows. Individual first-tab samples vary; earlier Chrome Subsystem/Design/Traceability entries were 80–105 ms slower while Electron was mixed or faster. These small cold samples do not establish a general tab-speed improvement. The baseline full CBA runs completed these measurements but later failed the preexisting node-dialog bug; they are explicitly partial artifacts. Final full runs passed subsequent project/repository, details and edit checks.

| Functional project runtime | Cold graph before → after, ms | First table before → after, ms | Warm functional tab (table view) median before → after, ms | Table scroll p95 before → after, ms |
|---|---:|---:|---:|---:|
| Chrome | 2693.7 → 2755.5 | 140.8 → 551.0 | 171.4 → 186.8 | 16.7 → 17.1 |
| Electron | 2622.8 → 2709.5 | 154.7 → 167.7 | 150.7 → 168.5 | 16.7 → 16.7 |

The warm functional-tab measurements refer to its table view, not a diagram remount. Table offsets moved 0 → 6,000 in every matched run; exact offsets, mounted rows and five alternating navigation cycles are recorded.

An exact additional Chrome full run on the same final assets measured first-table entry at 177.2 ms with 5 commits, versus 551 ms / 21 commits in the headline run. Both results are retained. The 551 ms observation did not reproduce in that repeat; its cause is unresolved, and this small sample does not establish uniformly unchanged first-entry latency.

Table scrolling uses its existing distinct measurement protocol and is not pooled with graph gestures. Actual scroll offsets must change; mounted rows remain bounded. Complete saved-hazard search and nonvisual hydration remain separate costs. No speculative table refactor was added.

## Correctness and validation

Actual CBA checks in Chrome and Electron passed light/dark marker paint, complete exports, rapid restart/cancellation and stationary pointer release, crossing routes whose two endpoints are offscreen, manual corridor editing and reload, minimum/maximum zoom 0.02/1.8 including idle restoration after further unchanged pinch input, keyboard ports, source navigation, exact saved absolute node positions, unchanged other-node positions, and note restoration. Chrome additionally exercised viewport resize and DPR 1 → 2 restoration. The full CBA scenarios checked abstraction changes, project switching, repository switching by reload, artifact search/edit restoration and complete saved-hazard search. No page errors occurred.

Across 20 equivalent CBA table/diagram navigation cycles after explicit diagnostic GC, Chrome: 1 document, 14,116 DOM nodes and 6,121 listeners throughout; CDP JS heap 88.42 → 89.94 MB, last ten samples 89.62–89.98 MB; Electron: 1 document, 14,116 DOM nodes and 6,121 listeners; cycle 2 briefly reached 14,172 nodes / 6,127 listeners, returning to those initial counts from cycle 3 through 20; CDP JS heap 87.65 → 90.32 MB, last ten samples 89.99–90.32 MB. There is no observed cumulative DOM/listener growth; small heap drift remains, so this short run is not proof of a strict plateau or absence of every leak. The earlier five-cycle semantic runs and both memory measures are preserved.

CBA JSON/XML checks verify complete relationship/model counts. CBA PNG checks invoke the actual application export and verify decoded image dimensions plus restored label visibility; it captures the current viewport, as before, rather than fitting the complete graph. Print produces an actual populated PDF. Screenshot inspection verifies visible routes, arrowheads and labels.

The new regression suite mounts real CBA/functional renderers and React Flow, supplying only browser layout/observer shims in jsdom. It covers paint and real marker resolution, dark theme, selected/compact/bidirectional edges, history undo/redo, double-click routing, held rapid gestures, scope/cancel/unmount cleanup, and saved layout versus explicit arrangement. Baseline browser/unit failures identify the original opacity, node-dialog and layout-restoration defects. Exploratory failures from marker URL parsing, locator/visibility assumptions, native Electron download transport and subpixel handle measurement were diagnosed and retained separately; they are not claimed runtime regressions. Path comparison now records all control-coordinate differences within a 0.01-layout-unit tolerance, dropping only adjacent near-zero L legs; IDs, node transforms and persisted positions remain exact. Manual crossing-route checks retain exact path equality.

Validation passed: 177 tests in 16 affected suites; targeted ESLint with zero errors and 24 existing warnings; production build; syntax checks for all five diagnostic scripts; and `git diff --check`. The unrelated complete repository suite was not rerun. Test/build logs are `root-verified-regression-tests.log`, `root-verified-lint.log` and `final-build.log` in the task directory.

Reproduce a CBA run with `node scripts/diagnostics/build-desktop-performance-fixture.cjs /tmp/cba-fixture`, then `node scripts/diagnostics/desktop-interaction-performance.cjs --build <production-build> --out <result.json> --workspace cba --nodes 500 --rows 15000 --seeder /tmp/cba-fixture/seed.js --trace 0 --verify 1`. Add `--browser chrome` for Chrome; the default is disposable Electron. Use `--graphOnly 1` for isolated graph timing, `--renderingChecks 1 --interactions skip` for semantic checks, or `--renderingChecks memory --memoryCycles 20 --interactions skip` for retained-memory cycles. Functional controls use `--workspace functional-project --verifyports 1 --verifyPaint 1 --cycles 5`. Both measured builds must use the same fixture and timing method.

## Identity, preservation and limits

Asset-manifest SHA-256 identities (full source/entry-asset hashes are in the artifact):

- Baseline: `b26b8d03487915a464026233f3c045bba425853115f675acfddf950028de572d`.
- Final: `77b18f68e71c14037ad734934751e51303641fdb0d0522f030afb1af1312c566`.
- CBA size matrix before the final no-op gesture cleanup: `41f27d69ad55bf532780cd3aee231fc9db2d0edd112c91ca977bf3a7b1e04177`.
- Prior accepted 500-function build, before no-op gesture cleanup: `4ef3fe307ca68227cde1dfb1d492480753bed490f03a17c1396d3a69f459ea7f`.

The final lifecycle patch adds bounded idle cleanup for unchanged wheel/pointer gestures; the earlier size matrix uses the same paint, model, geometry and promotion policy. Both workspaces’ full 500-function runs, CBA semantics/exports and 20-cycle memory checks were repeated on the final assets in both runtimes. Intermediate/isolated builds are named separately and excluded from headline results. Baseline source preservation covers 1,493 files: none missing, nine preexisting files intentionally changed, with new tests/CSS/diagnostics/reports separate. Native repository status remained clean. The canonical seeder SHA-256 is `8d4fe5329c47fa9a5e318bbced5d7da38c50a7c700b7a4950a63589ac34994c7`; dense cross-link generation is optional and the default fixture is unchanged.

The harness runs the full production App with fixture-only services in fresh disposable profiles. Chrome is 156.0.8078.79; Electron is 45.0.0 with Chromium 156.0.8078.48; build Node is 20.20.2. CBA fixtures include 15,000 saved hazards and 1,000 rows per artifact collection; their Summary is 6.393 MB JSON and source evidence is 12.433 million characters, separately referenced by a checkpoint. These are synthetic workload dimensions, not an archive expansion estimate. Both use recorded DPR 2. Chrome and Electron content/pane geometry differ slightly because of native window decoration; every before/after comparison is within the same runtime and recorded geometry, not an absolute cross-runtime speed claim. Cold entries are individual observations and warm tab samples are small; no customer-wide percentile guarantee follows.

Electron evidence covers a BrowserWindow running the real shared App, not packaged preload/backend/installer parity. Native sources remain untouched. No customer profile/archive, provider call, commit, push, install or release was used. Local Chrome can receive the shared source after rebuild/reload; the customer's installed desktop app requires a later authorized build.
