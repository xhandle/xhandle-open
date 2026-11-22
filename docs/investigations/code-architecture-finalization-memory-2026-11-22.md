# Architecture finalization memory

Finalization now uses bounded serialized-chunk and raw-source caches, cooperative byte/row batches, immutable evidence reuse and summary-only atomic publication. Checkpoint discovery previews at most 50 rows. Completed results can recover after process restart without repeating analysis. Default mutable read APIs remain independent; immutable sharing is explicit. Snapshot hash composition preserves existing hash values and caches only recursively immutable objects with weak keys.

The synthetic benchmark contains 6,000 generated source files and 32,000 relationships with varied Unicode source, 64 functions per file and 25 selected snippets per relationship. Baseline and fixed production data modules run in separate Electron processes with the ordinary heap limit. The harness records actual heap/RSS, distinguishes controlled pressure stops from crashes, verifies complete evidence, tests cold save recovery and exercises rollback, corruption, cancellation, quota failures and concurrent edits. It performs no provider requests.

The initial macOS comparison captured 4.186 GB baseline used heap before a controlled stop; the fixed run completed at 3.114 GB peak pipeline heap, approximately 25.6% lower. All 32,000 rows survived save/reload and process-restart recovery. These are synthetic measurements, not a guarantee of capacity for every repository. Final cumulative release validation and Linux results are recorded with the release receipts.

The implementation retains full row-array compatibility. Very large unique evidence, legacy mutable reads, downstream derivations and whole-result exports can still require substantial memory. Fully paged consumers/exports remain follow-up work. The benchmark starts after extraction and does not evaluate live provider semantics.

See [the harness instructions](../testing/electron-regression.md) for reproduction. Use temporary profiles and fresh output directories. Keep private workspaces, incident reports and account settings outside source control and release artifacts.
