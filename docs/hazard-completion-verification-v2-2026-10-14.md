# Completion verification after the gap fixes

Verdict: **not yet guaranteed**. Two reproducible completion defects remain without
any refresh, restart, deliberate cancellation, or injected programming exception.
This is a review of the current working tree; production code was not changed.

## P1: Screening and final publication disagree about accepted rationale text

Locations:
- fastHazardApplicability.js:10 accepts Yes/No with a nonempty rationale, excluding
  only a subset of unresolved wording.
- resultsFirstHazardPipeline.js:69 stores excluded rows directly as completed.
- fastHazardSchema.js:15,47 applies a broader unresolved-text check.
- fastHazardRunner.js:142 reconstructs sources from the original input, without
  the accepted screening rationale; :185 builds before :187 publishes.

Reproduction for each of STPA, HARA and FHA: return No with rationale
"Not a command; downstream timing is to be confirmed." Screening accepts it.
The actual runner performs one provider request, reaches final assembly and throws
"Imported assessment". Neither final publication nor saving occurs. There was no
import in this case: the error label is misleading.

The new reconciliation recovery copies the originally generated row back into
the sheet, but that row contains the same rejected rationale. Recursive final
validation still throws. Therefore this is not fixed by the row-level merge
recovery.

Smallest robust follow-up: use a shared accepted-row contract from screening to
publication, preserving the No decision and its provenance; distinguish unresolved
applicability from incidental unresolved wording in supporting text. Carry the
accepted screening metadata through final validation. If a generated field truly
requires repair, replace that field under explicit assumptions instead of copying
the same invalid row into the validator again.

## P1: Imported rating-rationale cleanup is weaker than fallback validation

Locations:
- hazardCompletionSupport.js:13 checks a subset of unresolved wording.
- assumptionHazardFallback.js:43-44 retains rating-rationale strings.
- assumptionHazardFallback.js:60-61 validates and throws.
- fastHazardSchema.js:15 also rejects prefixes Unknown, Unresolved, Pending, N/A,
  Not generated, etc.

Reproduction: "Unknown: operating allocation was not supplied." is accepted by
recordUserPreprocessing and usableHazardInputs. With provider failure, three
bounded generation attempts finish, then fallback throws "Cannot reconcile
governed values". Reproduced for HARA Rating Rationale and FHA Severity Rationale /
Software Control Category Rationale. These are accepted input values, not malformed
JavaScript objects. No reload or Stop occurs.

Smallest robust follow-up: share the exact field-acceptance rules between import
cleanup and final validation. Retain incompatible original rationale separately
and produce its assumption-based replacement. Test that every accepted cleanup
output can enter fallback without an input-driven exception; do not merely add
individual words to another disconnected regex.

## Previously reported improvements verified

- Prior rationale, invalid numeric rating, telemetry and imported-requirement
  regression tests remain in the suite.
- Project/repository registry no longer cancels on ordinary navigation. Duplicate
  starts, independent scopes, Stop, deletion, unsaved results, load revisions and
  retry-save behavior are covered at the registry level.
- Review registration is detached and bounded after the activity is completed.
- Hazard storage has deadlines and retains unsaved results in memory.
- Transport distinguishes request interruption from user cancellation and has
  request/body deadlines.

This review did not perform a live browser-navigation or paid provider run.
Publication counterexamples use the real dispatch and final runner with mocked
provider responses/storage. Imported rationale counterexamples exercise the real
import recorder, cleanup and generator.

## Remaining explicit boundaries

Stop, deletion of the owning project, clearing contents and application teardown
still intentionally cancel work. Invalid/unmatched preflight input can reject
before generation, even though the UI has already displayed a starting activity.
The code still allows programming errors to propagate; there is no universal
supervisor guaranteeing a completed artifact after arbitrary internal failures.
Browser/process termination and resource exhaustion are also outside guarantees.

A passing suite cannot prove an absolute completion property. In this case,
passing characterization tests positively demonstrate the two remaining defects.

## Tests

Added hazardCompletionBoundaryAudit.test.js: six passing characterization cases,
three actual-runner screening/publication cases and three import/fallback cases.
Ran the entire hazard-analysis directory plus aiAnalysisSTPA transport tests.
No production changes, customer-data writes, commits or pushes were made.
