# Completion contract fixes — 2026-10-14

Executed prompt: `codex-prompts/hazard-completion-contract-fix.md`.

## Defects resolved

1. Screening accepted a Yes/No decision whose rationale mentioned unresolved downstream detail, but final assembly applied a different narrative validator and rejected publication. Accepted applicability value/rationale pairs now remain governed through fallback and final assembly. Checkpoints carry accepted screening provenance so resume does not regenerate valid work merely because of that rationale.
2. Import cleanup accepted unresolved rating rationales such as `Unknown: operating allocation was not supplied.` while fallback validation rejected them. Cleanup and schema validation now share unresolved-text rules. Incompatible original inputs remain retained verbatim; fallback uses explicit premises in Assumptions and Assessment Basis.

## Implementation

- `hazardFieldContract.js`: shared narrative and accepted applicability predicates.
- `fastHazardApplicability.js`: uses the shared screening predicate.
- `fastHazardSchema.js`: uses the shared unresolved-text predicate and preserves matching governed applicability rationale.
- `hazardCompletionSupport.js`: uses the same narrative predicate for imported constraints.
- `assumptionHazardFallback.js`: carries screening rationale into validation.
- `resultsFirstHazardPipeline.js`: checkpoints accepted screening provenance and validates it on resume.
- `fastHazardRunner.js`: carries accepted applicability through final sheet validation.

Required fields, rating validity, deterministic ASIL/SWCI calculation, traceability and explicit cancellation remain enforced. No blanket exception swallowing or automatic conversion of accepted No decisions to Yes was introduced.

## Verification

451 tests passed across 45 suites: hazard-analysis directory, AI transport tests and downstream software-requirements artifact tests. The six previous failure reproductions now assert successful completion. Additional coverage checks Yes fallback/resume for all methods, ten unresolved-text forms, preserved original imports and continued rejection of unrelated invalid fields/changed reviewed applicability. Existing runner tests cover saved/reloaded results, CSV round-trip and requirements derivation. A focused rerun strengthens final No publication assertions.

These are automated tests with mocked providers, not a live browser/provider run. They close the reproduced contract failures; they do not establish an absolute guarantee against arbitrary programming defects, browser termination, resource exhaustion or explicit cancellation. Durable storage still depends on storage availability; completed memory results must remain protected when saving fails.
