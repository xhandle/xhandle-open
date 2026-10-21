# Review of saved hazard entry regression fixes

Verdict: the two originally reproduced cases are fixed, but one lifecycle gap remains. No production code was changed during this review.

## P2 — Crossing the preparation threshold removes an already displayed table and resets collapsed groups

Source: `src/features/code-architecture-hazard-analysis/SavedHazardPanelLoader.js:29`, `:58`, `:61`.

The mounted-run reference is recorded only after large asynchronous preparation completes. A panel initially displaying 500 or fewer data rows is never recorded as mounted. When a subsequent same-run snapshot grows past 500 rows, the wrapper treats it as cold entry, replaces the table with the loader, and remounts the inner panel after preparation.

Two focused assertions reproduced the issue using a running analysis growing from 400 to 602 rows: the previously visible table disappears immediately, and previously collapsed groups return expanded after preparation (20 visible data rows instead of zero). Stop remains available through the new loading shell, so the cancellation fix still holds. This is a remaining gap in the loader behavior, not evidence that the latest cancellation change broke cancellation.

Recommendation: record displayed-run lifecycle independently of prepared-summary caching, including the small-table path. Keep the same-run panel mounted across threshold transitions while retaining correct normalization, freshness, and scope isolation. Add acceptance tests for growth across the threshold and replacement by a different run.

## Confirmed fixes

- Stop remains actionable during cold entry and preparation errors.
- Repeated partial snapshots during cold preparation do not hide Stop.
- Context and metadata changes after large preparation preserve the table and collapsed groups, with freshness recomputed.
- Same-run partial updates after large preparation preserve the mounted table.
- Existing warm-cache, superseded-project cancellation, row identity, navigation, scrolling and 26,278-row initial-loading tests pass.

## Validation

- Hazard and row-identity suite: 62 suites / 588 tests passed.
- New threshold acceptance audit: two assertions failed, reproducing the remaining issue above. Archived in `review-saved-hazard-entry-threshold.test.jsx.txt`; temporary source test removed.
- Separately reran `hazardCompletionPublicationAudit.test.js`: three previously documented save-count failures persist. They are not counted in the 588 passing tests and are unrelated to the loader changes.
- No production build rerun was needed for this read-only review; the preceding implementation's final build passed with warnings.

## Performance limits

Real Safari timing on the user's large project remains unverified. Functional readiness, eligibility and freshness each still execute synchronous work between yields, and mounted updates can perform synchronous layout work. Passing lifecycle tests does not demonstrate elimination of every large-project stall. No claim of zero regressions or guaranteed response time is made.
