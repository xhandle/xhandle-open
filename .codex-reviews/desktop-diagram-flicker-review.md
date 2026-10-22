# Desktop diagram flicker implementation review

Date: 2026-10-22
Prompt executed: `.codex-prompts/review-desktop-diagram-flicker.md`.

## Verdict

**Partially addressed; visual resolution remains unverified.** The resize mitigation works under automated tests and the updated production renderer passes an isolated Electron startup/integration smoke. One edge-case bug introduced in the resize hook was reproduced and fixed during this review. No other regression was demonstrated by the checks below. This is not evidence that all GUI flicker is resolved or that the application is bug-free.

The user's populated project and exact interaction sequence were not reproduced. Browser parity is still unknown. No production installer was rebuilt, signed, published, or installed; the user's installed application and personal profile were not changed.

## Findings

### Medium — existing label visibility changes remain a possible source of perceived flashing

`src/components/csuNavigation.css:6` hides all edge labels during movement on large CSU canvases. `LiteSummaryDiagramReactFlowGitHub.js:2252` sets the movement attribute at viewport start and removes it 150 ms after movement ends. This also handles programmatic viewport movement. Frequent navigation or automatic fits can therefore cause labels to repeatedly disappear/reappear. This behavior predates this patch and was not removed. It does not, by itself, establish the cause of the screenshot artifacts or whole-interface flickering.

### Medium — existing independent auto-fit paths remain

`LiteSummaryDiagramReactFlowGitHub.js:2904`, `:2976`, `:2985`, `:3114`, and the ReactFlow `onInit` callback independently fit the viewport around initial layout, abstraction, graph structure, clean requests, and initialization. The new hook deduplicates only container-resize fits; it does not coalesce these other paths. These paths are lifecycle/graph driven, so the code does not establish an idle infinite render loop. Their combined visual behavior during project/tab switches still requires runtime investigation with a populated project.

The new 150 ms resize debounce also means a resize fit may occur after the user has begun navigating. The existing suppression callback protects explicit architecture target focus, but ordinary viewport gestures do not set that suppression. Test resize-followed-immediately-by-pan explicitly before release; no interaction fixture was available to establish the practical impact.

### Low — new hidden-container cancellation bug, fixed

The initial hook rounded width/height before testing for zero size. A positive fractional size such as 0.2 x 0.2 followed by 0 x 0 produced the same rounded key, returned early, and left a pending fit scheduled on a hidden container. A regression test reproduced this (1 failing test, 5 passing); the implementation now cancels hidden-host work before rounded-size deduplication and resets size tracking. All six hook tests pass after the correction.

### Validation gap — compositor change has no measured visual/performance proof

Removing the explicit `will-change: transform` hint leaves Chromium to choose compositing. It does not disable GPU acceleration, change graph geometry, or prove the old hint caused oversized textures. No frame capture, compositor trace, GPU-memory measurement, or before/after large-project comparison was collected. Assess panning smoothness and rendering correctness on the affected Mac before calling this a confirmed fix.

## Regression review

- Observer remains attached across callback changes and uses the latest graph callback.
- Resize bursts produce one fit after settling; duplicate rounded sizes produce no new fit.
- Hidden hosts cancel pending fits and returning to a previous visible size fits again.
- Explicit navigation suppression is checked when the timer fires.
- Unmount and StrictMode effect cleanup disconnect the observer and cancel pending work.
- Existing graph/abstraction auto-fit paths remain available for graph readiness and same-size project changes; the hook is not their replacement.
- The patch does not change model data, node positions, saved routes, persistence keys, selection handlers, updater code, or application identity. Related tests pass; this is not exhaustive proof of every interaction.

## Executed validation

