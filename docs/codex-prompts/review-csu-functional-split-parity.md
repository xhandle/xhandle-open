# Review CSU and Functional split-view parity

Perform a read-only engineering review of the current xHandle working tree. Code-Based Architecture CSU split view is the interaction baseline. Determine whether Functional view works and performs the same way, and identify concrete gaps. Do not implement fixes, alter customer records, regenerate analysis, commit, or push.

Trace the real implementations in generateFunctionalDecompositionFromGitHub, FunctionalArchitectureDiagram, LiteSummaryDiagramReactFlowGitHub, codeArchitectureNavigation, FilterableTableHeader, and VirtualTableBody. Compare:

- Pane composition, Tools sidebar ownership, responsive ordering, widths, independent scrolling, sticky headers, and toolbar placement.
- Pointer and keyboard divider resizing, bounds, cancellation, cleanup, viewport fit timing, and retained pane sizes when switching abstractions.
- From/To/Control Action links, first-click focus after mounting, repeated navigation, diagram-to-table reveal, stable identity, filtered targets, missing targets, and cancellation on scope/view changes.
- Column filters and resizing, persisted preferences, copy/export, virtualized rows, quick search, Collaborator selection, editing, review, and source traceability.
- Work triggered by resize/filter/selection events: derivation caches, full-dataset scans, changing props, React rerenders, mounting, diagram layout, and persistence.
- Existing tests: distinguish mocked component tests from real browser verification and actual performance measurements. Run relevant existing tests. Do not claim Safari or large-diagram performance parity without measurement.

Preserve legitimate differences in model content: Functional rows are derived and map to detailed source evidence. Matching UI mechanics must not implicitly enable unsafe edits or change downstream analysis semantics. Identify shared CSU defects separately rather than recommending their duplication.

Write a report with severity-ranked findings, exact file/line evidence, reproduction steps, a parity matrix, tests executed, limitations, and a bounded fix plan. Prefer shared pane/navigation/table mechanisms with row adapters over a second parallel implementation. Define acceptance checks for persistence, split resizing, filtered navigation, rapid scope changes, and representative large datasets.
