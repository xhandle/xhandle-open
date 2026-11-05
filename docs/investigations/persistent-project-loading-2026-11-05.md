# Persistent project-loading investigation — 2026-11-05

## Outcome

The remaining delay is real. In the existing Electron preview profile, an ordinary native `indexedDB.open()` repeatedly takes approximately 10 seconds, before xHandle can read a project. A native Chromium trace isolates **10,518 ms in `BackingStore::OpenAndVerify.LevelDBScopes`**, within a **10,669 ms `IDBFactory::open`** request. Opening LevelDB itself takes only 61 ms; blob-journal cleanup takes less than 1 ms.

The earlier removal of automatic Collaborator indexing was necessary but did not remove this existing-profile storage cost. No automatic index passes occurred during the current navigation measurements. It would be incorrect to declare this resolved based on the earlier synthetic navigation checks.

## Executed investigation

Prompt: [investigate-persistent-project-loading-2026-11-05.md](../prompts/investigate-persistent-project-loading-2026-11-05.md).

Verified the actual preview (`0.2.14-preview.20261105.6`, renderer `main.1188e3d9.js`), preserved its profile and settings, checked process ownership, captured native database errors, timed real project navigation, compared released/current renderers using disposable copies, and traced native storage opening. No live AI requests, analysis runs, application-source edits, releases, database deletions, or lock-file deletions were performed.

## Confirmed findings

### 1. Expensive backing-store initialization recurs after idle connections close

Repeated native opens in the working profile took 10.2–10.7 seconds. Different logical databases finished opening together, indicating a shared origin-storage bottleneck, rather than independent slow project queries.

A reversible connection-lifetime experiment establishes the mechanism:

1. Open `xhandle`: **10,172 ms**.
2. Temporarily retain that connection, without a transaction or writes.
3. Open `xhandle`, project hazards, and workspace graph: **1.2, 1.3, and 2.7 ms**.
4. Close the temporary connection and allow the backing store to close.
5. Open again: **10,291 ms**.

The diagnostic connection was removed afterward. This proves that repeated backing-store initialization contributes the delay; retaining a connection is an experiment, not an implemented production fix.

Chromium's [backing-store implementation](https://chromium.googlesource.com/chromium/src/+/871824a5d76aa847a283c8ae3f96548a98406bb5/content/browser/indexed_db/instance/leveldb/backing_store.cc) places scope initialization inside the measured event. Its [scope initialization implementation](https://chromium.googlesource.com/chromium/src/+/main/components/services/storage/indexed_db/scopes/leveldb_scopes.cc) reads persisted transaction metadata and prepares recovery/cleanup work. The trace identifies this phase; it does **not** establish corruption or prove which earlier writes made it expensive. These source links explain the event, not a symbol-exact build attribution.

The profile's origin-wide LevelDB directory contains approximately **5.04 GB across 2,608 files**. This is the backing store for multiple logical databases, not a measurement of Collaborator data alone. Repeated native logs show reopening/recovery. The native trace also records moderate memory-pressure events; their contribution to connection retirement was not separately isolated.

### 2. Historical preview startup had database-lock failures

The pre-restart log records **52 failed LevelDB opens over approximately 51.6 seconds**, reporting `LOCK: Access denied (ChromeMethodBFE: 15::LockFile::5)`. This is concrete evidence of a separate period when project reads could not open storage.

The historical lock owner was not captured. A duplicate or incompletely exited preview is possible, but unproven. After confirming the previous preview exited and restarting, these errors stopped. The approximately 10-second native-open delay persisted, so a clean restart alone is insufficient.

### 3. Hazard preparation has an additional full-table pass

`PagedHazardPanel.js:50` requests a layout before showing the table. `pagedHazardRows.js:51` builds it by visiting the saved rows, normalizing them and constructing grouping/filter metadata. This project has **27,125 rows**. These files have no pending changes relative to HEAD.

On the working profile, opening hazards took **20.44 seconds**: roughly 9 seconds in storage opening, then preparation and initial rows. With a connection already retained, returning to the remembered hazard tab took **11.30 seconds**, with no database opens exceeding 100 ms. The latter is a return-to-hazards measurement, not an independent diagram-load comparison.

