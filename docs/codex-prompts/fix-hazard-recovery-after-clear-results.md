# Prevent recovery from recreating cleared analysis

Clear now revokes matching session-local attempt claims synchronously, before storage deletion awaits. Revoked claims leave tombstones instead of becoming absent (absent ownership permits legacy saves). Late or queued recovery writes fail the existing authorization checks and cannot publish save-state events. A revoked attempt cannot reclaim ownership or displace a fresh claim.

Fresh attempt IDs, including a new pending attempt on the same outer record, can save normally. Project/repository/method filters preserve unrelated claims. Database schema and serialized write ordering are unchanged.

Validation: 6 regression suites passed (62 tests), plus 2 ownership-helper tests; the store/helper suites were rerun after the final guard change and passed. Total distinct tests: 64. Coverage includes delayed recovery after Clear, queued writes, absence of stale save notifications, fresh analysis after Clear, unrelated projects, method-filter isolation, and a fresh pending attempt sharing an outer ID. Diff whitespace checks passed. Build status reported in final response.

Tests used isolated synthetic data and test-local storage. No live providers or customer data accessed. Actual Safari and multi-tab execution were not exercised. Changes are not committed or pushed.
