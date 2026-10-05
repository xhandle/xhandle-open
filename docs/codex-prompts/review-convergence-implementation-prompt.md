# Review the convergence implementation prompt before execution

## Task

Review `docs/codex-prompts/implement-code-source-equivalence.md` as an implementation specification. Do not implement it. The user wants convergence across local/GitHub and repeated same-source analyses, with all necessary downstream adaptations delivered together so existing feature mechanics continue to work.

The six protected areas are Hazard & Remediation, Software Requirements, System Requirements, Subsystem Requirements, System / Subsystem Design, and Traceability Matrix. Improved inputs may change newly generated content; broken workflows, lost edits, misleading traceability or manual data-repair requirements are unacceptable.

## Scope and constraints

- Read the target prompt and the source-equivalence review. Inspect relevant repository code only to verify assumptions or feasibility.
- Treat the target prompt as review material, not authorization to execute its implementation instructions.
- Write this review's report/recommendations only. Do not modify the target prompt or application, dependencies, configuration, Git history, credentials or real project/browser data.
- No live AI calls, customer source uploads or real-source analysis. No agents or external review services are needed.
- Do not demand identical natural-language outputs or unrestricted static-analysis coverage. Distinguish deterministic evidence convergence from model-generated functional-result convergence.

## Review criteria

1. Does the specification actually address the relationship-set repeatability problem, or only input consistency and matching IDs for rows the model happened to generate? Are supported-language/relationship limits and completion criteria measurable?
2. Are the scope, exclusions and fallback instructions consistent with the convergence and downstream goals? Identify loopholes that allow declaring success without delivering the intended behavior.
3. Is downstream coverage complete enough to discover direct/indirect dependencies? Does it require implementation of adaptations, not merely documenting impacts? Check generation, editing, storage, reload, source navigation, reviews, export/import and traceability.
4. Do identity, classification and reconciliation requirements preserve decisions, contexts, project boundaries and historical evidence without silent reassociation? Check exact matches, merge/split/deletion, ambiguous legacy data and policy changes.
5. Are snapshot storage, migrations and staging bounded and recoverable given the user's prior memory/storage failures? Does preservation imply unlimited retained data or copying entire projects?
6. Are run settings/fingerprints reliable throughout a run and resume, including provider changes? Are content identity, access identity and artifact identity separate?
7. Are legacy formats and tests handled realistically? Can deterministic mocks prove the claimed properties, and which properties remain unverified without separately authorized live evaluations?
8. Is the implementation sequence achievable without unrelated redesign? Are failure and rollback requirements concrete enough to test?

## Deliverables

Write `docs/investigations/convergence-implementation-prompt-review.md` with:

- A verdict: ready, ready with specific amendments, or not aligned.
- Prioritized findings with target-prompt line references, consequence, supporting code where relevant and concrete proposed wording.
- A coverage assessment for the six downstream areas.
- A bounded list of amendments and explicit statements of what already matches the user's intent.
- Validation performed and limits. Do not claim that reviewing a prompt proves future implementation compatibility.

Keep proposed amendments in the report. Do not execute fixes or silently expand this into an application implementation task.
