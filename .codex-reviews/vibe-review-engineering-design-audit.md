# Vibe Review engineering-design audit

Date: 2026-09-20  
Scope: hazard-analysis and functional-decomposition Vibe Review, review cascades,
Collaborator persistence, and Review Center evidence.  
Method: read-only inspection of the current repository plus existing automated tests.

## Executive assessment

The capability has valuable safeguards—stable row queues, explicit human actions,
proposal normalization, post-write classification inspection, workspace identity
checks, pause/resume support, audit summaries, and browser-storage fallbacks—but it
is not yet designed as one coherent workflow engine. Its behavior is distributed
across a large React component, App-owned artifact mutation callbacks, two similar
but different session reducers, message cards used as workflow state, local/session
storage, Review Center records, and an in-memory cascade object.

**Overall engineering risk: High.** The primary risk is not that individual rules
are absent; it is that the same decision is represented and validated at several
different moments against mixtures of pre-write and proposed state. This allows a
proposal to pass one layer, fail another, persist partially, lose its continuation,
or be described inaccurately to the user. The observed Direct/Related loop is a
verified example of this systemic issue.

The recommended design direction is a versioned, persistent review-workflow service
with a single canonical aggregate, explicit commands/events, pure decision-policy
functions, transactional artifact mutation, postcondition validation, idempotency
keys, and UI derived entirely from authoritative workflow state.

## Current architecture and data flow

1. Collaborator recognizes a Vibe Review intent and resolves a scope against the
   current table. Hazard scope parsing maps natural-language filters to column
   values and snapshots stable Raw Analysis Row IDs
   (`src/features/project-hazard-analysis/vibeReviewScope.js:42-49,84-173`).
2. A domain-specific session is created. Hazard and functional reviews have separate
   session types and reducers, both stored primarily in localStorage with
   sessionStorage and memory fallback
   (`project-hazard-analysis/vibeReviewSession.js:1-59,61-109`;
   `functional-vibe-review/functionalVibeReviewSession.js:1-61,76-123`).
3. Collaborator loads the active artifact via App-registered action providers,
   generates one AI proposal, normalizes/validates it, persists it into the session,
   and emits a message containing an actionable UI card
   (`XHandleCopilotView.jsx:5102-5201`).
4. A user accepts or overrides the proposal. Collaborator transitions the session to
   `applying` and calls an App-owned mutation callback
   (`XHandleCopilotView.jsx:5263-5269,5418+`).
5. App locates the row in either a functional-project Summary or a code-architecture
   hazard run and applies a review-target-specific write set. Classification
   resolution can write classification and causal-support columns
   (`App.js:10991-11018,11034-11064,11066-11133`).
6. Collaborator records a local audit entry, marks impacted cells, plans downstream
   work, advances the session, and emits the next proposal or a completion summary.
   Follow-up reviews are implemented by embedding a serialized parent session in a
   new child session (`XHandleCopilotView.jsx:5297-5321,5204-5216`).
7. Downstream work is represented by a cascade object attached to a chat message.
   Hazard downstream actions can pause the parent until selection/regeneration is
   finished (`XHandleCopilotView.jsx:6345-6382`). Functional cascades are currently
   announced as message data after the functional decision
   (`XHandleCopilotView.jsx:5959-5973`).
8. Review Center receives session-level evidence. Per-decision Review Center capture
   is intentionally disabled; individual decisions live only in the Vibe Review
   session/audit (`XHandleCopilotView.jsx:5053-5074`).

## Reconstructed state machines

### Hazard review

Declared states are `idle`, `defining_scope`, `proposing`, `awaiting_decision`,
`applying`, `advancing`, `completed`, `cancelled`, and `paused`, although `idle`,
`defining_scope`, and `advancing` are not used by the reducer
(`vibeReviewSession.js:55-59,78-108`).

Observed transitions:

```text
create -> proposing
proposing --proposal (valid or invalid)--> awaiting_decision
awaiting_decision --apply--> applying
applying --decision--> proposing | completed
awaiting_decision --skip/missing--> proposing | completed
any active --pause--> paused --resume--> awaiting_decision | proposing
active --stop--> cancelled
after decision --downstream selection--> parent remains logically blocked
classification prerequisite -> child session -> embedded parent restoration
decision --undo--> proposing at prior row
```

