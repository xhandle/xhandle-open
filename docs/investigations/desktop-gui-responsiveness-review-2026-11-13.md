# Desktop GUI responsiveness review — November 13, 2026

## Findings

The large-project lag is reproducible in the actual signed xHandle Desktop 0.2.16 application. The most consequential opportunities are graph rendering, unnecessary hazard hydration during requirements navigation, and synchronous mounting/preparation of large Design Management views. These are separate problems: a slow data load is not always a blocked input thread.

This is a review with live measurements, not an implemented optimization. Production application/native source, installed applications and working profiles were left unchanged. Changes in this working tree are diagnostic scripts, synthetic fixture support, the review prompt, and this report/evidence summary. No commits, pushes, installs or releases were made for this review.

| Priority | Demonstrated issue | Evidence | Proposed change |
| --- | --- | --- | --- |
| P0 | Detailed CBA graphs exceed a usable frame budget at project scale. | The signed app with 4,000 functions / 5,000 relationships has sustained active pan/zoom frame intervals above 100 ms. The 4,000 / 8,000 stress case is slower still. All functions/relationships are present. | Reduce per-camera-update subscriptions and full-scene style/paint work; introduce geometry-aware visibility/level-of-detail only with complete edge/navigation preservation. |
| P1 | Returning to software requirements unnecessarily reconstructs the saved hazard table. | Across 25 warm returns: median **1,365 ms** input-to-usable content, versus **151 ms** for hazard reentry. Each software return issues **1,188 hazard-chunk reads**, plus 76 assurance-row reads and three root/metadata reads. | Keep a revision-scoped lightweight hazard descriptor across tabs. Load the full table only for a consumer that needs it; move integrity/assembly work off the input thread, preserving validation. |
| P1 | Design Outline, Table and Document eagerly mount every requirement/object. | For 2,000 requirements plus topic/section objects: Outline **1,578 ms**, Document **1,325 ms**, Table **512 ms**. Maximum observed long tasks: **1,457 / 1,162 / 94 ms**, respectively. Table mounts **42,658 DOM elements**. | Window the outline/table and mount document sections incrementally. Maintain an indexed complete model for numbering, search, navigation, edits and export. |
| P1 | HTL preparation and first Design search perform large synchronous projections/hashes. | A saved 26,278-assessment / 60-group HTL opens in **1,598 ms**, with a **1,461 ms** task. Searching for the final requirement takes **1,635 ms**, with a **1,308 ms** task. | Prepare revision-scoped HTL group/signature/search projections in a worker; retrieve original assessments on demand. Keep every assessment and its identity. |
| P2 | Other populated views still have substantial initial mounting costs. | Safety Case with 300 authored nodes: **768 ms**, maximum task **562 ms**. System Test with 1,000 tests: **833 ms**, task **706 ms**. | Profile and bound diagram/list mounting; virtualize the test table. Apply shared rendering infrastructure where it fits each view's semantics. |

The headline view numbers above are single-run observations, not p95 guarantees. The repeated CBA data-load results and graph experiments are detailed below. No improvement factor is claimed for an unimplemented change.

## What was actually run

- Host: Apple M2 MacBook Air, 8 CPU cores, 8 GB RAM, macOS 27.0. Native measured viewport: 1440 × 809 CSS pixels, DPR 2; visible foreground windows. GPU compositing/rasterization/WebGL are enabled.
- Shared checkout: `20a34d25bdd9ffa7d2ccfc09e82859d296f2b92c`, with diagnostic-only working changes. The tested production renderer bundles shared application `93b793d3d20dcca46fa95c4ae16e259ec8737092`. The intervening committed changes are documentation; application sources have not changed.
- Native checkout: `601fd273ff8f2207b4e49a0005ac809d2c874741`; frozen packaged application build `30856a92a93c4fcd461688e54dc3fb76be3f4f0d`, version 0.2.16. Later native changes are verification tooling/documentation. No native runtime edits were made here.
- Electron 45.0.0 / Chromium 156.0.8078.48 / Node 24.22.0 inside Electron. Diagnostic orchestration uses Node 22.23.4 and a temporary cached Playwright Core 1.64.1 installation.
- Native-shell runs load the unmodified actual main/preload/backend and production `stage/renderer`, with a bootstrap that sets an isolated profile before loading the shell. Signed-app runs launch the existing `dist-signed/.../xHandle` binary directly. Those runs verify `app.isPackaged`, canonical profile identity, embedded build information and renderer entry hashes.
- Signed-app update checks are replaced **in memory in that isolated process** with a no-update result; download/install/relaunch options are disabled. External requests are blocked. The application binary, installed app and normal update configuration are not modified. Backend state and all fixtures belong to the disposable profile.
- The Chrome control (157.0.8103.51) uses the same production renderer, graph fixture, input sequence, viewport and DPR. Its API responses are local fixtures; it does not run the Electron backend/preload. This is a rendering control, not an otherwise identical OS/runtime environment.

