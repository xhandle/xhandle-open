# CSU function edge routing

Executed [the implementation prompt](../codex-prompts/match-csu-function-edge-routing.md).

The CSU button selects the detailed code-architecture view. Its function connection-point allocation already matched Projects, but rectangular edges used the basic React Flow step renderer. Projects used a separate orthogonal renderer with fixed endpoint lead-ins, bend clearance, and draggable segments.

Extracted the existing Projects geometry and renderer into `OrthogonalFunctionEdge.js`. Projects retains its existing events/history integration and re-exports its existing geometry helpers. CSU uses scoped callbacks, so route adjustments do not dispatch Projects routing events. Pointer listeners are removed on release, cancellation, or unmount.

CSU rectangular edges and bundles now use the shared renderer. Adjustments persist by diagram storage key and stable edge/bundle ID, survive routing-style changes, and can be reset individually. Bundles receive explicit connection handles using absolute positions through nested containers. Grouped Bezier rendering now has a valid Bezier fallback. Compact abstraction views retain their existing step renderer. Review mode hides route controls and does not persist changes.

Node layout, function/CSC spacing, analysis rows, call identities, and downstream analysis mechanics were not changed. This reuses the Projects router; it does not introduce global obstacle avoidance or eliminate crossings with unrelated nodes.

Validation:
- 57 tests passed across Projects geometry/history, system-node regression, and CSU persistence/position tests.
- `csu-edge-routing-check.cjs` passed in an isolated Chrome context: segment dragging, fixed node positions during route edits, scoped callbacks, style switching, compact view, reopening/scope isolation, reset, bidirectional markers, attachment while moving functions, independent bundle adjustments, and read-only controls. No browser runtime errors.
- Production build and whitespace check passed. Build has existing warnings.
- Safari was not exercised in this environment.
