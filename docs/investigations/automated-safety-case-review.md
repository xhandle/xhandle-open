# Automated safety case readiness review

Date: 2026-11-06. Scope: repository review executed using `docs/codex-prompts/automated-safety-case-review.md`, plus isolated synthetic checks. No application code or user data changed; no external AI services called.

## Verdict

The current area is an argument editor with manual evidence linking and assisted recommendations. It does not yet deliver a continuously maintained safety case. There is useful infrastructure to reuse, but the missing capability is a project-scoped evidence lifecycle and allocation service, not simply more AI generation.

Automate collection and explainable allocation by default. Keep evidence assessment, unresolved matches, and acceptance visible and reviewable. Evidence existence alone must never imply a supported safety claim.

## Current behavior

| Capability | Observed implementation | Readiness |
| --- | --- | --- |
| Argument editing | Typed nodes, relationships, manual status/confidence, diagram and inspector | Available |
| Generate from project | Builds a lifecycle template using presence checks on a limited localStorage context; the active template creates no evidence nodes or allocated evidence links | Structure only |
| Discover existing evidence | Scans browser databases and localStorage, normalizes records, groups them for a picker | Broad discovery, weak semantics |
| Manual allocation | Picker writes linkedArtifactIds; linked-evidence modal supports unlinking and unresolved IDs | Available |
| Upload evidence | Stores files in a separate IndexedDB, links uploaded IDs to a node | Available locally |
| Recommend allocation | User-triggered recommendation for one node; AI with local keyword fallback | Assisted, not automatic |
| Continuous maintenance | No source-change subscription or reconciliation service in the Safety Case area | Missing |
| Completeness | Structural checks and manually assigned statuses; no authoritative evidence resolution | Inadequate for automation |
| Portability | Safety-case JSON export contains graph and IDs; it does not package external evidence or attachment bytes | References only |

Sources: `SafetyCaseView.js:292` (active generation path), `safetyCaseProjectContext.js` (`generateLifecycleSafetyCase`), `SafetyCaseInspector.js:495` (discovery only while evidence dialogs are open), `safetyCaseEvidenceRecommendations.js`, `safetyCaseAttachments.js`, all under `src/features/safety-case/`. `generateDeterministicSafetyCase` has some raw-ID linking logic but is not the active Generate From Project path.

## Findings, in implementation priority order

### P0: Project membership is not reliable enough for automatic allocation

`safetyCaseProjectContext.js:34` returns all rows when the project-filtered set is empty, accepts unowned rows, and collects all `cba:` rows without filtering. `safetyCaseEvidenceLinks.js:308` accepts records without project ownership and treats folder IDs as possible project IDs. Its IndexedDB scanner filters the wrapper before flattening nested records, without checking the resulting children's ownership. `loadLinkableSafetyCaseEvidence` falls back to workspace-wide discovery when no project evidence is found.

Impact: another project's artifacts or ambiguous records can become candidates for the selected safety case. Before automation, resolve ownership through authoritative project/folder/module mappings; quarantine unknown ownership; remove silent workspace fallback. Explicitly authorized shared evidence needs its own scope and provenance.

### P0: Completeness can pass unsupported arguments and hang on cycles

`safetyCaseCompleteness.js:20` regards any child as enough to avoid “Claim has no support”; a context child therefore suppresses that finding. Evidence validation checks only whether an ID array is nonempty, not whether artifacts exist, are current, or provide successful verification. The final descendant traversal (`:61`) has no visited set, even after the earlier DFS detects a cycle.

Executed isolated checks against the actual exported function using synthetic nodes:

| Input | Observed result |
| --- | --- |
| Accepted claim with only a contextualizes edge to a context node | No findings (`[]`) |
| Evidence node linked to `missing`, with no resolver | No findings (`[]`) |
| Two claims with reciprocal edges | Child Node process exceeded a 1,000 ms timeout (`ETIMEDOUT`) |

