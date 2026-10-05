# Implement Code-Based Architecture convergence with downstream compatibility

Execution requested by the user on 2026-10-05. Implementation details, validation results and supported convergence limits are recorded in [the implementation report](../investigations/code-source-equivalence-implementation.md). The specification below is retained for review.

Updated 2026-10-05: the user selected this broader approach instead of the narrower `implement-source-consistency-preserve-downstream.md` proposal. This prompt is the authoritative implementation scope. Include necessary downstream adaptations in the same implementation; do not defer compatibility work to a later repair phase.

The seven amendments from `docs/investigations/convergence-implementation-prompt-review.md` are incorporated below. That report describes the preceding draft; use this updated prompt as the implementation specification.

## Objective and baseline

Read `docs/investigations/code-source-equivalence-review.md` and inspect the current checkout before editing. Reviewed baseline: `aa0666f8961acf6d0af09e88670fa6bee5033c8c`. Revalidate findings against intervening changes; preserve unrelated working-tree changes.

For identical source contents and effective analysis settings, local-folder and GitHub acquisition must yield equivalent verified inputs and deterministic architecture evidence. Retain the existing shared pipeline. Do not force identical LLM prose, union independently generated graphs, assume the local output is more correct, or promise exhaustive static analysis that the implementation cannot provide.

Implement the bounded correctness fixes below with regression coverage. Separate optional expanded parsing/functional abstraction from this work and report remaining limitations explicitly.

The objective includes repeatability of fresh GitHub-to-GitHub and local-to-local runs, as well as local-to-GitHub equivalence. Protect downstream mechanics while improving upstream evidence, identity, deduplication and classification. Necessary changes to downstream consumers are authorized by this implementation prompt when it is invoked, but unrelated workflow redesign is not. Improved inputs may change newly generated analysis content; that must not break generation, editing, saving, reopening, navigation, export/import or traceability.

## Compatibility and operational constraints

- Preserve both GitHub and local folder workflows, read-only local permissions, reconnect, cancellation, directory-upload fallback, project/source isolation, selected extensions and configured context.
- Preserve existing saved row/trace/node/edge IDs, manual labels/descriptions, layouts, analyst overrides, review state, hazard/remediation/requirements/design/traceability links, CSV/JSON export/import and source navigation.
- Add versioned fields/keys and backward readers. Do not rewrite or delete existing project/source data, globally regenerate IDs, migrate all stored classifications on load, or clear unrelated checkpoints.
- Prefer preserving existing contracts. Where a contract must evolve, implement and test the producer, every affected consumer, persistence/export/import, and backward compatibility together. Use non-destructive versioned copies or compatibility mappings if necessary; retain original records and a tested rollback path. Do not leave a consumer using a stale schema or identity assumption.
- Keep byte/count/chunk/time/memory limits and secret/generated/binary protections. Do not increase capacity or discard safety-relevant low-level evidence merely to improve parity metrics. Do not expose previously excluded local source to model requests.
- No paid/live AI calls, customer-source uploads, credential changes, package upgrades or live browser-data mutation for testing. Use synthetic sources, isolated storage and mocked GitHub/AI responses. Do not commit/push unless requested.
- Read all applicable repository instructions. Make small reviewable changes, with meaningful tests for each behavioral correction.

## 1. Verified acquisition and input manifest

Relevant modules:

- `src/features/code-architecture-context/localCodeSource.js`
- `src/features/code-architecture-context/codeSourceIdentity.js`
- `src/components/generateFunctionalDecompositionFromGitHub.js`: `getCommitShaForRef`, `listRepoFilesViaGitHub`, `fetchGitHubFileRaw`, `fetchGitHubFileDirect`, `fetchRepositoryContext`, selection/planning helpers.

