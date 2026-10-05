# Review of the convergence implementation prompt

Date: 2026-10-05. Target: `docs/codex-prompts/implement-code-source-equivalence.md`, as read before this review. References below use that version's line numbers.

Executed review instructions: [review-convergence-implementation-prompt.md](../codex-prompts/review-convergence-implementation-prompt.md).

## Verdict

**Aligned with the user's intent, but needs the amendments below before implementation.** The broader scope correctly includes downstream adaptations and verification in the same delivery. It is substantially better than the earlier proposal that would leave classification and identity issues unresolved. However, it still permits incomplete convergence and leaves several important implementation choices ambiguous.

This is a specification review, not an implementation validation. No application changes, live analysis, model requests, browser-data changes or migrations were performed. The implementation prompt itself was left unchanged. No additional automated application tests were run: tests of the current application cannot establish that a proposed future implementation is safe. Prior review results are not presented as new test results.

## Findings and proposed amendments

### 1. High — Relationship-set convergence is an objective without a sufficient implementation requirement

Target: lines 11–15, 65–79 and 154–156.

The prompt specifies stable evidence IDs and classification, but does not require a deterministic supported relationship inventory to survive different model proposals. If a model omits a relationship, canonicalizing the rows it did return does not restore it. Fresh runs can therefore retain differing functional relationship sets while the implementation satisfies many stated acceptance checks.

Supporting code: the generator supplies `verifiedSameFilePythonCallEdges` to the model around lines 3643–3657, then constructs candidate rows from the returned Markdown at line 3673. This is model-proposed coverage with validation, not an authoritative deterministic relationship inventory.

**Proposed addition:**

> Before implementing identity changes, specify the supported languages and relationship kinds for which deterministic evidence can be enumerated with the current or narrowly extended extractors. Build that inventory independently of model proposals. Persist and reconcile its coverage separately from the functional table. Every supported relationship must have a stable disposition: represented by a functional relationship, included in a documented abstraction with evidence links, excluded by an explicit versioned policy, or unresolved. Do not force every raw call into STPA input. Model wording or omission alone must not silently remove supported evidence from coverage. Test intentionally omitted, reordered, duplicated and differently worded model proposals. Define which supported functional mappings must remain stable and report unresolved/model-only mappings separately. Do not declare full functional-result convergence if this supported scope cannot be delivered without the deferred parser/abstraction redesign.

This does not authorize a full AST engine or guarantee exhaustive static analysis. It makes the achievable convergence boundary explicit. The user may still need a later scoped expansion for unsupported relationships; that should not be disguised as completed convergence.

### 2. High — Classification fallback can reintroduce the exact inconsistency being fixed

Target: lines 71–75 and 154.

The new policy is supposed to ignore display prose, but the instruction to “retain the current documented fallback or Needs Review” permits using today's prose-sensitive classifier for new-policy inputs. In that case two descriptions of the same evidence can still produce different classifications. Allowing this as an ordinary fallback conflicts with the acceptance criterion.

Supporting code: `codeArchitectureHazardEligibility.js:36–96` combines generated descriptions, action text, paths and hierarchy names before classification. Preserving that behavior for old unversioned records can be a compatibility decision; treating it as the new policy's deterministic evidence rule is different.

**Proposed replacement:**

> Separate legacy interpretation from new-policy classification. Existing unversioned records retain their documented legacy behavior until an explicit rerun or reviewed adaptation; never bulk reclassify them on load. New-policy records may not fall back to presentation-text classification. If evidence is insufficient, return a deterministic unresolved/Needs Review decision with its reason and provenance. Test that legacy records remain usable and that new-policy classification is invariant to display-only edits. Measure any increase in Needs Review; do not hide loss of useful classification coverage by assigning everything to that category.

The current analyst-override requirement should remain. Legacy records that never stored a classification cannot be falsely labeled as having a verified historical decision.

### 3. High — Snapshot/history preservation lacks a storage-growth policy

Target: lines 21–24, 53–55, 114–118 and 130–132.

The prompt requires immutable snapshots, preserved originals, historical artifacts and staging, while retaining current memory/storage safeguards. Those are compatible goals, but no retention or peak-write budget is defined. Per-run file limits do not bound accumulated snapshots or duplicate evidence embedded in multiple artifacts. A literal implementation could increase storage until quota is exhausted—particularly relevant to the user's earlier lost overnight results.