These prove specific checker defects, not full browser behavior. Add bounded traversal, relationship-aware argument evaluation, artifact resolution, evidence outcome/freshness checks, and explicit gaps. In `SafetyCaseView.js:212`, overall status is “Supported” whenever no node has unsupported/needs-review status; a draft-only graph therefore also displays Supported. Derive assessment separately from author-entered review status.

### P1: There is no automatic collection/allocation lifecycle

`SafetyCaseInspector.js:495` invokes discovery from dialog state. `SafetyCaseView.js:292` creates a new template, rather than reconciling evidence into an existing argument. Recommendations are initiated in the picker for one selected node. No Safety Case service consumes source create/update/delete notifications, resolves downstream impact, or catches up after restart.

Add an idempotent service that runs outside the view, supports initial backfill and incremental reconciliation, and records its checkpoint and last successful synchronization. Preserve manual work when applying automated changes.

### P1: Evidence identity and provenance are insufficient

`safetyCaseEvidenceLinks.js:204` ordinarily constructs database/store/raw-ID identities; project-context aliases preserve raw IDs instead. Mirrored source records can appear under multiple identities. Generated sheet-row IDs depend on position, so insertion/reordering can change meaning. `safetyCaseTypes.js:56` stores bare `linkedArtifactIds`, with no first-class allocation record identifying source revision, allocation origin, rule, rationale, rejection, or pin.

Introduce canonical source-backed identities and versioned allocation records. Migrate existing IDs through aliases and report unresolved or ambiguous links. Persist automatic/manual origin, rule version, source revision/hash, supporting rationale, timestamps, and user overrides. Ensure new fields survive normalization, duplication, import/export, and backup.

### P1: Generic scanning cannot establish evidence suitability or completeness

The scanner reads all available IndexedDB names/stores and every localStorage key. Category inference is based on names; unrelated settings and raw records can enter discovery before category hiding. Project-context extraction and scans have caps (80/120 context rows; 500 records per store/key; depth 5) and timeout fallbacks. Diagnostics report counts but do not establish a complete source snapshot.

Use explicit source adapters and typed evidence eligibility. Paginate large datasets, distinguish unavailable/partial from empty, and expose incomplete collection. Broad storage discovery should not be the authoritative automation input. Allowlist fields sent to AI and use the existing workspace read policies where applicable.

### P1: Recommendations are relevance suggestions, not substantiation

`safetyCaseEvidenceRecommendations.js` ranks keywords/category boosts, limits AI candidates to 40 and results to 8, and validates returned IDs against all discovered artifacts rather than the exact submitted candidate set. `safetyCaseAI.js:37` validates node/relationship enums but does not resolve linked IDs or validate evidence relevance or project membership. Its accepted statuses include supported and accepted.

Allocate automatically using explicit trace relationships or versioned deterministic rules. Use AI to propose ambiguous matches, with exact candidate-ID validation and an explanation. Generated suggestions must not confer human acceptance. Distinguish planned tests from executed passing results and preserve negative evidence.

### P1: No evidence revision binding or change impact

Existing node metadata records edit timestamps but not evidence revision snapshots or the source configuration a claim was reviewed against. A changed/deleted artifact or failed replacement test does not automatically invalidate the relevant allocation/review. JSON export (`SafetyCaseView.js:381`) serializes the case, not its resolved evidence set.

Record current source pointers plus review-time revision/configuration bindings. On relevant source changes mark affected support stale/needs-review without erasing historical acceptance or manual content. Export a versioned manifest, source snapshots and attachments, rationale, gaps, and review decisions.

### P2: Persistence success and concurrency need strengthening

`safetyCaseStore.js:108` falls back from IndexedDB and silently ignores localStorage write failures, yet still emits an update and returns a saved-looking object. Automated background writes would also race with whole-case UI saves without revision checks. Attachment writes resolve on request success rather than transaction completion (`safetyCaseAttachments.js`, `putAttachment`).

