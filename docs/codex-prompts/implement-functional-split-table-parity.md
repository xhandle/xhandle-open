# Implement Functional split-view and table parity with CSU

Update xHandle's Code-Based Architecture Functional view so its diagram/table workspace works, renders, and responds like the existing CSU workspace. Implement the changes and verify them; do not stop at a plan. Start from the current working tree and preserve unrelated uncommitted changes. Do not commit or push unless separately requested.

Read `docs/investigations/csu-functional-split-parity-review.md` and confirm its findings against current code before editing. Treat CSU's established interaction and visual behavior as the baseline, while correcting shared defects rather than duplicating them. The existing Functional implementation has similar controls but still uses a separate pane/table implementation; adding another layer of matching CSS is insufficient.

## Scope and architecture

Use shared components/hooks for the split workspace, table shell, navigation lifecycle, and column-sizing behavior where practical. Supply view-specific row/column adapters and explicit capability flags. Avoid a broad rewrite of the analysis pipeline or diagram engine.

Preserve:

- CSU behavior, existing preferences, source identities, and saved diagrams.
- Functional responsibilities, interactions, classifications, counts, stable IDs, supporting source mappings, CSV export, inspection, and links back to detailed CSU evidence.
- Existing Functional node spacing, balanced grid layout, saved positions, route overrides, and model persistence.
- GitHub/local pipeline compatibility and all downstream Hazard & Remediation, Software Requirements, System Requirements, Subsystem Requirements, System / Subsystem Design, and Traceability Matrix behavior.

Do not change extraction, abstraction generation, eligibility rules, analysis storage formats, or downstream analysis inputs to solve this UI task. Do not regenerate customer analysis or clear browser records. Functional data remains derived: matching table mechanics does not authorize editing aggregate labels/details in ways that silently rewrite source relationships. Retain the existing read-only data policy and explicit annotation/layout permissions.

## Split workspace

1. Render the Functional diagram pane, divider, and Functional table pane using the same structure as CSU. Include the Tools sidebar in the same diagram-pane width calculation. Avoid nesting an independent split layout inside the diagram surface.
2. Match CSU's default 50/50 split, 25–75% bounds, pointer dragging, keyboard arrows in 5% increments, focus appearance, divider semantics, pane minimum sizes, and independent scrolling.
3. Keep the diagram first and table second on narrow screens, with the same breakpoint behavior as CSU. Match table-only and diagram-only sizing; no empty diagram wrapper or blank Tools strip in table-only mode.
4. Retain divider state across abstraction changes using the same state owner as CSU. Do not claim or introduce reload persistence for the divider unless deliberately implemented consistently for both views.
5. Schedule viewport fitting after committed pane-size changes, consistently with CSU. Resizing must not regenerate the model, change node positions, reset manual routes, or repeatedly auto-arrange the diagram.
6. Handle pointer cancellation, lost capture, unmount, and project/view switches. Remove temporary listeners and restore cursor/user-selection styles. Correct existing shared drag-cleanup defects if encountered.

## Table rendering and behavior

The standalone Functional table and its split-view table must be the same table component, using the CSU table shell and styling conventions:

- Fixed copy/export toolbar outside the scrolling body, aligned to the visible right edge.
- One correctly positioned sticky header; toolbar and header must not overlap when scrolling.
- Matching typography, text size, header background, borders, row striping, hover/focus/selection highlights, padding, vertical alignment, wrapping, and link placement.
- Fixed column layout, horizontal overflow, consistent column widths/minimums for corresponding fields, and the same column-resize mechanics. Long descriptions must not squeeze function/action columns or expand the surrounding workspace.
- Persist column widths with stable column IDs and a Functional schema/scope key. Preserve existing CSU keys and preferences; reset widths safely when the relevant schema/scope changes.
- Shared filter menus, search within filter options, cascading availability, selected-value indicators, row counts, clear-filter behavior, and empty states.
- Shared virtualized rows, complete filtered-dataset copy/export, and quick search. Do not copy/export only mounted rows or lose offscreen search results.
- Collaborator cell/row selection with Functional headers, stable Functional row IDs, and exact source evidence. Do not misrepresent a derived row as a raw CSU row.

