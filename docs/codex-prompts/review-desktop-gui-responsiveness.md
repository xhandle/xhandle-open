# Review xHandle Desktop GUI responsiveness with live testing

Review the current xHandle implementation and identify the causes of serious GUI lag on the largest projects, especially Code-Based Architecture. Use real-time testing of the running desktop application, source analysis, and reproducible performance traces. Deliver a prioritized, evidence-backed optimization plan covering all areas of the tool. Do the investigation; do not stop at proposing how to investigate.

This task authorizes review, disposable fixtures, and diagnostic instrumentation. It does not authorize implementing production optimizations, changing project data, committing/pushing, publishing an update, or updating an installed application. Small reusable diagnostic scripts and the investigation report may be added to the shared repository. Recommend concrete changes for a subsequent implementation task.

## Establish the current implementation

- Shared application: `/Users/Nick/xhandle-open`. Private Electron shell: `/Users/Nick/xhandle-desktop`. Read applicable `AGENTS.md` files and each repository's build/diagnostic instructions. Inspect status and relevant diffs; preserve all existing work. Shared fixes belong upstream; never copy or patch shared application sources into the private shell.
- Record shared/native SHAs, dirty state, desktop submodule pin, version, build provenance, and effective Electron/Chromium/Node versions. Record which executable, renderer bundle, and source snapshot each experiment actually measures. Desktop 0.2.16 shipped with shared source `93b793d3d20dcca46fa95c4ae16e259ec8737092`; verify current state rather than assuming this is still the latest or currently running build.
- Use production assets for acceptance measurements. If comparing release and current source, use isolated snapshots and the same fixture/input/harness. Record bundle hashes. Do not compare a development baseline with a production candidate or relabel old packaged assets as current source. A profiling-enabled React build is useful for attribution, but confirm timings again without that instrumentation.
- Inventory the actual navigation, views, global services, storage paths, and background jobs. Historical reports, screenshots, and performance claims are leads to reproduce, not proof of present behavior. The previous decision to exclude the browser/desktop gap from release blocking does not exclude it from this investigation.

Read these starting points selectively, then follow current imports and call sites:

- `src/App.js`, shared diagram/table components, global state/context providers, navigation and selection handling.
- `src/features/code-architecture-context/`, `code-architecture-assurance/`, `code-architecture-hazard-analysis/`, `code-architecture-storage/`, `code-architecture-transfer/`, and cross-repository features.
- `src/features/design-management/`, including artifact workers, HTL consolidation/table preparation, safety requirement sources, and engineering project overview loading.
- `src/features/safety-case/`, Collaborator/review flows, quick search/workspace indexing, activities, persistence, backup/restore, and project lifecycle code.
- Private shell main/preload/utility-process code, protocol/API transport, diagnostics, updater scheduling, and packaged smoke support.
- `docs/investigations/browser-desktop-performance-gap-2026-11-02.md`, `cba-interaction-performance-review.md`, `cba-interaction-performance-fixes.md`, `large-diagram-table-performance-review.md`, `large-view-performance-fixes-validation.md`, `desktop-diagnostic-memory-followup-2026-11-02.md`, and `pre-release-regression-review-2026-11-13.md`.

## Safe, representative live environment

