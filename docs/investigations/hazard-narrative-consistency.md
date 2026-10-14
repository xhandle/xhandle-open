# Compact hazard narrative consistency correction

## Root cause

All 89 applicable rows in the supplied 147-row CSV declared Execution Dependency
and Operator Dependency as None. The previous validator only checked evidence for
explicit Overlap/Interactive operator declarations. It compared assessedAction to
the input label but did not check whether the actual UCA changed the action.
Consequently contradictions in UCA/scenario/constraints passed structural checks.

## Implementation

fastHazardSemanticReview.js performs independent batched semantic review of actual
assessment text against source action, target, guide phrase, evidence and context.
It returns only per-row issues, not replacement assessments. The prompt covers
sequential completion vs success, unsupported overlap, unattended viewer obligations,
action drift, visible hypothesis qualification, and quantitative vs Boolean tests.
Narrow local checks reject explicit concurrent execution with a None declaration
and numerical boundaries applied to existence checks before calling the reviewer.

fastHazardPipeline.js invokes review after structural validation and before saving
accepted rows. Only failed rows enter the existing bounded correction mechanism;
accepted rows are checkpointed. Missing/malformed verdicts cannot imply approval.
Review batches have a 12-row/30,000-character target (indivisible rows are preserved),
with short verdict output and bounded split/retry on malformed/truncated responses.
Provider failures stop further work rather than publishing unchecked assessments.
Existing incomplete-run recovery preserves previously accepted work. The active
review heartbeat describes the stage; completion counts advance only after review.

Schema contract v5 isolates previous checkpoints. Saved completed analyses are not
rewritten. Run again to generate and review new assessments. Shared STPA/HARA/FHA
wiring uses the same gate; ratings, explicit applicability, and downstream software
requirement mapping are unchanged. Reviewed No still bypasses model generation.

## Verification and limits

281 tests passed across 26 suites, covering source/context payload, batch bounds,
malformed/duplicate review output, targeted correction, persistent rejection,
checkpoint reuse, cancellation, provider failure and existing workflow compatibility.
Six reduced fixtures retain relevant fields from customer CSV rows 53, 60, 106,
113, 142 and 144. Real local checks reject 60 and 113; semantic-review orchestration
uses mocked model verdicts. Older generation/storage unit tests explicitly mock
semantic review to isolate their original responsibility.

This adds model requests and can increase elapsed time. There is no claim of a
live-model quality benchmark or guaranteed error-free reasoning. The reviewer can
still miss contradictions or raise false positives. Bounded failure remains visible
and recoverable rather than being mislabeled as a complete validated assessment.
