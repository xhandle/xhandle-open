# Dense overview cache follow-up — 2026-10-31

**The initial-pinch delay remains unresolved.** The user confirms it occurs both on first opening and after returning to a fully zoomed-out diagram and waiting. This follow-up fixes a related cache-capacity problem and validates the change, but the matched measurements do not demonstrate a startup improvement.

## Capacity correction

The previous build exceeded the unchanged 8 MiB captured-markup budget on a synthetic diagram containing 5,000 functions, 5,280 displayed nodes and 10,000 connections. Its cache reported `Edge image budget exceeded` and used native rendering.

`architectureEdgeMotionCache.js` now stores repeated computed paint in a stylesheet local to each acceleration image. Identical styles share a generated class; distinct colors and other paint remain distinct. Accessibility and interaction metadata are removed only from the image clone. The native SVG, its accessibility metadata, interaction targets, path geometry, markers, labels and model data remain authoritative.

The same dense graph now produces a **5,904,214-byte image (5.63 MiB)** at DPR 2 and reports a ready cache. All 5,280 nodes and 10,000 native connections remain present. Markup, layer, pixel and side-length limits are unchanged. This addresses avoidable fallback without increasing the memory budget or omitting connections.

The new regression checks shared/distinct paint, exact path preservation and unchanged native interaction/accessibility elements. The visual diagnostic now resolves both inline paint and shared stylesheet paint when comparing cached paths to native paths. Its tolerances and missing-connections negative control are unchanged.

## Startup measurements

The matched dense comparison used headless Chrome at DPR 1, the same fixture, two repetitions in each zoom direction, and the application's 0.02–1.8 zoom limits. These are renderer measurements on the local Apple M2 / 8 GiB machine, not physical-trackpad latency or customer M4 measurements. Cache readiness or fallback was awaited before input; this is repeated-overview evidence, not cold first-open acceptance.

Median time from trusted input to the first rAF with a changed camera transform, milliseconds:

| Dense graph / scale | Previous button | Updated button | Previous pinch | Updated pinch |
|---|---:|---:|---:|---:|
| Overview | 197.7 | 159.6 | 715.7 | 757.5 |
| Close | 90.9 | 108.6 | 504.6 | 503.8 |

The new cache is available, but these results do **not** establish an improvement in first-pinch latency. An earlier exploratory headless DPR 2 run did not deliver the expected matched zoom amount and failed its assertion; it is excluded from this comparison. The diagnostic now reports failed scale measurements explicitly and accepts configured zoom limits so clamping is checked correctly. Warmup can be disabled explicitly and is recorded in the methodology.

The ordinary headed Chrome and Electron regression matrix uses 1,500 functions / 3,000 connections, three sustained-gesture samples at each scale, and two repetitions of matched button/pinch inputs in each direction. All four cases preserve gesture semantics and report no runtime errors:

| Runtime/view | Overview first button, median ms | Overview first pinch, median ms | Sustained overview pinch p95, three samples ms |
|---|---:|---:|---|
| Chrome Functional | 31.7 | 155.1 | 16.8 / 17.2 / 16.9 |
| Chrome CSU | 46.6 | 179.3 | 17.9 / 18.3 / 18.1 |
| Electron Functional | 44.0 | 144.9 | 16.8 / 16.8 / 17.8 |
| Electron CSU | 30.8 | 170.3 | 18.4 / 17.8 / 18.4 |

Sustained pinch remains responsive on this fixture. Pan intervals and occasional long frames still exceed the preferred 25 ms target, so this is not a universal smoothness guarantee. The [prior first-input traces](diagram-trackpad-followup-2026-10-31.md) identify expensive style recalculation when the large scene switches from idle to motion presentation. Reducing that transition cost while preserving the now-working continuous gestures remains the implementation task. More cache capacity alone is insufficient.

## Regression validation

- **64 tests across seven Jest suites pass** on the final source. The production build succeeds with existing warnings; ESLint reports no errors or warnings for the changed cache module and its tests. The tooling still reports stale Browserslist data.
- Four headed Functional/CSU cases cover 72 measured sustained gestures, matched +/− and pinch inputs, two-finger pan in both axes, reversal, cursor anchoring, unchanged page scroll, preserved layout and connection IDs, and idle restoration.
- **24 visual comparisons pass** across light/dark and overview/close scales. Four curved overview comparisons also require exact visible path/paint coverage and a missing-connections negative control. Maximum perceptual mismatch is 0.193%, below the unchanged 0.3% threshold. Both labelled CSC fixtures retain 507 nodes, 754 connections and 248 labels. Connection selection during cached motion and native animated highlights pass.
- Chrome and Electron pass manual-route and node-position editing with reload, crossing routes whose endpoints are offscreen, source inspection, keyboard interaction, notes, zoom bounds, cancellation and rapid restart. JSON/XML retain 1,000 connections/rows in the semantic fixture; actual PNG export and PDF printing pass.
- Ten tab-switch cycles in each runtime show **zero DOM-node or document growth**. Post-GC heap growth from the warm checkpoint is approximately 0.62 MiB in Chrome and 0.55 MiB in Electron. Cache lifecycle tests cover URL revocation, pending-load cancellation and unsubscription.

These checks found no functional regression in the covered cases. They do not prove every project is regression-free, and the customer's graph and physical trackpad were not available. Cold first-open latency and the reported initial pause remain open acceptance criteria.

## Local artifacts

The tested production bundle is `/tmp/xhandle-dense-startup-20261031/dense-build`. Its asset-manifest SHA-256 is `fba8724403db04ab03a0f9b5478e22e8f43f0c135e5dd3389282d43e0012732e`.

The [measurement artifact](../investigations/diagram-dense-cache-followup-2026-10-31.json) records build, source, seeder and harness hashes, runtime/hardware information, complete input samples, visual comparisons and memory checks. Raw logs/screenshots/exports are under `/tmp/xhandle-dense-startup-20261031`. The [implementation prompt](../codex-prompts/fix-diagram-overview-sluggishness-2026-10-31.md) includes these findings and the unresolved acceptance criteria.

Application changes in this follow-up are confined to compacting the existing motion image; input handlers, controls and the native diagram renderer were not changed. The user's open Electron preview retains the previously validated bundle. No commit, push, release, installed-app update or customer-data change was performed.
