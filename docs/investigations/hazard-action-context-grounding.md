# Action and context grounding follow-up

Implemented the prompt in `docs/codex-prompts/ground-hazard-action-context.md`.

## Findings and changes

The results-first prompt had abbreviated action/context rules. Screening did not explicitly distinguish the current operation's duration from downstream duration or prohibit invented review obligations. Shared `hazardGroundingRules.js` now supplies both active prompts with operation/target boundaries, unattended-context constraints, and consistent conditional treatment of unproven mechanisms. Examples cover elaboration versus simulation and command acknowledgement versus pumping duration; there are no repository-specific replacements or verdicts.

A deterministic precedence defect also existed: `compactHazardSources` copied any old applicability rationale into `reviewedRationale`, including unreviewed AI Yes assessments. Generation preferred that string to the new screening rationale. Only governed applicability decisions now carry reviewedRationale. All No decisions and explicitly Reviewed Yes decisions remain preserved, as before.

Versioned generation checkpoints to v7 and screening checkpoints to v2 so cached AI outputs from older prompts do not bypass the revised instructions. Existing published results and user-governed input are not rewritten. Existing exclusions remain exclusions. A new generation is needed to observe changed model behavior.

No extra model calls, output fields, semantic rejection gates, batch-size changes, rating changes, storage changes, or requirement-generation changes. The legacy reviewed pipeline is still retained; only its shared source adapter receives the rationale correction.

## Validation

- Hazard-analysis directory: 32 suites, 278 tests passed.
- Downstream requirements, HARA/FHA workflow and CSV compatibility: 4 suites, 84 tests passed.
- New tests exercise all three active methods with source target/details/context carried to both stages, refreshed screening rationale precedence, No exclusions, governed Yes/No preservation, and no blocking narrative review.
- `git diff --check` passed.

These are deterministic and mocked-request regressions, not live-model quality evaluations. They establish correct prompt/data wiring and preserve execution mechanics; they do not guarantee every generated narrative is correct. The customer's saved CSV has not been altered, and no paid provider run or browser smoke test was performed.
