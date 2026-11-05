# Hazard loading during Collaborator retrieval

The user observed a cold hazard table at 1% while Collaborator prepared searchable project information. Code review found no coordination between the hazard read workers and explicit Collaborator indexing. Existing background-only interruption does not apply to a user-requested retrieval. Scoped legacy projection repair held one read/write transaction for every artifact in the project.

The preview's stored migration diagnostic records a previous two-artifact lookup taking 217,332 ms, of which projection repair took 213,401 ms and reconciliation 3,319 ms. That diagnostic predates the latest screenshot; it demonstrates the expensive path, not a timed reproduction of the exact user interaction.

## Change

- Hazard worker reads acquire a reference-counted foreground priority lease, released on success, error, cancellation, or worker construction/transport failure.
- The active indexing worker receives priority changes and waits at transaction boundaries. It resumes the same pass without discarding evidence, restarting work, or changing answer scope. Browser fallback uses the same gate.
- Scoped projection repair handles at most 64 records per transaction and seeks by primary key between batches. It only loads missing/outdated projection bodies, never clears another project's index, and marks completion only after the repair finishes.
- Indexing timeout excludes time deliberately yielded to table reads. Finished workers unsubscribe.
- Existing table row/outline/filter memory budgets remain intact. Priority state retains no records. This coordinates workers in one renderer; it does not promise cross-window scheduling or eliminate storage latency, all remaining reconciliation costs, or every legacy large-record allocation.

## Validation

81 tests passed across priority scheduling, hazard workers, paged hazard UI/cache, indexing, migration synchronization, and read-client suites. Added checks prove overlapping reads release correctly, paused repair holds no transaction, all 130 legacy records resume correctly across batch boundaries, another project's index stays untouched, and an intentional pause does not exhaust the worker timeout. ESLint: zero errors, one existing unused-variable warning. `git diff --check` passed.

Disposable Electron 45 test: production modules and actual workers, fresh isolated profile, no AI calls or user records. 26,278 synthetic hazard rows plus 4,000 legacy search artifacts. Layout preparation: 2,945 ms alone, 2,840 ms concurrent. Index counts sampled during the table read remained 320/320/320, then reached all 4,000 on resume. Final hazard row verified. Outline metadata 1,089,400 bytes. Peak renderer working set 290.3 MiB (includes worker footprint), renderer JS heap 21.5 MiB, retained heap 2.4 MiB after collection, max sampled main-thread delay 1.6 ms. No runtime errors or crashes. These are synthetic single-run results, not a guarantee of timings on the user's aged database.

Harness: `scripts/diagnostics/stress-hazard-collaborator-priority.cjs`. Raw measurements are in the adjacent JSON file.