Introduce a bounded shared manifest contract with exact repository-relative paths and case, entry kind, byte size, content digest, decoding policy/version, adapter provenance and explicit selection/exclusion/failure disposition. Preserve original bytes for hashing when available; keep declared decoded-text digests distinct. Local snapshot IDs already in saved data must remain resolvable; version any new digest scheme. Avoid holding the whole repository text in memory.

Resolve GitHub to one immutable commit and use it for enumeration and every read/fallback. Remove silent main/master substitution. Support the configured branch/ref accurately; return actionable errors without replacing the last successful result if resolution fails. Decode GitHub base64 to bytes and then UTF-8 consistently; verify fetched content against the pinned manifest. Complete truncated tree enumeration with bounded traversal or mark acquisition incomplete and withhold a complete-result claim. Retain entry modes/kinds; do not silently interpret a symlink target string as code or follow links outside permitted scope.

Make analysis-selection policy and deterministic ordering explicit and shared. Separate adapter access restrictions from common selection rules; record current differences such as unsupported local extensions. Do not silently broaden local access or exclude more GitHub code. If safe parity requires a changed allowlist/exclusion policy, isolate/version the change and explain its compatibility effect. Preserve case and semantically significant whitespace/newlines. Do not infer that local Git is clean merely from folder name or a selected-source hash.

## 2. Run identity, context and checkpoint correctness

Relevant functions: `functionalAnalysisPlanSignature`, `deriveSystemUnderstanding`, `requestOpenAIProxyWithRetry`, main generator checkpoint logic; `src/App.js` `handleBaselineRepo`; `src/lib/api/backendConfig.js` `buildAIAuthOpts`; `server.js` `resolveAIConfigForRequest` and `/api/chat`.

Use a common versioned run fingerprint covering verified selected content, deterministic file plan, policy/extractor/prompt versions, user context and effective provider/model/effort/generation settings. Keep credentials out of hashes/logs/exports. Capture the effective model rather than assuming the `gpt-4o-mini` body constant wins over headers. Preserve existing provider-selection behavior.

Capture non-secret effective settings at run start. Either use that immutable run configuration for all requests, without altering global preferences, or detect settings changes and stop before mixing incompatible results. Verify available response provider/model provenance and record discrepancies. A response produced under incompatible settings must not be published or resumed as part of the original fingerprint. Where effective settings cannot be verified, record that limitation rather than claiming verified equivalence. Test changes during an active run and between resume attempts; never persist credentials in run metadata.

Save derived repository context within a checkpoint and reuse it for a compatible resume. Do not generate stochastic context first and make its new prose the only route to finding an existing checkpoint. Reject incompatible checkpoints without deleting them or overwriting prior results. Legacy checkpoint reuse must not silently imply settings verification that does not exist. Distinguish informational folder/repository display names from semantic context input; record any input mismatch.

## 3. Evidence storage, coverage and publication

Relevant code: `codeSourceIndexKey`, `indexSourceFileToIDB`, `clearIndexedFilesForRepo`, `buildCodeEvidenceForRows`, generator publication/error paths, App metadata persistence, source-audit and remediation consumers.

Add immutable/versioned GitHub evidence namespaces alongside local snapshot scoping. Update new-run consumers to reference the recorded evidence snapshot; preserve legacy index lookup without claiming it is verified immutable evidence. Do not clear the last-successful index before another run is durable.

Design bounded snapshot retention and peak staging storage before adding new stores. Reuse immutable identical content where appropriate without sharing project-specific decisions or access permissions. Track references from active and historical artifacts; never automatically delete referenced evidence or the last successful state. Define ownership and cleanup of disposable, unreferenced staging data created by this implementation; preserve unrelated data and compatible resumable checkpoints. Use browser storage estimates when available, but handle write failure regardless. If capacity cannot preserve required history and the new run, leave the current state intact and report insufficient capacity instead of evicting historical evidence. Test repeated runs, changed revisions, interruption and quota failure, including temporary memory, redundant-copy avoidance and accumulated storage growth. Automatic cleanup of existing user history is outside scope. Do not meet a retention budget by discarding evidence that saved artifacts still require.

