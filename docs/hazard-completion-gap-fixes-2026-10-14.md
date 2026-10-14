# Completion-gap implementation

Executed docs/codex-prompts/hazard-completion-gap-fixes.md against the current
working tree. No commit or push performed.

## Changes

- Shared completion support isolates sync and async observer errors. Metrics,
  diagnostics, storage notifications, runner progress and publication observers
  no longer decide whether generation succeeds.
- Valid locked applicability/rationale survives incidental unresolved wording.
  Fallback validation ignores quoted source labels when checking generated prose.
- Invalid imported rating/requirement constraints are separated from usable input.
  Originals are retained verbatim in retainedUserInputs, persisted by normalization.
  Generated replacements are explained through Assessment Basis. Conflicting
  classification/significance retains the classification; original significance
  is retained separately rather than silently discarded.
- Final reconciliation matches imported records by stable row identity first.
  An invalid merged row uses its already-generated valid assessment, retaining
  original inputs and independent successful rows. This requires no extra AI call.
- App runs have project/repository-scoped ownership. Switching views does not abort;
  independent projects can run concurrently, duplicate starts for one scope are
  ignored, and returning restores live progress/results. Explicit Stop, teardown,
  project deletion and clearing contents retain cancellation semantics.
- Loads check run revisions and retained memory results to avoid stale overwrites.
  Successful retry-save releases the matching unsaved memory record.
- Hazard activity completes before independent review registration. Registration
  has a five-second observation deadline and no longer holds the running flag.

## Verification

412 hazard/transport tests passed across 42 suites. Another 22 downstream
requirements/isolation tests passed. The final focused registry suite passed all
six tests after save-retry/deletion refinements. App.js parses with Babel and
git diff --check passes.

Tests cover all three methods, locked rationale, invalid ratings, original input
retention, final reconciliation, observer errors, scoped navigation ownership,
duplicate start, independent Stop, deletion, stale-load revision invalidation,
unsaved results and retry-save. Existing storage/CSV/requirements tests remain green.

No live customer/provider run or browser UI smoke test was performed. The navigation
ownership is tested at the registry level; App integration was inspected and
syntax-checked. No claim of an absolute runtime guarantee is made: deliberate Stop,
invalid/unmatched preflight input, arbitrary programming defects, browser/process
termination and resource exhaustion remain outside recoverable row completion.