The declared state does not encode “awaiting downstream selection,” “awaiting child
review,” “unresolved after post-write validation,” “recovering,” or “persistence
degraded.” Those conditions are represented through message cards and ad hoc session
properties instead.

### Functional review

Functional review declares only `proposing`, `awaiting_decision`, `applying`,
`completed`, `cancelled`, and `paused`, with similar transitions
(`functionalVibeReviewSession.js:26-33,94-123`). It additionally stores a complete
row snapshot and replays decisions for recovery (`functionalVibeReviewSession.js:63-73,125-166`).
This is materially different from hazard recovery, which relies on the current
artifact plus a snapshot of only the current row.

### Cascade

Cascade states are `queued`, `active`, `complete`, and `dismissed`
(`review-cascade/reviewCascade.js:8-65`). The cascade is not integrated into either
domain session reducer; its cursor/status live in message payloads. Therefore the
system has multiple concurrent state machines without a single transactional owner.

## Source-of-truth and ownership matrix

| Concern | Current source(s) | Ownership problem |
|---|---|---|
| Artifact row | `analysisResult.Summary`, draft hazard rows, code-architecture run, functional rows | Multiple projections must be aligned manually; no row revision token. |
| Review queue/cursor | Domain session in local/session/memory storage | Stable IDs are good, but one session per project+thread key can replace another. |
| Current proposal | Session plus Collaborator message card | Card can outlive or disagree with session after compaction/recovery. |
| Workflow state | Session reducer, message-card flags, parent/child fields, cascade object | No single authoritative aggregate. |
| Governed decision | Artifact row | Correct ultimate authority, but updates are assembled in UI code and target-specific write sets. |
| Derived classification status | Recomputed from row schema/policy | Good concept, but validation can combine pre-state and candidate state. |
| Downstream work | Cascade attached to message; child session fields | Not durably owned by the review session. |
| Audit | Session decisions, separate audit map, Review Center session evidence, chat messages | Partial duplication; per-decision Review Center evidence is disabled. |
| Cell impact markers | Browser custom events/UI state | Ephemeral and cleared by lifecycle messages, not derived from durable decision records. |
| AI configuration | Snapshot in session | Useful for traceability, but prompt/policy/schema versions are not captured. |

## Ranked findings

### Critical 1 — Candidate validation is contaminated by pre-update row state

**Verified fact.** `normalizeNeedsReviewClassificationDecision` correctly emits empty
intermediate fields for every classification except Related
(`needsReviewResolver.js:252-270,300-325`). However, the subsequent proposal audit
combines the old row’s Intermediate Safety Effect with the governed candidate using
`joinEvidence(rowFields[...], governed[...])`
(`vibeReviewProposal.js:228-245`). For a proposed Direct repair, the governed effect
is empty but the old Related effect survives. The audit can therefore report that
Direct depends on an intermediate function even though the proposed atomic state
explicitly removes it.

**Likelihood:** High; reproduced in the user’s current workflow.  
**Impact:** Valid repairs remain Policy Validation Gap, reviews loop or stall, and
the user sees mutually contradictory explanations.  
**Design direction:** Validate a fully materialized candidate row created by applying
the proposed patch to an immutable pre-state. Never concatenate old and new values
for governed fields. Policy validators must accept one complete state, not a mixture.

### Critical 2 — No atomic command encompassing mutation, validation, audit, and advancement

**Verified fact.** Artifact persistence occurs in App, while audit append, session
decision recording, cascade creation, and cursor advancement occur later in
Collaborator (`App.js:10991-11133`; `XHandleCopilotView.jsx:5418+`). These operations
use different storage systems and are not one transaction.

**Likelihood:** Medium to high under exceptions, quota exhaustion, refresh, or tab
closure.  
**Impact:** A row can be changed while the session remains at the old item; an audit
can be missing; or a retry can apply the same logical decision again.  
**Design direction:** Introduce one idempotent `ApplyReviewDecision` command with
expected artifact revision, session ID, row ID, item attempt ID, decision ID, and
postconditions. Commit artifact mutation plus workflow event atomically, or use a
durable outbox with deterministic recovery.

### Critical 3 — Workflow truth is split between sessions and chat-message cards