No customer project export was provided. These are synthetic, persisted, schema-compatible workloads, not measurements of the user's private avLocalizationWithOutHDMap project. The signed-app representative graph has 5,000 relationships, close to the historically reported 4,981; the 8,000-relationship graph is explicitly a stress case. Fixture functions and topology are synthetic, so these timings do not predict the exact customer project.

The fixtures retain persisted CBA hazard assessment tables, processed functional hierarchy, source metadata, approximately 12.4 million characters of saved source evidence plus a checkpoint, four assurance collections, and other project/repository entries. Large runs have 26,278 assessment rows and 4,000 rows per assurance collection. The broader run adds 2,000 requirements, a 60-group HTL retaining all 26,278 assessments, a 20-document engineering project with large stored manifests, ten saved Markdown reports, 300 authored safety-case nodes, 1,000 test cases and an 80-message thread.

## Active-input method and interpretation

All measured interactions use trusted Playwright/CDP mouse or keyboard input. Graph readiness checks require all requested function nodes and relationship paths. Pan/zoom acceptance requires changing real camera transforms and trusted input events. Table scrolling verifies the actual scroll container moved. No production table, diagram, worker or UI component was replaced with a no-op renderer.

Navigation measurements distinguish locator/setup lead time from browser event timestamp to ready content plus two animation frames. The resulting `inputToUsableMs` still includes readiness polling/transport and is an approximate observed upper bound, not Event Timing/INP. A two-frame container-only readiness check is not treated as a populated-view benchmark. Timings of a 20-event wheel sequence are gesture durations, not the latency of one scroll event.

Final signed-app graph measurements discard warmup, require rAF intervals wholly within the active-input window, retain raw frame intervals, and verify multiple observed viewport transforms. Earlier exploratory graph captures can include one boundary-crossing frame; use the final signed-app captures for precise frame statistics. Gesture zero is profiled; later gestures provide lower-overhead repeats. Frame observations within a gesture are correlated, so their percentile estimates are not independent-trial population estimates.

CPU profiles and bounded timeline traces cover active interactions. Source-map attribution separates application code, React/React Flow/store subscriptions, browser work and Playwright's injected locator code. In particular, expensive `getTextAlternativeInternal`/locator traversal is harness overhead and is not reported as application rendering time. Reported long tasks come from the renderer observer; overlapping timeline categories are not summed into one purported total.

Three independently restarted native-shell stress runs measure first project entry after synthetic seeding/reload. This is a cold project-view measurement, not cold OS disk caches or application startup. The CBA reentry experiment measures 25 software/hazard cycles with memory snapshots every five cycles. It completed those measurements, then an outdated harness readiness assertion expected a graph after selecting another project while the hazard tab was retained; that subsequent assertion timed out. It is a harness failure, not evidence of a product freeze or a wholly passing end-to-end scenario. Early readiness-selector and fixture-bootstrap failures are retained in temporary logs and excluded from performance conclusions. The final broad run completes all 25 measured actions with zero page errors.

## Graph measurements and rendering experiment

