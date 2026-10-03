# Manual container resize relocation

Resizing a system could cross the existing 80-unit system clearance. The resize-end overlap settlement then moved one entire system below its neighbor. A regression reproduced the unexpected jump before this fix.

Manual system and nested-container resizing now checks each proposal against content bounds and system clearance before applying it. Invalid proposals retain the last valid bounds instead of moving descendants or triggering system relocation. Resize sessions preserve starting child coordinates so top/left resizing keeps descendants at their original canvas positions. The automatic import and Auto arrange algorithms are unchanged.

Validation:
- Integration regression covers an accepted top-edge expansion followed by a rejected collision, stationary descendants/neighbors, undo/redo, and reload.
- Geometry tests cover direct functions, nested subsystems, clipping, and ancestor collisions.
- Full suite: 1,176 tests passed across 127 suites; two tests/one suite skipped.
- Isolated Chrome and WebKit browser checks passed native resizing, stationary contents, undo/redo, and reload.
- Existing WebKit CSV replacement checks passed diagram/table/split views, initial layout matching Auto arrange, and reload.

The browser fixture uses isolated synthetic project storage, not customer projects. Run `scripts/diagnostics/verify-manual-container-resize.cjs` with `XHANDLE_PLAYWRIGHT_PATH` and either `VERIFY_BROWSER=webkit` or `XHANDLE_CHROME_PATH` configured.

## Follow-up: consistent system boundary interactions

The requested shrink behavior was clarified: a boundary should push its children inward, as the existing subsystem resizer does. Manual system/nested-container resizing now clamps each direct child's position using its own dimensions. A subsystem moves as a unit with its functions, while outward resizing leaves contents stationary. The minimum size fits the largest direct child; the system-neighbor clearance guard remains in place.

Subsystem dragging previously exited before recording the pointer offset used for continuous child expansion. The nested expansion path could also restore stale group-box coordinates over the newly dragged node position. Container children now enter the same pointer-tracking lifecycle, and a dedicated manual helper expands each ancestor by the exact overshoot in any direction. Node and container coordinates are updated together; left/top expansion preserves stationary siblings' canvas positions. Automatic layout/import helpers are unchanged.

Validation: 1,183 tests passed (127 suites, two tests/one suite skipped). New geometry cases cover all four boundaries and function-to-subsystem-to-system expansion. Integration cases cover successive drag samples, shrink pushing, undo/redo and reload. `verify-system-boundary-interactions.cjs` passed native Chrome/WebKit gestures, incremental growth measurements, preservation of function offsets, and reload without page errors.
