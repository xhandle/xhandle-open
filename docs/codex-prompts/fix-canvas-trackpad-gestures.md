# Fix scroll-to-pan after Quick search

Implement the confirmed fix described in docs/investigations/canvas-trackpad-gesture-review.md.

Repair the lost modifier-release event when Cmd+F or Ctrl+F opens Quick search and the modifier is released inside the dialog. Let the existing canvas key-state listeners clear held modifiers while retaining isolation for typing, Delete/Backspace, navigation, composition and activation keys. Preserve ordinary scroll panning, pinch zoom, deliberate modifier-scroll zoom, multi-selection, dragging, viewport persistence, and all existing uncommitted work. Do not change unrelated canvas interaction policies or layout algorithms, disable all keyboard isolation, synthesize global blur events, or upgrade dependencies.

Add regression tests that fail for the current defect and exercise real React Flow key-state handling. Run browser regressions for Close, Escape, result selection and backdrop dismissal; verify ordinary scrolling changes translation without changing zoom afterward. Verify text deletion in search cannot delete nodes, multi-selection resets, dragging works, and pinch-style zoom remains available. Test Chrome and WebKit plus a clearly labeled Windows shortcut emulation if native Windows is unavailable.

Use isolated synthetic browser projects only. Save the prompt, reproducible checks and validation results. Run relevant tests and lint; report limitations accurately. Do not commit or push unless separately requested.
