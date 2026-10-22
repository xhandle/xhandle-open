# Desktop diagram flicker review — second pass

Date: 2026-10-22. Executed prompt: `.codex-prompts/review-desktop-diagram-flicker-round-2.md`.

## Verdict

**Partially addressed; the reported visual flicker is still unverified.** This review reproduced and corrected one additional regression in the resize mitigation: user input during its delay could be followed by an automatic fit that overrode the user's viewport. No additional regression has been demonstrated in the executed checks. Passing tests cannot establish absence of all bugs or certify large-project visual rendering.

The prior review is retained as historical evidence in `desktop-diagram-flicker-review.md`. Its warning about resize-followed-by-navigation is addressed below. Its remaining label-visibility, multiple-auto-fit, and compositor-validation findings remain open.

## Finding corrected: delayed resize fit overrides user navigation

Severity: medium; introduced by the new debounce extending the automatic-fit delay to 150 ms.

Sequence: a resize schedules a fit; a pointer gesture or wheel zoom starts 100 ms later; the fit still fires at 150 ms. The original suppression callback protects explicit architecture target focus but does not observe these user gestures. Both newly added production-hook tests failed before the correction (2 failed, 6 passed).

Correction in `src/components/useDiagramResizeFit.js`: passive capture listeners on the diagram host cancel pending resize fits on `pointerdown` and `wheel`. They neither prevent default input behavior nor stop propagation. Both listeners are removed with the observer/timer during effect cleanup. Later real size changes still schedule fits, while duplicate notifications for the canceled size do not restart the canceled fit.

Tests exercise events from a nested diagram element, verify default input behavior is not prevented, assert no fit after input, and verify a later resize still fits. They supplement the existing callback freshness, suppression, resize bursts, hidden/fractional size, unmount and StrictMode tests. All eight hook tests pass.

## Remaining findings and limits

1. **Existing label visibility cycling remains.** `csuNavigation.css` hides edge labels on large graphs during viewport movement, then the component restores them after 150 ms. This applies to programmatic movement too. That can explain labels disappearing/reappearing but is not proof of the screenshot's rendering artifact or general GUI flicker. This review does not remove that performance tradeoff without measured evidence.
2. **Independent auto-fit paths remain.** Graph size/identity, layout completion, abstraction changes, clean requests and initialization can still independently fit the viewport. Canceling the resize hook's timer does not cancel those paths. Simultaneous resize during an already active gesture, keyboard-only navigation, and rapid project switches still need runtime acceptance coverage. No idle infinite render loop was demonstrated.
3. **Compositing/performance remains unmeasured.** Removing `will-change: transform` is a mitigation, not proof that GPU layer promotion caused the problem. No affected-project before/after recording, frame trace, or GPU-memory measurement is available.
4. **Visual coverage is incomplete.** JSDOM hook tests verify scheduling/input behavior. Some broader suites mock ReactFlow or the code diagram. A desktop startup smoke does not exercise a populated CSU graph. The affected project and Chrome comparison remain unavailable in this review.

## Regression boundaries

The additional change affects only cancellation of pending resize fits. Model data, persistence, node position/route formats, selection/editing handlers, updater code, and application identity are unchanged. Pointer/wheel events continue through to existing handlers; observers and listeners clean up together. Existing explicit Fit actions and graph/layout initialization paths remain available. Deliberately canceling a pending resize fit on any pointer/wheel input inside the diagram favors the user's current interaction; the next distinct resize can fit again.

## Validation

- Broad focused regression run: **19 suites, 134 tests passed**. This reran the same scope as the first review plus the new input cancellation cases. Log: `/tmp/xhandle-flicker-round2-tests.log`.
- Final nested-event hook tests: **8 tests passed**. Log: `/tmp/xhandle-flicker-round2-hook-tests.log`.
- Before-fix reproduction: **2 tests failed, 6 passed**, proving the missing cancellation. Log: `/tmp/xhandle-flicker-round2-before.log`.
- Targeted lint: **0 errors, 11 existing warnings** in unchanged diagram code; the hook/tests have no warnings. Log: `/tmp/xhandle-flicker-round2-lint.log`.
- Production build after the cancellation fix: **passed with existing lint, bundle-size and Browserslist warnings**. Log: `/tmp/xhandle-flicker-round2-build.log`.
- Isolated Electron smoke with the newly built renderer: **passed**, printing `UPDATER_LIBRARY_OK`, `DESKTOP_PARITY_OK` and `DESKTOP_SMOKE_OK`. This used a temporary host copy, existing staged backend/dependencies, review-only renderer metadata and an automatically created/deleted smoke profile. Checks covered React mounting, API/SQLite, storage reload, streaming/cancellation, download/preview isolation, and updater-library behavior. This was not a signed packaged release or a populated-graph visual test. Log: `/tmp/xhandle-flicker-round2-runtime.log`. The temporary harness was removed after the run.
- `git diff --check`: passed.
- The first review's 13 desktop host tests and 1 server startup test are prior evidence, not rerun results in this pass. Their implementation was not changed here.

## Acceptance still required

Use a disposable profile and a build containing this working tree, with an exported copy of the affected large project. Compare Chrome and Electron; pan/pinch/wheel zoom, select nodes and edges, open menus, switch projects/tabs, resize then immediately navigate, and resize during navigation. Check for viewport jumps and distinguish label visibility changes from missing nodes/backgrounds or whole-GUI flashing. Repeat on small diagrams and verify moved nodes/manual routes after reload. Do not declare the original flicker fixed until it no longer reproduces on the affected workload.

No commit, release, installation replacement, or personal-profile mutation was performed.
