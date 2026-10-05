# Improve source consistency while preserving downstream mechanics

Prepared: 2026-10-05. **Prompt only; not executed.** Run only after the user separately requests implementation.

**Superseded proposal:** the user subsequently selected the broader `implement-code-source-equivalence.md`, updated to include downstream adaptations and compatibility testing. Use that prompt for the selected implementation. The narrower scope below is retained only for reference.

## User priority

Improve Code-Based Architecture source acquisition and run preparation without creating follow-on repair work in:

- Hazard & Remediation
- Software Requirements
- System Requirements
- Subsystem Requirements
- System / Subsystem Design
- Traceability Matrix

Preserve the mechanics of these features: generation, input interpretation, editing, persistence, navigation, traceability and export/import. Corrected source contents may produce different results in a future explicitly requested analysis. That is acceptable; broken workflows, changed contracts and automatic modification of existing downstream artifacts are not.

## Inspect before editing

Read applicable repository instructions and `docs/investigations/code-source-equivalence-review.md`. The review inspected commit `aa0666f8961acf6d0af09e88670fa6bee5033c8c`; verify findings against the actual checkout. Preserve unrelated work and existing review artifacts.

Inspect these implementation points:

- `src/components/generateFunctionalDecompositionFromGitHub.js`: revision resolution, tree listing, blob/raw/Contents reads, repository context, analysis plan/checkpoints, returned metadata and error handling.
- `src/features/code-architecture-context/localCodeSource.js`: local content decoding, snapshot checks and access limits.
- `src/features/code-architecture-context/codeSourceIdentity.js`: existing identity/index contracts, for compatibility inspection only.
- `src/App.js`: `handleBaselineRepo` and metadata forwarding where necessary.
- `src/lib/api/backendConfig.js` and `server.js`: effective provider/model resolution, for fingerprinting without changing provider behavior.

Trace the functional decomposition fields actually consumed by all six downstream areas. Write a concise compatibility checklist before making changes: required/optional fields, value types, identifiers, classification fields, architecture hierarchy, evidence objects, source URLs/paths, storage keys and defaults. Use existing code and saved-format fixtures as the authority; do not assume the review enumerates every consumer.

## Fixed compatibility boundary

Preserve the current functional decomposition output contract. Do not rename/remove fields, change types/defaults, introduce new mandatory fields, or require downstream consumers to adopt a new schema. Preserve row/trace/node/edge IDs, relationship identity rules, hierarchy representation, classifications and source-evidence shape.

Keep the current generation/publication workflow. This task does not add candidate architecture versions, an adoption UI, new downstream invalidation rules or automatic regeneration. Loading an existing project must not reclassify, migrate or regenerate it.

Existing manual labels/descriptions, layouts, preprocessing assessments, analyst overrides, review decisions, downstream artifacts and links must remain intact. Fresh-run random IDs may continue following the current implementation; this task must not redefine their lifecycle or claim fresh-run ID stability.

Prefer private acquisition/run metadata. If additive diagnostic metadata is necessary, keep it optional, versioned and backward-compatible outside the downstream row contract. Existing consumers must work without it. Do not change persisted source-index namespaces or local snapshot identity algorithms.

## Authorized fixes

### 1. Immutable GitHub acquisition

Resolve the configured source ref once to an immutable commit, then use that revision for tree enumeration and every blob/raw/Contents fallback. Maintain current display branch and source-link contracts. Never silently substitute main or master when the requested revision fails.

If a tree response is truncated, use bounded traversal at the same revision where practical, or fail with an explicit incomplete-inventory message before generating/publishing a misleading result. Do not silently analyze an incomplete inventory as complete. Preserve existing limits and cancellation.

Handle unsupported entry kinds explicitly; do not follow local links outside the selected scope or pretend symlink-target text is source code. Do not turn this into a new filesystem or Git client.

### 2. Correct text decoding

Decode GitHub base64 responses into bytes and UTF-8 text consistently with local `File.text()` and raw `Response.text()`. Preserve Unicode, identifier/path case and meaningful source content. Do not strip whitespace, change newlines or normalize code merely to make hashes agree.

Use bounded reads and the existing file-size protections. No new parser or source transformation is required.

### 3. Compatible checkpoint validation

Use a versioned internal checkpoint fingerprint that checks selected source revision/content and file plan, relevant analysis settings, user context, prompt/grounding versions and effective provider/model/effort. Do not assume the model constant in the request body is the effective selected model. Never include API keys, tokens or credentials.

Store and reuse derived repository context for a compatible resume. Avoid regenerating stochastic context before determining whether a compatible checkpoint exists. Reject incompatible or unverifiable checkpoints without deleting them, publishing mixed rows or modifying saved downstream results. Preserve checkpoint benefits for long analyses.