Publish new rows and corresponding evidence/manifest only after successful staging/persistence. Preserve previous results on cancellation/read/quota failures. Retain useful partial-run access, but label it explicitly and do not promote it as a complete run. Ensure equivalent failure semantics across adapters where applicable without weakening local safeguards.

Replace misleading `fullCoverage` inference with explicit acquisition/selection/analysis/evidence status. Persist a bounded per-file disposition ledger, counts, versions and settings fingerprint through App metadata and portable exports; preserve old schema compatibility. Distinguish excluded-by-policy from selected-but-unreadable or not-analyzed. Report output truncation/incomplete parsing rather than assuming a nonempty AI table is complete.

Audit source readers for snapshot selection. Do not redesign the separate VS Code remediation workflow as collateral work; retain it and make unresolved provenance limitations explicit.

## 4. Additive canonical identity and deduplication

Relevant functions: `normalizeFunctionLabelForEvidence`, `dedupeFunctionalDecompositionRows`, `ensureCodeArchitectureTraceIdsCooperative`, `src/features/code-architecture-hazard-analysis/codeArchitectureHazardUtils.js` `ensureCodeArchitectureTraceIds`.

Before implementing identity changes, specify the supported languages and relationship kinds for which deterministic evidence can be enumerated with the current or narrowly extended extractors. Build that inventory independently of model proposals. Persist and reconcile its coverage separately from the functional table. Every supported relationship must have a stable disposition: represented by a functional relationship, included in a documented abstraction with evidence links, excluded by an explicit versioned policy, or unresolved. Do not force every raw call into STPA input. Model wording or omission alone must not silently remove supported evidence from coverage.

Define which supported functional mappings must remain stable and report unresolved/model-only mappings separately. Test intentionally omitted, reordered, duplicated and differently worded model proposals; identical canned responses alone are insufficient. Do not satisfy coverage by marking all relationships unresolved. Compare with labeled expected relationships and dispositions, report supported versus unresolved coverage, and account for each missing functional mapping. This authorizes a bounded evidence-inventory/reconciliation layer, not a full AST or new abstraction engine. If the supported convergence scope cannot be delivered without the deferred redesign, explicitly report that boundary and incomplete convergence rather than claiming full functional-result convergence.

Add versioned canonical evidence/comparison identities distinct from legacy trace/UI identities and source-access IDs. Use exact source and target paths, qualified case-sensitive symbols and an evidenced relation kind. Add snapshot/call-site occurrence identity separately. Resolve imports only when supported; unresolved targets and relation kinds must remain explicit. Do not derive an allegedly canonical relation kind solely from action prose or collapse all same-endpoint relationships.

For new-run deduplication, merge only relationships proven equivalent, preserve all contributing evidence/call sites, and use deterministic conflict handling. Distinct files, qualified symbols and case must survive. Wording variants of the same evidenced relation should share comparison identity. Preserve existing saved IDs and links; repeated/legacy analysis reconciliation needs compatibility tests and must not erase manual changes.

## 5. Versioned evidence-based classification

Relevant module: `src/features/code-architecture-hazard-analysis/codeArchitectureHazardEligibility.js` and its consumers.

Introduce a structured classification input for new evidence, so display wording and hierarchy labels alone cannot change lifecycle/interface/eligibility. Distinguish structural definitions/imports from evidenced executable relationships, including calls in `__init__.py`. Resolve conflicting evidence explicitly. Preserve valid analyst overrides and their rationales before automated decisions.

Use a versioned policy and explicit legacy behavior. Do not silently reclassify all saved projects or relax eligibility merely to meet agreement targets. Keep existing taxonomy/controls. Validate changes with labeled runtime, consequential initialization/configuration, structural, test, feedback, protective validation/clamp and uncertain cases.

