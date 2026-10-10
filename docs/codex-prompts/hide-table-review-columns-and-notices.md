# Hide table Review columns and review notices

The user clarified that “remove columns” meant **Review columns**, not Remove/Delete action columns.

Audit user-visible tables across Projects and Code-Based Architecture. Hide dedicated Review columns (status/buttons) and table-top notices announcing items that need review.

Make a reversible presentation-only change. Preserve stored fields, review decisions, callbacks, applicability and analysis gating, imports/exports, copy behavior, and dedicated review workflows. Keep Remove/Delete controls visible. Where a Review column also contains Generate/Regenerate or other non-review controls, retain those controls under Actions while hiding review badges. Do not remove data or automatically mark anything reviewed. Keep operational errors, generation progress, import confirmation, and storage/save warnings visible.

Use shared presentation settings and apply them consistently to headers, cells, column widths, and empty/group/virtual row spans. Hide dedicated review-needed notices at the render boundary without changing their computed state or validation. Keep domain analysis values such as Guide Phrase Applicable and Safety Classification intact.

Verify table rendering, filtering, copying, linking, editing, grouping, and hazard-panel behavior with the existing tests. Run a production build and document scope and validation. Do not commit or push unless requested.