| Runtime / fixture | Input to usable graph | Pan: median of gesture frame medians | Zoom: median of gesture frame medians |
| --- | ---: | ---: | ---: |
| Native shell, 4,000 functions / 8,000 relationships | 4,957 ms median across three independent first entries (4,915–4,996 ms) | 183.3 ms (five gestures) | 199.9 ms (five gestures) |
| Foreground Chrome, same 4,000 / 8,000 scene | 5,237 ms (one entry) | 183.3 ms (five gestures) | 199.6 ms (five gestures) |
| Signed desktop, 4,000 / 5,000 representative scene | 3,854 ms (one final entry) | 125.0 ms (five gestures) | 133.4 ms (five gestures) |
| Signed desktop, same 4,000 / 5,000 scene, **edges hidden for diagnosis only** | Not an opening optimization test | 75.0 ms (two gestures) | 83.45 ms (two gestures) |

The signed representative scene mounts 5,024 total nodes (including hierarchy containers), 5,000 paths and **72,625 DOM elements**. The stress scene has the same 5,024 nodes and 8,000 paths. Gesture zero includes CPU/timeline instrumentation; the other four baseline gestures do not. Warmup is excluded. Five gestures do not establish a reliable population p95; raw final frame intervals are retained in the evidence JSON.

In the final signed-app trace, one style recalculation lasts approximately **227 ms**; sampled zoom work includes about 529 ms in React DOM, 422 ms in shallow store comparison and 212 ms in the selector shim over the gesture. These sampled exclusive costs and overlapping trace categories describe attribution, not an additive elapsed-time breakdown.

Hiding edges leaves the same source data and DOM counts but materially reduces gesture cost. This supports edge drawing/style work as a contributor, while the remaining 67–100 ms ordinary frame intervals show that removing edge paint alone does not make the scene smooth. This experiment removes an essential presentation feature and is **not** an acceptable product fix or a claimed before/after implementation improvement.

Chrome is similarly slow for the matched stress fixture. That supports a shared renderer limit in this experiment; it does not prove the user's reported Chrome/desktop difference is nonexistent. Their real dataset, runtime versions, saved layouts, view/zoom state and memory conditions still need a matched customer-copy comparison.

## Confirmed paths and optimization requirements

### 1. Large graph camera updates and full-scene cost

The CBA graph deliberately sets `onlyRenderVisibleElements={false}` in `src/components/LiteSummaryDiagramReactFlowGitHub.js:4239`. Earlier fixes explain why simply enabling React Flow's default visibility logic would be unsafe: it scans on viewport changes and can omit manually routed edges crossing the viewport when both endpoints are outside it. Preserve that behavior when designing a replacement.

The 4,000/8,000 stress scene mounts **96,625 DOM elements** and uses roughly **580 MiB renderer JS heap** after opening in one run. Its renderer working set is approximately **1,013 MiB**, a different metric. These are observed loaded values, not post-GC retained memory or a leak diagnosis.

Active CPU profiles implicate React Flow's store/equality/selector updates, React work, and browser rendering. In the 1,500/3,000 zoom trace, exclusive sampled time includes about 231 ms in the external-store selector shim, 194 ms in Zustand shallow comparison, and 256 ms in React DOM. An `UpdateLayoutTree` slice takes about 154 ms. Corresponding motion-presentation changes occur in the diagram's handlers around lines 2300–2370. These observations identify a shared rendering critical path; `(program)` samples alone are not a GPU diagnosis.

Recommended sequence:

1. Attribute and reduce per-node/per-edge subscription fan-out for a camera-only transform; retain cached geometry keyed by graph/layout revision rather than camera position.
2. Reduce full-scene motion-style invalidation and SVG paint cost while preserving labels, ports and routes. Treat the edge-visibility experiment below only as attribution.
3. If necessary, add a spatially indexed rendering layer or level-of-detail that includes viewport-crossing routes, selected/focused targets and offscreen search navigation. Consider a canvas-backed edge layer only after quantifying the remaining cost.

Acceptance: retain exact graph identities, saved positions, ports, selections, routes and detail/source navigation; compare both small and 4,000-function graphs with repeated foreground gestures. Target a large reduction toward 16.7–33 ms frames on the same hardware, with no avoidable app-caused 100+ ms pauses. Do not drop nodes/relationships, impose an arbitrary data limit, or call invisible edges a product optimization.