Separate legacy interpretation from new-policy classification. Preserve stored legacy decisions and documented interpretation of unversioned records until an explicit rerun or reviewed adaptation; never bulk reclassify them on load. Do not label an inferred legacy decision as a verified historical assessment when none was stored. New-policy records may not fall back to presentation-text classification. If supported evidence is insufficient, return a deterministic Needs Review decision with its reason and provenance. Preserve valid analyst overrides before automated classification. Test that legacy records remain usable and that new-policy classification is invariant to display-only edits. Measure any increase in Needs Review; do not hide lost classification coverage by assigning everything to that category.

`makeSourceAuditArchitectureRow` currently hardcodes a clamp relationship for `extract_traj_tokens`; any synthesized row must be supported by actual function evidence. Preserve legitimate safety-relevant evidence and identify unsupported audit assertions rather than treating a symbol-name match as proof.

Do not undertake a full AST framework, generalized data-flow graph or new STPA abstraction engine in this patch. Preserve raw evidence and leave a clear additive boundary for that separately scoped work. The present model-generated relationship set cannot honestly guarantee exhaustive relationship discovery.

## 6. Required downstream impact assessment and implementation

Before editing, trace actual data dependencies from functional decomposition through all six Code-Based Architecture areas below. Produce a compatibility matrix listing each affected producer/consumer, field and identifier, join rule, storage key, source-evidence lookup, cache/checkpoint, export/import path and navigation target. Include direct and indirect consumers. Inspect the implementation rather than assuming the user-facing tab order is the dependency graph.

Use these starting points, then find all callers/readers of changed fields and keys:

- `src/App.js`: architecture/hazard/artifact wiring, generation handlers, hydration, navigation and project export/import.
- `src/features/code-architecture-hazard-analysis/`: runner, eligibility, utils, preprocessing, context/store, CSV, source audit, panels and grouping.
- `src/features/safety-remediation/`: source context, AI, utils, store, exports, handoff, verification and UI consumers.
- `src/features/code-architecture-assurance/`: `artifactDefinitions.js`, `artifactUtils.js`, `artifactAI.js`, `EngineeringArtifactPanel.js`, `EngineeringArtifactTable.js`, `TraceabilityMatrixPanel.js`, `codeArchitectureStorage.js` and `useArtifactReview.js`.
- `src/features/code-architecture-review/`, results-review registration and workspace graph consumers where they depend on changed source/relationship identity.
- Diagram source navigation and functional-table links, including existing code-architecture navigation helpers.

Classify each dependency as unchanged, adapted with a backward-compatible reader, or requiring a non-destructive versioned mapping. Implement necessary adaptations; a list of potential impacts alone is not completion.

### Required behavior by area

| Area | Required preservation/adaptation |
|---|---|
| Hazard & Remediation | Ensure hazard input selection consumes the intended classification version and honors analyst overrides. Preserve preprocessing assessments and rationale, operational contexts, draft/imported/completed results, raw analysis row IDs, consolidation, risk edits, review state and regeneration semantics. Update relationship/evidence joins and remediation source lookup for new snapshots without silently substituting another revision. Preserve finding-to-hazard/source links, verification and handoff workflows. |
| Software Requirements | Preserve derivation from the existing supported sources, including functional and hazard-derived paths where implemented, plus manual requirements. Adapt `sourceTraceId`, architecture-source and hazard-reference handling as necessary. Preserve requirement IDs, edited text, review/verification fields, and source navigation. |
| System Requirements | Preserve the existing consolidation/derivation workflow and links to software requirements and other supported inputs. Prevent architecture changes from silently dropping, duplicating or misattributing parent requirements. Preserve IDs, edits and review state. |
| Subsystem Requirements | Preserve derivation and allocation, parent requirement references and links to architecture elements. Distinguish an element's stable identity from a changed display name. If allocation genuinely changes, retain previous evidence and flag affected links rather than silently assigning requirements to another subsystem. |
| System / Subsystem Design | Preserve design generation, manual editing, allocation, requirement links, source evidence and any supported verification references. Adapt source resolvers so saved design artifacts remain navigable after a new architecture run. |
| Traceability Matrix | Update joins and source resolvers together with identity changes. Preserve existing functional → hazard/requirement → design relationships and implemented reverse navigation. Prevent false matches, disappearing links, duplication or apparently complete coverage caused by fallback to row positions or ambiguous names. Show unresolved/historical links explicitly. |

