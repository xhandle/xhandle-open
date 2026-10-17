# Review: original cases fixed; two remaining recovery gaps

## High — caught interruptions replace the identity-bearing manifest with unmapped partial results

The initial manifest now preserves preprocessing identities, but `fastHazardRunner.js:195-208` builds a new partial run and copies all previous `userPreprocessing` without carrying the identity sheet. That partial run uses the same attempt ID as the initial manifest. Saving it replaces the good manifest. When edited rows are absent from partial output, the Summary cannot provide their identities. `prepareCodeHazardPreprocessing` then fails with unmatched user preprocessing on the next continuation.

Reproduced with the real runner: create an incomplete prior run with an explicit user exclusion, start continuation, and inject a generation interruption with an empty `partialResults` array. The saved recovery object contains the exclusion, a header-only Summary, and no identity sheet. JSON round-trip and continuation then fail with `User preprocessing needs review`. This is an ordinary caught-error/cancellation recovery path, distinct from the abrupt reload path covered by the new test. It does not establish that the latest change originally introduced every aspect of this older partial-results behavior; it establishes that the promised recovery preservation remains incomplete.

Fix: retain identity metadata on every recovery write, including partial runs, and restore from the union of available partial Summary identities and saved identity metadata. Do not simply prefer a nonempty partial Summary over the complete owned-row mapping. Test interruptions before and after some edited rows finish.

## Medium — checkpoint success hides a failed recovery-record save

`fastHazardRunner.js:161` puts initial manifest-save failure into `storageWarning`. The generation callback at line 193 overwrites that same variable whenever a row-checkpoint storage state arrives. `unsaved:false` clears the warning although the manifest save has not recovered. A reload during this interval may again leave row checkpoints without a discoverable latest-run record.

Reproduced by rejecting only the initial run-record save, sending generation progress, and reporting a successful row checkpoint. The progress first says recovery information could not be saved, then becomes only `Assessing rows` without any manifest save success. The mock permits the eventual final save; the defect concerns the intervening active-run period.

Fix: track manifest persistence and row-checkpoint persistence separately. Clear each warning only when its own operation succeeds, and retire stale callbacks when an attempt ends. Cover initial timeout followed by late success as well as rejection followed by healthy checkpoint writes.

## Confirmed improvements and validation

- Save waits now have deadlines; initial cancellation stops waiting without canceling the ordered writer.
- Never-settling initial/final saves return completed in-memory results with pending-save status.
- A manifest-only reload preserves a user exclusion when no later partial-result save replaces that manifest.
- 82 existing tests passed across eight suites. Two temporary diagnostic tests reproduced the gaps above; both passed assertions demonstrating the defects and were removed afterward.
- Diff whitespace checks passed. No production code changed in this review. No live Safari heap profile or paid provider run was performed. This is not a clean recovery sign-off.
