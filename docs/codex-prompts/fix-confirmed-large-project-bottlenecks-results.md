# Implementation results — October 18, 2026

Implemented the targeted prompt in fix-confirmed-large-project-bottlenecks.md. No saved analyses were read, regenerated, deleted or migrated; no paid provider calls. No commit/push.

## Changes

- Diagram structural construction indexes rows by endpoint file once, computes each file's group once, uses an existing-node map, and exits before evidence preprocessing when structure is unchanged. Shared-function evidence uses accumulating sets for unbounded references/files. Extracted helpers into diagramArchitectureIndexes.js for testing.
- Review saves accept the last successful immutable snapshot as a baseline and write only changed or missing records. Deletion still reconciles against current database keys. Initial saves and retries after failures retain full-write behavior. A session-local persistence writer coalesces pending snapshots to one active and one latest pending snapshot, settles all callers, and invalidates its baseline on rejected/failed writes.
- Hazard review matching indexes Raw Analysis Row ID and verifies exact content, preserving the previous edited-row behavior. Legacy rows use compact candidate hashes with exact collision checks instead of retaining complete serialized narrative rows as map keys. First duplicate wins as before.

## Validation

32 tests passed across seven suites: diagramArchitectureIndexes, reviewStorePersistence, hazardReviewRowIndex, reviewPersistenceWriter, functionalDiagramInitialization, functionalDiagramNodeReconciliation, functionalDiagramTableDetails. Failure-path tests intentionally emit storage errors.

Production build completed (CI=false npm run build) with repository lint, stale Browserslist and bundle-size warnings. Existing ResultsReviewProvider dependency-array warning remains; no new helper-module warnings appeared. git diff --check passed. Changed JavaScript modules parsed successfully.

Compared evidence and grouping against the original HEAD functions across 500/2,500/4,981-row fixtures and ten additional varied topology fixtures; outputs matched. Synthetic Node measurements:

| Operation | Earlier measurement | After |
| --- | ---: | ---: |
| File grouping, 4,981 cyclic relationships/nodes | 5,857 ms | 27 ms |
| Shared-hub evidence aggregation, 4,981 relationships | 911 ms | 36 ms |
| Review index/match, 26,278 × 73 cells, 40-character padding | 1,071 ms | 27 ms with stable IDs |
| Review index/match, 26,278 × 73 cells, 160-character padding | 2,848 ms | 29 ms with stable IDs |

Review fixture after the change uses a stable ID in column zero, and copied row arrays sharing string values. These are synchronous helper measurements, not complete UI timings or Safari heap profiles. Exact numerical improvements depend on real graph topology and content.

Storage tests verify one changed record produces one put with an established baseline, missing records are restored, deleted records are removed, failed writes reset the baseline, and queued snapshots coalesce without stranding callers.

## Remaining scope

Global review collection loading and first-time bulk registration still exist. Canvas culling/layout behavior was not changed. Legacy row hashing still scans content but retains compact keys. A full browser trace on the actual project is needed to determine remaining main-thread, memory, storage and rendering costs; this change does not assert that every source of lag or browser reload is eliminated. Incremental saves assume immutable review records, consistent with current provider update paths.