For every area, preserve applicable filtering, copy/export, import, saving/reloading and table/diagram links. Keep shared Projects-area hazard/manual-diagram workflows working if shared utilities are touched; do not change their unrelated semantics.

### Identity reconciliation and history

Define and test the distinction between comparison identity, legacy trace IDs, artifact IDs and snapshot-specific evidence. Downstream consumers must not assume a canonical comparison ID replaces a saved trace ID. Never use row order or `rowRef` alone to reconnect records after reorder/deduplication.

Scope aliases and automatic reconciliation to the owning project/source configuration and recorded old/new run. A canonical comparison ID is not authority to share trace IDs, decisions, permissions or artifacts across projects/adapters. Compare adapters through an explicit comparison context only. Transferring hazard preprocessing or decisions additionally requires compatible operational context, analysis method/guide phrase, evidence and policy scope. Preserve conflicts or mismatches for review rather than copying them. Test identical folders in two projects and the same relationship in different operational contexts; decisions must remain isolated.

- One-to-one verified matches: retain existing trace/artifact references and associated user edits/overrides where still applicable; attach new provenance separately.
- Duplicate rows merged in a new run: retain all historical references/evidence and use explicit aliases/mappings where appropriate. Conflicting preprocessing, review or analyst decisions must remain visible; never silently pick a winner.
- Relationships split, removed, materially changed or ambiguously matched: retain old artifacts and their original source evidence. Mark affected references as historical/unresolved or needing review; do not automatically attach them to a guessed replacement or copy one assessment to every split row.
- New relationships: follow current generation workflows. Do not automatically regenerate downstream results just because an architecture run completed.

Snapshot namespace changes must update all impacted source readers, exported provenance and legacy resolution paths. Legacy evidence without verified revision information remains labeled as such; do not relabel it as verified evidence from the newest run. Preserve permission/reconnect behavior for local sources and the existing VS Code workflow, while making actual evidence provenance explicit.

Define resolver outcomes for current verified, historical verified, ambiguous and missing references. Historical links must open retained historical evidence where available, never a guessed current item. If original evidence was never retained, disclose that rather than claiming it was preserved. Distinguish current coverage from historical chain existence in Traceability Matrix completeness calculations. For unchanged valid legacy fixtures, previously functioning links must still resolve; introducing unresolved status is not a substitute for compatibility. Pre-existing ambiguous links must remain accessible as historical data without being falsely upgraded. Test navigation and matrix status for each outcome across save/reload/export/import.

### Existing artifacts, classification and regeneration

Opening a project must not trigger bulk reclassification or overwrite saved analyses. Store enough policy/run provenance to distinguish the classification used by an existing analysis from the policy used for a new one. Adapt consumers that currently recompute classification on every read so that historical artifacts are not silently reinterpreted.

When corrected relationships or eligibility would change the inputs to an existing downstream artifact, retain that artifact and its lineage, identify the affected inputs, and use the existing explicit regeneration workflow. Keep status messaging proportionate; no new broad approval or project-versioning workflow is required. Persisted lineage/invalidation state must survive reload and export/import. Unrelated artifacts must not be marked affected without a dependency.

Preserve regeneration's intended user-edit and preprocessing behavior. Where a former input is no longer eligible or no longer maps uniquely, report the discrepancy and keep the original assessment accessible instead of discarding it or forcing it onto a different input.

