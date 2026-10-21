# Loading review findings — implemented

2026-10-18. No database, saved data, generation, commit or push changes.

- `usePreparedArtifactRows` now counts uncached records rather than treating a previously prepared scope as sufficient to skip batching. More than 100 new records triggers yielding batches even after empty hydration or a full same-scope replacement. Ordinary edits/deletions reuse prepared records and remain immediate. Obsolete preparation is cancelled.
- `TraceabilityMatrixPanel` keeps the last successfully built same-project/repository matrix mounted during background loading, rebuilding, errors and retry. Status/error UI is a separate sibling instead of replacing the table. Scope identity gates both loaded collections and built rows, preventing old-scope collections from being built under a new project or old results from remaining visible after switching. Existing asynchronous cancellation rejects obsolete read completions.

Validation: full code-architecture-assurance directory plus VirtualTableBody tests passed: **24 suites, 137 tests**. Added regressions cover empty-to-large hydration, large replacement, cancellation, immediate deletion, background failure/retry preserving the exact table DOM node, and rapid scope switches with out-of-order read completions. Existing editing, filtering, search/copy, traceability, persistence and review-registration checks also passed. `git diff --check` passed.

These tests use synthetic data/jsdom; no live Safari performance claim is made. Large genuine traceability fanout and synchronous chain construction remain the previously documented limits. No new production build was run for these focused changes; the React modules were compiled and exercised by the tests.
