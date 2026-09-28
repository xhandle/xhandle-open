Review findings
- Initial-arrangement eligibility is inferred from position-map emptiness. Position maps are
  also written during graph/category initialization and teardown, before layout completes.
  Those writes are not evidence that the first arrangement finished.
- There is no persisted pending/completed initial-layout status.
- The initial-layout flag is cleared before the async arrangement resolves.
- ReactFlow onInit unconditionally fits the viewport on every mount. Pan/zoom are not
  persisted, so reopening cannot reproduce the view as left.
- Layout runs after graph publication; an unfinished layout can be visible.
Implementation: persist explicit first-layout status; preserve legacy saved positions;
mark completion after arrangement; restore viewport instead of unconditionally fitting;
keep the initial graph hidden until arrangement completes; verify remount and manual edits.

Browser reproduction uncovered the concrete geometry overwrite:
- onNodesChange treated every dimensions notification as a group resize, including
  ordinary ResizeObserver measurements. Delayed measurements overwrote arranged sizes.
- Only actual resizing notifications now enter the resize path; NodeResizer callbacks remain.
- Initial arrangement waits for measured nodes and a settled graph commit.
Validation: WebKit first-render geometry equals a subsequent manual Auto arrange.
After zooming and reloading, geometry and viewport are identical; no browser errors.

CSV replacement follow-up
- The previous browser test seeded rows directly, missing the existing starter-diagram path.
- CSV import can replace every function after the starter layout is marked complete.
- Import now marks a wholly new function graph pending and sends a fresh layout request;
  updates retaining existing functions preserve their saved layout.
- Added an in-place replacement regression and a WebKit file-input import test comparing
  first geometry with manual Auto arrange, then checking geometry/viewport after reload.