### 2. Hazard read mode causes avoidable rehydration on requirements navigation

`src/App.js:7773` chooses `paged` only for the hazard-analysis tab and `complete` for other consumers. `src/features/code-architecture-hazard-analysis/useHazardRunRestoration.js:7` includes this read mode in the restoration scope. Alternating between hazard and requirements therefore retires/reloads that scope even when the project, repository and saved analysis revision are unchanged.

The resulting working-set path uses `hydrateHazardRun(..., tableOnly: true)` in `codeArchitectureHazardStore.js:198`; `hazardRunChunks.js:127` reads/verifies all table pages, reassembles tokens and hashes page content. Profiles show approximately 537 ms of sampled SHA-256 work under that hydration path during one requirements entry. The 25 warm requirements measurements show 1,188 `hazardRunChunks.get` calls per entry. Adding their asynchronous durations would double-count overlapping reads; the wall-clock input-to-usable metric is the relevant total.

Most warm cycles have no single task over 50 ms, so the persistent 1.36-second delay is primarily repeated preparation/I/O, not a claim of a 1.36-second continuous input freeze. Cold hydration and other view work can still produce long tasks.

Keep a lightweight source descriptor/revision for display and source availability, and load only the needed summary projection. Preserve corruption checks and revalidate `(project, repository, run ID, generation, storageRevision)` before consumption/publication. Full derivation, export and explicit evidence inspection may still need more data; perform that work deliberately, with cancellation and worker ownership. `artifactUtils.js:318–354` also rereads durable assurance arrays; use revision-aware cache checks to reduce duplicate reads without trusting stale edits.

Acceptance: 25 hazard/requirements returns should not repeatedly assemble the same 26,278-row table. Verify fresh writes, partial/incomplete/damaged runs, context/organization changes, cross-project switches and current-revision derivation. Do not suppress integrity checks or make stale cached content appear current.

### 3. Design view mounting and HTL/search preparation

`src/features/requirements/components/RequirementsViews.jsx:252` recursively renders every outline branch; the table maps all rows around line 561. `src/features/design-management/artifacts/ArtifactWorkspace.jsx:232` maps the entire document into sections. Long tasks and DOM sizes demonstrate that CSS scroll containers alone do not bound mounting work.

Window the table and visible outline tree, use stable row identities, and progressively mount document sections. Keep a complete model for numbering, find/reveal, edits, source navigation, accessibility and exports. A row outside the viewport must remain searchable and editable after navigation. Preserve one complete requirement per child object and the existing blank requirement-title presentation.

HTL first render runs `outsideSafetyScope` and consolidation from `HazardTrackingTable.jsx:43–44`. `actionableHazardFamilies.js:8–10,48–49` computes projected semantic signatures on the foreground thread, even evaluating the signature when family metadata is absent. The captured open includes about **590 ms sampled hashing** on this path and 330 ms in hazard field projection. WeakMap reuse does not survive new IndexedDB object identities.

Move grouping/signature validation into a revision-scoped worker projection and return compact groups plus assessment references. Retain full assessment storage and stable HTR numbering; fetch page-sized originals when expanding. A guard for missing family metadata is a small possible improvement for legacy records, but it does not solve hashing all current records and is not presented as a measured implementation win.

`designQuickSearch.js:58–77` reads artifacts sequentially but builds each artifact's entries synchronously. For an HTL, `artifactSearchEntries` consolidates the complete assessment set again before filtering. Cancellation is checked between artifacts, not inside that large operation. Use the same bounded revision-scoped search projection in a worker, with incremental/cancellable indexing and correct invalidation. Keep cross-document and off-page matches complete. The final run successfully locates requirement 1999, so do not trade away that search coverage for speed.

Acceptance: preserve all assessments and fields, equivalence membership, HTR identity/high-water marks, filters, column widths, edits and export content. Verify offscreen/filtered/collapsed matches, cancelled searches, edits during indexing, document switching and small-project behavior. Measure input delay as well as completion time.

### 4. Other app areas and background work

