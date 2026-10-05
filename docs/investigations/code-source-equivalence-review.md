# Local/GitHub architecture equivalence review

Date: 2026-10-04. Baseline: `aa0666f8961acf6d0af09e88670fa6bee5033c8c`, clean `main` before review.

The adapters share most downstream analysis code, but do **not** currently guarantee equivalent input evidence, checkpoint reuse, or persisted evidence. Several shared algorithms also make outputs depend on generated wording. These are confirmed implementation defects or limitations; they are not proof of the exact cause of the user's two Alpamayo results. Neither original run export nor matched source/settings snapshots was supplied for this review. More Runtime or Include rows does not establish better analysis.

No application fixes were made. Inspection, synthetic diagnostics, and existing unit tests only; no live GitHub/AI requests, customer source uploads, credential access, or browser-data changes.

## A. Current architecture and sources of truth

Entry point: `src/App.js:5202`, `handleBaselineRepo`. It selects the active project/repository, source-specific credentials, saved extensions, analysis context and project-scoped output key, then calls the same `generateFunctionalDecompositionFromGitHub` for both sources. Its in-flight guard prevents concurrent runs through this UI, and its result callback checks the active scope.

| Stage | Local | GitHub | Shared downstream behavior |
|---|---|---|---|
| Access | Browser directory handle or directory-upload FileList; reconnect as needed | Owner/repository/token/branch | Same configuration/workspace entry point |
| Inventory | `localCodeSource.js`: protected-directory, secret, text-type, size and count checks; sorted eligible files | Trees API blobs, returned order, `sha`/size/path | Shared vendor filter, chosen extensions/paths, priority and chunk budget |
| Revision/content | SHA-256 of decoded file text; manifest hash; reread hash check | Branch SHA lookup separate from branch tree/content reads; Git blob SHA when authenticated read succeeds | Text is indexed and split into overlapping chunks |
| Evidence | Index key includes local source ID and snapshot | Index key includes owner/repository/path, not revision | Regex symbols/ranges/imports; partial Python call verification; source grounding |
| Interpretation | Folder name enters repository context | Repository name enters repository context | README/context summary AI; per-chunk AI table generation; Markdown parsing and grounding |
| Assembly | Snapshot/context-derived checkpoint key | Commit-or-branch checkpoint key | Deduplication, evidence attachment, source-audit insertion, AI/fallback hierarchy and descriptions |
| Classification | Same function | Same function | Trace IDs then deterministic text-based lifecycle/interface/eligibility rules |
| Publication | Failed-file run rejected; result published after row persistence | Partial result allowed; UI result published before persistence | App metadata, review registration, diagrams and downstream consumers |

Relevant shared implementation is `src/components/generateFunctionalDecompositionFromGitHub.js` (abbreviated **generator** below). There are not separate local and GitHub extraction engines to replace.

Actual authorities:

- Revision: local `snapshotId` over the allowed text inventory versus independently resolved GitHub `commitSha`. They are different hash schemes and cannot be compared directly.
- Inventory/content: local provider manifest/read checks versus GitHub Trees plus blob/raw/Contents fallbacks. No common persisted, verified manifest exists.
- Symbols: `buildSourceFileIndexRecord` and regex extractors (`generator:149`, `243`, `271`, `309`, `337`). This is not a full AST/cross-language symbol graph.
- Relationships: accepted LLM table rows, with partial deterministic verification and a special source-audit insertion. The Python call list is evidence supplied to the model, not an exhaustive canonical graph driving final rows.
- Hierarchy: AI allocation or `inferArchitectureFallback`, refined per row; AI allocation is skipped above 300 rows or without bearer (`generator:2781`). Component descriptions also have AI/fallback paths.
- Source evidence: source index plus copied snippets/functions in rows. Local indexing is snapshot-scoped; GitHub indexing is mutable per repository.
- Final rows: project/repository `copilot_baseline` storage, UI rows, and review records. App persists selected metadata separately (`App.js:5305` onward). The complete returned coverage metadata is not all carried into that stored metadata object.
- Classification: `codeArchitectureHazardEligibility.js`, called by `ensureCodeArchitectureTraceIds`; valid `analyst-override` decisions take precedence. Classification is recalculated from row text elsewhere, rather than being solely a frozen run artifact.