**Verified fact.** Cascades are embedded in messages, card completion is managed by
rewriting thread history, and parent blocking is inferred from card properties
(`XHandleCopilotView.jsx:6272-6275,6345-6382`). Session reducers do not represent these
states. Functional cascades are emitted as messages but not integrated into the
functional session lifecycle (`XHandleCopilotView.jsx:5959-5973`).

**Likelihood:** High over refresh, history compaction, or recovery.  
**Impact:** Missing buttons, premature next items, lost downstream choices, duplicate
summaries, and reviews that appear to disappear.  
**Design direction:** Persist workflow aggregate state independently from chat.
Messages should be projections of state, never the mechanism that owns progress.

### High 4 — Optimistic concurrency is absent

**Verified fact.** Decisions locate rows by stable ID, which is good, but neither the
session nor apply callback supplies an expected artifact/row revision or hash
(`App.js:11044-11051,11071-11078`). Current-row snapshots are checked primarily on
resume, not immediately before every apply (`XHandleCopilotView.jsx:5371+`).

**Likelihood:** Medium in multi-tab use or when the user edits/regenerates during a
review.  
**Impact:** A valid proposal based on stale evidence can overwrite newer row data.  
**Design direction:** Add artifact and row revisions; reject stale commands with a
three-way diff and an explicit rebase/re-review path.

### High 5 — Persistence degradation is silent and schema-unversioned

**Verified fact.** Session persistence silently falls from localStorage to
sessionStorage to memory and returns a durability label that callers ignore
(`vibeReviewSession.js:26-53,111-123`; functional equivalent at
`functionalVibeReviewSession.js:35-61,168-180`). Parse failure silently becomes an
empty map. Session payloads have no schema version or migration pipeline.

**Likelihood:** Medium; browser quota failure has already occurred in this product.  
**Impact:** Reviews may vanish after restart while the UI implied they were saved;
corrupt or old records are silently discarded or misinterpreted.  
**Design direction:** Store workflow aggregates in IndexedDB with schema versions,
migrations, checksums, and explicit durability status. Make localStorage only a
small pointer/preferences store. Surface degraded persistence to the user.

### High 6 — Nested reviews serialize complete parent sessions by value

**Verified fact.** A prerequisite child stores a copied parent object in
`returnToClassificationSession`; completion restores that copy
(`XHandleCopilotView.jsx:5297-5316,5204-5216`).

**Likelihood:** Medium as workflows grow.  
**Impact:** Stale parent copies, large storage records, recursion, ambiguous audit
identity, and lost updates if the parent is modified elsewhere.  
**Design direction:** Model workflows as persisted nodes with IDs and parent/child
relations. Store references and dependency status, never embedded aggregate copies.

### High 7 — Hazard and functional review engines duplicate behavior but diverge

**Verified fact.** They have separate reducers, persistence implementations,
recovery semantics, action handlers, and summaries. Functional recovery snapshots
all rows and replays decisions; hazard recovery does not
(`vibeReviewSession.js:78-109`; `functionalVibeReviewSession.js:94-166`).

**Likelihood:** High; fixes commonly land in only one path.  
**Impact:** Different reliability and UX for conceptually identical operations.  
**Design direction:** One generic workflow engine with domain adapters for scope,
proposal policy, mutation, and downstream dependency discovery.

### High 8 — Policy, normalization, deterministic repair, and write-set rules are dispersed

**Verified fact.** Safety semantics are spread across proposal normalization,
needs-review resolution, policy audit, classification-status derivation, App write
sets, and cascade planning. App separately hard-codes allowed columns for two review
targets (`App.js:10992-11018`).

**Likelihood:** High whenever a column or policy changes.  
**Impact:** A policy fix can be correct in one layer but contradicted by another.  
**Design direction:** Define a versioned decision policy that returns a canonical
`DecisionPatch`, allowed write set, invariants, validation report, dependencies, and
explanation from one pure domain module.

### High 9 — Review Center evidence is not a complete authoritative decision ledger

**Verified fact.** Session snapshots are written to Review Center, but individual
decision publication is explicitly a no-op (`XHandleCopilotView.jsx:5053-5074`). A
separate local audit map is capped at 250 records per project
(`vibeReviewSession.js:137-143`).

