# Implement sequenced review cascades

Implement a generalized, durable review-cascade workflow for xHandle's hazard-analysis and functional-decomposition Vibe Reviews.

## Objective

When an accepted review decision creates an upstream or downstream impact, automatically determine and queue the required follow-up assessments in dependency order. Do not leave users to discover hidden prerequisites or manually infer the next review.

## Governing principles

- Persist the accepted governed decision before creating follow-ups.
- Automatically update only deterministic derived values.
- Every consequential engineering judgment remains an AI proposal until explicitly accepted or overridden by a reviewer.
- Scope follow-ups to actually affected stable row/artifact IDs.
- Preserve source evidence, prior decisions, and cascade provenance.
- Deduplicate equivalent follow-ups and prevent dependency cycles.
- Persist the entire cascade so pause/resume and browser restart are safe.
- Support `Review now`, `Queue for later`, and `Dismiss as unaffected` where appropriate.

## Hazard dependency order

Use this sequence where applicable:

1. Guide Phrase Applicable
2. Safety Significant
3. Safety Classification (`Safety — Direct` versus `Safety — Related`, or the governed non-safety result)
4. Regenerate affected row with all upstream decisions locked
5. Validate classification consistency/resolution
6. Regenerate consolidated Safety Issues

Important behavior:

- A `Safety Significant = Yes` decision automatically creates a focused Direct-versus-Related follow-up assessment.
- `Safety Significant = No` deterministically constrains classification to `Mission/Reliability` unless applicability is No, which constrains it to `Not Applicable`.
- Unknown protection effectiveness remains protection evidence and does not block Direct/Related when the causal path is otherwise established.
- Do not silently save an AI classification proposal.

## Functional-decomposition dependency order

Use this sequence where applicable:

1. Apply accepted function/interface revision
2. Review allocation and interface-direction integrity
3. Identify affected hazard rows by stable interface identity
4. Queue affected hazard applicability/significance/classification reviews
5. Regenerate affected constraints, requirements, and verification evidence
6. Validate traceability

## UX

- Present a compact cascade card showing the trigger, current step, queued steps, and reason for each step.
- Present every potential downstream review as a separately selectable item. The reviewer may select any subset from one item through all items, use Select all/Clear all, or explicitly skip all downstream reviews.
- Do not treat listing an impact as permission to apply it. `Review selected` queues only the selected assessments in dependency order; every consequential proposal still requires its normal reviewer confirmation.
- Persist selected, skipped, queued, active, and completed status for every offered downstream review so reload, pause/resume, and Review Center display the same choice and provenance.
- Record an explicit skip-all disposition without changing downstream engineering fields, and continue to identify those artifacts as stale where applicable.
- Never show actions that cannot currently be applied because a prerequisite is unresolved.
- When a prerequisite completes, resume the parent review at its saved position.
- Make automatic transitions understandable with concise messages.

## Implementation constraints

- Build a reusable pure dependency planner/state model rather than hard-coding transitions in React handlers.
- Maintain backward compatibility with existing saved Vibe Review sessions and review-center items.
- Integrate with the existing downstream-regeneration cards instead of creating competing workflows.
- Add regression tests for ordering, deduplication, cycle prevention, pause/resume serialization, Yes -> Direct/Related follow-up, No -> deterministic classification, and functional-review impacts.
- Add UI and state-model regression tests for arbitrary subsets, Select all/Clear all, skip-all, and preservation of dependency order after selection.
- Run relevant tests and a production build.
- Do not commit or push.
