# Code-Based Architecture HARA/FHA workflow review

Date: 2026-10-11. Reviewed main `a7385e3` using `docs/codex-prompts/review-cba-hara-fha-workflow.md`. No production changes or customer-data writes. This is a software workflow review, not a standards-compliance or safety-validation assessment.

## Decision

**Not ready to claim the same workflow reliability as STPA.** Both methods are wired into the UI, Functional-source selection, saved-run store, shared table, and software-requirements importer. Successful mock-generated results reach the importer. Their actual generation engines, however, do not use the newer STPA execution/validation machinery. Several important gaps remain.

## Findings

### High: row-specific operational context is lost

`codeArchitectureHazardUtils.js:buildCodeArchitectureHazardInput` correctly expands each eligible relationship by scenario/mode and writes the context ID, scenario, mode, conditions, and assumptions into Functional Decomposition. `aiAnalysisHaraFha.js:flattenDecomposition` reads only the first three cells plus architectural traceability. `compactFhaPromptItem` also has no row-context fields. Global context text reaches the prompt, but the model cannot reliably associate each repeated relationship with its assigned scenario.

`buildHaraAnalysisSheets` and `buildFhaAnalysisSheets` omit operational-context columns in Summary. The outer trace/evidence enrichment uses unexpanded source rows, not the lost row-context mapping. Result: two contexts produce two outputs without their distinct context identity. Context filtering, CSV round trips, imported-context reconciliation and downstream contextual traceability cannot be relied on. HARA's generated Operational Situation appears on its HARA sheet but is absent from Summary and is not a substitute for the user's context ID.

Confirmed with actual HARA/FHA generator functions: two input contexts, two output rows, no Operational Context ID in either Summary.

### High: failed/missing generation can look complete

`aiAnalysisHaraFha.js:requestHaraRowsWithRetries` and `requestFhaRowsWithRetries` retry missing IDs, then permit empty objects. `fallbackHazardRow`, `normalizeHaraRow`, and `normalizeFhaRow` fill missing hazards with nonempty “Needs review” text. HARA also defaults missing S/E/C/ASIL to S2/E3/C2/ASIL B and fabricates a shall-form Safety Goal containing the fallback hazard. FHA defaults missing severity/control category and derives SwCI/LOR from those defaults.

`codeArchitectureHazardRunner.js:168–175` tests whether any assessment cell is nonempty. A fallback Hazard satisfies that condition. Unlike STPA's generator-specific completion/repair checks, this is not evidence of a completed HARA/FHA assessment.

Confirmed: complete provider failure returns populated fallback hazard sheets for both methods rather than rejecting. The final classification failure produces Needs Review, which the requirements importer excludes. A separate probe where generation returns no rows but the classifier returns Yes confirms the generator-to-importer path can create a requirement containing “Needs review”. That probe does not include outer source-evidence downgrading: those policies may exclude particular rows, but cannot substitute for rejecting incomplete generation. The importer itself has no placeholder/completion check.

### High: cancellation and resumable execution do not reach the generators

`aiAnalysisLite.js:264–308` dispatches HARA/FHA without the `signal` or `generationCheckpoint` passed to the STPA generator. `aiAnalysisHaraFha.js` accepts neither and calls `fetchLLMResponse(prompt)` without cancellation options. Its standard loops process chunks sequentially, then perform repair and classification passes. No generation checkpoint is consumed. Standard mode publishes sheets only after the generation/repair/classification sequence.

The outer runner checks cancellation before and after generation and before final persistence, so late cancelled runs should not be saved. **That protection exists**, but model requests can continue after Stop until control returns. Continue/regenerate cannot reuse these generator batches through the STPA checkpoint mechanism, even though the outer runner creates a checkpoint. Large inputs are consequently exposed to repeated work and weaker partial-result recovery. Retry support exists; parity does not.

### High: switching methods can reuse incompatible prior state

`App.js` loads the latest run by project/repository without a method filter. `codeArchitectureHazardRunner.js` passes `previousRun` into preprocessing before method-specific generation. `codeArchitectureHazardPreprocessing.js:prepareCodeHazardPreprocessing` matches guide phrase and context and throws on unmatched governed rows. STPA has seven guide-phrase variants; HARA/FHA have one empty guide phrase. A previous imported/preprocessed STPA run can therefore block a HARA/FHA request with unmatched-assessment errors. Preserve those decisions, but scope prior-run preprocessing to its method instead of requiring users to clear another method's work. This path is identified by code inspection, not browser reproduction.

### Medium: downstream integration exists, but HARA goals are not separately derived into software obligations