## B. Prioritized findings

Severity refers to correctness/traceability risk, not an observed production incident. Categories: A acquisition, B indexing, C evidence, D prompts/models, E normalization, F classification, G persistence/merge, H probabilistic variability.

### 1. High — GitHub revision is not consistently pinned (A, C)

`generator:727` resolves a branch SHA, but `:3380` onward still lists/reads using the branch. `listRepoFilesViaGitHub` (`:752`) silently retries **master** after a selected-ref error. `fetchGitHubFileRaw` (`:893`) tries the requested ref, main, then master. Authenticated blob reads are pinned when successful; raw and Contents fallbacks are not verified against the listed blob. A moving branch or fallback can mix revisions while evidence records advertise the earlier commit.

Correction: resolve one immutable revision, enumerate/read exclusively from it, and verify content. Failure must remain explicit; never substitute another branch. Keep the last successful result available.

### 2. High — GitHub base64 content is not UTF-8 decoded (A, B, C)

`fetchGitHubFileDirect` (`generator:915`) returns `atob(...)` directly for blob and Contents responses. Local `File.text()` and raw `Response.text()` decode text. A synthetic source containing `café` and `车辆` becomes mojibake on the base64 route. Even one GitHub adapter can therefore deliver different content depending on which fallback succeeds.

Correction: decode base64 bytes with the same declared text-decoding policy as other paths; retain raw-content verification separately. Do not normalize identifiers or source whitespace to manufacture equivalence.

### 3. High — Missing/incomplete inventory can look complete (A, G)

`listRepoFilesViaGitHub` ignores `tree.truncated` and drops blob mode information (`generator:752`). A synthetic truncated response was accepted as the complete list. Symlink handling cannot be audited from the resulting entries. Metadata assigns GitHub `fullCoverage: true` even with skipped or failed files (`:3867`). Local `fullCoverage` becomes false even for intentional exclusions, so the same field has different meanings. App does show transient skipped-file messages (`App.js:5375` onward); this is not a claim that all warnings are absent.

Correction: complete tree traversal at the pinned revision or explicit incomplete status; preserve entry kinds and disposition reasons. Separate acquisition completeness, policy selection, analysis completion and evidence coverage. Persist a bounded per-file disposition ledger for both adapters.

### 4. High — Classification uses presentation prose and overly broad structural precedence (F, D)

`codeArchitectureHazardEligibility.js:36` combines names, paths, generated descriptions and hierarchy names. Structural rules at `:102` precede operational rules: an endpoint in `__init__.py`, action starting “Define”, or the words “class member” can exclude a row despite Runtime/command evidence. Synthetic probes confirmed Runtime/Include → Static Structure/Exclude after changing only endpoint prose, and confirmed the `__init__.py` exclusion. This is shared behavior, not a separate GitHub policy.

Correction: introduce a versioned evidence-based classification input for new runs. Distinguish a definition/import relationship from an actual call in an initializer; resolve conflicts explicitly. Preserve analyst overrides and legacy saved decisions. Do not globally change Include/Exclude defaults or remove structural filtering to increase agreement. New policy must be evaluated against labeled examples.

### 5. High — Relationship identity is wording-dependent and can collapse distinct code (E, G)

`dedupeFunctionalDecompositionRows` (`generator:1635`) keys normalized **from/action/to only**, without source/target paths or qualified symbol identities. Normalization lowercases and strips punctuation (`:1093`). Probes confirmed that identically named relationships in different files collapse, while “Call consume” versus “Invoke consume” survives as two rows for the same endpoints. First occurrence wins, making retained evidence sensitive to order.

Trace/node/edge IDs are otherwise random for new rows (`codeArchitectureHazardUtils.js:38–91`, cooperative equivalent at `generator:3236`); function identity keys lowercase paths and symbols. Existing IDs are preserved when provided, but fresh runs are not canonically aligned.

Correction: add case-preserving evidence-based comparison IDs, separate from existing persisted UI/trace IDs. Use qualified symbols, paths and evidenced relation kind; preserve multiple call sites/evidence and unresolved distinctions. Do not infer equivalence merely from matching endpoints. Never mass-replace saved IDs or orphan downstream links.