Keep provider/model selection, prompts, retries, classification, file selection and relationship processing unchanged. Do not centralize unrelated AI configuration or alter provider routing to implement fingerprinting. If effective settings cannot be established reliably, report that limitation and use conservative checkpoint reuse rather than asserting equivalence.

### 4. Accurate coverage diagnostics

Correct misleading completion reporting, including unconditional GitHub `fullCoverage: true`. Distinguish intentional exclusions, selected files, files processed and failures. Document the existing metadata contract before changing values; ensure no downstream control flow depends on a newly reinterpreted field. If it does, retain that field's contract and add optional diagnostics instead.

Use existing progress/error surfaces with minimal plumbing. Do not redesign the UI or add a new project versioning/approval workflow. Do not claim full graph coverage merely because selected files were processed.

New acquisition/checkpoint validation errors must not clear the last successful displayed or saved result. Make only the minimal upstream error-path adjustment necessary for this guarantee; do not redesign all storage/publication behavior.

## Explicitly out of scope

- Canonical-ID replacement or new relationship identity semantics.
- Deduplication changes, changed row-merging rules or reconciliation redesign.
- Lifecycle Phase, Interface Type or Hazard Analysis Eligibility policy changes, including initializer/structural-rule changes.
- Changed hazard eligibility defaults, source-audit synthesis rules, functional abstraction or subsystem allocation.
- AST/call-graph frameworks, new languages, source-index namespace migrations or schema migrations.
- Changes to extension defaults, allowlists/exclusions, priority/order, chunking, limits, prompts, model selection or retry policies for the purpose of achieving parity.
- Changes to business logic in any of the six downstream areas.
- Automatic cleanup, rewriting of old projects or automatic downstream regeneration.

The review's wording-sensitive classification and cross-file deduplication findings remain deferred. Report them as remaining limitations; do not fix them opportunistically. This phase cannot guarantee identical functional relationship sets from independent LLM runs.

If a necessary fix cannot be implemented behind the existing output contract, document the conflict and defer that portion. Complete independent in-scope work; do not expand into downstream changes. Seek a separate scope decision only for the blocked change.

## Regression tests and acceptance gates

Use synthetic sources and isolated storage with mocked GitHub and AI responses. No paid/live AI calls, customer source uploads, real browser-data edits, credential changes, dependency upgrades or permission changes.

1. **Acquisition tests:** the same ASCII and Unicode file through local, blob, raw and Contents transports yields equivalent decoded contents. Simulate a branch moving after resolution, failed requested refs, truncated trees, invalid responses and cancellation. No request silently reads another revision. Verify existing local permissions, reconnect, read-change detection and resource bounds remain intact.
2. **Checkpoint tests:** compatible interrupted/resumed runs reuse the correct context and completed work. Revision, contents, selected plan, user context, provider/model/effort and relevant version changes prevent incompatible reuse. Legacy checkpoints do not bypass validation or cause loss of saved results.
3. **Contract tests:** use deterministic/mock semantic responses and fixed ID factories to compare pre-change and post-change row contracts for unchanged valid inputs. Check evidence objects, hierarchy, classifications, identifiers and source references, not just column labels. Where acquisition corrects actual text, test the intended input correction separately from contract preservation.
4. **Downstream compatibility:** feed representative legacy and newly generated rows into existing consumers for all six areas. Verify input preparation, mocked generation, editing/save/reload, source and cross-artifact navigation, traceability, and applicable export/import. Include preprocessing/analyst overrides and existing artifact links. New optional diagnostics must not be required by any consumer.
5. **Failure preservation:** a new acquisition/checkpoint failure leaves previous functional decomposition and downstream artifacts unchanged. Opening existing projects performs no migrations/reclassification. Include a failed rerun and a project switch during a run.

Run relevant existing generator, local-source/context, eligibility/utils, hazard CSV/preprocessing/runner, remediation source-context, requirements/design/traceability, navigation and review/export tests. Identify the actual tests present in the checkout; add focused integration coverage where a critical contract lacks tests. Use isolated browser smoke checks for the touched error/progress workflow if needed.

Acceptance requires passing applicable existing tests and new regression cases, no downstream production-logic changes, no required consumer/schema migration, and no loss of existing saved data or links. Report untested areas and pre-existing failures explicitly; do not claim comprehensive compatibility from a small unit-test subset. Do not demand identical LLM prose or fix deferred semantics just to make a parity metric pass.

## Deliverables

Implement only the authorized fixes after this prompt is explicitly invoked. Provide:

- A concise change summary and files changed.
- The observed downstream contract and evidence it was preserved.
- Tests/checks run and results for each of the six downstream areas, with any gaps stated.
- Expected changes to future results due to corrected inputs, distinguished from changes to feature mechanics.
- Deferred findings and any blocked portion requiring broader scope.

Do not commit or push unless the user requests it. Do not describe this phase as complete local/GitHub semantic equivalence; its purpose is bounded source consistency with stable downstream mechanics.
