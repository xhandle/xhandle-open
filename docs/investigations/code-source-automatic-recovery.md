# Automatic completion recovery for code architecture

Implemented from `docs/codex-prompts/complete-code-architecture-analysis-automatically.md`.

## Confirmed defects

The previous repair shared three requests among an entire original chunk and its children. A truncated parent left only two requests, so either child needing repair prevented completion. A 45-second whole-file deadline also included source reads, indexing and every model chunk/retry. The output budget was 1,800 tokens despite instructions for multi-sentence descriptions. Files requiring more than eight estimated chunks were excluded from planning. Long single lines could exceed the intended chunk length. Source indexing clipped admitted files to 80,000 characters, limiting grounding for their later sections.

## Resulting behavior

- Analyze stays active through automatic recovery. Both local and GitHub use the same implementation.
- Initial output capacity is 4,096 tokens, increasing to 8,192 on truncation. Continued truncation recursively subdivides input; repeated malformed responses and timeouts can also trigger subdivision. Descriptions are concise, and the complete primary source range remains required. Successful sections are merged only after all required sections finish.
- Each section has its own retry attempts. Transient network/provider failures use exponential delays and bounded Retry-After handling. Timeouts apply to individual requests, not an entire multi-chunk file. Timers and cancellation listeners are cleaned up; late responses cannot publish aborted work.
- Unfinished recoverable files are revisited automatically in up to three passes during the same run. Completed original chunks and subdivision leaves are checkpointed and reused. Progress counts completed files, not failed attempts.
- All chunks of eligible selected files are scheduled, including files requiring more than eight chunks. Long lines are split into bounded overlapping chunks. Explicit run/file limits fail preflight instead of silently publishing a partial selected-file result.
- Source indexes retain the full contents of admitted files within the existing 350,000-byte admission limit. The source-index and checkpoint storage budgets remain enforced. Binary/secret/vendor/generated protections and adapter access restrictions remain in place.
- The policy and token capacities are included in run identity and published metadata. Old checkpoints are retained; incompatible policies are not silently merged. Compatible interrupted runs can reuse saved chunks. Saved row IDs, reconciliation and downstream data contracts are unchanged.
- Any persistent failure prevents new publication. Last successful rows remain available; draft checkpoint export/recovery remains available for interrupted or terminal failures. This is a fallback, not a required step for ordinary recoverable model failures.

## Finite limits and interpretation

Requests have a 120-second deadline. A section has at most three attempts; subdivision depth is at most five, splitting stops at 256 characters, and each original chunk has at most 128 requests across the active run's automatic passes. Retry-After waits are capped at 60 seconds; cancellation interrupts waits immediately. A separate new run can resume compatible completed sections with a fresh finite request allowance. Output-repair recovery may take longer and consume more AI calls/tokens than a run without failures.

These safeguards prevent infinite paid loops. Persistent provider outages, rejected credentials, revoked local permissions, source/settings changes, cancellation, storage exhaustion, or a model unable to return a valid response even at the smallest section still cause explicit failure. Processing all selected eligible source is not a proof of exhaustive semantic interpretation of every code relationship. Existing extractor scope and evidence requirements remain explicit; incomplete/truncated responses are never promoted to complete results.

## Validation

- 238 tests pass across 30 affected suites: recovery, cancellation, source equivalence, storage/identity, hazard preprocessing, remediation, requirements/design/traceability compatibility and navigation.
- Unit regressions cover nested truncation, output-capacity increase, independent child retries, exact character-range coverage, boundary context, single-line splitting, transient and permanent failures, Retry-After, bounded exhaustion, hung requests, cancellation, source access retries, completed-section reuse, files over eight chunks and symbols beyond 80,000 characters.
- `code-source-automatic-recovery-check.cjs` uses the real generator with isolated synthetic local/GitHub sources and intercepted AI. Both adapters finish a temporary three-request outage without another user action, recursively recover truncated responses, complete a file requiring more than eight chunks, reuse an earlier successful chunk during a later automatic pass, preserve published results on permanent failure, and reject explicit partial-run limits before any AI call.
- `code-source-pipeline-check.cjs` verifies fresh repeated/cross-adapter equivalence, controlled omission/duplication, stable saved trace IDs, retained prior rows after persistent malformed/truncated responses, and atomic portable import.
- Production build and lint completed; preexisting repository warnings remain. No new dependency or server deployment is required.

Tests use synthetic fixtures only. No paid/live AI, customer repository upload, or user browser-storage modification was performed. No commit or push was made. New runs must load the updated client code; existing closures from an already-running analysis are not upgraded retroactively.
