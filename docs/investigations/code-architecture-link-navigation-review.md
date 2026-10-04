# Code architecture link navigation review

Date: 2026-10-04. Scope: current working tree, including the recent header/menu changes. Executed the prompt in `docs/codex-prompts/review-code-architecture-link-navigation.md`. This review does not change application behavior, commit, or push. Existing uncommitted UI changes were preserved.

## Conclusion

There are real defects in the navigation lifecycle. The strongest explanation for the first-click/second-click symptom is that a click starts asynchronous diagram arrangement and focus concurrently, then treats finding a graph item as successful navigation before its final position and viewport are ready. The second attempt often encounters an already built/measured graph, reducing that timing window. There are also independent target-resolution and cross-tab bugs that a second click will not reliably repair.

These findings are supported by source inspection, deterministic execution of the actual source callbacks, and an isolated Chromium browser probe. The exact customer's large diagram and installed Safari session were not available to this review. The small browser fixture eventually focused correctly on both attempts; it demonstrated slower first navigation, not a permanent first-click failure. The controlled probes reproduce the failure mechanisms without relying on machine timing.

## Findings

### 1. P1 — Focus is acknowledged before layout/measurement/viewport success

Locations:
- `src/components/generateFunctionalDecompositionFromGitHub.js:4551` — `requestCsuDiagramFocus`.
- `src/components/LiteSummaryDiagramReactFlowGitHub.js:2761` — `performArchitectureTargetFocus`.
- `src/components/LiteSummaryDiagramReactFlowGitHub.js:2824` — `focusArchitectureTarget`.
- `src/components/LiteSummaryDiagramReactFlowGitHub.js:2933` — pending-focus effect.

The public focus method calls `performArchitectureTargetFocus` immediately. That method does not check `initialLayoutPending`, active abstraction, node measurement, or completion of a viewport move. It schedules `fitView` with a zero-delay timer and returns `true` immediately. An edge also returns `true` when neither endpoint exists in the rendered node store, without scheduling any fit. The wrapper then stops retries and invokes the completion callback. The readiness check in the pending-focus effect only helps requests which returned `false`; it cannot protect requests that already reported success.

**Controlled reproduction:** an existing, unmeasured target with layout pending and `fitView` returning `false` generated exactly one attempt and one completion acknowledgement. No retry survived. An edge with missing endpoints reported success with zero fit calls. These probes execute the actual callback source with controlled graph state; they are not claims that every first click reaches this exact state.

**Fix direction:** use a request identity and a readiness-driven acknowledgement. Resolve the target only against the current graph; wait for layout completion, visibility, measurement, and a successful viewport operation. Do not interpret target existence as completion. Keep failure/timeout separate from success.

### 2. P1 — Each diagram link triggers arrangement that can overwrite newer focus

Locations:
- `src/components/generateFunctionalDecompositionFromGitHub.js:4570` — internal table-link click.
- `src/components/generateFunctionalDecompositionFromGitHub.js:4594` — external focus effect.
- `src/components/LiteSummaryDiagramReactFlowGitHub.js:2973` and `:3016` — async clean/layout and node replacement.
- `src/components/LiteSummaryDiagramReactFlowGitHub.js:3493` — clean effect cancellation.

Both link paths generate a new `cleanOnceKey` while requesting detailed view and focus. `runCleanAndSpread` captures the current nodes, awaits ELK, and then replaces nodes and edges from that earlier snapshot. It can also persist the resulting positions. The clean effect checks its cancellation flag only after this async function returns, after the node/edge writes have already happened.

**Controlled reproduction:** start the real clean callback, select a target while layout is pending, then resolve layout. The later clean result removes the newer selection and moves the target from `(0,0)` to `(2000,2000)`. This shows that an acknowledged focus can be invalidated by a still-running layout. It can also cause navigation to rearrange a previously saved diagram unnecessarily.

