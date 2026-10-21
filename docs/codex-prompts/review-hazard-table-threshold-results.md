# Hazard table threshold fix review

Verdict: the reviewed threshold issue is fixed. No new defects were identified in the inspected implementation or tested paths. No production code changed during this review.

## Implementation assessment

`SavedHazardPanelLoader.js` now records displayed scope independently of the prepared-summary cache. Small displayed runs qualify for same-run lifecycle preservation, preventing the initial-loading branch from replacing their table when they cross 500 data rows. Cold preparation clears displayed scope; replacement runs do not inherit the bypass. Cached normalized rows remain guarded by scope and sheet identity, while current freshness inputs are retained in the preparation identity keys.

The original 400-to-602-row reproduction now preserves the same table and collapsed groups. Repeated threshold crossings and same-snapshot rerenders also preserve the table. Stop remains present through preparation and errors. Existing freshness and superseded-project tests pass.

## Additional review checks

- StrictMode: start at 500 rows, collapse groups, repeatedly cross the threshold. Table identity and collapsed state remain stable; Stop remains available.
- Interrupted preparation: begin one large run, switch to a different project's small run before completion, grow that replacement beyond the threshold, then return to the first run. Old preparation never replaces the current table; row identities match the selected run.

## Validation

- 63 suites / 592 tests passed, including the two additional review tests.
- Temporary review tests are archived in `review-hazard-table-threshold-audit.test.jsx.txt` and removed from src.
- The known `hazardCompletionPublicationAudit.test.js` suite remains excluded; its three unrelated save-count failures were verified in the preceding review. The passing count does not include them.
- `git diff --check` passed.
- No new build was necessary for this read-only review; the implementation turn's production build passed with existing warnings.

## Limits

This is not a guarantee of zero regressions. Real-project Safari timing remains unmeasured. Functional metadata/freshness stages and mounted table updates still include synchronous work; lifecycle correctness does not establish a maximum response time. The review did not change storage, saved results, schemas, generation behavior, or commit/push anything.
