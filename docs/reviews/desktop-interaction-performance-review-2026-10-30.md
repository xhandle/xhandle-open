# Desktop interaction performance review — 2026-10-30

## Demonstrated outcome

The functional-project table had an unbounded editable DOM, and its diagram retained 32 subscribed React Flow handles per function. These are independently observable scaling costs in the **full production App**, rather than conclusions from a helper benchmark. Small shared-source fixes now window that table and retain only connected diagram ports while idle on large project diagrams. Complete ports return on hover, keyboard focus or selection. All relationships, rows, evidence and persisted analysis remain present.

**Code-Based Architecture (CBA) was measured separately.** Its existing windowed architecture, Functional-model, requirement/design and traceability renderers were exercised, alongside the saved hazard page renderer. Those earlier optimizations already exist in the release source. This review does **not** claim that the project-diagram fix optimizes CBA's separate diagram. A populated CBA CSU canvas still exhibits substantial pan/zoom frame spikes. Large saved-hazard searches also remain slower than page entry. These are outstanding findings, not concealed by loading indicators.

Nothing was committed, pushed, published, installed or updated. Native sources and the desktop submodule were not modified. No customer archive, profile, database or backup was opened, and no provider was called.

## Source, runtime and preservation

- Verified release reference: Desktop **0.2.12**, shared `614802c5eac5925a4ae197562ae8c31d130628e2`. This is also the shared checkout's HEAD. The customer's currently running build has **not** been reconfirmed.
- Read native `AGENTS.md`, `README.md`, package/build/runtime and smoke-profile setup. Native checkout `9c3e364badd1cc853419a8fadc9a13d4acb28836` pins that shared commit and declares Electron **45.0.0**. Its worktree remained clean.
- Initial status/diff: `/tmp/xhandle-interaction-20261030/preexisting-status.txt`, `preexisting.patch`. The pre-optimization tracked/untracked source snapshot is `/tmp/xhandle-interaction-preoptimization-source`; its source hashes are `preoptimization-source-sha256.json` in the diagnostics directory. These distinguish prior authorized work from this task.
- Preserved prior logical-item Storage UX; project retention, restoration, permanent deletion and guards; hazard idle-state fix; large-upload `sha.js` fix/dependency/tests; archive/export/import compatibility; and their diagnostics/reports. Only this task's small App table integration, project diagram port rendering, shared virtual-search reveal behavior and regression tests were added to runtime work.
- Isolated release source was extracted with `git archive HEAD` into `/tmp/xhandle-interaction-20261030`. Its production assets are `/tmp/xhandle-interaction-release-build`. Dependencies were resolved from the existing shared `node_modules` via a symlink, **not** a separate release-lock `npm ci`; the dirty tree adds `sha.js`. This is a release-**source** comparison, not a binary reproduction of the signed installer.
- Pre-optimization production assets: `/tmp/xhandle-interaction-current-build`. Intermediate optimized assets: `/tmp/xhandle-interaction-optimized-build`. Final assets: `/tmp/xhandle-interaction-final-build`. The final source additionally increments a row-focus request for repeated navigation; the larger matrix on the intermediate build is labeled separately. Final functional and CBA interactive checks use the final build.
- Build asset-manifest and entry-JS SHA-256 identities, fixture identities, raw-result hashes and runtime versions are recorded in [the compact measurement artifact](../investigations/desktop-interaction-performance-measurements-2026-10-30.json). Raw bundles, source maps, profiles and traces remain in `/tmp`.
- Host: Apple **M2**, arm64, **8 GiB RAM**; build Node **20.20.2**. Renderer runtime: Electron **45.0.0**, Chromium **156.0.8078.48**, V8 **15.6.75.19-electron.0**. This is not the customer's M4/16 GB machine. Native README recommends Node 22.12+ for native build work; no native build was performed.

## What was actually run

`scripts/diagnostics/desktop-interaction-performance.cjs` loads the complete CRA production entry, stylesheet, App, tables, workers and diagrams. It does not replace a renderer, swap a panel for a no-op, mount a private UI fork, or use a development server. `build-desktop-performance-fixture.cjs` builds a **storage seeder only** from the shared storage/model modules. Deterministic local fixture responses construct a valid saved Functional model without network/provider requests.

