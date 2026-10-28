# Paged hazard follow-up fixes — 2026-10-28

Executed `docs/codex-prompts/fix-paged-hazard-followup.md` against the three findings in the follow-up review. Preserved unrelated working changes. No customer storage, paid analysis, commit, push, or release was involved.

## Changes

- Resolved edit snapshots carry an enumerable symbol containing their source revision. It survives object spreads and context alignment but is excluded from persisted payload serialization. Atomic publication rejects stale revisions; successful saves advance the token. By-ID edit reads also validate their revision. Rejected edits are removed from the pending-save cache and do not broadcast their proposed contents as the active run. CSV and narrative handlers preserve the check, and narrative conflicts propagate without committing the stale snapshot.
- Governed review state now asynchronously reads only Summary pages, with a 32 MiB serialized UTF-16 row-data ceiling and optional cancellation. Raw page reads preserve the original columns/values so review fingerprints match apply-side validation. Collaborator callers await the state provider. Apply, undo, and source navigation resolve the appropriate data, validate project/run scope after asynchronous reads, and avoid committing into a different view. Results-review row updates resolve the stored run and match row identity/content before saving, instead of treating a descriptor as an empty Summary.
- Partial inspection excludes published review annotations, CSV undo, editing callbacks, and narrative review display. Published review annotations are matched against the current page by row identity/content and mapped to absolute indices rather than trusting historical row positions after deletion.

## Validation

- Broad hazard, transfer, collaborator, functional-decomposition, and diagram suite: 107 suites / 1,066 tests passed; one suite/test skipped. `/tmp/paged-fix3-tests.log`.
- Additional actual App callback tests cover CSV/narrative stale-write rejection, asynchronous review state, apply/undo, and a project switch during resolution. Follow-up save/recovery coverage passed: 4 suites / 33 tests. `/tmp/paged-fix3-final.log`.
- Final changed-row-provider and UI coverage passed: 5 suites / 21 tests, including raw-row fingerprint compatibility, bounded review reads, partial isolation, and review mapping after deletion. `/tmp/paged-fix3-raw.log`. Counts overlap; these are not additive.
- Server transfer tests: four passed. `/tmp/paged-fix3-server.log`.
- Final production build passed with warnings. `/tmp/paged-fix3-build-final.log`.
- `git diff --check` passed.

## Performance and limits

The disposable Electron benchmark with 15,000 result rows and approximately 32 million evidence/review characters reported 22.1 ms descriptor loading, 195.2 ms first usable rows, 118.8 ms next page, 101 rendered rows, a 66.4 ms maximum measured event-loop interval, and 209,888 KiB peak renderer working set. `/tmp/paged-fix3-benchmark.log`.

This is a synthetic saved-panel measurement, not a full customer-project or packaged-desktop guarantee. Viewing remains paged. Explicit apply/undo/CSV/narrative mutation paths still resolve a complete editable run; their memory usage is not covered by the first-page benchmark. Complete collaborator review snapshots above the 32 MiB guard fail with a clear message rather than growing without bound. Safari and the customer's actual large projects were not exercised in this run. The regression tests support the targeted fixes, not a claim that all possible regressions have been eliminated.
