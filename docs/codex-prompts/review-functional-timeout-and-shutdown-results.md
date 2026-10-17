# Review results: timeout recovery and shutdown

Reviewed 2026-10-17. No production code changed during this review.

No additional actionable regressions identified in the scoped changes and current launcher wiring. Both previously reproduced defects are addressed:

- The AI adapter invokes the connectivity probe after a request deadline. The probe has its own five-second deadline and inherits cancellation. Failed/stalled backend probes and explicit browser-offline state enter recovery outside the source request budget. Tests exercise real deadline rejection, subsequent success, unchanged source request counters and no source splitting.
- Reachable slow requests get three attempts at the recovery layer. Exhausted timeouts propagate through hierarchy allocation without splitting, and source extraction's requestHandlesDeadline path propagates them rather than recursively subdividing evidence. Invalid response recovery remains distinct.
- Diagnostics are installed before the development server starts. On signals, they defer to existing shutdown listeners; without another listener they preserve termination. Real child-process tests cover SIGINT/SIGTERM and cleanup registration before and after diagnostics.

Validation: 144 frontend tests across seven suites and 25 Node tests passed (169 total). Focused ESLint and git diff --check passed. Existing stale Browserslist-data notice remains. No production build rerun in this review.

Limits: a local health response cannot establish upstream provider health. An upstream connection that stalls while the backend remains reachable and the browser reports online still receives bounded timeout recovery; indefinite recovery is reserved for identified connectivity failures. GitHub source acquisition retains its existing bounded retry policy. Persistent authentication errors, provider failures, or slow-service timeouts can still leave an attempt unfinished. These are not a guarantee of completion under every outage. No live customer environment or paid-provider outage test was performed, and the original backend process exit cause is still unconfirmed.
