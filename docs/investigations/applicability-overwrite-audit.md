# Governed applicability overwrite audit and fix

Date: 2026-10-09. Scope: Guide Phrase Applicable ownership only.

## Root cause

There were several independent writers, with no invariant enforced across all of them:

1. `hazardUserPreprocessing.constrainPreprocessedInput` withheld the accepted decision and its Reviewed marker when the context/architecture basis changed. `reconcileUserPreprocessing` then explicitly wrote Needs Review into applicability while retaining the user's Yes rationale. This directly explains the reported internally inconsistent artifact.
2. `hazardRegenerationReview.reconcileRegeneratedGuidePhraseReview` explicitly replaced an accepted decision and rationale when the basis changed. That also prevented `applyReviewedApplicabilityToGenerationInput` from supplying the accepted input to regeneration.
3. `needsReviewResolver.normalizeNeedsReviewClassificationDecision` derived applicability from the downstream classification, or defaulted it to Needs Review, ignoring an existing Yes/No. Vibe classification proposals and evidence-resolution updates share this normalizer.
4. `aiAnalysisCodeHazardStandard.normalizeRow` preferred generated applicability over the input. `mergeAuditTag` already recognized Reviewed inputs, but generation, later stage results and cached stages did not all enforce that ownership. The audit prompt also unconditionally requested an independent applicability reassessment after saying reviewed values should be preserved.
5. The code-architecture Vibe Review commit in App saved the visible applicability decision but did not record it in `run.userPreprocessing`, which is what subsequent code-architecture runs consume. A later run could therefore omit the decision or replay an older import.

## Source of truth

The accepted per-row user decision and its paired rationale are authoritative, not generated classifications or rationale text interpreted as a decision.

- Imported/manual code-architecture assessments are stored in `run.userPreprocessing[rowId].values` and its basis metadata. Explicit applicability Vibe Review commits now update that same record, superseding the older value.
- Project-area applicability reviews use the existing review snapshot/audit record selected by `latestGuidePhraseReviewByRowId`; manual/imported preprocessing uses the existing preprocessing record. Existing newer-review precedence is retained.
- Generation receives a resolved Yes/No and `guidePhraseApplicabilityReviewStatus: Reviewed`. This means accepted user input, not a downstream claim that the new context is validated. Basis conflicts remain separately reportable.
- CSV application and manual applicability edits remain explicit user input actions. Export, parsing and automatic resolution-status refresh do not adjudicate applicability. Explicit applicability review uses `applyGuidePhraseApplicabilityUpdates`; downstream classification does not own the field.

## Write-path inventory

The following covers direct field writers and generic row writers that can carry this field. Read-only selectors, schemas and labels were also searched across src.

