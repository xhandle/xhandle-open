# Separate Safety Classification vibe reviews from Safety Significant reviews

Work in `/Users/Nick/xhandle-open`.

## Observed defect

The user requests:

`lets vibe review safety classification=needs review`

The application correctly finds rows whose `Safety Classification = Needs Review`, but then silently starts the binary `Safety Significant` review workflow. The cards display `Existing Safety Significant`, propose `Yes`/`No`, save a governed Safety Significant decision, and offer downstream regeneration as though that field was requested.

This can conflict with prior authoritative review evidence. A concrete matched row already had governed `Safety Significant = No`, yet the classification review proposed `Yes · Safety — Direct` and argued that the prior human decision should be overturned. A Safety Classification review must never change or challenge governed applicability or safety-significance decisions.

## Goal

Implement `Safety Classification` as its own first-class hazard vibe-review target with its own scope parsing, proposal contract, UI actions, persistence, audit data, pause/resume behavior, and completion summary.

Do not alias it to `safetySignificant`.

## Authoritative constraints

Classification proposals must obey existing governed decisions:

1. `Guide Phrase Applicable = No`
   - Only valid classification: `Not Applicable`.

2. `Guide Phrase Applicable = Yes` and governed `Safety Significant = No`
   - Only valid classification: `Mission/Reliability`.
   - The proposal may explain that contradictory physical-harm language requires downstream reconciliation/regeneration.
   - It must not propose changing Safety Significant to Yes.

3. `Guide Phrase Applicable = Yes` and governed `Safety Significant = Yes`
   - Valid classifications: `Safety — Direct` or `Safety — Related`.
   - Direct versus Related must follow the existing canonical policy and intermediate-chain evidence.

4. Safety significance is not governed Yes/No
   - Use row evidence to propose a classification only when policy supports one without silently creating a governed Safety Significant decision.
   - If classification depends on an unresolved safety-significance disposition, present a precise evidence/dependency gap and allow skip. Do not mutate Safety Significant.

5. Unknown safeguards
   - May remain an explicit evidence gap.
   - Must not contradict an already governed classification constraint.

## Proposal/UI behavior

For a `Safety Classification` review:

- Card label must say `Existing Safety Classification`.
- Proposal must identify one classification value, its canonical rule, causal-path type, rationale, and confidence.
- Valid decision buttons/actions should be classification-specific. At minimum support:
  - Accept proposal
  - Mark Safety — Direct
  - Mark Safety — Related
  - Mark Mission/Reliability
  - Mark Not Applicable when permitted by applicability
  - Skip for later
  - Undo last decision
  - Pause review
  - Stop review
- Do not display generic `Mark Yes` / `Mark No` for this target.
- Saving a classification decision changes only the governed classification fields required for internal consistency:
  - `Safety Classification`
  - `Safety Classification Rule`
  - `Causal Path Type`
  - classification rationale/evidence fields as appropriate
- It must not modify:
  - `Guide Phrase Applicable`
  - `Guide Phrase Applicability Rationale`
  - `Safety Significant`
  - `Safety Significance Rationale`
- The downstream-impact card must describe a reviewed Safety Classification decision, not a Safety Significant decision.

## Parsing and scope

- Requests explicitly naming `Safety Classification` must select a distinct review target such as `safetyClassification`.
- Preserve existing `Safety Significant` behavior for requests explicitly naming that field.
- Preserve exact filter semantics, including `Safety Classification = Needs Review`.
- Snapshot and resume queues by Raw Analysis Row ID using the distinct target.

## Persistence, audit, and regeneration

- Persist the distinct review target and selected classification in session data and review history.
- Pause/resume and restored threads must retain the target and classification-specific controls.
- Completion summaries must report classification changes, not changed-to-Yes/No counts.
- Before/after history must show the classification, rule, causal path, reviewer, timestamp, and rationale.
- Downstream regeneration may be offered as a second explicit step, but it must treat the reviewed classification as governed and must not overwrite it or the existing applicability/safety-significance decisions.
- Route any regenerated row through the existing centralized final persistence normalizer.

## Compatibility

- Migrate or safely interpret legacy sessions that lack the new target without corrupting them.
- Do not change existing Guide Phrase Applicable and Safety Significant review behavior except where needed to keep target routing distinct.
- Preserve unrelated working-tree changes.
- Do not commit or push.

## Regression tests

Add focused tests proving:

1. `Safety Classification = Needs Review` parses to the distinct classification target, not `safetySignificant`.
2. The rendered proposal uses `Existing Safety Classification` and classification-specific actions.
3. Governed Safety Significant No constrains the proposal to Mission/Reliability and cannot be overwritten.
4. Governed Safety Significant Yes permits Direct or Related based on the intermediate causal chain.
5. Applicability No constrains classification to Not Applicable.
6. Applying a classification decision leaves Guide Phrase Applicable and Safety Significant—including their rationales—byte-for-byte unchanged.
7. Accept, explicit classification selection, undo, pause, resume, restored thread, and completion summary preserve the distinct target.
8. Audit/history captures before/after classification, rule, causal path, rationale, reviewer, and timestamp.
9. Downstream regeneration preserves all three governed layers: applicability, safety significance, and safety classification.
10. Existing Guide Phrase Applicable and Safety Significant tests remain green.

Run focused review/proposal/session/Collaborator/history/regeneration tests, `git diff --check`, and the production build. Report files changed, exact tests and results, and genuine limitations.