Electron uses a fresh temporary `userData`, visible BrowserWindow, `xhandle://app` privileged scheme, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, normal GPU acceleration, denied permission requests and fixture-only API/network interception. The harness imports no updater and acquires no installed-app single-instance lock. Only created processes are closed. Its fresh profiles live under the OS temporary directory (`xhandle-full-app-perf-*`).

This is **full-App Electron renderer coverage**, not full packaged Desktop parity: the narrow native preload, authenticated loopback API/utility backend, installer, native menus, real IPC/data transfer and updater are not exercised. No packaged-version or backend-overhead conclusion follows. Chrome is an additional fresh-context control, with its runtime and DPR identified independently; it is not treated as the identical Chromium binary or native window geometry.

Baseline builds precede the new runtime edits. Navigation timing starts before trusted click input, waits for populated target content/diagram readiness, then two animation frames. It includes automation/input delivery and rendering. Cold entry is a single observation per fresh profile, not a claimed p95. Project warm-switch stress uses 20 round trips (40 tab entries); CBA uses initial entries plus three full passes across seven primary surfaces. CBA per-view sample counts are small: report medians/ranges, not a statistically established tail guarantee.

Pan uses trusted middle-button drag input. Pinch uses trusted CDP wheel input with the Ctrl modifier; scale samples must change. Table scrolling uses trusted wheel input and asserts actual scroll displacement. Frame distributions come from rAF **during these real inputs**, with initial samples discarded; they are frame-interval indicators, not direct display/presentation FPS guarantees. Three gesture samples are retained individually. CPU profiling/tracing adds overhead equally within matched runs. Sums of nested trace events are inclusive attribution, not additive CPU utilization.

Measurement corrections are retained transparently:

- Exploratory `current-500` had a 23.2 s cold-entry outlier; the repeat was 2.89 s. It is not evidence of a 23 s stable regression versus release.
- The early `after-500` port-hover check could scroll hidden canvas ancestors, leaving later pointer coordinates outside the active pane. Its `transformChanged: false` gesture samples are **excluded**. Its table measurements and separate persistence checks remain useful.
- The diagnostic now resets canvas ancestor scrolling, finds an unobstructed visible pane point, records intermediate transforms, and rejects unchanged pan or pinch scale. A gesture can legitimately return to its initial transform; intermediate changes establish movement.
- The exploratory CBA 500 run completed its rendering/tab/scroll matrix but its final extra project-navigation check timed out against a collapsed sidebar. Its `.partial.json` is retained and labeled partial. Validated baseline/final runs explicitly reveal the sidebar. No incomplete run is called a passed full scenario. A zero-cycle Chrome exploratory run also reached the end of its performance matrix but failed its extra graph-return step because the scenario was still on the safety tab; the validated rerun explicitly returns to Architecture Diagram first. Final extra repository checks explicitly reopen the project after reload, matching App’s intentional dashboard startup. Those harness corrections do not alter application sources. The final Electron and profiling runs finished the corrected extra checks with a temporary driver assist applying the same missing project/menu clicks; the checked-in scenario now performs those clicks itself. The validated Chrome rerun completes directly with that corrected scenario. A final self-contained Electron run (`final-cba-semantics`, same final production assets, no driver assist) also passes every CBA edit, repository, link, selection and restoration assertion. Rendering/timing phases precede those extra checks; assisted waits are not included as performance observations.

## Fixtures and storage versus memory

Functional projects use 100/500/1,500 functions, respectively 200/1,000/3,000 directed relationships (ring plus cross-links), long editable descriptions, source metadata, and 1,000 saved hazard records. Actual project hazard presentation also expands relationship/guide variants; the 1,000 saved records are not assumed to equal displayed logical variants. A small second project supports scope switching. Saved grid positions remove automatic-layout variability from the project graph comparison.

Their inactive IndexedDB history contains **25.2 million evidence characters** across 24 records. This is saved data, not one artificial 634 MB Blob. For example, the 500-node project map is about **0.717 MB UTF-8**, while browser storage usage for the separately persisted repetitive history is about **1.22 MB**. Logical strings, browser storage accounting/compression, active JS heap and process resident memory are different measurements.

