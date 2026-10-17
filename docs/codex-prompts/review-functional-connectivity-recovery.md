# Review functional analysis connectivity recovery

Review the current uncommitted connectivity-recovery implementation against its parent revision. Do not change production code. Trace source decomposition, responsibility consolidation, hierarchy allocation, checkpoint reuse, UI cancellation, stale-error display, backend error classification, and development process lifecycle.

Verify HTTP 520 receives bounded retries; genuine connectivity outages pause outside request deadlines and semantic budgets and resume the same work; cancellation interrupts waits; transport failures do not cause semantic batch splitting; permanent errors remain bounded; cached results and publication guards remain intact. Inspect request/body parsing boundaries and errors that occur after a request starts but before it resolves. Check process diagnostics preserve existing cleanup behavior.

Run focused regression suites and add no paid provider calls. Use deterministic reproductions for suspected defects. Report only supported findings with severity, trigger, consequence, and source locations. Distinguish remaining gaps from regressions, and do not infer the customer's actual backend exit cause from screenshots alone. Passing tests cannot establish absence of all bugs.