`VnVCenterPro.jsx:938` renders every filtered test case; the 1,000-case table has 9,426 DOM elements and a 706 ms opening task. Filtering to the last test is only 57 ms in this run. Prioritize bounding initial row mounting rather than assuming filter computation is the main problem.

The 300-node safety-case opening takes 768 ms / 562 ms maximum task. Profile node/edge/inspector mounting and evidence-list rendering independently before applying the CBA remedy wholesale. Its automatic evidence collector is mounted at app level and listens to focus/data changes on a 30-second catch-up interval (`safetyCaseEvidenceRuntime.js:9`). Potential competition with unrelated views deserves a controlled multi-project experiment; this review does not establish a runaway polling loop.

The engineering project overview is 99 ms despite 20 stored document manifests, consistent with its worker/compact overview design. The CBA assurance table and hazard table maintain bounded visible DOM while scrolling; hazard warm reentry is comparatively fast. Preserve those working patterns. Reports open in 118 ms, an 80-message Collaborator thread in 319 ms, typing in 96 ms, and Activities in 47 ms in the broad run. Collaborator already limits visible turns (`XHandleCopilotView.jsx:7838`); removing that protection would regress large histories.

Backup/export code has remaining whole-snapshot serialization paths (`localBackupService.js:391,682`), while project archives already stream/yield (`projectArchive.js:60,174`). These are source-supported opportunities to measure under concurrent interaction, not confirmed causes from a live transfer trace in this review.

## Coverage and limits

| Area | Live coverage | Remaining limitation |
| --- | --- | --- |
| Native desktop | Actual shell/preload/backend and signed app; fresh profiles; trusted inputs; repeated reentry | M2/macOS only; Windows/Linux runtime performance was not measured. |
| CBA | Complete detailed graphs, five abstraction switches, architecture table, four populated assurance views, traceability, saved 26,278-row hazard table, scrolling, 25 reentry cycles | Repository-switch/source-detail/edit recovery and cross-repository graph performance need a dedicated follow-up; one project-switch readiness assertion was obsolete. |
| Projects | Populated functional graph, draft hazard table and scrolling, issue-panel navigation | Issue panel is empty in this fixture; completed functional-project issue generation was not benchmarked. |
| Design Management | Folder contents; populated requirements Table/Outline/Document; 20-document project overview; full HTL, filter opening, assessment expansion, column resizing; cross-artifact search to the last requirement | SysML, native architecture artifact editing, bulk edits and multi-owner project generation were not performance-profiled. Raw HTL fixtures are saved assessments with synthetic manifests, not a claim of valid AI-generated issue summaries. |
| Reports | Ten stored reports; opening and rendering a long saved report | AI report generation and document export not measured. |
| Safety Case | 300 authored nodes, inspector/project selection, automatic collector present during broad run | Multi-case/multi-project background collector scaling and live evidence refresh under generation need measurement. |
| System Test | 1,000 saved test cases, populated document opening, last-row filter and scrolling | Full generation/execution and large attachment export not measured. |
| Collaborator | 80-message saved thread, visible history and typing | Live paid-provider responses, streaming-token workload, voice and external tools not measured. |
| Global / data operations | Sidebar/navigation, Activities, Design search and resizing; storage/read/write observers during real operations | Startup to a restored personal workspace, application-window resize, sustained import/export/backup/restore/deletion and global keyboard shortcuts across every area not benchmarked. Those gaps are not green checks. |

The missing customer export and other OS hosts limit attribution to that specific installation. Existing source invariants and tests are not substitutes for live performance evidence. No customer data, credentials, paid provider calls, production analyses or updater replacements were used.

## Next implementation plan

1. Separate lightweight hazard restoration from full consumers and remove repeated unchanged-table reconstruction. Add revision/cancellation/corruption regressions and rerun the 25-cycle test.
2. Prepare HTL grouping/signatures/search in a bounded worker projection shared between display and search. Preserve raw evidence, HTRs, manual changes and current-source validation.
3. Window Design and System Test tables/outline, then progressively mount documents with full offscreen search/reveal and complete exports. Recheck atomic requirement objects and editor selection/focus.
4. Address graph subscription, style invalidation and drawing cost using the measured traces. Verify complete manual-route geometry and selected/offscreen elements before any visibility or drawing-layer redesign.
5. Measure the remaining cross-project background and transfer cases, then repeat the most representative workflow on a safely exported copy of the user's actual largest project. Record small-project and Chrome controls alongside desktop results.