CBA fixtures contain a real project/repository connection, a second repository and second project, source/file allocations and excerpts, deterministic node/edge/trace IDs, ready Functional annotations, 200 or 1,000 persisted architecture relationships, and four linked **1,000-row** software/system/subsystem/design collections. Traceability is constructed by the actual chain builder. Hazards have 12 populated columns with 15,000 or 50,000 saved rows, execution evidence, narrative inputs and an inactive checkpoint.

At 15,000 hazard rows the Summary is **6.393 MB JSON/UTF-8**; source evidence is **12.433 million characters**, referenced again by narrative input and separately saved in a checkpoint. At 50,000 rows the Summary is **21.363 MB**; browser estimated total persisted usage was **17.15 MB**. The main table need not hydrate every execution-evidence field. These are deterministic workload dimensions, not estimates of expansion of the customer's reported 634 MB archive. No archive expansion ratio for that customer is known.

## Measurements

The machine-readable artifact contains individual runs, per-view commits/long tasks, request counts, frame distributions, memory samples and source/build identities. Raw evidence directory: `/tmp/xhandle-interaction-20261030/`; trace names end `.trace.json`, sampled V8 profiles `.cpuprofile`. Normal build logs, final matrix logs and failed exploratory-run diagnostics are retained there.

### Functional-project production results

All tab stress values below use 20 samples per tab. Cold/table-first-entry values are individual observations. Intermediate large/small runs precede only the final repeated-focus-request addition; final 500-node checks include it.

| Workload / measure | Release source | Current pre-optimization | Optimized |
| --- | ---: | ---: | ---: |
| 500 nodes: cold entry (ms) | 2,889.9 | 2,942.1 | 2,423.0 |
| 1,000 functional rows: first Table entry (ms) | 656.6 | 638.2 | 160.2 |
| 1,000 rows: warm functional median (ms) | 634.6 | 669.9 | 168.6 |
| 1,000 rows: warm functional p95 (ms) | 728.3 | 992.6 | 175.0 |
| Hazard tab: warm median (ms) | 275.8 | 279.4 | 210.9 |
| Mounted functional table rows | 1,000 | 1,000 | 10 |
| Total App DOM in table mode | 59,918 | 59,918 | 10,244 |

| Additional current → optimized workload | Before | After |
| --- | ---: | ---: |
| 3,000 rows: warm functional median (ms) | 2,533.9 | 455.4 |
| 3,000 rows: warm functional p95 (ms) | 4,241.0 | 481.3 |
| 3,000 rows: mounted table rows | 3,000 | 10 |
| 3,000 rows: total table-mode DOM | 178,918 | 29,244 |
| 200 rows: warm functional median (ms) | 178.1 | 92.3 |
| 500-node navigation: post-GC heap (MiB) | 148.9 | 76.6 |

The matched trusted-input 1,500-node comparison uses `before-1500-validated` and `after-1500`. Each cell lists three independently sampled gesture frame-interval p95s in milliseconds; these are **not** three estimates of a customer-wide FPS.

| 1,500-node project viewport | Before | After |
| --- | --- | --- |
| pan | 99.5 / 100.7 / 166.5 | 18.3 / 18.3 / 18.5 |
| zoom | 83.4 / 83.4 / 83.4 | 18.4 / 18.4 / 18.4 |

At 500 nodes, port counts fall from **16,000 to 2,000**, with all **1,000 edges** retained and exact path equality through hover restoration. Final project UI checks pass. Ordinary table-scroll frame intervals were already near the observed refresh interval; the strongest demonstrated table win is **mount/reentry cost and DOM/memory reduction**, not a promised universal scroll-FPS increase.

### CBA production results — independent coverage

Matched fixture: 500 functions, 1,000 architecture relationships, 15,000 saved hazards, 1,000 rows in each artifact collection. Cold entries below are single observations. Warm values are **median (min–max), n=3**, excluding the initial entry. Safety Remediation is initial UI with no saved findings, not a populated-remediation-list benchmark.

