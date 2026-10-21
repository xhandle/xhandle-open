# Saved hazard entry regression fixes

Implemented the prompt in `fix-saved-hazard-entry-regressions.md`.

## Changes

- Cold preparation and preparation errors retain an actionable Stop analysis control for active runs. Incoming partial snapshots cannot hide cancellation.
- Once the same run is displayed, context, metadata and partial-result changes preserve the mounted panel/table instead of replacing it with the entry loader.
- An unchanged summary reuses normalized rows, while context-sensitive freshness and eligibility are recomputed. Partial prepared views explicitly fall back to current functional readiness and freshness.
- Preparation identity keys are memoized; project/repository/run isolation remains in the key and scope checks.

## Validation

- Targeted hazard/row-identity regression run: 62 suites, 588 tests passed.
- After memoizing identity keys: all 11 tests in the three saved-entry suites passed again.
- Six acceptance tests cover Stop during cold preparation, repeated partial snapshots, preparation failure, mounted partial updates, preserved collapse state across context changes, and updated freshness without table replacement.
- Existing integration test covers 26,278 rows, visible initial progress and bounded mounted table rows.
- Final production build passed with existing warnings; no SavedHazardPanelLoader hook warning remains.
- `git diff --check` passed.
- The previously documented `hazardCompletionPublicationAudit.test.js` suite remains excluded from the broad run: its three unrelated save-count assertions were already failing before this fix. These changes do not repair or conceal that separate issue.

## Limits

Actual Safari timing on the user’s large dataset has not been measured. Functional metadata/freshness stages and mounted-table updates still include synchronous work. Incoming snapshots before first preparation completes may restart preparation, but Stop remains available; after mounting, same-run updates keep the table in place. No database schema, generation policy, or saved analysis content was changed. No commit or push performed.
