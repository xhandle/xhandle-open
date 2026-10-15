# Hazard tab responsiveness fix

Implemented the prompt in hazard-tab-lag-fix-prompt.md.

## Changes
- App supplies stable draft inputs to useHazardDraft. A dedicated bundled worker builds the draft outside React rendering. A single input revision is cached across tab switches; changed project, method, context or architecture invalidates it. Obsolete workers terminate and cannot publish stale results.
- Hazard panel displays preparation progress or a retryable preparation error.
- Summary table mounts a viewport window of group headers and rows with spacer heights and measured height refinement. Full data remains available for filtering, counts, exports and quick search.
- Search and trace navigation reveal distant rows before focusing them.

## Validation
- 639 tests passed across 70 hazard, assurance and STPA suites.
- Real worker-entry builder test passed (640 targeted tests total).
- 11 summary-table tests passed again after final measurement lifecycle adjustment.
- Production build passed, including the worker bundle. Existing lint/bundle-size and outdated Browserslist warnings remain.
- git diff --check passed.

No live Safari timing was captured against the user's large project. Structured cloning into the worker, full-model normalization, grouping and height estimation still have input-dependent cost. This change removes the identified synchronous draft build and all-row DOM mounting; it does not claim zero latency for arbitrarily large inputs.