**Likelihood:** Certain for large/long-lived projects.  
**Impact:** Weak forensic traceability: users can see a session summary without a
durable, queryable event for each proposal, override, validation result, mutation,
undo, and cascade outcome.  
**Design direction:** Use an append-only review event ledger as the source for both
Review Center and session projections. Retention must be explicit and exportable.

### Medium 10 — Declared states and actual states do not match

**Verified fact.** Hazard declares unused states and omits several real waiting
conditions (`vibeReviewSession.js:55-59,78-108`). Failure returns to
`awaiting_decision` even when no valid proposal exists. An invalid proposal is still
stored through the generic `proposal` transition (`XHandleCopilotView.jsx:5182-5188`).

**Impact:** UI action availability must infer validity from card fields, leading to
invalid controls and confusing loops.  
**Design direction:** Use a discriminated state model such as
`awaiting_valid_decision`, `awaiting_manual_resolution`, `awaiting_dependency`,
`awaiting_downstream_selection`, `persisting`, `conflict`, and `recovery_required`.

### Medium 11 — AI contract enforcement is strong locally but lacks contract identity

**Verified fact.** Prompts demand strict JSON, one repair is attempted, outputs are
normalized, and deterministic fallbacks exist. Functional requests also have a
timeout (`functionalVibeReviewProposal.js:33-47,123-174`). Hazard requests do not
show the same explicit timeout in their proposal service. Neither session records a
prompt schema/policy/validator version.

**Impact:** Results cannot be reproduced or safely migrated when prompts and policy
change; provider-specific failure patterns can strand items.  
**Design direction:** Version JSON schemas, prompt templates, policy bundles, and
normalizers; record all versions and response hashes per attempt. Apply bounded
timeouts and cancellation consistently.

### Medium 12 — Thread retention protects sessions but not a canonical UI projection

**Verified fact.** Thread persistence protects unfinished review threads and has
quota-aware fallbacks (`copilotThreads.js:10-31,87-120,142-173`). However messages
can still be truncated/compacted, and the active card is stored in that history.

**Impact:** Recovery correctness depends on reconstructing UI from two independent
stores.  
**Design direction:** Rebuild the active card from workflow state after every load;
chat history should contain narrative only.

### Medium 13 — Tests are primarily unit/component tests, not transactional workflow tests

**Verified fact.** There is substantial unit coverage for reducers, proposal
normalization, policies, cascades, scope, and UI card rendering. The architecture
does not expose a single orchestration service that can be tested end-to-end.

**Impact:** Cross-layer failures—like pre-state contamination, persistence failure
between mutation and cursor advance, duplicate clicks, and restart during apply—can
escape despite many passing tests.  
**Design direction:** Add model-based state-machine tests and an in-memory adapter
integration harness covering full commands and failure injection.

## Required invariants and acceptance criteria

1. **One authoritative aggregate:** every active review has exactly one persisted
   aggregate with schema version, revision, domain, artifact identity, queue, current
   item, dependencies, and terminal state.
2. **Stable identity:** queue entries use stable artifact and row IDs; row index is
   display metadata only.
3. **Snapshot integrity:** every proposal records artifact revision, row revision,
   evidence snapshot hash, policy version, prompt/schema version, provider/model,
   and attempt ID.
4. **No mixed-state validation:** validators receive one complete candidate row.
5. **Explicit proposal status:** malformed/invalid/needs-evidence proposals cannot be
   accepted and are not represented as ordinary awaiting-decision states.
6. **Governed write set:** a decision command may modify only fields declared by its
   versioned policy. Derived fields are computed, not independently authored.
7. **Atomic success:** “saved,” cursor advancement, and completion are emitted only
   after artifact persistence and all required postconditions succeed.
8. **Idempotency:** repeating the same decision command produces no additional
   mutation, audit event, or cursor advancement.
9. **Concurrency:** applying against a changed row returns a conflict without writes.
10. **Sequential dependencies:** a parent item cannot advance while a required child
    or selected downstream review is unfinished.
11. **No hidden skip:** automatic no-op dependencies are recorded as not required,
    never as user skips.
12. **Recoverability:** reload at every state produces either the same actionable
    step or an explicit recovery/conflict step.
13. **Durability transparency:** if only tab-memory persistence is available, the UI
    states that the review will not survive closing the tab.