Use the existing Functional schema and source-evidence columns. Present Function (From), Function (From) Details, Control Action, Control Action Details, Function (To), and Function (To) Details consistently with CSU. Preserve interaction-type distinctions; do not reclassify feedback/data/service interactions as controller-issued STPA actions merely because the column is titled Control Action. Do not manufacture CSU-only metadata or review controls that have no valid Functional mapping.

## Navigation parity

1. Reuse CSU's view-transition policy: a table-only diagram link opens diagram-only; an existing split remains split. Keep Functional abstraction selected when navigating its own rows.
2. From/To arrows resolve exact Functional node IDs; Control Action arrows resolve exact Functional edge IDs. Internal rows with no actual edge must not show a misleading edge link.
3. Own pending focus in an effect/state lifecycle shared with CSU. Wait for diagram mount, hydration, layout, and readiness; cancel obsolete requests on target/view/abstraction/project/data change and unmount. Repeated requests for the same target must still work.
4. Diagram-to-table navigation reveals and highlights the exact Functional row, including virtualized/offscreen rows. Preserve split mode. Keep filters when the row is already visible; clear only when necessary to reveal the requested target, matching CSU.
5. Missing or ambiguous explicit identities must show a useful notice and must not fall back to an unrelated positional row. Preserve supporting-call inspector access and explicit navigation from that inspector to source rows or CSU.
6. Review the existing tests that assert table-only Functional links open split: update those expectations deliberately to the CSU policy, not merely to make failures disappear.

## Performance

Memoize Functional summaries, boundary-review index lists, layout keys, and row/column adapters by immutable data revision. Keep callbacks stable. Isolate table/filter/column-resize state from diagram rendering and prevent unnecessary full-model scans, graph reconstruction, storage writes, or layout runs during pointer movement. Coalesce resize updates to animation frames where needed and share that behavior with CSU without changing its interaction contract.

Use real rendered fixtures to compare the views. Do not claim speed parity from using the same renderer or from mocked tests alone. Preserve complete data and interactive accuracy; do not improve timing by hiding relationships or dropping evidence.

## Verification

Run relevant existing navigation, Functional model/table, CSU layout/routing, filtering, virtualization, persistence, and downstream source-trace tests. Add focused regression coverage for the reviewed gaps. Complete lint and production build verification.

Use isolated synthetic fixtures, not customer browser data or paid provider calls, for browser checks:

- Compare CSU and Functional table-only/split/diagram-only views at the same viewport, including long descriptions and narrow-screen layouts. Capture screenshots to confirm matching table appearance, pane ordering, sticky header/toolbar behavior, and horizontal scrolling.
- Verify first-click and repeated From/To/action navigation with the real diagram mounted; verify reverse reveal for offscreen and filtered rows.
- Resize panes and columns by pointer and keyboard; switch views/projects during pending focus and drag; exercise cancellation and lost capture. Verify no stale focus, stuck drag, or unintended data/layout mutation.
- Verify width restoration after abstraction switching and reload, split-state retention across abstraction changes, quick search, full filtered copy/CSV export, and Collaborator selection.
- Benchmark matched 1k- and 5k-row fixtures with comparable rendered node/edge complexity. Record divider interaction latency, long tasks, table scrolling, and diagram pan/zoom frame times over repeated runs. Report both views' measurements and investigate material regressions rather than inventing pass thresholds after seeing the results.
- Include Safari if available; if it cannot be tested, explicitly report that limitation. Chromium or mocked tests do not establish Safari parity.
- Confirm no changes to source rows, Functional-to-source mappings, downstream analysis identities, or saved model/diagram revisions from UI-only operations.

## Completion report

Document the shared implementation, findings resolved, intentional derived-data restrictions, files changed, checks run, actual browser/performance measurements, and any remaining gaps. Mark untested items as untested. Provide clear reload/use instructions without asking users to rerun repository or Functional analysis for these UI changes.
