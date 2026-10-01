# Canvas trackpad gesture review — 2026-10-01

Executed [the review prompt](../codex-prompts/review-canvas-trackpad-gestures.md) against the current working tree (HEAD 828fba7 plus existing local changes). Application code was not changed. Browser tests used isolated synthetic projects; no user projects, layouts, browser profiles or credentials were accessed or modified.

## Confirmed defect: Quick search leaves the zoom modifier pressed

The functional diagram already sets `panOnScroll`, `panOnScrollMode="free"`, and `zoomOnScroll={false}` in `src/components/LiteSummaryDiagramReactFlow.js:5690`. The code architecture canvas sets the same options in `src/components/LiteSummaryDiagramReactFlowGitHub.js:4201`.

Neither overrides `zoomActivationKeyCode`. Installed React Flow / @reactflow/core **11.11.4** defaults that key to Meta on Mac and Control elsewhere (`node_modules/@reactflow/core/dist/esm/index.js:4093`). Its `useKeyPress` registers bubbling document keydown/keyup listeners (around line 1338). Its wheel handler uses panning only while the zoom modifier is not pressed (line 1979); its zoom filter explicitly allows `zoomActivationKeyPressed || zoomOnScroll` (line 2127). Consequently, `zoomOnScroll={false}` alone does not prevent modifier-assisted zoom.

Reproduction:

1. Open a functional diagram; ordinary wheel scrolling pans correctly.
2. Hold Command and press F to open Quick search.
3. Release F and Command after the search input receives focus.
4. Close search and scroll on the canvas with no modifier held.
5. The viewport zooms instead of panning.

`QuickSearch.js:102` and `:121` stop propagation of every dialog keydown and keyup to protect the underlying canvas shortcuts. React Flow receives the initial Command keydown before the dialog opens, but never receives Command keyup inside the dialog. The canvas therefore retains the pressed modifier state after search closes. Recorded wheel events have **metaKey=false and ctrlKey=false** while zoom still changes. The modifier keyup appears in document capture logging but is absent from document bubble logging.

This is a confirmed interaction between the search feature and React Flow's default modifier handling. The recent subsystem placement/overlap helpers do not handle wheel events and are not the cause of this reproduced defect. It remains unconfirmed whether the user's particular observation followed search; an optional clarification was requested.

## Browser evidence

[Diagnostic script](../../scripts/diagnostics/review-canvas-trackpad-gestures.cjs) and [captured events / viewport measurements](canvas-trackpad-gesture-measurements.json).

| Sequence | Chrome, Mac | WebKit, Mac | Chrome with Windows UA/platform emulation |
| --- | --- | --- | --- |
| Ordinary scroll before search | Pan, unchanged zoom | Pan, unchanged zoom | Pan, unchanged zoom |
| Shortcut search, release modifier in dialog, close, ordinary scroll | Incorrect zoom | Incorrect zoom | Incorrect zoom |
| Press/release modifier outside dialog, then scroll | Pan restored | Pan restored | Pan restored |
| Open/close search using its button, then scroll | Pan retained | Pan retained | Pan retained |
| Synthetic pinch-style ctrl-wheel | Zoom | Zoom | Zoom |

For the Mac reproduction, the ordinary scroll after search changed zoom from **0.758706 to 0.642431**. Before search the same wheel delta translated the viewport by **−40, −60** without changing zoom. No page errors were recorded.

These are automated keyboard/wheel tests. WebKit is not a physical Safari trackpad session. The Windows run emulates platform and user agent on macOS; it is not native Windows hardware validation. A physical pinch gesture and other sources of modifier-release loss remain outside this reproduction.

## Other affected paths and distinctions

- Code architecture uses the same React Flow defaults and global search dialog; the same stuck-modifier mechanism applies by source inspection. It was not separately exercised through a code architecture project.
- SysML (`SysMLV2DiagramCanvas.js:55`), Safety Case (`SafetyCaseDiagram.js:134`), and cross-repository architecture (`CrossRepoArchitectureDiagram.jsx:120`) do not explicitly configure scroll panning. React Flow's defaults intentionally zoom on wheel events there. This is a separate navigation-consistency issue, not evidence that search is necessary to trigger zoom on those canvases.
- The Windows code-architecture review wheel capture only handles ctrl-wheel in review mode (`LiteSummaryDiagramReactFlowGitHub.js:2497`). It does not explain the Mac functional-canvas reproduction.
- Pinch-style ctrl-wheel zoom is separately enabled by React Flow's default `zoomOnPinch=true`. Disabling pinch globally would remove intended functionality without fixing lost modifier releases.
- The same missed modifier release can also leave React Flow's multi-selection modifier state active. That consequence is supported by shared `useKeyPress` wiring, but selection behavior was not independently reproduced here.

## Recommended fix and regression checks

1. Preserve the dialog's blocking of typing, Delete/Backspace and navigation shortcuts, but allow modifier key releases (Meta, Control, Shift, Alt) to reach the canvas key-state listeners. Do not simply remove all keyboard isolation or dispatch a global synthetic blur.
2. Explicitly document/configure scroll versus pinch behavior on the main diagram components. If Command/Control-scroll zoom is not intended, `zoomActivationKeyCode={null}` is an additional targeted safeguard; it is not a substitute for repairing stale modifier state used for selection.
3. Add browser regressions for the exact shortcut/focus/release/close sequence, including Close button, Escape, selecting a result and clicking outside. Assert viewport scale remains unchanged for subsequent ordinary wheel events and translation changes. Repeat with Ctrl+F and ensure genuine pinch-style zoom remains available.
4. Verify that typing/deleting in search still cannot delete diagram nodes, and normal multi-selection and mouse dragging work after closing search. Preserve viewport persistence and the current layout implementation.
5. Decide separately whether the secondary canvases should share the functional canvas's scroll-to-pan interaction.

Temporary workaround verified in the reproduction: close search, then press and release Command once outside the search input before scrolling again (Control on Windows). Opening search using its button also avoided this defect in the test.