These stages need implementation authorization separately; this review does not ship them.

## Reproduction and evidence

Raw profiles, traces, run JSON, synthetic profiles and harness snapshots are under `/private/tmp/xhandle-gui-audit-2026-11-13`. The compact numerical evidence is in `desktop-gui-responsiveness-measurements-2026-11-13.json` beside this report. Large traces and generated assets are deliberately outside the repository. Final signed-app run records include entry hashes and embedded metadata. Failed exploratory runs remain in the temporary directory; their failed readiness intervals are excluded.

Use a temporary Playwright Core installation and Node 22+; no project dependency upgrade is required. The cached diagnostic version used here is 1.64.1. Example commands from the shared repository:

```sh
NODE_ENV=production node scripts/diagnostics/build-desktop-gui-audit-fixtures.cjs /tmp/gui-fixtures
PLAYWRIGHT_MODULE=/tmp/gui-tools/node_modules/playwright-core node scripts/diagnostics/review-desktop-gui-responsiveness.cjs --out /tmp/gui-broad.json --seeder /tmp/gui-fixtures/cba/seed.js --extraSeeder /tmp/gui-fixtures/extra.seed.js --nodes 100 --rows 26278 --artifacts 1000 --extras 1 --broadOnly 1
PERF_RELATIONSHIP_COUNT=5000 node scripts/diagnostics/build-desktop-performance-fixture.cjs /tmp/gui-5000
PLAYWRIGHT_MODULE=/tmp/gui-tools/node_modules/playwright-core node scripts/diagnostics/review-desktop-gui-responsiveness.cjs --out /tmp/gui-signed.json --seeder /tmp/gui-5000/seed.js --packaged 1 --nodes 4000 --rows 26278 --artifacts 4000 --graphOnly 1 --gestures 5
PLAYWRIGHT_MODULE=/tmp/gui-tools/node_modules/playwright-core node scripts/diagnostics/review-desktop-gui-responsiveness.cjs --out /tmp/gui-reentry.json --seeder /tmp/gui-fixtures/cba/seed.js --nodes 1500 --rows 26278 --artifacts 4000 --gestures 0 --cycles 25
node scripts/diagnostics/summarize-gui-responsiveness.cjs /tmp/gui-signed.json /tmp/gui-reentry.json /tmp/gui-broad.json > /tmp/gui-summary.json
```

`--desktop DIR` selects a sibling native checkout. `--binary FILE` selects a packaged binary with `--packaged 1`; inspect its provenance before testing. `--browser chrome` uses the staged production renderer as a foreground control. `--isolateEdges 1` hides edges only for an explicitly labeled attribution experiment; it is never acceptance evidence. Run benchmarks sequentially, not alongside builds/tests. The normal production implementation remains untouched.

## Validation and working-tree status

The final populated-area run completes all 25 measured actions with zero renderer page errors. Final signed baseline and edge-isolation runs complete their transform/input/count assertions with zero page errors. All new CommonJS diagnostics and the fixture module pass syntax checks; the two fixture builders execute successfully. The restoration, global search, HTL table/fields and stable-hash regression checks pass **5 suites / 69 tests** (`/private/tmp/xhandle-gui-audit-2026-11-13/focused-tests-final.log`). An initial test command referenced a nonexistent filename, which was corrected rather than reported as a product failure.

No full application rebuild or complete test-suite rerun is claimed: application runtime code did not change. Raw CPU profiles/timeline files remain outside source control. Temporary app processes are checked after the runs; only owned test apps are closed.

The final reusable-harness smoke also completes the corrected small-project / large-project return, all CBA table and abstraction steps, a warm cycle, and area navigation without a failed sample or page error. This small-fixture smoke validates the diagnostic control flow; it is not substituted for the large-project measurements.
