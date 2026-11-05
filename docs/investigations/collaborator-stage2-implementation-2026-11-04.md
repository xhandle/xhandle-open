# Collaborator Stage 2 — incremental indexing and indexed retrieval

Implemented locally from [the executed prompt](../prompts/collaborator-stage2-2026-11-04.md). Existing Reports and Stage 1 changes were preserved. Nothing was committed, pushed, packaged as a desktop release, or published.

## Implementation

- Background indexing starts after a 1.5-second debounce. Modern Chrome/Electron run the migration core in a Web Worker; environments without Worker/Web Locks use the same core with yielding batches. Questions wait for needed indexing, and cancellation propagates into local work. One cancelled caller does not cancel another caller's shared job.
- Durable step signatures and source-record revisions replace the 15-second full-rebuild expiry. Supported save notifications mark source groups dirty, including Project hazards, CBA assurance, generated reports, Traceability and code indexing. Equal-length localStorage edits remain detectable. Diagram position-only saves do not restart graph indexing.
- Unchanged source steps are skipped across indexing passes and application restarts. Changed groups enumerate bounded key pages; unchanged revisioned roots retain their graph records without reading their chunk bodies. Missing roots remove their record checkpoints so identical recreation is indexed correctly.
- Chunked architecture arrays, source-file metadata/text prefixes, assurance rows and modern hazard tables are read in pages. Hazard history is not copied into graph run metadata; source-file graph copies contain small metadata/snippets. Saved report bodies are processed one at a time and images are omitted from graph copies.
- Workspace graph schema 3 adds a compact `artifactIndex` store with term, lookup, row, project, type, recency and source indexes. Artifact writes update full records and compact projections atomically. Normal question preparation reads compact candidates and bounded endpoint relationships. Counts come from database counts rather than context samples. Explicit artifact access retains complete graph bodies where those bodies are stored.
- Selected distant rows are looked up independently of candidate ranking. Prompt budgets, citations, scope handling and incomplete-index diagnostics remain in place. Ordinary answers still use bounded samples.
- The existing cleanup serialization now also uses a shared Web Lock across windows. A worker captures localStorage after acquiring that lock, preventing a queued stale snapshot from recreating deleted records. Timed-out cleanup cannot execute later. Logical storage cleanup deletes compact projections with their full artifacts.
- Source checkpoints are published after successful writes/reconciliation. Failed sources preserve prior mirrors and remain retryable. The two steps sharing Project data are retried together after a failure. Interrupted initial passes can repeat already-written batches safely; this is idempotent recovery, not a promise of resuming at the exact interrupted row.
- Legacy broad project archives containing graph schema 2 remain importable into schema 3. Import and backup restore emit authoritative-data invalidation. Current analysis exports continue to omit the graph. Existing review prompts, mutation/undo behavior, tables, tabs and diagram controls retain their workflows.

## Regression checks

303 tests passed across 25 targeted suites, combining the complete 299-test run with reruns of the affected suites after the final source-notification and repository-compatibility fixes. One existing opt-in 520 MiB internal-checksum test was skipped. No live AI calls were made.

Coverage includes compact retrieval without body reads, exact counts and distant selection, persisted skip signatures, source-specific updates, bounded source-file loading, paged hazards without evidence duplication, checkpoint records, cancellation/retry and shared callers, worker transport failure, cleanup ordering/timeouts, deletion/recreation, old-schema repair, legacy archive import, backup behavior, global/unowned explicit repository records, report/test navigation, citations, review persistence and governed mutations.

An existing archive test expected partial AI derivation to return only one row. Its assertion was updated to the current behavior: the missing second parent is preserved as an explicit fallback draft. The test still verifies that the incomplete derivation is retried after transfer. Production derivation code was not changed.

Logs:

