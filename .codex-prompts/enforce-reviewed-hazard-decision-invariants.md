# Implement durable reviewed hazard-decision invariants

Work in `/Users/Nick/xhandle-open`.

## Problem

Hazard vibe review can persist contradictory rows after downstream regeneration. A concrete failure has:

- `Guide Phrase Applicable = Yes`
- governed `Safety Significant = Yes`
- documented collision/property-damage causal path
- but `Safety Classification = Needs Review`
- and the final classification-resolution status remains `Needs Review`

The human-reviewed decision is authoritative. Unknown or missing safeguard evidence may remain explicitly recorded, but must not reverse or block a governed Yes/No disposition. The earlier regeneration changes improved prompt context and reconciliation but have not reliably enforced this at the final persistence boundary.

## Goal

Implement one centralized, deterministic post-regeneration validator/normalizer that runs immediately before regenerated hazard rows are persisted. Every regeneration path—including resumed reviews—must use it. Do not merely adjust prompt wording.

## Required invariants

For an applicable guide phrase:

1. Governed `Safety Significant = Yes`
   - Resolve classification to `Safety — Direct` or `Safety — Related` from row evidence.
   - Never persist `Needs Review`, `Mission/Reliability`, blank, or `Not Applicable` as the safety classification.
   - Classification rule and causal-path type must agree with the selected subtype.
   - If evidence does not support a substantive intermediate contribution chain, choose Direct.
   - Unknown protection/safeguard evidence may stay `Unknown`/unresolved in its own evidence fields, but cannot make the governed classification unresolved.
   - Physical-harm/loss/hazard identifiers and narratives must be coherent with the selected safety subtype. Do not retain mission-only hazard identifiers alongside an explicit collision/physical-harm path.

2. Governed `Safety Significant = No`
   - Resolve classification to `Mission/Reliability`.
   - Use a matching mission/reliability rule and causal-path type `None`.
   - Remove or rewrite stale affirmative physical-harm-chain claims and safety-only loss/hazard identifiers.
   - Do not indiscriminately erase still-applicable engineering mitigations, requirements, or verification content.
   - Never persist a final `Needs Review` classification.

3. Governed `Guide Phrase Applicable = No`
   - Resolve downstream hazard and safety analysis fields to `Not Applicable` using the existing product policy.

4. Governed decision provenance
   - Preserve the human decision, reviewer name, rationale/evidence, reviewed timestamp, row identity, source identity, and review-session identity.
   - Regeneration must not overwrite a governed Yes/No with model output.

5. Final resolution
   - A row with a governed Yes/No decision must not finish regeneration with classification or final resolution equal to `Needs Review` merely because safeguards are unknown.
   - If output cannot be made coherent without inventing evidence, preserve the evidence gap in the appropriate evidence fields and choose the deterministic classification required above.

## Architecture requirements

- Locate every project hazard-row regeneration persistence path and route it through the same validator immediately before state/storage persistence.
- Avoid parallel ad hoc normalizers in UI handlers.
- Reuse the project’s canonical column names and existing safety model helpers.
- Make the validator pure and directly unit-testable.
- Preserve unrelated behavior and existing user changes.
- Do not commit or push.

## Regression tests

Add focused tests proving at minimum:

1. The supplied pattern—applicable Yes, reviewed safety Yes, collision/property-damage narrative, generated `Needs Review`, mission-only hazard identifier, and unknown/absent safeguard—persists as a coherent safety classification and not `Needs Review`.
2. Reviewed safety Yes with a real intermediate contribution chain resolves Related; without one resolves Direct.
3. Reviewed safety No removes contradictory physical-harm classification/identifiers and resolves Mission/Reliability without blanketing all engineering controls as N/A.
4. Applicability No resolves downstream fields N/A.
5. Unknown safeguard evidence remains represented but does not alter the governed classification.
6. Resumed review regeneration uses the same validator.
7. Row identity and governed-decision provenance are unchanged.

Run the relevant focused test suites, `git diff --check`, and the production build. Report the exact files changed, tests run, results, and any genuine remaining limitation.