1. Launch a foreground, visible desktop instance using a unique disposable profile, storage, download cache, output directory, and loopback diagnostic port. Establish isolation **before launch**, including any relaunch/child-process path. Disable production update checks/install and automatic relaunch in the test instance. Never target `/Applications`, a user's installed executable, or the ordinary desktop profile. Record owned PIDs; before attaching, controlling, or stopping a process, verify its executable/profile and parent identity. Never reuse a stale debugger port or terminate unrelated app instances.
2. Exercise the actual native shell, renderer, preload and backend when available. A temporary full-App Electron harness can support attribution and current-source comparisons; disclose differences from the packaged shell and repeat decisive findings in the real shell. Helper benchmarks, jsdom, a no-op diagram, or a substituted table renderer cannot establish desktop GUI responsiveness.
3. Use an authorized exported project copied into the disposable profile if available. Do not inspect personal databases, workspaces, or backups without authorization. Otherwise construct realistic deterministic fixtures using current schemas and record that the customer project was not measured. Do not block useful synthetic work while awaiting a dataset.
4. Include a small control, a representative large project, and a practical stress case. Historical avLocalizationWithOutHDMap observations included about **26,278 hazard assessment rows**, **4,981 architecture relationships**, and detailed diagrams around **4,000–5,000 nodes**. Verify actual dimensions when using a real copy; synthetic cases should approach these dimensions and representative edge density. Do not declare the large-project issue resolved using only a 100-node graph. Record logical graph size, mounted/visible node and edge counts, rows, text lengths, bytes read and stored, checkpoint/history volume, and project/repository counts separately.
5. Include long/wrapped evidence, source references, saved layouts, multiple abstraction levels, grouped hazards/operational contexts, derived requirements, HTLs, document objects, traceability and inactive projects. An empty workspace or one giant Blob is not a representative workload. Ensure fixtures pass current readiness/schema checks and really load the measured data.
6. Record host CPU/architecture, RAM, OS, display resolution/refresh rate, device scale, GPU feature status, other material system load and memory pressure. Start conservatively on the host, increasing fixture size while recording capacity limits. Do not clear OS caches, alter global acceleration/security settings, or run uncontrolled stress to exhaustion.

## Mandatory workflow coverage

Maintain a matrix with explicit **measured / unavailable / not applicable** status and reasons. Discover current labels rather than silently skipping a renamed view. Broad coverage is required; spend the deepest profiling time on demonstrated high-impact paths, particularly CBA.

| Area | Interactions to exercise in the actual UI |
| --- | --- |
| Global navigation and workspace | Startup to usable content, cold/warm project and repository opening, sidebar expansion, switches between small/large projects, returning after idle, leaving a large project, navigation during background work, activities/settings/dialog opening, resize and keyboard input. |
| Code-Based Architecture | Detailed/CSU/CSC/CSCI/subsystem or current equivalents; architecture and functional diagrams/tables; abstraction switches; pan, wheel/pinch zoom, fit, node selection/drag, link/source/detail navigation, saved viewport/layout restoration; multiple repositories and cross-repository views. |
| CBA hazard and assurance | Hazard & Remediation, grouped/paged tables, column multiselect filters, scrolling, edits, contexts and source links; software/system/subsystem requirements, design artifacts, traceability matrices, and review/proposal panels. Test entering saved completed runs without regenerating them. |
| Projects | Functional diagram/table, hazard analysis, operational contexts, Safety Issues & Risk Assessment, issue selection/editing and linked evidence. Report this workspace separately from CBA. |
| Design Management | Folder list/edit/open; large library navigation; engineering project overviews; artifact Outline/Table/Document/diagram views; HTL records and expanded assessments, actionable issue title/description, column resizing and multiselect filtering; safety requirement parent/child objects and editing. Include switching away during worker preparation. |
| Reports and System Test | Discover and exercise current lists, editors, previews, diagrams, test/verification tables and source navigation with representative stored data. |
| Safety Case | Opening/selecting projects, diagram pan/zoom, node inspector, evidence lists and automatic evidence refresh; check whether inactive/background preparation affects unrelated views. |
| Collaborator and review | Open/close/resize, large existing threads, incremental responses, source/evidence previews and review decisions; keep unrelated UI interactive while a deterministic fixture response streams. |
| Search and data operations | Global Search / Cmd+F / Ctrl+F across features, typing/results/navigation, index updates; imports, exports, backup/restore, retained/permanent deletion and recovery on synthetic data; responsiveness elsewhere while these run. |

For generation/analysis/consolidation, use saved results or deterministic local provider fixtures that exercise real streaming, worker, checkpoint and publication paths. Separate provider/network latency from app-induced blocking. No paid AI calls, repository ingestion or production analysis reruns are needed or authorized. Do not use a fixture that bypasses the expensive client preparation or rendering under investigation.

## Measure active interactions, not idle time

Baseline before any experimental optimization. Use trusted mouse/keyboard input through Playwright/CDP or equivalent actual desktop input. Confirm that the intended view loaded, tables actually scrolled, diagram transforms changed, input was accepted, and selections/filters produced correct results. Await actual ready/interactive conditions; a completed click handler, spinner, mounted shell, or first rAF alone does not establish usable content.

