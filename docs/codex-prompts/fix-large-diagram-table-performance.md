# Fix large diagram and hazard table interaction lag

Implement the confirmed findings in `docs/investigations/large-diagram-table-performance-review.md`.

- Isolate project hazard row rendering and selection; keep callbacks current without invalidating every row. Replace draft textarea grids with direct plain-text editing saved on leaving the cell. Retain preprocessing, read-only identifiers, review controls, and save errors.
- Mount expensive hazard cells as they approach the viewport. Preserve natural text-driven row height and existing row IDs, links, grouping, and resizing. Never unmount an active/visited editor just because it scrolls away.
- Provide search entries from the filtered, expanded hazard model so deferred rows remain searchable. Reveal a deferred row before jumping to its matching cell. Preserve the DOM fallback for other tables and existing keyboard handling.
- Retain unchanged diagram presentation object identities, memoize custom node renderers, avoid no-op edge selection updates, initialize stored positions once, and index membership checks. Preserve layout, viewport, system/subsystem hierarchy, links, history, and persistence.
- Avoid building hidden functional table rows in diagram-only mode. Keep the diagram mounted when switching workspace views.
- Do not change classification, generation, CSV behavior, recovery safeguards, or saved layout algorithms.

Run meaningful regression tests and the isolated browser benchmark on the same fixtures as the review. Exercise deferred search, filters, collapsed groups, edit save/reload, natural cell heights, and layout restoration. Report measured improvements with development-build/browser limitations. Do not commit or push.
