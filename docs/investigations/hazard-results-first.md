# Results-first hazard pipeline

Implemented `docs/codex-prompts/hazard-results-first.md` for code-based architecture STPA, HARA and FHA. Projects-area generation remains unchanged.

## Active execution

`fastHazardPipeline.generateFastHazards` now exports the results-first implementation in `resultsFirstHazardPipeline.js`. The previous reviewed implementation remains as `generateReviewedFastHazards`, with explicit legacy regression coverage. The checkpoint contract is now `compact-hazard-v6-results-first`, so older incompatible generation checkpoints are not reused.

The active path performs the compact applicability prepass once for unresolved inputs, reuses matching cached decisions, preserves human applicability, and excludes No rows locally. Detailed generation requests common decision/classification/assumption fields, actual method table fields, software requirement and verification only. It no longer requests the optional execution/operator/evidence metadata used by the older audit pipeline. Organization profiles and full relevant evidence/context remain in the prompt.

Generation starts with 16 rows for selected Haiku 5.5, eight for the existing lower output allowance, four concurrent workers, and a separate input-size ceiling. Explicit truncation/malformed responses reduce batches. Valid rows are accepted independently; only missing, duplicate or structurally invalid rows receive bounded targeted retries. Checks retain exact identity/action, read-only applicability/classification, required fields, software shall requirement, classification enums, and HARA/FHA rating domains. ASIL/SWCI and traceability links are computed locally. Narrative consistency is not a blocking generation gate.

## Narrative review

The published run contains a deduplicated generated-snapshot review payload and profile context. `HazardNarrativeReview` exposes an explicit Deeper narrative review action after completion. It uses the existing independent reviewer but stores findings separately and never generates corrected hazard rows. Review failure/cancellation leaves the published table and requirements inputs intact. App callbacks guard against applying findings to a different/replaced run. Findings and review payload survive normal persistence. Optional metadata absent from table-only generation is not itself a narrative failure.

## Storage recovery

`resilientHazardCheckpoint` buffers new decisions/results in memory and serializes background checkpoint writes. Read/write failure or stalled storage cannot abort generation; waits are bounded and the existing UI progress indicates unavailable checkpoints. Completed results are published before final persistence. Final-save failures return a complete run with finalSavePending, export and retry-save actions; completion messages explicitly distinguish saved versus unsaved results.

`codeArchitectureHazardStore` retains failed final saves in a project/repository-filtered session-memory overlay. Navigation can retrieve these results even when durable storage fails. An unload guard warns while unsaved runs remain. Successful retry clears the overlay; explicit deletion clears matching in-memory entries. Final-save waiting is bounded and timed-out transactions are aborted where possible. Memory protection does not survive browser termination; export is necessary if storage remains unavailable.

## Validation

370 tests passed across 36 suites. Coverage includes active dispatch for all methods, Functional inputs and software requirements, zero mandatory review requests, compact field-only responses, targeted structural retries, scoped checkpoint resume, frozen/native storage errors, stalled checkpoint storage, explicit post-generation review without mutation, final-save recovery, project isolation, reload guard and retry save. Preserved legacy reviewed-pipeline tests are separate from new active-path tests. Production build passed with existing warnings. `git diff --check` passed.

No paid/live model runs were made. Mocked request counts verify removal of review/regeneration overhead; they do not establish a two-to-three-minute live runtime or certify generated reasoning. Rows that cannot satisfy structural checks still remain recoverable incomplete work rather than fabricated completed assessments.
