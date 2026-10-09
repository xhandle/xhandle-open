# Automatic command/control applicability screening

Implemented 2026-10-09 using `docs/codex-prompts/implement-fast-control-gated-guide-phrase-applicability.md`.

## Result

Code-Based Architecture STPA-Textbook now automatically screens guide-phrase applicability before full hazard generation. The same runner handles GitHub, local, and imported architecture sources. It retains the existing preference for a ready Functional model and the existing stale-model guard.

The screen groups each relationship/context once and returns a compact decision map across its guide phrases. It qualifies actual commands/controls, including software authorization, configuration, scheduling and mode changes. Calls, computations, transformations, logging and observations are not commands merely because the table calls them Control Actions. Feedback remains supporting evidence. Applicability is assessed independently of safety significance or adverse consequences.

Only applicable rows proceed to full hazard generation. No rows remain in the table as Not applicable and are not sent downstream. Unresolved applicability remains Needs Review with no generated UCA, constraints, or requirements. A notice identifies deferred rows, and completion messaging distinguishes them from analyzed applicable rows. The notice disappears when their applicability is explicitly resolved.

## Implementation

- `codeHazardApplicabilityScreening.js`: relationship/context grouping, compact screening prompt, exact ID/phrase/schema validation, evidence-quote grounding, batches of up to 32 relationship/context records, with a 96,000-character input target and 224-decision output budget, concurrency two, retries and split recovery. Compact responses use phrase indices and reusable evidence quotes; Non-control and Unresolved qualifications expand locally into per-phrase rows. Malformed multi-record responses split immediately rather than repeating the same oversized request. Unknown or invalid answers become visible unresolved rows instead of guessed exclusions. Aborts stop the workflow. Storage errors surface without repeating AI calls.
- `codeArchitectureHazardRunner.js`: screens after source selection and evidence enrichment, before calling the shared hazard engine; supplies project/repository/model scope and saves screening provenance with the run.
- `applicabilityOwnership.js` and `aiAnalysisCodeHazardStandard.js`: distinguish automatic origin from human Reviewed status; preserve applicability and rationale during generation, audit, repair and final classification; omit deferred rows from downstream scheduling. Prompt ownership instructions are enabled for automatically screened inputs. Projects and other hazard methods do not invoke the new screen.
- `codeArchitectureHazardUtils.js`: retains the new provenance record when normalizing saved runs.
- `CodeArchitectureHazardPanel.js`: shows unresolved screening counts from the current table rather than stale saved counts.

No database schema migration or new provider dependency is required. Existing generation checkpoints also hold screening batches. A successful split is cached as a whole; incomplete failed work is not cached as resolved. Continue reuses matching work; the existing explicit regeneration behavior clears the checkpoint scope.

## Decision ownership and isolation

Accepted/imported Yes/No decisions and rationales are preserved before screening. Automated decisions carry `Guide Phrase Applicability Origin = Automatic screening`, never a fabricated human Reviewed status. The origin is carried into generated sheets and CSV export. Subsequent classification uncertainty belongs in downstream fields, not applicability.

Screening provenance includes policy version, project/repository, architecture and Functional revisions, operational context and provider/model/effort identity. Checkpoint keys additionally contain the actual relationship/context/evidence inputs. Changed source evidence, model, context or project cannot reuse the old result. Full source bodies are not duplicated into the saved screening report; it retains identities, evidence quotes, qualification and decisions. Checkpoints use the existing digest-based storage mechanism.

All input rows remain represented in output, including No and unresolved decisions. Human values retain the existing preprocessing ownership/reconciliation mechanism and context-change conflict behavior. This implementation does not automatically repair historical overwritten human decisions.

## Verification

The regression run passed 13 suites / 177 tests, covering:

- Compact grouping and phrase-specific decisions, software-only controls, non-controls and unresolved cases.
- No/unresolved rows making no downstream hazard calls; unresolved UCAs remain empty.
- Human and automatically screened Yes/No surviving conflicting responses through the shared hazard pipeline.
- Existing CSV, preprocessing, Functional selection, context-change and reviewed-decision regression tests.
- GitHub/local runner integration with a ready Functional snapshot and persisted exclusions/provenance.
- Scoped checkpoint reuse and invalidation, source/model changes, regeneration, split recovery, bounded failure behavior, cancellation and storage-error handling.
- UI deferred-row messaging and removal of that message after applicability review.

After the final split-cache refinement, the directly affected screening, runner and governance suites were rerun: 3 suites / 23 tests passed. `CI=false npm run build` passed on the final production code, with existing lint, outdated Browserslist data and bundle-size warnings. No new warnings identified the changed screening/runner/ownership files. `git diff --check` passed.

Scheduling measurement with mocked AI: 50 relationships × seven phrases × two contexts produced 700 rows. A synthetic 80% exclusion rate now requires 4 screening requests plus 18 full-generation requests (the initial eight-record implementation required 13 screening requests). The previous unscreened fixture required 88 generation requests at the default batch size. These counts stop at the generation boundary; they exclude later audits, provider latency, live token costs and retries.

## Limits

Semantic screening is AI-derived. Exact quote and schema checks reject unsupported output structure and fabricated quotations, but do not prove the interpretation is correct. No paid/live-provider calls or customer records were used during verification. Tests use repository-neutral fixtures and mocked decisions; a live, human-labeled evaluation is still needed to quantify false exclusions and real end-to-end speed.

Missing evidence and exhausted responses remain reviewable rather than silently excluded. Valid but unresolved model decisions can be explicitly reviewed or regenerated; transient failed responses are not reused as completed screening. No claim of ChatGPT-equivalent latency is made.

Commit and push are handled separately on explicit user request.


## Larger-batch follow-up

In response to reported screening latency, raised the maximum batch from 8 to 32 relationship/context records and the input target from 24,000 to 96,000 characters. Concurrency remains two; evidence, identity validation and governed-decision protections are unchanged. The response protocol removes repeated phrase strings and repeated non-control decisions, while normalizing back to the existing saved schema. Existing full-response checkpoints still validate.

The 700-row fixture now needs 4 screening requests instead of 13. Tests cover compact response mapping, independent phrase rationales, uniform non-control/unresolved expansion, rejection of duplicate indices, large source inputs, the decision-count budget, cancellation and split-cache reuse. These are request-count measurements with mocked AI, not a live latency guarantee.

Follow-up verification: 3 suites / 29 tests passed; production build passed with existing warnings; `git diff --check` passed.
