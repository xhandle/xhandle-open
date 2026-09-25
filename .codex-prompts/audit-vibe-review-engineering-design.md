# Comprehensive engineering-design audit of the Vibe Review capability

Perform a read-only, evidence-based review of the current xHandle Vibe Review
implementation. Do not implement fixes. Treat the capability as a safety-relevant,
long-running workflow rather than a chat feature.

Review both hazard-analysis and functional-decomposition Vibe Reviews, including
their shared infrastructure and Review Center representation.

## Required analysis

1. Reconstruct the implemented architecture and end-to-end data flow:
   intent parsing, scope resolution, naming, queue snapshotting, proposal generation,
   validation, user disposition, persistence, row mutation, downstream review
   cascades, regeneration, audit/evidence capture, pause/resume/recovery, completion,
   Review Center navigation, and cell-impact indicators.
2. Define the actual state machines from code and identify implicit, duplicated, or
   contradictory states and transitions.
3. Identify every source of truth for session state, row state, governed decisions,
   derived classifications, downstream work, UI cards, and review evidence. Flag
   ownership ambiguity and stale-state hazards.
4. Assess invariants and transaction boundaries, especially:
   - exactly-once decision application and cursor advancement;
   - immutable queue identity and stable row IDs;
   - proposal validity versus manual disposition;
   - governed versus generated/derived fields;
   - atomic updates of mutually dependent columns;
   - post-write validation before success or advancement;
   - sequential parent/follow-up reviews;
   - cancellation, retries, concurrent edits, refresh, storage failure, and model
     format failures.
5. Review failure handling and user-facing semantics. Identify messages or controls
   that can claim success, offer invalid actions, hide prerequisites, loop, advance
   prematurely, or leave the user without a recoverable next action.
6. Review persistence and storage behavior for schema/versioning, migrations,
   corruption, quota exhaustion, cross-project/thread collisions, restart recovery,
   and referential integrity with source artifacts.
7. Review AI boundaries: prompt contracts, provider normalization, deterministic
   fallbacks, validation, confidence/evidence handling, retries, and prevention of
   model output becoming approved engineering evidence without explicit governance.
8. Review downstream-impact design and regeneration for dependency modeling,
   ordering, user selection, idempotency, stale data, and completion summaries.
9. Review tests and observability. Map existing coverage and identify missing unit,
   integration, state-machine/model-based, persistence, concurrency, fault-injection,
   and end-to-end tests.
10. Assess maintainability, coupling, accessibility, and performance where they can
    affect correctness.

## Required deliverable

Return a design-audit report suitable as input to a separate formal design
specification. Include:

- Executive assessment and risk rating.
- Current architecture and data-flow narrative.
- State-machine reconstruction.
- Source-of-truth/ownership matrix.
- Ranked findings with severity, likelihood, user impact, concrete code evidence,
  and recommended design direction (not patches).
- Required invariants and acceptance criteria.
- Recommended target architecture and component boundaries.
- Recommended canonical domain model and event/command model.
- Persistence, concurrency, recovery, and migration requirements.
- AI contract and deterministic-policy requirements.
- Test strategy and observability requirements.
- A staged implementation/migration plan.
- Explicit open design questions and decisions the product owner must make.

Clearly distinguish verified code facts from inferences. Cite repository-relative
file paths and line numbers. Do not rely on prior conversation claims when they are
not supported by the current repository. Do not edit application files, commit, or
push.