### 6. High — Checkpoint validity differs, and effective model settings are missing (D, G)

`generator:3515` fingerprints local snapshot/context/requested model/generated prompt/grounding version. GitHub uses commit-or-branch plus plan signature/grounding version, without context/prompt/model equivalence checks. `functionalAnalysisPlanSignature` includes ordered path, SHA and size (`:1693`). Thus a GitHub retry can reuse completed rows under changed context/settings. Local checkpoint identity includes newly AI-generated `systemUnderstanding`, which can vary before the checkpoint is looked up and prevent an otherwise valid resume.

The request body names `gpt-4o-mini`, but `buildAIAuthOpts` (`src/lib/api/backendConfig.js:198`) supplies selected provider/model headers. `server.js:1381` resolves `x-ai-model` before `body.model`; the inspected server path does not enforce `xhandleModelLocked`. Do not treat the body constant as the effective model. No organizational-profile injection was found in this specific generation/request route; it is not established as a cause here.

Correction: identical versioned run fingerprint covering manifest, selected plan, policy/parser/prompt versions, user context and **effective** provider/model/effort/settings. Save and reuse derived context within a compatible checkpoint. Exclude credentials from fingerprints/artifacts. Do not change provider selection semantics as part of this fix.

### 7. High — GitHub evidence storage is mutable across runs/projects (B, G)

`codeSourceIdentity.js` uses local source ID + snapshot + path, but GitHub owner/repository + path. The generator clears the GitHub repository index before the new run (`:3388`, `clearIndexedFilesForRepo`). Two project configurations of the same repository can therefore refer to a replaced index, even though output row keys are project-scoped. The main UI prevents concurrent analysis there, but sequential runs still share this namespace. Embedded row evidence mitigates some downstream reads; it does not make the index immutable.

Correction: versioned GitHub evidence namespaces, new consumers referencing the recorded snapshot, legacy lookup fallback without rewriting old records, and publication only after evidence is durable. Preserve local source isolation and portable export rules.

### 8. Medium — Inventories, exclusions, ordering and context differ before shared analysis (A, D)

`localCodeSource.js:8–10` excludes secrets, generated/dependency directories and unsupported text types before the common pipeline. Its allowlist omits `.c++`, `.h++` and notebooks; the shared default selection accepts `.c++`/`.h++` (`generator:3424`), and GitHub's extension picker can expose other types. The `.c++` discrepancy was reproduced. Shared vendor rules (`:468`) also differ from local scanning. Local caps are 10,000 scanned entries and 50 MiB eligible text; directory-handle scanning counts directories as well as files, unlike fallback FileList scanning. These are explicit browser/memory constraints, not reasons to weaken safeguards.

Local sorting uses `localeCompare`; GitHub keeps tree response order. Equal-priority files retain input order (`:498`), and context/evidence lists are truncated by position. The model sees at most 1,200 repository paths (`:3644`), and repository structure summaries also sample entries (`:820`). Local folder name versus GitHub repository name enters context. GitHub legacy callers can inherit saved global context/extensions where local callers do not; the primary App caller normally passes configured values.

Correction: shared, versioned analysis-selection policy and deterministic case-preserving ordering, with adapter-specific access exclusions recorded separately. Compare policy-selected manifests, not incomparable raw counts. Never broaden local access to secrets for parity; any changed exclusion policy needs explicit compatibility treatment. Expose input/settings mismatches.

### 9. Medium — AI proposes the relationship set; grounding does not establish completeness (C, D, H)

`generator:3490–3730` asks the model for Markdown rows, parses by pipes, then rejects/normalizes against partial evidence. Generation requests use temperature 0.2, 1,800 output tokens and retries (`:2236`); parse/accept logic does not require every deterministic call or complete output. Python same-file calls are capped at 300 (`:1426`); language extraction and verification are incomplete. Valid omissions, truncated tables, differently worded endpoints and allocation variation can change coverage even on identical inputs. Allocation switches to fallback above 300 rows (`:2781`), amplifying count differences.

Shared size limits can also omit files: 350,000-byte admission and eight estimated chunks per file; large-file estimate uses byte size with character chunk thresholds (`:1654`), roughly 44,800 bytes under current constants. Index clipping is 80,000 characters despite its `MAX_BYTES` name (`:337`). These are not proof of the observed Alpamayo omissions; actual selected manifests and run diagnostics are needed.

