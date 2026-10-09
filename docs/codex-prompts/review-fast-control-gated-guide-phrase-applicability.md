# Review fast, built-in control-action guide-phrase applicability screening

## User objective

Users currently export the Code-Based Architecture Functional decomposition, ask ChatGPT to preprocess guide-phrase applicability, and import the reviewed CSV into xHandle. The user asks ChatGPT to focus applicability on relationships that represent actual commands and controls. They want this screening to be effective and fast inside xHandle so the manual export/preprocess/import step is unnecessary.

Perform a read-first, read-only review of the current implementation and recommend the smallest safe implementation plan. Do not implement application changes, run paid AI calls, modify user data, commit, or push. Preserve unrelated changes. Do not claim ChatGPT-equivalent latency without measured evidence.

## Trace the real execution path

1. Trace the Code-Based Architecture UI's selected STPA method through source selection, eligibility, guide-phrase/context expansion, applicability decisions, downstream UCA generation, classification, validation, checkpoints, persistence, and table rendering. Distinguish STPA-Textbook from legacy aliases.
2. Verify that the generated Functional model is used when available. Explain the fallback when it is unavailable, and whether screening uses more detailed CSU rows unnecessarily.
3. Identify every existing applicability or control-action screening step. Is it an independent early pass, part of the expensive hazard prompt, repeated per guide phrase/context, or performed after downstream work has already been scheduled?
4. Compare the Projects-area STPA first pass with the Code-Based Architecture path. Identify reusable logic and actual differences; do not assume a shared engine means identical screening or performance.
5. Trace preservation of imported/user-reviewed applicability, the authoritative persisted decision, explicit review actions, continue/regenerate behavior, context edits, and reloads. Check how automatic AI assessments are distinguished from human-accepted decisions.

Starting points (follow their callers and dependencies):

- `src/App.js`
- `src/features/code-architecture-hazard-analysis/codeArchitectureHazardRunner.js`
- `src/features/code-architecture-hazard-analysis/codeArchitectureHazardPreprocessing.js`
- `src/features/code-architecture-hazard-analysis/codeArchitectureHazardEligibility.js`
- `src/features/code-architecture-hazard-analysis/codeArchitectureHazardUtils.js`
- `src/components/aiAnalysisCodeHazardStandard.js`
- `src/components/aiAnalysisSTPA.js`
- `src/components/applicabilityGovernance.test.js`
- `docs/investigations/stpa-projects-code-architecture-comparison.md`, if present. Verify prior findings against current code.

## Assess the screening criteria

Evaluate a two-stage screening design rather than assuming every function/method call is an STPA control action:

1. **Relationship qualification:** Does the source function actually issue a command/control to a recipient or controlled process in the supplied operational context? Determine the requested behavior or state change, sender/controller, recipient, and supporting evidence. Distinguish actual control from ordinary computation, data transformation, passive observation, getters, logging, and internal implementation calls. A row labeled “Control Action,” a verb-like name, or a source-code call is not sufficient by itself. Conversely, software-to-software, configuration, authorization, scheduling, and mode-change commands may be controls; do not require physical actuation or repository-specific keywords.
2. **Per-guide-phrase applicability:** For a qualified action, determine whether EACH supported guide phrase is meaningful for that action in that context. Command status does not make all timing, ordering, omission, or duration phrases automatically applicable. Explain the action semantics and evidence needed for each decision.

Use sufficient Functional details, source/target responsibilities, known interface semantics, and operational context. Identify where evidence is missing instead of guessing. Keep ambiguous cases explicitly unresolved rather than silently excluding them or defaulting every row to Yes. Explain a reviewable policy for clearly non-control relationships and whether existing exclusions already handle them.

Keep applicability separate from whether an action causes a hazard, is safety significant, is mission/reliability-only, has sufficient evidence, or has completed analysis. An applicable guide phrase need not be safety significant. Do not use safety classification to rewrite applicability.

