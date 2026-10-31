# Codex prompt: review crash risk across Code-Based Architecture tabs

Work in `/Users/Nick/xhandle-open`. This is an investigation-only task. Do not modify application code, tests, configuration, dependencies, or build artifacts. You may write reports and disposable diagnostic output under `/tmp`.

A customer reports that the Code-Based Architecture **Software Requirements** tab repeatedly crashed in xHandle Desktop. A separate confirmed defect previously caused rapid continuous scrolling in the Hazard Analysis table to throw React's `Maximum update depth exceeded` error. Determine whether the software-requirements failure could share that mechanism and whether similar crash paths exist across every Code-Based Architecture tab in browser and Electron.

Review these surfaces:

- Architecture Diagram and its table modes/abstractions
- Software Requirements
- System Requirements
- Subsystem Requirements
- System / Subsystem Design
- Traceability Matrix
- Hazard Analysis
- Safety Remediation

Required investigation:

1. Trace each surface's component tree, shared table/virtualization hooks, storage loading, measurement, resize, scroll, focus/navigation, filtering and refresh behavior.
2. Audit `useEffect`/`useLayoutEffect`, `ResizeObserver`, scroll listeners, animation frames and state setters for feedback loops, unstable dependencies, stale callbacks, updates after unmount, unbounded retained data and synchronous work that can freeze or terminate the renderer.
3. Pay particular attention to `VirtualTableBody`, `EngineeringArtifactTable`, `EngineeringArtifactPanel`, `TraceabilityMatrixPanel`, `FunctionalDecompositionTable`, React Flow diagram code and the hazard row-window hooks. Compare the software-requirements path with the exact hazard update-depth failure mechanism.
4. Run existing relevant tests without changing them. Use production builds and disposable synthetic profiles to stress every tab in Chrome and Electron with large tables, rapid continuous scrolling, scrollbar jumps, filtering, column resizing, tab cycling, refresh and distant-row focus. Capture page errors, console errors, renderer termination/crash signals, long frames, DOM bounds, pending animation frames/observers/listeners and memory where the harness supports them.
5. Separate proven defects from plausible risks. Do not claim a customer failure was reproduced unless it was. State the limits of synthetic workloads and the missing customer crash log/project characteristics.
6. Report findings in severity order with exact files/lines, trigger, impact, evidence, affected tabs and a recommended remediation. Explicitly answer:
   - Is Software Requirements using the same row-window implementation as Hazard Analysis?
   - Could it produce the same `Maximum update depth exceeded` loop?
   - Which behavior is shared across all tabs, and which is tab-specific?
   - What evidence should be collected from the customer's next crash to distinguish React recursion, renderer out-of-memory, native process termination and an unhandled exception?

Do not implement fixes. Preserve the dirty worktree and do not publish, package, install, or update the desktop app.