- Measure input-to-visible-feedback and input-to-usable-result separately for navigation, typing, selection, filters and editing. Include timeouts, failures and intermediate blank/stale states in results, not only successful samples.
- Collect long tasks over 50 ms, total blocking time during the defined interaction window, timer/event-loop gaps, active frame-time distribution and observed frame stalls. Correlate input events, visible changes and trace slices. Do not calculate smoothness from idle rAF frames or hide settle/setup time inside a gesture average. Verify no unintended input throttling in the harness.
- Capture bounded Chromium CPU/timeline traces during the slow interactions, React commit/render attribution where available, layout/style/paint/compositor costs, and relevant main/utility-process activity. A trace with zero relevant input events is invalid interaction evidence; rerun it. Save raw traces outside the repository and record paths, hashes, capture windows, and analysis commands.
- Attribute data work: IDB/SQLite/API calls, transactions, queue wait, bytes and rows transferred/materialized, JSON parse/stringify, hashing/deep clone, migrations, worker startup/queue/transfer time, layout preparation and persistence. Distinguish awaited I/O from synchronous JS, React work, paint/GPU stalls and system paging.
- Sample renderer heap, process memory and GC/activity trends before, during and after work, then after leaving the view. Identify process roles and units; do not add overlapping memory metrics or infer a leak from one peak/swap reading. Any forced-GC or heap-snapshot run is a separate intrusive attribution experiment, outside ordinary latency timing.
- Use at least three independently restarted app/profile runs for cold entry and 20 warm navigation/input samples for key slow paths where practical. Collect at least five repeated active scroll/pan/zoom gestures after explicit warmup. Report sample count, raw values, median, tail observations and percentile method; label small-sample p95 estimates as uncertain. Preserve failures and variation rather than selecting the best run.
- Run 25 or more open/switch/leave cycles to test retained state, abandoned workers/subscriptions, background queue buildup and increasingly slow reentry. Include idle, active generation/indexing and settling-after-completion states. Distinguish first activation/page-in from repeatedly slow interaction.
- Compare matched foreground Chrome and Electron workloads using the same production bundle, fixture dimensions and input sequence where feasible. Record runtime/flags/DPR differences; do not attribute the entire gap to Chromium version, GPU or Electron without causal evidence. Cross-platform conclusions require measurements on those platforms; clearly mark an unavailable Windows/Linux run.
- Check profiling overhead with a lightly instrumented or uninstrumented repeat. Disabling collectors, hiding edges, freezing state, or stubbing a service may isolate a cause, but those runs are experiments, not acceptance results for the intact app.

Use practical diagnostic targets such as immediate input feedback near 100 ms, warm navigation near 200 ms, and frame work close to the measured display budget. These are investigation targets, not permission to truncate data or universal hardware guarantees. Report measured misses; faster spinners do not count as faster usable results.

## Trace causes through the implementation

For each demonstrated stall, connect the user action to source call sites and the CPU/I/O/render trace. Investigate at least:

- App/context state updates that rerender unrelated feature trees; unstable selectors/props/callbacks; repeated derived scans; unnecessary hidden mounted views and offscreen effects.
- Full graph/row/evidence hydration during navigation, table pagination that still reads/processes everything, eager traceability joins, source/index hydration, repeated schema/recovery checks, serialized storage queues and transactions held open across unrelated work.
- Diagram node/edge creation, layout/routing, viewport listeners, labels/minimaps, DOM count, measurement loops and persistence on every pan/zoom/drag event; verify graph semantics if visible-element rendering is involved.
- Table windowing, variable-height measurements, wrapping, filter-option scans, resize events, expansion and selection. Distinguish bounded DOM from unbounded data preparation. Check filters/search apply across all records, including those off page.
- Synchronous serialization, hashes/cloning and huge localStorage values on input paths; compact metadata vs heavy evidence; duplicate worker/main-thread transformations and structured-clone overhead.
- Generation checkpoint/save/restore storms, progress/activity broadcasts, full-workspace indexing and safety evidence refresh, autosave/write amplification, backup/export compression, and disk/backend work competing with foreground interaction.
- Worker lifetime/backpressure, cancellation, late results after scope switches, growing promise/event queues, stale cache versions, cache retention and cleanup, JS/native memory pressure and GC pauses.
- Native renderer/main/utility/IPC/protocol behavior, diagnostics sampling/logging, timers, startup tasks, GPU/compositor status and layout/paint. Preserve sandbox, authentication and main-frame/IPC authorization; security checks must not be disabled to improve timings.

