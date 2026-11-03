# Fix the confirmed hazard CSV regressions

Implement the three findings in `docs/investigations/hazard-csv-regression-review-2026-11-03.md`: support legacy export/edit/import with missing or blank persisted row IDs using the interactive reader's stable normalization; preserve operational-context assignment and assessment review warnings in streaming publication; and restore the exact previous Summary and preprocessing on Undo without normal import normalization.

Keep processing bounded and worker-based, preserve evidence and unrelated sheets, retain cancellation, integrity and revision protections, and reject stale context configuration. Add meaningful regression tests for each finding and run the relevant existing suites and lint. Document results and limits. Do not modify the customer CSV, installed data, running preview/pending import, or publish, commit, push, or change desktop build pins. Do not delegate to other agents.