Correction: preserve and compare deterministic evidence independently of generated functional rows. Record supported-language limits and generation completeness. Use recorded/mock semantic responses for adapter equivalence tests. Full AST/call-graph support and new functional abstraction require separate scoped work, not an incidental rewrite in a parity patch.

### 10. Medium — Source audit and abstraction are not a general canonical evidence layer (C, F)

`makeSourceAuditArchitectureRow` (`generator:3097`) hardcodes an `extract_traj_tokens → torch.clamp` row and rationale. `buildCodeEvidenceForRows` inserts it only when an indexed `token_utils.py` record is already in its row-driven cache and the function is otherwise uncovered (`:3222`). This is a special-case repair, not a full-repository coverage audit, and the constructor does not verify the asserted clamp behavior itself. Both adapters share it, but differing initial rows/index coverage can change whether it runs.

Low-level and structural relationships remain in the same final row representation as functional exchanges; hierarchy allocation groups them but does not create a distinct abstraction graph. Regex operational keywords include tensor/torch/numpy. Do not simply suppress those primitives: validation/clamping may be consequential evidence.

Correction: preserve provenance, verify any synthesized relationship against actual evidence, and explicitly separate evidence records, functional relationships and eligibility decisions in a later additive design. Do not union results or silently remove existing safety-relevant evidence.

### 11. Medium — Partial-failure/publication policy differs (G)

`generator:3789` rejects local failed-file runs and preserves old displayed results; GitHub can publish partial rows, then attempt persistence (`:3814`), and its outer error handler clears displayed rows (`:3909`). Local index write failure propagates; GitHub index write failure tries localStorage and can be swallowed (`:394`). App has additional persistence and session-only warnings, so this finding is not a claim that every failure deletes durable rows.

Correction: stage results/evidence, make completeness explicit and protect last-successful data for both adapters. Preserve intentionally supported partial-run access with clear status rather than quietly converting it into a successful full run. Test quota failures, cancellation, scope switching and resume.

## C. Target architecture

Keep the existing entry points and shared orchestration. Add a bounded adapter contract yielding a versioned manifest (exact relative path/case, entry kind, raw-content digest where readable, explicit decoding policy, selection/disposition reason). Preserve source access identity separately: local source UUID and GitHub owner/repository/ref are still needed for permissions and storage.

The common run pipeline should consume:

1. Verified manifest + immutable evidence snapshot + explicit effective settings.
2. Supported deterministic symbols/relationships with extractor version and uncertainty.
3. Semantic enrichment/functional interpretation, attached to evidence rather than replacing it.
4. Versioned classification over evidence/context, with analyst overrides preserved.
5. Staged, auditable publication retaining legacy trace IDs and links.

Separate **access identity**, **content snapshot identity**, **logical relationship identity**, **revision/call-site evidence identity**, and existing **presentation/trace IDs**. A logical comparison key can use exact source path + qualified symbol + evidenced relation kind + exact target path/qualified symbol, scoped to an explicitly matched codebase. Occurrence identity additionally includes snapshot and source range/call site. Unknown targets stay unresolved; do not fabricate qualified names or derive kinds solely from prose. Display capitalization is not semantic identity, but identifier/path capitalization can be.

Local Git commit/dirty status is not currently read; `.git` is excluded and browser access is constrained. Matching allowed source-content manifests can establish analysis-input equivalence without claiming a clean Git checkout. Record Git SHA only when actually verified; describe unmatched/excluded/unreadable files and newline/content differences rather than erasing them.

## D–E. Invariants and acceptance measures

