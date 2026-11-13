# Codex prompt: preserve source architecture layout

Review the code-based architecture source diagram, saved snapshot, artifact adapter, and shared Projects diagram renderer. Fix the architecture artifact so its initial geometry exactly matches the selected source abstraction: identical node positions, dimensions, parent relationships, and container bounds. Do not substitute another automatic layout during translation or hydration.

Preserve the shared Projects canvas interactions, colors, manual arranging and resizing, undo/redo, and edge aggregation. Retain deliberate saved user arrangements. Provide a way to restore the source arrangement when an earlier version saved a distorted layout. Capture source layout overrides where applicable.

Add regression coverage comparing complete rendered geometry against the source projection, including multiple nested containers and compact CSC elements. Verify that mounting and reopening do not silently rearrange the diagram. Run relevant tests and report the cause, changes, and verification limits.
