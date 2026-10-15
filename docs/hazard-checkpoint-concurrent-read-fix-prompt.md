# Codex prompt: fix stale concurrent checkpoint read failures

Reproduce the remaining read-recovery race before changing code: an older read times out after a newer read succeeds; its catch handler blocks all later reads, while its eventual success is ignored as stale.

Make all shared read-state changes, retry-budget updates, and failure notifications obey consistent request ownership. Preserve results returned to individual callers, newest in-memory values, bounded retries, permanent failure handling, cancellation, checkpoint write recovery and final-save status. An old failure must not disable healthy newer reads, consume their retry budget, or show a stale warning; an old success must not clear a newer failure.

Add regression tests for overlapping success, transient rejection, permanent rejection, timeout and late settlement in both orders. Demonstrate failure before the fix, then run the complete hazard-analysis, transport and downstream requirements suites. Do not alter hazard reasoning or applicability, and do not commit or push.

Implementation: the timeout/rejection catch now uses the same read-epoch ownership predicate as late completion callbacks. Stale operations retain their own return behavior but cannot mutate shared read recovery or UI status.
