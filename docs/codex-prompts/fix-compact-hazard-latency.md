# Fix compact CBA hazard latency and recovery

Implement the findings from compact-hazard-wiring-audit.md. Keep the new default
STPA/HARA/FHA runner, method semantics, organization calibration, human applicability
decisions and downstream software requirements intact. Preserve the legacy runner.

Budget deduplicated prompts including shared context. Retain evidence and use a
bounded output row ceiling. Adapt subsequent batches after response-size failures,
retry only invalid/missing rows, and keep concurrency bounded. Report request waits
and retries without fabricating completion percentages. Batch checkpoint I/O and
reuse row-key digests while preserving existing checkpoint compatibility and scope.
Keep final-save recovery results visible instead of restoring stale results.

Do not delete historical/supporting columns: their presence in the picker is not a
routing defect. Add regression tests for the reproduced performance issues, adaptive
retries, cancellation, checkpoint compatibility/isolation and save recovery. Run the
relevant suites and production build. Report measured test improvements separately
from unmeasured live-provider speed. Do not restart servers or cancel an active run.
