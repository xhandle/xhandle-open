# Add a System element to the existing functional diagram editor

Extend the existing LiteSummaryDiagramReactFlow editor. Do not replace it, add a second diagram, change its layout defaults, or change existing function/subsystem styling and interactions.

Add one System creation control beside the existing creation controls. Render systems with the existing group renderer and editing/resizing UI, with a small type label identifying the new element. A system may contain subsystems and/or functions. Reuse the existing selection and Add Selected Nodes To Group / Remove From Group actions. Subsystems continue to contain functions; do not allow cycles or systems inside subsystems. Moving a system must move its contents; moving or removing a subsystem must preserve its functions and connections.

Persist element type and parent membership through project reload, JSON export, and existing undo/redo. Keep legacy saved groups as subsystems without a migration or relayout. Preserve all existing behavior for diagrams that do not use systems. Reuse the same component in the hazard split view. Verify containment, coordinates, resize, removal, persistence, and undo/redo with regression tests.