### Persistence, failure and compatibility

Implement publication/reconciliation so an interrupted update cannot leave new architecture rows with partially updated links or missing evidence. Use a transaction or recoverable staged publication strategy appropriate to the existing stores. Test cancellation, quota/write failures, refresh/restart, incompatible checkpoints and project switching. The last successful architecture and its downstream artifacts must remain accessible.

Inventory supported formats separately. Preserve existing CSV update templates and import semantics; optional identity columns must not become required for legacy files. Full project/JSON formats must carry the versioned lineage/evidence metadata needed for their documented restoration guarantees, including IDs, aliases, policy versions and source provenance. Do not assume every flat table export is a full backup or replicate large internal metadata into every CSV row.

A CSV update in an existing project must preserve metadata not represented in that CSV. For standalone flat-file imports, retain explicit legacy/unverified status where full provenance cannot be recovered; never fabricate it. Keep old project/CSV/JSON formats readable. Test each format's actual round-trip guarantee and document limitations without redesigning unrelated export workflows. If a versioned adaptation is necessary, make it idempotent, preserve originals, test retry after interruption and document rollback. Do not rely on users manually repairing links, reimporting data or regenerating all artifacts to complete an upgrade.

## 7. Tests and acceptance

First add failing regression cases corresponding to confirmed review findings. Use one synthetic repository delivered through native directory handles, FileList and mocked GitHub tree/blob/raw/Contents transports. No real requests.

Cover:

- Unicode and identical raw/decoded hashes across transports; changed-branch reads, wrong-branch fallback, truncation, symlink metadata and fetch errors.
- Exact case-sensitive paths/symbols, duplicate short names across modules/classes, same evidence with different descriptions/action wording, multiple relation kinds/call sites and unresolved targets.
- Runtime code in package initializers versus true structural definitions, consequential initialization, tests/examples and analyst overrides.
- Selection/exclusion dispositions, secret/binary protections, bounds, unsupported types, shuffled order and batching.
- Context/provider/model/policy changes, compatible resume without regenerating context, changed local content and repeated fresh runs.
- Two projects/revisions of the same repository, failed rerun, storage quota, cancellation, project switching, old snapshot availability and export/import.
- Existing saved trace IDs, manual edits, diagrams/layouts, review state and downstream hazard/requirements links.
- Supported evidence inventories and dispositions under model omission, duplication, reordering and wording variation; no loss of supported evidence and no indiscriminate unresolved fallback.
- New-policy classification without presentation-text fallbacks, preserved legacy decisions and measured Needs Review coverage.
- Bounded staging and retained evidence growth across repeated runs, reference-aware preservation, interrupted staging cleanup and quota failures without eviction of required history.
- Cross-project/source and operational-context isolation of aliases, preprocessing and analyst decisions, including identical contents with different owners/contexts.
- Active-run provider/model/effort changes and mismatched response provenance without mixing results under one fingerprint.
- Current/historical/ambiguous/missing resolver outcomes, matrix completeness and working legacy links after reload/export/import.
- Format-specific CSV update versus full-project restoration guarantees, absent optional metadata and standalone legacy imports.

Add fixtures with legacy saved projects containing populated records in all six downstream areas, user edits, preprocessing, analyst overrides, operational contexts and reviewed results. Exercise each fixture before and after the change. Include new projects, legacy-only projects and mixed legacy/new records; both source adapters; and repeated runs at unchanged and changed revisions.

For each of the six areas, test the actual input preparation, generation with mocked model output, edit/save/reload, review handling, source/table/diagram navigation and supported export/import—not only that the tab renders. Create missing integration tests where existing coverage does not demonstrate those behaviors. Verify the true dependency chain end to end through the Traceability Matrix.