**Proposed addition:**

> Design bounded snapshot retention and peak staging storage before adding new stores. Reuse immutable identical content where appropriate without sharing project-specific decisions or access permissions. Track references from active and historical artifacts; never automatically delete referenced evidence or the last successful state. Define ownership and cleanup of disposable unreferenced staging data created by this implementation. Preserve unrelated data. Use browser storage estimates when available but handle write failure regardless. If capacity cannot preserve required history and the new run, leave the current state intact and report insufficient capacity; do not evict historical evidence silently. Test repeated runs, changed revisions, interruption and quota failure, including bounded temporary memory and storage growth. Cleanup of existing user history remains outside automatic migration scope.

This is a necessary operational constraint, not a request for a general storage-management redesign.

### 4. Medium — Comparison identity versus project decisions needs explicit scope rules

Target: lines 65–67 and 111–118.

The distinction between comparison, access and trace IDs is good. However, path + symbol + relation kind can match across unrelated projects or two local folders. The reconciliation instructions do not explicitly prohibit transferring assessments/overrides across those boundaries. Relationship identity also does not establish equivalence of operational contexts or analysis methods.

Supporting code: `codeSourceIdentity.js` deliberately isolates local source IDs; `artifactUtils.js:45` scopes artifact storage by project and repository. These boundaries must survive the new mapping layer.

**Proposed addition:**

> Scope aliases and automatic reconciliation to the owning project/source configuration and recorded old/new run. A canonical comparison ID is not authority to share trace IDs, decisions, permissions or artifacts across projects/adapters. Compare adapters through an explicit comparison context only. Transferring hazard preprocessing or decisions additionally requires compatible operational context, analysis method/guide phrase, evidence and policy scope. Preserve conflicts or mismatches for review rather than copying them. Test identical folders in two projects and the same relationship in different operational contexts; decisions must remain isolated.

This is especially important because some downstream records represent a relationship-plus-context, not just a code edge.

### 5. Medium — Capturing effective settings once does not prevent mixed-setting runs

Target: lines 45–47.

A correct initial fingerprint alone is insufficient if each subsequent request rereads provider/model preferences and a user changes them mid-run. New checkpoints could then be labeled with settings different from those used for some rows.

Supporting code: `buildAIAuthOpts` reads current preferences; the generator calls it for model requests. Server resolution can select header/body/default models. The prompt correctly notices effective-model precedence but does not specify behavior when settings change during execution or when the provider reports a different effective model.

**Proposed addition:**

> Capture non-secret effective settings at run start. Either use that immutable run configuration for all requests, without altering global preferences, or detect changes and stop the run before mixing incompatible results. Verify available response provider/model provenance and record discrepancies. A response produced under incompatible settings must not be published or resumed as part of the original fingerprint. Test settings changes during an active run and between resume attempts. Keep credentials out of persisted run metadata.

This can be implemented without redesigning provider selection for unrelated workflows.

### 6. Medium — Historical/unresolved links need defined resolution behavior

Target: lines 105, 115, 124 and 158.

The prompt allows historical/unresolved relationships, appropriately avoiding guessed reassociation. But “show unresolved/historical links” does not say whether a retained artifact still opens its original evidence, whether matrix completeness includes stale references, or what happens for an ambiguous legacy link even though source contents did not change. Those details determine whether the user's workflow remains usable.

Supporting code: `TraceabilityMatrixPanel.js:19` falls back from trace ID to row reference/index; `buildCompleteness` around line 76 derives completion from chain presence. New alias/history support must not turn presence of an old or ambiguous ID into a verified current chain.

**Proposed addition:**

> Define resolver outcomes for current verified, historical verified, ambiguous and missing references. Historical links should open retained historical evidence where available, never a guessed current item. If original evidence was never retained, disclose that rather than claiming preservation. Distinguish current coverage from historical chain existence in completeness calculations. For unchanged valid legacy fixtures, all previously functioning links must still resolve; introducing unresolved status is not an acceptable substitute for compatibility. Pre-existing ambiguous links must remain accessible as historical data without being falsely upgraded. Test navigation and matrix status for each outcome across save/reload/export/import.