14. **Complete audit:** every proposal attempt, validation, disposition, write,
    postcondition, retry, skip, undo, conflict, and cascade outcome is immutable and
    attributable.
15. **Exactly one completion summary:** emitted from a terminal event, not inferred
    from message history.

## Recommended target architecture

```text
VibeReview UI / Collaborator adapter
        |
        v
Review Application Service (commands, authorization, idempotency, transactions)
        |
        +-- Review Aggregate / State Machine
        +-- Domain Adapter: Hazard | Functional Decomposition
        +-- Policy Engine (pure, versioned)
        +-- AI Proposal Gateway (schema-versioned, untrusted)
        +-- Dependency Planner (persistent DAG)
        +-- Artifact Repository (revisioned compare-and-swap)
        +-- Review Event Store + Outbox
        |
        v
Read models: Collaborator cards, Review Center, cell impacts, summaries
```

Component boundaries:

- **Application service:** the only component allowed to advance workflow state or
  apply a decision.
- **Domain adapters:** define row identity, snapshotting, proposal context, allowable
  decisions, mutation patches, and dependency discovery.
- **Policy engine:** materializes candidate state, validates invariants, and returns
  machine-readable findings/remediation choices.
- **AI gateway:** produces untrusted proposal DTOs only; it never mutates artifacts
  or declares approval.
- **Event store/outbox:** persists workflow events and artifact mutation outcomes;
  Review Center and chat become projections.

## Canonical domain and event model

Core entities:

- `ReviewWorkflow {id, schemaVersion, revision, domain, artifactRef,
  artifactRevision, scopeSnapshot, queue, cursor, state, activeItemId,
  dependencyGraphId, reviewer, createdAt, updatedAt}`
- `ReviewItem {id, stableRowRef, baselineRevision, baselineHash, status,
  attempts[], dispositionId?, dependencyIds[]}`
- `ProposalAttempt {id, inputHash, policyVersion, promptVersion, schemaVersion,
  provider, model, outputHash, normalizedProposal, validationReport, status}`
- `Disposition {id, itemId, kind, decision, rationale, actor, proposalAttemptId?,
  expectedRowRevision, createdAt}`
- `DecisionPatch {set, clear, derived, governedFields, expectedPostconditions}`
- `Dependency {id, parentItemId, type, required, status, affectedFields}`
- `ReviewEvent {id, workflowId, sequence, commandId, type, payload, actor, at}`

Key commands/events:

- `CreateReview` / `ReviewCreated`
- `RequestProposal` / `ProposalRequested|Received|Rejected`
- `AcceptProposal|OverrideDecision|SkipItem`
- `DecisionValidated|DecisionRejected`
- `ApplyDecision` / `ArtifactPatched|ArtifactConflict|PersistenceFailed`
- `PostconditionsPassed|PostconditionsFailed`
- `DependenciesPlanned|DependencySelected|DependencyCompleted|DependencyDismissed`
- `ItemCompleted|CursorAdvanced`
- `ReviewPaused|ReviewResumed|ReviewStopped|ReviewCompleted`
- `UndoRequested|CompensatingPatchApplied`

Every command must carry `commandId`, `workflowRevision`, `artifactRevision`, and
`itemId` for idempotency and concurrency control.

## Persistence, concurrency, recovery, and migration requirements

- Store aggregates/events in IndexedDB or a server repository, not localStorage.
- Use explicit database and record schema versions with tested migrations.
- Commit artifact patch and review event together where possible. Otherwise use a
  durable outbox and reconciliation worker.
- Compare-and-swap both workflow revision and row/artifact revision.
- Maintain append-only events; derive mutable projections from them.
- Checkpoint large evidence snapshots separately by content hash.
- Never silently convert parse/corruption failure to “no review.” Quarantine and
  report corrupted records.
- Support restart in every state, including mid-request and mid-write. Requests may
  be retried; writes require command-id deduplication.
- Parent/child relationships use IDs and a dependency DAG, not embedded copies.
- Migration must import current hazard/functional sessions and audit maps, label
  their provenance, and validate referential integrity before activation.

## AI and deterministic-policy requirements

- AI output is always `UntrustedProposal`; only policy validation can make it
  `ActionableProposal`, and only a reviewer disposition can authorize mutation.
