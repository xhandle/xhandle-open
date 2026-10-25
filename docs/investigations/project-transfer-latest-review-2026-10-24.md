# Review of latest transfer fixes — 2026-10-24

Prompt executed: `docs/codex-prompts/review-project-transfer-followup-fixes.md`.

## Finding

### P2 — Complete requirement work is regenerated for supported parent-ID separators

Location: `src/features/code-architecture-transfer/requirementCoverage.js:1`.

The new cache acceptance parser splits parent IDs only on commas, semicolons, and line feeds. The existing application parser (`artifactUtils.js:24`) also supports carriage returns and the word “and”. A response containing `SWR-1 and SWR-2` therefore produces valid, fully linked requirement rows, but fails cache coverage validation. It is not retained as completed work, so continuation invokes the provider again after transfer. The same issue occurs with carriage-return-separated IDs. This adds unnecessary time/cost and can regenerate already completed results.

Reproduction uses the real `deriveSystemRequirements` API, exports/imports the project, and repeats derivation. Both supported alternate separators trigger another category-generation provider call. A comma-separated control reuses its checkpoint without that call. This is a cache regression, not evidence of lost saved requirement rows.

Recommended fix: use the same canonical ID parsing rules in cache validation and normal requirement processing. Convert the two defect probes into tests expecting checkpoint reuse, retaining the comma control and incomplete-coverage rejection tests.

## Previous three findings

The tested reproductions are fixed:

- Normal publication and run/history aliases transfer successfully, including a second publication preserving history.
- Missing nested rowRecord/runRecord chunks are rejected; intact recovery can be completed after import.
- Incomplete legacy hazard-derived system requirement checkpoints are retried; complete results are reused afterward.

No additional confirmed regression was found within this review's scope. This is not a guarantee that all bugs have been eliminated.

## Validation

- Existing relevant suite: 129 suites / 1,115 tests passed.
- Added `projectArchive.latest-review.test.js`: two passing defect reproduction cases plus one passing comma-separated control. These use real derivation and transfer APIs with a mocked provider and isolated IndexedDB.
- `git diff --check` passed.
- Review changed documentation and tests only; no production code changes, release, commit, or push.
- No new production build was run because production code was unchanged; the preceding implementation build passed with warnings.

Large-project transfer between Safari and packaged Electron remains a manual validation gap. Automated tests do not establish memory safety for arbitrarily large records or crash-atomic multi-database import.