This bounds the meaning of compatibility without promising recovery of evidence that the old application already lost.

### 7. Medium — Export/import requirements conflate flat tables and complete backups

Target: line 132 and downstream acceptance lines 150–162.

The prompt requires old CSV/JSON formats to remain readable and IDs, aliases, policies and provenance to round-trip. Flat CSV update workflows and a full project backup do not necessarily carry the same information. An implementer could alter familiar CSV headers, require new mandatory columns, or serialize large internal metadata into every row merely to satisfy the wording.

Supporting code: `codeArchitectureHazardCsv.js` constructs a fixed table from hazard and traceability columns; artifact definitions use specific fields such as `sourceTraceId`. These need format-specific contracts.

**Proposed addition:**

> Inventory supported formats separately. Preserve existing CSV update templates and import semantics; optional identity columns must not become required for legacy files. Full project/JSON formats should carry the versioned lineage/evidence metadata needed for complete restoration. A CSV update in an existing project must preserve metadata not represented in that CSV. For standalone flat-file imports, explicitly retain legacy/unverified status where full provenance cannot be recovered; never fabricate it. Test each format's actual round-trip guarantee and document limitations without redesigning unrelated export workflows.

## Downstream coverage assessment

All six areas are explicitly covered. No entire user-named area is missing.

| Area | What the prompt already gets right | Main amendment needed |
|---|---|---|
| Hazard & Remediation | Eligibility versioning, preprocessing, contexts, raw row IDs, findings, verification and source snapshots | Context-scoped reconciliation; non-prose fallback; historical resolution |
| Software Requirements | Functional/hazard/manual sources, stable requirement IDs, review fields and navigation | Project-scoped aliases and format-specific round trips |
| System Requirements | Parent relationships, consolidation, user edits and saved identity | Verify historical versus current parent chains |
| Subsystem Requirements | Allocation, names versus identity and changed allocation handling | Test ambiguity and context/source scope rather than copying by display name |
| System / Subsystem Design | Generation, editing, allocation, requirement links and evidence | Bound retained evidence and specify historical navigation |
| Traceability Matrix | Joined identity adaptations, false-match prevention and reverse navigation | Explicit current/historical/unresolved resolver and completeness semantics |

The requirement to implement producer and consumer adaptations together is appropriate. The instruction to inspect actual dependencies is necessary: a prompt cannot enumerate every indirect consumer in advance. Unrelated UI redesign is correctly excluded, and changes to the shared Projects area require regression protection.

## What should remain unchanged in the prompt

- The full upstream scope, including deduplication and versioned classification; returning to the narrow proposal would leave known repeatability mechanisms unresolved.
- The separation of comparison IDs from saved trace IDs, and the prohibition on destructive migrations and guessed links.
- Downstream adaptations as a completion gate, with existing and newly generated data exercised end to end.
- Preservation of analyst decisions, manual edits and original evidence; no automatic downstream regeneration.
- Mocked/synthetic tests and no paid live runs during implementation. Controlled omission/variation tests can establish deterministic behavior within the declared support scope without paid requests. They cannot measure live-model variability across real repositories.
- Honest reporting of unsupported evidence extraction and untested areas, rather than promising complete static analysis or zero regression risk.

## Recommended disposition

Apply the seven targeted wording amendments before invoking the implementation prompt. The first three are the highest priority: define supported relationship coverage, remove the new-policy prose-fallback loophole, and bound history/storage growth. The remaining amendments make downstream compatibility testable and protect isolation, runtime consistency and export behavior.

After amendment, this is a reasonable staged engineering implementation specification. It is still substantial work, not a small adapter fix. Completion must be established by the requested regression and integration evidence; reviewing the wording cannot guarantee that every future implementation change is bug-free.

## Review execution evidence

Read the target prompt, its preceding source-equivalence investigation, and relevant identity, classification, generator, traceability and export code. Checked references to existing source isolation and artifact storage scopes. Compared requirements against the user's stated convergence, saved-data preservation, downstream-mechanics and memory/storage concerns.

Created only this report and its review prompt. Left the target implementation prompt and application unchanged. No commit/push or live service requests. The broader implementation has not been run.
