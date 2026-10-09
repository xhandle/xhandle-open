# Fast control-gated guide-phrase applicability review

Date: 2026-10-09. Read-only application audit; no production behavior changed, paid AI requests made, or customer records modified.

## Conclusion

xHandle does not currently implement the requested automatic, lightweight command/control screening before full STPA generation. Applicability is assessed inside the expensive generation request and audited afterward. Existing imported No decisions do skip that work. Add a distinct early screening stage, reusing the existing decision-preservation and No-skipping mechanisms; a database migration or rewrite of hazard reasoning is not required for this change.

The Projects area also uses this shared STPA-Textbook engine. Its reuse of completed draft rows and reviewed decisions can look like a first pass, but is not automatic command/control qualification of new relationships. Explicit applicability review and Vibe Review are separate user workflows.

## Current execution and evidence

References are to the reviewed working tree; line numbers can shift.

1. `codeArchitectureHazardRunner.js:20` builds input through `buildCodeArchitectureHazardInput`, applies `prepareCodeHazardPreprocessing`, enriches source evidence, calls `runLiteAIAnalysis`, reconciles decisions, and persists the completed run. Partial output does not replace an imported authoritative table before reconciliation. `codeArchitectureHazardStore.js:105–142` uses scoped run metadata to load results and saves run content separately.
2. `codeArchitectureHazardUtils.js:666–755` prefers `buildFunctionalModelRows(cbaRows)` when available. Otherwise it uses detailed architecture rows. The runner rejects stale/failed Functional processing rather than silently substituting detail in that case. Eligible relationships expand into seven guide phrases times selected operational contexts. Applicability initially starts blank.
3. `codeArchitectureHazardEligibility.js:118–139` includes source-supported production calls for assessment. Inclusion explicitly does not prove runtime reachability, hazard relevance, or applicability. This is not a gate requiring a real controller-issued command. The Functional abstraction reduces source detail but does not itself establish control semantics.
4. The STPA-Textbook branch in `aiAnalysisLite.js:242` calls `generateStandardCodeHazardAnalysisSheets`. Do not confuse this with the legacy literal-STPA branch. `aiAnalysisCodeHazardStandard.js:2638` runs generation, language repair, safety/applicability audit, anomaly repair, and canonicalization in that order.
5. `runStandardHazardAnalysisStages` removes explicit No inputs before scheduling, regardless of review status, and restores their local Not applicable rows afterward. An all-No input requires no AI request. Blank applicability receives the full hazard prompt in `requestStandardRows:1570`, including causal chains, classifications, constraints, requirements, and verification fields.
6. Batch limits are eight generation rows for the default provider and four for Claude/Anthropic (`getStandardHazardRowsPerPrompt:326`), plus character budgets. Concurrency is two. Applicability/safety audits use 12-row batches; targeted repairs use smaller batches; canonical mapping uses 40. Retries and anomaly-dependent work add requests. Operational context and row evidence recur across these requests.
7. `codeHazardGenerationCheckpoint.js` already supports durable, versioned checkpoints. The runner supplies project/repository/method/model/effort/preprocessing scope; stage bases include input rows, context, organization policy and provider. Continue can reuse matching batches; explicit regeneration clears that scope. This is useful infrastructure, not a standalone applicability cache. Do not reinstate the obsolete finding that CBA has no checkpoints.
8. Projects `App.js:12165–12242` expands draft targets, applies accepted applicability and safety decisions, and skips meaningful existing rows unless regenerating. It then uses the same shared engine. `needsReviewResolver.js:470` provides explicit applicability updates; the Collaborator has an explicit guide-phrase Vibe Review workflow. Neither is automatically invoked to qualify all new relationships before hazard generation.

## Criteria and mismatch with the desired workflow

The generation prompt (`getStandardConfig`, approximately lines 438–450) requires Yes only when the deviation is meaningful for the action and scenario AND has a credible causal path to an adverse state. It permits No for meaningless semantics, authoritative contextual preclusion, inability to affect the receiver, or no credible adverse consequence.

The subsequent audit/repair examines receiver effects, context, adverse-state support, supplied evidence, and guide-specific semantics. Duration reasoning includes maintained commands, streams, samples, plans and periodic feedback. It does not first require an evidenced controller/recipient/requested behavior. An ordinary transformation can therefore consume full generation and audit work. Conversely, a real software authorization/configuration command is not excluded simply because it is software-only.

Two distinct questions need distinct answers:

- Is this relationship a command/control in this context?
- For that action, is this particular deviation meaningful?

Neither question is equivalent to safety significance. Existing prompts couple applicability to an adverse consequence. That is a policy mismatch with the requested governed-input semantics; adding a new prompt while leaving contradictory later instructions intact would be incomplete.

## Decision authority and preservation

Accepted imported/user decisions are represented in the saved run's `userPreprocessing` values, basis and ownership together with Summary fields; explicit review actions carry governed review evidence. Generated text alone is not proof of human acceptance.

`prepareCodeHazardPreprocessing` matches trace/interface, phrase and context, attaches authoritative decisions, flags changed bases, and propagates No even with a conflict. `reconcileCodeHazardPreprocessing` restores owned decisions into final sheets and reports conflicts. `preserveReviewedApplicability` in the shared engine protects reviewed Yes/No across later stages. Context changes must not silently discard human values. Existing tests exercise conflicting model results and changed contexts.

Automatic decisions may still be revised by automatic audits. A new screening stage must distinguish automatic screening provenance from human acceptance, and make both scheduling and downstream write ownership explicit. It must not falsely mark AI output as human Reviewed merely to reuse the current guard.

## Measured scheduling

