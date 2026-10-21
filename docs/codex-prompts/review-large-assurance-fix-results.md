# Review: large assurance table implementation

2026-10-18. Read-only review of the current combined uncommitted performance and loading-indicator changes. Production files were not changed by this review. No commit or push.

## Findings

### P2 — asynchronous large dataset loading skips preparation progress and batching

Location: `src/features/code-architecture-assurance/usePreparedArtifactRows.js:10–16`.

The hook marks a scope completed even when its initial rows are empty. Any later rows in the same scope take the synchronous `rows.map` path, irrespective of size or how many rows are new. EngineeringArtifactPanel commonly starts with empty cached rows and later receives the saved dataset asynchronously. Thus the common saved-data path bypasses the newly implemented batched preparation entirely. Full dataset replacements and generation completion in a prepared scope do the same. This leaves an unbounded synchronous enrichment step and a 100% jump, although subsequent DOM rendering remains windowed.

Reproduced: render an empty scope, then supply 5,000 rows. All rows are immediately prepared, progress is 100, and there is no preparation timer. This is a gap in the preceding loading-indicator implementation, not a regression in the indexed relationship matching.

Recommended fix: distinguish a small edit to an already-prepared snapshot from initial hydration or a large replacement. Batch substantial new work even in an existing scope; preserve active editors on ordinary edits. Do not treat an empty initial snapshot as proof that future preparation is cheap. Test empty-to-large, replacement-to-large, edits, deletion, cancellation and rapid project switches.

### P2 — background traceability refresh hides previously available results on failure

Location: `src/features/code-architecture-assurance/TraceabilityMatrixPanel.js:520–523` (refresh begins in the loading effect at approximately line 425).

Every refresh sets loading, and the render branch unmounts the matrix for loading or error states regardless of whether a same-scope completed matrix is available. A storage timeout during an assurance change notification therefore replaces the working matrix with an alert. Its data remains in `built`/`artifacts`, and the header can still show its counts, but the table and copy/search access disappear. Unmounting also discards transient table state such as filters and scroll position.

Reproduced: load a matrix containing one chain, then dispatch a same-scope assurance change while the storage reader rejects. The error is displayed and the previously visible table is absent. This is a UI availability regression from the loading-state changes; it is not demonstrated saved-data loss.

Recommended fix: distinguish first load from same-scope background refresh. Keep the last successfully built matrix mounted during refresh and on failure, show a nonblocking status/error plus retry, and replace it only with a successful current-scope result. Never retain another project's matrix across scope changes. Test failure/retry, stale/out-of-order completion, preserved filters/scroll, and scope switching.

## Confirmed improvements

- All five requested tables use EngineeringArtifactTable's VirtualTableBody. Tests confirm bounded DOM and bounded per-selection cell evaluation, active editor retention, distant target reveal, full-data Markdown copy and offscreen quick-search activation.
- Indexed parent/child and architecture-reference lookup tests pass, including inheritance, multi-parent ordering and ambiguous legacy references.
- The current trace builder still matches the pre-indexing builder exactly on 20 mixed-link fixtures and a 1,000-complete-chain fixture. This review reran the archived differential audit: **4,832 ms before / 53 ms after**, identical output. Single-run Jest measurements; not measured Safari latency.
- Review registration tests confirm incremental normalization, no restarts from review-context changes, existing reviewed-row preservation and cross-scope update isolation.
- Unrelated-project assurance notifications do not trigger traceability refresh. Generation and persistence regression tests pass.

## Executed checks

1. `CI=true npm test -- --watchAll=false --runInBand src/features/code-architecture-assurance src/components/VirtualTableBody.test.jsx`: **25 suites, 135 tests passed**. This comprises 133 regression tests plus two new audit cases that deliberately assert the faulty behaviors above. Passing defect-reproduction assertions is not evidence the defects are fixed.
2. Archived before/after traceability parity audit: **2 tests passed**, exact output comparison and benchmark.
3. `git diff --check`: passed.

The new reproduction source is archived as `review-large-assurance-fix-audit.test.jsx.txt`; copy temporarily to `src/features/code-architecture-assurance/assuranceReviewAudit.test.jsx` to run it. Temporary audit modules were removed from production/test source paths after execution. Existing archived traceability comparison fixtures remain available as documented in the implementation report.

No production build was repeated because this review changed no production code; the preceding implementation build completed with warnings. No live customer data or browser storage was modified. Live Safari profiling was unavailable. Genuine many-to-many chain expansion and synchronous trace construction remain scalability limits beyond the confirmed improvement; no universal latency or zero-regression guarantee is made.

## Conclusion

The principal DOM and repeated-lookup problems are fixed in the tested implementation. Do not call the combined change regression-free: the two reproducible loading-state defects above remain and should be fixed before sign-off. No additional trace-output, copy/search or reviewed-decision regression was found in the executed tests.