| CBA view | Cold before → final (ms) | Warm before (ms) | Warm final (ms) |
| --- | ---: | ---: | ---: |
| Architecture Table | 356.4 → 223.5 | 107.8 (107.4–122.4) | 106.6 (106.3–107.2) |
| Software Requirements | 504.4 → 385.9 | 362.4 (262.5–442.3) | 278.1 (271.1–425.0) |
| System Requirements | 301.0 → 384.7 | 401.7 (267.2–412.9) | 398.0 (263.7–412.0) |
| Subsystem Requirements | 303.2 → 402.6 | 242.1 (230.8–242.4) | 243.1 (233.8–258.4) |
| System / Subsystem Design | 316.1 → 399.5 | 234.1 (229.4–240.6) | 233.9 (233.5–238.3) |
| Traceability Matrix | 350.1 → 434.1 | 249.3 (247.7–250.4) | 252.1 (248.8–269.8) |
| Hazard & Remediation | 265.2 → 348.7 | 199.6 (152.0–202.0) | 200.5 (185.6–219.0) |

| CBA single-observation coverage | Before (ms) | Final (ms) |
| --- | ---: | ---: |
| Cold Architecture Diagram | 894.7 | 895.1 |
| Abstraction CSC | 447.2 | 486.6 |
| Abstraction CSCI | 159.4 | 181.0 |
| Abstraction Subsystem | 157.7 | 174.8 |
| Abstraction Functional | 576.3 | 605.4 |
| Abstraction CSU | 829.6 | 824.1 |
| Functional Model Table | 264.7 | 285.0 |
| Hazard next page | 250.2 | 333.7 |
| Hazard search last row | 970.9 | 1,018.7 |
| Safety Remediation | 139.7 | 140.7 |

These CBA differences are observations of an already-windowed path, **not claimed CBA performance fixes**. Its separate renderer was not changed. Final CBA assertions pass for project reentry, persisted repository preference plus actual App reload/reselection, source details, graph selection, identical saved positions through tab reentry, offscreen requirement search/edit/reentry and a table link selecting its CSU node. Direct repository-selector interaction, source-file preview content, saved remediation-list scaling and CBA free-node drag/resize remain unmeasured.

| CBA 500-function gesture: frame-interval p95s (ms) | Current before | Final Electron | Chrome control (DPR 2) |
| --- | --- | --- | --- |
| cbaPan | 83.4 / 83.4 / 67.4 | 100.5 / 83.3 / 67.4 | 83.4 / 84.3 / 67.0 |
| cbaZoom | 83.6 / 67.7 / 84.0 | 116.7 / 99.2 / 83.4 | 66.7 / 84.3 / 82.9 |

Chrome **156.0.8078.79** also reproduces slow CBA viewport frames. Electron uses Chromium **156.0.8078.48**. Both use DPR 2; their window/viewport geometry and runtime defaults differ. This countercheck argues against treating the wrapper alone as the demonstrated cause.

### React commit attribution and compositor evidence

Separate **production profiling build**, 100 CBA functions / 15,000 hazards / 1,000 artifacts per collection. These single observations expose React render durations and are **not** used in the normal-production latency comparisons. Root `actualDuration` is unavailable in normal production; normal runs still record commit counts and V8/trace attribution. Duration sums are render work, not an input-to-paint timer or layout/paint duration.

| Profiled CBA entry | Commits | Summed root actualDuration (ms) | Largest commit render duration (ms) |
| --- | ---: | ---: | ---: |
| Cold Architecture Diagram | 34 | 139.8 | 38.4 |
| Functional Model Table | 8 | 6.7 | 3.6 |
| Software Requirements | 37 | 45.1 | 12.4 |
| System Requirements | 35 | 28.1 | 4.4 |
| Subsystem Requirements | 34 | 29.8 | 5.0 |
| System / Subsystem Design | 34 | 29.3 | 4.7 |
| Traceability Matrix | 28 | 7.9 | 3.0 |
| Hazard & Remediation | 13 | 19.4 | 4.6 |

Extended final CBA pan trace: `SkiaOutputSurfaceImplOnGpu::SwapBuffers` spans reached **67.3 ms** and `GpuChannel::ExecuteDeferredRequest` / `RendererRasterWorker` spans **50.6 ms**. These GPU-service/raster/presentation waits align with a scene-rendering bottleneck; overlapping/nested thread spans must not be added as elapsed time. This is not a diagnosis of defective hardware or a reason to disable acceleration. The normal current CPU profile additionally identifies Zustand notification/comparison work in the unpruned project diagram.