Explicitly test relationship reorder, display-name changes, duplicate merge, split, deletion, eligibility change, case-distinct symbols, conflicting overrides and ambiguous legacy matches. Assert stable references for verified unchanged items, retained historical evidence for changed items, and no fabricated reassociation or lost user decisions. Test persistence failure during reconciliation and restoration of the previous consistent state.

Acceptance: 100% agreement for matched selected file contents, the declared supported deterministic symbol/relationship inventory, canonical comparison IDs and new-policy classification with identical evidence/settings. Compare with labeled expected facts and dispositions as well as adapter-to-adapter equality. Identical omissions or blanket unresolved classifications are not a pass. With identical recorded AI outputs, final comparable structures must agree independently of adapter/order. With controlled differing proposals for the same supported facts, required functional mappings and evidence coverage must remain stable or expose an explicit unresolved mapping; missing required mappings must not be counted as achieved convergence. With live models, do not promise identical prose or exhaustive graph coverage; report remaining variability, matched/unmatched sets and supported-language limitations. Mocked tests do not measure live-model variability across real repositories.

Run this acceptance matrix for fresh GitHub→GitHub, local→local and local→GitHub comparisons. Cached/resumed runs alone do not prove fresh-run repeatability. Include controlled wording variations of the same evidenced relationships to check that new canonical identity and classification are not driven by presentation prose. Record gaps in deterministic evidence extraction rather than claiming convergence from a test that supplies identical model outputs everywhere.

Downstream acceptance is a release gate: all six areas must work with legacy and new decomposition outputs, with necessary consumer changes included. No orphaned references, silent reassignment, lost edits/overrides, incompatible saved formats or automatic downstream regeneration. Correctly reported historical/unresolved relationships are acceptable when source facts actually changed; silent link failures are not. Distinguish expected newly generated content differences from mechanical regressions.

Run relevant existing suites, including generator, local source/context, eligibility/utils, hazard CSV/preprocessing/grouping, source-context, navigation and review-export tests affected by changes. Run new equivalence/storage tests and the repository's applicable checks. Use isolated browser fixtures if UI/publication behavior changed; do not touch user browser data. Existing review probes intentionally assert old defects and should be superseded by proper regression tests, not retained as success criteria after fixes.

Also run affected hazard-runner, remediation, engineering-artifact, review, design and traceability suites, plus newly added end-to-end compatibility tests. Perform isolated browser smoke tests through all six areas with synthetic persisted data and intercepted AI calls. Report an untested workflow as a validation gap, not as preserved functionality. Do not change expected test outputs simply to hide a regression.

## Delivery

Implement in small stages: dependency/contract inventory, supported evidence scope and baseline tests → acquisition/diagnostics → bounded snapshot/publication with source-reader adaptations → checkpoints and immutable run settings → supported evidence inventory and additive identity/deduplication with scoped link reconciliation → versioned classification with downstream input adaptations → full compatibility verification. Complete producer and affected consumer changes within each stage; do not finish all upstream changes and leave downstream repair for later. Maintain a rollback path through last-successful snapshots and backward-compatible readers; no destructive migrations.

Report what changed, validation results, preserved capabilities, any policy/schema changes and their legacy behavior, and remaining limits. Distinguish adapter parity from analysis correctness and model variability. Do not claim to have explained the exact two original Alpamayo outputs without their source manifests, settings and run exports.

Deliver the completed impact matrix with a row for each of the six downstream areas: affected contracts, adaptations made (or evidence that none were needed), tests/results, legacy-data behavior and remaining limitations. Explain expected input/content changes separately from workflow mechanics. Do not claim the implementation complete while a known downstream incompatibility remains; fix it within scope or explicitly report the blocking limitation and incomplete status.

Also report the supported convergence boundary and relationship-disposition results, storage/retention budget and measured growth, run-setting consistency checks, resolver behavior and format-specific restoration guarantees. Distinguish implemented deterministic convergence from unresolved/model-only functional mappings. Do not equate a compatible downstream interface with proof that upstream relationship discovery is complete.