| Path | Writers / update behavior | Result of audit |
| --- | --- | --- |
| `aiAnalysisCodeHazardStandard.js` | `flattenDecomposition`, `fallbackRow`, `normalizeRow`, `materializeGeneratedHazardRows` | Input projection, fallback and model-output normalization. Reviewed input now wins over generated values and rationale. |
| Same | `deriveStructuredApplicability`, `validateNotApplicableProof`, `validateApplicabilityEvidence` | AI applicability evaluators can produce Yes, No or Needs Review. They remain available for unresolved applicability; reviewed decisions bypass their result through `mergeAuditTag` and the stage guard. |
| Same | `mergeAuditTag`, `repairGenericStandardRows`, `tagSafetySignificanceForStandardRows`, `repairHazardAuditAnomalies`, `canonicalizeStpaRiskVocabulary`, `runStandardHazardAnalysisStages` | Generation, audit, repair and cached results all pass through input protection. Final safety audit preserves applicability and writes unresolved safety rationale into downstream fields. Explicit No rows stay out of AI generation/repair. |
| Same | `saveSheets`, `generateStandardCodeHazardAnalysisSheets` | Project the completed objects into method/Summary tables and persist through the caller. No independent applicability inference. |
| `aiAnalysisLite.js` | `runLiteAIAnalysis` | Builds/transports Functional Decomposition inputs and dispatches to the standard pipeline. No independent overwrite policy. |
| `hazardUserPreprocessing.js` | `recordUserPreprocessing`, `constrainPreprocessedInput`, `reconcileUserPreprocessing`, `respectNewerHazardReviews` | Explicit edits/imports record ownership; changed basis formerly dropped/overwrote applicability. Now preserves the accepted value and rationale; conflicts update Classification Resolution Status. Newer explicit review precedence is unchanged. |
| `codeArchitectureHazardPreprocessing.js` | `prepareCodeHazardPreprocessing`, `reconcileCodeHazardPreprocessing` | Match accepted records to input/output rows and project into sheets. Uses the fixed shared preprocessing. Existing matching ambiguity checks remain. |
| `hazardRegenerationReview.js` | `reconcileRegeneratedGuidePhraseReview`, `restoreReviewedGuidePhraseDecisions`, `applyReviewedApplicabilityToGenerationInput`, `normalizeRegeneratedHazardRowForPersistence` | Regeneration and restoration preserve the reviewed value/rationale even with a changed basis. Changed basis fields are still returned separately. No rows use the existing non-applicable normalization. |
| `needsReviewResolver.js` | `normalizeNeedsReviewClassificationDecision`, `applyNeedsReviewResolutionUpdates`, `resolveNeedsReviewGroupWithAI` | Classification/evidence review now preserves existing resolved applicability and rationale. An insufficient stakeholder answer no longer explicitly proposes Needs Review for applicability. Downstream classification and evidence checks are unchanged. |
| Same | `applyGuidePhraseApplicabilityUpdates` | Intentional applicability-review write boundary. Validates explicit Yes/No with rationale and applies the existing downstream No policy. Remains able to change a prior decision. |
| `vibeReviewProposal.js` | Applicability proposal/adjudication helpers; `normalizeVibeReviewProposal`; safety/classification proposal builders | Proposals are not accepted decisions. Classification proposals use the fixed normalizer. Explicit applicability proposals commit through the dedicated action. App's safety-significance/classification commits write only their own fields. |
| `App.js` | Draft creation/alignment, manual cell edits, CSV apply/undo, Vibe Review commit, bulk/single-row regeneration and restoration | Generic writes can carry applicability. Explicit user edits/imports record preprocessing. Code-architecture applicability review now records it too. Generation/regeneration uses the protected helpers. |
| `XHandleCopilotView.jsx`, `hazardDecisionEngine.js` | Review proposal/application/undo orchestration | Targeted review actions delegate to App; audit/undo carries the previous governed fields. No autonomous classifier writes here. |
| `hazardAnalysisCsv.js` | `planHazardAnalysisCsvImport`, `applyHazardAnalysisCsvImport`, `applyHazardCsvImportToDrafts`, `refreshImportedResolution` | CSV values are copied by explicit apply. Only Classification Resolution Status is recomputed. Export uses `toCsvText`, which serializes values. Round-trip verified. |
| `codeArchitectureHazardUtils.js`, `codeArchitectureHazardStore.js`, project storage | Input/sheet projection, run normalization, row serialization | Copy row values; no applicability derived from completion status. |
| `hazardSafetyModel.js` | `normalizeNonApplicableHazardRecord` | Writes No and N/A downstream fields only when the caller has already selected No. Standard normalization now protects the accepted input first and preserves its exact rationale after normalization. |
| `classificationResolutionStatus.js`, `safetySignificancePolicy.js`, `safetyColumnSchema.js`, `hazardNotApplicableCells.js` | Resolution/classification derivation, schema reconciliation, blank N/A filling | Consume applicability; do not mutate it as a side effect of classification status, confidence or completion. |
| Review cascade/session/scope, safety-issue evidence, hazard-eval/test harness | Schemas, target selection, downstream planning or test fixtures | No additional production applicability adjudication boundary. |

## Changes

- `aiAnalysisCodeHazardStandard.js`: added `preserveReviewedApplicability`; applied it during row normalization, after every repair/cached stage, and at final audit; clarified the audit prompt's unreviewed scope.
- `hazardUserPreprocessing.js`: carry accepted decisions into generation regardless of changed basis; stop replacing applicability with Needs Review during reconciliation.
- `hazardRegenerationReview.js`: preserve reviewed applicability/rationale and return changed basis metadata separately.
- `needsReviewResolver.js`: preserve resolved applicability/rationale during classification normalization; remove applicability from the insufficient-evidence response.
- `App.js`: persist explicit code-architecture applicability Vibe Review decisions into the input ownership record used on subsequent runs.

No changes to control-action gating, safety classification rules, causal reasoning, source selection, batching or applicability reasoning for unresolved rows.

## Regression verification

- `applicabilityGovernance.test.js`: real standard STPA stage sequence with mocked provider transport attempting to overwrite accepted applicability; Yes survives every stage, No makes no AI call; downstream Needs Review preserves Yes/No and rationale; explicit applicability action can change a value; CSV round-trip preserves both decisions.
- `hazardUserPreprocessing.test.js`: changed basis preserves accepted Yes and puts review concerns in downstream status.
- `hazardRegenerationReview.test.js`: regeneration preserves accepted Yes/rationale with changed basis; existing No and other review tests retained.
- `codeArchitectureHazardPreprocessing.test.js`: accepted No continues to reach the skip path with review status intact.
- `codeArchitectureHazardRunner.preprocessing.test.js`: accepted Yes/No survive a complete runner/save path after context change with conflicting generated applicability.
- Existing classification, Vibe Review, commit integrity, CSV and standard hazard tests also pass.

Historical rows may already have overwritten values. This change does not infer a correction from a rationale beginning with Yes, and does not bulk-migrate browser data. Preserved review/preprocessing records can supply the accepted value during restoration/regeneration. Rows without such records require explicit applicability review. No live provider run or access to the customer's browser database was used for verification.

Validation completed: 12 distinct targeted suites, 227 distinct tests passed (the six-test governance suite was run in both test groups). `npm run build` passed with lint warnings; `git diff --check` passed. No commit or push was performed.