- Use provider-independent JSON Schema with strict enumeration and required fields.
- Store raw response hash and normalized result; never depend on rendered prose.
- Separate format repair from engineering-policy repair and record both attempts.
- Deterministic rules take precedence for logically entailed mappings, but must emit
  the same canonical patch type as AI proposals.
- Missing evidence produces explicit evidence requirements, not fabricated values or
  infinite retries.
- Protection uncertainty and classification uncertainty must remain separate domain
  concepts.
- Validate only the fully materialized post-patch candidate row.
- Prompt, schema, taxonomy, and policy versions must be recorded with each attempt.

## Test and observability strategy

Required automated layers:

1. Pure policy property tests for all classification combinations and absence
   sentinels.
2. State-machine model tests generating legal/illegal event sequences.
3. Contract tests for every provider wrapper and malformed response family.
4. Repository tests for quota, corruption, migration, and fallback behavior.
5. Transaction tests injecting failure after each operation boundary.
6. Concurrency tests: second tab edit, regeneration during review, duplicate click,
   delayed response, stale resume, and deleted/recreated row.
7. Parent/child/cascade tests with refresh at every step.
8. End-to-end tests for hazard and functional domains using the same conformance
   suite.
9. Audit/replay tests proving the aggregate can be rebuilt from events.
10. Accessibility tests for disabled-action explanations, focus, and screen-reader
    state announcements.

Observability must include workflow/session ID, item ID, command ID, attempt ID,
artifact/row revision, state transition, validation codes, persistence tier,
latency, retry count, and terminal outcome. Add counters for invalid provider output,
postcondition failure, stale conflicts, recovery, orphan dependencies, and duplicate
commands. Never log confidential row content by default.

## Staged implementation and migration plan

1. **Specify semantics:** approve state chart, invariants, canonical decisions,
   ownership, and product choices below.
2. **Extract pure domain policy:** materialize candidate rows and validate them with
   one versioned API; freeze current UI behavior during extraction.
3. **Build generic workflow aggregate:** implement commands/events, idempotency, and
   domain-adapter contracts in memory with model-based tests.
4. **Introduce durable repository:** IndexedDB/event store, versioning, migrations,
   corruption reporting, and persistence-health UI.
5. **Move mutation behind application service:** add artifact revisions and atomic
   postcondition validation; leave the old callbacks as adapters temporarily.
6. **Move cascades into dependency DAG:** migrate parent/child and downstream state
   out of messages.
7. **Project UI and Review Center from events:** retire message cards as state and
   make cell indicators/read models reproducible.
8. **Migrate active sessions:** import, validate, or quarantine legacy records; keep
   rollback/export tooling.
9. **Run dual-read/shadow validation:** compare old and new policy results without
   dual writes, then cut over by domain.
10. **Remove legacy engines:** only after conformance, recovery, and fault-injection
    suites pass.

## Product-owner design decisions

1. Is Vibe Review advisory, approval-bearing, or both depending on field? Define the
   authority of an explicit human override when evidence remains incomplete.
2. May a reviewer force a policy-invalid classification, and if so must it be stored
   as a separate disposition rather than the engineering classification?
3. Which downstream reviews are mandatory versus optional for each decision type?
4. Does declining a downstream review leave the parent complete-with-stale-data,
   incomplete, or explicitly waived?
5. What is the required retention/export period for decision-level evidence?
6. Must reviews synchronize across devices/users, or is single-browser persistence
   acceptable?
7. How should concurrent reviewers be handled: exclusive lease, optimistic merge,
   or independent reviews requiring reconciliation?
8. What happens when the source artifact is regenerated and stable row IDs disappear
   or change meaning?
9. Can a completed review be reopened, or must changes create a new linked review?
10. What evidence is sufficient for Direct, Related, Mission/Reliability, and Not
    Applicable, and which parts may be human assertions?
11. Should functional changes automatically invalidate linked hazard decisions, or
    only propose invalidation?
12. What durability guarantee must the UI promise before saying “saved”?

## Bottom line

Do not continue solving Vibe Review primarily by adding conditionals to the chat
handler. The next implementation should begin with an approved domain/state-machine
specification and conformance tests. The current implementation can serve as a
behavioral prototype and migration source, but its distributed ownership and mixed
state validation make incremental patching increasingly risky.