**Browser observation:** in the two-row fixture, the first navigation still had the overview transform at about 600 ms after the click; the second was already animating toward the target at that point. Both reached the target by approximately 2 seconds. This is consistent with readiness-sensitive navigation, but is not a reproduction of every reported wrong-target case.

**Fix direction:** separate reveal/focus from layout. Do not start a new arrange for every link. If a graph genuinely needs initialization, finish its current layout before applying focus, and guard all async layout commits with a graph/request generation check.

### 3. P2 — Stale IDs and positional row references can lose or misidentify targets

Locations:
- `src/components/LiteSummaryDiagramReactFlowGitHub.js:2769` — edge resolution.
- `src/components/LiteSummaryDiagramReactFlowGitHub.js:2796` — node resolution.
- `src/components/generateFunctionalDecompositionFromGitHub.js:4596` — external target enrichment.
- `src/features/code-architecture-assurance/artifactUtils.js:290` — architecture reference conversion.

Node focus prefers a stored `nodeId`; if that ID is stale it returns failure without resolving the current row via `traceId` and obtaining its current endpoint ID. External target enrichment supplies a row index but does not refresh these IDs from the current decomposition. Edge fallback accepts either a row-reference match or an interface-text match in a single first-match scan; it does not prioritize stable trace identity or validate that a row-reference match is still the requested interface.

**Controlled reproductions:** a stale node ID fails despite the intended function being present. A stale `rowRef` selects an unrelated edge appearing earlier in the list even when a later edge exactly matches the requested interface. These conditions can arise in retained references after regeneration/reimport; the user's actual references were not inspected.

**Fix direction:** resolve current functional rows using stable trace IDs first, then use their endpoint/edge IDs. Treat indices as fallbacks only after validating identity. Use file-qualified endpoint identity where stable IDs are unavailable, and reject ambiguous matches rather than selecting the first candidate.

### 4. P2 — Hazard-row links can open the wrong safety subtab

Locations:
- `src/App.js:9286` — `handleOpenCodeArchitectureHazardSummaryRow`.
- `src/App.js:9382` — assurance trace navigation.

The shared hazard-row handler selects the top-level safety tab but does not select `hazard-analysis` within it. Some callers explicitly set that subtab; the assurance `hazard-row` path does not.

**Browser reproduction:** visit Hazard & Remediation → Safety Remediation; visit Software Requirements; click a `HZ-1` link. The app returns to Safety Remediation, with the findings copy button visible, rather than the requested hazard table. No browser exception occurs. A source callback probe confirms the same state transition.

**Fix direction:** the shared hazard navigation handler should select both the safety tab and the hazard-analysis subtab, then deliver the request to the ready destination.

### 5. P2 — Row navigation does not consistently reveal filtered/collapsed targets

Locations:
- `src/components/generateFunctionalDecompositionFromGitHub.js:4118` — one-shot functional row scroll after 80 ms.
- `src/components/generateFunctionalDecompositionFromGitHub.js:4968` — filtered row rendering.
- `src/features/code-architecture-hazard-analysis/CodeArchitectureHazardSummaryTable.js:67` and `:74` — highlight/scroll effects.
- Same file `:264` — context filtering; `:498` — collapsed interface rendering.

The functional table schedules one scroll without clearing a hiding filter or retrying when data/DOM becomes ready. The hazard table sets focus and scrolls only when the highlighted/focused index changes; it does not reveal a hidden operational context, clear an excluding filter, or expand the target interface group. Those states can leave no DOM row to scroll to. The engineering artifact table does already clear filters for a hidden highlighted match (`EngineeringArtifactTable.js:239`), so this is inconsistent across destinations.

**Evidence level:** confirmed from rendering/effect conditions; not exercised in the browser probe for this review. Repeated clicks alone will not solve a target that remains filtered out. Highlighting expires after 2.6 seconds, which can also lose requests before slow destination loading completes.

