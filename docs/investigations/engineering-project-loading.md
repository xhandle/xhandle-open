# Systems engineering project loading

## Cause

The project editor called `loadEngineeringProject`, which loaded every member's full revision, draft sources and baselines before displaying the document list. It then called `engineeringProjectTrace` on every render, even on the Documents tab and generation progress updates. Architecture artifacts made those otherwise unnecessary reads, structured clones and hashes expensive.

## Implementation

- The overview now reads project and document metadata with compact draft summaries. It does not read accepted revisions, baselines or source diagrams.
- Job creation, checkpoint, reset and acceptance update/remove the draft summary in the same transaction as the job. Existing databases need no schema upgrade: old summaries are populated once from jobs in a worker. Original evidence remains intact.
- Traceability is requested only when its tab or project proposal review is opened. The worker reads members sequentially, constructs the graph and returns lightweight nodes plus all links and gaps. Supporting architecture evidence is fetched when explicitly inspected. Baselines are not read.
- The existing xHandle working mark accompanies 0–100% stage progress for project, traceability and source loading. Percentages reflect completed stages/document reads, not estimated elapsed time. Errors stop loading and expose retry controls.
- Navigation cancels pending worker loads and ignores stale results. Checkpoint events coalesce over 75 ms, and background summary refreshes keep the existing overview visible. Trace maps/filtering are memoized; unresolved evidence lists mount only when expanded and are paged.

## Validation

- All 245 artifact tests passed, including eight new overview/storage/component tests. One additional worker-progress regression and the loading component tests subsequently passed (12 tests).
- Tests verify metadata-only reads, one-time legacy summary creation, bounded result payloads, atomic rollback, summary reset/removal, lazy trace loading, 0–100 progress, retry, navigation cancellation and coalesced refreshes.
- Production browser regression passed generation, joint acceptance, architecture rendering, traceability, source ownership, exports, detail editing, folder placement and reload.
- A disposable production browser fixture retained 20 documents with 88,400,000 saved evidence characters. First overview load (including legacy summaries) took 39 ms; subsequent overview load took 12 ms and transferred 3,971 serialized characters. On-demand trace computation took 2,483 ms, transferred 13,806 characters and had a maximum UI heartbeat gap of 21 ms. Both operations emitted monotonic progress from 0 to 100.
- These are synthetic operation timings after the browser fixture is loaded, not app-startup or real-project latency guarantees. No user data or live AI provider was used.
