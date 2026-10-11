# CBA HARA/FHA shared workflow implementation

Implemented the prompt in docs/codex-prompts/implement-cba-hara-fha-shared-mechanics.md.

## Changes

- Added shared CBA output contract for applicability/rationale/review status, control-action type, causal factors/category, mitigation, system requirement, verification method, acceptance criteria, and safety classification. Generation now requests and validates the substantive shared fields instead of merely exposing empty columns.
- HARA retains S/E/C, ASIL, Safety Goal, and separate software safety allocation. FHA retains severity, SCC, computed SwCI and LOR tasks. Safety Classification is independently requested in the downstream classification pass; missing/invalid classification stays Needs Review. Classification drives the CBA significance rollup and never changes applicability.
- Explicit Yes/No source decisions override model output before validation and survive normalization, repair, classification and reruns. Explicit No rows bypass model calls and remain traceable excluded rows. Software requirement import excludes No rows.
- New HARA rows identify Functional malfunction; FHA identifies Functional degradation or loss. Each still has one analysis row per relationship/context, rather than STPA's seven command deviations. Existing reviewed blank-guide-phrase identities are retained during continuation.
- Added CBA-specific draft schemas so method columns exist before generation. Projects draft schemas and legacy Projects generation remain unchanged.
- Added repair/classification stage checkpoint reuse, including full stage inputs and effective context in the identity. Updated the generation checkpoint version. CBA always uses the validated batch path; the legacy detailed path remains available to Projects.
- Existing CBA runner continues to provide functional-source selection, source evidence, organization policy, publication/storage, context isolation, preprocessing reconciliation, and downstream requirements handoff.

## Files

- src/components/haraFhaSharedWorkflow.js: shared contract, prompt guidance, normalization, sheet fields and CBA draft schemas.
- src/components/aiAnalysisHaraFha.js: generation, validation, skip/ownership behavior, classification, checkpointed postprocessing, method sheet output.
- src/App.js: CBA draft schema selection.
- src/features/code-architecture-hazard-analysis/codeArchitectureHazardUtils.js: method-specific deviation labels.
- src/features/code-architecture-hazard-analysis/codeArchitectureHazardPreprocessing.js: legacy reviewed identity compatibility.
- src/features/code-architecture-assurance/artifactAI.js: explicit No exclusion and Verification Method fallback.
- Tests: haraFhaWorkflow.test.js, codeArchitectureHazardUtils.test.js, codeArchitectureHazardPreprocessing.test.js.

## Validation

167 distinct targeted tests passed across the HARA/FHA, CBA runner/preprocessing/CSV/table, software requirements, and STPA regression suites. Includes reviewed Yes/No preservation, all-No zero model calls, unresolved classification isolation, repeated generation, checkpoint reuse, method-specific ratings, CSV round trip, context/profile propagation, legacy review compatibility, and software requirement handoff.

Production build passed with existing lint/Browserslist warnings. git diff --check passed.

Model responses were mocked. No customer repository, live provider run, or Safari session was exercised. Existing saved analyses are not rewritten; generate or continue a run to obtain the new fields. HARA/FHA retain their own generation, specificity repair and classification passes; this is shared workflow/contract alignment, not replacement with STPA reasoning or a claim that all three have identical internal stages. Unknown evidence can legitimately leave a field Needs Review. No commit or push performed.

## Follow-up: full guide-phrase groups

Corrected the earlier single broad deviation per HARA/FHA group. Both now expand the same seven guide phrases used by STPA for every eligible relationship and operational context. Method prompts require independent applicability and hazard reasoning for the exact deviation; HARA/FHA risk ratings and requirements remain method-specific. Draft CSV identities distinguish each phrase, and generated summaries retain every phrase/context row.

Legacy whole-function applicability decisions are not copied onto all seven deviations. Existing phrase-specific reviews remain matched normally; old broad/blank-phrase owned decisions require review through the existing unmatched-preprocessing handling before rerunning. Existing saved analyses are not fabricated into seven completed rows; regeneration is required to produce the additional assessments.

Validation: 112 tests across six relevant suites passed, including complete 14-row generation for seven phrases in two contexts, method switching, draft CSV identities, ownership preservation, and table defaults. Production build passed with warnings. Live provider validation was not performed.
