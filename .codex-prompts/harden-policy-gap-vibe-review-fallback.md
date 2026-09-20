# Harden policy-gap Vibe Review fallback behavior

Fix Classification Resolution Status Vibe Reviews when the selected AI model omits `normalizedDecision`, including after repair.

Requirements:

- Never render an invalid `Needs Review` object as an actionable proposed classification.
- Disable/hide Accept Proposal unless the normalized policy-gap proposal is valid.
- Use classification-specific failure copy and actions; never instruct users to Mark Yes/No during a classification-resolution review.
- When the validator proves that a `Safety — Direct` row already depends on a substantive named intermediate safety function and effect, deterministically reconcile it to `Safety — Related`, `Contributory`, and an `R1-R4` rule using only existing row evidence.
- Do not apply deterministic repairs when required evidence is missing or when more than the safely repairable contradiction remains.
- Explicit manual classification buttons remain human dispositions and may leave an evidence gap.
- Preserve governed Guide Phrase Applicable and Safety Significant decisions.
- Add focused regression tests and run the focused suite and production build.

Preserve unrelated working-tree changes.
