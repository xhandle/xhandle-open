# Hazard validation recovery

## Confirmed cause

The compact pipeline threw on the first exhausted singleton, set a shared stop flag,
and never returned its validated results to the runner. The runner only assembled a
table after total success. App restored the prior run (or no run), exposing the blank
input draft. Parsing errors were also overwritten by a subsequent identity check.
The original customer's exact validation violation is unavailable in the supplied
stack trace; this change does not guess it or weaken the validation contract.

## Changes

- `fastHazardPipeline.js`: exhausted row validations are collected while independent
  work continues. Final errors include row ID/action/phrase/reasons, validated results
  and total count. Parse/truncation reasons survive. Transport/cancellation/storage
  failures stop scheduling new work and carry available validated rows. Checkpoint
  failures no longer discard a just-validated in-memory batch.
- `fastHazardRunner.js`: assemble only validated partial rows, revalidate the merged
  artifact, and persist it with `runState: incomplete`, counts and failure details.
  When a prior completed run exists, retain its Summary and store a separate
  `pendingAttempt`. The error carries the recovery object for App to retain. No
  unresolved row is fabricated or marked complete.
- `codeArchitectureHazardUtils.js`: preserve recovery metadata across normalization
  and reload, including unsaved state.
- `App.js`, `CodeArchitectureHazardPanel.js`, `HazardRunRecoveryNotice.js`: visible
  persistent failure details, partial inspection/export, prior-result distinction,
  and Retry save for storage failures. App logs structured findings, preserves the
  recovery object, and exposes errors even after the activity stops.
- `artifactAI.js`: reject incomplete or unsaved hazard runs as requirement-derivation
  inputs. A prior completed run remains separate from its pending attempt.

Existing bounded retries, method reasoning, organization calibration, governed human
applicability, CSV traceability and checkpoint scope are unchanged. Continue uses the
same validated checkpoints and corrects only unresolved rows. Old pipeline retained.

## Verification

- 25 suites passed: 262 tests before the final additional runner-resume regression.
- Final runner suite verifies Continue after serializing/reloading an incomplete run
  sends only its unresolved assessment; pipeline test likewise preserves 99 of 100
  rows when one is permanently invalid.
- Tests cover actual fallback persistence/normalization, prior completed Summary
  preservation, UI failure reasons/export/retry-save, checkpoint write failure,
  cancellation, provider failure, parse diagnostics and downstream blocking.
- Production build passed with warnings; `git diff --check` passed.
- A UI test initially used an unavailable testing library; it was converted to the
  repository's React DOM/act test approach and passed without adding dependencies.

## Limits

This repairs recovery and observability, not arbitrary model errors. Invalid rows
remain explicitly incomplete until corrected. Already accepted checkpoints from the
failed run can be reused if their inputs and scope match. A failed storage backend
can still prevent durability; recovered in-memory results then offer export/retry-save.
No live model smoke test, server restart, customer-run cancellation, commit or push
was performed. The supplied stack cannot retroactively reveal its missing findings.