Final CBA idle heap after diagnostic GC was **119.8 MiB** after its additional edit/scope checks; the earlier 100-function CBA repeated-tab run returned to **77.8 MiB**. Different scopes/checks are not a before/after leak test. The project paired post-navigation heap comparison above is at the same pre-verification point. No monotonic retained-heap leak was established by these short tests.

## Ranked findings and changes

### P1 repaired — project functional table mounts the entire editable dataset

Trigger: Table/split entry or reentry into a functional project. `src/App.js:18815` previously mapped every filtered row directly into textarea cells, callbacks and source-link controls. The 3,000-row fixture produced **178,918 total App DOM elements**, and warm functional reentry had a **2.53 s median / 4.24 s p95** in the original pre-optimization stress run. The separate CBA tables already used `VirtualTableBody`; they were not the source of this specific defect.

Change: reuse the existing measured-height windowing body with overscan, active-editor retention and complete model-backed search. Filtering is memoized by immutable row-array/filter identity (`App.js:12179`), rather than rebuilt during unrelated App renders. Review/selection, editor callbacks, row identity, row counts, source links, copy and CSV still use the complete model. No row/evidence truncation or storage schema change. The table is keyed by project, so measurements/active keys retire on scope change. A monotonic focus-request token makes repeated source navigation to the same row reveal it again, even before the previous highlight expires.

Cost/risk: small App integration; highest regression risk is offscreen focus/search and active editors, hence explicit regressions and browser edit/reload checks. It reduces initial DOM and mounting work, not every upstream whole-model transformation.

### P1 repaired — project diagram's idle Handle subscriptions scale with all ports

Trigger: pan/pinch in the project diagram, even at fit where all functions remain visible. `LiteSummaryDiagramReactFlow.js:824` previously mounted 32 Handles per function: **16,000** at 500 functions and **48,000** at 1,500. CPU sample mapping identifies React Flow's Zustand `setState`/`shallow` subscription notification path during viewport gestures. This is not evidence that App itself rerenders 48,000 times.

Change: `LiteSummaryDiagramReactFlow.js:2335` reuses the existing `withCsuVisibleHandles` policy at the same large-graph threshold as CBA (250 nodes or 500 edges). Every referenced source/target Handle stays mounted, including parallel edges and self-loops. Unspecified ports retain normal defaults; small graphs keep every port. Hover, focus and selection expose all ports. React Flow remeasures only a changed port set. No route algorithm, edge visibility, node coordinates, source rows or saved settings change. The existing helper's connected-endpoint/fallback tests and actual project-node interaction regressions cover this extension.

Cost/risk: small node renderer/presentation integration, no new cross-project cache. Exact edge path equality before/after hover restoration is checked in Electron; port and keyboard/selection behavior are regression-tested. Node dragging/new connections outside this fixture still need normal customer workflow verification.

### P1 unresolved — populated CBA diagrams remain expensive despite existing optimizations

Trigger: actual CSU graph with 500 functions / 1,000 edges, hierarchy containers and text. This mounts **628 nodes, 1,000 edges, 3,024 Handles and 11,758 DOM elements** in the measured CBA fixture. `LiteSummaryDiagramReactFlowGitHub.js:4125` intentionally keeps `onlyRenderVisibleElements={false}` to preserve routes crossing the viewport and avoid React Flow 11's whole-edge visibility scan. Existing connected-port pruning and movement decoration suppression are active. This task does not undo those fixes.

The populated CBA pan/zoom traces still show large frame gaps. In one intermediate run, pan p95s were **98.3 / 85.0 / 68.7 ms**, and pinch p95s **85.4 / 68.7 / 84.6 ms**. Renderer JavaScript FunctionCall totals were roughly **193–298 ms** across **3.3–5.1 seconds** of gesture sampling; layout/style/paint and GC also occur. Most gaps do not correspond to >50 ms JavaScript long tasks. Thus there is evidence of a rendering/presentation bottleneck, but insufficient evidence to label a particular GPU driver, Electron, accessibility subsystem or single edge algorithm the cause. Extended compositor traces and a Chrome control are retained for follow-up.

