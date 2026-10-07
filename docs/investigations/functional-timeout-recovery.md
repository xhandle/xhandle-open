# Functional generation timeout recovery

The Functional screen can report `The analysis request timed out.` while CSU results remain available. The shared GitHub/local pipeline saves the detailed analysis when the subsequent Functional stage fails.

The request adapter applies a deadline around its transport retries. Deadline expiration produces `FUNCTIONAL_REQUEST_TIMEOUT` with `retryable: true`. Functional processing previously treated every error carrying a boolean `retryable` field as terminal, so neither relationship processing nor responsibility consolidation recovered from a deadline expiration. The screenshot establishes the timeout, but does not establish why the provider exceeded its deadline.

Functional processing now subdivides timed-out relationship batches immediately, retaining already validated relationships in the current run. A single-relationship request retries once. Responsibility consolidation similarly subdivides larger groups and retries a two-member group once. Every response still passes existing coverage, identity, and boundary validation. Persistent timeouts terminate with an error rather than publishing incomplete mappings. Authentication failures and exhausted rate-limit/provider retries retain their existing behavior; cancellation stops recovery.

Both automatic processing and the Generate functional model button use this shared implementation. Existing saved CSU rows can be processed with that button without rerunning source analysis. This change does not add resumable checkpoints across page reloads or guarantee completion during a provider outage.

Validation: 48 tests passed across functionalModel and functionalAnalysisResponse, including timeout subdivision in both stages, transient and persistent singleton timeouts, persistent consolidation timeouts, cancellation, rate limits, and GitHub/local equivalence. No live provider call or customer repository analysis was performed.

Production build completed successfully with lint warnings. `git diff --check` passed.
