# Match CSU function-edge behavior to Projects

Review and implement in the current xHandle checkout. The user wants edges in the Code-Based Architecture CSU view to interact with function nodes like edges in the Projects functional diagram.

Findings: the CSU UI selects the `detailed` abstraction. Both canvases already use the same four-sided connection-point allocation. Projects rectangular edges use `buildManualOrthogonalRoute` and an editable orthogonal renderer, with stable endpoint lead-ins and draggable segments. CSU currently uses React Flow's basic StepEdge. Its grouped Bezier registration can also resolve to `false` instead of a renderer.

Implementation:
- Share the existing Projects orthogonal geometry and renderer without changing its routing rules or existing Projects event/history integration. Preserve its exported geometry helpers for existing consumers/tests.
- Use that renderer for rectangular function edges in the CSU/detailed architecture view, including bundles, arrowheads, labels, highlighting, and movement with endpoints. Keep the existing compact abstraction renderers.
- Scope CSU segment edits through callbacks to their own mounted diagram, persist route adjustments by diagram storage key and stable edge/bundle ID, and provide reset for the selected route. Retain adjustments when toggling routing style. Review-only views must not write changes.
- Keep a valid Bezier renderer when hierarchy containers are present.
- Preserve call identities, row references, table navigation, hazards, requirements, design, traceability, aggregation semantics, node placement, and the recently adjusted function/CSC spacing. Do not change code analysis or introduce automatic node rearrangement.
- Verify shared routing geometry and existing Projects regressions, then exercise CSU rendering, segment drag, reset, persistence, bundling, route styles, and compact views in an isolated browser. Do not modify user browser data or call live AI services. Run a production build and report limitations honestly.

Execute this prompt now. Do not commit or push unless requested.