There were **zero instrumented renderer object-store reads/writes** during those CBA gestures. The whole saved project is not being read on each viewport frame in this fixture. That statement excludes worker-internal database activity; the gesture path itself does not request hazard rows. No blanket acceleration setting or speculative rendering rewrite was applied.

Estimated cost/risk of repair: large; renderer/compositor attribution and a correctness-tested rendering design, rather than a safe one-line optimization. Route-aware visibility or overview rendering must preserve manual offscreen-crossing edges, labels, selection, tools and source/detail navigation. A simplistic endpoint cull would violate correctness.

### P2 unresolved — first project entry performs nonvisual hazard work

Trigger: selecting a functional project with many relationships, even before opening Hazard Analysis. App builds relationship/guide-phrase targets and display rows (`App.js:685`, `:8799` vicinity), normalizes headers/cells, aligns saved rows, computes classifications/widths and derives diagram hazard links. V8 cold-entry profiles map substantial samples to `normalizeAllocationText` and `classificationResolutionStatus.js` cleaning/normalization. Large graph mounting remains another cold-entry cost.

Repeated normal-production cold observations range from roughly 2.9 s at 500 functions to 8.75 s at 1,500 before these changes. These are whole-App observations, not a pure graph-layout timer. The table/port fixes reduce some cost but do not remove this derived-data path. Avoid describing a loading indicator as an optimization. Estimated follow-up cost/risk is medium-to-large because this path also supplies audit and navigation semantics. Moving/gating this work needs exact equality and freshness tests for hazard variants, classification, source links, active contexts and editing/recovery.

### P2 unresolved — CBA hazard mode transitions and global scans

`App.js:7955` selects paged reads for the hazard view and complete retained-table working sets for other consumers; restoration is gated away from ordinary architecture entry until details request hazards. Revision checks, cancellation/transaction retirement, scoped preparation and paged workers already exist. CBA tables were measured with all this real App wiring, not a no-op loader.

Unchanged requirement/design entries often perform 24 renderer object-store requests to reload the four artifact collections. Switching from hazard paging back to a consumer of the retained Summary can issue hundreds of chunk requests as its read mode changes. Source loading, hydration and preparation are separate from table scrolling; normal steady scroll did not repeatedly read the complete dataset. Request counts cover instrumented **renderer IDBObjectStore methods**, not IDBIndex calls, worker reads, disk bytes or native clone costs. Exact transferred bytes for opaque structured-cloned values were not measured; fixture serialized bytes are reported separately rather than invented as read-byte measurements.

All-row hazard search scans in a worker and remains complete: the 50,000-row last-ID search took **2.49 s** in one observation, while entry was about **302 ms median** and next-page input about **216 ms**. The scan is background work rather than evidence of a 2.49-second main-thread freeze. Search latency and worker lifecycle are real remaining costs; the full dataset was not truncated to the first page. At 1,000 artifacts/collection, traceability and the requirement/design tables remain windowed, but their complete preparation/chain models still scale with total rows. Larger-than-tested artifact/traceability collections are not cleared by these results.

Initial legacy/raw artifact display also caused one-time normalization/checkpoint writes; repeated unchanged entries stopped those writes. This is not proof of an ongoing save storm in the customer's modern saved data. Context mutation, continuation, full CSV mutation and narrative actions can still resolve complete runs and were not performance-benchmarked here.

## Critical-path and lifecycle audit