Return explicit durability outcomes, await committed transactions, and use case revisions/transactional reconciliation or conflict-aware patches. Do not advance synchronization checkpoints after unsuccessful saves. Reconcile from source changes without creating self-triggered update loops.

## Evidence-source inventory and reuse

| Source | Existing integration/foundation | Needed for automation |
| --- | --- | --- |
| Hazards, risk assessments, functional decomposition | Project context and generic projectData/sheet scanning; dedicated hazard-run store | Typed adapters for stable hazard IDs, mitigations, scope, run/configuration, paged rows and review status |
| Requirements | `src/components/utils/requirementsStore.ts`: project-scoped IndexedDB requirements, links, version and baselineVersion | Read authoritative records and relationships, reconcile changes and aliases; avoid treating global mirror as full inventory |
| Architecture | `cba:` context and generic database/projectData discovery | Bind evidence to component/repository/configuration and revision; resolve exact implementation traces |
| Verification plans and tests | `src/components/VnVCenterPro.jsx:581` saves documents/project artifacts and overwrites a global `xhandle:vnv-center` mirror | Read project documents, distinguish test plans from execution/outcome, trace test requirement targets; a latest global mirror is insufficient |
| Code hazard analysis | `codeArchitectureHazardStore.js`: dedicated database, project/repository filters, persisted runs and change notifications | Consume saved runs through source API, handle paging and persistence outcomes, resolve row-level IDs |
| Remediation and verification execution | `safetyRemediationStore.js`: findings, patches, decisions, summaries, verificationRuns, evidence; change events | Connect findings through patch/configuration to executed result and decision; include failures and unresolved findings |
| Reviews | `src/features/results-review/reviewStore.js`: reviewItems with artifact/run/status indexes and durability outcomes | Bind review decision to precise artifact revision; do not equate review existence with approval |
| Uploaded files | `SafetyCaseEvidenceDB.Attachments` with project/case/node metadata | Committed writes, content hashes, provenance, versioning and portable export |
| Baselines/configuration | Generic scanner knows BaselinesDB; requirement schema has baselineVersion | Explicit adapter and configuration-consistency policy; baseline semantics need further tracing |
| Workspace graph | `workspaceGraphTypes.ts`, repository, migration, query, freshness and source-reconciliation modules | Prefer this existing foundation after confirming coverage, freshness, ownership and ID stability for each adapter |

The workspace graph already models artifacts, mitigates/implements/verifies/evidences relationships, runs, reviews, evidence, source metadata, versions and a changeLog. `workspaceGraphRepository.ts:194` already provides source reconciliation. The Safety Case feature currently has no direct workspace-graph integration. Reuse is a recommendation; the presence of these APIs does not prove complete source coverage or sufficient historical snapshots. Audit `legacyWorkspaceGraphMigrator.ts`, freshness and read policies before relying on them.

## Proposed lifecycle

1. Source adapters read committed project artifacts through existing APIs or the validated workspace graph. Preserve canonical IDs, ownership, revisions/configuration and source links. Collect missing, failed and unreviewed artifacts as well as positive evidence.
2. A project-scoped catalog upserts revisions and records deletions/tombstones. Reuse graph indexing/reconciliation where suitable; add only missing evidence semantics. Exclude derived safety-case records from collection to prevent circular self-evidence.
3. An allocation engine follows explicit hazard → control/requirement → implementation → verification traces. Versioned rules map artifact roles to template claims. Explicit trace links can be allocated automatically; ambiguous semantic matches remain proposals. Attaching contextual artifacts must not turn them into proof of adequacy.
4. Store allocations separately from authored nodes: case/node, canonical artifact/revision, origin, rule, rationale, eligibility/freshness state, and override. Persist rejected matches so synchronization does not reintroduce them. Pinning records the exact reviewed revision; later changes still generate an impact notification.
5. A reconciliation coordinator subscribes to existing source events, coalesces work by project, and catches up at startup/reopen. Browser storage events alone do not cover same-tab writes. Support cancellation, retries, partial source failure, cross-tab coordination and revision conflicts. In the local-first app, automatic maintenance runs while the workspace is open and catches up when reopened; closed-app continuous operation would require a separate durable runtime.
6. An assessment engine propagates stale/missing/failed support and open gaps through relevant argument relationships. Human acceptance remains a revision-bound decision. Coverage distinguishes collected, allocated, eligible, verified, reviewed and accepted states.
7. The UI shows automatic evidence, source links, rationale, changed/missing evidence, synchronization state and a review queue. Retain manual links/uploads, unlink/reject, pin and authored claims; allow collection pause/configuration. Export reproducible snapshots with a manifest.