## Required invariants

- Accepted human-reviewed Yes/No values and rationales survive screening, generation, classification, regeneration, persistence, and CSV round trips. Only an explicit applicability-review action may change them.
- `Guide Phrase Applicable = No` skips downstream UCA/hazard generation for that row regardless of review status. Assess every scheduling/retry path, not just final output filtering.
- `Yes` permits downstream processing without allowing it to mutate applicability.
- `Needs Review` in applicability denotes unresolved applicability only; downstream uncertainty belongs in its own field.
- Excluded and unresolved records remain traceable; reduced AI workload must not silently delete decomposition rows or export records.
- Context/source changes must not silently reuse obsolete automatic assessments or erase accepted human decisions. Propose provenance and explicit review handling for invalidated decisions.
- Decisions and caches remain isolated by project, repository, source revision, relationship identity, guide phrase, context, and screening-policy version as appropriate. Shared names or row indices must not transfer decisions between projects.

## Investigate latency and unnecessary work

Measure or deterministically instrument current scheduling using fixtures/mocked AI; distinguish measured timings and counts from provider-dependent estimates. Report:

- Unique Functional relationships versus expanded relationship × guide-phrase × context rows.
- When exclusions happen relative to expensive hazard calls.
- Repeated context/source payloads, repeated assessment of the same relationship, batch sizes, concurrency, token volume, output shape, retries, and duplicate validation calls.
- Whether qualification can run once per relationship/context and produce a compact per-guide-phrase decision map, before hazard generation is scheduled.
- Whether a separate first pass can return only stable IDs, applicability, concise rationale, and necessary provenance rather than full hazard/requirements fields.
- How unchanged assessments can be reused and incomplete batches resumed without overwriting human decisions or crossing project boundaries.
- Whether UI work/persistence contributes materially to perceived latency; progress should report real screening and downstream work separately.

Do not recommend raising concurrency or using a different model blindly. Account for provider limits, response truncation, retries, cancellation, and false exclusions. Do not obtain speed by bypassing validation, dropping uncertain rows, or reducing hazard reasoning quality. Clarify whether screening should run automatically before hazard generation, optionally be previewable independently, or reuse an existing control; avoid requiring another mandatory manual step.

## Verification

Run relevant existing tests and add isolated review diagnostics where needed. Cover at minimum:

- A clear command/control relationship with meaningful guide phrases.
- A pure calculation/data transformation that should not qualify solely because it is a call.
- A software-only mode/configuration/authorization command that must not be excluded merely because it is not physical actuation.
- An instantaneous action for which duration-related phrases are not meaningful, versus a sustained action where they are.
- Insufficient evidence and context-dependent applicability.
- Reviewed Yes/No preservation and No skipping irrespective of review status.
- Functional-source preference, context changes, resume, regeneration, and project isolation.
- A representative large fixture showing actual first-pass/downstream request counts and avoided work.

Use repository-neutral examples spanning more than one language/domain. Do not treat AI-generated labels as ground truth. If comparing against the user's preprocessed CSV, use it only if available and explicitly identified; otherwise note that equivalence to their ChatGPT decisions has not been validated.

## Deliverable

Write `docs/investigations/fast-control-gated-guide-phrase-applicability-review.md` containing:

1. Current behavior and criteria, with function/file/line references.
2. Where it differs from the user's command/control-focused preprocessing.
3. Measured scheduling/request counts, likely latency drivers, and measurement limitations.
4. Severity-ranked defects or design gaps, separating reproduced findings from inference.
5. A concrete, minimal implementation plan with affected components, decision schema/provenance, preservation rules, tests, and rollout considerations.
6. Expected user-visible behavior: built-in screening, fewer irrelevant downstream rows, preserved review decisions, and honest performance expectations.

Conclude whether the existing implementation can deliver this workflow with a focused change or needs a separate screening stage. This is a review and implementation-plan task, not authorization to change production behavior.
