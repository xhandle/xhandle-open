# Connectivity recovery review results

Reviewed the uncommitted implementation on 2026-10-17. Production code unchanged during review.

## Findings

1. **P2 — Remaining outage-recovery gap: stalled connections still consume semantic recovery.** `functionalTransportRecovery.js:45` only pauses errors explicitly marked connectivity. A request that hangs until `withAnalysisRequestDeadline` expires instead produces `FUNCTIONAL_REQUEST_TIMEOUT`. Hierarchy recovery explicitly permits that error through its retry/split path (`functionalHierarchy.js:112`); responsibility/consolidation processing can fail after the request adapter surfaces it. Deterministic reproduction using the actual deadline and recovery functions, a never-resolving request, and a 5ms deadline produced `FUNCTIONAL_REQUEST_TIMEOUT`, one operation attempt, and zero connectivity waits. An outage that stalls rather than rejects the connection can therefore still end an attempt or cause unnecessary hierarchy splitting. This is a remaining gap, not evidence that every timeout means offline. Add a connectivity verification/recovery decision before treating a timed-out request as a content failure; preserve cancellation and bounded handling for a reachable but slow provider.

2. **P2 — Introduced shutdown regression: diagnostics bypass existing signal cleanup.** `scripts/dev-process-diagnostics.js:13` immediately calls `process.exit` from its SIGINT/SIGTERM listener. It is installed before react-scripts registers listeners that call `devServer.close()` (`node_modules/react-scripts/scripts/start.js:142`). A child-process reproduction registered the diagnostics first and then a cleanup listener, delivered SIGTERM, and exited 143 without running the cleanup listener. Make diagnostics observe shutdown without preempting existing shutdown handlers, retaining default termination only when needed.

## Verified behavior

- HTTP 520 and related statuses participate in bounded retries.
- Explicit backend connection rejection and classified upstream DNS/socket failures enter cancellable recovery outside request deadlines.
- Classified transport errors no longer trigger semantic splitting.
- Accepted cached work is reused; stale saved error suppression survives equivalent metadata recreation.
- 140 frontend tests across seven suites and 24 Node tests passed (164 total).
- `git diff --check` passed.

Tests were mocked/local. No live provider requests, customer data access, or real hour-long network interruption. The actual cause of the customer's backend exit remains unconfirmed. Existing tests do not cover the two findings above; passing them is not evidence that all failure paths are fixed.
