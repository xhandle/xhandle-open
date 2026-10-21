# Hazard table threshold fix

Implemented `fix-hazard-table-threshold.md`.

The loader now tracks the scope of the displayed panel independently of the cached prepared snapshot. Small displayed runs therefore receive the same lifecycle protection as large prepared runs. Same-run updates across 500 rows keep the panel mounted. Cold preparation clears the displayed scope, so a different run still gets initial loading progress rather than incorrectly inheriting the prior run's bypass.

Validation:
- 13 focused saved-entry tests passed, including the former failing 400-to-602-row case with collapsed groups preserved.
- Added coverage for repeated threshold crossings, unchanged snapshot rerenders, continued Stop availability and replacement by another project's large run.
- Broad hazard/row-identity suite: 62 suites, 590 tests passed.
- The previously documented publication audit suite remains excluded: its three unrelated save-count failures were reproduced during the preceding review.
- Production build passed with existing warnings; no loader warning. `git diff --check` passed.

No schemas, generation policy or saved results changed. Live Safari response time remains unverified; this fix addresses table lifecycle, not all potential synchronous work. No commit or push performed.