Use a minimal reversible diagnostic experiment for leading hypotheses where useful, changing one factor at a time. If temporarily changing application code, do so only in a separate disposable snapshot, record the patch, and keep it out of the user's production working tree. Confirm whether it affects the measured stall; do not claim a hypothesis or an instrumented experiment as a shipped fix.

## Deliverables and completion criteria

Write `docs/investigations/desktop-gui-responsiveness-review-2026-11-13.md` and small reproducible diagnostic scripts/configuration as needed. Keep bulky fixture exports, profiles, recordings and traces in a named temporary output directory. Do not check in credentials, customer data, dependency downloads or large generated assets.

The report must include:

1. The principal demonstrated causes and affected user workflows, with source file/line references, trace evidence and scope. Separate confirmed causes, supported hypotheses and untested areas.
2. Exact application/native/harness identities, hardware/runtime details, fixture shapes/bytes, cold/warm definitions, input sequence, completion conditions and profiling overhead controls.
3. Coverage matrix and measurement tables by workspace/view/fixture size, including latency, stalls/frames, memory/storage/worker evidence and failures. Show CBA results explicitly. Preserve raw sample summaries and commands sufficient to reproduce findings.
4. Ranked optimization opportunities: impact, affected path, proposed code/dataflow change, evidence for expected benefit, implementation effort/risk, data/security constraints, and a measurable acceptance/regression test. Quantify demonstrated effects; label unmeasured benefit estimates honestly. Prioritize a few high-impact shared causes over a generic list of memoization/debounce ideas.
5. A staged implementation plan: low-risk improvements first, then any larger architectural changes such as bounded data projections, worker preparation, true storage-backed pagination or state isolation. Include cache keys/invalidation, stale-result/cancellation semantics, memory bounds, and dependencies where relevant.
6. Correctness safeguards: retain every record/evidence link, requirement/HTR identity, source provenance, saved layout/edit, full-dataset filtering/search, cross-project isolation and recovery. Do not propose silent data drops, arbitrary record limits or disabling features as performance fixes. Explain compatibility/migration and small-project regression checks.
7. Remaining limitations and the smallest next evidence needed if the actual customer workload or platform was unavailable. Package a short repeatable customer capture procedure only if needed; never claim the customer's lag is explained solely by synthetic results.

Inspect any added harness for accidental real-profile access, network/provider calls, updater behavior and production renderer substitutions. Run the new/changed diagnostics, relevant existing tests and `git diff --check`; additional app build/smoke checks are required if an experiment changes runtime code in its disposable snapshot. Static review alone is incomplete. If live execution is blocked, finish useful source/fixture analysis and report the exact blocker and missing measurements without inventing results.

Finish with concise findings, the highest-impact next changes, measured evidence and report links. Leave the production implementation and existing data unchanged. Do not commit, push, release, install, recursively invoke Codex, or spawn subagents under this prompt.

## Existing diagnostic starting points

Inspect each harness before reuse; verify dependencies, paths, fixture readiness, isolation and timing math against current source. Old `/tmp` Playwright paths may no longer exist. Earlier measurement methods and outcomes do not carry forward automatically.

- `scripts/diagnostics/build-desktop-performance-fixture.cjs`
- `scripts/diagnostics/desktop-interaction-performance.cjs`
- `scripts/diagnostics/desktop-performance-cba-scenario.cjs`
- `scripts/diagnostics/review-large-view-performance.cjs`
- `scripts/diagnostics/verify-cba-hazard-performance.cjs`
- `scripts/diagnostics/verify-artifact-worker-responsiveness.cjs`
- `scripts/diagnostics/review-code-architecture-link-navigation.cjs`
- `scripts/diagnostics/stress-downstream-derivation-desktop.cjs`
- `scripts/diagnostics/desktop-process-footprint.py`
- `scripts/diagnostics/compare-desktop-diagnostics.cjs`
- Private `scripts/launch.cjs`, `scripts/smoke-packaged.cjs` and `electron/diagnostics-parity.cjs` for actual shell boundaries.

Extend current coverage where needed. Do not run the entire old diagnostic collection blindly or mistake a helper-only worker/recorder test for full GUI verification.
