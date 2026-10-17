# Fix timeout recovery and shutdown cleanup

Implement the two confirmed connectivity-review findings without changing analysis evidence or publishing incomplete results. On an AI request deadline, check connectivity using a cancellable, bounded backend health probe and browser offline state. Pause and retry the same work when disconnected; keep reachable but slow requests bounded. Never treat exhausted transport timeouts as invalid semantic output or split batches to recover connectivity. Preserve checkpoints and cancellation, and avoid paid provider calls in tests.

Make development process diagnostics allow existing SIGINT/SIGTERM cleanup handlers to execute while preserving termination when no handler exists. Add regressions using actual deadlines, stalled health probes, cancellation, reachable slow services, source and hierarchy no-split behavior, and real child-process signal delivery. Run the related frontend and backend suites and report limitations accurately.
