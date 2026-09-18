Implement a durable, end-to-end fix for hazard-analysis Vibe Review downstream regeneration in the current xHandle worktree. Inspect the existing implementation and all uncommitted changes first; preserve and build on them. Do not revert unrelated user work.

Problem demonstrated by RAW-1K8S7C1:
- Before review, Guide Phrase Applicable = Yes, Safety Classification = Needs Review, Safety Significant = Needs Review, with a generated collision/property-damage path.
- The reviewer clicks Mark No for Safety Significant.
- Saving the decision alone is intentionally a first step and must not silently mutate downstream engineering fields.
- The explicit “Regenerate affected row” second step must regenerate the entire derived hazard row coherently. It must not merely patch Safety Significant while leaving stale Needs Review, U4, Uncertain, collision claims, placeholder values, or contradictory dependent fields.

Required workflow and invariants:
1. Keep the explicit two-step workflow:
   - Mark Yes/No saves an auditable governed reviewer decision.
   - Regenerate affected row is the explicit second action that updates downstream engineering content.
2. Full-row regeneration must receive:
   - the complete existing hazard row as evidence;
   - the functional interface and full operational context;
   - the exact guide phrase;
   - the authoritative human-reviewed decision and rationale;
   - relevant organization policy/context.
3. Preserve immutable/source identity fields exactly during regeneration: Raw Analysis Row ID, Function From/details, Control Action/details, Function To/details, subsystem allocation, operational-context identity and fields, and guide phrase.
4. Recompute every derived analytical field as one coherent assessment: losses, hazards, consequence, UCA, causal scenario/factor, classification/rule/path, causal effect/resulting state/intermediate safety function/effect, protections, mitigation, constraint, requirements, ownership, verification, confidence, Safety Significant rationale, and resolution status.
5. Do not copy stale blanks or generic placeholders merely because they existed previously: blank, Unknown, Undetermined, Needs Review, Uncertain, TBD, and similar values must be reconsidered and resolved when the row evidence supports a conclusion.
6. Never invent architecture, authority, safeguards, evidence, or numerical thresholds. When a fact is genuinely unavailable, retain one precise evidence gap in the appropriate field instead of propagating generic uncertainty throughout the row.
7. Safety Significant semantics:
   - Reviewed Yes: final classification must be Safety — Direct or Safety — Related, with matching D/R rule and Direct/Contributory path. Unknown protection status cannot by itself force Needs Review when the harm path is otherwise grounded; record the protection as Unknown separately.
   - Reviewed No while Guide Phrase Applicable = Yes: final classification must be Mission/Reliability with a matching M rule and Causal Path Type None. Do not set the entire row from Loss onward to Not Applicable. Regenerate coherent non-safety mission/reliability consequences, controls, requirements, and verification when supported. If the prior physical-harm narrative conflicts with the reviewer’s No, rewrite derived content consistently while retaining an auditable note that the human disposition overrode the prior generated safety interpretation; do not leave stale collision/harm assertions that contradict the final classification.
   - Guide Phrase Applicable = No: derived hazard-analysis fields should be coherently Not Applicable, while identity, applicability decision/rationale, and audit provenance remain intact.
8. A reviewed Yes or No must never finish explicit regeneration with Safety Classification = Needs Review or Classification Resolution Status = Needs Review solely because the previous generated row contained those values.
9. Persist a real before/after audit record: originalContent must be the pre-regeneration row, currentContent the regenerated row, reviewer/date/provenance retained, and field-level changes available to the review history and completion message.
10. Ensure resumed existing review sessions use the same behavior; a fresh review must not be required.
11. Apply the same invariant wherever project hazard rows are regenerated from a Vibe Review decision. Do not broaden this into unrelated redesign.

Implementation expectations:
- Trace the actual generation, normalization, alignment, reconciliation, persistence, and Collaborator-card paths; do not rely on prompt wording alone where deterministic postconditions are appropriate.
- Add focused deterministic helpers where useful.
- Add regression tests for at least:
  a) reviewed No + applicable Yes fully reconciles to Mission/Reliability and clears stale safety-classification/path/intermediate values without turning the whole row Not Applicable;
  b) reviewed Yes produces a coherent Safety subtype even with Protection Status Unknown;
  c) applicability No produces coherent Not Applicable downstream treatment;
  d) immutable identity/context fields survive regeneration;
  e) before/after audit evidence is genuinely different and field changes are reported;
  f) full existing row evidence and the reviewed decision are supplied to regeneration;
  g) existing/resumed sessions do not require a new review.
- Run the smallest relevant test suites, then a production build if practical. Report files changed, behavior, tests, and any remaining evidence-bound limitation.