## Implementation sequence

| Phase | Deliverable and likely files | Exit criteria |
| --- | --- | --- |
| 0 — prerequisites | Fix scope, traversal, status and durability in evidenceLinks, projectContext, completeness, View, Store and Attachments | No cross-project fallback; unknown scope excluded from automation; bounded graph checks; save failures visible |
| 1 — useful vertical slice | Validate workspace graph coverage; add requirement and executed-verification adapters; new evidence catalog/allocation/reconciliation modules; extend types/store; connect View/Inspector | Existing project safety case automatically gains explicit requirement-to-result evidence without opening picker or invoking AI; unresolved/failed/missing evidence stays visible |
| 2 — maintained argument | Source events and startup catch-up; revisions, tombstones, override store, conflict handling, assessment | Updates/deletions/failures invalidate affected support; repeated runs are idempotent; manual edits survive |
| 3 — coverage expansion | Hazards/risk, architecture/functional, remediation, reviews, operational context/governance and baseline adapters | Project inventory reconciles through stable source IDs and verified ownership; partial collection never appears complete |
| 4 — review and portability | Review queue, change history, baseline binding, evidence-bundle import/export and migration | A reviewer can reconstruct evidence and decisions for a frozen configuration after source changes |

Phase 1 should use explicit relationships for one end-to-end path, with automatic collection and allocation enabled as part of project generation and reopening. Do not start with keyword-driven bulk attachment to generic claims. Broader templates can then be populated through the same mechanism.

## Acceptance scenarios

- Create a project safety case with existing traced requirements and executed verification: eligible evidence appears automatically with source/rationale, without picker interaction or an AI key.
- Save another linked result while the case view is closed: it is reconciled within the documented open-workspace synchronization target; reopen/restart catches up missed changes.
- A project B artifact, an unowned record, and an inherited child belonging to B never allocate into project A. An empty A remains empty with visible gaps.
- Source update, deletion, failed verification or configuration mismatch marks affected support stale/missing/failed and flags dependent claims for review; previous acceptance history remains inspectable.
- Manual allocation, user wording, rejected recommendation and pinned revision survive repeated syncs, node edits, restart, duplication and migration.
- Mirrored records become one canonical artifact; sheet reorder does not silently rebind evidence; repeated reconciliation adds no duplicate nodes, allocations or edges.
- Context-only branches, nonexistent evidence, draft claims, contradictory results and cyclic graphs cannot produce a supported/accepted conclusion or an unbounded traversal.
- More than 500 records, partial source failures and timeouts produce paginated recovery or explicit incomplete status, never a misleading complete collection.
- Storage quota/transaction failure does not report success or advance checkpoints. Concurrent UI/background saves preserve both changes or expose a recoverable conflict.
- Export/import restores referenced evidence snapshots and file bytes with manifest hashes; a frozen review can be reconstructed after live evidence changes.

## Validation limits

Reviewed feature code and selected producer/storage/graph modules. Executed the three bounded checker probes above. No browser session, live datasets, full producer coverage audit, full test suite, performance benchmark, migration execution or regulatory assessment was performed. Scope/identity/reconciliation conclusions are code findings; proposed architecture and acceptance scenarios are implementation recommendations. The next engineering work should establish graph adapter coverage and deliver phases 0–1.
