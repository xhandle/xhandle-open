# Immediate project deletion — November 6, 2026

Removed-project deletion now persists a small deletion marker and removes the row immediately after confirmation. Bulk deletion accepts the selected removed projects in the same turn. Neither action sets the Storage dialog busy, waits for a database scan, or runs an inventory refresh before updating the list.

`projectDeletionQueue.js` reclaims the underlying data sequentially in the background using the existing ownership-checked cleanup. The queue runs independently of the Settings component. App startup resumes persisted queued jobs, including cleanup interrupted by app exit. Failed jobs stay deleted, have a retry action, and receive one automatic retry per startup. Completed markers prevent stale graph records from resurrecting deleted projects. Active registries are independently rechecked before cleanup; recording a deletion must succeed before any row is removed. A partial bulk persistence failure reports the accepted subset and leaves the remaining rows visible.

Project visibility, graph catalog/evidence readers, and graph relevance queries exclude deleted identities while cleanup is pending or failed. Explicitly active identities remain protected and visible. Deletion markers are excluded from the Advanced Storage selector so a generic settings cleanup cannot accidentally undo pending deletion intent. The queue uses a Web Lock when available to serialize reclamation across tabs; its durable records use separate per-project localStorage keys.

The old blocking cleanup progress bar is replaced with a small background-cleanup status. Users can navigate, close Settings, or delete more removed projects while cleanup continues.

Validation:

- Eight focused suites: 109 tests passed; an additional graph-deletion integration regression subsequently passed with its full suite and the queue suite (23 tests total in that run). There are 110 distinct passing tests across these validations.
- Queue regressions cover immediate durable removal before cleanup starts, interrupted-job startup, cleanup failure without resurrection, continuation to other projects, retry, local persistence failure, and active-project protection.
- The new graph regression verifies that a queued deletion hides retained catalog records and evidence before physical reclamation, including after a reindex, while other projects stay visible.
- Production build passed with existing repository warnings. Focused ESLint and `git diff --check` passed.
- `scripts/diagnostics/verify-immediate-project-deletion.cjs` passed against the production build using Electron 45 with a fresh temporary profile and synthetic data. With storage deliberately delayed by five seconds, the project row disappeared in **1.3 ms**, its durable job was still queued, and another delete button remained enabled. Reload resumed the interrupted job. Bulk deletion, numeric IDs, a deliberate invalid-JSON cleanup failure, absence of row resurrection on Refresh, explicit cleanup retry, and active-project/credential preservation all passed.
- Updated the existing Playwright permanent-deletion diagnostic to assert background failure/retry rather than blocking progress. The updated Playwright script was not executed; the native Electron diagnostic above exercised the built interface.

No live user project was deleted, no installed desktop application was changed, and no release or deployment was performed. The native diagnostic deletes its temporary synthetic profile when it exits.
