# Hazard completion guarantee audit

Verdict: the current implementation does NOT meet the requested guarantee.
Reviewed the current working tree, including the uncommitted fallback changes.
This review adds characterization tests and documentation, not production fixes.

## Findings

1. **P1 — Fallback is still a rejecting path.**
   assumptionHazardFallback.js:43 copies retained rating values, and :54-55 validates
   the fallback and throws. The same validator rejects unresolved words anywhere
   in the locked rationale. Reproduced across STPA, HARA and FHA with reviewed Yes,
   rationale "Timing applies; needs review of the deadline.", and provider failure:
   three attempts are made, then the run rejects COMPACT_HAZARD_INCOMPLETE with zero
   completed rows. Also reproduced invalid retained HARA S9 and FHA SCC 9 preventing
   fallback completion. Contradictory reviewed classification/significance is an
   existing tested rejection too.
   Follow-up: preflight governed inputs before starting and distinguish a locked
   applicability decision from incidental unresolved words in explanatory text.
   Preserve original governed input; do not silently replace it to claim completion.
   Make the supported local fallback contract total for accepted inputs.

2. **P1 — Final merge can reject after generation without publishing the new result.**
   fastHazardRunner.js:123-126 reconciles human imports and validates them;
   :161 calls buildRun outside the generation recovery try/catch and before :163
   publishes the completed in-memory run. Reproduced by retaining an imported
   Software Safety Requirement reading "The software shall enforce the limit;
   needs review of the threshold." Generation runs, final merge throws
   "Imported assessment", and neither publication nor saving is called.
   A plain "Needs Review" cell does NOT reproduce this: the preprocessing recorder
   excludes that exact placeholder. The qualified sentence is accepted by that
   recorder but rejected by final validation.
   Follow-up: validate merge constraints before spending provider requests, and
   protect completed assessments with a separate assembly/publication recovery
   path. Keep original human input separate from any proposed replacement.

3. **P1 — Switching project/repository cancels the run without a browser restart.**
   App.js:14451-14456 aborts the active controller whenever the active code
   project/repository changes. :14476 also aborts a prior run when starting another.
   This is distinct from deliberate Stop at :14458. Confirmed by code inspection;
   no live browser navigation test was performed.
   Follow-up: project/repository-scoped background run ownership independent of
   the displayed project, with explicit Stop scoped to the chosen run.

4. **P2 — Auxiliary callbacks can turn successful work into rejection.**
   resultsFirstHazardPipeline.js:161 invokes onMetrics in finally without isolation.
   Fault injection across all three methods reproduced a thrown metrics callback
   replacing a successful return after one successful provider request. Similar
   unguarded progress/diagnostic/publication callbacks exist. This is an injected
   failure surface, not evidence that the customer's console currently throws.
   Follow-up: isolate telemetry/UI callback errors from generation; ensure result
   publication has a retained run record independent of observer success.

5. **P2 — Activity can remain running after results are available.**
   App.js:14549 awaits resultsReview.createReviewItems before finishActivity and
   clearing the running state. ResultsReviewProvider.js:115 awaits its persistence
   queue; reviewStore.js:72-91 has unbounded open/transaction awaits. A storage stall
   here can leave the activity running even though all hazard rows were generated,
   published and saved. Static finding; distinct from lost/incomplete hazard rows.
   Follow-up: complete the hazard activity first and register review items through
   a bounded independent task.

## What is already protected

- STPA, HARA and FHA dispatch through the shared results-first runner.
- Recoverable provider/parse/structural failures exhaust bounded passes then use
  local assumption-based assessments; provider 401/402/403/404 can complete locally.
- Reviewed No is excluded; successful accepted results are reused.
- Missing applicability evidence can become an assumption-based inclusion.
- Checkpoint reads and writes have deadlines; storage aborts do not cancel generation.
- Actual final hazard saving is bounded inside codeArchitectureHazardStore.js:
  five seconds, with unsaved memory retention. The raw await in fastHazardRunner
  is therefore NOT itself evidence of an unbounded hazard-save operation.
- Provider transport has a deadline through body consumption and distinguishes
  caller cancellation from network interruption.
- Existing tests cover CSV/storage round trips, ASIL/SWCI derivation and downstream
  software-requirement linkage for fallback assessments.

## Other boundaries

Deliberate Stop remains effective. Programming errors, corrupt/unsupported inputs,
unmatched preprocessing, browser/process termination and resource exhaustion are
not covered by an absolute completion guarantee. No run-level supervisor currently
owns a final result independently of all assembly/UI failures. Tests demonstrate
specific behavior, not a mathematical guarantee or a live-provider time bound.

## Validation

Added hazardCompletionAudit.test.js with eight counterexample cases (three methods
for locked rationale rejection, three for telemetry exceptions, HARA/FHA rating
conflicts). Added one real-runner imported-requirement publication counterexample.
These tests intentionally assert current failing-to-complete behavior, so passing
them confirms the gaps rather than closing them. Ran the full hazard-analysis
test directory and aiAnalysisSTPA transport suite. See final response for totals.

No customer data changed; no live paid analysis, commit or push performed.
