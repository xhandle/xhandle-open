# Saved rating normalization fix — 2026-10-14

Executed prompt: `codex-prompts/hazard-saved-rating-normalization-fix.md`.

The shared cleanup function previously validated a trimmed/stringified rating but returned the original representation. Fallback copied that original into the assessment, so strict ASIL/SWCI validation rejected otherwise valid padded ratings.

`hazardCompletionSupport.js` now returns the canonical string for accepted ratings and enum values. Changed originals remain in `retainedUserInputs`; invalid values remain excluded from constraints. Narratives and rating meanings are unchanged. Both runner preprocessing and local fallback use this boundary, so generation constraints, reconciliation and rating derivation consume the same representation. The retained-input descriptions in `assumptionHazardFallback.js` and `fastHazardRunner.js` now account for normalization as well as replacement.

The two previous audit failures now assert successful completion. Added coverage for HARA S/E/C, FHA severity/SCC (including numeric SCC), applicable/significance/classification enums, preservation of originals and idempotence. Runner tests exercise saved noncanonical inputs under provider failure, complete publication, deterministic QM/SwCI 4 results, canonical retained ownership, save invocation, serialized reload, CSV round-trip and downstream software requirements.

All 482 tests passed across 47 suites covering hazard analysis, shared transport and software-requirements artifacts. `git diff --check` passed. No live browser/provider run was performed. This closes the reproduced saved-rating edge case; it is not an absolute guarantee against arbitrary runtime defects or environment failure.