- `/private/tmp/xhandle-stage2-final-tests.log` — 25 suites, 299 passed, one skipped.
- `/private/tmp/xhandle-stage2-source-notifications.log` — source routing and worker follow-up checks.
- `/private/tmp/xhandle-stage2-final-followup.log` — six affected suites, 81 passed, including the final three added source/repository cases.
- `/private/tmp/xhandle-stage2-projection-cleanup.log` — 26 storage checks, including atomic compact-projection deletion.
- `/private/tmp/xhandle-stage2-lint-final.log` — focused lint, no errors or code warnings.
- `/private/tmp/xhandle-stage2-production-build.log` — optimized build; existing application warnings remain.

`git diff --check` passed. Build and native checks ran serially to limit pressure on the local 8 GiB machine.

## Native Chrome and Electron checks

Actual IndexedDB and real workers, isolated temporary profiles, synthetic data only. Electron 45 ran a file-backed fixture; headless Chrome 156 used a temporary localhost fixture with external requests blocked. The harness bundles the actual graph modules and extracts the current scope/prompt helpers. It does not replace storage with mocks.

Nine check groups passed per runtime, covering source edits/deletion, failed-source preservation, report versions/deletion without images, System Test indexing, CBA scope, project totals, committed IndexedDB edits and prompt citation correctness. Each runtime started 13 actual indexing workers.

Warm context preparation plus scope/prompt formatting, 30 samples per size:

| Total graph artifacts | Electron median / p95 (ms) | Chrome median / p95 (ms) | Full artifact-body reads per question |
| ---: | ---: | ---: | ---: |
| 1,000 | 17.0 / 17.9 | 18.0 / 26.9 | 0 |
| 10,000 | 43.7 / 47.1 | 45.8 / 73.5 | 0 |
| 27,125 | 112.2 / 191.1 | 91.7 / 127.4 | 0 |

The largest Stage 1 fixture had approximately 280/274 ms median local preparation in Electron/Chrome and one full artifact-store read. Earlier audit measurements were approximately 481/475 ms and two reads. Sample sizes and fixture details differ, so this establishes reduced work rather than a precise end-to-end speedup factor.

The warm fixtures alternate ownership between two projects, use 2,048 padding characters per artifact and one relationship per artifact, and prime indexing before measurement. Each result retains 36 context candidates with whole-record prompt fitting. These runs measure local preparation, not provider/network response time or complete application UI responsiveness. Final renderer heap samples were approximately 19 MiB in each runtime; they are not peak-memory or leak measurements.

Reproduce on macOS:

```sh
node scripts/diagnostics/collaborator-stage2/run.cjs chrome
node scripts/diagnostics/collaborator-stage2/run.cjs electron /path/to/Electron
```

The runner prints the temporary evidence directory. Final measurement logs are `/private/tmp/xhandle-stage2-electron-final.log` and `/private/tmp/xhandle-stage2-chrome-final.log`.

## Limits and remaining stages

The Stage 3 read-tool implementation is now local; see [the Stage 3 report](collaborator-stage3-implementation-2026-11-04.md). The list below records the state after Stage 2.

- Stage 3 remains: targeted record/section reads, exhaustive dataset queries and aggregates, relationship/version tools, stronger repository/run isolation, richer full-record search and explicit coverage states. Compact term retrieval is bounded, not an exhaustive semantic search of every byte.
- Stage 4 remains: correlate local preparation with provider first-output/completion metrics, improve provider streaming/progress and benchmark actual customer questions without changing provider preferences automatically.
- Freshness relies on supported app-save notifications and exact localStorage snapshots. Raw external IndexedDB writes which bypass those notifications require a forced refresh. There is intentionally no periodic full scan as a fallback.
- One legacy unchunked source record still requires a whole-record IndexedDB read. Old chunked hazard runs lacking the existing row index report that a storage upgrade is required and retain prior mirrors; this indexer does not silently hydrate their entire histories or rewrite authoritative runs.
- Compact graph copies of source files and run metadata are intentionally incomplete. Original source/evidence remains in authoritative storage; deeper access belongs in the targeted read tools.
- Initial indexing is background work and can still take time. Synthetic warm-query timings do not validate Offer's 634 MB workspace, all historical runs, 5,500 real source files, active concurrent analysis, 16 GiB machines or renderer peak memory. Those need a separate representative workload capture before making customer-scale guarantees.