| Path | Actual work and boundaries |
| --- | --- |
| Project tab click | React App state; functional-row commit when leaving diagramming; mount/unmount real surface; complete hazard target/display preparation depends on content/context; native layout and first two usable frames. Warm table DOM is now bounded. |
| CBA scope entry | Small project/repo metadata → cancellable IndexedDB tree read → cooperative trace-ID normalization and immutable adoption → real architecture/Functional derivation → React Flow hierarchy/measure/layout. Scope changes abort/retire old reads and guard publication. App intentionally starts on its dashboard after reload; tests explicitly reselect the project. |
| CBA tabs | Real artifact storage/recovery, hazard read-mode restoration, bounded/prepared virtual table or computed traceability chains. The table is not an isolated component substitution. |
| Table wheel | Existing CBA/assurance virtual bodies listen passively, coalesce viewport updates to rAF, measure natural row heights with ResizeObserver and retain the active editor. Full filter/search/copy models remain complete. The project table now shares this path. Offsets can still be O(total rows) after measurement changes; not a disk-backed table. |
| Diagram viewport | React Flow transform/store subscribers, visible node/edge SVG/HTML, labels/markers and compositor. Project viewport persistence is a small `onMoveEnd` localStorage write (`LiteSummaryDiagramReactFlow.js:5504` vicinity), not full-project JSON on every pointer frame. CBA motion handlers toggle decorations; position writes are coalesced at 120 ms and flushed on owned hydrated unmount (`GitHub.js:2870`, `:3112`). |
| Graph edits/fit/resize | Node/edge revisions drive geometry/layout/route work. Saved layouts and port paths were checked; fit and abstraction changes were exercised. Explicit clean/auto-layout, free node dragging, resize stress and manual route editing were not comprehensively benchmarked. Neither renderer uses a measured minimap hotspot here. |
| App fan-out | Monolithic App state and recreated JSX/callbacks remain; data-changed events coalesce an App tick at 150 ms (`App.js:3909`). Production StrictMode does not have development's double effect invocation. React Flow commits alone do not establish App-wide rerenders; sampled CPU/commit evidence is retained. |
| Background storage | Existing backup gates/single-flight, cancellation/revisions and prepared-cache budgets remain. No automatic backup destination was configured in disposable profiles. No evidence here of idle full-profile backup reads or paid polling as the gesture cause. Manual full backups/import/export remain separate large-allocation paths. |
| Native boundary | Stable scheme, sandbox and GPU status checked safely. GPU composition/rasterization are enabled. Backend utility IPC/protocol API/auth overhead, packaged preload, real accessibility clients, customer DevTools/logging state, sleep/wake and the customer's OS/display are not measured by the external harness. |

The preservation check found **no unexpected changes** outside this task’s five source/test files when compared with the initial source snapshot; package/lock and prior authorized source hashes remain intact. Native status stayed clean.

No new module-level retained-project cache was introduced. Filter memoization retains only the current App revision; virtual rows release on tab/project unmount, prune removed height keys and disconnect observers/listeners/frames. Port presentation depends on current nodes/edges and has no timer/worker/global cache. After navigation, heap samples show reclamation after diagnostic GC rather than establishing an unbounded leak. Process peak memory includes fixture seeding and native/GPU allocations; post-GC heap is not process RSS. A short 20-cycle run cannot certify an overnight session.

## Verification and remaining acceptance work

- Final focused run: **18 suites passed; 216 tests passed, one existing test skipped**. Covers project graph/manual/system behavior, connected ports, keyboard/selection restoration, virtual editor retention and repeated reveal, offscreen matching-cell search/filter updates, Quick Search, CBA table/assurance/traceability preparation, hazard tables/paging/restoration, durable recovery and archive/checksum/export compatibility. Log: `regressions-final.log`.
- Fail-before: copying the new regression tests into the isolated release source produced **three expected failures** (two idle-port interaction cases and offscreen matching-cell centering), with 47 tests passing. Log: `fail-before.log`. This modifies only temporary test files, not release runtime assets or either repository's baseline sources.
- Actual-App Electron assertions include bounded project table DOM, search to a previously unmounted last row, edited data surviving tab/project switch and reload with full row count, connected-port geometry equality, and restored hover ports. CBA assertions/checks include populated abstraction modes, actual table scrolling, all-row hazard search/page navigation, selected graph node, source details, and saved positions across tab reentry. Final additional CBA edit/repository/source-link checks are identified in the measurement artifact rather than inferred from project tests.
- Final normal production build and separate **production profiling** build passed with repository warnings. Profiling-build timings are used for React commit attribution only and are not mixed with normal-production before/after latency/FPS comparisons. Build logs: `final-build.log`, `profiled-build.log`.
- Final targeted ESLint: **zero errors, 27 existing warnings**. The test import-order issue was corrected. `git diff --check` passed.
- No full-suite green claim: the known hazard-eval fixture failures were neither masked nor used to justify skipping affected focused checks. The full suite, live AI, real customer data, packaged/native smoke and installer build were not run. Native smoke is required if native runtime code changes; none did here.