### 4. Current renderer is not slower in the controlled clean-copy comparison

Same Electron shell/backend; separate disposable profiles initially copied from the same closed profile; only the renderer differed. External requests were blocked. UI sampling interval: 250 ms. One valid run each.

| Navigation | Released renderer | Current renderer |
| --- | ---: | ---: |
| Ordinary project | 0.24 s | 0.24 s |
| VulnerableApp diagram, 4,049 rendered nodes | 4.03 s | 4.11 s |
| Hazard table, 27,125 rows | 12.19 s | 12.38 s |
| Return to ordinary project | 0.24 s | 0.15 s |

Released bundle: `main.b4a3b984.js`; current: `main.1188e3d9.js`. Both had zero automatic indexing passes and zero database-open errors. Final JS heaps were approximately 170 MB, not peak measurements.

These copies contain IndexedDB and Local Storage, not the whole browser profile. Their backing stores underwent native compaction during the runs. Therefore this comparison isolates renderer behavior reasonably, but **does not prove the existing profile has no regression** or rule out persistent storage effects from previous indexing work.

In the working profile, the diagram took **8.77 seconds** after navigation, including waiting for a native open already started by an ordinary-project navigation. The ordinary project did not finish within the first 5 seconds before the harness switched away; that run provides no total ordinary-project load time. Warm return took 0.31 seconds.

## Relationship to Collaborator changes

The previous investigation directly demonstrated unsolicited global indexing on navigation and removed it. That was an introduced regression. The current runs verify the removal is active.

Separately, the saved last explicit migration records a **217-second operation**, including **213 seconds of projection preparation**. Its timestamp remained unchanged during these tests. This is a remaining explicit-retrieval problem, not evidence of active indexing during the measured navigation.

It is plausible that earlier heavy indexing and transaction churn contributed to the backing-store state. No pre-change copy of this same profile or write-by-write causal trace exists here, so that historical link remains unproven. The exact native bottleneck is identified; the exact producer of the expensive persisted state is not.

## Corrective work recommended

1. Introduce managed database connection lifetimes so routine project/tab navigation does not repeatedly incur cold backing-store initialization. Handle version changes, deletion, cancellation, shutdown, and memory limits explicitly; do not merely leave every database open indefinitely.
2. Reduce Collaborator index/projection write amplification and investigate its slow repair path independently. Keep ordinary navigation free of index rebuilds.
3. Make preview launching enforce one process per profile and wait for full shutdown before reuse. Surface persistent database-open failures in diagnostics rather than silently retrying for minutes.
4. Reuse or persist bounded hazard-layout metadata by run/revision, preserving complete continuous scrolling without reading all row bodies on each cold mount.
5. Validate fixes on an aged profile with real stored data, including cold start, idle reopen, project switching, import invalidation, database upgrades/deletion, and memory pressure. Include released/current comparisons with identical starting state; fresh synthetic profiles alone are insufficient.

`projectReadRecovery.js` currently retries transient failures after a 60-second idle timeout, with backoff up to 30 seconds. This unchanged behavior can extend a storage problem into a multi-minute wait; it is not evidence that the loader itself is the newly introduced cause.

## Evidence and limits

Compact timings: [persistent-project-loading-2026-11-05.json](./persistent-project-loading-2026-11-05.json).

Temporary local evidence includes `/private/tmp/xhandle-project-loading-before-restart.log`, `/private/tmp/xhandle-load-comparison/{released,current}/results.json`, `/private/tmp/xhandle-original-load-observation/results.json`, `/private/tmp/xhandle-held-load-observation/results.json`, and `/private/tmp/xhandle-storage-open-trace.json` (Perfetto binary despite extension). Raw trace remains outside the repository. No application regression suite was rerun because this turn changed documentation only; validation consisted of the controlled runtime experiments above.

The historical approximately 52-second database-open failure and repeated approximately 10-second native initialization are confirmed. A fresh multi-minute single navigation was not reproduced after restart; the longest measured complete navigation was 20.44 seconds. The issue is **investigated, not fixed or release-ready on this evidence alone**.