`artifactAI.js:hazardSafetyRequirementRows` recognizes FHA `Software Safety Requirement` and HARA `Safety Goal`, normalizes the wording to a software shall statement, and records run ID, method, hazard row reference, source trace, severity/criticality, mitigation and verification where present. The UI invokes `resolveSoftwareHazardSource` and passes the result into `deriveSoftwareRequirements`; functional-derived and hazard-derived rows are combined.

Actual generator-to-importer probes produced two requirements for each method, preserving method/run provenance. FHA preserved its Verification text. HARA yielded blank verification because its schema generates no such field; there is no separate allocation/verification derivation for HARA Safety Goals in this import step. Relabeling a system-level goal as a software obligation is not equivalent to determining which part the software can implement. Add explicit, traceable derivation or clearly identify the imported goal's maturity; do not manufacture verification or thresholds.

`isSafetySignificantHazardRow` accepts Yes, excludes No and Needs Review, and accepts an absent tag for legacy compatibility. This is shared behavior, not a HARA-only defect. It explains why failed classification can leave software requirements with no safety-derived rows even though the hazard table is populated.

### Medium: requirements select the latest hazard run, not an explicit method or combined set

`softwareHazardSource.js:resolveSoftwareHazardSource` searches repository aliases within a project and chooses the newest run. It does not filter by method, merge HARA/FHA/STPA, or check architecture/context freshness. With multiple methods, the newest one wins. That may be an acceptable product policy, but users need to know which run supplies requirements. It must not be represented as combining all hazard methods. Freshness/source selection is a shared issue rather than a HARA/FHA-only difference.

## What already matches

| Mechanic | HARA/FHA status |
|---|---|
| Prefer generated Functional model | Shared input builder; stale/incomplete Functional model guard in runner |
| Architecture eligibility | Shared Include/Exclude/Needs Review gate |
| Method-specific analysis | HARA generates malfunction/event/S-E-C/ASIL/goals; FHA generates degradation/mishap/severity/control category/SwCI/LOR/requirements |
| STPA applicability screening | Intentionally bypassed; do not impose STPA's seven guide phrases or command/control gate |
| Source trace IDs and architecture links | Trace columns are built and enriched; existing shared table handles links |
| Final save/reload | Shared hazard-run store and normalized run shape |
| Table/CSV | Shared hazard panel; STPA's custom column default is scoped to STPA |
| Software requirements | Shared importer recognizes both schemas and retains provenance for successful rows |
| Cancellation publication guard | Outer runner prevents final save after cancellation; request cancellation remains missing |

Source enrichment is shared, but HARA/FHA prompt compaction also drops row details and audited source content from the per-row payload. File/symbol identifiers are included. Review this alongside context preservation rather than assuming that post-generation evidence columns mean the generation prompt used the same evidence as STPA.

## Validation and limits

- Existing tests plus the initial four audit probes: 5 suites / 43 tests passed.
- Added two probes for missing generation followed by Yes classification; all 6 audit probes passed. Total distinct checks executed: **45**.
- Real generator and requirements-import code used, with deterministic mocked model responses. No paid API calls, live browser tests, or customer storage mutations.
- Existing runner HARA/FHA completion tests mock `runLiteAIAnalysis` with a populated Hazard cell; those tests establish dispatch/completion acceptance, not the real generator's completeness, context preservation or recovery.
- Audit assertions intentionally demonstrate current defects. Fixture retained at `docs/investigations/fixtures/hara-fha-workflow.audit.test.js.txt`; to reproduce, temporarily copy to `src/components/haraFhaWorkflow.audit.test.js` and run Jest with that path. It is not a permanent test suite endorsing defective behavior.
- No production build required: only prompt, report and fixture artifacts added.

## Recommended implementation order

1. Preserve row-context and evidence identities through flattening, prompts, output, Summary and requirements provenance. Add two-context end-to-end tests.
2. Make incomplete generation an explicit incomplete outcome. Never default missing risk ratings into apparently assessed values, publish placeholders as complete, or import placeholder requirements. Keep prior complete runs available.
3. Pass cancellation and checkpoints through HARA/FHA and reuse the bounded scheduler/retry mechanisms without replacing method-specific reasoning or schemas. Test Stop, retry, resume, partial failure and regeneration.
4. Scope prior-run/imported preprocessing to method and preserve existing governed records. Test STPA-to-HARA/FHA switching with imported decisions.
5. Make software-requirement hazard source selection explicit and freshness-aware. Add method-specific mapping/allocation and completeness tests, including HARA goal-derived obligations and FHA verification/criticality retention.
6. Run browser smoke tests for both GitHub/local Functional models, save/reload, context filters, CSV import/export, and persisted software requirements. Do not tell customers the methods are validated until these paths pass.