1. Focused shared regression run: **19 suites, 132 tests passed**. Includes resize hook, CSU routes/order/revision/handles, architecture navigation/projection, functional workspace/initialization/reconciliation, diagram metadata/comments/notes/editing, and system diagram/history tests. Some suites mock ReactFlow or the GitHub/code diagram; these are behavior checks, not actual large-canvas visual coverage.

   ```sh
   CI=true npm test -- --watchAll=false --runInBand --testPathPattern='(useDiagramResizeFit|csuVisibleHandles|csuEdgeRouting|csuLayoutRevision|csuFunctionOrdering|codeArchitectureNavigation|functionalArchitectureProjection|FunctionalArchitectureDiagram|FunctionalDiagramWorkspace|functionalDiagramInitialization|functionalDiagramNodeReconciliation|diagramPresentationCache|diagramArchitectureIndexes|diagramGroupMetadata|manualDiagramEditing|diagramNotes|diagramComments|LiteSummaryDiagramReactFlow.systems|LiteSummaryDiagramReactFlow.history)'
   ```

2. `npm run test:server-startup`: **1 test passed**.
3. In `/Users/Nick/xhandle-desktop`, `npm test`: **13 tests passed**, including security/update host behavior. These validate unchanged desktop host code, not large-project rendering.
4. `npm run build` after the final hook correction: **passed with warnings**. Existing application lint warnings, bundle-size warnings, and stale Browserslist data remain. This was not a warning-free build.
5. Targeted ESLint on the hook, hook tests, and code diagram: **0 errors, 11 warnings**; warnings are in unchanged portions of the diagram component. New hook/tests have no lint warnings.
6. `git diff --check`: passed.
7. **Isolated Electron runtime smoke passed using the newly built renderer.** A temporary copy of the desktop host loaded a copy of this working tree's `build` directory, existing staged desktop backend/dependencies, and explicitly marked review-only metadata. The host's `--smoke-test` created/deleted a disposable profile, disabled production updater checks, and exited successfully. Output included:

   - `UPDATER_LIBRARY_OK`: version comparison, explicit download, checksum rejection, no downgrade/install.
   - `DESKTOP_PARITY_OK`: API CRUD/settings, IndexedDB reload, secure browser APIs, request bodies/errors, streaming, binary/export download, isolated preview, cancellation.
   - `DESKTOP_SMOKE_OK`: React root mounted, healthy workspace, API/SQLite, preload isolation, and storage across reload.

   The normal desktop packaging script builds only its clean, pinned upstream submodule. Running it directly would not include these uncommitted changes; an existing packaged binary was therefore not counted as patch validation. The temporary harness was a review integration check, not a provenance-valid release or a large-project flicker test.

Logs from this execution: `/tmp/xhandle-flicker-tests.log`, `/tmp/xhandle-flicker-server-tests.log`, `/tmp/xhandle-flicker-desktop-tests.log`, `/tmp/xhandle-flicker-build.log`, `/tmp/xhandle-flicker-lint.log`, `/tmp/xhandle-flicker-runtime.log`. The pre-fix failing regression is in `/tmp/xhandle-flicker-edge-tests.log`.

## Runtime acceptance still needed

Use an exported copy of the affected project in disposable browser/desktop profiles and a desktop build containing this patch. Do not overwrite the user's live profile.

1. Compare the same large CSU graph in Chrome and Electron at matching viewport/zoom; also test a small graph and higher abstraction views.
2. Pan, wheel/pinch zoom, select nodes/edges, open menus, and switch projects/tabs repeatedly. Record whether labels alone change visibility or whether nodes, backgrounds, or surrounding GUI areas flash/disappear.
3. Resize continuously, then resize and immediately pan/zoom. Verify the viewport does not jump unexpectedly after the gesture.
4. Switch projects during a pending resize and during initial layout; verify the correct graph, completed layout, and no repeated fits after settling.
5. Reload after moving nodes or adjusting manual routes. Confirm positions/routes and project data survive, and selection/editing/export remain functional.
6. Capture before/after screen recordings or traces on the affected Mac. Accept the fix only when rendering artifacts are absent and interaction performance is acceptable on the reproduced workload.