### Staged follow-up design

1. **CBA canvas first:** correlate extended `cc/gpu/viz` traces with presented frames, raster/layer costs, labels and viewport-store selectors on the same 500-function/1,000-edge fixture at recorded DPR. Compare the Chrome control without conflating different engines/window sizes with an Electron defect. Add dense/manual-route and 1,500-function CBA variants before choosing renderer changes. Acceptance: repeated trusted transforms, stable edges/ports/selection, restored decorations/layout, and a fixture acceptance target of median near 16.7 ms / p95 ≤33 ms on a 60 Hz display over three gestures, with zero avoidable >50 ms viewport JavaScript tasks; do not promise a universal FPS.
2. **Route-aware rendering:** use content/position/handle/manual-route revisions for geometry caches and spatial route bounds; retain crossing edges when both endpoints are offscreen. Consider a lightweight overview layer with accessible/selectable full detail on demand. Bounded scope caches must retire on project/repo/content/context changes. Reject a naive endpoint-only cull or permanently hiding labels/tools.
3. **Cold project derivation:** separate exact hazard/trace data preparation from App's first visible diagram commit. Pre-index headers/matches and move measured nonvisual work to cancellable bounded batches/worker inputs. Verify byte/value-equivalent analysis and complete navigation/search before accepting latency gains. Do not eagerly structured-clone all evidence into every worker request.
4. **CBA read-mode and preparation reuse:** measure the full→paged→full transition by content/storage revision. Prefer bounded association/detail providers for consumers that do not need an entire Summary. Keep pending edits authoritative and explicit invalidation/cancellation; no arbitrary TTL or stale cross-repository reuse. At larger artifact sizes, stage/cancel traceability-chain preparation rather than building another monolithic retained App object.
5. **Customer validation:** after explicit authorization for a later build, confirm Help → Build information first, then collect a short local trace around cold/warm tab entry, table wheel and diagram pan/pinch, with view/abstraction, displayed row/node/edge counts, DPR/display refresh and memory samples. Record archive compressed bytes separately from import/storage usage and working set. Collect task names/timing/aggregates first; source paths/content, profiles and screenshots can be sensitive and should remain local unless the customer explicitly chooses an appropriate sharing route.

A customer running 0.2.12 would need a **later separately authorized build** to receive the new shared-source changes. This review did not create, release, install or advertise such a build as already present, and does not promise elimination of sluggishness on their project.

## Reproduce safely

Use the existing dependency installation and explicit external output paths. No live backend is needed; renderer network/API requests are intercepted. Substitute paths for Electron, Chrome and Playwright through `ELECTRON_PATH`, `CHROME_PATH` and `PLAYWRIGHT_MODULE`.

```sh
CI=false PUBLIC_URL=/ REACT_APP_BACKEND_URL='' REACT_APP_XHANDLE_REVIEW_MODE=false \
  BUILD_PATH=/tmp/xhandle-perf-build npm run build
node scripts/diagnostics/build-desktop-performance-fixture.cjs /tmp/xhandle-perf-seeder
node scripts/diagnostics/desktop-interaction-performance.cjs \
  --build /tmp/xhandle-perf-build --out /tmp/project-perf.json \
  --nodes 500 --rows 1000 --cycles 20 --verifyports 1 --verify 1
node scripts/diagnostics/desktop-interaction-performance.cjs \
  --build /tmp/xhandle-perf-build --out /tmp/cba-perf.json \
  --workspace cba --seeder /tmp/xhandle-perf-seeder/seed.js \
  --nodes 500 --rows 15000 --artifacts 1000 --cycles 3 --verify 1 --gpuTrace 1
# For capacity coverage: --nodes 100 --rows 50000 --artifacts 1000
# For a Chrome control: --browser chrome --dpr 2
# For commit attribution, build separately with: npm run build -- --profile
node scripts/diagnostics/summarize-desktop-performance.cjs \
  /tmp/xhandle-interaction-20261030 /tmp/desktop-perf-summary.json
```

Run builds/tests and interactive benchmarks sequentially to avoid contention. Each benchmark creates its own disposable profile, retains local diagnostics, and closes its own runtime. Never point it at the installed user's profile or at a live production service.