New diagnostic: `src/components/guidePhraseScreeningReview.test.js`. It exercises the actual shared generation scheduler and actual STPA configuration with mocked responses, stopping at the generation stage boundary. No production stage was bypassed or modified in application code.

Fixture: 50 relationships × seven phrase variants × two contexts = 700 rows. Examples include valve commands, Python calculations, C++ software authorization, logging and getters. The comparison supplies synthetic No decisions for 80% of relationships solely to measure scheduling, not to declare those decisions semantically correct.

| Input | Full-generation rows | Default-provider requests | Claude/Anthropic requests |
|---|---:|---:|---:|
| Unassessed | 700 | 88 | 175 |
| 80% supplied No | 140 | 18 | 35 |

All relationship types reach generation when unassessed. Supplied exclusions reduce generation rows by 80%. This excludes the cost of a future screening pass, all later audits/repairs, network latency, retries, and real source payload size. It is not an end-to-end speed benchmark or evidence that 80% of a customer's rows should be excluded. Live token consumption and ChatGPT-equivalent latency were not measured.

## Ranked findings

1. **High — screening happens too late (reproduced).** Applicability is embedded in full generation; unassessed non-control candidates receive expensive prompts. A prompt-only wording tweak cannot remove that scheduled work.
2. **High — no explicit control qualification and mixed decision semantics (code evidence).** Eligibility is broader than command/control; applicability instructions also depend on adverse consequences. Implementing the user's policy requires aligning screening and later applicability handling while retaining downstream safety assessment.
3. **Medium — repeated expanded inputs (reproduced/code evidence).** Each relationship/context is repeated per phrase before generation. A compact decision map can assess relationship semantics once per context and all phrases together.
4. **Medium — no independent reusable screening artifact (code evidence).** Existing generation checkpoints help resumability but do not provide pre-generation decision previews, screening provenance or a cache of compact decisions.
5. **Unquantified — browser/rendering contribution.** Expansion, source evidence, partial summaries and storage may add latency, but this review did not profile a customer's browser. Do not attribute all delay to IndexedDB or claim that changing storage solves AI request latency.

## Smallest safe implementation plan

1. Add a shared screening module called by the CBA runner after Functional selection/evidence enrichment and preservation of accepted decisions, before `runLiteAIAnalysis`. Retain existing hazard reasoning and persistence paths. Make screening automatic; an optional preview/review action should not be mandatory.
2. Batch unique relationship/context records. Return a compact map: stable relationship ID, qualification (Control / Non-control / Unresolved), controller, recipient, requested behavior, evidence references, and one Yes/No/Needs Review plus concise rationale for each supported guide phrase. Do not generate hazards/requirements in this pass.
3. Clear ordinary computation/passive transfer can be Non-control under an explicit command-focused policy. Do not use name regexes, programming language, repository identity, or physical actuation as gates. Distinguish feedback evidence feeding a controller from commands issued by it; retain feedback and excluded relationships as supporting context. Missing evidence stays unresolved. Instantaneous versus sustained actions require different duration decisions; command status must not default all phrases to Yes.
4. Store screening results separately with origin, policy/schema version, project/repository, source and Functional revision, stable relationship/phrase IDs, operational-context content hash, evidence digest, model configuration and completion state. Reuse only matching automatic results. Keep accepted human decisions unchanged and show basis-change conflicts for explicit review. Refuse ambiguous identity matches.
5. Merge screening into existing expanded input: No skips all downstream generation regardless of review status; Yes proceeds; unresolved stays visible for applicability resolution, not silent exclusion. Preserve all source/export rows. Add explicit automatic-screening ownership so classification and later post-processing cannot overwrite applicability; only a designated applicability resolver may resolve/revise unresolved automatic decisions. Never label automated decisions as human Reviewed.
6. Remove contradictory applicability reassessment instructions from downstream prompts for already resolved inputs. Preserve safety-significance/classification logic: an applicable action may still be Mission/Reliability or unresolved downstream. Keep evidence validation without writing its uncertainty into accepted applicability.
7. Persist completed screening batches and resume incomplete ones with bounded retries, cancellation, schema/ID validation and adaptive payload sizing. Keep current concurrency initially. Show separate, real screening and hazard-generation progress and counts. Avoid loading all project histories or duplicating source text across phrase records.
8. Acceptance tests: explicit/ambiguous control and non-control examples across languages; software authorization/configuration; one-shot versus sustained duration; feedback dependency; contextual changes; human overrides; No scheduling exclusion; governed value/rationale round trips; regeneration/resume; cross-project/repository isolation; Functional preference and stale-model handling. Add a deterministic end-to-end runner test and browser performance measurement. Evaluate a human-labeled, repository-neutral set for false exclusions before enabling automatic screening broadly.

## Verification and limits

Nine suites / 116 tests passed: new scheduling diagnostic, applicability governance, standard-engine completion and semantic/evidence tests, CBA runner preprocessing, preprocessing reconciliation, hazard utilities, CSV, and shared user preprocessing. Existing tests cover reviewed Yes/No through full mocked stages, classification uncertainty, explicit review changes, CSV preservation, changed contexts, retries and checkpoint resume. The diagnostic verifies provider batch counts.

Source inspection verifies Functional selection and scoped checkpoint keys; this run did not add a real multi-project browser reload test. Nor does mocked execution validate new command-qualification accuracy: no new classifier was implemented. A customer's ChatGPT decision set was not compared. No production build was necessary because only review documentation and an isolated test were added.

Expected outcome after implementation: screening runs inside xHandle without CSV preprocessing, clear exclusions avoid expensive hazard calls, accepted decisions remain intact, and uncertain cases remain reviewable. The amount of acceleration depends on the actual exclusion rate and provider behavior. A focused new screening stage is the recommended change.
