# Implement responsive Code-Based Architecture in Chrome and Electron

Use GPT-6 Astra with Max reasoning. Execute this implementation task in `/Users/Nick/xhandle-open`; do not stop at a proposal or another review.

## Objective and evidence

Resolve the remaining demonstrated Code-Based Architecture (CBA) interaction bottleneck in the shared renderer used by Chrome localhost and Electron. Preserve the already implemented functional-project table/diagram improvements, and independently validate both workspaces. The customer has an Apple M4 with 16 GB RAM and a reported 634 MB project/archive; that size is not a measured working set. No customer data/profile is available.

Read `docs/reviews/desktop-interaction-performance-review-2026-10-30.md`, its measurement artifact, existing CBA investigations, and the actual renderer before choosing a solution. The last review found:

- The separate CBA renderer, `src/components/LiteSummaryDiagramReactFlowGitHub.js`, still mounts a dense scene. A fixture with 500 functions/1,000 relationships has 628 hierarchy-inclusive nodes, 3,024 handles and about 11,758 DOM elements.
- Trusted pan/zoom frame intervals reached roughly 67–117 ms p95 in Electron and 67–85 ms in Chrome. Traces implicate raster/compositing/presentation work as well as potential React Flow subscription overhead. Diagnose rather than assume the wrapper or GPU is defective.
- `onlyRenderVisibleElements={false}` is intentional: naive node visibility can lose crossing/manual edges, and React Flow 11 edge visibility can scan the graph. A one-line flag change is not sufficient without correctness and performance evidence.
- CBA tables are already virtualized. Repeated artifact hydration, complete hazard search and nonvisual derived work remain separate possible costs. Prioritize the demonstrated graph bottleneck; address tab/scroll work where measurements justify a coherent fix.

## Preservation and scope

Start with applicable AGENTS.md, git status/diff, and a baseline source snapshot/hash list. This checkout contains extensive authorized, unreleased work. Preserve storage whole-item UX, project deletion/retention/progress, hazard restoration, export checksum/compatibility fixes, functional-project optimizations, and all existing tests/reports. Do not reset, stash, overwrite or remove other work.

Shared changes belong in this repository. `/Users/Nick/xhandle-desktop` is read-only context unless a concrete native defect is demonstrated; read its AGENTS.md before inspection. Do not copy/fork shared sources into it. No commits, pushes, publishing, installers, application updates, dependency upgrades, customer-profile access, paid provider calls, destructive cleanup or global browser/GPU/security changes. The customer is staying on their current installed application. Use disposable test profiles and fixture-only services; stop only processes created by this task.

## Implementation requirements

1. Reproduce the current bottleneck using the actual production App, not a simplified graph or stubbed renderer. Reuse/extend `scripts/diagnostics/desktop-interaction-performance.cjs`, `desktop-performance-cba-scenario.cjs`, and `build-desktop-performance-fixture.cjs`. Record exact baseline source/build/runtime/fixture identities before runtime edits. Existing production builds may be used only when their identity matches the baseline.
2. Profile and isolate the expensive scene work. Compare mounted DOM, edge/label/handle rendering, SVG/HTML paint, subscriptions, viewport updates and persistence, selection overlays, and offscreen rendering. Choose the smallest architectural change that removes the measured cost. Route-aware culling, indexed visibility, level-of-detail presentation, stable scene data or a separate overview renderer are candidates, not preselected answers. Do not replace slow work with a spinner or claim wins from incomplete diagrams.
3. Implement a robust shared solution. Preserve all graph data and persisted schema, node IDs/positions, manual and automatic routes, crossing edges with offscreen endpoints, grouping/hierarchy, abstraction changes, selection, source/details, trace links, editing/dragging/resizing, reconnect/create tools, fit view, search/navigation and export/print behavior. Presentation detail may adapt to zoom/density only if meaningful relationships remain visible, detailed content returns predictably, and all actions remain accessible. Do not silently omit data or permanently disable labels/features. Explain any intentional visual tradeoff in the report.
4. Keep hot viewport work bounded; avoid repeatedly scanning the complete model per frame, routing all edges during pan, or serializing persistence on every pointer event. Correctly handle resize/DPR, manual bends, distant endpoints crossing the viewport, overscan, rapid gestures, scope switches, cancellation and cleanup. If caching/indexing, include content/layout/scope revisions, invalidation and bounded retention. Flush final changes and avoid stale saves/publication after unmount.
5. Keep small diagrams simple and responsive. Retain the existing functional-project improvements; use a shared helper only when semantics match. Independently exercise CBA and functional projects. Follow measurements for tab/scroll improvements without broad speculative refactors.

## Acceptance and regression protection

The following are engineering targets, not promises about every dataset or customer machine:

- On the matched 500-function/1,000-relationship fixture in both Chrome and Electron, target pan/zoom p95 frame intervals near one display frame, preferably <=25 ms at 60 Hz, and a substantial repeatable reduction from baseline. Run at least three trusted-input samples per gesture, after warmup, checking actual intermediate transform/scale changes. If a target remains unmet, continue profiling and implementing justified changes; report the concrete remaining limit honestly.
- Include small and larger scenes (for example 100 and 1,500 functions), dense cross-links, crossing edges, manual paths and zoom extremes. Report actual usable-view latency, frame distributions, long tasks, mounted DOM, memory and runtime/hardware. Do not equate rAF cadence with guaranteed display FPS, or summarize a single observation as a stable p95.
- Measure cold versus warm CBA tab changes and real table scrolling; verify no material regression in already virtualized tables or functional-project navigation/graphs. Repeated navigation/gestures must not cause monotonic retained-memory or listener growth.
- Add meaningful regression tests for the new mechanism, including fail-before/pass-after when possible. Validate crossing/offscreen/manual edges, route changes, selected/focused nodes, detail restoration, project/repository changes, stale updates and cleanup. Exercise actual App browser/Electron interactions, source links and saved layout/edit restoration, not only mocked hooks. Preserve exact model data and edge semantics.
- Run affected test suites, targeted lint, a final production build and `git diff --check`. Run builds/tests and performance benchmarks sequentially to avoid resource contention. Existing eight baseline hazard-eval failures must be distinguished from new failures, not masked.
- Re-run matched Chrome and Electron measurements on final production assets. A BrowserWindow test of the real App is renderer evidence; disclose that it does not verify packaged preload/backend/installer parity. Do not claim customer M4 validation from another machine.

## Deliverables

- Working implementation, focused regression tests, and reusable diagnostics/benchmark fixtures or checks that can catch this regression again.
- `docs/reviews/cba-rendering-performance-implementation-2026-10-30.md` describing root cause, approach/tradeoffs, before/after results per workspace/runtime, source identities, checks and exact remaining limitations.
- A compact machine-readable measurement artifact under `docs/investigations/`; keep bulky traces/profiles outside the repository in a task-specific temporary directory.
- Concise final summary with demonstrated improvements, test results, prompt/report links, and anything still unresolved. Local Chrome can pick up shared changes after reload; the installed desktop app needs a later authorized build to receive them. Do not release it now.

Work autonomously through implementation and validation. Coordinate independent investigation/review with other agents when useful, keeping ownership clear and avoiding simultaneous benchmark/build contention. Do not recursively launch Codex CLI tasks.
