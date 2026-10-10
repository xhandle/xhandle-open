# Table review presentation update

Implemented the clarified request to hide **Review**, not Remove/Delete, columns.

- Shared `tablePresentation.js` flags hide Review columns and table-top review-needed notices.
- Architecture decomposition tables, including their virtual row spans and column widths, omit review cells and headers.
- Shared engineering artifact and Code-Based Architecture hazard tables omit the Review column even when callers provide review records.
- Projects functional tables omit Review. Projects hazard tables retain Generate/Regenerate and row-resize controls under Actions, with review badges hidden.
- Generic review banners, Projects preprocessing-conflict notices, and Code-Based Architecture preprocessing/unresolved-applicability notices are hidden at render boundaries.

Review records, callbacks, data schemas, applicability decisions, analysis gates, imports/exports, and review workflows remain unchanged. Remove/Delete controls remain visible. Operational errors, save warnings, import confirmations, and analysis progress are not suppressed. Domain fields such as Guide Phrase Applicable and Safety Classification remain visible.

Validation: 61 tests passed across five existing table/panel suites, covering rendering, editing, filtering, copying, grouping, linking, and hazard eligibility. The notice test now checks that unresolved applicability and preprocessing conflicts remain in the underlying data while the notices are hidden. Production build passed with existing warnings; `git diff --check` passed.

Prior uncommitted applicability-audit changes were preserved. No commit or push was performed.
