# CSU / Functional split-view parity review

Reviewed the current working tree using `docs/codex-prompts/review-csu-functional-split-parity.md`. No application code changed during this review. **Functional split view does not yet have CSU interaction or performance parity.**

## Findings

1. **P2 — Table-link navigation uses different view transitions.** CSU's `codeArchitectureViewModeForDiagramFocus` preserves split mode but opens Architecture from table-only mode (`generateFunctionalDecompositionFromGitHub.js:3635`, `:4130`). Functional `openDiagram` opens split from table-only mode (`FunctionalArchitectureDiagram.jsx:113`). Reproduce: open either table alone and click a From/To/Control Action arrow. They choose different modes. Use one transition policy, retaining Functional abstraction and resolving its own node/edge IDs.

2. **P2 — Functional navigation retries survive a view change.** CSU owns pending focus through an effect that cleans up when view, abstraction, target, or rows change (`generateFunctionalDecompositionFromGitHub.js:4175`). Functional starts the retry timer in the click handler and cancels on another click, data/scope change, or component unmount, but not when the diagram is hidden (`FunctionalArchitectureDiagram.jsx:97`, `:113`). Reproduce: request focus while the diagram is still mounting, switch to table before readiness, then return to a diagram within the retry window. The old request can focus after the user has moved on. Use an effect-owned request lifecycle with explicit completion and cancellation.

3. **P2 — Column widths and pane preferences have different lifetimes.** CSU reads/writes column widths in localStorage and retains split percentage in the parent across abstraction changes (`generateFunctionalDecompositionFromGitHub.js:3691`, `:4011–4057`). Functional stores widths and split percentage only in its conditional child (`FunctionalArchitectureDiagram.jsx:77–78`). Reproduce: resize Functional columns/divider, switch to CSU, then return; Functional remounts with defaults. Persist column widths by schema/scope and share the parent split state. Neither implementation currently persists divider percentage across a complete reload; do not describe that as existing CSU behavior.

4. **P2 — Reverse navigation discards filters unnecessarily.** CSU clears filters only when they hide the requested row (`generateFunctionalDecompositionFromGitHub.js:4090`). Functional clears every filter on every diagram-to-table request (`FunctionalArchitectureDiagram.jsx:123–131`). Reproduce: filter the table while keeping the requested row visible, then open that row from the diagram. Functional loses the filters. Share the visibility-aware reveal policy and avoid fallback to a row index when an explicit identity fails to resolve.

5. **P2 — Split geometry and resizing are separate implementations.** CSU places its diagram (including Tools) and table as siblings, with a parent-owned separator. Functional puts both panes inside the diagram surface, with Tools outside its internal percentage calculation (`generateFunctionalDecompositionFromGitHub.js:4302–4378`, `:4435–4467`; `FunctionalArchitectureDiagram.jsx:163–204`). At the same percentage the usable diagram/table widths differ. Below the `md` breakpoint, CSU is diagram-first in DOM order; Functional is table-first and only moves the diagram first using a desktop CSS order. Functional pointer-up also fits immediately, whereas CSU schedules the fit with requestAnimationFrame. Share the pane shell, responsive ordering, and post-layout fit timing. Functional has no pointer-cancel handler; CSU's window-based drag also needs cancellation/unmount cleanup. Fix those shared defects rather than copying them.

6. **P2 — Functional adds full-model work to every resize/filter render.** The function count, interaction list, source-boundary index list, and `cleanOnceKey` are recomputed from all model rows on every Functional render (`FunctionalArchitectureDiagram.jsx:132–134`, `:198`). Divider and column resizing set state on every movement. `inspectTarget` also depends on the freshly created filter-state object, changing the diagram callback on those renders. The underlying diagram component is not memoized (`LiteSummaryDiagramReactFlowGitHub.js:5308`), and CSU also rerenders its parent during resizing, so this is an additional cost/risk, not measured proof of a particular slowdown. Memoize summaries/key and isolate pane sizing/table state from diagram props; compare both paths using the same representative datasets before claiming parity.

7. **P2 — Table-shell and selection behavior remain different.** CSU has a fixed toolbar outside its scroll container; Functional's copy/export toolbar, status, and table share the scroll container, with both toolbar and header sticky at `top: 0` (`generateFunctionalDecompositionFromGitHub.js:4467–4510`; `FunctionalArchitectureDiagram.jsx:165–174`). This creates competing sticky positions. CSU also sends cell selections to Collaborator (`generateFunctionalDecompositionFromGitHub.js:4068`); Functional has no equivalent selection callback. Use the same table shell and selection adapter. Functional's derived content being read-only is a legitimate data-policy distinction; do not blindly copy CSU editing into aggregated rows.

## Parity matrix

| Area | Current result |
| --- | --- |
| Shared diagram renderer, routing engine, pan/zoom | Same base component; presentation and permissions differ |
| Tools layout, collapse, fit, bundling, export | Shared implementation; derived-view creation restrictions remain |
| Virtualized table body and quick-search registration | Shared component |
| Column filter controls | Shared controls; reverse-navigation clearing differs |
| From/To/action identity resolution | Shared resolver; transition/lifecycle ownership differs |
| Split divider bounds and keyboard step | Both 25–75%, 5% keyboard steps |
| Divider geometry, fit scheduling, cancellation | Different implementations |
| Column-width persistence | CSU yes; Functional no |
| Table/diagram ordering on narrow screens | Different |
| Collaborator cell selection | CSU only |
| Large-diagram performance | Not established as equivalent |

## Validation and limits

Ran existing suites: FunctionalArchitectureDiagram, generateFunctionalDecompositionFromGitHub, codeArchitectureNavigation, VirtualTableBody. **4 suites / 46 tests passed.** These cover navigation policy, modeled focus, table modes, keyboard divider sizing, and virtualization behavior. The Functional component suite mocks the diagram renderer; it does not demonstrate real React Flow mounting/focus performance. No customer data, AI requests, browser-profile modifications, or source-generation runs were used. No browser latency, Safari interaction, or screenshot comparison was measured in this review. No build was needed because application code was not changed.

## Bounded implementation plan

1. Extract the existing CSU split/table shell and view-transition policy into shared components/hooks. Give each view a row adapter, stable identity resolver, source-inspection callback, and explicit edit/annotation capabilities. Keep source processing, storage schemas, abstraction semantics, hazard analysis, and downstream requirements untouched.
2. Move split state, drag cleanup, keyboard behavior, responsive ordering, and fit scheduling into that shell. Persist table widths with separate schema keys; keep existing CSU preferences compatible.
3. Share effect-owned navigation/reveal handling, missing-target notices, visibility-aware filter clearing, and Collaborator selection. Retain exact Functional-to-source mappings and source inspector access.
4. Memoize Functional summaries and stable layout keys, isolate table state from the diagram, and measure before adding further optimizations. Do not regenerate model data or re-layout saved diagrams merely because the divider moved.
5. Add real-browser checks for both views: first click from table and split, repeated same-target links, filtered reveals, quick search, copying the complete filtered dataset, width restoration, switching abstraction/project during pending focus and drag, pointer cancel, keyboard resizing, and narrow layouts. Verify no unintended diagram/model changes.
6. Benchmark matched 1k/5k-row fixtures with real rendered nodes/edges. Record divider latency, long tasks, table scroll responsiveness, and pan/zoom frame times at equal viewport sizes and visible complexity. Compare Functional against CSU, and flag any shared baseline defect. Include Safari because that is the reported browser; do not infer Safari results from mocked tests or Chromium alone.
