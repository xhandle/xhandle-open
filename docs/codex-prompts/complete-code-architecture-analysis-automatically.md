# Complete recoverable code architecture analysis within the active run

Status: implemented. See [implementation and validation report](../investigations/code-source-automatic-recovery.md).

Implement this prompt in the current checkout. Preserve unrelated changes. Do not commit/push, run paid AI, upload customer source, or manipulate the user's browser storage during testing.

## Outcome

Users start Analyze once. The shared local/GitHub pipeline automatically recovers from output truncation, malformed responses, transient provider/network errors and request timeouts within that run. Do not require manual retries as the normal completion workflow. Do not claim completion by dropping source sections, accepting truncated rows, swallowing errors, or replacing AI analysis with an incomplete deterministic fallback.

Investigate the existing three-request shared budget, 45-second whole-file timeout, 1,800-token output cap and eight-chunk file exclusion. Replace these bottlenecks with bounded, source-size-aware recovery. Real cancellation, unavailable credentials, persistent provider failures, changed inputs/settings and exhausted storage must remain explicit failures with preserved progress; no implementation can guarantee success under these conditions.

## Implementation requirements

1. Use recursive subdivision for truncated or persistently malformed responses, allowing every child section its own recovery attempts. Preserve the entire primary source range, include boundary context and full-file evidence, and merge only complete successful results. Handle long single lines. Bound depth, minimum section size and total requests; never retry forever.
2. Use individual request deadlines instead of a 45-second deadline shared by all chunks of a file. Implement abort-aware exponential backoff, bounded Retry-After handling, and cancellation cleanup. Preserve effective-provider/model guards. Give responses an explicit larger, fingerprinted output budget with concise prose rather than asking for long descriptions under an inadequate cap.
3. Automatically revisit recoverable failed files within the same active run. Checkpoint completed chunks and successful files, so automatic recovery does not redo completed work. Keep stable source/settings identity, storage budgets, project isolation, and durable atomic publication. Version the recovery policy and checkpoint fields without deleting old checkpoints.
4. Process all chunks of eligible selected files; chunk count should control work scheduling rather than silently exclude otherwise eligible files. Preserve byte, secret, binary, generated/vendor and acquisition protections. Explicit configured run limits must fail preflight rather than publish a partial selected-file run as success. Explain policy exclusions separately from incomplete processing.
5. Keep progress messages truthful: distinguish processed attempts from completed files, say automatic recovery is ongoing, and surface unrecoverable failures clearly. Keep recovery/export UI as a fallback for interrupted or terminal failures, not a required normal step.
6. Preserve published row IDs, evidence reconciliation, user edits, hazard/remediation/requirements/design/traceability contracts, navigation, import/export and both source adapters. Never publish incomplete drafts downstream.

## Validation

Write regression tests for repeated/nested truncation, malformed output, long-line subdivision, exact source-range coverage, per-child budgets, transient error and Retry-After recovery, cancellation, hung requests, permanent failures, bounded exhaustion, completed-chunk reuse, files exceeding eight chunks and prevention of partial publication. Exercise the real shared pipeline with isolated local/GitHub fixtures, including automatic second-pass recovery without a user retry and preservation of old results on terminal failure. Run affected tests, build and lint. Document verified behavior, finite limits and remaining external failure conditions accurately.
