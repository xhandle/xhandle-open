# Project system/subsystem visibility — November 3, 2026

The user reported that moving a subsystem into a system, either by dragging it or choosing the system from the context menu, made system/subsystem blocks disappear while functions and edges remained visible. Switching away and back restored them. Desktop release publication remains paused at the user's request.

## Cause and reproduction

The hierarchy builder in `LiteSummaryDiagramReactFlow.js` recreated every `groupBox` with CSS dimensions but omitted its existing React Flow `width`/`height` measurements. React Flow's controlled-node update replaces those fields; its node wrapper sets `visibility: hidden` until both measurements are present again. Function nodes retain their dimensions through a separate construction path. This explains why container blocks can disappear together while functions and connections remain visible.

Ordinary synthetic and private copied-workspace runs did not reproduce a persistent disappearance when resize callbacks arrived promptly. A focused test then initialized the containers, moved the subsystem, and deliberately delayed subsequent container resize notifications. Before the fix, the unit test lost the measured sizes after the move. A real Electron/React Flow reproduction showed **two saved containers, both hidden**, with the functional graph still present. This establishes a concrete missing-measurement failure path; the exact timing of the user's original resize delivery was not captured.

Before-fix evidence: `/private/tmp/xhandle-group-measurement-repro.log` and `/private/tmp/xhandle-project-group-runtime-delayed-before.log`.

## Fix

During hierarchy reconstruction, retain each existing container's measured width and height. Keep the stored box geometry and CSS dimensions authoritative, and continue accepting new ResizeObserver measurements normally. A temporary lookup contains only IDs and numeric dimensions, rather than retaining prior node graphs.

The fix is in the shared project diagram component used by Chrome and Electron. It does not remount the canvas, fit/reposition the viewport, add timers, or introduce per-frame refresh work. New nodes still follow normal initial measurement. The installed Desktop app has not been changed by this local source edit.

## Verification

- The focused measurement-preservation regression failed before the production change and passes afterward.
- Regressions cover both drag/drop and context-menu reparenting, retained positive dimensions while delivery is pending, later measurements after container growth, and absence of an automatic fit-view jump. A controlled Strict Mode case also checks saved/live group identity.
- **125 tests across 14 suites passed**, covering project systems, manual editing, hierarchy/spacing, undo/redo, initialization, table details, deferred observers, workspace views, viewport resize handling, presentation caching, handles, and quick search.
- Real Electron/React Flow tests kept both existing containers visible during delayed resize delivery for both membership paths. Reopening also retained visibility and saved membership. These are disposable synthetic renderer tests, not a test against the user's active project.
- Focused lint found no errors; existing component warnings remain. Whitespace checks passed. The final optimized production build passed with existing repository warnings; its log is `/private/tmp/xhandle-group-visibility-build.log`.

Final regression log: `/private/tmp/xhandle-group-visibility-final-tests.log`. Runtime logs: `/private/tmp/xhandle-project-group-runtime-delayed-after.log`, `/private/tmp/xhandle-project-group-runtime-delayed-drag.log`, and `/private/tmp/xhandle-project-group-runtime-delayed-drag-final.log`.

The affected project's saved diagram was also inspected and exercised only in private disposable copies. The active installed app and original project storage were not modified. No AI provider calls were made by the reproduction fixtures. No release command, upload, publication, commit, or push was performed for this fix. The previously prepared signed 0.2.14 candidate predates this change and must be rebuilt and verified before any resumed release.
