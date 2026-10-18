# Implement confirmed large-project performance fixes

Implement the measured bottlenecks from investigate-avlocalization-platform-lag-results.md, preserving analysis data and observable matching/layout behavior.

1. Build diagram function-group indexes once per structural build rather than scanning all relationships per node. Accumulate unbounded evidence in sets and finalize once. Skip preprocessing on unchanged structure, and index existing nodes by ID.
2. Persist only changed review records relative to the last successful immutable snapshot. Preserve deletion and restore missing records. Failed/rejected writes must invalidate the baseline. Bound queued snapshots to one active and one latest pending snapshot; callers must settle correctly and no applied edits may disappear.
3. Match hazard review rows through stable raw analysis IDs where available. Retain exact-content compatibility for legacy/imported rows, first-duplicate behavior, and collision checks without retaining full serialized narrative rows as keys.
4. Add targeted regression tests for output equivalence, duplicate/edited/legacy rows, save failures, deletion, and queued updates. Benchmark safe synthetic fixtures at the observed scale; run relevant existing tests and a production build.

Do not change database schemas, purge saved analyses, run paid LLM requests, or implement speculative canvas/layout/loading rewrites. Global review pagination/schema normalization and browser-specific canvas optimization require a separate measured follow-up. Do not claim all Safari lag is resolved without profiling the actual browser. Do not commit or push unless requested.
