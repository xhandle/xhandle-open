# Implement context-save performance fixes

Implement the recommendations from docs/investigations/context-save-performance-review.md in the Code-Based Architecture operational-context workflow. Preserve applicability decisions, row identity, context provenance, failure reporting, project/repository isolation, and hazard reasoning.

Avoid redundant run reloads after context saves, reject stale asynchronous loads, skip unnecessary CSV-draft construction when a saved run supplies the table, preserve import workspace guards, and index repeated header/review lookups. Avoid copying unchanged rows. Display saving feedback before synchronous work. Keep database migration and Projects persistence redesign outside this targeted change.

Add regression coverage for unchanged saves, Yes/No preservation, context edits and failures, saved-run notification behavior, and duplicate review matching. Run relevant tests and production build. Report measured improvements with clear synthetic/browser limitations. Do not commit or push unless requested.