**Fix direction:** adopt a consistent reveal-and-focus lifecycle: resolve identity, reveal relevant context/group/filter, wait for the target row to mount, scroll, and then acknowledge.

### 6. P2 — Older completion timers can clear a newer navigation request

Locations:
- `src/App.js:9376` — `handleCodeArchitectureArtifactFocusResolved`.
- `src/features/code-architecture-assurance/EngineeringArtifactTable.js:247` — focus effect invoking the completion callback.
- `src/App.js:9295` and `:9313` — positional highlight expiry timers.

Artifact focus resolution creates an uncancelled timeout which unconditionally clears the current focus. It does not compare the request's `key` with the current request. Functional/hazard expiry compares row index but still cannot distinguish two requests to the same row.

**Controlled reproduction:** acknowledge request A, then request B one second later. A's expiry clears B at 1.6 seconds into B's lifetime. This does not necessarily undo an already completed scroll, but can remove focus before a delayed destination is ready or truncate its highlight.

**Fix direction:** cancel superseded timers and condition acknowledgements/expiry on the specific request identity and destination scope.

### Additional source-confirmed contributor: unstable external-focus effect dependencies

`generateFunctionalDecompositionFromGitHub.js:4612` depends on `onFocusTargetHandled`. App passes new inline callback functions at `App.js:17230` and `:17377`. An unrelated App rerender during an outstanding external request can cancel its retry timers, restart the effect, and issue a new clean key. This increases churn in findings 1–2. The extent of that churn in the user's active analysis was not measured. Stabilize callbacks and make processing idempotent per navigation request.

## Validation and limits

- `node scripts/diagnostics/review-code-architecture-link-navigation.cjs`: seven controlled failure cases reproduced using callbacks extracted from the current source with Babel and executed in a VM. Graph state, timers, and viewport results are mocked deliberately; this is deterministic mechanism validation, not an end-to-end browser timing test.
- `scripts/diagnostics/review-code-architecture-link-navigation-browser.cjs`: fresh Chromium context, two-row synthetic project, two table-to-function navigations, and requirement-to-hazard navigation. Wrong safety subtab reproduced; cold/warm viewport observations recorded; no browser errors. No user browser storage or project was accessed, and no analysis run was started.
- Existing targeted tests: **46 passed across four suites** (`generateFunctionalDecompositionFromGitHub`, `EngineeringArtifactTable`, `artifactAI`, `CodeArchitectureHazardSummaryTable`). These cover split-view preservation, table edits/copying, reference generation, and hazard behavior, but do not establish correct first-click navigation after async layout.
- Installed Safari and the user's large project were not tested in this review. Previous WebKit menu checks were for a different task and are not navigation evidence.
- The moved menu still uses the existing view state; no direct evidence ties the new menu's click handling to these navigation races. This review does not establish which historical commit introduced each defect.

Browser probe command (requires local dev server and Playwright Core/Chrome):

```sh
XHANDLE_PLAYWRIGHT_PATH=/path/to/playwright-core XHANDLE_CHROME_PATH=/path/to/chrome node scripts/diagnostics/review-code-architecture-link-navigation-browser.cjs
```

## Recommended implementation and regression coverage

Implement a single request lifecycle with project/repo scope, stable target identity, and a monotonically unique request ID. Reveal the destination, wait for actual readiness, then apply and acknowledge focus. A newer request invalidates all older layout/focus/timer work. Preserve diagram positions during navigation and preserve existing split-view behavior.

Add integration coverage for: first render with deliberately delayed layout/measurements; viewport fit failure; node and control-action targets; layout completion after selection; regenerated IDs/reordered rows; same names in different files; hidden file/context/filter/group; requirements/design/traceability links; safety subtab selection; rapid A→B and repeated A→A navigation; project/repo switches during a pending request. Run these in Chromium and WebKit with meaningful viewport/selection assertions, not only tab visibility or mocked success.