| Layer | Required measure for equal contents/settings and supported fixtures |
|---|---|
| Acquisition/selection | 100% exact path + content-digest agreement for selected readable inputs; every other entry has an explicit disposition; no silent fallback/truncation |
| Symbols | 100% agreement for supported deterministic extractor output; separately score recall/precision against a labeled fixture, so identical omissions do not count as quality |
| Relationships | 100% agreement for supported deterministic canonical evidence; >95% is too weak for the same deterministic algorithm and inputs |
| IDs | 100% stable comparison IDs under adapter/order/batch changes; distinct case/file/qualified symbols remain distinct; legacy IDs preserved |
| Classification | 100% agreement for identical canonical evidence, context, policy and overrides; wording-only changes cannot alter decisions in the new policy |
| Exclusions/traceability | 100% explainable dispositions; every final relationship points to verified evidence or an explicitly unresolved status |
| Hierarchy/functional abstraction | 100% agreement with identical recorded semantic responses. For live model runs, report matched/unmatched relationships, precision/recall, per-component coverage and confusion matrices; set a pilot tolerance from reviewed fixtures, not an arbitrary >95% promise |
| Persistence | Resume equals uninterrupted run under recorded responses; failed runs preserve last-successful rows/evidence; no orphaned reviews/hazard/requirements links |

Agreement is not correctness or a safety-validation claim. Report inventory/symbol/relationship intersection and symmetric difference, unmatched reasons, classification confusion by class, and stratified coverage (runtime/configuration/structural/test). An all-Exclude policy cannot satisfy the quality gates merely by matching itself. Unsupported languages/dynamic calls must remain declared limitations.

## F. Regression design and verification performed

Build one synthetic repository fixture delivered through a mocked directory handle, FileList and GitHub tree/blob/raw/Contents transports. Include Unicode, case-distinct paths and symbols, duplicate short names across modules/classes, callbacks/unresolved imports, runtime behavior in `__init__.py`, tests/examples, secrets/binaries/vendor/generated folders, symlink entries and size-boundary files. Include selected-subset runs and filenames omitted by local allowlists.

Compare inventory/dispositions, decoded content and raw hashes, symbols, evidence relationships, run fingerprint, classification and persisted outputs. Shuffle enumeration; vary batches; use identical recorded AI responses. Add branch movement, tree truncation, fetch failure, timeout/retry, edited-local-file, context/provider change, checkpoint restart, storage quota, same-repo/different-project/revision, and export/import compatibility tests. Assert old diagrams/layouts/manual descriptions, IDs, analyst overrides and downstream links remain usable. Keep live model variability tests optional and separately authorized; no paid requests in regression tests.

Performed on the baseline:

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath \
  src/components/generateFunctionalDecompositionFromGitHub.test.js \
  src/features/code-architecture-context/localCodeSource.test.js \
  src/features/code-architecture-hazard-analysis/codeArchitectureHazardEligibility.test.js \
  src/features/code-architecture-hazard-analysis/codeArchitectureHazardUtils.test.js
node docs/investigations/code-source-equivalence-probe.cjs
```

**74 tests passed in four existing suites. Seven synthetic probes passed**, reproducing prose-driven classification, initializer exclusion, cross-file deduplication loss, wording duplicates, fallback/truncated tree acceptance, UTF-8 corruption and `.c++` selection mismatch. The diagnostic extracts the inspected functions without loading app state; all service responses are synthetic. It demonstrates defects, not a full adapter-parity proof. Existing tests passing does not invalidate these gaps. No browser or live repository run was needed or performed.

## G. Safest implementation sequence

1. Add fixture/manifest/disposition diagnostics and compatibility tests; preserve limits and existing behavior.
2. Correct UTF-8 decoding, immutable GitHub acquisition and incomplete-tree reporting. Add snapshot-scoped evidence with legacy reads and staged publication.
3. Share deterministic ordering and run fingerprints; stabilize checkpoint-derived context and capture effective settings. Surface policy/adapter differences before changing exclusions.
4. Add non-destructive canonical comparison/evidence IDs; repair new-run deduplication only where equivalence is actually evidenced. Keep existing trace IDs and links.
5. Introduce evidence-based classification as a versioned path with labeled tests, explicit legacy handling and analyst override precedence. No retroactive bulk reclassification.
6. Separately scope expanded language parsing and functional abstraction. Do not claim complete relationship equivalence until supported evidence extraction justifies it.

Use versioned metadata, backward readers, snapshot publication and rollback to last-successful runs. Migration must be tested on exported legacy fixtures before any destructive cleanup is considered. No implementation or migration was executed in this review.

The proposed next-session prompt is [implement-code-source-equivalence.md](../codex-prompts/implement-code-source-equivalence.md). The executed review scope is [review-code-source-equivalence.md](../codex-prompts/review-code-source-equivalence.md).
